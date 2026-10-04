import type { WebSocket, RawData } from 'ws';
import { DockerService } from './docker.service.js';
import { ProxmoxService } from './proxmox.service.js';
import { SystemService } from './system.service.js';
import { TailscaleService } from './tailscale.service.js';
import { SslService } from './ssl.service.js';
import { PinsService } from './pins.service.js';
import { GitProjectsService } from './git-projects.service.js';
import { ServiceProbeService } from './service-probe.service.js';
import { MetricHistoryService } from './metric-history.service.js';
import { CockpitSnapshot, SentinelStatus, DockerHostSummary, AppVersionInfo, StorageItem, MetricHistoryPoint } from '../types.js';
import { auditLogService } from './audit-log.service.js';
import { config } from '../config.js';

export class CollectorService {
  private dockerServices: DockerService[];
  private proxmoxService: ProxmoxService;
  private systemService: SystemService;
  private tailscaleService: TailscaleService;
  private sslService: SslService;
  private pinsService: PinsService;
  private gitProjectsService: GitProjectsService;
  private serviceProbeService: ServiceProbeService;
  private metricHistoryService: MetricHistoryService;
  private idleTimer: NodeJS.Timeout | null = null;
  private getSentinelStatus?: () => SentinelStatus | undefined;
  private getAppVersion?: () => AppVersionInfo | undefined;
  private getPrimaryNodeName?: () => string | undefined;
  private wsClients: Set<WebSocket> = new Set();
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshot: CockpitSnapshot | null = null;
  private containerMonitoringExpiresAt = 0;
  private lastStorageStateById: Map<string, { isDisconnected: boolean; smartStatus?: string; status: string }> = new Map();

  public isContainerMonitoringActive(): boolean {
    return Date.now() < this.containerMonitoringExpiresAt;
  }

  public getContainerMonitoringRemainingMs(): number {
    return Math.max(0, this.containerMonitoringExpiresAt - Date.now());
  }

  public setContainerMonitoring(active: boolean, durationMs = 300000) {
    this.containerMonitoringExpiresAt = active ? Date.now() + durationMs : 0;
    for (const service of this.dockerServices) {
      service.setMonitoringActive(active, durationMs);
    }
  }

  constructor(
    dockerServices: DockerService[],
    proxmoxService: ProxmoxService,
    systemService: SystemService,
    tailscaleService: TailscaleService,
    sslService: SslService,
    pinsService: PinsService,
    gitProjectsService: GitProjectsService,
    serviceProbeService: ServiceProbeService,
    metricHistoryService: MetricHistoryService,
    getSentinelStatus?: () => SentinelStatus | undefined,
    getAppVersion?: () => AppVersionInfo | undefined,
    getPrimaryNodeName?: () => string | undefined
  ) {
    this.dockerServices = dockerServices;
    this.proxmoxService = proxmoxService;
    this.systemService = systemService;
    this.tailscaleService = tailscaleService;
    this.sslService = sslService;
    this.pinsService = pinsService;
    this.gitProjectsService = gitProjectsService;
    this.serviceProbeService = serviceProbeService;
    this.metricHistoryService = metricHistoryService;
    this.getSentinelStatus = getSentinelStatus;
    this.getAppVersion = getAppVersion;
    this.getPrimaryNodeName = getPrimaryNodeName;
  }

  public start() {
    this.serviceProbeService.start();

    // Initial snapshot collection at boot
    this.collectAndBroadcast();

    // The 2s timer below only runs while a browser is connected. This slower
    // sampler fills the history buffer in between, so a page opened cold is
    // seeded with recent history instead of an empty graph.
    this.idleTimer = setInterval(() => {
      if (this.wsClients.size === 0) {
        this.collect().catch((err) => console.error('[CollectorService] Idle sample failed:', err));
      }
    }, config.idleSampleIntervalMs);
    this.idleTimer.unref();

    // Do not run high-frequency polling when 0 clients are connected.
    // Timer will be dynamically started when a client connects and paused when all clients disconnect.
    console.log(`[CollectorService] Real-time metrics collector initialized. Waiting for active clients to start streaming.`);
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.collectAndBroadcast();
    }, config.pollIntervalMs);
    console.log(`[CollectorService] Active client connected. Polling started (interval: ${config.pollIntervalMs}ms)`);
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      // Docker stats streams (see DockerService.ensureStatsStream) are opened
      // independently of the poll tick and would otherwise keep receiving data
      // from the daemon indefinitely once nothing is left to close them — the
      // tick-driven cleanup in fetchLiveContainers() only runs during a tick,
      // which just stopped. They reopen on the next tick if monitoring is still active.
      for (const service of this.dockerServices) {
        service.closeAllStatsStreams();
      }
      console.log(`[CollectorService] No active clients. Polling paused to save CPU.`);
    }
  }

  public stop() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.stopTimer();
  }

  public addClient(ws: WebSocket) {
    this.wsClients.add(ws);
    const isFirstClient = this.wsClients.size === 1;

    if (isFirstClient) {
      this.startTimer();
    }

    // A newly connecting client always gets a full snapshot, never a delta —
    // collectAndBroadcast()'s periodic ticks assume every connected client's
    // state already matches this.lastSnapshot from before that tick, which is
    // only true once this send has happened.
    (async () => {
      if (isFirstClient || !this.lastSnapshot) {
        // Polling was paused (no prior clients) or hasn't produced a snapshot yet.
        await this.collect();
      }
      if (this.lastSnapshot && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'SNAPSHOT', data: this.lastSnapshot }));
      }
    })();

    ws.on('close', () => {
      this.wsClients.delete(ws);
      if (this.wsClients.size === 0) {
        this.stopTimer();
      }
    });

    ws.on('message', async (message: RawData) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        } else if (payload.type === 'REQUEST_SNAPSHOT') {
          const snapshot = await this.collect();
          ws.send(JSON.stringify({ type: 'SNAPSHOT', data: snapshot }));
        }
      } catch {
        // ignore
      }
    });
  }

  public async collect(): Promise<CockpitSnapshot> {
    const localRootStats = this.systemService.safeStatfs('/');
    const rootUsage = localRootStats ? { used: localRootStats.used, total: localRootStats.total } : undefined;

    // Shared between getMetrics() and the direct pveStorage assignment below so
    // /disks/list, /storage and /lxc are only requested once per tick instead of twice.
    const storageVitalsPromise = this.proxmoxService.getStorageVitals(rootUsage);

    const [pveMetrics, dockerHostMetrics, tailscaleData, pveStorage, sslCerts, diskHygiene] = await Promise.all([
      this.proxmoxService.getMetrics(rootUsage, storageVitalsPromise),
      this.systemService.getDockerHostMetrics(),
      this.tailscaleService.getStatus(),
      storageVitalsPromise,
      this.sslService.getCertificates(),
      this.dockerServices[0].getDiskHygiene(),
    ]);

    const customNodeName = this.getPrimaryNodeName ? this.getPrimaryNodeName() : undefined;
    if (customNodeName) {
      pveMetrics.nodeName = customNodeName;
      dockerHostMetrics.hostname = customNodeName;
    }

    const storageData = await this.systemService.getStorageMatrix(pveStorage);
    this.logStorageTransitions(storageData);

    const selfTailscaleIp = tailscaleData.devices.find(d => d.isCurrentDevice)?.ipv4 || '100.110.20.15';

    const isMonitoring = this.isContainerMonitoringActive();
    const perHostResults = await Promise.all(
      this.dockerServices.map(async (service) => ({
        service,
        result: await service.getContainers(selfTailscaleIp, isMonitoring),
      }))
    );

    const dockerHosts: DockerHostSummary[] = perHostResults.map(({ service, result }) => ({
      name: service.name,
      // Reflects this tick's actual fetch outcome, not just whether the service was
      // ever able to open a socket — a host whose live fetch failed just now and fell
      // back to mock data must not report itself as connected for this snapshot.
      connected: result.isLive,
      containerCount: result.containers.length,
    }));

    // Only the primary host (dockerServices[0]) ever serves mock data on a failed
    // fetch — a secondary host that isn't live just returns an empty container list
    // (see DockerService.getContainers). So "is this snapshot showing demo data" is
    // about the primary host specifically, not "did every configured host succeed."
    const primaryIsLive = perHostResults[0]?.result.isLive ?? false;
    const allContainers = [
      ...perHostResults.flatMap(({ result }) => result.containers),
      ...this.serviceProbeService.getContainers(),
    ];

    const pins = this.pinsService.getAll();
    const containers = allContainers.map(container => {
      const pin = pins[container.name];
      return pin
        ? { ...container, isPinned: true, publicUrl: pin.publicUrl }
        : container;
    });

    const gitProjects = this.gitProjectsService.getSnapshot();
    const sentinel = this.getSentinelStatus ? this.getSentinelStatus() : undefined;
    const appVersion = this.getAppVersion ? this.getAppVersion() : undefined;

    const snapshot: CockpitSnapshot = {
      timestamp: Date.now(),
      host: {
        pve: pveMetrics,
        dockerHost: dockerHostMetrics,
      },
      storage: storageData,
      tailscale: tailscaleData,
      containers,
      dockerHosts,
      sslCertificates: sslCerts,
      dockerHygiene: diskHygiene,
      gitProjects,
      sentinel,
      isDemoMode: !primaryIsLive || config.demoMode,
      appVersion,
      containerMonitoring: {
        active: isMonitoring,
        remainingMs: this.getContainerMonitoringRemainingMs(),
      },
    };

    snapshot.metricPoint = this.metricHistoryService.buildPoint(snapshot);
    this.metricHistoryService.record(snapshot.metricPoint);

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  // Piggybacks on the existing 2s snapshot poll instead of running its own
  // check - this only writes to the audit log on an actual state change
  // (connect/disconnect, SMART flip, healthy/warning/critical crossing), so
  // it costs nothing extra even though the poll itself runs continuously.
  // This is what makes past incidents (e.g. hdd-music dropping mid-read)
  // show up in Logs with a timestamp instead of only being visible live.
  private logStorageTransitions(storage: StorageItem[]) {
    for (const item of storage) {
      const prev = this.lastStorageStateById.get(item.id);
      const next = {
        isDisconnected: Boolean(item.isDisconnected),
        smartStatus: item.smartStatus,
        status: item.status,
      };
      this.lastStorageStateById.set(item.id, next);
      if (!prev) continue; // first observation this run, nothing to diff against

      if (prev.isDisconnected !== next.isDisconnected) {
        auditLogService.log(
          'storage',
          next.isDisconnected ? 'error' : 'info',
          next.isDisconnected
            ? `${item.label} (${item.mount}) dropped offline`
            : `${item.label} (${item.mount}) reconnected`,
          { detail: `usedPercent=${item.usedPercent}, smartStatus=${item.smartStatus ?? 'unknown'}` }
        );
      } else if (prev.smartStatus !== next.smartStatus && next.smartStatus && next.smartStatus !== 'UNKNOWN') {
        auditLogService.log(
          'storage',
          next.smartStatus === 'PASSED' ? 'info' : 'warn',
          `${item.label} (${item.mount}) SMART status changed: ${prev.smartStatus ?? 'unknown'} -> ${next.smartStatus}`
        );
      } else if (prev.status !== next.status && (next.status === 'critical' || prev.status === 'critical')) {
        auditLogService.log(
          'storage',
          next.status === 'critical' ? 'error' : 'info',
          `${item.label} (${item.mount}) health: ${prev.status} -> ${next.status}`,
          { detail: `usedPercent=${item.usedPercent}` }
        );
      }
    }
  }

  public getDockerServiceForContainer(id: string): DockerService | undefined {
    const container = this.lastSnapshot?.containers.find((c) => c.id === id || c.shortId === id);
    if (!container) return undefined;
    return this.dockerServices.find((service) => service.name === container.dockerHost);
  }

  public async collectAndBroadcast() {
    try {
      const previous = this.lastSnapshot;
      const snapshot = await this.collect();
      if (this.wsClients.size > 0) {
        // Every connected client's local state already equals `previous` (they either
        // just got it as a full snapshot on connect, or have been applying deltas
        // since one) — sending only the top-level keys that actually changed avoids
        // re-serializing and re-transmitting sections like sslCertificates or
        // gitProjects that don't change on every 2s tick.
        const payload = previous ? this.buildDeltaPayload(previous, snapshot) : { type: 'SNAPSHOT', data: snapshot };
        const message = JSON.stringify(payload);
        for (const client of this.wsClients) {
          if (client.readyState === 1) { // OPEN
            client.send(message);
          }
        }
      }
    } catch (err) {
      console.error(`[CollectorService] Error during metrics collection:`, err);
    }
  }

  private buildDeltaPayload(previous: CockpitSnapshot, next: CockpitSnapshot): { type: string; data: Partial<CockpitSnapshot> } {
    const data: Partial<CockpitSnapshot> = { timestamp: next.timestamp };
    for (const key of Object.keys(next) as (keyof CockpitSnapshot)[]) {
      if (key === 'timestamp') continue;
      if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) {
        (data as any)[key] = next[key];
      }
    }
    return { type: 'SNAPSHOT_DELTA', data };
  }

  public getMetricHistory(limit: number): MetricHistoryPoint[] {
    return this.metricHistoryService.getRecent(limit);
  }

  public getLastSnapshot(): CockpitSnapshot | null {
    return this.lastSnapshot;
  }
}
