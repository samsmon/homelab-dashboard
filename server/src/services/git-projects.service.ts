import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Client as SshClient } from 'ssh2';
import { config, SshTargetConfig } from '../config.js';
import { GitProjectStatus, GitPullState } from '../types.js';
import { NotificationsService } from './notifications.service.js';

const execFile = promisify(execFileCb);
const MAX_PULL_LOG_LINES = 400;

/** Anything that can be told to stop — a local child process or a remote SSH exec stream. */
interface Killable {
  kill(): void;
}

/** Single-quotes a value for safe inclusion in a POSIX shell command string (used for SSH exec). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRemoteCommand(cwd: string, cmd: string, args: string[]): string {
  return `cd ${shellQuote(cwd)} && ${shellQuote(cmd)} ${args.map(shellQuote).join(' ')}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type RebuildCommand = 'compose-up-build' | 'compose-up-build-force-recreate';

const REBUILD_ARGS: Record<RebuildCommand, string[]> = {
  'compose-up-build': ['compose', 'up', '-d', '--build'],
  'compose-up-build-force-recreate': ['compose', 'up', '-d', '--build', '--force-recreate'],
};

// Files matching any of these are treated as a signal that pulling might
// change the database — a heuristic, not a guarantee. See docs/USER_MANUAL.md.
const MIGRATION_RISK_PATTERNS = [/migrations\//i, /prisma\/schema\.prisma$/i, /alembic\//i, /\.sql$/i];

// 15-minute timeout for build commands to allow slow multi-stage container builds or large package downloads
const EXEC_OPTS = { timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 };

interface GitProjectRecord {
  repoOwner: string;
  repoName: string;
  branch: string;
  localPath?: string;
  // Name of an entry in config.sshTargets — when set, pull & rebuild runs
  // over SSH against that host instead of this daemon's own docker.sock.
  // Unset means the project's container runs on this daemon's own host.
  sshTarget?: string;
  rebuildCommand?: RebuildCommand;
  lastKnownSha?: string;
  // Cached result of the last successful GitHub check, so every collector
  // tick can return instantly without hitting the network.
  cachedLatestSha?: string;
  cachedLatestMessage?: string;
  cachedLatestDate?: string;
  lastCheckedAt?: number;
  // Opt-in per project — see pullIfSafe() below for what "safe" means.
  autoDeploy?: boolean;
  // Set when autoDeploy found a migration-risk file and backed off, so the
  // UI can explain why an update is sitting there instead of deploying itself.
  autoDeployBlocked?: boolean;
  // Wall-clock time of the last successful pull & rebuild, so the UI can
  // show when this project was last deployed, not just what SHA it's on.
  lastDeployedAt?: number;
}

interface GitProjectsDb {
  projects: Record<string, GitProjectRecord>;
}

interface GithubCommit {
  sha: string;
  commit: { message: string; committer?: { date?: string } };
}

export interface CheckPullResult {
  ok: boolean;
  message?: string;
  riskyFiles: string[];
  changedFiles: string[];
}

export interface PullResult {
  success: boolean;
  message: string;
  newSha?: string;
}

export class GitProjectsService {
  private dataDir: string;
  private dbPath: string;
  private db: GitProjectsDb;
  private pullStates: Map<string, GitPullState> = new Map();
  private activeProcesses: Map<string, Killable> = new Map();

  constructor(private notifications: NotificationsService) {
    this.dataDir = path.resolve(__dirname, '../../../data');
    const dataDir = this.dataDir;
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
        // fallback
      }
    }
    this.dbPath = path.join(dataDir, 'git-projects.json');
    this.db = this.loadDb();
  }

  private loadDb(): GitProjectsDb {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[GitProjectsService] Error reading database:', err);
    }
    return { projects: {} };
  }

  private saveDb() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('[GitProjectsService] Error writing database:', err);
    }
  }

  public getRegistered(): Record<string, GitProjectRecord> {
    return this.db.projects;
  }

  public async register(
    containerName: string,
    repoOwner: string,
    repoName: string,
    branch: string,
    localPath?: string,
    rebuildCommand?: RebuildCommand,
    autoDeploy?: boolean,
    sshTarget?: string
  ): Promise<GitProjectRecord> {
    const existing = this.db.projects[containerName];
    const record: GitProjectRecord = {
      repoOwner: repoOwner.trim(),
      repoName: repoName.trim(),
      branch: branch.trim() || 'main',
      localPath: localPath?.trim() || existing?.localPath,
      sshTarget: sshTarget ?? existing?.sshTarget,
      rebuildCommand: rebuildCommand || existing?.rebuildCommand,
      lastKnownSha: existing?.lastKnownSha,
      autoDeploy: autoDeploy ?? existing?.autoDeploy ?? false,
    };
    this.db.projects[containerName] = record;

    // A project usually already exists and is running by the time it's
    // tracked here — without a baseline it would show "Not deployed yet"
    // forever until the owner found the manual mark-deployed button. Best
    // effort: if this is the first time localPath is set and there's no
    // baseline yet, read whatever commit is actually checked out right now.
    if (record.localPath && !record.lastKnownSha) {
      try {
        const cwd = this.resolveWorkingTree(record);
        const { stdout } = await this.runExec(record, 'git', ['rev-parse', 'HEAD'], cwd);
        record.lastKnownSha = stdout.trim();
      } catch {
        // No working tree there yet, or it's not a git repo — leave it
        // unset, same as before; the owner can still use the manual button.
      }
    }

    this.saveDb();
    this.notifications.add(
      existing ? 'git-track' : 'git-track',
      existing ? `Updated ${containerName} (${record.repoOwner}/${record.repoName})` : `Tracking ${containerName} (${record.repoOwner}/${record.repoName})`
    );
    return record;
  }

  public unregister(containerName: string) {
    this.resetPullState(containerName);
    delete this.db.projects[containerName];
    this.saveDb();
    this.notifications.add('git-untrack', `Stopped tracking ${containerName}`);
  }

  /** Cancels any running pull/rebuild child process and resets pull state cleanly. */
  public resetPullState(containerName: string): boolean {
    const active = this.activeProcesses.get(containerName);
    if (active) {
      try {
        active.kill();
      } catch {}
      this.activeProcesses.delete(containerName);
    }
    this.pullStates.delete(containerName);
    return true;
  }

  /** Terminates all active local/remote runs cleanly to prevent zombies when daemon stops. */
  public stop() {
    for (const killable of this.activeProcesses.values()) {
      try {
        killable.kill();
      } catch {}
    }
    this.activeProcesses.clear();
  }

  /** Marks the currently deployed commit, e.g. after a manual pull outside the dashboard. */
  public markDeployed(containerName: string, sha: string) {
    const record = this.db.projects[containerName];
    if (!record) return;
    record.lastKnownSha = sha;
    this.saveDb();
  }

  /**
   * Reads whatever commit is actually checked out on disk right now and
   * records that as deployed — for a project that was already running
   * before it was tracked here (a manual `git pull` outside the dashboard,
   * or the initial deploy). Without this, a freshly-tracked project always
   * starts as "Not deployed yet" even though it's clearly running, because
   * this dashboard has no baseline until either this or a pull happens.
   */
  public async markDeployedFromLocal(containerName: string): Promise<PullResult> {
    const record = this.db.projects[containerName];
    if (!record) return { success: false, message: 'Not tracked.' };

    let cwd: string;
    try {
      cwd = this.resolveWorkingTree(record);
    } catch (err: any) {
      return { success: false, message: err.message };
    }

    try {
      const { stdout } = await this.runExec(record, 'git', ['rev-parse', 'HEAD'], cwd);
      const sha = stdout.trim();
      record.lastKnownSha = sha;
      this.saveDb();
      return { success: true, message: `Marked ${sha.slice(0, 7)} as deployed.`, newSha: sha };
    } catch (err: any) {
      return { success: false, message: err.message || 'Could not read the current commit.' };
    }
  }

  /**
   * Returns every registered project's status instantly from cache without
   * auto-querying GitHub in the background. Commit versions are refreshed on-demand
   * when the user triggers 'Refresh to get newest commit version' (refreshAll).
   */
  public getSnapshot(): GitProjectStatus[] {
    return Object.entries(this.db.projects).map(([containerName, record]) => {
      return {
        containerName,
        repoOwner: record.repoOwner,
        repoName: record.repoName,
        branch: record.branch,
        localPath: record.localPath,
        sshTarget: record.sshTarget,
        rebuildCommand: record.rebuildCommand,
        autoDeploy: record.autoDeploy ?? false,
        autoDeployBlocked: record.autoDeployBlocked ?? false,
        latestSha: record.cachedLatestSha,
        latestCommitMessage: record.cachedLatestMessage,
        latestCommitDate: record.cachedLatestDate,
        lastKnownSha: record.lastKnownSha,
        lastDeployedAt: record.lastDeployedAt,
        hasUpdate: Boolean(
          record.lastKnownSha && record.cachedLatestSha && record.cachedLatestSha !== record.lastKnownSha
        ),
        lastPullStatus: this.pullStates.get(containerName)?.status,
        lastPullMessage: this.pullStates.get(containerName)?.message,
      };
    });
  }

  /**
   * Forces an immediate GitHub check for every registered project, ignoring
   * githubCheckIntervalMs — used by the manual refresh button, so it's the
   * one place in this service that does await the network on request.
   */
  public async refreshAll(): Promise<void> {
    await Promise.all(
      Object.entries(this.db.projects).map(([containerName, record]) => this.refresh(containerName, record))
    );
  }

  private async refresh(containerName: string, record: GitProjectRecord): Promise<void> {
    // Mark checked immediately so concurrent ticks don't fire duplicate requests.
    record.lastCheckedAt = Date.now();

    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (config.githubToken) headers.Authorization = `token ${config.githubToken}`;

      const url = `https://api.github.com/repos/${record.repoOwner}/${record.repoName}/commits/${record.branch}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);

      const commit = (await res.json()) as GithubCommit;
      record.cachedLatestSha = commit.sha;
      record.cachedLatestMessage = commit.commit.message.split('\n')[0];
      record.cachedLatestDate = commit.commit.committer?.date;
      this.saveDb();

      if (record.autoDeploy && record.lastKnownSha && record.cachedLatestSha !== record.lastKnownSha) {
        await this.autoDeployIfSafe(containerName, record);
      }
    } catch (err) {
      console.warn(`[GitProjectsService] Check failed for ${record.repoOwner}/${record.repoName}:`, err);
    }
  }

  /**
   * Auto-deploy is opt-in per project (see the `autoDeploy` toggle) and only
   * ever proceeds when checkPull() reports zero migration-risk files — the
   * same heuristic the manual Pull & rebuild confirmation shows the owner.
   * A migration-risk file sets autoDeployBlocked instead of deploying, so
   * the project waits for a manual, informed click rather than silently
   * running something that might touch the database unattended.
   */
  private async autoDeployIfSafe(containerName: string, record: GitProjectRecord): Promise<void> {
    if (!record.localPath || !record.rebuildCommand) return;

    const check = await this.checkPull(containerName);
    if (!check.ok) return;

    if (check.riskyFiles.length > 0) {
      if (!record.autoDeployBlocked) {
        record.autoDeployBlocked = true;
        this.saveDb();
        console.warn(
          `[GitProjectsService] Auto-deploy paused for ${containerName}: migration-risk files detected`,
          check.riskyFiles
        );
      }
      return;
    }

    record.autoDeployBlocked = false;
    this.notifications.add('git-auto-deploy', `Auto-deploying ${containerName} — new commit detected`);
    const result = await this.pullAndRebuild(containerName);
    if (!result.success) {
      console.warn(`[GitProjectsService] Auto-deploy failed for ${containerName}:`, result.message);
    }
  }

  /**
   * Resolves a project's working tree to an absolute path.
   *
   * Local projects: localPath is a folder name under config.gitProjectsRoot,
   * resolved and confirmed to stay inside that mounted root — localPath is
   * owner-entered, so this blocks a value like "../../etc" from escaping it.
   *
   * Remote (sshTarget set) projects: there's no local filesystem to resolve
   * against or check existence on, so localPath must already be an absolute
   * path on that host; the owner's key already has full interactive shell
   * access to it via Terminal, so trusting this path is not a wider grant.
   */
  private resolveWorkingTree(record: GitProjectRecord): string {
    if (!record.localPath) {
      throw new Error('This project has no local path configured yet — edit it to add one.');
    }
    if (record.sshTarget) {
      if (!record.localPath.startsWith('/')) {
        throw new Error('For a project on a remote SSH target, localPath must be an absolute path on that host.');
      }
      return record.localPath;
    }
    const resolved = path.resolve(config.gitProjectsRoot, record.localPath);
    const root = path.resolve(config.gitProjectsRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('localPath must resolve inside the Git Projects root.');
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`${resolved} does not exist inside the container — check the bind mount and localPath.`);
    }
    return resolved;
  }

  private resolveSshTarget(record: GitProjectRecord): SshTargetConfig {
    const target = config.sshTargets.find((t) => t.name === record.sshTarget);
    if (!target) {
      throw new Error(`Unknown SSH target "${record.sshTarget}" — check SSH_TARGETS and re-edit this project.`);
    }
    return target;
  }

  /**
   * Runs a fixed command and returns its full output once finished — the
   * remote counterpart of execFile. Routes to the local execFile or an SSH
   * exec against record.sshTarget depending on where this project lives.
   */
  private runExec(
    record: GitProjectRecord,
    cmd: string,
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string }> {
    if (record.sshTarget) {
      return this.sshExec(this.resolveSshTarget(record), cmd, args, cwd);
    }
    return execFile(cmd, args, { ...EXEC_OPTS, cwd });
  }

  /**
   * Runs a fixed command, streaming each output line into onLine as it
   * happens — the remote counterpart of spawnCapture, used for the live
   * pull/rebuild log. Same local/SSH routing as runExec().
   */
  private runCapture(
    containerName: string,
    record: GitProjectRecord,
    cmd: string,
    args: string[],
    cwd: string,
    onLine: (line: string) => void
  ): Promise<void> {
    if (record.sshTarget) {
      return this.sshCapture(containerName, this.resolveSshTarget(record), cmd, args, cwd, onLine);
    }
    return this.spawnCapture(containerName, cmd, args, cwd, onLine);
  }

  /** Best-effort removal of a stale .git/index.lock, local or remote — see the callers for why this can be needed. */
  private async cleanStaleLock(record: GitProjectRecord, cwd: string, onLine?: (line: string) => void): Promise<void> {
    if (record.sshTarget) {
      try {
        await this.runExec(record, 'rm', ['-f', `${cwd}/.git/index.lock`], cwd);
      } catch {}
      return;
    }
    const lockFile = path.join(cwd, '.git', 'index.lock');
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        onLine?.('ℹ Stale .git/index.lock file detected and removed.');
      } catch {}
    }
  }

  private readSshPrivateKey(): Buffer {
    return fs.readFileSync(config.sshPrivateKeyPath);
  }

  /** One-shot SSH exec that collects full stdout/stderr and rejects on a non-zero exit — mirrors execFile(). */
  private sshExec(target: SshTargetConfig, cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    const command = buildRemoteCommand(cwd, cmd, args);
    return new Promise((resolve, reject) => {
      let privateKey: Buffer;
      try {
        privateKey = this.readSshPrivateKey();
      } catch {
        reject(new Error('SSH private key not found on the daemon.'));
        return;
      }

      const client = new SshClient();
      client
        .on('ready', () => {
          client.exec(command, (err, stream) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }
            let stdout = '';
            let stderr = '';
            stream.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
            stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
            stream.on('close', (code: number) => {
              client.end();
              if (code === 0) resolve({ stdout, stderr });
              else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
            });
          });
        })
        .on('error', (err) => reject(err))
        .connect({ host: target.host, port: target.port, username: target.user, privateKey, readyTimeout: 8000 });
    });
  }

  /** Streaming SSH exec, tracked in activeProcesses so resetPullState()/stop() can cancel it mid-run. */
  private sshCapture(
    containerName: string,
    target: SshTargetConfig,
    cmd: string,
    args: string[],
    cwd: string,
    onLine: (line: string) => void
  ): Promise<void> {
    const command = buildRemoteCommand(cwd, cmd, args);
    return new Promise((resolve, reject) => {
      let privateKey: Buffer;
      try {
        privateKey = this.readSshPrivateKey();
      } catch {
        reject(new Error('SSH private key not found on the daemon.'));
        return;
      }

      const client = new SshClient();
      let killable: Killable | undefined;
      const cleanup = () => {
        if (killable && this.activeProcesses.get(containerName) === killable) {
          this.activeProcesses.delete(containerName);
        }
      };

      client
        .on('ready', () => {
          client.exec(command, (err, stream) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }
            killable = {
              kill: () => {
                try {
                  stream.close();
                } catch {}
                try {
                  client.end();
                } catch {}
              },
            };
            this.activeProcesses.set(containerName, killable);

            const pipe = (readable: NodeJS.ReadableStream) => {
              let buffer = '';
              readable.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) onLine(line);
              });
              readable.on('end', () => {
                if (buffer.trim()) onLine(buffer);
              });
            };
            pipe(stream);
            pipe(stream.stderr);

            stream.on('close', (code: number) => {
              cleanup();
              client.end();
              if (code === 0) resolve();
              else reject(new Error(`${cmd} exited with code ${code}`));
            });
          });
        })
        .on('error', (err) => {
          cleanup();
          reject(err);
        })
        .connect({ host: target.host, port: target.port, username: target.user, privateKey, readyTimeout: 8000 });
    });
  }

  /**
   * Read-only: fetches upstream and lists which files would change on pull,
   * flagging any that match a migration-risk pattern. Never modifies the
   * working tree — safe to call speculatively before the owner confirms.
   */
  public async checkPull(containerName: string): Promise<CheckPullResult> {
    const record = this.db.projects[containerName];
    if (!record) return { ok: false, message: 'Not tracked.', riskyFiles: [], changedFiles: [] };

    try {
      const cwd = this.resolveWorkingTree(record);
      await this.cleanStaleLock(record, cwd);
      await this.runExec(record, 'git', ['fetch', 'origin', record.branch], cwd);
      const { stdout } = await this.runExec(
        record,
        'git',
        ['diff', '--name-only', `HEAD..origin/${record.branch}`],
        cwd
      );
      const changedFiles = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const riskyFiles = changedFiles.filter((f) => MIGRATION_RISK_PATTERNS.some((p) => p.test(f)));

      // Local HEAD already matches origin — if the stored baseline still
      // disagrees (stale from a manual pull outside the dashboard, or from
      // before this project had a local path), self-heal it here rather
      // than leaving "Update available" showing with nothing left to pull.
      if (changedFiles.length === 0) {
        const { stdout: headOut } = await this.runExec(record, 'git', ['rev-parse', 'HEAD'], cwd);
        const head = headOut.trim();
        if (record.lastKnownSha !== head) {
          record.lastKnownSha = head;
          this.saveDb();
        }
      }

      return { ok: true, riskyFiles, changedFiles };
    } catch (err: any) {
      return { ok: false, message: err.message, riskyFiles: [], changedFiles: [] };
    }
  }

  /** Current pull/rebuild state for a project — polled by the client for the inline live log view. */
  public getPullState(containerName: string): GitPullState {
    return (
      this.pullStates.get(containerName) ?? {
        status: 'idle',
        log: [],
      }
    );
  }

  /**
   * Kicks off git pull + rebuild in the background and returns immediately
   * — the caller polls getPullState() for live progress instead of waiting
   * on this request. Refuses a second concurrent run for the same project.
   * `force` still only ever runs the same fixed pull-then-rebuild sequence;
   * it just means "run it even though checkPull found nothing to pull",
   * for the case where the working tree already matches origin but the
   * running container doesn't reliably reflect it (a bad image layer cache,
   * a rebuild that silently failed last time, etc).
   */
  public startPull(containerName: string): { started: boolean; message?: string } {
    const record = this.db.projects[containerName];
    if (!record) return { started: false, message: 'Not tracked.' };
    if (!record.rebuildCommand) {
      return { started: false, message: 'No rebuild command configured — edit this project to set one.' };
    }
    const current = this.pullStates.get(containerName);
    if (current && (current.status === 'pulling' || current.status === 'rebuilding')) {
      return { started: false, message: 'Already running.' };
    }

    this.notifications.add('git-pull-start', `Pulling ${containerName}…`);
    this.pullAndRebuild(containerName).catch(() => {});
    return { started: true };
  }

  /**
   * git pull followed by the project's fixed rebuild command. The request
   * only ever names *which* registered project — the argv actually run is
   * resolved here from rebuildCommand, never taken from the request body.
   * Runs both steps through spawn (not execFile) so output streams into
   * pullStates as it happens, for startPull()'s live log view; autoDeploy
   * awaits this directly instead of going through startPull.
   */
  public async pullAndRebuild(containerName: string): Promise<PullResult> {
    const record = this.db.projects[containerName];
    if (!record) return { success: false, message: 'Not tracked.' };
    if (!record.rebuildCommand) {
      return { success: false, message: 'No rebuild command configured — edit this project to set one.' };
    }

    const state: GitPullState = { status: 'pulling', log: [], startedAt: Date.now() };
    this.pullStates.set(containerName, state);

    const appendLog = (line: string) => {
      state.log.push(line);
      if (state.log.length > MAX_PULL_LOG_LINES) state.log.splice(0, state.log.length - MAX_PULL_LOG_LINES);
    };

    let cwd: string;
    try {
      cwd = this.resolveWorkingTree(record);
    } catch (err: any) {
      state.status = 'failed';
      state.message = err.message;
      state.finishedAt = Date.now();
      this.notifications.add('git-pull-failed', `${containerName}: ${err.message}`);
      return { success: false, message: err.message };
    }

    try {
      // 0. Clean stale git lock if present
      await this.cleanStaleLock(record, cwd, appendLog);

      // 1. Check for uncommitted tracked changes and safely stash them so user edits are not lost
      try {
        const { stdout: statusOut } = await this.runExec(record, 'git', ['status', '--porcelain'], cwd);
        if (statusOut.trim()) {
          appendLog('ℹ Menemukan perubahan lokal pada repositori. Menyimpan backup sementara via git stash...');
          appendLog('$ git stash push -m "Auto-stashed before pull and redeploy"');
          await this.runCapture(containerName, record, 'git', ['stash', 'push', '-m', 'Auto-stashed before pull and redeploy'], cwd, appendLog);
        }
      } catch (stashErr: any) {
        // Non-blocking stash attempt
        appendLog(`ℹ Stash info: ${stashErr.message || "clean working tree"}`);
      }

      // 2. Fetch latest commits from remote origin
      appendLog(`$ git fetch origin ${record.branch}`);
      await this.runCapture(containerName, record, 'git', ['fetch', 'origin', record.branch], cwd, appendLog);

      // 3. Force-sync working tree cleanly to remote branch (prevents merge aborts while keeping untracked .env & volume data intact)
      appendLog(`$ git reset --hard origin/${record.branch}`);
      await this.runCapture(containerName, record, 'git', ['reset', '--hard', `origin/${record.branch}`], cwd, appendLog);

      const { stdout: shaOut } = await this.runExec(record, 'git', ['rev-parse', 'HEAD'], cwd);
      const newSha = shaOut.trim();

      // The out-of-process self-redeploy dance below exists only because a
      // rebuild running *inside this daemon's own container* would kill the
      // very process performing it. A remote sshTarget's docker compose runs
      // on a different host from this Fastify process, so that risk doesn't
      // apply there — treat it as a normal remote rebuild instead.
      const isSelf = !record.sshTarget && (containerName === 'homelab-cockpit' || record.repoName === 'homelab-dashboard');
      if (isSelf) {
        appendLog('ℹ Terdeteksi self-redeploy pada container Homelab Dashboard.');
        appendLog('ℹ Memicu out-of-process runner agar proses rebuild tidak terputus saat container dimatikan...');

        record.lastKnownSha = newSha;
        this.saveDb();

        const triggerFile = path.join(this.dataDir, '.redeploy-trigger');
        const statusFile = path.join(this.dataDir, 'redeploy-status.json');
        try {
          fs.writeFileSync(triggerFile, 'homelab-dashboard', 'utf-8');
          fs.writeFileSync(
            statusFile,
            JSON.stringify({
              status: 'rebuilding',
              project: 'homelab-dashboard',
              startedAt: Date.now(),
            }),
            'utf-8'
          );
        } catch {}

        const scriptCandidates = [
          '/root/homelab-redeploy.sh',
          path.join(cwd, 'scripts/homelab-redeploy.sh'),
          '/projects/homelab-dashboard/scripts/homelab-redeploy.sh',
        ];

        for (const sPath of scriptCandidates) {
          if (fs.existsSync(sPath)) {
            try {
              const child = spawn('bash', [sPath, 'homelab-dashboard'], {
                detached: true,
                stdio: 'ignore',
              });
              child.unref();
              appendLog(`$ spawned detached runner: ${sPath}`);
              break;
            } catch {}
          }
        }

        appendLog('✔ Sinyal redeploy berhasil dikirim ke runner host.');
        appendLog('⏳ Container akan direstart. Koneksi web akan terputus sesaat lalu terhubung kembali otomatis.');
        state.status = 'rebuilding';
        return { success: true, message: 'Self redeploy triggered out-of-process.', newSha };
      }

      state.status = 'rebuilding';
      appendLog(`$ docker ${REBUILD_ARGS[record.rebuildCommand].join(' ')}`);
      try {
        await this.runCapture(containerName, record, 'docker', REBUILD_ARGS[record.rebuildCommand], cwd, appendLog);
      } catch (dockerErr: any) {
        // Auto-heal missing external docker network if detected in output
        const fullLog = state.log.join('\n');
        const netMatch = fullLog.match(/network\s+([^\s'"]+)\s+declared as external, but could not be found/i);
        if (netMatch && netMatch[1]) {
          const missingNet = netMatch[1];
          appendLog(`⚠ External network "${missingNet}" is missing on host.`);
          appendLog(`ℹ Auto-creating external network: $ docker network create ${missingNet}...`);
          try {
            await this.runExec(record, 'docker', ['network', 'create', missingNet], cwd);
            appendLog(`✔ Network "${missingNet}" created successfully.`);
            appendLog(`$ docker ${REBUILD_ARGS[record.rebuildCommand].join(' ')} (retrying...)`);
            await this.runCapture(containerName, record, 'docker', REBUILD_ARGS[record.rebuildCommand], cwd, appendLog);
          } catch (retryErr: any) {
            throw new Error(`Failed to recreate external network ${missingNet}: ${retryErr.message || dockerErr.message}`);
          }
        } else {
          throw dockerErr;
        }
      }

      record.lastKnownSha = newSha;
      record.lastDeployedAt = Date.now();
      this.saveDb();

      const message = `Pulled and rebuilt at ${newSha.slice(0, 7)}.`;
      state.status = 'success';
      state.message = message;
      state.finishedAt = Date.now();
      this.notifications.add('git-pull-success', `${containerName}: ${message}`);
      return { success: true, message, newSha };
    } catch (err: any) {
      const message = err.message || 'Pull/rebuild failed.';
      state.status = 'failed';
      state.message = message;
      state.finishedAt = Date.now();
      this.notifications.add('git-pull-failed', `${containerName}: ${message}`);
      return { success: false, message };
    }
  }

  /** Runs a fixed command via spawn, streaming each output line into onLine, tracking child process, and rejects on a non-zero exit. */
  private spawnCapture(
    containerName: string,
    cmd: string,
    args: string[],
    cwd: string,
    onLine: (line: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, timeout: EXEC_OPTS.timeout });
      const killable: Killable = {
        kill: () => {
          try {
            child.kill('SIGTERM');
            setTimeout(() => {
              try {
                if (!child.killed) child.kill('SIGKILL');
              } catch {}
            }, 1500);
          } catch {}
        },
      };
      this.activeProcesses.set(containerName, killable);

      const cleanup = () => {
        if (this.activeProcesses.get(containerName) === killable) {
          this.activeProcesses.delete(containerName);
        }
      };

      const pipe = (stream: NodeJS.ReadableStream | null) => {
        if (!stream) return;
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) onLine(line);
        });
        stream.on('end', () => {
          if (buffer.trim()) onLine(buffer);
        });
      };
      pipe(child.stdout);
      pipe(child.stderr);

      child.on('error', (err) => {
        cleanup();
        reject(err);
      });
      child.on('close', (code, signal) => {
        cleanup();
        if (code === 0) {
          resolve();
        } else {
          const detail = signal ? `killed with signal ${signal}` : `exited with code ${code}`;
          reject(new Error(`${cmd} ${detail}`));
        }
      });
    });
  }
}
