import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { BackupRunResult, BackupStatus } from '../types.js';
import { auditLogService } from './audit-log.service.js';

const execFile = promisify(execFileCb);
const EXEC_OPTS = { timeout: 30 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config import is meant for a handful of small JSON files, never fleet data.
const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const IMPORT_ALLOWED_FILES = ['pins.json', 'git-projects.json'];

export interface ImportConfigResult {
  success: boolean;
  message: string;
  imported: string[];
}

export class BackupService {
  private statusPath: string;
  private dataDir: string;
  private status: { backup?: BackupRunResult; restore?: BackupRunResult };
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.dataDir = path.resolve(__dirname, '../../../data');
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch {
        // fallback
      }
    }
    this.statusPath = path.join(this.dataDir, 'backup-status.json');
    this.status = this.loadStatus();
  }

  private loadStatus(): { backup?: BackupRunResult; restore?: BackupRunResult } {
    try {
      if (fs.existsSync(this.statusPath)) {
        return JSON.parse(fs.readFileSync(this.statusPath, 'utf-8'));
      }
    } catch (err) {
      console.error('[BackupService] Error reading status:', err);
    }
    return {};
  }

  private saveStatus() {
    try {
      fs.writeFileSync(this.statusPath, JSON.stringify(this.status, null, 2), 'utf-8');
    } catch (err) {
      console.error('[BackupService] Error writing status:', err);
    }
  }

  public isConfigured(): boolean {
    return Boolean(config.backup.rcloneRemote);
  }

  public getStatus(): BackupStatus {
    return {
      configured: this.isConfigured(),
      sourcePaths: config.backup.sourcePaths,
      backup: this.status.backup,
      restore: this.status.restore,
    };
  }

  public start() {
    if (config.backup.intervalHours <= 0 || !this.isConfigured()) return;
    const intervalMs = config.backup.intervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      this.runBackup().catch(() => {});
    }, intervalMs);
    console.log(`[BackupService] Scheduled backup every ${config.backup.intervalHours}h`);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runBackup(): Promise<BackupRunResult> {
    const result = await this.runSync('backup');
    this.logRun('Backup', result);
    this.status.backup = result;
    this.saveStatus();
    return result;
  }

  public async runRestore(): Promise<BackupRunResult> {
    const result = await this.runSync('restore');
    this.logRun('Restore', result);
    this.status.restore = result;
    this.saveStatus();
    return result;
  }

  private logRun(label: string, result: BackupRunResult) {
    const seconds = Math.round(result.lastDurationMs / 1000);
    auditLogService.log(
      'backup',
      result.lastResult === 'success' ? 'info' : 'error',
      result.lastResult === 'success' ? `${label} completed in ${seconds}s` : `${label} failed after ${seconds}s`,
      { detail: result.lastError },
    );
  }

  private async runSync(direction: 'backup' | 'restore'): Promise<BackupRunResult> {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { lastRunAt: new Date().toISOString(), lastResult: 'failed', lastError: 'No rclone remote configured', lastDurationMs: 0 };
    }

    try {
      for (const sourcePath of config.backup.sourcePaths) {
        const remotePath = `${config.backup.rcloneRemote}/${path.basename(sourcePath)}`;
        const [from, to] = direction === 'backup' ? [sourcePath, remotePath] : [remotePath, sourcePath];
        await execFile('rclone', ['sync', from, to], EXEC_OPTS);
      }
      return { lastRunAt: new Date().toISOString(), lastResult: 'success', lastDurationMs: Date.now() - start };
    } catch (err: any) {
      return {
        lastRunAt: new Date().toISOString(),
        lastResult: 'failed',
        lastError: err.message || 'rclone sync failed',
        lastDurationMs: Date.now() - start,
      };
    }
  }

  /**
   * Restores only data/pins.json and data/git-projects.json from a small zip
   * fetched from a public link (a Google Drive share link is rewritten to a
   * direct-download URL; anything else is used as-is). Never touches
   * data/auth.json — importing someone else's or a stale one could lock the
   * owner out of their own dashboard.
   */
  public async importConfig(url: string): Promise<ImportConfigResult> {
    const downloadUrl = this.toDirectDownloadUrl(url);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-import-'));
    const tmpZip = path.join(tmpDir, 'import.zip');

    try {
      const res = await fetch(downloadUrl, { redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of res.body as any) {
        totalBytes += chunk.length;
        if (totalBytes > IMPORT_MAX_BYTES) {
          throw new Error(`File is larger than ${IMPORT_MAX_BYTES / (1024 * 1024)}MB — this should only hold config`);
        }
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length < 2 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw new Error('That link did not return a zip file');
      }
      fs.writeFileSync(tmpZip, buffer);

      // Only these two filenames are ever extracted — anything else in the
      // archive, path-traversal entries included, is simply never touched.
      await execFile('unzip', ['-o', '-j', tmpZip, ...IMPORT_ALLOWED_FILES, '-d', tmpDir], EXEC_OPTS).catch(() => {
        // unzip exits non-zero when some requested members aren't present;
        // that's fine as long as at least one of them was extracted.
      });

      const imported: string[] = [];
      for (const filename of IMPORT_ALLOWED_FILES) {
        const extracted = path.join(tmpDir, filename);
        if (fs.existsSync(extracted)) {
          fs.copyFileSync(extracted, path.join(this.dataDir, filename));
          imported.push(filename);
        }
      }

      if (imported.length === 0) {
        throw new Error('The zip did not contain pins.json or git-projects.json');
      }

      return { success: true, message: `Imported ${imported.join(', ')}.`, imported };
    } catch (err: any) {
      return { success: false, message: err.message || 'Import failed', imported: [] };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private toDirectDownloadUrl(url: string): string {
    const match = url.match(/\/file\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/);
    if (match && url.includes('drive.google.com')) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    return url;
  }
}
