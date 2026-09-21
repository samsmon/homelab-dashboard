# Working brief for AI coding agents

Read this before changing anything. It exists so an agent, or someone driving one, lands on the conventions this repo already follows instead of inventing new ones.

## What this is

A homelab dashboard in two parts: a Fastify daemon that polls Proxmox, Docker, Tailscale and the filesystem every two seconds, and a React client that renders the snapshot. No database beyond small JSON files under `data/` (auth, pins), no external monitoring stack. The daemon is the only thing that talks to infrastructure.

Stack: TypeScript throughout, Fastify 5 and Dockerode on the server, React 18 with Vite 6, React Router 6 and Tailwind 3 on the client.

## Commands

```bash
npm run dev:server   # daemon on :3000
npm run dev:client   # Vite on :5173, proxies /api and /ws to :3000
npm run build        # both
```

Verify a client change with `cd client && npx tsc -b && npx vite build`; verify a server change with `cd server && npx tsc`. That's the extent of automated verification in this repo — the owner tests behavior manually, so don't drive a browser to click through the UI on their behalf. Report what you changed and let them try it.

The daemon runs without any configuration: with no Docker socket and no Proxmox token it serves generated telemetry and sets `isDemoMode`. That is the normal development path on Windows and macOS.

## Repo map

```
server/src/index.ts              routes, auth guard, WebSocket broadcast
server/src/services/             one file per data source, including auth, pins, bookmarks, notifications, git projects, backup and terminal
server/src/types.ts              server-side shape of the snapshot
client/src/context/AuthContext   session state, login, register, logout
client/src/utils/api.ts          authFetch, the only way to call /api
client/src/App.tsx               router, persistent shell (sidebar, header, palette, modals)
client/src/pages/                one file per route, thin — real content lives in components/
client/src/hooks/useCockpitData  WebSocket with HTTP polling fallback
client/src/hooks/useTheme.ts     light/dark state, localStorage, system fallback
client/src/components/           one file per section or modal
client/src/components/Sidebar.tsx  page nav (floating, collapsible) — NAV_ROUTES lives here now, not Header.tsx
client/src/components/CommandPalette.tsx  Ctrl+K palette: pages + pinned containers only
client/src/utils/formatters.ts   byte, rate, uptime, redaction, thresholds
client/src/types.ts              client-side shape of the snapshot
client/tailwind.config.js        design tokens (CSS variables, see below)
client/src/index.css             token values per theme, shared component classes
```

`server/src/types.ts` and `client/src/types.ts` are maintained in parallel by hand. Change one and you must change the other, or the client will silently render `undefined`.

## Rules that matter

**Use the design tokens.** Colours come from `cockpit-*` and `state-*` in the Tailwind config, never as literal hex in a component. Layout patterns come from the component classes in `index.css`. If a change needs a new colour, read [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) first; the answer is usually a different structure, not a new hue.

**Token values are `R G B` triplets, never hex.** Every `cockpit-*`/`state-*` token is defined in `index.css` as `--name: R G B;` and consumed in `tailwind.config.js` as `rgb(var(--name) / <alpha-value>)`. A hex value there silently breaks every `/NN` opacity usage (there are dozens) with no build error — Tailwind just drops the opacity. Add both a `:root` (dark) and `:root.light` value for any new token.

**The accent is not a status colour.** `cockpit-accent` marks interactive and neutral-informational things. `state-good`, `state-warn` and `state-bad` mean healthy, degraded and failed. Mixing the two makes the dashboard unreadable at a glance, which is the only thing it is for.

**Thresholds live in one place.** `getStatusColor` and `getTempColor` in `formatters.ts` decide when a number turns amber or red. Do not inline threshold comparisons in a component.

**Monospace and `tabular-nums` for anything numeric** that a person compares across rows. Values that jitter as they update are a bug.

**Every protected request goes through `authFetch`.** Plain `fetch` against `/api` returns 401 for anything outside `/api/health` and `/api/auth/*`. `authFetch` in `client/src/utils/api.ts` attaches the bearer token; the WebSocket passes the same token as a query parameter. Auth state lives in `AuthContext` and nothing else should read `localStorage` for it.

**Respect privacy mode.** Any IP, hostname or domain rendered in the client goes through `redactText(value, isPrivacyMode)`. A new field that leaks an address in a screenshot defeats the feature.

**Respect reduce-motion.** Global handling exists in `index.css`. Never make an animation the only way information is conveyed.

**Destructive actions are confirmed and scoped.** Restart and prune each go through a modal that names exactly what will happen. Prune touches dangling layers and build cache only. The Telegram companion additionally requires an allowlisted user ID and a `/confirm` inside 60 seconds. Do not add a path that skips these.

**Pins are server-owned, not client state.** `PinsService` (`server/src/services/pins.service.ts`) is the only writer of `data/pins.json`. The client never persists a pin itself — it calls `POST`/`DELETE /api/pins/:name` and waits for the next snapshot to reflect it. `CollectorService` merges `isPinned`/`publicUrl` onto each container by name before it reaches the client; don't duplicate that merge client-side.

**Never hardcode this owner's hardware into a component.** Host name, CPU model, RAM, IPs and drive labels must be read from `snapshot.host`/`snapshot.storage`/`snapshot.dockerHosts`, or from `config` server-side — never written as a literal string in `client/src/`. This has already happened once: `Header.tsx`, `HomePage.tsx`, `App.tsx` and `AuthScreen.tsx` all had "Lenovo ThinkCentre M710q Tiny", a specific CPU model, and the literal IPs `192.168.18.224`/`.225` hardcoded regardless of what `PROXMOX_URL`/`DOCKER_SOCKET` were actually configured to. Same rule for storage labels: `system.service.ts`'s `getStorageMatrix` used to guess a label and a fabricated drive size from whether the mount path contained the words "media", "cloud" or "music" — a different owner's `STORAGE_MOUNTS` would silently get someone else's drive names. It now falls back to `autoLabel()` (derived from the mount's own folder name) unless `STORAGE_LABELS` sets one explicitly. When you add a new field that describes physical hardware, ask where it's sourced before writing it — if the honest answer is "I'm guessing based on this repo's original setup," it needs a config option or a fallback derived from real data instead.

**Docker is multi-host; most other services are not.** `CollectorService` holds a `DockerService[]`, one per entry in `config.dockerHosts` (`server/src/config.ts`), and every `ContainerMetric` carries `dockerHost` so it can be traced back to the instance that produced it. `CollectorService.getDockerServiceForContainer(id)` is how a route finds the right instance — never assume there's exactly one. Everything else (`ProxmoxService`, `SystemService`, disk hygiene, prune, the Sentinel bot) is scoped to the primary host only, because host-level OS vitals are only ever readable for the machine the daemon runs on and each host has its own separate disk. Only the primary `DockerService` (`index === 0`) generates mock/demo containers; don't make a second configured host duplicate that fallback.

`GitProjectsService` can now target a remote host: a tracked project may carry an optional `sshTarget` naming an entry in `config.sshTargets` (the same list Terminal and remote Processes already use), and every command `pullAndRebuild()`/`checkPull()` runs — `git fetch`, `git reset --hard`, the rebuild's `docker compose` invocation — goes over SSH to that host instead of this daemon's own `docker.sock` when it's set. This is not a widening of `TerminalService`'s trust boundary: an `SSH_TARGETS` entry already grants the owner's key full interactive shell access (see the Terminal section below), so running a fixed `git`/`docker` sequence there is strictly narrower than what that target already trusts this daemon with. `localPath` means something different depending on `sshTarget`: unset, it's still a folder name resolved under `config.gitProjectsRoot` and checked with `fs.existsSync` as before; set, it must be an absolute path *on that remote host* — there is no local filesystem to resolve or check it against, so `resolveWorkingTree()` only requires it to start with `/` and lets `git`/`docker` fail with their own error if it's wrong. `runExec()`/`runCapture()` are the dispatch points inside `GitProjectsService` that pick local (`execFile`/`spawn`) or remote (`ssh2` `Client.exec`, same library `TerminalService` uses) execution — a new host-touching step in this service should go through one of those two, never a direct `execFile`/`spawn` call, so it keeps working for both. The self-redeploy branch in `pullAndRebuild()` (the out-of-process `homelab-redeploy.sh` dance) stays local-only on purpose: it exists to protect *this daemon's own process* from being killed by its own rebuild, which isn't a risk on a different host, so it's skipped whenever `sshTarget` is set. `GitProjectModal.tsx`'s "Runs on" selector is the only place `sshTarget` is set, from the same `GET /api/ssh-targets` name list Processes and Terminal already use — never a client-supplied host/user/port, matching every other use of `SSH_TARGETS` in this repo.

**Pinning replaced the native console launcher; don't bring the launcher back.** The command palette used to also list a hardcoded set of native consoles (Proxmox, Portainer, NPM, Netdata, Uptime Kuma, AdGuard, the web IDE, Jellyfin) alongside pinned containers — that list is gone, along with `NativeConsoleItem` and `snapshot.consoles`. Pinning a container is now the only way anything ends up in the palette besides the four pages. If the owner wants quick access to something, the answer is "pin it," not "add another hardcoded entry."

**A container's reachable address always resolves `publicUrl → tailscaleUrl → lanUrl`, in that order, everywhere.** Don't reintroduce a "pick LAN or Tailscale based on how the dashboard itself was loaded" branch for this — that was the previous (wrong) logic in the command palette, and it meant the same pinned container opened a different address depending on which network you were on when you clicked it. `PinsService.pin()` also normalizes a bare domain into an absolute URL (adds `https://` if the owner typed one without a scheme) before it's ever stored — `window.open()` on a schemeless string resolves it as a path relative to the dashboard's own origin, not as the container's address, so this has to happen server-side, once, not repeated ad hoc on the client.

**External API calls never run on the 2-second poll tick.** `GitProjectsService.getSnapshot()` (`server/src/services/git-projects.service.ts`) is called from `CollectorService.collect()` every `pollIntervalMs`, but it never awaits the network itself — it returns cached values instantly and fires a background refresh only when the cache is older than `config.githubCheckIntervalMs` (5 minutes by default). Calling an external API (GitHub, or anything else added later) synchronously inside `collect()` would hit that service's rate limit within seconds at a 2s poll interval. Any future integration with a real-world rate limit needs this same cache-and-throttle shape, not a direct await in the hot path.

**`GitProjectsService` and `BackupService` are the only code in this repo that runs a shell command against a host filesystem**, and both do so from a fixed argv — `cmd` and `args` chosen server-side, never a shell string built from request input. `pullAndRebuild()` resolves its `docker compose` argv from a fixed `RebuildCommand` enum stored at registration time (`git-projects.service.ts`); a request only ever names *which* registered project to act on, never *what command* runs. Locally this runs through `child_process.execFile`/`spawn`; for a project with `sshTarget` set, `runExec()`/`runCapture()` route the exact same `cmd`/`args` through `ssh2`'s `Client.exec()` instead — the argv is still assembled server-side and only shell-quoted (never interpolated raw) before being joined into the one string `ssh2` requires, so this is the same "closed set of commands" shape over a different transport, not an exception to it. `BackupService` (`backup.service.ts`) only ever calls `rclone sync <a> <b>` with `a`/`b` built from `config.backup.sourcePaths` and `config.backup.rcloneRemote`, never from request input, and `unzip` with an explicit, hardcoded member list (`IMPORT_ALLOWED_FILES`) rather than whatever's actually in the downloaded archive. Any new feature that needs to execute something on the host (local or, following `GitProjectsService`'s pattern, over one of `config.sshTargets`) must follow this same shape: a closed set of possible commands chosen ahead of time, resolved server-side, keyed by an id in the request — not free text.

`resolveWorkingTree()` in `git-projects.service.ts` guards against `localPath` escaping `config.gitProjectsRoot` (`/projects` inside the container, bind-mounted from `GIT_PROJECTS_ROOT` on the host) via `path.resolve` plus a prefix check. Don't build a path from owner input and pass it to `execFile`'s `cwd` without that same check — `localPath` is stored data, not something re-validated on every call elsewhere.

`checkPull()` is deliberately read-only — `git fetch` and `git diff` only, never `git pull` — so it's safe to call speculatively before the owner confirms.

**Auto-deploy is opt-in per project and only runs through the same migration-risk gate as the manual button.** `GitProjectRecord.autoDeploy` (set via the edit dialog's checkbox, never a global switch) makes `refresh()` call `autoDeployIfSafe()` whenever a fresh GitHub check finds a commit that differs from `lastKnownSha`. That method calls `checkPull()` first — if it reports any migration-risk file, it sets `autoDeployBlocked` and returns without touching anything, leaving the project for a manual, informed pull; only a clean check reaches `pullAndRebuild()`. Don't add a way to force auto-deploy past a migration-risk finding — the whole point of the heuristic is a human looks at the list first, and that doesn't stop being true just because the deploy is automatic. `register()` itself tries this too, best-effort: if a `localPath` is present and there's no baseline yet, it reads `git rev-parse HEAD` from that working tree right at track-time, so a project that's already running doesn't need a manual step at all in the common case. `markDeployedFromLocal()` is the fallback for when that couldn't happen — the path didn't exist yet, wasn't a git repo, or no `localPath` was set at track-time — so the owner can still record whatever commit is actually on disk later via that button, and its client-side button (`canMarkDeployed` in `GitProjectsPage.tsx`) stays available even after a baseline already exists, not just before the first one — the baseline can go stale any time the project is deployed by something other than this dashboard, and that's the only way to resync it once it has. Neither `register()` nor `markDeployedFromLocal()` assumes the latest GitHub commit is what's deployed just because the container is running; both read the actual checked-out SHA. `checkPull()` also self-heals the same drift on its own: if a fresh `git fetch` shows zero file differences between `HEAD` and `origin/<branch>` but the stored baseline still disagrees, it updates the baseline right there — otherwise a project could sit at "Update available" forever with the Pull & rebuild button correctly showing nothing to pull, and no way to reconcile the two.

**Pull & rebuild runs in the background and streams its own log — there is no modal that blocks navigation.** `startPull()` returns immediately after setting `pullStates.get(containerName).status` to `'pulling'`; the actual work happens in `pullAndRebuild()`, which now runs both `git pull` and the rebuild command through `spawnCapture()` (a thin wrapper over `child_process.spawn`, not `execFile`) specifically so stdout/stderr stream into that project's log array as they happen rather than only being available after the whole thing exits. `GitPullInline.tsx` (mounted inline under a project row, not a modal) polls `GET .../pull-status` every second while a run is active and re-fetches it once on mount regardless, so navigating to another page and back — or opening the row from a different browser tab — always shows whatever's actually happening server-side, never a stale local guess. `pullAndRebuild()` is still the single entry point auto-deploy also calls directly (awaited, not through `startPull()`), so both paths share the same live log and the same "one run at a time per project" guard in `startPull()`. The rebuild command argv is still resolved server-side from the project's own `rebuildCommand` exactly as before — `spawn` didn't loosen the "closed set of commands" rule, it only changed how the output is captured.

**"Rebuild anyway" exists because "up to date" can lie about what's actually running.** `GitPullInline.tsx` shows this instead of "Pull & rebuild" when `checkPull()` finds zero changed files — it calls the exact same `startPull()` as a normal pull, `git pull` included (a no-op when there's genuinely nothing new), so this is not a different code path or a way to skip anything; it exists because a stale image layer cache or a rebuild that silently failed last time can leave a container not actually matching its own "up to date" checked-out commit. Don't gate this button behind `hasUpdate` — the entire point is running it when the dashboard says there's no update.

**Notifications are a flat activity feed, not a message queue.** `NotificationsService` (`data/notifications.json`, capped at 50 entries) is written to directly by the handful of call sites that already mutate state — pin/unpin in `index.ts`, register/unregister and every pull lifecycle transition in `GitProjectsService` — there's no central event bus to plug into. `NotificationsPanel.tsx` polls `GET /api/notifications` every 8 seconds and only fires a browser `Notification` for entries newer than the last one it had already rendered, gated behind a per-browser opt-in (`localStorage`, not a server setting) so this dashboard never requests OS notification permission without the owner explicitly asking for it.

`GitProjectsService.refreshAll()` is the one place besides `getSnapshot()`'s background refresh that calls GitHub — it exists only for the manual Refresh button on the Git projects page and awaits every registered project's check directly, ignoring `githubCheckIntervalMs`. Don't call it from anywhere on the poll path; it's a deliberate exception to the cache-and-throttle rule above, made safe by being opt-in and rate-limited by the owner's own clicking, not by a timer. The migration-risk pattern list (`MIGRATION_RISK_PATTERNS`) is a heuristic that can both miss real migrations and flag unrelated files; don't present it in the UI as a guarantee.

**Restore and config import are two different features at two different scales — don't conflate them.** `BackupService.runRestore()` reverses the same `rclone sync` used for backup and is meant for disaster recovery (the whole fleet, potentially large); it requires `{ confirm: true }` in the request body on top of the client's own confirmation modal, because it overwrites live paths. `importConfig()` is deliberately narrow: it downloads at most `IMPORT_MAX_BYTES` (20MB) from a public link, verifies zip magic bytes before touching disk, and extracts *only* `pins.json`/`git-projects.json` by name via `unzip`'s explicit-member-list form — never `data/auth.json`, so a bad or malicious import can't lock the owner out or swap their credentials. If either limit or the auth.json exclusion ever needs lifting, that's a decision for the owner to make explicitly, not something to relax while extending the feature.

**`TerminalService` is deliberately the one exception to "closed set of commands, resolved server-side."** Every other host-touching service (`GitProjectsService`, `BackupService`) runs one fixed command chosen ahead of time; the terminal is a real interactive shell over SSH with no whitelist, because the feature *is* "run anything." Its containment comes from a different direction: `config.sshTargets` is parsed once from `SSH_TARGETS` at boot and there is no route that registers, edits or lists more than target *names* (`GET /api/ssh-targets` never returns host/user/port) — never add a way to add or modify a target from a running request. Don't reuse `TerminalService`'s pattern (raw byte-stream bridging over a WebSocket with no per-message validation) for anything else in this repo; it's correct here only because the whole point is unrestricted shell access to a host the owner already trusts, which is not true of any other feature.

**Disk performance reads `/proc/diskstats` directly; it needs no new mount, binary or `.env` entry.** `SystemService.getDeviceKey()` maps a `STORAGE_MOUNTS` path to its block device via `fs.statSync(path, { bigint: true }).dev`, decoded into `major:minor` with the standard glibc macros, then looked up in `/proc/diskstats` (unprivileged and host-global — Docker doesn't namespace it, so no bind mount is required). Rates and active-time percent come from the same delta-over-time pattern as `docker.service.ts`'s container network rates, kept in `SystemService`'s own per-mount history map. A mount on LVM/device-mapper resolves to the mapper's own stats, not the physical disk underneath; this degrades to "not available" for that one volume, never an error for the whole panel. `DiskActivityGraph.tsx` is a deliberately larger, to-scale SVG chart — unlike every other `Sparkline.tsx` usage in this repo, it's meant to be read like a real graph, not a small trend indicator, so don't collapse it back into the sparkline convention. `DiskPerformancePanel.tsx` always renders one tab per entry in `snapshot.storage`, even for a mount whose performance fields didn't resolve — don't filter the tab strip down to only the mounts with data, or a volume silently disappears instead of showing "not available"; that was a real bug (the panel only ever showed one disk because everything else got filtered out before it ever rendered a tab).

**Infra is two sub-views, not one long scroll.** `InfraPage.tsx` holds a local `view` state (`overview` | `performance`) switched with a `.seg` control, not a route — this is deliberately not a fifth top-level page, since it's still "the Infra page," just split so the live hardware-performance view (`HostDetailPanels` + `DiskPerformancePanel`, both internal and external drives) doesn't compete for space with the capacity/inventory view (`DockerHostsPanel`, `StorageMatrixSection`, `TailscaleMatrixSection`, `SslTrackerSection`, `BackupPanel`). If a new metric is host-vitals-shaped (something that changes second-to-second and answers "how hard is this working right now"), it belongs in Performance; if it's inventory-shaped (what's configured, how full, what's tracked), it belongs in Overview.

**Processes is a real page with its own poll loop, not part of the 2-second snapshot.** `GET /api/processes` (`SystemService.getProcesses()`, using `systeminformation`'s `si.processes()`) is deliberately not merged into `CollectorService`'s broadcast snapshot — a full process list is heavier to gather than everything else in the poll and only `ProcessesPage.tsx` ever needs it, so that page polls the endpoint on its own 3-second interval instead of riding the WebSocket. Per-process disk I/O comes from reading `/proc/[pid]/io` directly (same delta-over-time shape as the diskstats and docker sparkline code, keyed by PID in `SystemService`'s own history map, evicted once a PID stops appearing in the list) — Linux-only and best-effort, since a process can disappear between two polls or belong to another user the daemon can't read `/proc/<pid>/io` for.

**Processes has three sources, picked with a `.seg` tab, each with its own endpoint and poll rate — never merge them into one list or one poll loop.** "This host" is `SystemService.getProcesses()` above. "Docker containers" (`GET /api/processes/docker`, `DockerService.getContainerProcesses()`) uses dockerode's `container.top()` per running container per configured host — no SSH, no new mount, just the Docker API this service already talks to; a container whose `ps` doesn't support the default args (common on distroless/minimal images) is skipped, not treated as an error for the whole list. One tab per SSH target (`GET /api/processes/remote/:target`, `TerminalService.getRemoteProcesses()`) runs a single hardcoded `ps -eo pid,%cpu,%mem,rss,user,comm ... | head -50` over a short-lived SSH connection — this is the one narrow, deliberate exception to `TerminalService` never running a fixed command: every target here already grants the owner's key full interactive shell access, so one read-only `ps` is strictly narrower than what the target already trusts this daemon with, not an escalation. It's cached for `REMOTE_PROCESS_CACHE_TTL_MS` (4s) since opening a fresh SSH connection on every poll would be wasteful, and the client only polls the tab that's actually selected — not all three sources in the background.

**Bookmarks are the one server-owned feature that stores something with zero relationship to the daemon's own infrastructure.** `BookmarksService` (`data/bookmarks.json`) is a plain personal link list — YouTube, Gmail, whatever the owner reaches for — following the exact shape of `PinsService` (server-owned, normalizes a schemeless URL the same way, client never persists it itself). Don't try to validate or fetch the target URL server-side; unlike a container's `publicUrl`, a bookmark can point anywhere on the internet on purpose.

**The clock/weather widget is the one thing in this client that talks to a third party directly, not through `/api`.** `ClockWeatherWidget.tsx` calls the browser's own `navigator.geolocation` and then Open-Meteo's public API (no key, no server involvement) straight from the client — coordinates never pass through this daemon. It's opt-in: the widget shows a "Weather" button rather than prompting for location on page load, since a location permission popup nobody asked for is the kind of surprise this dashboard doesn't do anywhere else. Don't route this through `authFetch` or proxy it via a new server route — there's nothing for the daemon to add here, and doing so would mean the owner's location touches server logs for no reason.

**The sidebar is the page nav; the header's desktop `<nav>` is gone.** `Sidebar.tsx` renders `NAV_ROUTES` as a floating, collapsible left rail (collapsed state in `localStorage`, per-viewer, not server state) and is `hidden md:flex` — small screens still get the nav strip in `Header.tsx`, which imports `NAV_ROUTES` from `Sidebar.tsx` rather than owning a second copy of the list. When the page count grows, this is the nav to extend, not a new header row.

## Common tasks

**Adding a metric to an existing section.** Add the field to both `types.ts` files, populate it in the relevant service, render it as a `.data-row` or a tile. Keep the label short and lowercase-with-capital, not a sentence.

**Adding a section.** Build a `.panel` with a `.panel-head`, put the items in rows rather than a grid of cards, give each row exactly one status signal, and mount it inside the page it belongs on (`client/src/pages/`). If it belongs on Infra, it must survive a one-third-width column on desktop and full width on mobile.

**Adding a page.** Add the file to `client/src/pages/`, a `<Route>` in `App.tsx`, a nav entry in `Sidebar.tsx`'s `NAV_ROUTES` array (this is the desktop nav now — `Header.tsx` only imports `NAV_ROUTES` for its small-screen strip, it doesn't own the list), and a page entry in `CommandPalette.tsx`'s `PAGES` array so `Ctrl+K` can reach it. All three lists must agree, on purpose — there's no single source of truth for "what pages exist" to derive them from.

**Adding a route.** Register it in `server/src/index.ts` next to the others and keep the response shape flat. Anything that changes state is a POST and needs a confirmation path in the client.

## What not to do

- Do not add a charting or component library. The sparklines are hand-written SVG for a reason. `react-router-dom` (structural routing) and `@xterm/xterm`+`@xterm/addon-fit` (an actual terminal emulator, not realistically hand-rolled) are the two exceptions, and `TerminalPage` is lazy-loaded (`React.lazy` in `App.tsx`) specifically so xterm's ~330KB only loads for someone who opens that page. Any future library addition needs the same justification and, if it's non-trivial in size, the same lazy-loading treatment.
- Do not put emoji in the interface, in documentation, or in commit messages.
- Do not add backwards-compatibility shims, feature flags or defensive checks for states that cannot occur. This is a single-owner tool with no external consumers.
- Do not commit generated output. `client/dist` is ignored; `*.tsbuildinfo` is also gitignored, so its local churn from `tsc -b` never shows up in `git status`.
- Do not add attribution for AI tooling to commits, pull requests or documentation.

## Commits

Conventional commits, enforced on every commit by commitlint through a husky `commit-msg` hook. A message that does not parse is rejected before the commit exists, so fix the message and commit again rather than reaching for `--no-verify`.

Format is `type(scope): subject`, subject in lowercase imperative with no trailing period, header at most 72 characters. Types come from `@commitlint/config-conventional`: `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. The scope is optional, but when present it must be one of `ui`, `client`, `server`, `auth`, `sentinel`, `docker`, `docs`, `deps`, `repo`. Add to that list in [commitlint.config.mjs](commitlint.config.mjs) rather than working around it.

The hooks are installed by the `prepare` script, so they exist after `npm install` at the repo root. An agent working in a fresh clone that has not installed root dependencies will find commits passing unchecked; run the install first.

## UI Styling & Design Consistency Rules

All user interface modifications must strictly preserve the modern glassmorphism aesthetic and design tokens:

- **Glassmorphism & Surfaces:**
  - Standard panels must use `.panel` and `.panel-head` classes (`bg-cockpit-panel/85 backdrop-blur-xl border border-cockpit-border/60 shadow-panel`).
  - Cards and sub-panels (e.g. Container Fleet cards, AI Agent cards, metric tiles) must use `rounded-xl border border-cockpit-border/60 bg-cockpit-bg/50 backdrop-blur-md` with hover state `hover:border-cockpit-accent/40 hover:bg-cockpit-panel/80`.
  - NEVER use opaque solid backgrounds (`bg-gray-800`, `bg-slate-900`) or raw hex color codes in JSX. Always use the defined `cockpit-*` and `state-*` CSS tokens.

- **Button Hierarchy & Interactive Controls:**
  - Primary call-to-action: `.btn-primary` (accent background, white text, subtle glow on hover).
  - Secondary / Cancel / Neutral: `.btn-ghost` (subtle border, translucent glass background, hover highlight).
  - Destructive / Dangerous: `.btn-danger` (state-bad background, strictly for prune, restore, restart).
  - Icon-only buttons: `.icon-btn` (`rounded-xl p-2`, border and backdrop blur with `hover:border-cockpit-accent/50 active:scale-95`).
  - Segmented controls: Container `.seg` with children `.seg-btn`, active state `.seg-btn-on`.

- **Form Controls & Inputs:**
  - Inputs, selects, and textareas must use `.field` (`rounded-xl`, translucent background, monospace font, `focus:border-cockpit-accent focus:shadow-glow-accent`).
  - Search / filter toolbars must use responsive wrapping (`flex flex-wrap items-center gap-2`).

- **Typography & Numerical Metrics:**
  - Panel headers: `.panel-title` (`text-[14px] font-bold tracking-tight text-cockpit-text`) and `.panel-sub` (`text-[12px] text-cockpit-muted`).
  - Section / Column labels: `.label` (`font-mono text-[10.5px] uppercase tracking-[0.1em] text-cockpit-muted`).
  - Numeric metrics: Always use `.metric` or `.metric-lg` with `font-mono tabular-nums` to eliminate layout jitter.
  - Status badges: Always use `.pill` variants (`.pill-good`, `.pill-warn`, `.pill-bad`, `.pill-accent`, `.pill-neutral`).

- **Color Semantics:**
  - `cockpit-accent` is strictly for interactive selections, links, and active controls.
  - `state-good`, `state-warn`, and `state-bad` are strictly reserved for operational health states. Never mix status colors with accents.

- **Modals & Dialogs:**
  - All modal overlays must be rendered through `createPortal(..., document.body)` with `.overlay` and `.modal-panel` classes to guarantee correct z-index layering and prevent clipping by parent `overflow-hidden` boundaries.

- **Micro-interactions:**
  - Apply `active:scale-95` and transition smoothing to clickable cards, pills, and buttons.

## Agent Workflow Rules

- **ALWAYS propose and review first:** When asked to audit, add a feature, or modify code, provide a detailed review or a step-by-step proposal of what you intend to do. 
- **Wait for explicit permission to code:** Do NOT execute code changes (via `run_command`, `edit_file`, etc.) until the user has explicitly approved your proposal. This is mandatory to prevent merge conflicts with other agents concurrently working on the project.
- **Log Start of Task (Locking mechanism):** The VERY FIRST action upon receiving a task prompt is to write an entry marked `[IN PROGRESS]` into `AGENT_LOG.md`. This signals to concurrent agents that the file/feature is being worked on.
- **Log Completion of Task:** Once the task is completed and pushed, update that same `AGENT_LOG.md` entry from `[IN PROGRESS]` to `[COMPLETED]` with a summary of the finalized changes. Always read `AGENT_LOG.md` first to check if another agent has locked a feature.
- **Update Announcements on Commit:** Setiap kali melakukan commit pembaruan fitur atau UI, pastikan juga menambahkan entry pesan pembaruan (message update) ke dalam file `announcements.json`. Hal ini penting agar `AppUpdateBanner` di halaman Overview dapat langsung menampilkan ringkasan release notes.


## Out-of-Process Redeployment Architecture (`homelab-redeploy.sh`)

When redeploying `homelab-dashboard` / `homelab-cockpit` or other tracked git projects:
- **Why Out-of-Process Execution is Required:** If `docker compose up -d --build` is executed from inside the `homelab-cockpit` container, Docker terminates the running container during recreation. This kills the Node.js process (`SIGTERM`/`SIGKILL`) mid-flight before the new build is finalized, cutting WebSocket feeds, dropping database updates, and leaving the deployment in an uncertain state.
- **Dedicated Standalone Executable:**
  - File locations: `scripts/homelab-redeploy.sh` (in repository) and `/root/homelab-redeploy.sh` (on host).
  - Both AI agents and human users can run manual redeployments directly via CLI:
    ```bash
    # Redeploy homelab-dashboard itself:
    bash /root/homelab-redeploy.sh
    # or from repo directory:
    npm run redeploy

    # Redeploy another tracked project (e.g. homelab-idp):
    bash /root/homelab-redeploy.sh homelab-idp
    ```
- **Daemon / Watcher Mode (`--watch`):**
  - Run continuous watcher: `bash /root/homelab-redeploy.sh --watch` or via systemd service `scripts/homelab-redeploy.service`.
  - The watcher polls `data/.redeploy-trigger`. When the web UI triggers an update via `AppUpdateService` or `GitProjectsService`, it writes the target project name to `data/.redeploy-trigger`.
  - The host runner automatically cleans stale `.git/index.lock`, safely stashes local changes, runs `git fetch origin <branch>` and `git reset --hard origin/<branch>`, ensures Docker network `homelab-net` exists, executes `docker compose up -d --build --force-recreate`, and streams logs to `data/redeploy.log` and status to `data/redeploy-status.json`.
- **Seamless Downtime & Frontend Reconnection:**
  - `AppUpdateBanner.tsx` and `GitPullInline.tsx` tail `data/redeploy.log` in real time.
  - When the container stops and restarts during recreate ("service sempet down"), the frontend catches consecutive connection drops, shows the transitional "Service Restarting" status, automatically polls `/api/health`, and reloads the page via `window.location.reload()` once the new container is healthy ("trus naik lagi").
- **Guideline for AI Agents:**
  - If a user requests to pull and redeploy via terminal or asks for deployment assistance, execute `/root/homelab-redeploy.sh` (or `npm run redeploy`).
  - Never run `docker compose up -d --build` synchronously inside a process that will kill itself without detaching or delegating to `homelab-redeploy.sh`.

## UI Styles, Layout Variants & 100% Feature Parity Rule

When an agent creates a new UI style/layout variant (e.g. Beta Brutalist UI, Cyberpunk, Compact) or modifies existing layouts:
- **100% Feature Parity is Mandatory:** No feature, button, metric, widget, or capability may be omitted from a layout variant. Every layout must achieve complete functional parity with the base dashboard.
- **Consult the Blueprint Checklist:** Always refer to [docs/LAYOUT_AND_STYLES_GUIDE.md](docs/LAYOUT_AND_STYLES_GUIDE.md) and check off all items (Header controls, Collapsible Sidebar with localStorage, Command Palette route isolation, CPU/RAM/Thermal/Throughput vitals, Storage & DAS summary, Quick Actions deck, Bookmarks & Shortcuts with empty state CTA, and mobile responsiveness).
- **Command Palette (`Ctrl+K`) Preservation:** The Command Palette must detect active route prefixes (e.g., `/beta/*`) and keep navigation scoped within that style so the user is not unexpectedly kicked back to another UI variant.
- **Unobtrusive Sub-pages:** Scoped banners (e.g., Beta warnings) must only appear on the main overview page or be dismissible so full-screen sub-page tools (SSH Terminal, Processes table) remain unobstructed.

- **Mandatory Documentation Synchronization Rule:**
  Whenever an agent introduces a new feature, changes existing behavior, or creates a new layout style:
  1. The agent **MUST** update [docs/LAYOUT_AND_STYLES_GUIDE.md](docs/LAYOUT_AND_STYLES_GUIDE.md) with the feature inventory and component wiring map.
  2. The agent **MUST** update [CLAUDE.md](CLAUDE.md) if conventions or tokens are affected.
  3. The agent **MUST** record the completed work in [AGENT_LOG.md](AGENT_LOG.md) and [announcements.json](announcements.json).
  This ensures any subsequent agent can easily follow the codebase, understand all existing features, and reproduce identical parity in new designs.
