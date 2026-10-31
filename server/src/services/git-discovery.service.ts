import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as SshClient } from 'ssh2';
import { config, SshTargetConfig } from '../config.js';
import { auditLogService } from './audit-log.service.js';
import { DiscoveredRepo, GitDiscoveryResult, GitHostScan } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCAN_TIMEOUT_MS = 90_000;
const FIELD_COUNT = 13;

/**
 * Runs on the remote host over one SSH exec (POSIX sh, one round trip per host). It only reads:
 * `git ls-remote` asks the remote for a branch head without fetching, so nothing inside any
 * repository changes. __ROOTS__ is replaced with the validated GIT_SCAN_ROOTS.
 */
export const SCAN_SCRIPT = String.raw`set -f
G="git -c safe.directory=* -c core.quotepath=off"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"
for root in __ROOTS__; do
  [ -d "$root" ] && find "$root" -maxdepth 3 -name .git -prune 2>/dev/null
done | sed 's#/\.git$##' | sort -u | while IFS= read -r d; do
  br=$($G -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
  head=$($G -C "$d" rev-parse --short=7 HEAD 2>/dev/null)
  dirty=$($G -C "$d" status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')
  when=$($G -C "$d" log -1 --format=%cI 2>/dev/null)
  subj=$($G -C "$d" log -1 --format=%s 2>/dev/null | tr '\t\r\n' '   ' | cut -c1-120)
  url=$($G -C "$d" remote get-url origin 2>/dev/null | sed -E 's#//[^@/]*@#//#')
  defb=$($G -C "$d" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  rfull=""; state="none"; behind=""; ahead=""
  if [ -n "$url" ] && [ "$br" != "HEAD" ]; then
    out=$(timeout 15 $G -C "$d" ls-remote origin "refs/heads/$br" 2>/dev/null)
    if [ $? -ne 0 ]; then state="unreachable"
    elif [ -z "$out" ]; then state="no-branch"
    else
      rfull=$(echo "$out" | cut -f1 | head -1)
      state="ok"
      if [ "$(echo "$rfull" | cut -c1-7)" != "$head" ] && $G -C "$d" cat-file -e "$rfull^{commit}" 2>/dev/null; then
        counts=$($G -C "$d" rev-list --left-right --count "HEAD...$rfull" 2>/dev/null)
        ahead=$(echo "$counts" | cut -f1)
        behind=$(echo "$counts" | cut -f2)
      fi
    fi
  fi
  compose=no
  for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do [ -f "$d/$f" ] && compose=yes; done
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$d" "$br" "$head" "$dirty" "$when" "$subj" "$url" "$defb" "$state" "$(echo "$rfull" | cut -c1-7)" "$behind" "$ahead" "$compose"
done
`;

/** Turns the script's tab-separated output into rows; lines that do not parse are skipped. */
export function parseScanOutput(host: string, stdout: string, ignored: Set<string>): DiscoveredRepo[] {
  const repos: DiscoveredRepo[] = [];
  for (const line of stdout.split('\n')) {
    const f = line.replace(/\r$/, '').split('\t');
    if (f.length !== FIELD_COUNT || !f[0].startsWith('/')) continue;
    const state = (['ok', 'unreachable', 'no-branch', 'none'] as const).find((s) => s === f[8]) ?? 'none';
    const num = (v: string): number | undefined => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    repos.push({
      host,
      path: f[0],
      name: path.posix.basename(f[0]),
      branch: f[1],
      head: f[2],
      headDate: f[4] || undefined,
      headSubject: f[5] || undefined,
      dirty: num(f[3]) ?? 0,
      remote: f[6] || undefined,
      defaultBranch: f[7] || undefined,
      remoteState: state,
      remoteHead: f[9] || undefined,
      behind: num(f[10]),
      ahead: num(f[11]),
      hasCompose: f[12] === 'yes',
      ignored: ignored.has(`${host}:${f[0]}`),
    });
  }
  return repos.sort((a, b) => a.path.localeCompare(b.path));
}

interface DiscoveryDb {
  ignored: string[];
}

/**
 * Finds the git repositories that actually exist on each SSH target and reports what is checked
 * out there (branch, commit, changed files, whether the remote has moved on). This is the truth
 * about a server; the "Track a project" records are only a marker the dashboard keeps itself.
 */
export class GitDiscoveryService {
  private dbPath: string;
  private ignored: Set<string>;
  private hosts = new Map<string, GitHostScan>();
  private scanning: Promise<void> | null = null;
  private lastScanAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    const dataDir = path.resolve(__dirname, '../../../data');
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // fallback: the ignore list simply will not persist
    }
    this.dbPath = path.join(dataDir, 'git-discovery.json');
    this.ignored = new Set(this.load().ignored);
  }

  private load(): DiscoveryDb {
    try {
      if (fs.existsSync(this.dbPath)) return { ignored: [], ...JSON.parse(fs.readFileSync(this.dbPath, 'utf-8')) };
    } catch (err) {
      console.error('[GitDiscoveryService] Error reading database:', err);
    }
    return { ignored: [] };
  }

  private save() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify({ ignored: [...this.ignored].sort() }, null, 2), 'utf-8');
    } catch (err) {
      console.error('[GitDiscoveryService] Error writing database:', err);
    }
  }

  public start() {
    if (config.demoMode || config.sshTargets.length === 0) return;
    void this.scanAll();
    this.timer = setInterval(() => void this.scanAll(), config.gitScan.intervalMs);
    this.timer.unref();
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private targets(): SshTargetConfig[] {
    return config.sshTargets.filter((t) => !config.gitScan.skipTargets.includes(t.name));
  }

  /** One scan at a time; callers that arrive mid-scan wait for it instead of starting another. */
  public scanAll(): Promise<void> {
    if (config.demoMode) return Promise.resolve();
    if (this.scanning) return this.scanning;
    this.scanning = Promise.all(this.targets().map((t) => this.scanHost(t)))
      .then(() => {
        this.lastScanAt = Date.now();
      })
      .finally(() => {
        this.scanning = null;
      });
    return this.scanning;
  }

  private async scanHost(target: SshTargetConfig): Promise<void> {
    const started = Date.now();
    const prev = this.hosts.get(target.name);
    try {
      const stdout = await this.exec(target);
      const repos = parseScanOutput(target.name, stdout, this.ignored);
      this.hosts.set(target.name, { host: target.name, ok: true, scannedAt: Date.now(), durationMs: Date.now() - started, repos });
      if (prev && !prev.ok) auditLogService.log('git', 'info', `Git scan of ${target.name} works again`);
    } catch (e) {
      const error = (e as Error).message || 'scan failed';
      // Keep the last good rows so a blip does not empty the page; the error is shown next to them.
      this.hosts.set(target.name, { host: target.name, ok: false, error, scannedAt: Date.now(), durationMs: Date.now() - started, repos: prev?.repos ?? [] });
      if (!prev || prev.ok) auditLogService.log('git', 'warn', `Git scan of ${target.name} failed: ${error}`);
    }
  }

  private exec(target: SshTargetConfig): Promise<string> {
    const script = SCAN_SCRIPT.replace('__ROOTS__', config.gitScan.roots.join(' '));
    return new Promise((resolve, reject) => {
      let privateKey: Buffer;
      try {
        privateKey = fs.readFileSync(config.sshPrivateKeyPath);
      } catch {
        reject(new Error('SSH private key not found on the daemon'));
        return;
      }
      const client = new SshClient();
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.end();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('timed out'))), SCAN_TIMEOUT_MS);
      client
        .on('ready', () => {
          client.exec('sh -s', (err, stream) => {
            if (err) return finish(() => reject(err));
            let out = '';
            let errOut = '';
            stream.on('data', (c: Buffer) => (out += c.toString()));
            stream.stderr.on('data', (c: Buffer) => (errOut += c.toString()));
            stream.on('close', (code: number) => finish(() => (code === 0 ? resolve(out) : reject(new Error(errOut.trim().slice(0, 200) || `exit ${code}`)))));
            stream.end(script);
          });
        })
        .on('error', (err) => finish(() => reject(new Error(err.message.includes('authentication') ? 'SSH key not authorized' : err.message))))
        .connect({ host: target.host, port: target.port, username: target.user, privateKey, readyTimeout: 8000 });
    });
  }

  public setIgnored(host: string, repoPath: string, value: boolean) {
    const key = `${host}:${repoPath}`;
    if (value) this.ignored.add(key);
    else this.ignored.delete(key);
    this.save();
    const scan = this.hosts.get(host);
    scan?.repos.forEach((r) => {
      if (r.path === repoPath) r.ignored = value;
    });
  }

  public getResult(): GitDiscoveryResult {
    if (config.demoMode) return demoResult(this.ignored);
    const hosts = this.targets().map((t) => this.hosts.get(t.name) ?? { host: t.name, ok: false, error: 'not scanned yet', scannedAt: 0, durationMs: 0, repos: [] });
    return { scannedAt: this.lastScanAt, scanning: this.scanning !== null, hosts };
  }
}

function demoResult(ignored: Set<string>): GitDiscoveryResult {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  const repo = (host: string, p: string, o: Partial<DiscoveredRepo>): DiscoveredRepo => ({
    host,
    path: p,
    name: path.posix.basename(p),
    branch: 'main',
    head: 'a1b2c3d',
    headDate: ago(30),
    headSubject: 'chore: update dependencies',
    dirty: 0,
    remote: `https://github.com/example/${path.posix.basename(p)}.git`,
    defaultBranch: 'main',
    remoteState: 'ok',
    remoteHead: o.head ?? 'a1b2c3d',
    hasCompose: true,
    ignored: ignored.has(`${host}:${p}`),
    ...o,
  });
  const host = (name: string, repos: DiscoveredRepo[], extra: Partial<GitHostScan> = {}): GitHostScan => ({ host: name, ok: true, scannedAt: now - 120_000, durationMs: 2300, repos, ...extra });
  return {
    scannedAt: now - 120_000,
    scanning: false,
    hosts: [
      host('docker-host', [
        repo('docker-host', '/mnt/homelab_projects/homelab-dashboard', { headSubject: 'feat(ui): rework navigation' }),
        repo('docker-host', '/mnt/homelab_projects/malas', { head: '9865d91', remoteHead: '9865d91', headDate: ago(500), headSubject: 'fix: stale copy' }),
        repo('docker-host', '/opt/infra/openclaw', { dirty: 1, remote: 'https://github.com/example/openclaw.git', remoteState: 'unreachable', remoteHead: undefined, hasCompose: true }),
      ]),
      host('yado-hosts', [
        repo('yado-hosts', '/opt/projects/malas', { head: '7c2b9b0', remoteHead: '7c2b9b0', dirty: 2, headSubject: 'feat: add reports' }),
        repo('yado-hosts', '/opt/projects/yado', { head: '89590c6', remoteHead: 'e4f5a6b', behind: 3, ahead: 0, headSubject: 'fix: login redirect' }),
      ]),
      host('personal-hosts', [], { ok: false, error: 'SSH key not authorized', scannedAt: now - 120_000, durationMs: 400 }),
    ],
  };
}
