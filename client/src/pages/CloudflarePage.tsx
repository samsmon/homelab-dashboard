import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Pencil, Plus, RefreshCw, Search, Trash2, Wrench, X } from 'lucide-react';
import { CloudflareStatus, CloudflareTunnel, TunnelHostname } from '../types.js';
import { authFetch } from '../utils/api.js';
import { redactText } from '../utils/formatters.js';
import { CloudflareFlowMap } from '../components/CloudflareFlowMap.js';
import { StateBlock } from '../components/StateBlock.js';

interface CloudflarePageProps {
  isPrivacyMode: boolean;
}

const statusPill = (status: string): string => {
  if (status === 'healthy') return 'pill pill-good';
  if (status === 'degraded') return 'pill pill-warn';
  if (status === 'down') return 'pill pill-bad';
  return 'pill pill-neutral';
};

const timeAgo = (iso?: string): string => {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

interface SaveArgs {
  tunnelId: string;
  hostname: string;
  service: string;
  move?: boolean;
}

export const CloudflarePage: React.FC<CloudflarePageProps> = ({ isPrivacyMode }) => {
  const [status, setStatus] = useState<CloudflareStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [newTunnel, setNewTunnel] = useState('');
  const [newZone, setNewZone] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [origin, setOrigin] = useState('http://');

  // `${tunnelId}|${hostname}` of the row being edited or removed.
  const [editing, setEditing] = useState<string | null>(null);
  const [editOrigin, setEditOrigin] = useState('');
  const [editTunnel, setEditTunnel] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setIsLoading(true);
    try {
      const res = await authFetch(`/api/cloudflare${force ? '?refresh=1' : ''}`);
      setStatus((await res.json()) as CloudflareStatus);
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tunnels = status?.tunnels ?? [];
  const zones = status?.zones ?? [];
  const editable = useMemo(() => tunnels.filter((t) => t.managed === 'remote'), [tunnels]);

  // Preselect the first tunnel and zone once data arrives.
  useEffect(() => {
    if (!newTunnel && editable[0]) setNewTunnel(editable[0].id);
    if (!newZone && zones[0]) setNewZone(zones[0].id);
  }, [editable, zones, newTunnel, newZone]);

  const matches = useCallback(
    (h: TunnelHostname): boolean => {
      if (zoneFilter && h.zoneId !== zoneFilter) return false;
      const q = query.trim().toLowerCase();
      return !q || h.hostname.toLowerCase().includes(q) || h.service.toLowerCase().includes(q);
    },
    [query, zoneFilter],
  );

  const save = async (args: SaveArgs, busyKey: string): Promise<boolean> => {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await authFetch('/api/cloudflare/hostnames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const json = (await res.json()) as { success: boolean; message?: string };
      if (!json.success) {
        setError(json.message || 'Failed to save hostname');
        return false;
      }
      await load(true);
      return true;
    } catch {
      setError('Failed to save hostname');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const zone = zones.find((z) => z.id === newZone);
    if (!zone || !newTunnel) return;
    const name = subdomain.trim().toLowerCase();
    const hostname = name ? `${name}.${zone.name}` : zone.name;
    if (await save({ tunnelId: newTunnel, hostname, service: origin.trim() }, 'add')) {
      setSubdomain('');
      setOrigin('http://');
    }
  };

  const saveEdit = async (tunnel: CloudflareTunnel, h: TunnelHostname) => {
    const moved = editTunnel !== tunnel.id;
    const ok = await save({ tunnelId: editTunnel, hostname: h.hostname, service: editOrigin.trim(), move: moved }, `${tunnel.id}|${h.hostname}`);
    if (ok) setEditing(null);
  };

  const fixDns = (tunnel: CloudflareTunnel, h: TunnelHostname) =>
    save({ tunnelId: tunnel.id, hostname: h.hostname, service: h.service, move: h.dns === 'other' }, `${tunnel.id}|${h.hostname}`);

  const remove = async (tunnel: CloudflareTunnel, h: TunnelHostname) => {
    const key = `${tunnel.id}|${h.hostname}`;
    setBusy(key);
    setError(null);
    try {
      const res = await authFetch(`/api/cloudflare/tunnels/${tunnel.id}/hostnames/${encodeURIComponent(h.hostname)}`, { method: 'DELETE' });
      const json = (await res.json()) as { success: boolean; message?: string };
      if (!json.success) setError(json.message || 'Failed to remove hostname');
      setConfirming(null);
      await load(true);
    } catch {
      setError('Failed to remove hostname');
    } finally {
      setBusy(null);
    }
  };

  const totalHostnames = tunnels.reduce((n, t) => n + t.hostnames.length, 0);
  const dnsProblems = tunnels.reduce((n, t) => n + t.hostnames.filter((h) => h.dns === 'missing' || h.dns === 'other').length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-cockpit-text">Cloudflare</h1>
          <p className="text-[12px] text-cockpit-muted">Domains, tunnels and where each public hostname ends up</p>
        </div>
        <button onClick={() => load(true)} disabled={isLoading} className="btn-ghost inline-flex items-center gap-2 text-[12px]">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {isLoading && !status && <StateBlock kind="loading" title="Loading Cloudflare…" />}
      {!isLoading && !status && (
        <StateBlock kind="error" title="Could not reach the dashboard server" message="Cloudflare data could not be loaded." onRetry={() => load(true)} />
      )}

      {status && !status.configured && (
        <section className="panel space-y-2 px-5 py-6 text-[12px] leading-relaxed text-cockpit-muted">
          <p className="text-cockpit-text">Cloudflare is not configured on the server.</p>
          <p>
            Set <code className="font-mono text-cockpit-accent">CLOUDFLARE_API_TOKEN</code> and{' '}
            <code className="font-mono text-cockpit-accent">CLOUDFLARE_ACCOUNT_ID</code> in the server{' '}
            <code className="font-mono">.env</code>, then restart the dashboard. Every tunnel and domain on the account is found
            automatically. Token scopes: Account → Cloudflare Tunnel: Edit, Zone → Zone: Read, Zone → DNS: Edit.
          </p>
        </section>
      )}

      {status?.error && <p className="panel bg-state-bad/10 px-5 py-3 text-[12px] text-state-bad">{status.error}</p>}
      {status?.warnings?.map((w) => (
        <p key={w} className="panel bg-state-warn/10 px-5 py-3 text-[12px] text-state-warn">
          {w}
        </p>
      ))}
      {error && <p className="panel bg-state-bad/10 px-5 py-3 text-[12px] text-state-bad">{error}</p>}

      {status?.configured && !status.error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="panel px-4 py-3">
              <p className="label">Domains</p>
              <p className="mt-1 text-[14px] font-semibold text-cockpit-text">{zones.length}</p>
            </div>
            <div className="panel px-4 py-3">
              <p className="label">Tunnels</p>
              <p className="mt-1 text-[14px] font-semibold text-cockpit-text">{tunnels.length}</p>
            </div>
            <div className="panel px-4 py-3">
              <p className="label">Public hostnames</p>
              <p className="mt-1 text-[14px] font-semibold text-cockpit-text">{totalHostnames}</p>
            </div>
            <div className="panel px-4 py-3">
              <p className="label">DNS issues</p>
              <p className="mt-1">
                <span className={dnsProblems ? 'pill pill-warn' : 'pill pill-good'}>{dnsProblems ? dnsProblems : 'none'}</span>
              </p>
            </div>
          </div>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Traffic map</h2>
                <p className="panel-sub">Visitor → domain → tunnel → server on your LAN.<span className="hidden sm:inline"> Hover a box to follow its lines.</span></p>
              </div>
              {status.isDemo && <span className="pill pill-neutral">demo data</span>}
            </div>
            <div className="px-3 py-4 sm:px-5">
              <CloudflareFlowMap status={status} isPrivacyMode={isPrivacyMode} />
              <p className="mt-2 text-center text-[11px] text-cockpit-muted">
                Numbers are hostnames on that hop. A dashed amber line means a DNS record is missing or points at another tunnel.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Add public hostname</h2>
                <p className="panel-sub">Creates the tunnel rule and a proxied CNAME in the chosen domain</p>
              </div>
            </div>
            <form onSubmit={add} className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.2fr_auto]">
              <select className="field min-w-0" value={newTunnel} onChange={(e) => setNewTunnel(e.target.value)} aria-label="Tunnel">
                {editable.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tunnel: {redactText(t.name, isPrivacyMode)}
                  </option>
                ))}
              </select>
              <select className="field min-w-0" value={newZone} onChange={(e) => setNewZone(e.target.value)} aria-label="Domain">
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    Domain: {redactText(z.name, isPrivacyMode)}
                  </option>
                ))}
              </select>
              <input
                className="field min-w-0"
                placeholder="subdomain (blank = root)"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <input
                className="field min-w-0 font-mono"
                placeholder="http://192.168.x.x:8080"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
              <button type="submit" disabled={busy !== null || !newTunnel || !newZone} className="btn-primary inline-flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" />
                Publish
              </button>
            </form>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cockpit-muted" />
              <input className="field w-full !pl-8" placeholder="Search hostname or origin" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select className="field w-full sm:w-auto" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} aria-label="Filter by domain">
              <option value="">All domains</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {redactText(z.name, isPrivacyMode)}
                </option>
              ))}
            </select>
          </div>

          {tunnels.length === 0 && (
            <section className="panel">
              <StateBlock kind="empty" title="No tunnels on this account yet" message="Create a remotely-managed tunnel in Cloudflare Zero Trust and it will show up here." />
            </section>
          )}

          {tunnels.map((tunnel) => {
            const rows = tunnel.hostnames.filter(matches);
            const colos = [...new Set(tunnel.connections.map((c) => c.colo))];
            return (
              <section key={tunnel.id} className="panel">
                <div className="panel-head">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="panel-title">{redactText(tunnel.name, isPrivacyMode)}</h2>
                      <span className={statusPill(tunnel.status)}>{tunnel.status}</span>
                      {tunnel.managed === 'local' && <span className="pill pill-neutral">local config · read-only</span>}
                    </div>
                    <p className="panel-sub">
                      {tunnel.connections.length} edge connection{tunnel.connections.length === 1 ? '' : 's'}
                      {colos.length > 0 && ` · ${colos.join(', ')}`}
                      {tunnel.connections[0]?.openedAt && ` · up ${timeAgo(tunnel.connections[0].openedAt)}`}
                      {tunnel.connections[0]?.version && ` · cloudflared ${tunnel.connections[0].version}`}
                    </p>
                  </div>
                  <span className="pill pill-neutral">{tunnel.hostnames.length} hostnames</span>
                </div>

                {tunnel.managed === 'local' ? (
                  <p className="px-5 py-5 text-[12px] text-cockpit-muted">
                    This tunnel reads its rules from a config file on the connector host, so Cloudflare cannot list or change its hostnames from here.
                  </p>
                ) : rows.length === 0 ? (
                  <p className="px-5 py-6 text-center text-[12px] text-cockpit-muted">
                    {tunnel.hostnames.length === 0 ? 'No public hostnames on this tunnel.' : 'No hostname matches the filter.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-cockpit-border/60">
                    {rows.map((h) => {
                      const key = `${tunnel.id}|${h.hostname}`;
                      const isEditing = editing === key;
                      return (
                        <li key={`${key}${h.path ?? ''}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1 basis-56">
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={`https://${h.hostname}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1.5 font-mono text-[12.5px] font-semibold text-cockpit-accent hover:underline"
                              >
                                <span className="truncate">{redactText(h.hostname, isPrivacyMode)}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                              {h.dns === 'missing' && <span className="pill pill-warn">DNS missing</span>}
                              {h.dns === 'other' && (
                                <span className="pill pill-warn">DNS → {redactText(h.dnsTarget ?? 'other', isPrivacyMode)}</span>
                              )}
                              {h.dns === 'unknown' && <span className="pill pill-neutral">DNS not checked</span>}
                            </div>
                            {isEditing ? (
                              <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                                <input className="field w-full font-mono" value={editOrigin} onChange={(e) => setEditOrigin(e.target.value)} autoFocus />
                                <select className="field" value={editTunnel} onChange={(e) => setEditTunnel(e.target.value)} aria-label="Tunnel">
                                  {editable.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.id === tunnel.id ? 'Tunnel: ' : 'Move to: '}
                                      {redactText(t.name, isPrivacyMode)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <p className="truncate font-mono text-[11px] text-cockpit-muted">
                                → {redactText(h.service, isPrivacyMode)}
                                {h.path ? ` · ${h.path}` : ''}
                              </p>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => saveEdit(tunnel, h)} disabled={busy === key} className="icon-btn" title="Save">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setEditing(null)} className="icon-btn" title="Cancel">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : confirming === key ? (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => remove(tunnel, h)} disabled={busy === key} className="btn-danger !px-3 !py-1.5 text-[12px]">
                                Remove
                              </button>
                              <button onClick={() => setConfirming(null)} className="btn-ghost !px-3 !py-1.5 text-[12px]">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {(h.dns === 'missing' || h.dns === 'other') && (
                                <button onClick={() => fixDns(tunnel, h)} disabled={busy === key} className="icon-btn text-state-warn" title="Fix DNS record">
                                  <Wrench className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setEditing(key);
                                  setEditOrigin(h.service);
                                  setEditTunnel(tunnel.id);
                                }}
                                className="icon-btn"
                                title="Edit origin or move to another tunnel"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirming(key)}
                                className="icon-btn hover:border-state-bad/40 hover:text-state-bad"
                                title="Remove hostname and DNS record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
};
