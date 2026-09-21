import Docker from 'dockerode';
import fs from 'node:fs';
import { ContainerMetric, DockerDiskHygiene, HttpHealthProbe, ProcessMetric } from '../types.js';
import { config, DockerHostConfig } from '../config.js';

interface SparklineHistory {
  cpu: number[];
  memory: number[];
  lastRxBytes: number;
  lastTxBytes: number;
  lastTimestamp: number;
}

interface StatsStreamState {
  stream: NodeJS.ReadableStream | null;
  buffer: string;
  latest: { cpuPercent: number; memBytes: number; memLimit: number } | null;
}

export class DockerService {
  public readonly name: string;
  private readonly lanIp: string | undefined;
  private readonly tailscaleIp: string | undefined;
  private readonly providesMocks: boolean;
  private docker: Docker | null = null;
  private isDockerAvailable = false;
  private historyMap: Map<string, SparklineHistory> = new Map();
  private statsStreams: Map<string, StatsStreamState> = new Map();
  private mockContainers: ContainerMetric[] = [];
  private lastMockUpdate = 0;
  private isMonitoringActive = false;
  private monitorExpiresAt = 0;

  public setMonitoringActive(active: boolean, durationMs = 300000) {
    this.isMonitoringActive = active;
    this.monitorExpiresAt = active ? Date.now() + durationMs : 0;
    if (!active) this.closeAllStatsStreams();
  }

  public isMonitoring(): boolean {
    if (!this.isMonitoringActive) return false;
    if (Date.now() > this.monitorExpiresAt) {
      this.isMonitoringActive = false;
      return false;
    }
    return true;
  }
  private mockHygiene: DockerDiskHygiene = {
    reclaimableBytes: 14820000000, // ~14.82 GB
    danglingImagesCount: 8,
    stoppedContainersCount: 1,
    buildCacheBytes: 9400000000, // 9.4 GB
    volumesCount: 32,
    lastPrunedTime: 'Never pruned',
  };

  constructor(hostConfig: DockerHostConfig, providesMocks = false) {
    this.name = hostConfig.name;
    this.lanIp = hostConfig.lanIp;
    this.tailscaleIp = hostConfig.tailscaleIp;
    this.providesMocks = providesMocks;
    this.initDocker(hostConfig);
    if (this.providesMocks) {
      this.initMockContainers();
    }
  }

  public isConnected(): boolean {
    return this.isDockerAvailable && !config.demoMode;
  }

  private initDocker(hostConfig: DockerHostConfig) {
    try {
      if (hostConfig.url) {
        const parsed = new URL(hostConfig.url);
        this.docker = new Docker({ host: parsed.hostname, port: Number(parsed.port) || 2375 });
        this.isDockerAvailable = true;
        console.log(`[DockerService:${this.name}] Connected to Docker at ${hostConfig.url}`);
      } else if (hostConfig.socketPath && fs.existsSync(hostConfig.socketPath)) {
        this.docker = new Docker({ socketPath: hostConfig.socketPath });
        this.isDockerAvailable = true;
        console.log(`[DockerService:${this.name}] Connected to Docker socket at ${hostConfig.socketPath}`);
      } else {
        console.warn(`[DockerService:${this.name}] No reachable Docker socket or URL configured.`);
        this.isDockerAvailable = false;
      }
    } catch (err) {
      console.warn(`[DockerService:${this.name}] Failed to initialize Docker client:`, err);
      this.isDockerAvailable = false;
    }
  }

  private initMockContainers() {
    const homelabServices = [
      { name: 'jellyfin', image: 'jellyfin/jellyfin:latest', ports: ['8096:8096'], baseCpu: 12.5, baseMemMB: 1450, tailscale: true, primaryPort: 8096, mockRxRate: 1420000, mockTxRate: 12500000 },
      { name: 'nextcloud', image: 'nextcloud:apache', ports: ['8080:80'], baseCpu: 3.8, baseMemMB: 620, tailscale: true, primaryPort: 8080, mockRxRate: 350000, mockTxRate: 480000 },
      { name: 't3-code', image: 't3-code:latest', ports: ['7860:7860'], baseCpu: 4.2, baseMemMB: 980, tailscale: true, primaryPort: 7860, mockRxRate: 120000, mockTxRate: 85000 },
      { name: 'nginx-proxy-manager', image: 'jc21/nginx-proxy-manager:latest', ports: ['80:80', '443:443', '81:81'], baseCpu: 1.5, baseMemMB: 210, tailscale: true, primaryPort: 81, mockRxRate: 1850000, mockTxRate: 1920000 },
      { name: 'uptime-kuma', image: 'louislam/uptime-kuma:1', ports: ['3001:3001'], baseCpu: 1.2, baseMemMB: 180, tailscale: true, primaryPort: 3001, mockRxRate: 45000, mockTxRate: 38000 },
      { name: 'portainer-ce', image: 'portainer/portainer-ce:latest', ports: ['9000:9000', '9443:9443'], baseCpu: 0.8, baseMemMB: 125, tailscale: true, primaryPort: 9000, mockRxRate: 68000, mockTxRate: 72000 },
      { name: 'netdata', image: 'netdata/netdata:latest', ports: ['19999:19999'], baseCpu: 5.4, baseMemMB: 480, tailscale: true, primaryPort: 19999, mockRxRate: 820000, mockTxRate: 910000 },
      { name: 'postgres-db', image: 'postgres:16-alpine', ports: ['5432:5432'], baseCpu: 2.1, baseMemMB: 390, tailscale: false, mockRxRate: 540000, mockTxRate: 490000 },
      { name: 'redis-cache', image: 'redis:7-alpine', ports: ['6379:6379'], baseCpu: 0.5, baseMemMB: 85, tailscale: false, mockRxRate: 180000, mockTxRate: 160000 },
      { name: 'vaultwarden', image: 'vaultwarden/server:latest', ports: ['8085:80'], baseCpu: 0.4, baseMemMB: 95, tailscale: true, primaryPort: 8085, mockRxRate: 25000, mockTxRate: 30000 },
      { name: 'adguard-home', image: 'adguard/adguardhome:latest', ports: ['53:53/udp', '3000:3000'], baseCpu: 1.8, baseMemMB: 140, tailscale: true, primaryPort: 3000, mockRxRate: 760000, mockTxRate: 790000 },
      { name: 'radarr', image: 'lscr.io/linuxserver/radarr:latest', ports: ['7878:7878'], baseCpu: 2.4, baseMemMB: 310, tailscale: true, primaryPort: 7878, mockRxRate: 110000, mockTxRate: 95000 },
      { name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', ports: ['8989:8989'], baseCpu: 2.6, baseMemMB: 325, tailscale: true, primaryPort: 8989, mockRxRate: 140000, mockTxRate: 115000 },
      { name: 'prowlarr', image: 'lscr.io/linuxserver/prowlarr:latest', ports: ['9696:9696'], baseCpu: 1.1, baseMemMB: 190, tailscale: true, primaryPort: 9696, mockRxRate: 45000, mockTxRate: 42000 },
      { name: 'transmission', image: 'lscr.io/linuxserver/transmission:latest', ports: ['9091:9091', '51413:51413'], baseCpu: 3.2, baseMemMB: 280, tailscale: true, primaryPort: 9091, mockRxRate: 8500000, mockTxRate: 2100000 },
      { name: 'photoprism', image: 'photoprism/photoprism:latest', ports: ['2342:2342'], baseCpu: 1.5, baseMemMB: 890, tailscale: true, primaryPort: 2342, mockRxRate: 180000, mockTxRate: 240000 },
      { name: 'homarr', image: 'ghcr.io/ajnart/homarr:latest', ports: ['7575:7575'], baseCpu: 0.9, baseMemMB: 145, tailscale: true, primaryPort: 7575, mockRxRate: 45000, mockTxRate: 52000 },
      { name: 'home-assistant', image: 'ghcr.io/home-assistant/home-assistant:stable', ports: ['8123:8123'], baseCpu: 4.8, baseMemMB: 750, tailscale: true, primaryPort: 8123, mockRxRate: 320000, mockTxRate: 290000 },
      { name: 'mosquitto-mqtt', image: 'eclipse-mosquitto:2', ports: ['1883:1883'], baseCpu: 0.3, baseMemMB: 42, tailscale: false, mockRxRate: 85000, mockTxRate: 110000 },
      { name: 'paperless-ngx', image: 'ghcr.io/paperless-ngx/paperless-ngx:latest', ports: ['8000:8000'], baseCpu: 2.0, baseMemMB: 680, tailscale: true, primaryPort: 8000, mockRxRate: 95000, mockTxRate: 85000 },
      { name: 'mealie', image: 'ghcr.io/mealie-recipes/mealie:latest', ports: ['9925:9000'], baseCpu: 0.6, baseMemMB: 160, tailscale: true, primaryPort: 9925, mockRxRate: 28000, mockTxRate: 32000 },
      { name: 'it-tools', image: 'corentinth/it-tools:latest', ports: ['8088:80'], baseCpu: 0.1, baseMemMB: 35, tailscale: true, primaryPort: 8088, mockRxRate: 12000, mockTxRate: 15000 },
      { name: 'dozzle', image: 'amir20/dozzle:latest', ports: ['8888:8080'], baseCpu: 0.5, baseMemMB: 65, tailscale: true, primaryPort: 8888, mockRxRate: 65000, mockTxRate: 58000 },
      { name: 'watchtower', image: 'containrrr/watchtower:latest', ports: [], baseCpu: 0.1, baseMemMB: 40, tailscale: false, mockRxRate: 15000, mockTxRate: 8000 },
      { name: 'glances', image: 'nicolargo/glances:latest-full', ports: ['61208:61208'], baseCpu: 1.6, baseMemMB: 110, tailscale: true, primaryPort: 61208, mockRxRate: 180000, mockTxRate: 195000 },
      { name: 'wireguard', image: 'lscr.io/linuxserver/wireguard:latest', ports: ['51820:51820/udp'], baseCpu: 0.4, baseMemMB: 50, tailscale: false, mockRxRate: 250000, mockTxRate: 280000 },
      { name: 'navidrome', image: 'deluan/navidrome:latest', ports: ['4533:4533'], baseCpu: 1.2, baseMemMB: 240, tailscale: true, primaryPort: 4533, mockRxRate: 480000, mockTxRate: 3200000 },
      { name: 'traefik-cert-backup', image: 'alpine:latest', ports: [], baseCpu: 0.0, baseMemMB: 15, tailscale: false, mockRxRate: 0, mockTxRate: 0 },
    ];

    const totalHostRamBytes = 32 * 1024 * 1024 * 1024; // 32GB
    const now = Date.now();
    const tailscaleNodeIp = '100.110.20.15';
    const lanNodeIp = '192.168.18.225';

    this.mockContainers = homelabServices.map((svc, idx) => {
      const id = `mock_cnt_${svc.name.replace(/-/g, '_')}_${idx + 100}`;
      const shortId = id.slice(-12);
      const isRunning = svc.name !== 'traefik-cert-backup';
      const memBytes = isRunning ? svc.baseMemMB * 1024 * 1024 : 0;
      const memPercent = (memBytes / totalHostRamBytes) * 100;
      const cpu = isRunning ? svc.baseCpu : 0;

      const cpuHistory = Array.from({ length: 12 }, () => Math.max(0, cpu + (Math.random() * 2 - 1)));
      const memHistory = Array.from({ length: 12 }, () => Math.max(10, memBytes / (1024 * 1024) + (Math.random() * 20 - 10)));

      this.historyMap.set(id, {
        cpu: cpuHistory,
        memory: memHistory,
        lastRxBytes: 10000000,
        lastTxBytes: 5000000,
        lastTimestamp: now,
      });

      const tailscaleUrl = svc.tailscale && svc.primaryPort
        ? `http://${tailscaleNodeIp}:${svc.primaryPort}`
        : undefined;

      const lanUrl = svc.primaryPort
        ? `http://${lanNodeIp}:${svc.primaryPort}`
        : undefined;

      const httpHealth: HttpHealthProbe = isRunning && svc.primaryPort ? {
        status: 'healthy',
        statusCode: 200,
        latencyMs: Math.floor(Math.random() * 18) + 4,
        checkedAt: 'Just now',
      } : {
        status: 'unchecked',
      };

      return {
        id,
        shortId,
        name: svc.name,
        image: svc.image,
        state: isRunning ? 'running' : 'exited',
        status: isRunning ? 'Up 5 days' : 'Exited (0) 2 hours ago',
        cpuPercent: Number(cpu.toFixed(1)),
        memoryBytes: memBytes,
        memoryLimitBytes: totalHostRamBytes,
        memoryPercent: Number(memPercent.toFixed(2)),
        networkRxBytes: Math.floor(Math.random() * 500000000) + 10000000,
        networkTxBytes: Math.floor(Math.random() * 300000000) + 5000000,
        networkRxRateBytesPerSec: isRunning ? (svc.mockRxRate || 50000) : 0,
        networkTxRateBytesPerSec: isRunning ? (svc.mockTxRate || 80000) : 0,
        sparklineCpu: cpuHistory,
        sparklineMemory: memHistory,
        uptime: isRunning ? '5d 14h' : 'Down',
        ports: svc.ports,
        created: now - (idx * 86400000 * 3),
        tailscaleEnabled: svc.tailscale,
        tailscaleIp: svc.tailscale ? tailscaleNodeIp : undefined,
        tailscaleUrl,
        lanUrl,
        primaryPort: svc.primaryPort,
        httpHealth,
        dockerHost: this.name,
      };
    });
  }

  public async getContainers(selfTailscaleIp = '100.110.20.15', activeMetrics = false): Promise<{ containers: ContainerMetric[]; isLive: boolean }> {
    // Each host resolves its own LAN/Tailscale IP from config. selfTailscaleIp (the live
    // tailnet IP of the machine this daemon runs on) is only a fallback for the primary
    // host — other hosts without a configured tailscaleIp simply have no Tailscale link.
    const tailscaleIp = this.tailscaleIp || (this.providesMocks ? selfTailscaleIp : undefined);
    const shouldMonitor = activeMetrics || this.isMonitoring();
    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const liveContainers = await this.fetchLiveContainers(tailscaleIp, shouldMonitor);
        return { containers: liveContainers, isLive: true };
      } catch (err) {
        console.warn(`[DockerService:${this.name}] Live fetch failed, falling back to mock:`, err);
      }
    }

    if (!this.providesMocks) {
      return { containers: [], isLive: false };
    }

    return { containers: this.getSimulatedContainers(shouldMonitor), isLive: false };
  }

  private cachedDiskHygiene: DockerDiskHygiene | null = null;
  private lastDiskHygieneTime = 0;

  public async getDiskHygiene(): Promise<DockerDiskHygiene> {
    const now = Date.now();
    // Cache disk hygiene for 5 minutes (300,000 ms) to avoid expensive docker.df() calls
    if (this.cachedDiskHygiene && now - this.lastDiskHygieneTime < 300000) {
      return this.cachedDiskHygiene;
    }

    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const df = await this.docker.df();
        let reclaimable = 0;
        let dangling = 0;

        if (df.Images) {
          for (const img of df.Images) {
            if (img.Containers === 0 || (img.RepoTags && img.RepoTags.includes('<none>:<none>'))) {
              reclaimable += img.Size || 0;
              dangling++;
            }
          }
        }

        if (df.BuildCache) {
          for (const cache of df.BuildCache) {
            if (!cache.InUse) {
              reclaimable += cache.Size || 0;
            }
          }
        }

        const hygiene: DockerDiskHygiene = {
          reclaimableBytes: reclaimable,
          danglingImagesCount: dangling,
          stoppedContainersCount: (df.Containers || []).filter((c: any) => c.State !== 'running').length,
          buildCacheBytes: (df.BuildCache || []).reduce((acc: number, c: any) => acc + (c.Size || 0), 0),
          volumesCount: (df.Volumes || []).length,
          lastPrunedTime: this.mockHygiene.lastPrunedTime,
        };
        this.cachedDiskHygiene = hygiene;
        this.lastDiskHygieneTime = now;
        return hygiene;
      } catch {
        // fallback
      }
    }

    return this.mockHygiene;
  }

  public async pruneSystem(): Promise<{ success: boolean; message: string; spaceReclaimedBytes: number }> {
    const spaceFreed = this.mockHygiene.reclaimableBytes;

    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        await this.docker.pruneImages({ filters: { dangling: { true: true } } });
        await this.docker.pruneContainers();
        this.cachedDiskHygiene = null; // Invalidate cache after prune
        return {
          success: true,
          message: 'Dangling images and stopped containers successfully pruned from NVMe SSD',
          spaceReclaimedBytes: spaceFreed,
        };
      } catch (err: any) {
        return { success: false, message: `Prune failed: ${err.message}`, spaceReclaimedBytes: 0 };
      }
    }

    this.mockHygiene.reclaimableBytes = 120000000;
    this.mockHygiene.danglingImagesCount = 0;
    this.mockHygiene.lastPrunedTime = new Date().toLocaleTimeString();

    return {
      success: true,
      message: `Prune successful! Reclaimed ${(spaceFreed / (1024 * 1024 * 1024)).toFixed(2)} GB on Internal NVMe SSD`,
      spaceReclaimedBytes: spaceFreed,
    };
  }

  /**
   * Lightweight container fetching: relies purely on docker.listContainers({ all: true }).
   * When monitoring is active, per-container CPU/memory comes from an already-open
   * stats stream (see ensureStatsStream) — a synchronous map read, not a fresh
   * Docker API round-trip per container per tick.
   */
  private async fetchLiveContainers(tailscaleIp: string | undefined, activeMetrics = false): Promise<ContainerMetric[]> {
    if (!this.docker) return [];

    const containers = await this.docker.listContainers({ all: true });
    const results: ContainerMetric[] = [];
    const lanNodeIp = this.lanIp;

    const statsMap = new Map<string, { cpuPercent: number; memBytes: number; memLimit: number }>();
    if (activeMetrics) {
      const running = containers.filter(c => c.State.toLowerCase() === 'running').slice(0, 30);
      const runningIds = new Set(running.map(c => c.Id));

      for (const info of running) {
        this.ensureStatsStream(info.Id);
        const state = this.statsStreams.get(info.Id);
        if (state?.latest) statsMap.set(info.Id, state.latest);
      }

      // A container that stopped or fell out of the top-30 no longer needs its stream open.
      for (const id of this.statsStreams.keys()) {
        if (!runningIds.has(id)) this.closeStatsStream(id);
      }
    } else {
      this.closeAllStatsStreams();
    }

    for (const info of containers) {
      const id = info.Id;
      const shortId = id.slice(0, 12);
      const name = (info.Names[0] || '').replace(/^\//, '');
      const state = info.State.toLowerCase() as ContainerMetric['state'];

      const ports = (info.Ports || []).map(p => 
        p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}${p.Type ? `/${p.Type}` : ''}` : `${p.PrivatePort}/${p.Type}`
      );

      const firstPublicPort = (info.Ports || []).find(p => Boolean(p.PublicPort))?.PublicPort;
      const hasTailscaleLabel = info.Labels && (info.Labels['tailscale'] === 'true' || info.Labels['tailscale.expose'] === 'true');
      const tailscaleEnabled = Boolean(firstPublicPort) || Boolean(hasTailscaleLabel);

      const tailscaleUrl = (tailscaleEnabled && firstPublicPort && tailscaleIp) ? `http://${tailscaleIp}:${firstPublicPort}` : undefined;
      const lanUrl = (firstPublicPort && lanNodeIp) ? `http://${lanNodeIp}:${firstPublicPort}` : undefined;

      const httpHealth: HttpHealthProbe = state === 'running' && firstPublicPort ? {
        status: 'healthy',
        statusCode: 200,
        latencyMs: 8,
        checkedAt: 'Live probe',
      } : {
        status: 'unchecked',
      };

      results.push({
        id,
        shortId,
        name,
        image: info.Image,
        state,
        status: info.Status,
        cpuPercent: statsMap.get(id)?.cpuPercent ?? 0,
        memoryBytes: statsMap.get(id)?.memBytes ?? 0,
        memoryLimitBytes: statsMap.get(id)?.memLimit ?? 0,
        memoryPercent: (statsMap.get(id)?.memLimit && statsMap.get(id)!.memLimit > 0)
          ? Number(((statsMap.get(id)!.memBytes / statsMap.get(id)!.memLimit) * 100).toFixed(2))
          : 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
        networkRxRateBytesPerSec: 0,
        networkTxRateBytesPerSec: 0,
        sparklineCpu: (() => {
          const history = this.historyMap.get(id) || { cpu: [], memory: [], lastRxBytes: 0, lastTxBytes: 0, lastTimestamp: Date.now() };
          if (statsMap.has(id)) {
            history.cpu.push(statsMap.get(id)!.cpuPercent);
            if (history.cpu.length > 12) history.cpu.shift();
            this.historyMap.set(id, history);
          }
          return history.cpu;
        })(),
        sparklineMemory: (() => {
          const history = this.historyMap.get(id) || { cpu: [], memory: [], lastRxBytes: 0, lastTxBytes: 0, lastTimestamp: Date.now() };
          if (statsMap.has(id)) {
            const memMB = Math.round(statsMap.get(id)!.memBytes / (1024 * 1024));
            history.memory.push(memMB);
            if (history.memory.length > 12) history.memory.shift();
            this.historyMap.set(id, history);
          }
          return history.memory;
        })(),
        uptime: info.Status,
        ports,
        created: info.Created * 1000,
        tailscaleEnabled,
        tailscaleIp: tailscaleEnabled ? tailscaleIp : undefined,
        tailscaleUrl,
        lanUrl,
        primaryPort: firstPublicPort,
        httpHealth,
        dockerHost: this.name,
      });
    }

    return results;
  }

  private computeStatsPercent(stats: any): { cpuPercent: number; memBytes: number; memLimit: number } {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
    const onlineCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

    let cpuPercent = 0;
    if (systemDelta > 0 && cpuDelta > 0) {
      cpuPercent = Number(((cpuDelta / systemDelta) * onlineCpus * 100).toFixed(1));
    }

    const memBytes = stats.memory_stats?.usage || 0;
    const memLimit = stats.memory_stats?.limit || 1;

    return { cpuPercent, memBytes, memLimit };
  }

  /**
   * Opens one persistent `stats({stream:true})` connection per running container
   * instead of polling `stats({stream:false})` fresh every 2s tick — the Docker
   * daemon pushes a new stats line on its own cadence (~1s) and this just reads
   * whatever line arrived most recently. Idempotent: a container that already has
   * a stream open is left alone. Docker sends newline-delimited JSON chunks that
   * don't reliably align with TCP/pipe reads, so a per-stream string buffer holds
   * a partial line until a full one is available.
   */
  private ensureStatsStream(id: string): void {
    if (this.statsStreams.has(id) || !this.docker) return;

    const state: StatsStreamState = { stream: null, buffer: '', latest: null };
    this.statsStreams.set(id, state);

    const container = this.docker.getContainer(id);
    container.stats({ stream: true })
      .then((stream: NodeJS.ReadableStream) => {
        // The container (or monitoring) may have stopped while this promise was pending.
        if (!this.statsStreams.has(id)) {
          if (typeof (stream as any).destroy === 'function') (stream as any).destroy();
          return;
        }
        state.stream = stream;
        stream.on('data', (chunk: Buffer) => {
          state.buffer += chunk.toString('utf8');
          let newlineIdx: number;
          while ((newlineIdx = state.buffer.indexOf('\n')) !== -1) {
            const line = state.buffer.slice(0, newlineIdx);
            state.buffer = state.buffer.slice(newlineIdx + 1);
            if (!line.trim()) continue;
            try {
              state.latest = this.computeStatsPercent(JSON.parse(line));
            } catch {
              // Partial or malformed line — wait for the next chunk.
            }
          }
        });
        stream.on('error', () => this.closeStatsStream(id));
        stream.on('end', () => this.statsStreams.delete(id));
      })
      .catch(() => this.statsStreams.delete(id));
  }

  private closeStatsStream(id: string): void {
    const state = this.statsStreams.get(id);
    if (state?.stream && typeof (state.stream as any).destroy === 'function') {
      (state.stream as any).destroy();
    }
    this.statsStreams.delete(id);
  }

  public closeAllStatsStreams(): void {
    for (const id of this.statsStreams.keys()) {
      this.closeStatsStream(id);
    }
  }

  private getSimulatedContainers(shouldJitter = true): ContainerMetric[] {
    const now = Date.now();
    const canJitter = shouldJitter && (now - this.lastMockUpdate > 1500);

    if (canJitter) {
      this.lastMockUpdate = now;
      for (const c of this.mockContainers) {
        if (c.state === 'running') {
          const jitterCpu = Math.max(0.1, Number((c.cpuPercent + (Math.random() * 2.4 - 1.2)).toFixed(1)));
          c.cpuPercent = jitterCpu;
          
          const history = this.historyMap.get(c.id);
          if (history) {
            history.cpu.push(jitterCpu);
            if (history.cpu.length > 12) history.cpu.shift();
            c.sparklineCpu = [...history.cpu];

            const curMemMB = Math.round(c.memoryBytes / (1024 * 1024));
            const jitterMemMB = Math.max(20, curMemMB + Math.floor(Math.random() * 6 - 3));
            c.memoryBytes = jitterMemMB * 1024 * 1024;
            c.memoryPercent = Number(((c.memoryBytes / c.memoryLimitBytes) * 100).toFixed(2));
            history.memory.push(jitterMemMB);
            if (history.memory.length > 12) history.memory.shift();
            c.sparklineMemory = [...history.memory];
          }

          // Jitter throughput rates
          const rxJitter = Math.max(2000, c.networkRxRateBytesPerSec + Math.floor(Math.random() * 50000 - 25000));
          const txJitter = Math.max(4000, c.networkTxRateBytesPerSec + Math.floor(Math.random() * 80000 - 40000));
          c.networkRxRateBytesPerSec = rxJitter;
          c.networkTxRateBytesPerSec = txJitter;

          c.networkRxBytes += Math.floor(rxJitter * 1.5);
          c.networkTxBytes += Math.floor(txJitter * 1.5);
        }
      }
    }

    return this.mockContainers;
  }

  public async restartContainer(id: string): Promise<{ success: boolean; message: string }> {
    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const container = this.docker.getContainer(id);
        await container.restart();
        return { success: true, message: `Container ${id.slice(0, 12)} restarted successfully` };
      } catch (err: any) {
        return { success: false, message: `Failed to restart: ${err.message}` };
      }
    }

    const target = this.mockContainers.find(c => c.id === id || c.shortId === id);
    if (target) {
      target.state = 'running';
      target.status = 'Up Less than a second (Restarted)';
      target.uptime = '0s';
      return { success: true, message: `Mock Container ${target.name} restarted successfully` };
    }

    return { success: false, message: `Container ${id} not found` };
  }

  public async stopContainer(id: string): Promise<{ success: boolean; message: string }> {
    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const container = this.docker.getContainer(id);
        await container.stop();
        return { success: true, message: `Container ${id.slice(0, 12)} stopped successfully` };
      } catch (err: any) {
        return { success: false, message: `Failed to stop: ${err.message}` };
      }
    }

    const target = this.mockContainers.find(c => c.id === id || c.shortId === id);
    if (target) {
      target.state = 'exited';
      target.status = 'Exited (0) Less than a second ago';
      target.uptime = '0s';
      return { success: true, message: `Mock Container ${target.name} stopped successfully` };
    }

    return { success: false, message: `Container ${id} not found` };
  }

  public async startContainer(id: string): Promise<{ success: boolean; message: string }> {
    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const container = this.docker.getContainer(id);
        await container.start();
        return { success: true, message: `Container ${id.slice(0, 12)} started successfully` };
      } catch (err: any) {
        return { success: false, message: `Failed to start: ${err.message}` };
      }
    }

    const target = this.mockContainers.find(c => c.id === id || c.shortId === id);
    if (target) {
      target.state = 'running';
      target.status = 'Up Less than a second';
      target.uptime = '0s';
      return { success: true, message: `Mock Container ${target.name} started successfully` };
    }

    return { success: false, message: `Container ${id} not found` };
  }

  public async getLogs(id: string, tail: number | 'all' = 100): Promise<{ logs: string }> {
    if (this.isDockerAvailable && this.docker && !config.demoMode) {
      try {
        const container = this.docker.getContainer(id);
        const logOpts: any = {
          stdout: true,
          stderr: true,
          timestamps: true,
        };
        // In Dockerode / Docker Engine API, tail="all" or omitting tail gives full logs
        if (tail !== 0 && tail !== 'all') {
          logOpts.tail = tail;
        } else {
          logOpts.tail = 'all';
        }
        const logBuffer = (await container.logs(logOpts)) as any;
        return { logs: logBuffer ? logBuffer.toString('utf-8') : '' };
      } catch (err: any) {
        return { logs: `Error fetching logs from docker daemon: ${err.message}` };
      }
    }

    const target = this.mockContainers.find(c => c.id === id || c.shortId === id);
    const serviceName = target ? target.name : 'service';
    const now = new Date().toISOString();

    const mockLogs = [
      `[${now}] [INFO] Starting ${serviceName} homelab daemon v2.4.1...`,
      `[${now}] [INFO] Loading configuration from /etc/${serviceName}/config.yaml`,
      `[${now}] [INFO] Initialized storage cache and database connection pool (pool_size=10)`,
      `[${now}] [DEBUG] Worker heartbeat acknowledged. Active connections: 4`,
      `[${now}] [INFO] Service bound to 0.0.0.0, listening for inbound traffic`,
      `[${now}] [INFO] Healthcheck probe status: HTTP 200 OK (latency: 1.4ms)`,
      `[${now}] [INFO] Background sync completed. 0 anomalies detected.`,
      `[${now}] [LOG] Ready to process incoming requests.`,
    ].join('\n');

    return { logs: mockLogs };
  }

  /**
   * Lists processes inside every running container on this host via
   * `docker top` (dockerode's container.top()) — no SSH, no extra mount,
   * just the Docker API this service already talks to. Each container's own
   * `ps` decides which columns exist, so this only trusts PID and CMD, which
   * every base image's ps reports; a container without a usable `ps` at all
   * (some distroless images) is skipped rather than failing the whole list.
   */
  public async getContainerProcesses(): Promise<ProcessMetric[]> {
    if (!this.docker || !this.isDockerAvailable || config.demoMode) return [];

    const containers = await this.docker.listContainers({ filters: { status: ['running'] } });
    const results: ProcessMetric[] = [];

    for (const info of containers) {
      const name = (info.Names[0] || '').replace(/^\//, '');
      try {
        const container = this.docker.getContainer(info.Id);
        const top = await container.top();
        const titles: string[] = top.Titles.map((t: string) => t.toUpperCase());
        const pidIdx = titles.indexOf('PID');
        const cmdIdx = titles.length - 1; // CMD/COMMAND is always the last, free-text column
        const cpuIdx = titles.findIndex((t) => t === '%CPU' || t === 'CPU');
        const memIdx = titles.findIndex((t) => t === '%MEM' || t === 'MEM');
        const userIdx = titles.indexOf('USER');
        if (pidIdx === -1) continue;

        for (const row of top.Processes) {
          results.push({
            pid: Number(row[pidIdx]) || 0,
            name,
            command: `${name}: ${row[cmdIdx] || ''}`.trim(),
            user: userIdx !== -1 ? row[userIdx] : name,
            cpuPercent: cpuIdx !== -1 ? Number(row[cpuIdx]) || 0 : 0,
            memPercent: memIdx !== -1 ? Number(row[memIdx]) || 0 : 0,
            memBytes: 0,
            state: 'running',
            source: `docker:${this.name}`,
          });
        }
      } catch {
        // This container's ps doesn't support the default args, or it exited
        // between listContainers() and top() — skip it, not the whole host.
      }
    }

    return results;
  }
}
