import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { auditLogService } from './audit-log.service.js';
import { DiskScanState, DiskScanTarget, DiskTreeNode } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files per directory beyond this rank are rolled up into a single
// "(N more files)" leaf so a folder with tens of thousands of small files
// (e.g. manga-raw, Nextcloud chunks) doesn't blow up the JSON payload sent
// to the browser. Directory totals are always summed from the FULL gdu
// output before trimming, so displayed sizes stay accurate even though the
// file listing itself is capped.
const MAX_FILES_PER_DIR = 40;

// gdu's ncdu-compatible export: [majorVer, minorVer, header, [rootDirArray]]
// where a dir array is [dirInfo, ...entries] and entries are either file
// objects or nested dir arrays.
interface GduFileEntry {
  name: string;
  asize?: number;
  dsize?: number;
  notreadable?: boolean;
  ignored?: boolean;
}
type GduDirArray = [GduFileEntry, ...(GduFileEntry | GduDirArray)[]];

function isDirArray(entry: GduFileEntry | GduDirArray): entry is GduDirArray {
  return Array.isArray(entry);
}

function parseGduTree(dirArray: GduDirArray, parentPath: string): DiskTreeNode {
  const info = dirArray[0];
  const entries = dirArray.slice(1) as (GduFileEntry | GduDirArray)[];
  const nodePath = parentPath ? `${parentPath}/${info.name}` : info.name;

  const files: DiskTreeNode[] = [];
  const dirs: DiskTreeNode[] = [];
  let sizeBytes = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (isDirArray(entry)) {
      const child = parseGduTree(entry, nodePath);
      dirs.push(child);
      sizeBytes += child.sizeBytes;
      fileCount += child.fileCount;
    } else if (!entry.ignored) {
      const size = entry.dsize ?? entry.asize ?? 0;
      sizeBytes += size;
      fileCount += 1;
      files.push({
        name: entry.name,
        path: `${nodePath}/${entry.name}`,
        sizeBytes: size,
        type: 'file',
        fileCount: 1,
        children: [],
      });
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes);
  dirs.sort((a, b) => b.sizeBytes - a.sizeBytes);

  let visibleFiles = files;
  const extraCount = files.length - MAX_FILES_PER_DIR;
  if (extraCount > 0) {
    const kept = files.slice(0, MAX_FILES_PER_DIR);
    const rolledUpSize = files.slice(MAX_FILES_PER_DIR).reduce((sum, f) => sum + f.sizeBytes, 0);
    visibleFiles = [
      ...kept,
      {
        name: `(${extraCount} more files)`,
        path: `${nodePath}/__rollup__`,
        sizeBytes: rolledUpSize,
        type: 'rollup',
        fileCount: extraCount,
        children: [],
      },
    ];
  }

  return {
    name: info.name,
    path: nodePath,
    sizeBytes,
    type: 'dir',
    fileCount,
    children: [...dirs, ...visibleFiles],
  };
}

interface ScanJob {
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  proc?: ReturnType<typeof spawn>;
}

/**
 * On-demand directory-tree scanner backing the Disk Usage Explorer.
 *
 * Deliberately NOT part of the CollectorService poll loop — a full
 * recursive walk of a multi-TB spinning HDD takes minutes and hammers the
 * disk. It only ever runs when the owner clicks Scan, one mount at a time
 * (serialized queue below), so it can never turn into the kind of constant
 * background overhead that spiked host CPU to 65% back on 2026-09-15.
 */
export class DiskScanService {
  private jobs: Map<string, ScanJob> = new Map();
  private cache: Map<string, { tree: DiskTreeNode; scannedAt: number; elapsedMs: number }> = new Map();
  private queue: string[] = [];
  private cacheDir: string;

  constructor() {
    this.cacheDir = path.resolve(__dirname, '../../../data/disk-scan-cache');
    if (!fs.existsSync(this.cacheDir)) {
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } catch {
        // fallback
      }
    }
    this.loadCacheFromDisk();
  }

  public getTargets(): DiskScanTarget[] {
    return config.storageMounts.map((mount, i) => ({
      id: this.mountId(mount),
      mount,
      label: config.storageLabels[i] || (mount === '/' ? 'Root SSD' : mount.split('/').pop() || mount),
      isExternal: mount.startsWith('/mnt/'),
    }));
  }

  private mountId(mount: string): string {
    return mount.replace(/[^a-zA-Z0-9]/g, '_') || 'root';
  }

  private cacheFile(id: string): string {
    return path.join(this.cacheDir, `${id}.json`);
  }

  private loadCacheFromDisk() {
    for (const target of this.getTargets()) {
      try {
        const file = this.cacheFile(target.id);
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
          this.cache.set(target.id, raw);
        }
      } catch {
        // ignore corrupt cache entry, just means no cached tree yet
      }
    }
  }

  public getStatus(id: string): DiskScanState {
    const job = this.jobs.get(id);
    const cached = this.cache.get(id);
    if (job && job.status === 'running') {
      return { status: 'running', startedAt: job.startedAt, queuePosition: this.queuePosition(id) };
    }
    if (job && job.status === 'error') {
      return { status: 'error', error: job.error, scannedAt: cached?.scannedAt };
    }
    if (cached) {
      return { status: 'done', scannedAt: cached.scannedAt, elapsedMs: cached.elapsedMs };
    }
    return { status: 'idle' };
  }

  private queuePosition(id: string): number {
    const idx = this.queue.indexOf(id);
    return idx === -1 ? 0 : idx;
  }

  public getTree(id: string): DiskTreeNode | null {
    return this.cache.get(id)?.tree ?? null;
  }

  public startScan(id: string): DiskScanState {
    const target = this.getTargets().find((t) => t.id === id);
    if (!target) {
      throw new Error('Unknown scan target');
    }
    const existing = this.jobs.get(id);
    if (existing && existing.status === 'running') {
      return this.getStatus(id);
    }
    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
    this.jobs.set(id, { status: 'running', startedAt: Date.now() });
    this.pump();
    return this.getStatus(id);
  }

  // Only one gdu process runs at a time across ALL mounts. These HDDs share
  // a single USB/SATA controller that's already flaky (see docs/decisions.md
  // 2026-09 hdd-music entries) — hammering it with parallel scans is asking
  // for another dropout, and it wouldn't be faster anyway since they're
  // spinning disks, not SSDs.
  private runningId: string | null = null;

  private pump() {
    if (this.runningId) return;
    const nextId = this.queue.shift();
    if (!nextId) return;
    this.runningId = nextId;
    void this.runScan(nextId);
  }

  private async runScan(id: string) {
    const target = this.getTargets().find((t) => t.id === id)!;
    const startedAt = Date.now();
    const tmpFile = path.join(os.tmpdir(), `diskscan-${id}-${startedAt}.json`);

    try {
      await this.execGdu(target.mount, tmpFile);
      const raw = fs.readFileSync(tmpFile, 'utf-8');
      const parsed = JSON.parse(raw);
      // parsed = [majorVer, minorVer, header, rootDirArray]
      const rootDirArray: GduDirArray = parsed[3];
      const tree = parseGduTree(rootDirArray, path.dirname(target.mount));
      const elapsedMs = Date.now() - startedAt;
      const entry = { tree, scannedAt: Date.now(), elapsedMs };
      this.cache.set(id, entry);
      this.jobs.set(id, { status: 'done', startedAt, finishedAt: Date.now() });
      try {
        fs.writeFileSync(this.cacheFile(id), JSON.stringify(entry));
      } catch {
        // non-fatal, tree still usable from memory for this process lifetime
      }
      auditLogService.log('storage', 'info', `Disk usage scan completed: ${target.label}`, {
        detail: `${target.mount} — ${(tree.sizeBytes / 1e9).toFixed(1)} GB across ${tree.fileCount} files, took ${(elapsedMs / 1000).toFixed(0)}s`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.jobs.set(id, { status: 'error', startedAt, error: message });
      auditLogService.log('storage', 'error', `Disk usage scan failed: ${target.label}`, {
        detail: message,
      });
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // already gone or never created
      }
      this.runningId = null;
      this.pump();
    }
  }

  private execGdu(mountPath: string, outFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // -n non-interactive, -p no progress spam in logs, -c no-color,
      // --sequential is gentler on spinning disks than gdu's default
      // parallel walk, -m 2 caps CPU use to 2 cores so a scan never starves
      // the rest of the dashboard's own event loop or other containers.
      const proc = spawn('gdu', ['-npc', '--sequential', '-m', '2', '-o', outFile, mountPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `gdu exited with code ${code}`));
        }
      });
    });
  }
}
