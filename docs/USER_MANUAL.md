# User manual

How to read the dashboard and use every control. For installation see the [README](../README.md).

## Signing in

The first time the dashboard is opened it asks you to create the owner account. That happens once: after the account exists, registration is closed and the screen becomes a plain sign-in form. There is no password reset, so store the credentials somewhere durable.

"Stay signed in for 30 days" keeps the session token in this browser. Without it the session ends sooner and you sign in again. The logout button sits at the right end of the header and invalidates the token immediately, on every tab.

## Layout

Seven pages, reachable from the sidebar on the left or by typing the address directly — each has its own URL and survives a reload or a bookmark:

| Page | What it holds |
| --- | --- |
| Overview (`/`) | Device identity, spec, the four headline tiles, shortcuts into Fleet and Infra, and your personal shortcuts |
| Fleet (`/fleet`) | The container table |
| Infra (`/infra`) | 5 dedicated categories: Overview (summary & KPI cards), Network (Tailscale, Docker hosts, SSL), Storage (DAS watchdog & hygiene), Performance (host & disk I/O), and Backup (Rclone & config import) |
| Git projects (`/git-projects`) | Containers built from your own repos, and whether they have new commits upstream |
| Processes (`/processes`) | Every process, tabbed by source: this host, Docker containers, or an SSH target |
| Terminal (`/terminal`) | A real shell to Proxmox or a configured Docker host, over SSH |
| Sentinel (`/sentinel`) | Telegram companion status and command reference |

## Sidebar

The floating rail on the left is the page nav — click the arrow at its bottom to collapse it to icons only when you want more room; it remembers that choice in this browser. On a narrow screen the sidebar hides and a nav strip appears in the header instead.

## Header

The dot on the logo is green when the WebSocket is connected and Proxmox is reachable, amber otherwise.

The clock next to it is always on; click **Weather** beside it to grant this browser's location once and see the temperature and conditions for wherever you're viewing from. That request goes straight from your browser to Open-Meteo — never through this dashboard's own server — and only fires when you click, not automatically on page load.

The strip below is the standing summary: Proxmox address, LXC address, Tailnet peers online, containers running, and the machine spec. The two dots next to the addresses mirror node reachability.

Controls on the right, left to right:

- **Command Deck** opens the command palette (see below). Also opens with `Ctrl+K` / `Cmd+K` from anywhere in the app.
- **Bell icon** opens the notification feed — every pin/unpin, every project tracked or untracked, and every pull & rebuild (started, succeeded, failed, or auto-deployed). A filled bell means something you haven't seen yet; opening the panel clears it. **Desktop** inside the panel asks your browser for permission and, once granted, pops a native notification for anything new even while you're on a different tab or page — off by default, and the choice lives in this browser only.
- **Sun/moon icon** switches between light and dark theme. Your choice is remembered; before you've picked one, it follows your OS setting.
- **Eye icon** toggles privacy mode. IPs become `192.168.•••.•••` and domains become `••••••.com`, so a screenshot is safe to post. The button turns amber while active. Nothing is sent anywhere; this is display-only.
- **Arrows icon** toggles browser fullscreen for a wall display or tablet.
- **Live pill** shows connection state and the time of the last update. Click it to force a refresh; it falls back to HTTP polling if the socket drops, and reconnects on its own after three seconds.
- **Logout icon** ends the session and returns to the sign-in screen.

## Command palette

`Ctrl+K` (`Cmd+K` on a Mac) opens a search box over whatever page you're on. Type to filter across two groups:

- **Pages** — jump straight to Overview, Fleet, Infra or Sentinel.
- **Pinned containers** — whatever you've pinned from the Fleet table, opened at its public domain if it has one, otherwise its Tailscale address, otherwise LAN. That order never changes based on how you're currently connected. Nothing pinned yet shows a prompt to go pin something instead of an empty list.

Arrow keys move the selection, Enter opens it, Escape closes the palette. There's no separate "consoles" list any more — pinning is now the only way to get something into the palette, so pin the things you actually reach for.

## Overview

The top card names the machine and its spec. Below it, four tiles carry the numbers worth glancing at:

- **CPU / Proxmox** with a bar that turns amber above 75 percent and red above 90.
- **Memory** used against total, same thresholds.
- **Fleet throughput**, the sum of every container's live rate. Down is the large figure, up is underneath. This is where a Jellyfin transcode or a Transmission download shows up.
- **Package temp**, labelled COOL under 60 degrees, WARM under 75, HOT above.

Two cards underneath link to Fleet (running/total containers, and how many are pinned) and Infra (volumes tracked). The Proxmox node, LXC runner and backup detail panels that used to sit here have moved to the Infra page — Overview stays a glance, not a scroll.

**Shortcuts.** A grid of your own links — YouTube, Gmail, anything you open every day — so this page doubles as a browser startpage, not just a homelab dashboard. **Add** asks for a name and URL; hovering a tile shows an edit icon. Shortcuts are stored on the daemon like pins, so they follow you between devices, and each tile's icon is fetched from Google's public favicon service based on the shortcut's domain.

## Fleet

One row per container.

- The dot is green when running, grey when stopped.
- **Health** shows the Docker state plus the L7 probe result, for example `200 · 15ms`. A red `502 error` means the process is up but the service behind it is broken, which the Docker state alone will not tell you.
- **Web UI** opens a small menu rather than a single link — pick LAN, Tailscale, or the public domain if you've pinned one for this container. Each row also has its own copy button.
- **CPU** and **Memory** show the current value and a sparkline of recent history.
- **Throughput** shows the live per-second rate, with cumulative totals underneath.
- **Actions** — pin, view logs, or restart. All three appear on hover.

Host selection and filtering:

- Click any host card in the **Docker & LXC Fleets** section to switch between hosts.
- The search box matches container name, image and port.
- `All / Running / Stopped` filters by state.
- `Pinned` toggles between all containers and pinned containers only.
- Click a column header to sort by it, click again to reverse. Sorted columns are marked with an arrow.
- The footer sets rows per page (10, 25, 50, 100) and pages through the result. Changing a filter or the page size returns you to page one.

### Live Usage Monitor

By default, container lists are fetched via lightweight metadata checks to keep host and dockerd CPU utilization near zero. To inspect live CPU and RAM consumption per container on demand:
- Click the **Live Usage Monitor** button at the top right of the Fleet page.
- **Start / Stop**: Clicking toggles live polling of running container CPU/RAM stats and dynamic sparklines.
- **5-Minute Auto-Stop**: A countdown timer runs for 5 minutes (300 seconds); once elapsed, monitoring automatically disengages to prevent unintentional CPU drain.
- **Navigation Auto-Stop**: Switching to any other page (Overview, Infra, Processes, etc.) immediately stops container usage monitoring and releases server polling.

### Logs

Opens the last 50, 100 or 250 lines. This is a snapshot, not a stream, so reopen or change the tail count to refresh. Copy sends the whole buffer to the clipboard.

### Restart

Confirms the container name and current status before acting. The container stops and starts, so anything streaming through it drops for a few seconds. The dashboard refreshes once the daemon reports success.

### Pin

Pins a container into the command palette, so `Ctrl+K` reaches it without hunting through the table. The dialog has one optional field: a public domain, for containers reached through a Cloudflare tunnel you've already set up outside this dashboard. Leave it blank and the palette falls back to the container's LAN or Tailscale address. A shortcut in the dialog opens the Cloudflare dashboard to manage the tunnel itself — this app never talks to Cloudflare's API, it just remembers the URL you give it.

Pins are stored on the daemon, not the browser, so they're the same whether you open the dashboard from your phone or your desktop. Clicking Pin on an already-pinned container reopens the same dialog to edit the domain or unpin it.

## Infra

Five dedicated categories, switched with the navigation tabs at the top of the page:

### Overview

The high-level command summary for homelab infrastructure:
- **Node Specification & Uptime**: Real-time hostname, OS, Linux kernel version, and running duration.
- **KPI Summary Cards**: Four primary indicators showing Compute (vCPU cores & RAM usage), Network & Mesh (Tailscale peers online & Docker daemon count), Storage Capacity (total volume footprint & average allocation), and Disaster Recovery (last backup timestamp & result).
- **Domain Jump Cards**: Direct shortcut cards for Network, Storage, Performance, and Backup with status pills and one-click jump buttons to their respective categories.

### Network

Comprehensive networking matrix:
- **Docker Host Daemons**: Connected daemon endpoints, reachability status, and container counts per host.
- **Tailscale Mesh**: Live peer device table with online status, 100.x IPv4 and IPv6 addresses, MagicDNS names, advertised subnet routes, and exit node status. Hover or click to copy IP addresses.
- **SSL Certificates**: Let's Encrypt / Nginx Proxy Manager certificate expiration countdown per domain, alerting amber under 30 days and red under 14 days, with a graceful empty state when none are configured.

### Storage

Physical and logical storage inspection:
- **Storage & DAS Watchdog**: One row per volume (internal NVMe and external DAS multi-bay mounts), displaying used/free capacity bars, filesystem type, and mount points.
- **Canary Watchdog (`.mounted`)**: Verifies presence of the canary file on external enclosures. A `DETACHED` badge and red warning banner appear immediately if a DAS drops, preventing silent root NVMe exhaustion.
- **SMART Health**: SMART indicators per physical disk drive.
- **Docker Disk Hygiene**: Displays reclaimable disk space across dangling images and build cache, with a safe **Prune** modal that preserves running containers and named volumes.

### Performance

Low-level host and storage I/O telemetry:
- **Host Detail**: Proxmox VE hypervisor metrics (CPU model, core count, package temperature, uptime, PVE version) and Ubuntu LXC runner vitals (CPU percent, RAM usage, 1/5/15m load averages, thermal throttling counters, fan speed).
- **Disk Performance (`/proc/diskstats`)**: Tabbed per volume with real-time active time percentage graph, IOPS response latency, read throughput rate, and write throughput rate directly from the Linux kernel.

### Backup

Disaster recovery and portable configuration:
- **Rclone Cloud Backup**: Tracks remote backup configuration (`BACKUP_RCLONE_REMOTE`), last run timestamp, duration, and status.
- **Run backup now**: On-demand sync of configured source paths to the cloud remote without waiting for cron schedules.
- **Restore from backup**: Reverse sync pulling cloud archives down over local paths, with an interactive confirmation modal showing target paths.
- **Import config from link**: Lightweight configuration restore (pins, git project tracking) from a public zip or Google Drive share link without requiring full disaster recovery or overwriting credentials.

## Git projects

For containers that are your own projects — not off-the-shelf services like Jellyfin or Kavita. **Track a project** links a container to a GitHub repo and branch. Instead of automated background polling, updates are checked on-demand: click **Refresh to get newest commit version** at the top right to query GitHub for the latest commit across all tracked repositories. If new commits are detected, an **Update available** pill appears along with the newest commit message and date, showing exactly what needs to be pulled and rebuilt.

Picking the container to track: if more than one Docker host is configured, a tab strip lets you narrow the list to one host first. The container field itself is a search box, not a plain dropdown — type part of a name to filter, since a fleet with many containers across hosts would otherwise be a long scroll. That host tab only filters which container you're linking, though — by itself it doesn't change where the rebuild runs.

By default, pull & rebuild runs against the Docker daemon Homelab Cockpit itself is on. For a project whose container actually runs somewhere else — a separate Docker host or LXC — the edit dialog has a **Runs on** selector listing your configured SSH targets (`SSH_TARGETS`, the same ones Terminal and the Processes page use); pick the matching one and the pull and rebuild run over SSH on that host instead. With an SSH target selected, **Local path** switches meaning: it's an absolute path on that remote host (e.g. `/home/user/myapp`), not a folder name under `GIT_PROJECTS_ROOT`.

Click a tracked row to edit its repo/branch, set a local path and rebuild command, or stop tracking it.

### Pull and rebuild

The download icon on a row expands a panel underneath it, in place — there's no dialog blocking the rest of the page. It's disabled until the project has both a **local path** (the folder name under your `GIT_PROJECTS_ROOT`, where the project's working tree actually lives on the host) and a **rebuild command** set in the edit dialog.

Expanding it first checks what would change, without touching anything:

- If the changed files include something that looks like a database migration (a `migrations/` folder, `prisma/schema.prisma`, `alembic/`, or a `.sql` file), you get a warning listing exactly which files matched before you can continue. This is a pattern match, not a guarantee — it can miss a real migration named unusually, or flag a file that isn't one. Read the list.
- If there's nothing new to pull, the button instead reads **Rebuild anyway** — click it if the running container doesn't seem to match what's supposedly deployed (a stale image cache, a rebuild that silently failed last time). It runs the same `git pull` and rebuild either way; `git pull` is just a no-op when there's genuinely nothing new.
- Once running, the panel shows live output as it happens — `git pull`, then the rebuild command — and you can navigate to any other page while it runs; it keeps going on the daemon regardless. Come back to the same row later, or check the notification bell, to see how it went. The record of "what's deployed" updates through this, **Mark as deployed** (below), or auto-deploy. Deploying the same project some other way (SSH, a separate CI job) leaves the dashboard showing the old commit as deployed until one of those three runs.

If a **local path** is set when you first track a project (or add one later by editing it), the dashboard reads whatever commit is already checked out there and uses it as the baseline right away — so a project that's already running doesn't sit at "Not deployed yet" for no reason. That only works if the path exists and is a real git working tree at that moment; if it's tracked before the path is ready, or without a local path at all, it still shows **Not deployed yet**. A green checkmark button appears next to the status pill whenever that's the case and a local path is set: click it to record whatever commit is on disk as deployed, without pulling or rebuilding anything. After that, the pill correctly flips between "Up to date" and "Update available" as new commits land.

### Auto-deploy

The edit dialog has an **Auto-deploy new commits** checkbox, available once a local path and rebuild command are set. Turn it on and this one project pulls and rebuilds itself as soon as a new commit appears — no click needed. It only ever does this when the same migration-risk check as manual Pull & rebuild comes back clean; if a changed file looks like it might touch the database, the project shows an amber **Auto-deploy paused** note next to its name instead of deploying, and waits for you to review and pull manually. This is opt-in per project — leave it off for anything you'd rather review by hand first.

### Out-of-Process Redeployment (`homelab-redeploy.sh`)

When redeploying a container or updating the Homelab Dashboard itself:
- **Self-Redeploy Safety**: When you trigger an update for `homelab-cockpit` (via the Overview page's **Update Sekarang** or Git projects' **Pull & Redeploy**), the build cannot run purely inside the container because Docker terminates the container during recreation, killing the update process. 
- **Out-of-Process Runner**: The dashboard dispatches a trigger to the standalone script at `/root/homelab-redeploy.sh` (or `scripts/homelab-redeploy.sh`). The script stashes local edits, cleans stale locks (`.git/index.lock`), runs `git fetch` and `git reset --hard`, ensures the `homelab-net` Docker network exists, and runs `docker compose up -d --build --force-recreate`.
- **Graceful Downtime & Auto-Reconnect**:
  - The browser modal tails the live build log from `data/redeploy.log`.
  - When the container stops and recreates, the UI gracefully enters the **Service Restarting** state.
  - The client automatically polls `/api/health` every 1.5 seconds.
  - Once the new container starts, the page automatically reloads with the updated build.

### Manual CLI Execution for Users & AI Agents
If you prefer to trigger updates manually via SSH or if the dashboard is ever inaccessible:

```bash
# Redeploy Homelab Dashboard itself:
/root/homelab-redeploy.sh
# or:
npm run redeploy

# Redeploy any tracked Git project:
/root/homelab-redeploy.sh <container-or-project-name>

# Run continuous trigger watcher daemon:
/root/homelab-redeploy.sh --watch
```

## Processes

A tab strip picks the source, task-manager style:

- **This host** — every process the daemon itself can see, sorted by CPU by default. Disk I/O reads `/proc/[pid]/io` and only works on Linux, for processes the daemon has permission to inspect; where that's not available, the column shows a dash instead of a wrong number. Refreshes every three seconds on its own — it doesn't ride the same two-second feed as the rest of the dashboard, since gathering a full process list is heavier than everything else on that feed combined.
- **Docker containers** — processes running inside every container across every configured Docker host, via the same mechanism as `docker top`. A container whose base image ships a minimal `ps` (some distroless images) just doesn't appear here; that's a limitation of the image, not a dashboard error. Refreshes every five seconds.
- **One tab per SSH target** — appears only if `SSH_TARGETS` is configured (see [Terminal](#terminal) below). Runs a single read-only `ps` over SSH, so this is how you see what Proxmox itself is doing, not just the LXC the daemon runs in. Refreshes every eight seconds, and only while that tab is the one you're looking at.

Click a column header to sort by memory or disk I/O instead of CPU, or reverse the current sort. The search box filters by process name, command, user or PID within whichever tab is open.

## Terminal

A real shell, in the browser, to any host listed in `SSH_TARGETS`. Pick a target and it connects immediately — there's no confirmation step, because unlike every other action in this dashboard, a terminal isn't one specific thing to confirm; read the security note in the [README](../README.md#terminal) if you haven't already before turning this on.

The connection status shows in the terminal's own header bar. **Disconnect** closes the session cleanly; closing the browser tab or navigating away does the same. If a target doesn't appear in the list, it isn't configured in `SSH_TARGETS` — this page never lets you type in a host to connect to, only pick from what's pre-configured.

## Sentinel

Shows whether the Telegram companion is polling, whether the Gemini key is present, how many Telegram user IDs are allowed, and the last command received. **Commands** expands the reference:

- Tier 1 is read-only: `/status`, `/resources`, `/backup_status`, `/logs <name>`.
- Tier 2 answers questions in natural language through Gemini and never acts.
- Tier 3 changes state: `/restart <container>` and `/prune`, each requiring `/confirm` within 60 seconds, restricted to a whitelist. `/cancel` aborts.

Messages from any Telegram ID outside the allowlist are ignored without a reply.

## Notes

- Telemetry updates every two seconds. Sparklines cover recent history only and reset when the daemon restarts.
- Privacy mode, filters, sort order and page size are per-browser session and reset on reload.
- Animations respect the operating system's reduce-motion setting.

## AI Agents Monitor

Real-time telemetry and rate-limit tracking for AI coding agents (such as **Claude Code / Claude Pro** and **Gemini / Antigravity**) authenticated via **T3 Code**.

### Features
- **4-Agent Multi-Tenant Monitoring**: Displays distinct cards for Claude Pro (`suryatmaja.dev@gmail.com`) and Gemini instances (Default, Auth, Marmut), with real-time status (`Running turn` vs `Idle`).
- **5-Hour Rolling Window Gauge**: Computes turn consumption across the 5-hour rolling limit window, calculates usage percentage, and displays a live second-by-second countdown for when the earliest turn slot clears.
- **7-Day Activity Histogram**: Interactive mini bar chart showing daily interaction counts for each agent across the past week.
- **Live Interaction Timeline**: Real-time table streaming recent turn duration, model slug, timestamp, and status.

### How it Works (T3 Code Integration)
Unlike traditional monitors that require metering pay-per-token API keys, this feature extracts telemetric sessions directly from your local **T3 Code** runtime environment:
- Reads agent instance caches from `~/.t3/caches/*.json` (e.g. `claudeAgent.json`, `antigravity.json`).
- Reads interaction turns from the local SQLite database at `~/.t3/userdata/state.sqlite` using read-only mode (`node:sqlite`).

### Requirements for Third-Party / New Homelab Setups
If another user wants to run this dashboard and monitor their AI agents:
1. **T3 Code Installed on Host**: The host machine should have T3 Code running (`~/.t3` directory created).
2. **Custom Path Configuration**: If T3 data is located elsewhere, configure the environment variable:
   ```env
   T3_DATA_DIR=/path/to/.t3
   ```
3. **Docker Deployment**: When running the dashboard inside a Docker container, mount the host's `.t3` directory as read-only:
   ```yaml
   volumes:
     - ~/.t3:/root/.t3:ro
   ```
4. **Graceful Fallback**: If T3 Code is not detected on the machine, the dashboard gracefully marks the integration as offline without crashing other system monitoring pages.
