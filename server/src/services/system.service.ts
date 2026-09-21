import si from 'systeminformation';
import os from 'node:os';
import fs from 'node:fs';
import { DockerHostMetrics, StorageItem, ThermalThrottleVitals, ProcessMetric, PveStorageVitals } from '../types.js';
import { config } from '../config.js';

interface DiskPerfHistory {
  lastSectorsRead: number;
  lastSectorsWritten: number;
  lastTimeReadingMs: number;
  lastTimeWritingMs: number;
  lastReadsCompleted: number;
  lastWritesCompleted: number;
  lastTimeIoMs: number;
  lastTimestamp: number;
  sparklineActiveTime: number[];
}

const PROCESS_LIST_LIMIT = 30;

export class SystemService {
  private diskPerfMap: Map<string, DiskPerfHistory> = new Map();
  private processIoMap: Map<number, { lastReadBytes: number; lastWriteBytes: number; lastTimestamp: number }> = new Map();
  private lastCpuTimes: { idle: number; total: number } | null = null;
  private thermalZonePath: string | null | undefined = undefined;
  private siFallbackTempCelsius: number | null = null;
  private siFallbackCheckedAt = 0;

  public async getDockerHostMetrics(): Promise<DockerHostMetrics> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const loadAvg = os.loadavg();
    const cpuPercent = this.readCpuPercent(cpus);

    const ramPercent = Number(((usedMem / totalMem) * 100).toFixed(1));

    const thermalThrottle = await this.readThermalThrottleVitals();

    return {
      connected: true,
      hostname: os.hostname(),
      ip: this.getLocalIp(),
      cpuPercent,
      ramUsedBytes: usedMem,
      ramTotalBytes: totalMem,
      ramPercent,
      loadAverage: loadAvg.map(n => Number(n.toFixed(2))),
      uptimeSeconds: Math.floor(os.uptime()),
      thermalThrottle,
    };
  }

  /**
   * True CPU busy% from /proc/stat delta between two calls (jiffies since boot,
   * broken down by mode). loadavg is a run-queue length, not utilization, so it
   * diverges under I/O wait; this matches what gopsutil-based tools compute.
   * Falls back to loadavg on platforms without /proc/stat (dev on Windows/macOS).
   */
  private readCpuPercent(cpus: os.CpuInfo[]): number {
    try {
      const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
      const idleTotal = idle + iowait;
      const total = user + nice + system + idleTotal + irq + softirq + steal;

      const prev = this.lastCpuTimes;
      this.lastCpuTimes = { idle: idleTotal, total };

      if (!prev) return 0;

      const idleDelta = idleTotal - prev.idle;
      const totalDelta = total - prev.total;
      if (totalDelta <= 0) return 0;

      return Math.min(100, Math.max(0, Number(((1 - idleDelta / totalDelta) * 100).toFixed(1))));
    } catch {
      const coreCount = cpus.length || 1;
      return Math.min(100, Math.max(0, Number(((os.loadavg()[0] / coreCount) * 100).toFixed(1))));
    }
  }

  private async readThermalThrottleVitals(): Promise<ThermalThrottleVitals> {
    let isThrottling = false;
    let throttleCount = 0;
    let packageTempCelsius = 48.0;
    let fanSpeedPercent = 35;

    try {
      const throttledFile = '/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count';
      if (fs.existsSync(throttledFile)) {
        const val = fs.readFileSync(throttledFile, 'utf8').trim();
        throttleCount = parseInt(val, 10) || 0;
        if (throttleCount > 0) isThrottling = true;
      }
    } catch {
      // Fallback
    }

    const directTemp = this.readCpuTemperatureDirect();
    if (directTemp !== null) {
      packageTempCelsius = directTemp;
    } else {
      // No usable /sys/class/thermal zone (rare, or a non-Linux dev machine) —
      // si.cpuTemperature() shells out on some platforms, so it's only ever
      // called as a fallback here, and throttled rather than run every tick.
      const fallback = await this.readCpuTemperatureViaSiThrottled();
      if (fallback !== null) packageTempCelsius = fallback;
    }

    try {
      const pwmPath = '/sys/class/hwmon/hwmon0/pwm1';
      if (fs.existsSync(pwmPath)) {
        const pwmRaw = parseInt(fs.readFileSync(pwmPath, 'utf8').trim(), 10);
        fanSpeedPercent = Math.round((pwmRaw / 255) * 100);
      }
    } catch {
      // Ignore
    }

    return {
      isThrottling,
      throttleCount,
      packageTempCelsius,
      fanSpeedPercent,
    };
  }

  /**
   * Reads CPU package temp straight from /sys/class/thermal, resolving and caching
   * the right zone once instead of scanning every tick. Millidegree files (`temp`)
   * are a plain integer read — no subprocess, no library overhead — unlike
   * si.cpuTemperature() which probes multiple sensor backends on every call.
   */
  private readCpuTemperatureDirect(): number | null {
    try {
      if (this.thermalZonePath === undefined) {
        this.thermalZonePath = null;
        const base = '/sys/class/thermal';
        if (fs.existsSync(base)) {
          const zones = fs.readdirSync(base).filter(name => name.startsWith('thermal_zone'));
          const preferred = zones.find(zone => {
            try {
              const type = fs.readFileSync(`${base}/${zone}/type`, 'utf8').trim().toLowerCase();
              return type.includes('cpu') || type.includes('x86_pkg_temp') || type.includes('coretemp');
            } catch {
              return false;
            }
          });
          const chosen = preferred || zones[0];
          if (chosen) this.thermalZonePath = `${base}/${chosen}/temp`;
        }
      }

      if (!this.thermalZonePath) return null;
      const raw = parseInt(fs.readFileSync(this.thermalZonePath, 'utf8').trim(), 10);
      if (!Number.isFinite(raw)) return null;
      return raw / 1000;
    } catch {
      this.thermalZonePath = null;
      return null;
    }
  }

  private async readCpuTemperatureViaSiThrottled(): Promise<number | null> {
    const now = Date.now();
    if (now - this.siFallbackCheckedAt < 30000) return this.siFallbackTempCelsius;
    this.siFallbackCheckedAt = now;
    try {
      const tempSensors = await si.cpuTemperature();
      this.siFallbackTempCelsius = tempSensors.main && tempSensors.main > 0 ? tempSensors.main : null;
    } catch {
      this.siFallbackTempCelsius = null;
    }
    return this.siFallbackTempCelsius;
  }

  public async getStorageMatrix(pveStorage?: PveStorageVitals | null): Promise<StorageItem[]> {
    const results: StorageItem[] = [];
    const rootFsStats = this.safeStatfs('/');
    const diskStats = this.readDiskStats();

    for (let i = 0; i < config.storageMounts.length; i++) {
      const mountPath = config.storageMounts[i];
      const stats = this.safeStatfs(mountPath);
      const isExternal = mountPath.startsWith('/mnt/');
      const diskPerf = this.getDiskPerformance(mountPath, diskStats);

      // Handle root filesystem
      if (mountPath === '/') {
        const isExplicitHostFailure = Boolean(
          config.proxmox.tokenId &&
          !config.demoMode &&
          pveStorage &&
          !pveStorage.connected
        );

        if (isExplicitHostFailure) {
          // Fallback: Proxmox API was configured but unreachable
          const totalBytes = stats ? stats.total : 161061273600; // ~150 GB virtual disk
          const usedBytes = stats ? stats.used : 46091173888;
          const freeBytes = stats ? stats.free : totalBytes - usedBytes;
          const usedPercent = Number(((usedBytes / totalBytes) * 100).toFixed(1));

          results.push({
            id: `storage_${mountPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
            mount: '/',
            label: 'LXC 100 Virtual Root (Host API unreachable)',
            filesystem: 'ext4 (LXC virtual root)',
            totalBytes,
            usedBytes,
            freeBytes,
            usedPercent,
            status: 'warning',
            isExternal: false,
            smartStatus: 'UNKNOWN',
            canaryPresent: true,
            isDisconnected: false,
            isPhysicalRoot: false,
            unreachableHostFallback: true,
            ...diskPerf,
          });
          continue;
        }

        if (pveStorage) {
          // Proxmox Physical SSD
          results.push({
            id: `storage_${mountPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
            mount: '/dev/sda (/)',
            label: config.storageLabels[i] || 'Proxmox Physical SSD',
            filesystem: `${pveStorage.physicalDisk.model} · LVM-Thin`,
            totalBytes: pveStorage.totalBytes,
            usedBytes: pveStorage.usedBytes,
            freeBytes: pveStorage.freeBytes,
            usedPercent: pveStorage.usedPercent,
            status: pveStorage.usedPercent > 90 ? 'critical' : pveStorage.usedPercent > 80 ? 'warning' : 'healthy',
            isExternal: false,
            smartStatus: pveStorage.physicalDisk.smartStatus,
            canaryPresent: true,
            isDisconnected: false,
            isPhysicalRoot: true,
            physicalDisk: pveStorage.physicalDisk,
            storagePools: pveStorage.pools,
            allocations: pveStorage.allocations,
            unreachableHostFallback: false,
            ...diskPerf,
          });
          continue;
        }
      }

      // External mounts and other paths
      const label = config.storageLabels[i] || this.autoLabel(mountPath);
      let smartStatus: StorageItem['smartStatus'] = 'PASSED';
      let canaryPresent = true;
      let isDisconnected = false;

      // DAS Canary Check
      if (isExternal) {
        canaryPresent = this.checkCanaryFile(mountPath);
        // Fallthrough check: If statfs has same total size as rootFsStats, the external drive might have dropped!
        const fallsThroughToRoot = rootFsStats && stats && stats.total === rootFsStats.total && !canaryPresent;
        if (fallsThroughToRoot) {
          isDisconnected = true;
        }
      }

      if (stats) {
        const usedPercent = Number(((stats.used / stats.total) * 100).toFixed(1));
        let status: StorageItem['status'] = 'healthy';
        if (usedPercent > 90 || isDisconnected) status = 'critical';
        else if (usedPercent > 80) status = 'warning';

        results.push({
          id: `storage_${mountPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          mount: mountPath,
          label,
          filesystem: isExternal ? 'ext4 (USB-DAS)' : 'ext4 (NVMe)',
          totalBytes: stats.total,
          usedBytes: stats.used,
          freeBytes: stats.free,
          usedPercent,
          status,
          isExternal,
          smartStatus,
          canaryPresent,
          isDisconnected,
          ...diskPerf,
        });
      } else {
        results.push(this.getMockStorageItem(mountPath, label, isExternal, i, pveStorage));
      }
    }

    return results;
  }

  public async getProcesses(): Promise<ProcessMetric[]> {
    try {
      const data = await si.processes();
      const list = data.list
        .slice()
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, PROCESS_LIST_LIMIT);

      const seenPids = new Set<number>();

      const results = list.map((p) => {
        seenPids.add(p.pid);
        const io = this.getProcessIoRates(p.pid);
        return {
          pid: p.pid,
          name: p.name,
          user: p.user || 'unknown',
          command: p.command || p.name,
          cpuPercent: Number((p.cpu || 0).toFixed(1)),
          memBytes: p.memRss || p.mem || 0,
          memPercent: Number((p.mem || 0).toFixed(1)),
          state: p.state || 'sleeping',
          diskReadBytesPerSec: io.readRateBytesPerSec,
          diskWriteBytesPerSec: io.writeRateBytesPerSec,
          source: 'host',
        };
      });

      // Cleanup stale pids
      for (const pid of this.processIoMap.keys()) {
        if (!seenPids.has(pid)) {
          this.processIoMap.delete(pid);
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  private getProcessIoRates(pid: number): { readRateBytesPerSec?: number; writeRateBytesPerSec?: number } {
    try {
      const ioPath = `/proc/${pid}/io`;
      if (!fs.existsSync(ioPath)) return {};
      const content = fs.readFileSync(ioPath, 'utf8');
      const readMatch = content.match(/read_bytes:\s*(\d+)/);
      const writeMatch = content.match(/write_bytes:\s*(\d+)/);
      if (!readMatch || !writeMatch) return {};

      const currentRead = parseInt(readMatch[1], 10);
      const currentWrite = parseInt(writeMatch[1], 10);
      const now = Date.now();

      const prev = this.processIoMap.get(pid);
      this.processIoMap.set(pid, { lastReadBytes: currentRead, lastWriteBytes: currentWrite, lastTimestamp: now });

      if (!prev) return {};

      const elapsedSec = (now - prev.lastTimestamp) / 1000;
      if (elapsedSec <= 0) return {};

      const readRate = Math.max(0, (currentRead - prev.lastReadBytes) / elapsedSec);
      const writeRate = Math.max(0, (currentWrite - prev.lastWriteBytes) / elapsedSec);

      return {
        readRateBytesPerSec: Math.round(readRate),
        writeRateBytesPerSec: Math.round(writeRate),
      };
    } catch {
      return {};
    }
  }

  private readDiskStats(): Map<string, {
    readsCompleted: number;
    sectorsRead: number;
    timeReadingMs: number;
    writesCompleted: number;
    sectorsWritten: number;
    timeWritingMs: number;
    timeIoMs: number;
  }> {
    const map = new Map();
    try {
      if (!fs.existsSync('/proc/diskstats')) return map;
      const content = fs.readFileSync('/proc/diskstats', 'utf8');
      const lines = content.trim().split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 14) continue;
        // key is "major:minor", the same identity fs.statSync(path).dev decodes to —
        // this is how a mount is matched to its row without guessing from the mount path.
        const key = `${parts[0]}:${parts[1]}`;
        map.set(key, {
          readsCompleted: parseInt(parts[3], 10),
          sectorsRead: parseInt(parts[5], 10),
          timeReadingMs: parseInt(parts[6], 10),
          writesCompleted: parseInt(parts[7], 10),
          sectorsWritten: parseInt(parts[9], 10),
          timeWritingMs: parseInt(parts[10], 10),
          timeIoMs: parseInt(parts[12], 10),
        });
      }
    } catch {
      // Ignore
    }
    return map;
  }

  /**
   * Resolves a mount path to its "major:minor" device identity via the standard
   * glibc encoding of st_dev, so /proc/diskstats can be looked up without guessing
   * a device name from the mount path's own folder name. A mount on LVM/device-mapper
   * has its own major:minor with no matching /proc/diskstats row for the physical
   * disk underneath — that's a real "not available" case, not a bug to work around.
   */
  private getDeviceKey(mountPath: string): string | null {
    try {
      const dev = fs.statSync(mountPath, { bigint: true }).dev;
      const major = Number((dev >> 8n) & 0xfffn) | Number((dev >> 32n) & ~0xfffn);
      const minor = Number(dev & 0xffn) | Number((dev >> 12n) & ~0xffn);
      return `${major}:${minor}`;
    } catch {
      return null;
    }
  }

  private getDiskPerformance(mountPath: string, diskStats: Map<string, any>): {
    readRateBytesPerSec?: number;
    writeRateBytesPerSec?: number;
    activeTimePercent?: number;
    avgResponseMs?: number;
    sparklineActiveTime?: number[];
  } {
    try {
      const deviceKey = this.getDeviceKey(mountPath);
      const current = deviceKey ? diskStats.get(deviceKey) : undefined;
      if (!current) {
        // Demo mode (or a platform with no /proc/diskstats, e.g. dev on Windows/macOS)
        // still wants plausible-looking numbers; real mode reports "not available"
        // instead of fabricating a reading for a device it couldn't resolve (LVM/dm).
        return config.demoMode ? this.getSimulatedDiskPerformance(mountPath) : {};
      }

      const now = Date.now();
      const prev = this.diskPerfMap.get(mountPath);

      let readRate = 0;
      let writeRate = 0;
      let activePercent = 0;
      let avgResponse = 0;
      let sparkline: number[] = prev?.sparklineActiveTime || [];

      if (prev) {
        const elapsedSec = (now - prev.lastTimestamp) / 1000;
        if (elapsedSec > 0) {
          const sectorsReadDiff = Math.max(0, current.sectorsRead - prev.lastSectorsRead);
          const sectorsWrittenDiff = Math.max(0, current.sectorsWritten - prev.lastSectorsWritten);
          readRate = (sectorsReadDiff * 512) / elapsedSec;
          writeRate = (sectorsWrittenDiff * 512) / elapsedSec;

          const ioTimeDiffMs = Math.max(0, current.timeIoMs - prev.lastTimeIoMs);
          activePercent = Math.min(100, (ioTimeDiffMs / (elapsedSec * 1000)) * 100);

          const totalOps = Math.max(0, (current.readsCompleted - prev.lastReadsCompleted) + (current.writesCompleted - prev.lastWritesCompleted));
          const totalWaitMs = Math.max(0, (current.timeReadingMs - prev.lastTimeReadingMs) + (current.timeWritingMs - prev.lastTimeWritingMs));
          avgResponse = totalOps > 0 ? totalWaitMs / totalOps : 0;
        }
      }

      sparkline = [...sparkline, activePercent].slice(-20);

      this.diskPerfMap.set(mountPath, {
        lastSectorsRead: current.sectorsRead,
        lastSectorsWritten: current.sectorsWritten,
        lastTimeReadingMs: current.timeReadingMs,
        lastTimeWritingMs: current.timeWritingMs,
        lastReadsCompleted: current.readsCompleted,
        lastWritesCompleted: current.writesCompleted,
        lastTimeIoMs: current.timeIoMs,
        lastTimestamp: now,
        sparklineActiveTime: sparkline,
      });

      return {
        readRateBytesPerSec: Math.round(readRate),
        writeRateBytesPerSec: Math.round(writeRate),
        activeTimePercent: Number(activePercent.toFixed(1)),
        avgResponseMs: Number(avgResponse.toFixed(1)),
        sparklineActiveTime: sparkline,
      };
    } catch {
      return config.demoMode ? this.getSimulatedDiskPerformance(mountPath) : {};
    }
  }

  private getSimulatedDiskPerformance(mountPath: string): {
    readRateBytesPerSec: number;
    writeRateBytesPerSec: number;
    activeTimePercent: number;
    avgResponseMs: number;
    sparklineActiveTime: number[];
  } {
    const prev = this.diskPerfMap.get(mountPath);
    const now = Date.now();
    const seed = mountPath.length;
    const readRate = Math.floor(Math.abs(Math.sin((now / 4000) + seed)) * 15 * 1024 * 1024);
    const writeRate = Math.floor(Math.abs(Math.cos((now / 3500) + seed)) * 8 * 1024 * 1024);
    const activePercent = Number((Math.abs(Math.sin((now / 5000) + seed)) * 18).toFixed(1));
    const avgResponse = Number((0.8 + Math.abs(Math.sin((now / 6000) + seed)) * 2.5).toFixed(1));

    const sparkline = [...(prev?.sparklineActiveTime || [2, 5, 8, 4, 3, 12, 6, 9]), activePercent].slice(-20);

    this.diskPerfMap.set(mountPath, {
      lastSectorsRead: 0,
      lastSectorsWritten: 0,
      lastTimeReadingMs: 0,
      lastTimeWritingMs: 0,
      lastReadsCompleted: 0,
      lastWritesCompleted: 0,
      lastTimeIoMs: 0,
      lastTimestamp: now,
      sparklineActiveTime: sparkline,
    });

    return {
      readRateBytesPerSec: readRate,
      writeRateBytesPerSec: writeRate,
      activeTimePercent: activePercent,
      avgResponseMs: avgResponse,
      sparklineActiveTime: sparkline,
    };
  }

  private autoLabel(mountPath: string): string {
    if (mountPath === '/') return 'NVMe System';
    const base = mountPath.split('/').filter(Boolean).pop() || mountPath;
    return base
      .replace(/^hdd[-_]?/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private checkCanaryFile(mountPath: string): boolean {
    try {
      const canaryPath = `${mountPath}/.mounted`;
      if (fs.existsSync(canaryPath)) return true;
      const contents = fs.readdirSync(mountPath);
      return contents.length > 0;
    } catch {
      return false;
    }
  }

  public safeStatfs(dirPath: string): { total: number; used: number; free: number } | null {
    try {
      if (!fs.existsSync(dirPath)) return null;
      const stat = fs.statfsSync(dirPath);
      const total = stat.blocks * stat.bsize;
      const free = stat.bfree * stat.bsize;
      const used = total - free;

      if (total <= 0) return null;

      return { total, used, free };
    } catch {
      return null;
    }
  }

  private getMockStorageItem(
    mountPath: string,
    label: string,
    isExternal: boolean,
    index: number,
    pveStorage?: PveStorageVitals | null
  ): StorageItem {
    const demoSizesGB = [256, 4000, 8000, 2000, 1000];
    const totalGB = mountPath === '/' ? 256 : demoSizesGB[index % demoSizesGB.length];
    const usedPercent = mountPath === '/' ? 23.8 : 40 + ((index * 17) % 45);

    const totalBytes = mountPath === '/' ? 256060514304 : totalGB * 1024 * 1024 * 1024;
    const usedBytes = Math.floor(totalBytes * (usedPercent / 100));
    const freeBytes = totalBytes - usedBytes;

    if (mountPath === '/' && pveStorage) {
      return {
        id: `storage_${mountPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
        mount: '/dev/sda (/)',
        label: label || 'Proxmox Physical SSD',
        filesystem: `${pveStorage.physicalDisk.model} · LVM-Thin`,
        totalBytes: pveStorage.totalBytes,
        usedBytes: pveStorage.usedBytes,
        freeBytes: pveStorage.freeBytes,
        usedPercent: pveStorage.usedPercent,
        status: pveStorage.usedPercent > 90 ? 'critical' : pveStorage.usedPercent > 80 ? 'warning' : 'healthy',
        isExternal: false,
        smartStatus: pveStorage.physicalDisk.smartStatus,
        canaryPresent: true,
        isDisconnected: false,
        isPhysicalRoot: true,
        physicalDisk: pveStorage.physicalDisk,
        storagePools: pveStorage.pools,
        allocations: pveStorage.allocations,
        unreachableHostFallback: false,
      };
    }

    return {
      id: `storage_${mountPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
      mount: mountPath === '/' ? '/dev/sda (/)' : mountPath,
      label,
      filesystem: isExternal ? 'ext4 (USB-DAS)' : 'MidasForce SSD 256GB · LVM-Thin',
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent,
      status: usedPercent > 90 ? 'critical' : usedPercent > 80 ? 'warning' : 'healthy',
      isExternal,
      smartStatus: 'PASSED',
      canaryPresent: true,
      isDisconnected: false,
      isPhysicalRoot: mountPath === '/',
    };
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
}
