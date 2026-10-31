import { config } from '../config.js';
import { CloudflareStatus, CloudflareTunnel, CloudflareZone, TunnelDnsState, TunnelHostname } from '../types.js';

const API = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 10000;
const HOSTNAME_RE = /^(?=.{1,253}$)(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SERVICE_RE = /^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/;
const TUNNEL_TARGET_SUFFIX = '.cfargotunnel.com';

interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
  [key: string]: unknown;
}

interface TunnelConfig {
  ingress?: IngressRule[];
  [key: string]: unknown;
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

interface CfTunnel {
  id: string;
  name: string;
  status: string;
  remote_config?: boolean;
  config_src?: string;
  connections?: { colo_name: string; origin_ip?: string; opened_at?: string; client_version?: string }[];
}

interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

type DnsPlan = { action: 'none' } | { action: 'create' } | { action: 'repoint'; id: string };

/** What a publish actually did, so the audit log can say more than "published". */
export interface PublishResult {
  record: TunnelHostname;
  tunnelName: string;
  kind: 'new' | 'update' | 'move' | 'dns';
  from: string[];
  dnsAction: 'none' | 'create' | 'repoint';
}

export class CloudflareError extends Error {}

/** The zone whose name is the longest suffix of the hostname, so sub.example.co.id picks example.co.id. */
export function findZone(zones: CloudflareZone[], hostname: string): CloudflareZone | undefined {
  const host = hostname.replace(/^\*\./, '');
  return zones
    .filter((z) => host === z.name || host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

/**
 * Manages the remotely-managed Cloudflare Tunnels of an account: every
 * tunnel's ingress rules plus the matching proxied CNAME in whichever zone the
 * hostname belongs to.
 *
 * The configurations endpoint replaces a tunnel's whole ingress list on PUT, so
 * every change reads the current config, edits only the targeted rule and
 * writes it back with the catch-all rule kept last.
 */
export class CloudflareService {
  private cache: { at: number; value: CloudflareStatus } | null = null;
  private tunnelNames = new Map<string, string>();

  // Demo mode keeps everything in memory so the UI can be exercised without a token.
  private demo = buildDemo();

  public isConfigured(): boolean {
    const c = config.cloudflare;
    return Boolean(c.apiToken && c.accountId);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.cloudflare.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let json: CfEnvelope<T> | null = null;
    try {
      json = (await res.json()) as CfEnvelope<T>;
    } catch {
      // fall through to the generic error below
    }
    if (!res.ok || !json?.success) {
      const detail = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new CloudflareError(`Cloudflare API: ${detail}`);
    }
    return json.result;
  }

  private tunnelPath(tunnelId: string): string {
    return `/accounts/${config.cloudflare.accountId}/cfd_tunnel/${tunnelId}`;
  }

  private async listZones(): Promise<CloudflareZone[]> {
    const zones = await this.call<{ id: string; name: string }[]>(
      'GET',
      `/zones?account.id=${config.cloudflare.accountId}&status=active&per_page=50`,
    );
    return zones.map((z) => ({ id: z.id, name: z.name }));
  }

  private async listTunnels(): Promise<CfTunnel[]> {
    const tunnels = await this.call<CfTunnel[]>('GET', `/accounts/${config.cloudflare.accountId}/cfd_tunnel?is_deleted=false&per_page=100`);
    for (const t of tunnels) this.tunnelNames.set(t.id, t.name);
    return tunnels;
  }

  /** Name for log messages; falls back to a short id when the tunnel has not been listed yet. */
  public describeTunnel(tunnelId: string): string {
    const demo = this.demo.tunnels.find((t) => t.id === tunnelId);
    return this.tunnelNames.get(tunnelId) ?? demo?.name ?? tunnelId.slice(0, 8);
  }

  /** One cheap call (no ingress or DNS reads), for the background status watcher. */
  public async listTunnelStates(): Promise<{ id: string; name: string; status: string }[]> {
    if (config.demoMode || !this.isConfigured()) return [];
    const tunnels = await this.listTunnels();
    return tunnels.map((t) => ({ id: t.id, name: t.name, status: t.status }));
  }

  private isRemote(t: CfTunnel): boolean {
    return t.remote_config ?? t.config_src === 'cloudflare';
  }

  private async readConfig(tunnelId: string): Promise<TunnelConfig> {
    const result = await this.call<{ config?: TunnelConfig }>('GET', `${this.tunnelPath(tunnelId)}/configurations`);
    return result.config ?? {};
  }

  private async writeConfig(tunnelId: string, cfg: TunnelConfig): Promise<void> {
    await this.call('PUT', `${this.tunnelPath(tunnelId)}/configurations`, { config: cfg });
  }

  private splitIngress(cfg: TunnelConfig): { rules: IngressRule[]; catchAll: IngressRule } {
    const all = cfg.ingress ?? [];
    return {
      rules: all.filter((r) => r.hostname),
      catchAll: all.find((r) => !r.hostname) ?? { service: 'http_status:404' },
    };
  }

  private dnsState(
    hostname: string,
    tunnel: { id: string },
    names: Map<string, CfDnsRecord>,
    tunnelNames: Map<string, string>,
    zone: CloudflareZone | undefined,
  ): { dns: TunnelDnsState; dnsTarget?: string } {
    if (!zone) return { dns: 'unknown' };
    const rec = names.get(hostname);
    if (!rec) return { dns: 'missing' };
    if (rec.content === `${tunnel.id}${TUNNEL_TARGET_SUFFIX}`) return { dns: 'ok' };
    const other = rec.content.endsWith(TUNNEL_TARGET_SUFFIX) ? rec.content.slice(0, -TUNNEL_TARGET_SUFFIX.length) : null;
    return { dns: 'other', dnsTarget: (other && tunnelNames.get(other)) || rec.content };
  }

  public async getStatus(force = false): Promise<CloudflareStatus> {
    if (config.demoMode) return this.demoStatus();
    if (!this.isConfigured()) return { configured: false, isDemo: false, zones: [], tunnels: [] };
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;

    try {
      const [zones, rawTunnels] = await Promise.all([this.listZones(), this.listTunnels()]);
      const warnings: string[] = [];
      const tunnelNames = new Map(rawTunnels.map((t) => [t.id, t.name]));

      const configs = await Promise.allSettled(
        rawTunnels.map((t) => (this.isRemote(t) ? this.readConfig(t.id) : Promise.resolve<TunnelConfig>({}))),
      );
      const records = await Promise.allSettled(
        zones.map((z) => this.call<CfDnsRecord[]>('GET', `/zones/${z.id}/dns_records?type=CNAME&per_page=500`)),
      );
      const recordsByZone = new Map<string, Map<string, CfDnsRecord>>();
      records.forEach((r, i) => {
        if (r.status === 'fulfilled') recordsByZone.set(zones[i].id, new Map(r.value.map((rec) => [rec.name, rec])));
        else warnings.push(`DNS records of ${zones[i].name} could not be read: ${r.reason?.message ?? r.reason}`);
      });

      const tunnels: CloudflareTunnel[] = rawTunnels.map((t, i) => {
        const cfg = configs[i];
        if (cfg.status === 'rejected') warnings.push(`Config of tunnel ${t.name} could not be read: ${cfg.reason?.message ?? cfg.reason}`);
        const rules = cfg.status === 'fulfilled' ? this.splitIngress(cfg.value).rules : [];
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          managed: this.isRemote(t) ? 'remote' : 'local',
          connections: (t.connections ?? []).map((c) => ({
            colo: c.colo_name,
            originIp: c.origin_ip,
            openedAt: c.opened_at,
            version: c.client_version,
          })),
          hostnames: rules.map((r): TunnelHostname => {
            const zone = findZone(zones, r.hostname as string);
            const names = zone ? recordsByZone.get(zone.id) : undefined;
            const state = names
              ? this.dnsState(r.hostname as string, t, names, tunnelNames, zone)
              : { dns: 'unknown' as TunnelDnsState };
            return { hostname: r.hostname as string, service: r.service, path: r.path, zoneId: zone?.id, zoneName: zone?.name, ...state };
          }),
        };
      });

      const value: CloudflareStatus = { configured: true, isDemo: false, zones, tunnels, warnings: warnings.length ? warnings : undefined };
      this.cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return { configured: true, isDemo: false, zones: [], tunnels: [], error: (e as Error).message };
    }
  }

  private validate(hostname: string, service?: string): void {
    if (!HOSTNAME_RE.test(hostname)) throw new CloudflareError('Invalid hostname');
    if (service !== undefined && !SERVICE_RE.test(service)) {
      throw new CloudflareError('Origin must look like http://192.168.x.x:8080');
    }
  }

  /**
   * Adds or updates a hostname on a tunnel. A hostname that already lives on a
   * different tunnel is only taken over when `move` is set, so a typo cannot
   * silently steal live traffic.
   */
  public async publish(tunnelId: string, hostname: string, service: string, move = false): Promise<PublishResult> {
    hostname = hostname.trim().toLowerCase();
    service = service.trim();
    this.validate(hostname, service);

    if (config.demoMode) return this.demoPublish(tunnelId, hostname, service, move);
    if (!this.isConfigured()) throw new CloudflareError('Cloudflare is not configured on the server');

    const [zones, tunnels] = await Promise.all([this.listZones(), this.listTunnels()]);
    const zone = findZone(zones, hostname);
    if (!zone) throw new CloudflareError(`${hostname} is not inside any zone this token can access`);
    const target = tunnels.find((t) => t.id === tunnelId);
    if (!target) throw new CloudflareError('Unknown tunnel');
    if (!this.isRemote(target)) throw new CloudflareError(`Tunnel ${target.name} is locally managed; edit its config file instead`);

    // Find where the hostname lives now. Taking it over needs an explicit move.
    const holders: { tunnel: CfTunnel; cfg: TunnelConfig; rules: IngressRule[]; catchAll: IngressRule }[] = [];
    for (const other of tunnels.filter((t) => t.id !== tunnelId && this.isRemote(t))) {
      const cfg = await this.readConfig(other.id);
      const { rules, catchAll } = this.splitIngress(cfg);
      if (!rules.some((r) => r.hostname === hostname)) continue;
      if (!move) throw new CloudflareError(`${hostname} is already on tunnel ${other.name}; use Move to take it over`);
      holders.push({ tunnel: other, cfg, rules, catchAll });
    }

    // Decide the DNS change before touching any tunnel, so a refusal leaves everything as it was.
    const dnsPlan = await this.planDns(zone, hostname, tunnelId, move);

    // Order keeps traffic flowing: the new tunnel learns the hostname first, DNS switches next,
    // and the old tunnel only lets go once DNS points at the new one.
    const cfg = await this.readConfig(tunnelId);
    const { rules, catchAll } = this.splitIngress(cfg);
    const existing = rules.find((r) => r.hostname === hostname && !r.path);
    const updated: IngressRule = { ...(existing ?? {}), hostname, service };
    const next = existing ? rules.map((r) => (r === existing ? updated : r)) : [...rules, updated];
    const kind: PublishResult['kind'] = holders.length > 0 ? 'move' : existing ? (existing.service === service ? 'dns' : 'update') : 'new';
    await this.writeConfig(tunnelId, { ...cfg, ingress: [...next, catchAll] });

    try {
      await this.applyDns(zone, hostname, tunnelId, dnsPlan);
    } catch (e) {
      await this.writeConfig(tunnelId, cfg); // put the new tunnel back exactly as it was
      throw e;
    }

    for (const h of holders) {
      await this.writeConfig(h.tunnel.id, { ...h.cfg, ingress: [...h.rules.filter((r) => r.hostname !== hostname), h.catchAll] });
    }
    this.cache = null;
    return {
      record: { hostname, service, zoneId: zone.id, zoneName: zone.name, dns: 'ok' },
      tunnelName: target.name,
      kind,
      from: holders.map((h) => h.tunnel.name),
      dnsAction: dnsPlan.action,
    };
  }

  /** Returns the name of the tunnel the hostname was removed from. */
  public async unpublish(tunnelId: string, hostname: string): Promise<string> {
    hostname = hostname.trim().toLowerCase();
    this.validate(hostname);

    if (config.demoMode) return this.demoUnpublish(tunnelId, hostname);
    if (!this.isConfigured()) throw new CloudflareError('Cloudflare is not configured on the server');

    const tunnels = await this.listTunnels();
    const target = tunnels.find((t) => t.id === tunnelId);
    if (!target) throw new CloudflareError('Unknown tunnel');
    if (!this.isRemote(target)) throw new CloudflareError(`Tunnel ${target.name} is locally managed`);

    const cfg = await this.readConfig(tunnelId);
    const { rules, catchAll } = this.splitIngress(cfg);
    if (!rules.some((r) => r.hostname === hostname)) throw new CloudflareError('Hostname is not on this tunnel');
    await this.writeConfig(tunnelId, { ...cfg, ingress: [...rules.filter((r) => r.hostname !== hostname), catchAll] });

    // Only remove a DNS record that points at this tunnel, never someone else's.
    const zone = findZone(await this.listZones(), hostname);
    if (zone) {
      const records = await this.call<CfDnsRecord[]>(
        'GET',
        `/zones/${zone.id}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
      );
      for (const rec of records.filter((r) => r.content === `${tunnelId}${TUNNEL_TARGET_SUFFIX}`)) {
        await this.call('DELETE', `/zones/${zone.id}/dns_records/${rec.id}`);
      }
    }
    this.cache = null;
    return target.name;
  }

  /**
   * Works out what the zone needs, without changing anything. Only address and alias records
   * conflict with a tunnel CNAME; MX, TXT and similar can share the name (zone apex included).
   */
  private async planDns(zone: CloudflareZone, hostname: string, tunnelId: string, move: boolean): Promise<DnsPlan> {
    const content = `${tunnelId}${TUNNEL_TARGET_SUFFIX}`;
    const records = await this.call<CfDnsRecord[]>('GET', `/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`);
    const alias = records.filter((r) => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
    if (alias.some((r) => r.type === 'CNAME' && r.content === content)) return { action: 'none' };

    const stale = alias.find((r) => r.type === 'CNAME' && r.content.endsWith(TUNNEL_TARGET_SUFFIX));
    if (stale && move && alias.length === 1) return { action: 'repoint', id: stale.id };
    if (alias.length > 0) {
      throw new CloudflareError(`${hostname} already has a DNS record that is not this tunnel; remove it in Cloudflare first`);
    }
    return { action: 'create' };
  }

  private async applyDns(zone: CloudflareZone, hostname: string, tunnelId: string, plan: DnsPlan): Promise<void> {
    if (plan.action === 'none') return;
    const body = { type: 'CNAME', name: hostname, content: `${tunnelId}${TUNNEL_TARGET_SUFFIX}`, proxied: true };
    if (plan.action === 'repoint') await this.call('PUT', `/zones/${zone.id}/dns_records/${plan.id}`, body);
    else await this.call('POST', `/zones/${zone.id}/dns_records`, body);
  }

  // ---- demo mode -----------------------------------------------------------

  private demoStatus(): CloudflareStatus {
    return { configured: true, isDemo: true, zones: this.demo.zones, tunnels: structuredClone(this.demo.tunnels) };
  }

  private demoPublish(tunnelId: string, hostname: string, service: string, move: boolean): PublishResult {
    const zone = findZone(this.demo.zones, hostname);
    if (!zone) throw new CloudflareError(`${hostname} is not inside any zone this token can access`);
    const target = this.demo.tunnels.find((t) => t.id === tunnelId);
    if (!target) throw new CloudflareError('Unknown tunnel');
    if (target.managed === 'local') throw new CloudflareError(`Tunnel ${target.name} is locally managed; edit its config file instead`);

    const from: string[] = [];
    for (const other of this.demo.tunnels.filter((t) => t.id !== tunnelId)) {
      if (!other.hostnames.some((h) => h.hostname === hostname)) continue;
      if (!move) throw new CloudflareError(`${hostname} is already on tunnel ${other.name}; use Move to take it over`);
      other.hostnames = other.hostnames.filter((h) => h.hostname !== hostname);
      from.push(other.name);
    }
    const existing = target.hostnames.find((h) => h.hostname === hostname);
    const kind: PublishResult['kind'] = from.length > 0 ? 'move' : existing ? (existing.service === service ? 'dns' : 'update') : 'new';
    target.hostnames = target.hostnames.filter((h) => h.hostname !== hostname);
    const record: TunnelHostname = { hostname, service, zoneId: zone.id, zoneName: zone.name, dns: 'ok' };
    target.hostnames.push(record);
    return { record, tunnelName: target.name, kind, from, dnsAction: kind === 'move' ? 'repoint' : kind === 'new' ? 'create' : 'none' };
  }

  private demoUnpublish(tunnelId: string, hostname: string): string {
    const target = this.demo.tunnels.find((t) => t.id === tunnelId);
    if (!target) throw new CloudflareError('Unknown tunnel');
    if (!target.hostnames.some((h) => h.hostname === hostname)) throw new CloudflareError('Hostname is not on this tunnel');
    target.hostnames = target.hostnames.filter((h) => h.hostname !== hostname);
    return target.name;
  }
}

function buildDemo(): { zones: CloudflareZone[]; tunnels: CloudflareTunnel[] } {
  const zones: CloudflareZone[] = [
    { id: 'zone-main', name: 'example.com' },
    { id: 'zone-lab', name: 'example.dev' },
  ];
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const host = (hostname: string, service: string, zone: number, extra: Partial<TunnelHostname> = {}): TunnelHostname => ({
    hostname,
    service,
    zoneId: zones[zone].id,
    zoneName: zones[zone].name,
    dns: 'ok',
    ...extra,
  });
  return {
    zones,
    tunnels: [
      {
        id: 'demo-tunnel-home',
        name: 'homelab',
        status: 'healthy',
        managed: 'remote',
        connections: [
          { colo: 'SIN', originIp: '192.168.18.225', openedAt: ago(3), version: '2026.10.0' },
          { colo: 'CGK', originIp: '192.168.18.225', openedAt: ago(3), version: '2026.10.0' },
        ],
        hostnames: [
          host('jellyfin.example.com', 'http://192.168.18.225:8096', 0),
          host('dash.example.com', 'http://192.168.18.225:3000', 0),
          host('files.example.dev', 'http://192.168.18.225:8080', 1, { dns: 'missing' }),
        ],
      },
      {
        id: 'demo-tunnel-edge',
        name: 'edge-lab',
        status: 'degraded',
        managed: 'remote',
        connections: [{ colo: 'SIN', originIp: '192.168.18.40', openedAt: ago(26), version: '2026.9.1' }],
        hostnames: [
          host('api.example.dev', 'http://192.168.18.40:5000', 1),
          host('old.example.com', 'http://192.168.18.40:8000', 0, { dns: 'other', dnsTarget: 'homelab' }),
        ],
      },
      {
        id: 'demo-tunnel-office',
        name: 'office-nas',
        status: 'inactive',
        managed: 'local',
        connections: [],
        hostnames: [],
      },
    ],
  };
}
