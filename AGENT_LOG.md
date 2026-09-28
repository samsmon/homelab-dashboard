# Agent Activity Log

This file tracks the activities of all AI agents (Gemini, Claude, etc.) operating in this repository. 
**Rule:** Always review this file when starting a task, and append a new entry when finishing a significant task.

---

### [2026-09-28 UTC]
**Agent:** Antigravity (Feature: Proxmox & Windows Task Manager performance graphs across Overview, Fleet, and Infra)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Zero-overhead client-side metric history (`MetricHistoryContext.tsx`):** Maintains a rolling 60-sample time-series buffer in React context. Automatically extracts samples on existing 2-second snapshot ticks with 0 added backend polling, 0 additional API requests, and no memory leaks. Preserves history across page transitions (Overview ↔ Fleet ↔ Infra).
- **Reusable SVG performance graph component (`PerformanceGraph.tsx`):** Windows Task Manager / Proxmox VE inspired Cartesian grid with area gradient fills under curves, single/dual series support (RX vs TX, Proxmox vs LXC), interactive scrubbing crosshairs with timestamp/value tooltip, and auto/fixed scaling.
- **Overview (`HomePage.tsx` & `HostSummaryTiles.tsx`):** Added live mini waveforms into vitals tiles + full Node Performance Timeline section with toggleable tabs (All Grid, CPU, Memory, Network, Disk).
- **Fleet (`ContainerGridSection.tsx`):** Added Fleet Cluster Performance monitor banner aggregating container CPU, container RAM footprint, and total network throughput over 60s.
- **Infra (`InfraPage.tsx` & `DiskPerformancePanel.tsx`):** Added Proxmox & Host Vitals Timeline in the Performance tab, and upgraded DiskPerformancePanel with Task Manager grid and interactive scrubbing.
- **Verification:** `npx --workspace=client tsc -b`, `npx --workspace=client vite build`, and `npx --workspace=server tsc` all pass with 0 errors.

---

### [2026-09-21 UTC]
**Agent:** Claude (Feature: real SSL cert checks; fix: hardcoded values in Sentinel bot)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **SSL certificates panel now does a real TLS handshake instead of returning fabricated data:** a full audit of the rest of `server/src` (owner-requested, following the Fase 1-3 accuracy/perf work) found `SslService.getCertificates()` returned six entirely invented certificates (fake domains, issuers, expiry dates) on every single 2s poll tick — the panel had never done any real certificate inspection. Rewrote it to open a real `tls.connect()` per domain in `config.sslDomains` (new `SSL_DOMAINS` env var, `.env.example` documented: `host[:port][=Label]`, comma-separated) and read `getPeerCertificate()`'s actual `valid_to`. Follows the same cache-and-throttle shape as `GitProjectsService`'s GitHub polling (`SSL_CHECK_INTERVAL_MS`, default 6h) instead of running on the hot 2s tick, since a TLS handshake is real external I/O. `rejectUnauthorized: false` is intentional — a homelab-internal cert (self-signed or internal CA) still has a real expiry worth tracking, we're not doing trust validation. A domain that can't be reached now shows a distinct "(unreachable: ...)" status instead of a fabricated-but-plausible reading. Demo mode keeps its own clearly-fake sample data (`getSimulatedCertificates`); with no domains configured, the panel now returns an empty list (client already renders an empty state) instead of six lies.
- **`SentinelService` (Telegram bot) had hardcoded owner IPs/hardware baked into its output, found in the same audit:** `/help`'s hardware line and the Gemini system prompt both had a literal `"Lenovo ThinkCentre M710q Tiny (i5-7500 / 32GB RAM)"`, `"192.168.18.224"`/`"192.168.18.225"` IPs, and a hardcoded storage-mount list — the exact pattern CLAUDE.md's "never hardcode this owner's hardware" note already covers, just in a file that note's original incident didn't touch. Both now derive from `getLatestSnapshot()` (cpuModel/cpuCores/ramTotalBytes/ip, already real per-tick telemetry) and `config.storageMounts`, falling back to a plain "not yet available" string before the first snapshot exists rather than a fabricated one. Also removed two fake sensor fallbacks (`pve.cpuTempCelsius || 48`, `fanSpeedPercent || 35`) that would silently report invented readings if the real value were ever falsy — now shown as `n/a` instead.
- **Two smaller hardcodes from the same audit:** `config.ts`'s default `PROXMOX_URL` fallback (used only when the env var is unset) was this owner's literal IP; changed to a generic `pve.local` placeholder. `ai-agents.service.ts`'s email display fallback was a literal personal email address; changed to `'unknown'`.
- **Verification:** `cd server && npx tsc` clean.

---

### [2026-09-21 UTC]
**Agent:** Claude (Fix: duplicate Proxmox API calls, unbounded canary readdir, hardcoded Proxmox IP)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **`getStorageVitals()` was being fetched twice per 2s tick:** `ProxmoxService.getMetrics()` calls `getStorageVitals()` internally to attach `storageVitals` to the host metrics object, but `CollectorService.collect()` also called it separately for the `pveStorage` field used elsewhere in the snapshot — doubling up all three of its HTTP calls (`/disks/list`, `/storage`, `/lxc`) against the Proxmox API every single tick (8 requests/tick total instead of 5). `getMetrics()` now accepts an optional `storageVitalsPromise` and `collect()` creates that promise once and passes the same in-flight instance to both call sites — one fetch, awaited twice, no added latency since both awaits happen inside the same `Promise.all`.
- **`checkCanaryFile()` could do a full directory listing every tick:** when a `STORAGE_MOUNTS` external mount doesn't have the `.mounted` marker file, `SystemService.checkCanaryFile()` fell back to `fs.readdirSync(mountPath)` — reading and materializing every entry in that directory just to check `.length > 0`. On a media library mount with thousands of top-level entries, that's real I/O and CPU work repeated every 2 seconds, not a one-time cost. Replaced with `fs.opendirSync()` + a single `readSync()`, which stops after the first entry.
- **Hardcoded Proxmox host IP replaced with one derived from config:** `ProxmoxService.getMetrics()`'s real (non-demo) response returned a literal `'192.168.18.224'` for `ip` regardless of what `PROXMOX_URL` was actually configured to — the exact hardcoding pattern CLAUDE.md's "never hardcode this owner's hardware" note already warns about, just in a server file that note didn't originally cover. Now derived once in the constructor via `new URL(config.proxmox.url).hostname`. The demo-mode fallback (`getSimulatedMetrics`) intentionally keeps its own plausible placeholder, consistent with every other demo fallback in this file.
- **Found while addressing the owner's "no bias, no sudden CPU spikes" follow-up** to the Fase 1-3 Beszel-benchmark work — a closer read of `proxmox.service.ts` (not covered by the original audit) turned these up.
- **Verification:** `cd server && npx tsc` clean.
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Fixed a resource leak introduced by the Fase 2 streaming change:** the earlier switch to persistent `container.stats({stream:true})` connections (`DockerService.ensureStatsStream`) relied on `fetchLiveContainers()` to close a stream once its container stopped running — but that cleanup only runs during a poll tick, and `CollectorService.stopTimer()` (fired when the last WebSocket client disconnects) stops ticking entirely. If monitoring mode was still active when every client disconnected, open stats streams kept receiving data from the Docker daemon indefinitely with no tick left to close them — unlike the old on-demand `stats({stream:false})` design, where zero clients meant zero cost automatically.
- **Fix:** `DockerService.closeAllStatsStreams()` made public; `CollectorService.stopTimer()` now calls it on every configured host when polling pauses. Streams reopen normally on the next tick if a client reconnects while monitoring is still active.
- **Found while answering the owner's question** about whether the Fase 1-3 changes actually hold up under real usage — a legitimate "is this really safe" check surfaced a real bug, not a false alarm.
- **Verification:** `cd server && npx tsc` clean.

---

### [2026-09-21 UTC]
**Agent:** Claude (Fix: metrics accuracy — host CPU%, disk device-key, per-host demo honesty)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Host CPU% now a real utilization delta, not load average:** `SystemService.readCpuPercent()` (`system.service.ts`) reads `/proc/stat`, keeps the previous idle/total jiffy counts, and computes `(1 - idleDelta/totalDelta) * 100` between two ticks — the same shape gopsutil-based tools (Beszel) use. `os.loadavg()[0]/coreCount*100` (the old formula) is a run-queue length including I/O-blocked processes, not CPU busy time, and diverged visibly under disk load. Falls back to the old loadavg formula only when `/proc/stat` isn't readable (Windows/macOS dev).
- **Disk performance device resolution replaced with real major:minor lookup:** `getDeviceKey()` resolves a mount path to `major:minor` via `fs.statSync(path, {bigint:true}).dev` decoded with the standard glibc macros, matching CLAUDE.md's already-documented intended design that the actual code had drifted from — the prior implementation guessed a `/dev/sdX` name from whether the mount path's own text contained "media"/"cloud"/"music", which silently mismatched on any host whose device naming didn't happen to match the original owner's setup. `readDiskStats()` now keys its `/proc/diskstats` map by the same `major:minor` identity instead of the raw device name. A mount that resolves to no matching row (LVM/device-mapper) now returns "not available" fields in real mode instead of fabricated sine/cosine numbers; the simulated fallback is now gated to `config.demoMode` only.
- **Per-host live/demo status now reflects the actual tick, not a global OR:** `CollectorService.collect()` previously set `dockerHosts[].connected` from `service.isConnected()` (static reachability) and `isDemoMode` from `anyLive` across *all* configured hosts — so if any secondary host's live fetch succeeded, the whole snapshot reported `isDemoMode: false` even while the primary host (the only one that ever serves mock data on failure) was silently showing jittered mock containers. `connected` now reflects `result.isLive` for that tick, and `isDemoMode` is keyed off the primary host's live status specifically.
- **Verification:** `cd server && npx tsc` clean. Not client/UI-observable in a way `npx vite build` would catch (server-side calculation only); no client changes made.
- **Not in scope (flagged for a future pass, not fixed here):** container CPU/memory reporting flat `0%` when container-monitoring mode is off is an intentional existing tradeoff (`docker.service.ts` comment: avoids per-container `stats()` polling load) — the real fix is switching to Dockerode's persistent `stats({stream:true})` per running container instead of on-demand polling, which is a bigger architectural change than this pass covers.

---

### [2026-09-21 UTC]
**Agent:** Claude (Perf: Docker stats streaming, cheaper thermal read — Fase 2 of Beszel benchmark)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Docker container CPU/memory now come from a persistent stats stream, not N polls per tick:** `DockerService.ensureStatsStream()` opens one `container.stats({stream:true})` connection per running container (capped at 30, same as before) the first time it's seen while monitoring is active, and leaves it open — `fetchLiveContainers()` just reads whatever line the daemon pushed most recently (`statsStreams.get(id)?.latest`) instead of awaiting a fresh `stats({stream:false})` HTTP round-trip per container every 2s tick. A container that stops or drops out of the top-30 has its stream closed (`closeStatsStream`); turning monitoring off (`setMonitoringActive(false)`) closes all of them immediately (`closeAllStatsStreams`) rather than waiting for the next tick. CPU%/memory math (`computeStatsPercent`) is unchanged — same formula, cheaper transport.
- **CPU package temperature reads `/sys/class/thermal` directly instead of calling `si.cpuTemperature()` every tick:** `SystemService.readCpuTemperatureDirect()` resolves and caches the right `thermal_zone*` path once (preferring one whose `type` mentions cpu/x86_pkg_temp/coretemp), then just parses an integer from its `temp` file on every subsequent call — no sensor-backend probing. `si.cpuTemperature()` is now only a fallback for a platform with no usable thermal zone, and is itself throttled to once per 30s (`readCpuTemperatureViaSiThrottled`) rather than called every 2s.
- **SSL cert checks investigated, no change made:** `SslService.getCertificates()` (`ssl.service.ts`) is entirely mock/hardcoded data with no network I/O at all — there's no real per-tick cost to cache against yet. Flagging this only because it was called out in the original audit; revisit once real certificate checking is implemented.
- **Verification:** `cd server && npx tsc` clean. Not independently client/UI-observable (server-side collection changes only); the owner should watch daemon CPU with container-monitoring mode toggled on for an extended period to confirm the stream approach behaves under real load and reconnects cleanly if a monitored container restarts.

---

### [2026-09-21 UTC]
**Agent:** Claude (Perf: delta-only WebSocket broadcast — Fase 3 of Beszel benchmark)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Periodic broadcasts now send only changed top-level snapshot keys:** `CollectorService.buildDeltaPayload()` compares each top-level `CockpitSnapshot` key (via `JSON.stringify` equality) against the previous tick's snapshot and includes only the ones that differ, wrapped in a new `SNAPSHOT_DELTA` message type. `sslCertificates`, `gitProjects`, `dockerHygiene` (cached 5 min), `sentinel`, and `appVersion` typically don't change every 2s tick and are now skipped entirely rather than re-serialized and re-sent every time; `host`/`storage`/`containers` still change most ticks and are still sent, same as before.
- **A newly connecting client always gets a full `SNAPSHOT` first, never a delta:** `addClient()` now explicitly sends `this.lastSnapshot` (forcing a fresh `collect()` first if polling was paused or none exists yet) instead of relying on the shared `collectAndBroadcast()` call to reach it — that call may now produce a delta if `this.lastSnapshot` was already non-null (e.g. from the boot-time initial collect), which a brand-new client has no base to apply against.
- **Client merges deltas instead of replacing state:** `useCockpitData.ts` handles `SNAPSHOT_DELTA` by spreading the partial payload onto the existing `snapshot` state; a `SNAPSHOT` message still fully replaces it as before. A delta arriving with no existing snapshot (shouldn't happen given the ordering guarantee above) is dropped rather than crashing.
- **Scope note:** the owner's original Fase 3 ask also included Beszel-style aggregated historical retention (1m/10m/2h); scoped that out at their explicit choice since it would add a storage subsystem this repo's CLAUDE.md deliberately doesn't have ("No database beyond small JSON files... no external monitoring stack").
- **Verification:** `cd server && npx tsc` clean; `cd client && npx vite build` clean (1632 modules). `npx tsc -b` still fails on the two pre-existing CSS side-effect import errors (`TerminalView.tsx`, `main.tsx`) already confirmed present on `main` before any of this session's changes — unrelated. No UI click-through performed per repo convention.
**Status:** `[COMPLETED]`
**Activities Completed:**
- **`GitProjectRecord.sshTarget`:** optional, names an entry in `config.sshTargets` (the same list Terminal and remote Processes already use). Plumbed through `register()`, `getSnapshot()`, and validated server-side in the `POST /api/git-projects/:containerName` route against `terminalService.getTargetNames()` before it's stored.
- **Local/remote execution unified behind two dispatch points:** `GitProjectsService.runExec()`/`runCapture()` pick local `execFile`/`spawn` or a new `sshExec()`/`sshCapture()` (over `ssh2`, same library and key `TerminalService` already uses) based on whether the record has an `sshTarget`. Every git/docker call in `register()`, `checkPull()`, `markDeployedFromLocal()`, and `pullAndRebuild()` now goes through one of these instead of a direct `execFile`/`spawn` call, so the exact same fixed command sequence (never request-supplied text) works against either target. `resetPullState()`/`stop()` now cancel through a small `Killable` wrapper instead of assuming a local `ChildProcess`, so a running SSH exec can be cancelled the same way a local one always could.
- **`resolveWorkingTree()` branches by target:** unset `sshTarget` keeps the existing folder-name-under-`gitProjectsRoot` + `fs.existsSync` behavior; a remote project's `localPath` must be an absolute path on that host instead — there's no local filesystem to validate it against, so it's trusted the same way `TerminalService` already trusts full shell access to that target.
- **Self-redeploy guard scoped to local-only:** the out-of-process `homelab-redeploy.sh` branch in `pullAndRebuild()` exists to stop a rebuild from killing this daemon's own process, which isn't a risk on a different host — it's now skipped whenever `sshTarget` is set, even if the container happens to be named `homelab-cockpit`.
- **Client:** `GitProjectModal.tsx` gets a "Runs on" selector (default: this daemon, or any configured SSH target — fetched from the existing `GET /api/ssh-targets`) and adjusts the Local path label/placeholder/helper text for a remote target; the standing warning banner now explains the SSH option instead of stating a flat limitation. `GitProjectsPage.tsx` shows `· ssh:<target>` next to a remote project's repo line. `GitPullInline.tsx`'s self-redeploy reconnect check (`isSelf`) now also excludes projects with an `sshTarget`, matching the server.
- **Docs:** `CLAUDE.md`'s "Docker is multi-host" and "closed set of commands" paragraphs rewritten to describe the SSH dispatch instead of stating the old single-host limitation. `docs/USER_MANUAL.md`'s Git projects section explains the new "Runs on" selector and the remote `localPath` meaning. `announcements.json` got a new `1.4.0` entry; root `package.json` version bumped to match.
- **Verification:** `cd server && npx tsc` clean; `cd client && npx tsc -b && npx vite build` — `vite build` clean (1632 modules, no errors); `tsc -b` fails on two pre-existing CSS side-effect import errors (`TerminalView.tsx`, `main.tsx`) confirmed present on `main` before this change too (verified via `git stash`), unrelated to this feature. No UI click-through was performed (per repo convention — owner tests behavior manually); the owner will need an `SSH_TARGETS` entry configured and reachable to actually exercise a remote pull.

---

### [2026-09-18 UTC]
**Agent:** Claude (Investigate: stale "whitearchive-hosts" fleet label + Git Projects single-host warning)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **"whitearchive-hosts" fleet label — root cause found, no code bug:** Traced the render path end to end — `container.dockerHost` ([ContainerGridSection.tsx](client/src/components/ContainerGridSection.tsx)) comes straight from `this.name` in `docker.service.ts`, which comes from `config.dockerHosts`, computed **once** at process boot from `process.env.DOCKER_HOSTS` (`dotenv.config()` runs once at module load, never re-read). No hardcoded string, no client-side cache — `useCockpitData.ts` holds the snapshot in plain `useState` with no `localStorage`/service worker/React Query involved, so the browser can't be showing stale data on its own. The only way the UI keeps the old name after a confirmed-correct `.env` and a confirmed-correct `docker info` on the host is that the running `homelab-cockpit` container process was never actually recreated with the new environment — `docker restart` reuses the same container's already-baked env; only `docker compose up -d` / `--force-recreate` (i.e. `homelab-redeploy.sh`) re-reads `.env`. Pointed the owner at the existing `[DockerService:<name>] Connected to Docker at ...` boot log line (`docker.service.ts`) as the standing way to verify this after any future host rename. No client or server code changed for this one — it's a deploy-mechanics issue, not a bug.
- **`.env.example` hygiene:** Updated the `DOCKER_HOSTS` example entry from `whitearchive-hosts` to `yado-hosts` to match the host's actual current name.
- **Git Projects single-host limitation, now stated explicitly:** Added a standing (non-dismissible) warning in `GitProjectModal.tsx`, directly under the panel subtitle, explaining that pull & rebuild always targets this daemon's own Docker socket regardless of which configured host tab the tracked container is filtered under — real remote-host support doesn't exist yet.
- **Docs synced:** `CLAUDE.md`'s "Docker is multi-host" paragraph now lists `GitProjectsService`'s pull/rebuild alongside the other primary-host-only services, with the reasoning. `docs/USER_MANUAL.md`'s Git projects section clarifies the host tab strip only filters which container you're linking, not where the rebuild can run. `announcements.json` got a new `1.3.2` entry; root `package.json` version bumped to match.
- **Verification:** `cd server && npx tsc` clean; `cd client && npx tsc -b && npx vite build` clean.

---

### [2026-09-18 UTC]
**Agent:** Claude (Feature: CLI for shortcuts, git tracking, and dashboard actions)
**Status:** `[IN PROGRESS]`
**Scope (locking):** New CLI client under `server/` wrapping the existing authenticated REST API (login/session, shortcuts + shortcut groups, git project tracking, pins, container actions, docker prune, backup, app-update). No changes to `data/` schemas or existing routes planned. Touches: new `server/src/cli.ts` (+ helpers), `package.json` (root + server), `README.md`, `docs/USER_MANUAL.md`, `CLAUDE.md`, `announcements.json`, `docs/screenshots/overview.png`. Proposal sent to owner for review before implementation, per Agent Workflow Rules.

---

### [2026-09-18 UTC]
**Agent:** Claude (Chore: gitignore tsbuildinfo)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Untracked `client/tsconfig.tsbuildinfo`:** Added `*.tsbuildinfo` to `.gitignore` and `git rm --cached` the tracked file. It's TypeScript's incremental build cache — pure local metadata that churned on every `tsc -b` run and showed up as a diff-only noise in `git status`, not something that needs to live in version control.
- **Docs:** Updated the "What not to do" note in `CLAUDE.md` to say `*.tsbuildinfo` is gitignored, replacing the old note that it was "tracked for historical reasons."

---

### [2026-09-18 UTC]
**Agent:** Claude (Fix: per-host container link IPs)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Fixed hardcoded LAN IP in `fetchLiveContainers()`:** `docker.service.ts` used a hardcoded `lanNodeIp = '192.168.18.225'` (docker-host's own IP) for every `DockerService` instance, so containers running on other configured Docker hosts (e.g. `whitearchive-hosts`) got LAN/Tailscale links pointing at docker-host's address instead of their own host — a port collision between hosts (e.g. both exposing something on 8082) opened the wrong service.
- **Per-host IP config:** `DockerHostConfig` (`server/src/config.ts`) now carries optional `lanIp`/`tailscaleIp`. Primary host reads `DOCKER_HOST_LAN_IP`/`DOCKER_HOST_TAILSCALE_IP`; additional hosts use an extended `DOCKER_HOSTS` entry format `name=url|lanIp|tailscaleIp`.
- **`DockerService` uses its own host's IPs:** stores `lanIp`/`tailscaleIp` from its `hostConfig` and uses them in `fetchLiveContainers()` instead of a shared constant. A host without a configured `tailscaleIp` (not yet joined the tailnet, e.g. `dev-host`) now correctly gets no Tailscale link rather than inheriting the primary host's.
- **Docs:** `.env.example` updated with the new env vars and the extended `DOCKER_HOSTS` format, documented with the owner's actual three hosts (`docker-host`, `whitearchive-hosts`, `dev-host`).
- **Note for ops:** requires setting `DOCKER_HOST_LAN_IP`/`DOCKER_HOST_TAILSCALE_IP`/`DOCKER_HOSTS` on the real server `.env` (not just `.env.example`) and redeploying before this takes effect.

---

### [2026-09-15 04:38 UTC]
**Agent:** Claude (Full UI Overhaul + Feature Batch)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Sidebar fix:** `Sidebar.tsx` is now `sticky` (was flow-positioned inside a plain flex row), so it stays put while the page scrolls. `LegacyLayout.tsx` measures header height via `ResizeObserver` and exposes it as `--header-h`.
- **Header redesign:** Settings/Fullscreen/Refresh/Sign out consolidated into one "More" dropdown in `Header.tsx`; Command Deck, Notifications and Theme stay inline.
- **Container Fleet full management:** `ContainerGridSection.tsx` defaults to card view, adds an All/Pinned filter, and every container gets Start/Stop/Restart (existing sort-by control, default name, already covered start-up requirement). `RestartModal.tsx` generalized into a `PowerAction`-aware modal; added `DockerService.stopContainer()`/`startContainer()` and `POST /api/containers/:id/stop|start`.
- **Git Projects last-deploy timestamp:** `GitProjectRecord.lastDeployedAt`, surfaced in snapshot and rendered in `GitPullInline.tsx`.
- **New Logs page (`/logs`):** `AuditLogService` (`data/audit-log.json`) backs a full audit trail (auth, pins, container actions, git actions, backup/restore, config import, plus a global error handler) with filterable UI in `LogsPage.tsx`. Added to Sidebar nav, Command Palette and routes.
- **Shortcuts grouping:** `BookmarkRecord.group`, grouped rendering in `BookmarksSection.tsx`, group datalist in the add/edit modal.
- **AI Agents Monitor:** added a permanent disclaimer clarifying the 5h/weekly numbers are a local T3-session estimate (no Anthropic Console admin API key available), plus `turnsToday` and last-active-time per agent.
- **Animation pass:** added `active:scale-95`/transition polish to sidebar links and toggle.
- **Verification:** `cd server && npx tsc` clean; `cd client && npx tsc -b && npx vite build` clean. No UI click-through was performed (per repo convention — owner tests behavior manually).
- **Not done / explicitly out of scope this round:** real (Anthropic-account-wide) 5h/weekly usage — requires a Console admin API key the owner doesn't have; declined by owner in favor of the local estimate.

---

### [2026-09-15 04:22 UTC]
**Agent:** Gemini (Redeployer Script Documentation for Users & AI Agents)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Comprehensive Documentation for Standalone Redeployer (`homelab-redeploy.sh`):**
  - **`CLAUDE.md`**: Added detailed AI agent briefing section covering out-of-process redeployment architecture, why in-container self-redeploy fails, CLI usage, daemon `--watch` behavior, and rules for agents when handling deploy/redeploy requests.
  - **`README.md`**: Added dedicated section on `homelab-redeploy.sh` explaining out-of-process isolation, manual CLI commands for users, background watcher daemon setup, systemd service registration, and seamless auto-reconnect behavior.
  - **`docs/USER_MANUAL.md`**: Added user manual subsection under Git projects detailing self-redeploy safety, the live log tailing modal, the "Service Restarting" graceful transition, auto-polling of `/api/health`, and manual SSH commands.
- **Verification:**
  - Validated markdown formatting and file cross-references.
  - Build verified (`npm run build`).

---

### [2026-09-14 19:10 UTC]
**Agent:** Gemini (Standalone Out-of-Process Redeployer & Seamless Service Reconnect)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Standalone Out-of-Process Redeployer Script (`scripts/homelab-redeploy.sh` & `/root/homelab-redeploy.sh`):**
  - Created an executable standalone bash runner that operates completely outside the container's process tree, preventing Docker Compose from killing the update process mid-flight when restarting `homelab-cockpit`.
  - Implemented auto-stash of tracked changes, stale `.git/index.lock` cleanup, `git fetch origin <branch>`, `git reset --hard origin/<branch>`, and auto-detection/creation of missing Docker networks (`homelab-net`).
  - Executes `docker compose up -d --build --force-recreate` and writes status updates to `data/redeploy-status.json` and persistent logs to `data/redeploy.log`.
  - Added `--watch` daemon mode to continuously monitor `data/.redeploy-trigger`, allowing triggers from the web dashboard to be processed immediately by host background runners.
  - Copied to `/root/homelab-redeploy.sh` and created a systemd service template `scripts/homelab-redeploy.service`.
- **Backend Out-of-Process Integration:**
  - In `server/src/services/app-update.service.ts`:
    - Updated `startUpdate()` to write to `.redeploy-trigger` and spawn the detached script runner out-of-process.
    - Updated `getUpdateState()` to tail `data/redeploy.log` and read `data/redeploy-status.json` so the dashboard displays live stdout lines directly from the host runner.
  - In `server/src/services/git-projects.service.ts`:
    - Added self-redeploy detection for `homelab-cockpit` / `homelab-dashboard` so it triggers the out-of-process runner instead of in-container Docker commands that terminate the Node.js process.
- **Frontend Seamless Reconnection & Downtime Graceful Recovery:**
  - In `client/src/components/AppUpdateBanner.tsx`:
    - Handled temporary connection drops during Docker container rebuilds.
    - Replaces failure states with a transitional "Service Restarting" status while automatically polling `/api/health`.
    - Automatically reloads the page once the new container boots up and responds with 200 OK.
  - In `client/src/components/GitPullInline.tsx`:
    - Added similar self-redeploy reconnect logic and health polling when updating `homelab-cockpit` / `homelab-dashboard`.
- **Verification & Build:**
  - Validated bash script syntax: `bash -n scripts/homelab-redeploy.sh`.
  - Ran `npm run build`: 0 errors across client and server.
  - Bumped version to `1.1.13` across `package.json`, `version.json`, and `announcements.json`.

### [2026-09-14 15:50 UTC]
**Agent:** Gemini (Removed Beta UI & Instant Primary Node Customization)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Removed Beta UI Entirely:**
  - Deleted `BetaLayout.tsx`, `BetaHeader.tsx`, `BetaSidebar.tsx`, and `HomePageBeta.tsx`.
  - Removed `/beta` routes, route redirect logic, and `beta-ui` body class from `App.tsx`.
  - Removed "Switch to Beta UI" promotional banner from `HomePage.tsx`.
  - Removed Beta UI switcher and button pill from `Header.tsx` and `Sidebar.tsx`.
  - Cleaned up Beta page mappings from `CommandPalette.tsx`.
- **Fixed Primary Node Name Customization:**
  - In `server/src/index.ts`, updated `PATCH /api/settings` to immediately trigger `await collectorService.collectAndBroadcast()` so WebSocket connected clients receive updated telemetry in real-time without delay.
  - In `server/src/services/collector.service.ts`, ensured that both `pveMetrics.nodeName` and `dockerHostMetrics.hostname` adopt the custom node name from `settingsService.getPrimaryNodeName()`. Made `collectAndBroadcast()` public.
  - In `client/src/components/UserSettingsModal.tsx`, streamlined the settings modal into two clean tabs: **Node & Appearance** and **Account Security**. Saved custom node name immediately to `localStorage` and dispatched `cockpit_settings_updated` custom window event, triggering instant optimistic UI updates.
  - In `Header.tsx` and `HomePage.tsx`, hooked into the dynamic node name cache and custom settings event so node label updates render immediately across all views.
- **Verification & Build:**
  - Verified compilation and build: `npm run build` passed with 0 errors across server and client.
  - Bumped version to `1.1.12` across `package.json`, `version.json`, and `announcements.json`.

---

### [2026-09-14 14:35 UTC]
**Agent:** Gemini (User Settings Hub, Node Renaming & Git Project Failure Recovery)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **User Settings Modal (UserSettingsModal.tsx):**
  - Added dedicated Settings modal accessible via the Settings icon in both Classic (`Header.tsx`) and Beta (`BetaHeader.tsx`) headers.
  - Implemented UI Style Preference selection with descriptive names: **Classic Glassmorphism** (`/`) vs **Neo-Brutalism (Beta)** (`/beta`), with automatic route navigation and persistent storage in `localStorage` (`cockpit_preferred_ui`).
  - Added Dark / Light color mode toggle.
  - Implemented dynamic **Primary Node Name** customization with persistence in server-side `data/settings.json` via `SettingsService` (`GET /api/settings`, `PATCH /api/settings`), with one-click reset to default.
  - Hooked custom node name into `CollectorService`, automatically updating `pve.nodeName` across all client telemetry views and headers.
  - Implemented **Login / One-time Password Change** form calling `POST /api/auth/change-password` with current password validation using timing-safe scrypt verification and salt generation.
- **Git Projects Failed State Recovery & Repull/Redeploy:**
  - In `GitPullInline.tsx`, resolved the issue where a failed check (`check.ok === false`) rendered only red text with no action buttons. Added prominent **"Repull & Redeploy (Force Sync)"** and **"Retry Check"** buttons.
  - When `pullState.status === "failed"`, added an explicit **"Repull & Redeploy"** action button styled as `btn-danger`.
  - In `git-projects.service.ts`, added automatic stale `.git/index.lock` removal before running git operations in both `checkPull()` and `pullAndRebuild()`.
  - Exposed `lastPullStatus` and `lastPullMessage` in `GitProjectStatus` snapshot telemetry, rendering a clear `Deploy failed` badge in `GitProjectsPage.tsx`.
- **Quality & Parity Assurance:**
  - Maintained 100% design token compliance using CSS RGB triplets.
  - Verified compilation and build: `npm run build` passed with 0 errors across server and client.
  - Updated `announcements.json`, `version.json`, and `package.json` to `1.1.11`.

---

### [2026-09-14 12:25 UTC]
**Agent:** Gemini (Feature Parity Rules & Layout Architecture Documentation)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Created Comprehensive Layout Architecture Guide:** Added `docs/LAYOUT_AND_STYLES_GUIDE.md` containing the complete 100% Feature Parity Checklist, base code component wiring map, and step-by-step instructions for creating new UI styles without dropping features.
- **Updated Agent Rules in CLAUDE.md:** Added `## UI Styles, Layout Variants & 100% Feature Parity Rule` and mandated that any agent creating/modifying styles or features MUST update `docs/LAYOUT_AND_STYLES_GUIDE.md` and `CLAUDE.md`.
- **Linked Design System Documentation:** Updated `docs/DESIGN_SYSTEM.md` with cross-references to the parity checklist.

---

### [2026-09-14 12:20 UTC]
**Agent:** Gemini (Beta UI Feature Parity & Shortcuts System)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Command Palette Beta Routing:** Updated `CommandPalette.tsx` to detect active `/beta` routes and dynamically rewrite page destinations so navigation stays within the Beta UI.
- **Beta Header Enhancements:** Added missing `NotificationsPanel`, active `username` badge, and keybinding indicator `Ctrl K` on the CMD trigger button in `BetaHeader.tsx`.
- **Collapsible Beta Sidebar:** Added collapse/expand state toggle with `localStorage` persistence (`cockpit-beta-sidebar-collapsed`) to `BetaSidebar.tsx`.
- **Complete Host Vitals on Beta Overview:** Implemented real-time CPU usage % with status tones, RAM used vs total metrics, thermal package sensor with color-coded alerts, pinned container count, and expanded quick actions in `HomePageBeta.tsx`.
- **Personal Web Shortcuts & Styling:** Integrated `BookmarksSection` with empty state CTA button in `HomePageBeta.tsx`, and added high-contrast `.shortcut-card` brutalist styling in `index.css`.
- **Scoped Beta Notice:** Scoped the persistent Beta notice banner in `BetaLayout.tsx` exclusively to `/beta` overview with a dismiss button to keep sub-pages uncluttered.
- **Version Bump:** Bumped to version 1.1.10 in `package.json` and `version.json`, added release entry in `announcements.json`.

---

### [2026-09-14 12:15 UTC]
**Agent:** Gemini (Force Pull & Resilient Redeploy for Git Projects)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Identified Root Cause:** Standard `git pull` aborted when tracked files (such as `docker-compose.yml`) had local modifications on disk.
- **Implemented Force Sync Pipeline:** Replaced `git pull` in `git-projects.service.ts` with `git fetch origin <branch>` and `git reset --hard origin/<branch>`, guaranteeing clean deployment without aborting.
- **Data & Environment Protection:** Integrated auto-stash (`git stash push -m "Auto-stashed before pull and redeploy"`) prior to reset to safeguard tracked edits, while preserving all untracked runtime files (.env, bind mount data, databases).
- **Version Bump & Announcements:** Added release announcement to `announcements.json` for v1.1.9 and bumped `package.json` and `version.json`.

---

### [2026-09-14 11:51 UTC]
**Agent:** Gemini (Fix Window Auto-Scroll Bug during App Update)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Identified Root Cause:** Located `scrollIntoView()` on dummy child div in `AppUpdateBanner.tsx` that hijacked the browser `window` scroll every 1 second during update log streaming.
- **Container-Scoped Auto-Scroll:** Replaced `scrollIntoView()` with `scrollTo({ top: scrollHeight })` called directly on the scrollable terminal `div` container via `logContainerRef`.
- **Preserved User Scroll Control:** Scrolling up inside the terminal continues to disengage auto-scroll without window disruption, allowing users to scroll freely to earlier logs or browse the page.
- **Version Bump & Announcements:** Updated `announcements.json` for v1.1.8 and bumped `package.json` and `version.json`.

### [2026-09-14 11:43 UTC]
**Agent:** Gemini (Beta UI Perfection, Mobile Layout & Dedicated Storage/DAS Real-time SMART Watchdog)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Dedicated Storage & DAS Watchdog Section:** Relocated `StorageMatrixSection` out of the 3-column grid in `InfraPage.tsx` into its own full-width dedicated section, while Tailscale and SSL sections now share a balanced 2-column grid.
- **Real-Time SMART & I/O Telemetry:** Re-engineered `StorageMatrixSection.tsx` with live SMART health diagnostics (`PASSED`/`WARNING`/`FAILED`), live I/O throughput rates (Read/Write MB/s), disk active time %, latency, and detailed Proxmox LVM-thin allocation workload tiers.
- **Canary Watchdog Visual Guard:** Upgraded external DAS bay monitoring with live canary heartbeat indicators, preventing root filesystem overflow if an external enclosure disconnects.
- **HomePage Beta Overview Vitals:** Added real-time Storage & DAS Watchdog summary card to the Core Vitals grid on `HomePageBeta.tsx`.
- **Universal Brutalist Styling Engine:** Extended `.beta-ui` in `index.css` with universal `rounded-none`, `backdrop-blur-none`, snappy 0.08s brutalist slide animations, sharp brutalist scrollbars, and styled tables (`th`, `td`).
- **Mobile Responsiveness Polish:** Optimized header action buttons and touch-scroll mobile navigation strip in `BetaHeader.tsx` without horizontal clipping or scroll blowout.
- **Version Bump & Announcements:** Updated `announcements.json` for v1.1.7 and bumped `package.json` & `version.json`.

---

### [2026-09-14 05:00 UTC]
**Agent:** Gemini (Real-Time Updater Engine & Unified Commit Sync v1.1.3)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Real-Time Update Engine:** Added 30-second client-side polling in `AppUpdateBanner.tsx` and reduced `githubCheckIntervalMs` to 60s in `server/src/config.ts`.
- **Auto-Fetch on Check:** Updated `checkForUpdates()` in `app-update.service.ts` to run `git fetch origin ${branch}` and inspect local repo.
- **Accurate Divergence Detection:** Eliminated version semver false-positives so that differing commit SHAs between local `HEAD` and remote `origin/main` always trigger an update status.
- **Resilient Rebase & Reset Fallback:** Hardened `performUpdate()` to use `git pull --rebase origin ${branch}` with clean fallback to `git reset --hard origin/${branch}` to prevent stalled state on diverged local commits.
- **Integrated Docker & Compose from docker-host:** Unified `Dockerfile` (optimized packages) and `docker-compose.yml` (mounted read-only `/root/.t3` volume for AI Agent telemetry).
- **Bumped Version to 1.1.3:** Added release announcement in `announcements.json` and bumped `version.json` and `package.json` to `1.1.3`.

---

### [2026-09-14 04:52 UTC]
**Agent:** Gemini (Fleet Card View Sort Controls)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Default Sort by Name:** Changed default sorting in Container Fleet (`client/src/components/ContainerGridSection.tsx`) from `cpu` (desc) to `name` (asc A-Z).
- **Sort Controls in Cards View:** Added dedicated Sort By dropdown (Name, CPU, RAM, Network) and toggle order button (ASC / DESC with direction arrow icons) in the toolbar when in Card View mode.
- **Bi-directional Order Memory:** Made column toggles default to ascending for name and descending for resource metrics (CPU/RAM/NET).

---

### [2026-09-13 16:47 UTC]
**Agent:** Gemini (Show Google Account Email on Antigravity Cards)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Show User Email for Antigravity Cards:** Updated `server/src/services/ai-agents.service.ts` to dynamically inherit and display the user's Google account email (`suryatmaja.dev@gmail.com`) for all Gemini / Antigravity agents (Default, Auth, Marmut) instead of a generic "Google account" label.

---

### [2026-09-13 16:38 UTC]
**Agent:** Gemini (Fix Updater Build & Announcements v1.1.2)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Configured Monorepo Workspaces in root `package.json`:** Added `"workspaces": ["client", "server"]` so that running `npm install` automatically installs dependencies across both sub-projects and links binary executables (`tsc`, `vite`).
- **Hardened Subprocess Environment in `app-update.service.ts`:** Injected local and workspace `node_modules/.bin` paths into `PATH` and set `NODE_ENV=development` with `--include=dev` during `npm install` so TypeScript compiler (`tsc`) is guaranteed to be available during self-update builds.
- **Published v1.1.2 Announcements in `announcements.json`:** Added rich update announcement covering AI Agents Monitor, Glassmorphism UI, Fleet Cards view, and self-updater stability improvements.
- **Bumped Version:** Updated `version.json` and `package.json` to version `1.1.2`.

---

### [2026-09-13 16:30 UTC]
**Agent:** Gemini (Hotfix Husky / Self-Updater)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **Fixed Husky Lifecycle Script in package.json:** Changed `"prepare": "husky"` to `"prepare": "command -v husky >/dev/null 2>&1 && husky || true"` so that running `npm install` inside production / container environments where devDependencies are omitted will no longer fail with `sh: husky: not found (exit code 127)`.

---

### [2026-09-13 16:25 UTC]
**Agent:** Gemini (AI Agent Usage Monitor)
**Status:** `[COMPLETED]`
**Activities Completed:**
- **AI Agents Monitor Feature:** Implemented backend service (`server/src/services/ai-agents.service.ts`) and Fastify endpoint (`/api/ai-agents/telemetry`) tracking local T3 Code sessions, caches (`caches/*.json`), and SQLite turn history (`userdata/state.sqlite`).
- **Telemetry Metrics:** Calculated 5-hour rolling window usage, cooldown countdown timers, and past 7-day weekly activity histograms per agent (Claude Pro, Gemini Default, Auth, Marmut).
- **UI Frontend (`client/src/pages/AiAgentsPage.tsx`):** Added responsive glassmorphism view with agent cards, live running indicators, progress meters, interactive mini bar charts, and real-time interaction log stream.
- **Navigation Integration:** Added route `/ai-agents` in `App.tsx` and updated `Sidebar.tsx` / `Header.tsx` with `Sparkles` icon.
- **Docs:** Updated `docs/USER_MANUAL.md` and `README.md` detailing the T3 Code zero-API-key architecture and configuration instructions.

---

### [2026-09-14 13:42 UTC]
**Agent:** Antigravity (Bugfix: Search Component Icon Overlap)
**Status:** 
**Activities Completed:**
- **Fixed Search Icon & Input Text Overlap in Beta UI:** Removed hardcoded `px-3.5 py-2` from `.beta-ui .field` in `client/src/index.css` which had a CSS specificity of (0, 2, 0) and was overriding utility classes like `pl-8` with `px-3.5` (14px), causing placeholder text and typed queries to collide directly with the 14px Search icon.
- **Enhanced Search Padding and Spacing:** Applied `!pl-9 pr-7` and aligned Search icons with `left-3` across `ContainerGridSection.tsx`, `ProcessesPage.tsx`, and `GitProjectModal.tsx` for a clean 10px spacing buffer.
- **Added One-Click Clear Search Button:** Added an interactive `X` button inside the search inputs that appears when text is entered, allowing quick clearing of search filters.
