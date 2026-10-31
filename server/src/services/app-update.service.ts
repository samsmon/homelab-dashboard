import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { AppUpdateStatus, AppUpdateState, UpdateAnnouncement, AppVersionInfo } from '../types.js';
import { NotificationsService } from './notifications.service.js';
import { auditLogService } from './audit-log.service.js';

const execFile = promisify(execFileCb);
const MAX_UPDATE_LOG_LINES = 500;
const EXEC_OPTS = { timeout: 10 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GithubCommit {
  sha: string;
  html_url?: string;
  commit: {
    message: string;
    committer?: {
      date?: string;
    };
  };
}

export class AppUpdateService {
  private repoRoot: string;
  private isGitRepo: boolean = false;
  private dataDir: string;
  private repoOwner: string = 'srytmj';
  private repoName: string = 'homelab-dashboard';
  private branch: string = 'main';
  private repoUrl: string = 'https://github.com/srytmj/homelab-dashboard';

  private version: string = '1.1.0';
  private currentSha: string = 'unknown';
  private currentCommitDate?: string;
  private currentCommitSubject?: string;

  private latestSha?: string;
  private latestCommitDate?: string;
  private latestCommitMessage?: string;
  private hasUpdate: boolean = false;
  private behindBy: number = 0;
  private announcement?: UpdateAnnouncement;
  private recentCommits: Array<{ sha: string; message: string; date?: string }> = [];
  private lastCheckedAt: number = 0;

  private updateState: AppUpdateState = {
    status: 'idle',
    log: [],
  };

  constructor(private notifications: NotificationsService) {
    this.dataDir = path.resolve(__dirname, "../../../data");
    if (!fs.existsSync(this.dataDir)) {
      try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
    }
    this.repoRoot = this.detectRepoRoot();
    this.isGitRepo = fs.existsSync(path.join(this.repoRoot, '.git'));
    this.loadBaselineVersion();
    this.inspectLocalRepo().catch((err) => {
      console.warn('[AppUpdateService] Initial git inspect warning:', err.message);
    });
  }

  private detectRepoRoot(): string {
    const candidates = [
      process.env.APP_ROOT,
      path.resolve(__dirname, '../../..'),
      path.resolve(__dirname, '../..'),
      process.cwd(),
      '/projects/homelab-dashboard',
      '/app',
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      if (fs.existsSync(path.join(c, '.git'))) {
        return c;
      }
    }

    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'package.json'))) {
        return c;
      }
    }

    return process.cwd();
  }

  private loadBaselineVersion() {
    // 1. Try package.json as fallback base
    const pkgFile = path.join(this.repoRoot, 'package.json');
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
        if (pkg.version) this.version = pkg.version;
      } catch {
        // ignore
      }
    }

    // 2. Try announcements.json for initial announcement & baseline sha
    const announceFile = path.join(this.repoRoot, 'announcements.json');
    if (fs.existsSync(announceFile)) {
      try {
        const aData = JSON.parse(fs.readFileSync(announceFile, 'utf-8'));
        if (Array.isArray(aData) && aData.length > 0) {
          const top = aData[0];
          if (top.version) this.version = top.version;
          if (top.commitSha && this.currentSha === 'unknown') {
            this.currentSha = top.commitSha;
          }
          this.announcement = {
            id: top.id || 'initial',
            version: top.version,
            title: top.title,
            date: top.date,
            description: top.description,
            highlights: top.highlights || [],
            commitSha: top.commitSha,
            commitUrl: top.commitUrl || (top.commitSha ? `${this.repoUrl}/commit/${top.commitSha}` : undefined),
          };
        }
      } catch {
        // ignore
      }
    }

    // 3. Try version.json (highest precedence)
    const versionFile = path.join(this.repoRoot, 'version.json');
    if (fs.existsSync(versionFile)) {
      try {
        const vData = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
        if (vData.version) this.version = vData.version;
        if (vData.commitSha) this.currentSha = vData.commitSha;
        if (vData.branch) this.branch = vData.branch;
        if (vData.date) this.currentCommitDate = vData.date;
      } catch {
        // ignore
      }
    }
  }

  private async inspectLocalRepo() {
    if (!this.isGitRepo) {
      console.log(`[AppUpdateService] No local .git at ${this.repoRoot}, running on static version baseline v${this.version} (${this.currentSha.slice(0, 7)})`);
      return;
    }

    try {
      const { stdout: headOut } = await execFile('git', ['-C', this.repoRoot, 'rev-parse', 'HEAD'], EXEC_OPTS);
      this.currentSha = headOut.trim();

      const { stdout: branchOut } = await execFile('git', ['-C', this.repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], EXEC_OPTS);
      const detectedBranch = branchOut.trim();
      if (detectedBranch && detectedBranch !== 'HEAD') {
        this.branch = detectedBranch;
      }

      const { stdout: dateOut } = await execFile('git', ['-C', this.repoRoot, 'log', '-1', '--format=%cd', '--date=iso'], EXEC_OPTS);
      this.currentCommitDate = dateOut.trim();

      const { stdout: subjOut } = await execFile('git', ['-C', this.repoRoot, 'log', '-1', '--format=%s'], EXEC_OPTS);
      this.currentCommitSubject = subjOut.trim();

      const { stdout: remoteOut } = await execFile('git', ['-C', this.repoRoot, 'remote', 'get-url', 'origin'], EXEC_OPTS);
      const remote = remoteOut.trim();
      const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
      if (match) {
        this.repoOwner = match[1];
        this.repoName = match[2];
        this.repoUrl = `https://github.com/${this.repoOwner}/${this.repoName}`;
      }
    } catch (err: any) {
      console.warn('[AppUpdateService] Git inspection failed:', err.message);
    }
  }

  public getVersionInfo(): AppVersionInfo {
    return {
      version: this.version,
      commitSha: this.currentSha,
      branch: this.branch,
      buildDate: this.currentCommitDate,
    };
  }

  public getStatus(): AppUpdateStatus {
    const isStale = !this.lastCheckedAt || Date.now() - this.lastCheckedAt > config.githubCheckIntervalMs;
    if (isStale) {
      this.checkForUpdates().catch(() => {});
    }

    return {
      repoUrl: this.repoUrl,
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      branch: this.branch,
      currentSha: this.currentSha,
      currentCommitDate: this.currentCommitDate,
      currentCommitSubject: this.currentCommitSubject,
      latestSha: this.latestSha,
      latestCommitDate: this.latestCommitDate,
      latestCommitMessage: this.latestCommitMessage,
      hasUpdate: this.hasUpdate,
      behindBy: this.behindBy,
      announcement: this.announcement,
      recentCommits: this.recentCommits,
      lastCheckedAt: this.lastCheckedAt,
      updateState: this.updateState,
    };
  }

  public getUpdateState(): AppUpdateState {
    const statusFile = path.join(this.dataDir, 'redeploy-status.json');
    const logFile = path.join(this.dataDir, 'redeploy.log');

    // Merge external out-of-process redeployer logs if available
    if (fs.existsSync(logFile)) {
      try {
        const rawLog = fs.readFileSync(logFile, 'utf-8');
        const lines = rawLog.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
        if (lines.length > 0) {
          this.updateState.log = lines.slice(-MAX_UPDATE_LOG_LINES);
        }
      } catch {}
    }

    if (fs.existsSync(statusFile)) {
      try {
        const rawStatus = fs.readFileSync(statusFile, 'utf-8');
        const parsed = JSON.parse(rawStatus);
        if (parsed.status && (parsed.project === 'homelab-dashboard' || parsed.project === 'homelab-cockpit')) {
          this.updateState.status = parsed.status;
          if (parsed.error) this.updateState.message = parsed.error;
          if (parsed.status === 'success') {
            this.hasUpdate = false;
            this.behindBy = 0;
            if (parsed.sha && parsed.sha !== 'unknown') {
              this.currentSha = parsed.sha;
            }
            this.loadBaselineVersion();
          }
        }
      } catch {}
    }

    return this.updateState;
  }

  public async checkForUpdates(force: boolean = false): Promise<AppUpdateStatus> {
    this.lastCheckedAt = Date.now();
    if (this.isGitRepo) {
      try {
        await execFile('git', ['-C', this.repoRoot, 'fetch', 'origin', this.branch], EXEC_OPTS);
      } catch (err: any) {
        console.warn('[AppUpdateService] git fetch warning during update check:', err.message);
      }
      await this.inspectLocalRepo();
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (config.githubToken) {
        headers.Authorization = `token ${config.githubToken}`;
      }

      // Fetch latest commits
      const commitsUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits?sha=${this.branch}&per_page=30`;
      const res = await fetch(commitsUrl, { headers });
      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}`);
      }

      const commits = (await res.json()) as GithubCommit[];
      if (Array.isArray(commits) && commits.length > 0) {
        const latest = commits[0];
        this.latestSha = latest.sha;
        this.latestCommitDate = latest.commit.committer?.date;
        this.latestCommitMessage = latest.commit.message.split('\n')[0];

        // Fetch remote announcement early so we can compare version semantically
        let announcementsData: UpdateAnnouncement[] = [];
        try {
          const rawAnnounceUrl = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/${this.branch}/announcements.json`;
          const announceRes = await fetch(rawAnnounceUrl);
          if (announceRes.ok) {
            announcementsData = (await announceRes.json()) as UpdateAnnouncement[];
          }
        } catch {
          // ignore network failure for raw announcements
        }

        if (announcementsData.length === 0) {
          const localAnnouncePath = path.join(this.repoRoot, 'announcements.json');
          if (fs.existsSync(localAnnouncePath)) {
            try {
              announcementsData = JSON.parse(fs.readFileSync(localAnnouncePath, 'utf-8'));
            } catch {
              // ignore json parse error
            }
          }
        }

        const topAnnouncement = announcementsData[0];
        const remoteVersion = topAnnouncement?.version;

        // Check if current SHA matches any of the remote commits
        const currentIndex = commits.findIndex(
          (c) =>
            (this.currentSha !== 'unknown' &&
              (c.sha.startsWith(this.currentSha) || this.currentSha.startsWith(c.sha)))
        );

        if (currentIndex === 0) {
          // User is exactly at the latest commit
          this.hasUpdate = false;
          this.behindBy = 0;
        } else if (currentIndex > 0) {
          // User is on a known earlier commit
          this.hasUpdate = true;
          this.behindBy = currentIndex;
        } else {
          // Current SHA not found in top commits (e.g. diverged local commit or older)
          if (this.isGitRepo) {
            try {
              const { stdout: revCount } = await execFile(
                'git',
                ['-C', this.repoRoot, 'rev-list', '--count', `HEAD..origin/${this.branch}`],
                EXEC_OPTS
              );
              const count = parseInt(revCount.trim(), 10);
              const isDifferentSha = Boolean(
                this.latestSha &&
                this.currentSha !== 'unknown' &&
                !this.latestSha.startsWith(this.currentSha) &&
                !this.currentSha.startsWith(this.latestSha)
              );
              this.hasUpdate = count > 0 || isDifferentSha;
              this.behindBy = count > 0 ? count : (isDifferentSha ? 1 : 0);
            } catch {
              const isDifferentSha = Boolean(
                this.latestSha &&
                this.currentSha !== 'unknown' &&
                !this.latestSha.startsWith(this.currentSha) &&
                !this.currentSha.startsWith(this.latestSha)
              );
              this.hasUpdate = isDifferentSha;
              this.behindBy = this.hasUpdate ? 1 : 0;
            }
          } else {
            const isDifferentSha = Boolean(
              this.latestSha &&
              this.currentSha !== 'unknown' &&
              !this.latestSha.startsWith(this.currentSha) &&
              !this.currentSha.startsWith(this.latestSha)
            );
            this.hasUpdate = isDifferentSha;
            this.behindBy = this.hasUpdate ? 1 : 0;
          }
        }

        this.recentCommits = commits.slice(0, 10).map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          date: c.commit.committer?.date,
        }));

        if (topAnnouncement) {
          this.announcement = {
            id: topAnnouncement.id || this.latestSha,
            version: topAnnouncement.version,
            title: topAnnouncement.title,
            date: topAnnouncement.date || this.latestCommitDate || new Date().toISOString(),
            description: topAnnouncement.description,
            highlights: topAnnouncement.highlights || [],
            commitSha: topAnnouncement.commitSha || this.latestSha,
            commitUrl: topAnnouncement.commitUrl || (topAnnouncement.commitSha ? `${this.repoUrl}/commit/${topAnnouncement.commitSha}` : undefined),
          };
        } else {
          // Synthesize announcement from latest commit messages
          const lines = latest.commit.message.split('\n');
          const title = lines[0].trim();
          const desc =
            lines
              .slice(1)
              .map((l) => l.trim())
              .filter(Boolean)
              .join(' ') || 'Pembaruan baru telah dipublikasikan ke repository.';
          const highlights = commits
            .slice(0, Math.min(this.behindBy || 3, 5))
            .map((c) => c.commit.message.split('\n')[0].trim());

          this.announcement = {
            id: this.latestSha,
            title: title || 'Pembaruan Tersedia',
            date: latest.commit.committer?.date || new Date().toISOString(),
            description: desc,
            highlights: highlights.length > 0 ? highlights : [title],
            commitSha: this.latestSha,
            commitUrl: latest.html_url || `${this.repoUrl}/commit/${this.latestSha}`,
          };
        }
      }
    } catch (err: any) {
      console.warn(`[AppUpdateService] Check failed for ${this.repoOwner}/${this.repoName}:`, err.message);
    }

    return this.getStatus();
  }

  public startUpdate(): { started: boolean; message?: string } {
    if (this.updateState.status === 'updating') {
      return { started: false, message: 'Update sedang berjalan. Mohon tunggu proses selesai.' };
    }

    this.updateState = {
      status: 'updating',
      log: [
        `[${new Date().toISOString()}] Memulai pipeline pembaruan Homelab Dashboard...`,
        'ℹ Memicu out-of-process redeployer via trigger file & background runner...',
      ],
      startedAt: Date.now(),
    };

    const triggerFile = path.join(this.dataDir, '.redeploy-trigger');
    const statusFile = path.join(this.dataDir, 'redeploy-status.json');
    const logFile = path.join(this.dataDir, 'redeploy.log');

    try {
      fs.writeFileSync(triggerFile, 'homelab-dashboard', 'utf-8');
      fs.writeFileSync(
        statusFile,
        JSON.stringify(
          {
            status: 'updating',
            project: 'homelab-dashboard',
            startedAt: Date.now(),
          },
          null,
          2
        ),
        'utf-8'
      );
      fs.writeFileSync(
        logFile,
        `[${new Date().toISOString()}] Dashboard triggered redeploy. Waiting for runner...
`,
        'utf-8'
      );
    } catch (err: any) {
      console.error('[AppUpdateService] Failed to write trigger files:', err.message);
    }

    // Try to trigger detached host script if available
    const scriptCandidates = [
      '/root/homelab-redeploy.sh',
      path.join(this.repoRoot, 'scripts/homelab-redeploy.sh'),
      '/projects/homelab-dashboard/scripts/homelab-redeploy.sh',
    ];

    let runnerSpawned = false;
    for (const sPath of scriptCandidates) {
      if (fs.existsSync(sPath)) {
        try {
          const child = spawn('bash', [sPath, 'homelab-dashboard'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          runnerSpawned = true;
          console.log(`[AppUpdateService] Spawned detached redeployer: ${sPath}`);
          break;
        } catch (e: any) {
          console.warn(`[AppUpdateService] Could not spawn ${sPath}:`, e.message);
        }
      }
    }

    // Fallback: internal update if git repo exists and no runner could be spawned
    if (!runnerSpawned && this.isGitRepo) {
      this.performUpdate().catch(() => {});
    }

    this.notifications.add('app-update-start', 'Memulai pembaruan Homelab Dashboard...');
    auditLogService.log('app-update', 'info', 'Dashboard update started', { detail: runnerSpawned ? 'out-of-process runner' : 'in-process update' });
    return { started: true };
  }

  private async performUpdate(): Promise<void> {
    this.updateState = {
      status: 'updating',
      log: [],
      startedAt: Date.now(),
    };

    const appendLog = (line: string) => {
      this.updateState.log.push(line);
      if (this.updateState.log.length > MAX_UPDATE_LOG_LINES) {
        this.updateState.log.splice(0, this.updateState.log.length - MAX_UPDATE_LOG_LINES);
      }
    };

    try {
      // Check for local modifications and stash if necessary to prevent merge conflicts
      try {
        const { stdout: statusOut } = await execFile('git', ['-C', this.repoRoot, 'status', '--porcelain'], EXEC_OPTS);
        if (statusOut.trim()) {
          appendLog('$ git stash');
          appendLog('ℹ Menemukan perubahan file lokal. Menyimpan sementara via stash...');
          await this.spawnCapture('git', ['-C', this.repoRoot, 'stash'], this.repoRoot, appendLog);
        }
      } catch {
        // ignore stash errors
      }

      appendLog(`[1/4] Menarik commit terbaru dari origin/${this.branch}...`);
      appendLog(`$ git fetch origin ${this.branch}`);
      await this.spawnCapture('git', ['-C', this.repoRoot, 'fetch', 'origin', this.branch], this.repoRoot, appendLog);

      appendLog(`$ git pull --rebase origin ${this.branch}`);
      try {
        await this.spawnCapture('git', ['-C', this.repoRoot, 'pull', '--rebase', 'origin', this.branch], this.repoRoot, appendLog);
      } catch {
        appendLog('ℹ Terdeteksi divergensi commit lokal. Melakukan sinkronisasi bersih ke origin...');
        try {
          await this.spawnCapture('git', ['-C', this.repoRoot, 'rebase', '--abort'], this.repoRoot, () => {});
        } catch {}
        await this.spawnCapture('git', ['-C', this.repoRoot, 'reset', '--hard', `origin/${this.branch}`], this.repoRoot, appendLog);
      }

      const { stdout: headOut } = await execFile('git', ['-C', this.repoRoot, 'rev-parse', 'HEAD'], EXEC_OPTS);
      const newSha = headOut.trim();
      appendLog(`Checked out HEAD at ${newSha.slice(0, 7)}.`);

      appendLog('[2/4] Memeriksa & menginstall dependensi npm...');
      appendLog('$ npm install --include=dev');
      await this.spawnCapture('npm', ['install', '--include=dev'], this.repoRoot, appendLog);

      appendLog('[3/4] Membangun frontend dan backend (npm run build)...');
      appendLog('$ npm run build');
      await this.spawnCapture('npm', ['run', 'build'], this.repoRoot, appendLog);

      appendLog('[4/4] Memperbarui status versi...');
      this.currentSha = newSha;
      this.hasUpdate = false;
      this.behindBy = 0;

      // Reload baseline version if version.json updated
      this.loadBaselineVersion();

      appendLog(`✓ Berhasil! Homelab Dashboard kini berjalan di commit ${newSha.slice(0, 7)}.`);
      appendLog('Aset web telah diperbarui dan siap digunakan.');

      this.updateState.status = 'success';
      this.updateState.finishedAt = Date.now();
      this.notifications.add('app-update-success', `Homelab Dashboard berhasil diupdate ke versi ${newSha.slice(0, 7)}!`);
      auditLogService.log('app-update', 'info', `Dashboard updated to ${newSha.slice(0, 7)}`);
    } catch (err: any) {
      const msg = err.message || 'Proses update gagal.';
      appendLog(`✕ Gagal: ${msg}`);
      this.updateState.status = 'failed';
      this.updateState.message = msg;
      this.updateState.finishedAt = Date.now();
      this.notifications.add('app-update-failed', `Pembaruan Homelab Dashboard gagal: ${msg}`);
      auditLogService.log('app-update', 'error', 'Dashboard update failed', { detail: msg });
    }
  }

  private spawnCapture(cmd: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const extraPaths = [
        path.join(this.repoRoot, 'node_modules', '.bin'),
        path.join(this.repoRoot, 'client', 'node_modules', '.bin'),
        path.join(this.repoRoot, 'server', 'node_modules', '.bin'),
      ].join(':');

      const env = {
        ...process.env,
        NODE_ENV: 'development',
        PATH: `${extraPaths}:${process.env.PATH || ''}`,
      };

      const child = spawn(cmd, args, { cwd, env, timeout: EXEC_OPTS.timeout });
      const pipe = (stream: NodeJS.ReadableStream) => {
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const clean = line.replace(/\r/g, '').trimEnd();
            if (clean) onLine(clean);
          }
        });
        stream.on('end', () => {
          const clean = buffer.replace(/\r/g, '').trim();
          if (clean) onLine(clean);
        });
      };

      if (child.stdout) pipe(child.stdout);
      if (child.stderr) pipe(child.stderr);

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command '${cmd} ${args.join(' ')}' exited with code ${code}`));
        }
      });
    });
  }
}
