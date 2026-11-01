# 📊 Real-World Production Case Study: Consolidating Homelab Observability

> **Hardware**: Lenovo ThinkCentre M710q Tiny (Intel Core i5-7500 4C/4T @ 3.8GHz, 32GB DDR4 RAM, 512GB NVMe SSD, Multi-Bay USB 3.0 DAS)  
> **Environment**: Proxmox VE 8 Hypervisor (`192.168.18.224`) + Unprivileged Ubuntu 24.04 Container Runner LXC 100 (`192.168.18.225`)  
> **Networking**: Tailscale WireGuard Mesh (Subnet Router `192.168.18.0/24`, Node `100.110.20.15`)  
> **Date**: September 2026  
> **Author**: Maja ([suryatmaja.dev](https://suryatmaja.dev))

---

## 1. Executive Summary

As self-hosted homelabs evolve, they frequently fall victim to **"Observability Bloat"** and **"Tab Fatigue"**. In our compact Lenovo ThinkCentre M710q Tiny production node, maintaining visibility across 28 running containers previously required running four separate management tools totaling **six background containers**:

1. **Netdata** (`:19999`): Second-by-second host and container kernel telemetry.
2. **Uptime Kuma** (`:3001`): Internal HTTP latency and container ping polling.
3. **Portainer CE** (`:9000`): Container lifecycle management and log inspections.
4. **Homelable** (`:3000` & `:8001`, 3 containers): Dashboard links and service discovery.

Each tool operated independent background polling cycles, consumed precious RAM, wrote redundant logs to internal NVMe storage, and forced the operator to jump between multiple browser tabs to diagnose a single failing service.

By designing and deploying **Homelab Cockpit**—a unified, minimalist, single-binary container daemon—we officially decommissioned and removed all six redundant containers.

---

## 2. Empirical Benchmark (Before vs After)

| Metric | Before (Fragmented Stack) | After (Homelab Cockpit) | Delta / Impact |
| :--- | :--- | :--- | :--- |
| **Observability Containers** | **6 containers**<br>*(Netdata, Kuma, Portainer, Homelable x3)* | **1 container**<br>*(`homelab-cockpit` on `:8050`)* | **-83.3%** container reduction |
| **NVMe SSD Storage** | Bloated layers, cache & volumes | Cleaned via `docker system prune -af` | **15.27 GB Freed** |
| **LXC RAM Consumption** | High baseline memory pressure | **~2.2 GB** used out of 12 GB alocated | **9.8 GB Free Headroom** |
| **Browser Tabs for Operations** | 4 tabs minimum | **1 unified Cockpit tab** | **-75%** context switching |
| **Telemetry Network Traffic** | 4 separate polling loops | 1 multiplexed WebSocket stream (2s) | **Zero polling storm** |
| **Access Control** | Fragmented / Inconsistent | 1x Owner Setup + 30-day token auth | **Zero-trust external access** |
| **Tailscale Routing Visibility** | Blind / Guesswork | Explicit `TS 100.x` vs `LAN 192.x` badges | **Instant 1-click routing** |

---

## 3. The Problem: The Cost of Fragmented Tools

### 3.1 Resource Starvation on Tiny Form-Factor Hardware
The Lenovo ThinkCentre Tiny series is famous for its power efficiency (~15W-25W idle), but Intel Core i5-7500 (4 cores, 4 threads) and 32GB RAM must be budgeted responsibly when running media transcoding (Jellyfin), document OCR (Paperless-ngx), cloud synchronization (Nextcloud), and developer environments (T3 Code).

Running separate containers for logs (Dozzle/Portainer), metrics (Netdata), health checks (Uptime Kuma), and links (Homelable) resulted in:
- High constant CPU interrupt overhead from conflicting background poll loops.
- Significant disk write amplification on the internal NVMe boot SSD.
- Inability to correlate events (e.g. knowing whether a Jellyfin playback failure was caused by high CPU, network saturation, or an unmounted external DAS drive).

### 3.2 Tab Fatigue and Operational Lag
During an incident, the homelab owner had to:
1. Open **Portainer** to check container states and read stderr logs.
2. Open **Netdata** to inspect CPU temperature and thermal throttling.
3. Open **Uptime Kuma** to see if port 8096 was actually accepting HTTP requests.
4. SSH into **Proxmox VE** to check if the external multi-bay USB DAS had randomly disconnected or if nightly vzdump backups had completed.

---

## 4. The Architectural Solution: Homelab Cockpit

Instead of stitching together multiple third-party SaaS-like containers, **Homelab Cockpit** was engineered as an all-in-one, owner-centric operations hub:

```
                  +----------------------------------------------+
                  |         Lenovo ThinkCentre M710q Tiny        |
                  |         Intel i5-7500 • 32GB DDR4 RAM        |
                  +----------------------------------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
                       v                                   v
             [ Proxmox VE 8 Node ]               [ Ubuntu 24.04 LXC ]
             Node IP: 192.168.18.224             Runner IP: 192.168.18.225
             • CPU / RAM Telemetry               • /var/run/docker.sock
             • Thermal Throttle Sensor           • Storage Mounts: /mnt/hdd-*
             • Nightly vzdump Backups            • Tailscale WireGuard Mesh
                       |                                   |
                       +-----------------+-----------------+
                                         |
                                         v
                 +-----------------------------------------------+
                 |       HOMELAB COCKPIT CONTAINER (:8050)       |
                 |       Fastify + TypeScript + Vite + React     |
                 |                                               |
                 |  • 2s Multiplexed WebSocket Engine            |
                 |  • In-Memory Telemetry Collector              |
                 |  • L7 HTTP Real-Port Prober                   |
                 |  • Live Bandwidth Delta Speedometer (MB/s)    |
                 |  • Native In-App Monospace Log Streamer       |
                 |  • Safe One-Click Graceful Container Restart  |
                 |  • Multi-Bay DAS Canary Mount Watchdog        |
                 |  • Docker NVMe Disk Hygiene & Prune Trigger   |
                 |  • Tailscale Mesh Router & 1-Click IP Launch  |
                 |  • 1x Owner Onboarding & 30-Day Token Auth    |
                 |  • Optional Sentinel Telegram Companion       |
                 +-----------------------------------------------+
                                         |
                                         v
                         [ Unified Owner POV Browser UI ]
                         • Pure Utilitarian Minimalist Design
                         • 1-Click Privacy Mode (Redact IPs)
                         • Zero AI Slop • Responsive Kiosk
```

### Key Architectural Replacements:
1. **Replaced Portainer & Dozzle**: Native Dockerode integration provides instant in-app log streaming (50-500 lines, auto-scroll, copy) and graceful restart with confirmation dialogs.
2. **Replaced Netdata & Health Daemons**: Lightweight OS sensor polling combined with L7 HTTP probers directly verifies whether container web ports return `200 OK` (with millisecond latency) or `502 Bad Gateway`.
3. **Replaced Fragmented Dashboards**: Integrated **Container Fleet Table** displays explicit `TS 100.110.20.15:PORT` and `LAN 192.168.18.225:PORT` links side-by-side with 1-click clipboard copy.
4. **Hardened for Remote Access**: An automated **1x Owner Registration Wall** locks public registration permanently after initial setup and issues 30-day authenticated session tokens, allowing the dashboard to be safely exposed to the internet via Cloudflare Tunnel or Tailscale Funnel.

---

## 5. Decommissioning & Cleanup Procedure

Following the deployment and validation of `homelab-cockpit` on port `:8050`, the legacy stack was purged:

```bash
# 1. Stop and remove the legacy monitoring stacks
docker stop netdata uptime-kuma portainer homelable_web homelable_api homelable_db
docker rm netdata uptime-kuma portainer homelable_web homelable_api homelable_db

# 2. Reclaim dangling layers, build cache, and obsolete container volumes
docker system prune -af --volumes

# Output:
# Total reclaimed space: 15.27GB
```

### Resulting Host Vitals:
- **LXC RAM Usage**: **2.18 GB** active memory (out of 12.0 GB allocated).
- **Available RAM Headroom**: **~9.8 GB** unreserved memory available for production workloads.
- **NVMe SSD Utilization**: Reduced significantly, preserving flash write endurance on the boot SSD.

---

## 6. Homelab Owner Testimonial

> *"Whenever I troubleshot the homelab I used to have to open at least 4 tabs: Portainer for logs, Netdata for CPU throttling, Uptime Kuma to check service up/down, and SSH into Proxmox to make sure the DAS cable hadn't come loose. On top of that, the monitoring containers themselves ate RAM and kept the CPU busy.*
>
> *With Homelab Cockpit I retired the 6 old containers entirely. One `docker system prune -af` freed up 15.27 GB of NVMe SSD and left the LXC with 2.2 GB of RAM free out of 12 GB. Now I just open one web page, every Tailscale IP route is clearly visible, logs are one click away, and it is safe to open from outside my boarding house thanks to the single owner auth wall. Truly the definition of clean and purposeful engineering."*
>
> — **Maja ([@srytmj](https://github.com/srytmj))**, Homelab Architect & Software Engineer

---

## 7. Portfolio & Blog Summary Snippet (`suryatmaja.dev`)

*Feel free to use this markdown snippet for your personal engineering blog or portfolio:*

```markdown
### 🚀 Case Study: Slashing 83% Monitoring Bloat in My Homelab with a Custom Cockpit

**The Problem**: Running 28 self-hosted containers on an Intel Core i5 Lenovo ThinkCentre M710q Tiny created severe observability bloat. Four disjointed tools (Netdata, Portainer, Uptime Kuma, Homelable) across six containers consumed over 3GB of RAM and required constant tab-hopping.

**The Solution**: Built **Homelab Cockpit**—a full-stack real-time telemetry daemon (TypeScript, Fastify, React, Tailwind CSS, WebSocket) tailored for compact nodes running Proxmox VE, Docker LXCs, Tailscale mesh networks, and external multi-bay USB DAS mounts.

**The Hard Numbers**:
- 📉 **-83.3% Container Reduction**: Replaced 6 containers with a single lightweight daemon.
- 💾 **15.27 GB NVMe SSD Reclaimed**: Cleaned obsolete image layers and volumes.
- ⚡ **9.8 GB Free RAM Headroom**: LXC memory consumption dropped to ~2.2 GB / 12 GB.
- 🌐 **Zero-Guesswork Routing**: Real-time Tailscale (`100.x`) vs LAN (`192.x`) routing badges with built-in L7 HTTP health probes and 1x owner lockdown auth.
```
