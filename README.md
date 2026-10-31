# Homelab Dashboard

A single-pane dashboard for a compact homelab: Proxmox VE host vitals, Docker container telemetry, Tailscale peers, storage and DAS mount health, SSL expiry, AI coding agent metrics, and an optional Telegram companion bot. One Node.js daemon, one React client, no external monitoring stack.

Built for a Lenovo ThinkCentre M710q Tiny running Proxmox VE with an Ubuntu LXC container runner and an external multi-bay DAS enclosure, but adaptable to any Linux-based homelab environment.

![Homelab Dashboard Overview](docs/screenshots/overview.png)

## Results in Production

Running on an unprivileged Ubuntu 24.04 LXC on the M710q under Proxmox VE 8, replacing a stack of separate monitoring tools:

| Metric | Before | After |
| --- | --- | --- |
| Monitoring containers | 6 across 4 tools | 1 daemon |
| LXC memory in use | high baseline pressure | 2.2 GB of 12 GB |
| NVMe reclaimed | -- | 15.27 GB |
| Browser tabs to operate | 4 | 1 |
| Poll loops | 4 independent | 1 multiplexed WebSocket |

Netdata, Uptime Kuma, Portainer, and legacy dashboards were decommissioned. Full write-up in [docs/case-study.md](docs/case-study.md).

## Architecture

```text
Host machine (Proxmox + Ubuntu Runner)
│
├── System Sensors (lm-sensors, /proc, docker sock)
│
└── Node.js Fastify Daemon (homelab-cockpit server)
    ├── REST API (authenticated)
    ├── WebSocket (2-second multiplexed stream)
    └── Background Workers:
        ├── System Watchdog (L7 HTTP, Docker stats, NVMe)
        ├── GitHub commit tracking for tracked projects
        ├── rclone backup / restore, plus small-config import
        ├── SSH terminal bridge (no command whitelist)
        ├── AI agents telemetry (Claude Pro, Gemini / Antigravity)
        └── optional Telegram bot with Gemini Q&A
             │
        React client (Vite + Tailwind + React Router)
        ├── Overview / Fleet / Infra (Overview, Network, Storage, Performance, Backup) / Git / Processes / Sentinel / AI Agents
        ├── Ctrl+K command palette
        └── light and dark theme
```

## Features

**Owner authentication.** The first visit prompts to register a single owner account, after which registration closes permanently. Every `/api` route and the WebSocket require a bearer token; sessions can persist up to 30 days. Health and authentication status endpoints remain public.

**Host vitals.** Proxmox CPU, memory, package temperature, and uptime; LXC CPU, memory, and load average; fan speed and kernel throttle counters; vzdump backup status, archive size, and duration.

**Container fleet & live usage monitor.** Container management with host cards, search, status filters, and pagination. To keep background CPU overhead near zero on constrained homelab hosts, live container CPU & RAM telemetry is gathered on-demand via the **Live Usage Monitor** toggle button with an active 5-minute auto-stop countdown and automatic cessation whenever navigating away to another page. L7 HTTP probes report real status codes and latency. Web UI launcher supports LAN, Tailscale, or public tunnel URLs.

**Multiple Docker hosts.** Point the daemon at multiple Docker daemons (via `DOCKER_HOSTS`) to aggregate containers into a unified fleet table, tagged and filterable by host. Host-level CPU and RAM telemetry remains scoped to the primary host running the daemon.

**Storage and DAS watchdog.** Disk usage tracking per volume along with a canary file check (`.mounted`) on external enclosures. If an external drive disconnects, an alert banner appears immediately to prevent containers from overflowing the root NVMe drive.

**Infrastructure categories (5 domains).** Infra page organized into five operational categories:
- **Overview:** System specifications, compute & RAM progress, network & storage KPIs, and domain jump cards.
- **Network:** Docker daemon hosts, full Tailscale mesh peer table, and SSL certificate expiration countdown.
- **Storage:** NVMe & external DAS volumes with canary watchdog (`.mounted`), SMART indicators, and Docker disk hygiene prune.
- **Performance:** Proxmox hypervisor & Docker runner vitals, kernel throttling counters, and real-time disk I/O throughput and latency via `/proc/diskstats`.
- **Backup:** Remote cloud backup status via Rclone, on-demand execution, restore confirmation modal, and portable config link importer.

**Processes.** Multi-tab system inspection covering host processes, Docker container processes (via `docker top`), and remote hosts via read-only SSH execution.

**Shortcuts & bookmarks.** Customizable startpage bookmarks grid on the Overview page with custom titles, URLs, and drag-and-drop reordering.

**Notifications.** Centralized notification dropdown logging container events, git project tracking, automated pull & rebuilds, and system alerts. Supports opt-in browser desktop notifications.

**Tailscale mesh.** Real-time peer list with online status, `100.x` IP addresses, MagicDNS hostnames, exit nodes, and subnet routes.

**SSL certificate tracker.** Expiration countdown for Let's Encrypt certificates provisioned through Nginx Proxy Manager, highlighting certificates expiring within 30 and 14 days.

**Disk hygiene.** Detection of reclaimable disk space across dangling Docker images and build cache, paired with a safe prune action. Running containers and named volumes are protected.

**Backup, restore, and config import.** Scheduled or on-demand disaster recovery using `rclone sync` to configured cloud storage (Nextcloud, Google Drive, etc.). Also supports importing lightweight configs (`pins.json`, `git-projects.json`) directly from public links or archives without modifying owner credentials.

**Git repositories on the servers.** Finds the git repositories on every SSH target and shows what is really checked out there (branch, commit, changed files, whether the remote moved on), read-only.

**Git project deployment.** Track containers built from source against GitHub repositories. Check for incoming commits, inspect diffs for potential database migration risks, and trigger automated pull and rebuild commands (`docker compose up -d --build`).

**Pinned containers & public tunnels.** Pin key containers with custom public domains (e.g. Cloudflare tunnels), persisted across client sessions in `data/pins.json`.

**Cloudflare tunnel manager.** Discovers every remotely-managed tunnel and domain on a Cloudflare account, draws a domain, tunnel and origin map, and publishes, edits, moves or removes public hostnames (tunnel rule plus DNS record) from one page. Needs an API token; see `.env.example`.

**AI Agents monitoring.** Live telemetry tracking AI coding assistants (Claude Pro, Gemini / Antigravity via T3 Code), including 5-hour rolling token windows, cooldown counters, and weekly activity distribution charts.

**In-app self-update.** Direct version check against the GitHub repository with one-click background update and auto-reload capabilities.

**Terminal.** Integrated interactive terminal in the browser using xterm.js connecting via SSH key authentication to Proxmox VE or Docker hosts defined in `SSH_TARGETS`.

**Sentinel companion (optional).** Embedded Telegram bot offering multi-tier homelab management: read-only telemetry, Gemini-powered query assistant, and whitelisted container restarts/prunes with confirmation safeguards.

**Privacy mode & kiosk mode.** Quickly redact IP addresses and internal domains with one click before taking screenshots or sharing views; fullscreen kiosk mode suited for homelab wall monitors.

## Quick Start

```bash
git clone https://github.com/srytmj/homelab-dashboard.git
cd homelab-dashboard
cp .env.example .env
npm install
docker compose up -d --build
```

The dashboard will be available at `http://<docker-host>:8050`.

Without a configured `.env`, the daemon starts in demo mode with simulated telemetry, ideal for local testing and development.

### Setup Checklist

- **`STORAGE_MOUNTS`**: Must be existing paths on the machine hosting the daemon. Non-existent paths fall back to simulated values.
- **`STORAGE_LABELS`**: Optional comma-separated display names matching the order of `STORAGE_MOUNTS`.
- **`DOCKER_SOCKET` / `DOCKER_HOST_NAME`**: Match the environment where the daemon executes. Set `DOCKER_HOSTS` only if aggregating multiple Docker nodes.
- **`PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`**: Required for live Proxmox hypervisor metrics. Without them, the dashboard displays demo data with a `SIMULATED` indicator.
- **Container Public Domains**: Provide complete URLs (e.g., `https://jellyfin.yourdomain.com`) when pinning services exposed through reverse proxies or tunnels.

## Local Development

```bash
npm install          # Install dependencies and git hooks
npm run dev:server   # Run Fastify daemon with tsx watch on :3000
npm run dev:client   # Run Vite development server on :5173
```

To create a production build:

```bash
npm run build        # Builds both client (Vite) and server (TypeScript)
npm start            # Serves production client directly from the Fastify server
```

Commit messages follow [conventional commits](https://www.conventionalcommits.org) enforced through husky and commitlint.

## Out-of-Process Redeployment (`homelab-redeploy.sh`)

Homelab Dashboard ships with a standalone host redeployer script located at [`scripts/homelab-redeploy.sh`](scripts/homelab-redeploy.sh) and placed at `/root/homelab-redeploy.sh`.

### Why Out-of-Process?
When updating the dashboard itself via the web interface, executing `docker compose up -d --build` from inside the `homelab-cockpit` container causes Docker to terminate the running container. This kills the Node.js process mid-execution (`SIGTERM`), cutting live feeds and preventing the new container state from being finalized. 

The standalone script runs on the host completely outside the container's process tree. It features:
- Automatic stashing of uncommitted tracked edits (`git stash push`).
- Stale lock removal (`rm -f .git/index.lock`).
- Clean branch synchronization (`git fetch origin <branch>` and `git reset --hard origin/<branch>`).
- Auto-creation of external Docker networks (e.g. `homelab-net`) if missing.
- Safe Docker container rebuild: `docker compose up -d --build --force-recreate`.
- Persistent logging to `data/redeploy.log` and status updates to `data/redeploy-status.json`.

### Manual CLI Execution
Users and AI agents can execute redeployments directly from the host terminal:

```bash
# Redeploy Homelab Dashboard itself:
bash /root/homelab-redeploy.sh
# or from the repository root:
npm run redeploy

# Redeploy any tracked Git project (e.g., homelab-idp):
bash /root/homelab-redeploy.sh homelab-idp
```

### Background Watcher Daemon (`--watch`)
To allow Web UI buttons (**Update Sekarang** and **Pull & Redeploy**) to trigger instantaneous out-of-process rebuilds on the host:

```bash
# Run watcher as a background daemon:
nohup /root/homelab-redeploy.sh --watch > data/redeploy-daemon.log 2>&1 &

# Or register as a systemd service (recommended for production host):
cp scripts/homelab-redeploy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now homelab-redeploy
```

### Seamless Downtime & Auto-Reconnect
During self-redeploy, the dashboard web UI tails `data/redeploy.log`. When the container stops and restarts during recreate, the frontend enters a transitional **"Service Restarting"** state, polls `/api/health` every 1.5 seconds, and automatically reloads the page once the new container responds with 200 OK.

## HTTP API

All endpoints except `/api/health` and `/api/auth/*` require authentication via `Authorization: Bearer <token>`. The WebSocket accepts the token via query parameter (`/ws?token=<token>`).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness check |
| GET | `/api/auth/status` | Verify owner existence and token validity |
| POST | `/api/auth/register` | Initialize owner credentials (one-time) |
| POST | `/api/auth/login` | Authenticate and obtain session token |
| POST | `/api/auth/logout` | Terminate session token |
| GET | `/api/snapshot` | Homelab telemetry snapshot |
| GET | `/api/tailscale` | Tailscale mesh status and peers |
| GET | `/api/ssl` | SSL certificate expiry data |
| GET | `/api/sentinel` | Telegram companion status |
| GET | `/api/containers/:id/logs?tail=100` | Fetch container stdout/stderr logs |
| POST | `/api/containers/:id/restart` | Trigger container restart |
| POST | `/api/docker/prune` | Safe prune of dangling layers and build cache |
| POST | `/api/pins/:name` | Pin container with optional public domain |
| DELETE | `/api/pins/:name` | Remove container pin |
| GET | `/api/bookmarks` | Fetch custom startpage bookmarks |
| POST | `/api/bookmarks` | Create bookmark |
| PUT | `/api/bookmarks/reorder` | Reorder bookmarks array |
| PUT | `/api/bookmarks/:id` | Update bookmark |
| DELETE | `/api/bookmarks/:id` | Remove bookmark |
| POST | `/api/git-projects/:containerName` | Track Git repository for container |
| DELETE | `/api/git-projects/:containerName` | Stop tracking Git repository |
| POST | `/api/git-projects/:containerName/check-pull` | Dry-run git diff checking migration risks |
| POST | `/api/git-projects/:containerName/pull` | Execute git pull and container rebuild |
| GET | `/api/ai-agents/telemetry` | AI coding agents quota and usage telemetry |
| GET | `/api/app-update/status` | Check local vs upstream Git version |
| POST | `/api/app-update/check` | Fetch upstream Git commit updates |
| POST | `/api/app-update/update` | Execute automated self-update |
| GET | `/api/processes` | List primary host processes |
| GET | `/api/processes/docker` | List running container processes |
| GET | `/api/processes/remote/:target` | List processes on remote SSH target |
| GET | `/api/backup/status` | Last backup/restore status and paths |
| POST | `/api/backup/run` | Trigger immediate rclone backup |
| POST | `/api/backup/restore` | Restore homelab data from remote target |
| POST | `/api/backup/import-config` | Import pins and git configs from archive URL |
| GET | `/api/ssh-targets` | List configured SSH target identifiers |
| WS | `/ws` | Live snapshot feed broadcast every 2s |
| WS | `/ws/terminal?target=<name>` | Interactive SSH terminal session |

## Documentation

- [User Manual](docs/USER_MANUAL.md) - In-depth guide for interface controls and configuration.
- [Design System](docs/DESIGN_SYSTEM.md) - Color palette, typography, and component specifications.
- [CLAUDE.md](CLAUDE.md) - Architecture guidelines and development briefing for AI agents.

## License

MIT License.
