# UI Styles, Layout Variants & Feature Parity Architecture Guide

This document defines the mandatory blueprint and feature inventory for the Homelab Cockpit dashboard. 

> [!IMPORTANT]
> **Mandatory Agent Rule:**
> When creating or updating a UI style, layout variant (e.g., Classic UI, Beta Brutalist UI, or future themes), or core dashboard feature, every AI agent **MUST** achieve 100% feature parity using the checklist in this document.
> **No feature may be omitted or dropped.** Whenever new features or data points are introduced, agents **MUST** update this document and [CLAUDE.md](../CLAUDE.md) to keep documentation and code in lockstep.

---

## 1. Complete Feature Inventory & Parity Checklist

Every layout variant (Classic, Beta, or new future variants) must implement or host the following capabilities:

### A. Persistent Header & Global Actions
- [ ] **Branding & Host Status:** Node status indicator (Healthy/Degraded), Node Name, and active Layout Badge (e.g., `Beta`, `Demo`).
- [ ] **Active User Badge:** Display authenticated `username` badge.
- [ ] **Clock & Weather Widget:** `<ClockWeatherWidget />` (opt-in geolocation, Open-Meteo API).
- [ ] **Layout Switcher:** Quick toggle link between layout variants (e.g., `Beta UI` <-> `Legacy UI`).
- [ ] **Command Deck (`Ctrl+K`):** Quick trigger button with visible `<kbd>Ctrl K</kbd>` shortcut indicator.
- [ ] **Notifications Panel:** `<NotificationsPanel />` with live badge count and polling feed.
- [ ] **Theme Switcher:** Light / Dark mode toggle button (`useTheme`).
- [ ] **Privacy Mode Toggle:** Hide / Redact IP addresses, hostnames, and domain names (`isPrivacyMode`).
- [ ] **Fullscreen Toggle:** Enter/exit browser fullscreen mode.
- [ ] **Sync / Refresh Button:** Instant manual refresh trigger with last-updated timestamp tooltip and live pulse dot.
- [ ] **User Logout:** Sign out action trigger (`useAuth().logout`).
- [ ] **Mobile Navigation:** Fixed bottom bar (`md:hidden`, `MobileNav.tsx`) with the four main pages and a grouped "More" sheet that also holds Settings.

### B. Persistent Sidebar & Navigation Rail
- [ ] **Complete Route Directory:**
  1. Overview (`/` or `/beta`)
  2. Container Fleet (`/fleet` or `/beta/fleet`)
  3. Storage & Infra (`/infra` or `/beta/infra`)
  4. Git Projects & Sync (`/git-projects` or `/beta/git-projects`)
  5. Host Processes (`/processes` or `/beta/processes`)
  6. SSH Web Terminal (`/terminal` or `/beta/terminal`)
  7. Sentinel AI Watchdog (`/sentinel` or `/beta/sentinel`)
  8. AI Agents Telemetry (`/ai-agents` or `/beta/ai-agents`)
- [ ] **Collapsible Rail:** Sidebar expand/collapse toggle button with persistence in `localStorage` (e.g., `cockpit-sidebar-collapsed` / `cockpit-beta-sidebar-collapsed`).
- [ ] **Responsive Breakpoints:** Sidebar visible on desktop (`hidden md:flex`), gracefully adapting to mobile.

### C. Command Palette (`Ctrl+K`) Integration
- [ ] **Route Scope Preservation:** Palette must detect if user is inside a layout variant (such as `/beta/*`) and rewrite target URLs so user remains within the current layout instead of being ejected.
- [ ] **Cross-Layout Navigation:** Palette must offer an entry to switch back to the alternate layout (e.g., `Classic UI (Legacy)`).
- [ ] **Pinned Container Launcher:** Show pinned containers with single-click launch to resolved public/Tailscale/LAN address.
- [ ] **Quick Search Filtering:** Keyboard-navigable fuzzy filter over all registered pages and containers.

### D. Overview / Home Page Vitals & Telemetry
- [ ] **App Update Banner:** `<AppUpdateBanner />` mounted at top for git-based dashboard self-updates.
- [ ] **Primary Node & Host Specs:**
  - Proxmox VE Node name, IP, and connection badge (`PVE CONNECTED` / `PVE SIMULATED`).
  - Docker host hostname and IP.
  - CPU model specification text.
  - All IPs and sensitive names passed through `redactText(val, isPrivacyMode)`.
- [ ] **Compute Card:** Real-time CPU Usage % (`pve.cpuPercent`), allocated core count, dynamic status tone (`getStatusColor`), and progress bar.
- [ ] **Memory Card:** Real-time RAM % used, numeric used bytes vs total capacity (`formatBytes`), and progress bar.
- [ ] **Thermal / CPU Package Temp Card:** Sensor readout (`pve.cpuTempCelsius` or `dockerHost.thermalThrottle.packageTempCelsius`), status pill (`getTempColor`: `COOL`/`WARM`/`HOT`), and temperature scale bar.
- [ ] **Workloads Card:** Running vs total container count (`runningCount / totalCount`), pinned containers badge (`PINNED TO CMD`).
- [ ] **Network Throughput Card:** Real-time RX (Inbound) and TX (Outbound) byte rates per second (`formatBytes(throughput.rx)/s`).
- [ ] **Storage & DAS Watchdog Summary:**
  - Total used vs capacity across all storage mounts.
  - Canary heartbeat status badge (`CANARY OK` vs `ALERT`).
  - Physical Root SSD SMART status chip (`SMART PASSED`).
  - Direct navigation link to Storage & Infra page.
- [ ] **Quick Actions & Shortcuts Deck:**
  - Direct trigger button to launch Command Deck (`Ctrl+K`).
  - Direct shortcut links to all active homelab modules (Fleet, Infra, Terminal, Processes, Git Projects, Sentinel, AI Agents).
- [ ] **Personal Web Shortcuts (`BookmarksSection`):**
  - `<BookmarksSection />` startpage grid for personal links (YouTube, Homelab tools, etc.).
  - Automatic Google favicon resolution.
  - Interactive modal for adding, editing, and deleting shortcuts.
  - Drag-and-drop reordering with persistent server-side save (`/api/bookmarks/reorder`).
  - Actionable Empty State button ("Add First Shortcut") when list is empty.

### E. Layout Shell & Sub-page Hosting
- [ ] **Outlet Hosting:** `<Outlet />` cleanly mounted for nested child routes.
- [ ] **Scoped Notice / Warning Banners:** Informational or beta banners must be scoped strictly to the overview page (or dismissible via `X`), and must **never** block or shift down full-screen tools like `<TerminalPage />` or `<ProcessesPage />`.
- [ ] **Watchdog Alerts:** `<DasWatchdogAlert />` mounted globally across the layout.

---

## 2. Base Code Architecture & File Map

| Component / Layer | Primary Location | Responsibility |
| :--- | :--- | :--- |
| **Router & Shell** | `client/src/App.tsx` | Route definitions, layout switching, Command Palette state. |
| **Layout Shell (Classic)** | `client/src/App.tsx` | Standard glassmorphic layout container. |
| **Layout Shell (Beta)** | `client/src/layouts/BetaLayout.tsx` | High-contrast brutalist layout container with scoped alerts. |
| **Header (Classic)** | `client/src/components/Header.tsx` | Glassmorphic top navigation bar with widgets and action buttons. |
| **Header (Beta)** | `client/src/components/BetaHeader.tsx` | Brutalist top bar with notifications, `Ctrl+K` hint, and controls. |
| **Sidebar (Classic)** | `client/src/components/Sidebar.tsx` | Desktop floating collapsible rail with collapsible groups (`NAV_GROUPS`; `NAV_ROUTES` is derived from it). |
| **Sidebar (Beta)** | `client/src/components/BetaSidebar.tsx` | Brutalist collapsible rail (`BETA_NAV_ROUTES`) with storage toggle. |
| **Command Palette** | `client/src/components/CommandPalette.tsx` | Global `Ctrl+K` modal with layout-aware route preservation. |
| **Overview (Classic)** | `client/src/pages/HomePage.tsx` | Glassmorphism dashboard overview with telemetry panels. |
| **Overview (Beta)** | `client/src/pages/HomePageBeta.tsx` | Brutalist high-density telemetry overview, shortcuts & quick deck. |
| **Personal Shortcuts** | `client/src/components/BookmarksSection.tsx` | Startpage bookmark cards with drag-and-drop & empty state CTA. |
| **Formatters & Logic** | `client/src/utils/formatters.ts` | Single source of truth for byte sizing, redaction, and status thresholds (`getStatusColor`, `getTempColor`). |
| **Design Tokens & Styles**| `client/src/index.css` & `tailwind.config.js` | CSS variables (`cockpit-*`, `state-*`) and theme overrides. |

---

## 3. Guide for Creating a New UI Style or Layout Variant

When developing a new style variant (e.g., Minimalist, Cyberpunk, Compact, etc.):

1. **Create the Layout Shell:**
   - Create `client/src/layouts/<StyleName>Layout.tsx`.
   - Render the layout's custom Header and Sidebar.
   - Include `<DasWatchdogAlert />` and child `<Outlet />`.
   - Ensure any banner is dismissible and scoped to overview only.

2. **Implement Header & Sidebar Parity:**
   - Follow Sections 1.A and 1.B of the parity checklist.
   - Wire all global control triggers: theme, privacy mode, fullscreen, notifications, sync, logout, and `onOpenCommandPalette`.
   - Keep route arrays synchronized with `NAV_ROUTES`.

3. **Implement Overview / Home Page Parity:**
   - Create `client/src/pages/<StyleName>HomePage.tsx`.
   - Implement all data points from Section 1.D (Host specs, CPU load %, RAM used/total, Thermal sensor, Workloads/pins, Network RX/TX, Storage & DAS summary, Quick Actions deck, BookmarksSection).
   - Use `getStatusColor()` and `getTempColor()` from `formatters.ts` for thresholds.
   - Use `redactText()` for all IPs and sensitive strings.

4. **Preserve Command Palette Navigation:**
   - Update `CommandPalette.tsx` to detect `location.pathname.startsWith('/<style-route>')`.
   - Ensure page navigation targets retain the active layout's path prefix.

5. **Register Routes in `App.tsx`:**
   - Register the layout under `<Route path="/<style-route>" element={<StyleLayout {...layoutProps} />}>`.
   - Pass `onOpenCommandPalette` to the overview page component.

6. **Validate & Verify:**
   - Run full client and server checks: `npm run build`.
   - Test responsive layout on both desktop and mobile viewports.

7. **Update Documentation (Mandatory):**
   - Append changes and notes to this guide (`docs/LAYOUT_AND_STYLES_GUIDE.md`).
   - Append task summary to [AGENT_LOG.md](../AGENT_LOG.md).
   - Bump version and update [announcements.json](../announcements.json).

---

## 4. Changelog — 2026-09-15 UI overhaul & feature batch

- **Sidebar is now `sticky`, not flow-positioned.** `Sidebar.tsx` uses `sticky top-[var(--header-h)] self-start max-h-[calc(100vh-var(--header-h))] overflow-y-auto` — `LegacyLayout.tsx` measures the header's real height with a `ResizeObserver` and exposes it as the `--header-h` CSS variable on the layout root, so the sidebar no longer scrolls away with page content and self-adjusts if the header's height changes (e.g. demo-mode banner, node warning).
- **Header consolidated.** `Header.tsx` keeps Command Deck, Notifications and Theme toggle inline; Settings, Fullscreen, Refresh and Sign out moved into a single "More" dropdown (`MoreVertical` icon-btn) to cut down on button clutter, following the existing relative-div dropdown convention already used by `NotificationsPanel.tsx`.
- **Container Fleet full management.** `ContainerGridSection.tsx` now defaults to card view (`cockpit-fleet-view` localStorage key defaults to `cards`), adds an All/Pinned filter segment, and every container (card view and table view) gets Start/Stop/Restart actions. `RestartModal.tsx` was generalized to accept an `action: 'restart' | 'stop' | 'start'` prop (`PowerAction` type) instead of being restart-only; server-side `DockerService.stopContainer()`/`startContainer()` mirror the existing `restartContainer()` shape, and `POST /api/containers/:id/stop` / `/start` mirror the existing `/restart` route.
- **Git Projects show last deploy time.** `GitProjectRecord.lastDeployedAt` (server) is set whenever `pullAndRebuild()` succeeds and surfaced through `getSnapshot()` as `GitProjectStatus.lastDeployedAt`; `GitPullInline.tsx` renders it above the pull/rebuild UI.
- **New Logs page (`/logs`).** `AuditLogService` (`server/src/services/audit-log.service.ts`, `data/audit-log.json`, capped at 5000 entries) is a separate, larger-scale sibling to `NotificationsService` — it's meant to be a real audit trail, not a 50-entry UI feed. It's written to from every state-changing route in `index.ts` (auth, pins, container power actions, git register/unregister/pull, backup/restore, config import) plus a global Fastify `setErrorHandler` that logs any uncaught route error. `LogsPage.tsx` polls `GET /api/audit-log` every 5s with category/level filters and search. Added to `Sidebar.tsx` `NAV_ROUTES`, `CommandPalette.tsx` `PAGES`, and `App.tsx` routes per the "three lists must agree" rule.
- **Shortcuts (Bookmarks) support owner-defined groups.** `BookmarkRecord.group?: string` (server) is optional and freeform; `BookmarksSection.tsx` groups the non-reordering grid view by `group` (ungrouped items render first, under no heading), and the add/edit modal offers a `<datalist>` of existing group names for consistency. Reordering (drag & drop) still operates on the flat list, same as before groups existed.
- **AI Agents Monitor is more transparent, not more "real."** No Anthropic Console admin API key is available to this deployment, so the 5-hour/weekly numbers remain a local estimate derived from this host's T3 session history (`~/.t3/userdata/state.sqlite`), not the account's authoritative usage counter. `AiAgentsPage.tsx` now shows a permanent (non-collapsible) disclaimer panel saying so, and each agent card shows `turnsToday` (new field on `AgentInstanceTelemetry`, computed server-side in `ai-agents.service.ts`) and a "last active" timestamp for more at-a-glance detail.
- **Grouped navigation, Settings page, phone bottom bar (2026-10-31).** `Sidebar.tsx` exports `NAV_GROUPS` (Infrastructure, Network, Develop, Automation, System); open/closed groups persist in `cockpit-sidebar-groups-closed`. `MobileNav.tsx` replaces the header nav strip on phones. Settings moved from a modal to `/settings` (`SettingsPage.tsx`), and its theme buttons now drive `useTheme` instead of toggling a `dark` class the theme system never read.
- **Cloudflare page (`/cloudflare`).** `cloudflare.service.ts` discovers every remotely-managed tunnel and every zone of the account (token plus account id only), reads each tunnel's ingress and each zone's CNAMEs, and reports per-hostname DNS state. `CloudflareFlowMap.tsx` draws domain, tunnel and origin as a graph (vertical stack under 640px). Writes read-modify-write the whole ingress list with the catch-all kept last; a hostname that lives on another tunnel is only taken over with an explicit move.
- **Shared states and accessibility.** `StateBlock.tsx` is the single loading/empty/error block. `index.css` adds a visible keyboard focus ring, a light-theme palette that passes WCAG AA, an always-visible page scrollbar (no sideways jump when content height changes), and phone tap-target and 11px text floors.
