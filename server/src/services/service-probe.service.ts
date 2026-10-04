import { ContainerMetric, HttpHealthProbe } from '../types.js';
import { config, ServiceProbeConfig } from '../config.js';

interface ProbeResult {
  up: boolean;
  statusCode?: number;
  latencyMs?: number;
  checkedAt: number;
}

const PROBE_TIMEOUT_MS = 3000;

/**
 * HTTP reachability checks for services that are not Docker containers
 * (systemd units etc.), surfaced in the fleet as synthetic ContainerMetric
 * entries with isExternal set. Results are cached and refreshed on their own
 * interval — never awaited on the 2s snapshot tick.
 */
export class ServiceProbeService {
  private probes: ServiceProbeConfig[] = config.serviceProbes;
  private results = new Map<string, ProbeResult>();
  private lastRefreshAt = 0;
  private refreshing = false;

  public start() {
    if (this.probes.length === 0) return;
    void this.refresh();
  }

  private async probeOne(probe: ServiceProbeConfig): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const res = await fetch(probe.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await res.body?.cancel();
      // Any HTTP answer (even 401/404) means the service is up and listening;
      // only 5xx counts as unhealthy.
      return { up: res.status < 500, statusCode: res.status, latencyMs: Date.now() - started, checkedAt: Date.now() };
    } catch {
      return { up: false, checkedAt: Date.now() };
    }
  }

  private async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const entries = await Promise.all(this.probes.map(async (p) => [p.name, await this.probeOne(p)] as const));
      for (const [name, result] of entries) this.results.set(name, result);
      this.lastRefreshAt = Date.now();
    } finally {
      this.refreshing = false;
    }
  }

  public getContainers(): ContainerMetric[] {
    if (this.probes.length === 0) return [];
    if (Date.now() - this.lastRefreshAt >= config.serviceProbeIntervalMs) void this.refresh();

    return this.probes.map((probe) => {
      const result = this.results.get(probe.name);
      const url = new URL(probe.url);
      const port = url.port ? parseInt(url.port, 10) : undefined;

      let state: ContainerMetric['state'] = 'exited';
      let status = 'Checking…';
      let httpHealth: HttpHealthProbe = { status: 'unchecked' };
      if (result) {
        state = result.up ? 'running' : 'exited';
        status = result.up ? `Up (HTTP ${result.statusCode}, ${result.latencyMs}ms)` : 'Unreachable';
        httpHealth = result.up
          ? { status: 'healthy', statusCode: result.statusCode, latencyMs: result.latencyMs, checkedAt: 'Live probe' }
          : { status: 'critical' };
      }

      return {
        id: `probe:${probe.name}`,
        shortId: 'probe',
        name: probe.name,
        image: 'external service',
        state,
        status,
        cpuPercent: 0,
        memoryBytes: 0,
        memoryLimitBytes: 0,
        memoryPercent: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
        networkRxRateBytesPerSec: 0,
        networkTxRateBytesPerSec: 0,
        sparklineCpu: [],
        sparklineMemory: [],
        uptime: status,
        ports: port ? [String(port)] : [],
        created: 0,
        tailscaleEnabled: false,
        lanUrl: probe.url,
        primaryPort: port,
        httpHealth,
        dockerHost: probe.host,
        isExternal: true,
      };
    });
  }
}
