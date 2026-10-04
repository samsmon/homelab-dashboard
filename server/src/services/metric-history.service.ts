import { CockpitSnapshot, MetricHistoryPoint } from '../types.js';

const MAX_POINTS = 120;

/**
 * Derives the graph data point for a snapshot and keeps a short ring buffer of
 * them server-side, so a client that just opened the page can be seeded with
 * recent history instead of starting from an empty graph.
 */
export class MetricHistoryService {
  private points: MetricHistoryPoint[] = [];

  public buildPoint(snapshot: CockpitSnapshot): MetricHistoryPoint {
    const pve = snapshot.host?.pve;
    const dockerHost = snapshot.host?.dockerHost;
    // Probed external services carry no resource metrics; keep them out of fleet sums.
    const containers = (snapshot.containers || []).filter((c) => !c.isExternal);
    const primaryDisk =
      snapshot.storage?.find((s) => s.isPhysicalRoot) ||
      snapshot.storage?.find((s) => s.activeTimePercent !== undefined) ||
      snapshot.storage?.[0];

    const rootAllocations = snapshot.storage?.find((s) => s.allocations)?.allocations || [];
    const lxcAllocations = rootAllocations.filter((a) => a.type === 'lxc');

    const rawFleetCpu = containers.reduce((sum, c) => sum + (c.cpuPercent || 0), 0);
    const rawFleetMem = containers.reduce((sum, c) => sum + (c.memoryBytes || 0), 0);
    const netRxRate = containers.reduce((sum, c) => sum + (c.networkRxRateBytesPerSec || 0), 0);
    const netTxRate = containers.reduce((sum, c) => sum + (c.networkTxRateBytesPerSec || 0), 0);

    // If container-level CPU/Mem is not actively streaming (0), fall back to the Proxmox LXC telemetry sum
    const pveLxcCpuSum = lxcAllocations.reduce((sum, a) => sum + (a.cpuPercent || 0), 0);
    const pveLxcMemSum = lxcAllocations.reduce((sum, a) => sum + (a.memUsedBytes || 0), 0);

    return {
      timestamp: snapshot.timestamp,
      pveCpu: pve?.cpuPercent ?? dockerHost?.cpuPercent ?? 0,
      dockerCpu: dockerHost?.cpuPercent ?? 0,
      pveRam: pve?.ramPercent ?? dockerHost?.ramPercent ?? 0,
      pveRamBytes: pve?.ramUsedBytes ?? dockerHost?.ramUsedBytes ?? 0,
      dockerRam: dockerHost?.ramPercent ?? 0,
      dockerRamBytes: dockerHost?.ramUsedBytes ?? 0,
      netRxRate,
      netTxRate,
      temp: pve?.cpuTempCelsius ?? dockerHost?.thermalThrottle?.packageTempCelsius ?? 45,
      diskActiveTime: primaryDisk?.activeTimePercent ?? 0,
      diskReadRate: primaryDisk?.readRateBytesPerSec ?? 0,
      diskWriteRate: primaryDisk?.writeRateBytesPerSec ?? 0,
      fleetCpu: rawFleetCpu > 0 ? rawFleetCpu : pveLxcCpuSum,
      fleetMemBytes: rawFleetMem > 0 ? rawFleetMem : pveLxcMemSum,
      fleetRunningCount: containers.filter((c) => c.state === 'running').length,
    };
  }

  public record(point: MetricHistoryPoint) {
    const last = this.points[this.points.length - 1];
    // Several callers can trigger a collect() within the same tick.
    if (last && point.timestamp - last.timestamp < 800) return;
    this.points.push(point);
    if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
  }

  public getRecent(limit: number): MetricHistoryPoint[] {
    return this.points.slice(-Math.max(1, Math.min(limit, MAX_POINTS)));
  }
}
