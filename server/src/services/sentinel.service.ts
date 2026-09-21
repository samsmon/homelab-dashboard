import { config } from '../config.js';
import { CockpitSnapshot, SentinelStatus } from '../types.js';
import { DockerService } from './docker.service.js';

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

interface PendingConfirmation {
  action: 'restart' | 'prune';
  target?: string;
  expiresAt: number;
}

export class SentinelService {
  private dockerService: DockerService;
  private getLatestSnapshot: () => CockpitSnapshot | null;
  private isPolling = false;
  private abortController: AbortController | null = null;
  private botUsername: string | undefined = undefined;
  private lastUpdateId = 0;
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private lastCommandAt?: string;
  private lastCommand?: string;

  constructor(
    dockerService: DockerService,
    getLatestSnapshot: () => CockpitSnapshot | null
  ) {
    this.dockerService = dockerService;
    this.getLatestSnapshot = getLatestSnapshot;
  }

  public async start() {
    const { telegramToken, allowedUserIds } = config.sentinel;

    if (!telegramToken) {
      console.log('[Sentinel] Telegram bot token not configured. Sentinel is running in STANDBY mode.');
      return;
    }

    if (allowedUserIds.length === 0) {
      console.warn('[Sentinel] WARNING: TELEGRAM_ALLOWED_USER_IDS is empty. All Telegram commands will be blocked for safety.');
    }

    try {
      // Verify bot token with getMe
      const res = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`);
      const data = (await res.json()) as any;
      if (!data?.ok) {
        console.error('[Sentinel] Failed to verify Telegram bot token:', data?.description);
        return;
      }

      this.botUsername = data.result?.username;
      this.isPolling = true;
      this.abortController = new AbortController();
      console.log(`[Sentinel] 🤖 Telegram Bot @${this.botUsername} connected successfully! Polling started.`);

      // Start non-blocking polling loop
      this.pollUpdates();
    } catch (err) {
      console.error('[Sentinel] Error connecting to Telegram Bot API:', err);
    }
  }

  public stop() {
    this.isPolling = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[Sentinel] Telegram polling stopped.');
  }

  public getStatus(): SentinelStatus {
    return {
      enabled: Boolean(config.sentinel.telegramToken),
      botUsername: this.botUsername,
      polling: this.isPolling,
      allowedUsersCount: config.sentinel.allowedUserIds.length,
      geminiConfigured: Boolean(config.sentinel.geminiApiKey),
      managedContainers: config.sentinel.managedContainers,
      lastCommandAt: this.lastCommandAt,
      lastCommand: this.lastCommand,
    };
  }

  private async pollUpdates() {
    const token = config.sentinel.telegramToken;

    while (this.isPolling) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: this.abortController?.signal });
        
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }

        const data = (await res.json()) as any;
        if (data?.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            if (update.message && update.message.text) {
              await this.handleMessage(update.message);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        // Network timeout or glitch, wait briefly
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  private async handleMessage(msg: any) {
    const chatId = msg.chat.id;
    const fromId = msg.from?.id?.toString();
    const text = (msg.text || '').trim();

    // Security check: fail closed
    if (!fromId || !config.sentinel.allowedUserIds.includes(fromId)) {
      console.warn(`[Sentinel] Unauthorized message received from user ID: ${fromId} (${msg.from?.username || 'unknown'}). Ignoring.`);
      return;
    }

    this.lastCommandAt = new Date().toLocaleTimeString();
    this.lastCommand = text.slice(0, 40);

    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case '/start':
      case '/help':
        await this.sendHelp(chatId);
        break;
      case '/status':
        await this.sendStatus(chatId);
        break;
      case '/resources':
        await this.sendResources(chatId);
        break;
      case '/backup_status':
        await this.sendBackupStatus(chatId);
        break;
      case '/logs':
        await this.sendLogs(chatId, args[0]);
        break;
      case '/restart':
        await this.handleRestartRequest(chatId, fromId, args[0]);
        break;
      case '/prune':
        await this.handlePruneRequest(chatId, fromId);
        break;
      case '/confirm':
        await this.handleConfirm(chatId, fromId);
        break;
      case '/cancel':
        await this.handleCancel(chatId, fromId);
        break;
      default:
        // Free-form Q&A or /ask command (Tier 2 - Gemini)
        await this.handleGeminiQuery(chatId, text.replace(/^\/ask\s*/i, ''));
        break;
    }
  }

  private async sendMessage(chatId: number, text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown') {
    try {
      await fetch(`https://api.telegram.org/bot${config.sentinel.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      console.error('[Sentinel] Error sending Telegram message:', err);
    }
  }

  private async sendHelp(chatId: number) {
    const pve = this.getLatestSnapshot()?.host.pve;
    const hardwareLine = pve
      ? `_Hardware: ${pve.cpuModel} (${pve.cpuCores} cores), ${formatBytes(pve.ramTotalBytes)} RAM_`
      : `_Hardware: telemetry not yet available_`;

    const msg = [
      `🛡️ *Homelab Sentinel — Mobile Operator Bot*`,
      hardwareLine,
      ``,
      `*Tier 1 (Read-Only Telemetry)*`,
      `• /status — Host CPU, RAM, Proxmox, and containers`,
      `• /resources — Multi-Bay DAS & NVMe disk matrix`,
      `• /backup\\_status — Proxmox vzdump nightly backup status`,
      `• /logs <container> — View recent container logs`,
      ``,
      `*Tier 2 (AI Homelab Assistant)*`,
      `• Send any plain question or \`/ask <question>\` to consult Gemini with live homelab telemetry context.`,
      ``,
      `*Tier 3 (Dangerous Actions with /confirm)*`,
      `• /restart <container> — Restart whitelisted container`,
      `• /prune — Clean Docker dangling images & build cache`,
      `• /confirm — Confirm pending action within 60s`,
      `• /cancel — Cancel pending action`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async sendStatus(chatId: number) {
    const snap = this.getLatestSnapshot();
    if (!snap) {
      await this.sendMessage(chatId, '⚠️ Homelab telemetry snapshot is initializing...');
      return;
    }

    const pve = snap.host.pve;
    const lxc = snap.host.dockerHost;
    const runningContainers = snap.containers.filter(c => c.state === 'running').length;
    const totalContainers = snap.containers.length;
    const canaryOk = snap.storage.every(s => !s.isExternal || s.canaryPresent);

    const msg = [
      `📊 *Homelab Status Snapshot*`,
      `--------------------------------`,
      `🖥️ *Proxmox Node (${pve.nodeName})*: \`${pve.ip}\``,
      `  • CPU: *${pve.cpuPercent.toFixed(1)}%* (${pve.cpuTempCelsius !== undefined ? `${pve.cpuTempCelsius.toFixed(1)}°C` : 'n/a'})`,
      `  • RAM: *${formatBytes(pve.ramUsedBytes)}* / *${formatBytes(pve.ramTotalBytes)}* (${pve.ramPercent.toFixed(1)}%)`,
      ``,
      `📦 *Docker Runner LXC (${lxc.hostname})*: \`${lxc.ip}\``,
      `  • CPU: *${lxc.cpuPercent.toFixed(1)}%* | Fan: *${lxc.thermalThrottle?.fanSpeedPercent !== undefined ? `${lxc.thermalThrottle.fanSpeedPercent}%` : 'n/a'}*`,
      `  • Active Containers: *${runningContainers}* / *${totalContainers}* running`,
      ``,
      `🛡️ *DAS External Canary Check*: ${canaryOk ? '🟢 *CANARY OK (All Mounts Stable)*' : '🔴 *WARNING: DAS Mount Lost!*'}`,
      `🌐 *Tailscale Mesh*: *${snap.tailscale.totalOnline}* / *${snap.tailscale.totalDevices}* peers online`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async sendResources(chatId: number) {
    const snap = this.getLatestSnapshot();
    if (!snap) {
      await this.sendMessage(chatId, '⚠️ Telemetry snapshot is initializing...');
      return;
    }

    const storageLines = snap.storage.map(s => {
      const type = s.isExternal ? '🗄️ DAS' : '⚡ NVMe';
      return `• *${s.label}* (\`${s.mount}\`)\n  ${type}: ${formatBytes(s.usedBytes)} / ${formatBytes(s.totalBytes)} (*${s.usedPercent.toFixed(1)}%*) — ${s.status.toUpperCase()}`;
    }).join('\n\n');

    const msg = [
      `💾 *Storage Matrix & Disk Vitals*`,
      `--------------------------------`,
      storageLines,
      ``,
      `🧹 *Docker NVMe Reclaimable*: *${formatBytes(snap.dockerHygiene.reclaimableBytes)}* recoverable`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async sendBackupStatus(chatId: number) {
    const snap = this.getLatestSnapshot();
    const backup = snap?.host.pve.backupVitals;

    if (!backup) {
      await this.sendMessage(chatId, 'ℹ️ No Proxmox backup records available.');
      return;
    }

    const isSuccess = backup.status === 'succeeded';
    const msg = [
      `💾 *Proxmox Backup Vitals (vzdump)*`,
      `--------------------------------`,
      `• Status: ${isSuccess ? '🟢 *SUCCEEDED*' : '🔴 *FAILED*'}`,
      `• Target: *VM/LXC ${backup.vmid}*`,
      `• Timestamp: *${backup.lastBackupTime}*`,
      `• Archive Size: *${formatBytes(backup.backupSizeBytes)}*`,
      `• Duration: *${backup.durationSeconds} seconds*`,
      `• Storage Pool: \`${backup.targetStorage}\``,
      ``,
      `_Automated nightly retention is healthy._`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async sendLogs(chatId: number, containerName?: string) {
    if (!containerName) {
      await this.sendMessage(chatId, '⚠️ Usage: `/logs <container_name>` (e.g. `/logs jellyfin`)');
      return;
    }

    try {
      const { logs } = await this.dockerService.getLogs(containerName.toLowerCase(), 20);
      const trimmed = logs.slice(-3000); // Telegram 4096 char limit
      const msg = `📋 *Recent Logs for \`${containerName}\`:*\n\`\`\`\n${trimmed}\n\`\`\``;
      await this.sendMessage(chatId, msg);
    } catch (err: any) {
      await this.sendMessage(chatId, `❌ Failed to fetch logs for \`${containerName}\`: ${err.message}`);
    }
  }

  private async handleRestartRequest(chatId: number, fromId: string, containerName?: string) {
    if (!containerName) {
      await this.sendMessage(chatId, `⚠️ Usage: \`/restart <container>\`\nAllowed containers: \`${config.sentinel.managedContainers.join(', ')}\``);
      return;
    }

    const normalized = containerName.toLowerCase();
    if (!config.sentinel.managedContainers.includes(normalized)) {
      await this.sendMessage(chatId, `⛔ *Action Denied*: \`${containerName}\` is not in the MANAGED_CONTAINERS whitelist.`);
      return;
    }

    this.pendingConfirmations.set(fromId, {
      action: 'restart',
      target: normalized,
      expiresAt: Date.now() + 60000,
    });

    const msg = [
      `⚠️ *CONFIRMATION REQUIRED (Tier 3)*`,
      `Are you sure you want to restart container *${normalized}*?`,
      ``,
      `👉 Send */confirm* within 60 seconds to proceed.`,
      `👉 Send */cancel* to abort.`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async handlePruneRequest(chatId: number, fromId: string) {
    const snap = this.getLatestSnapshot();
    const reclaimable = snap ? formatBytes(snap.dockerHygiene.reclaimableBytes) : 'several gigabytes';

    this.pendingConfirmations.set(fromId, {
      action: 'prune',
      expiresAt: Date.now() + 60000,
    });

    const msg = [
      `⚠️ *CONFIRMATION REQUIRED (Tier 3)*`,
      `Prune dangling Docker images and build cache on internal NVMe SSD?`,
      `Estimated recoverable space: *${reclaimable}*`,
      ``,
      `👉 Send */confirm* within 60 seconds to execute.`,
      `👉 Send */cancel* to abort.`,
    ].join('\n');

    await this.sendMessage(chatId, msg);
  }

  private async handleConfirm(chatId: number, fromId: string) {
    const pending = this.pendingConfirmations.get(fromId);
    if (!pending || Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(fromId);
      await this.sendMessage(chatId, '❌ No active pending action or confirmation window timed out (60s).');
      return;
    }

    this.pendingConfirmations.delete(fromId);

    if (pending.action === 'restart' && pending.target) {
      await this.sendMessage(chatId, `🔄 Restarting container \`${pending.target}\`...`);
      const res = await this.dockerService.restartContainer(pending.target);
      await this.sendMessage(chatId, res.success ? `✅ *Success*: ${res.message}` : `❌ *Failed*: ${res.message}`);
    } else if (pending.action === 'prune') {
      await this.sendMessage(chatId, `🧹 Executing Docker disk prune on NVMe SSD...`);
      const res = await this.dockerService.pruneSystem();
      await this.sendMessage(chatId, res.success ? `✅ *Prune Complete*: ${res.message}` : `❌ *Failed*: ${res.message}`);
    }
  }

  private async handleCancel(chatId: number, fromId: string) {
    if (this.pendingConfirmations.has(fromId)) {
      this.pendingConfirmations.delete(fromId);
      await this.sendMessage(chatId, '🚫 Action cancelled.');
    } else {
      await this.sendMessage(chatId, 'ℹ️ No pending action to cancel.');
    }
  }

  private async handleGeminiQuery(chatId: number, prompt: string) {
    if (!config.sentinel.geminiApiKey) {
      await this.sendMessage(chatId, '🤖 *Gemini AI is not configured.*\nTo ask questions in natural language, set `GEMINI_API_KEY` in your `.env` file.');
      return;
    }

    const snap = this.getLatestSnapshot();
    const pve = snap?.host.pve;
    const lxc = snap?.host.dockerHost;
    const selfTailscaleIp = snap?.tailscale.devices.find(d => d.isCurrentDevice)?.ipv4;
    const hardwareLine = pve
      ? `Host: ${pve.cpuModel} (${pve.cpuCores} cores), ${formatBytes(pve.ramTotalBytes)} RAM.`
      : 'Host hardware: telemetry not yet available.';

    const systemContext = `
You are Homelab Sentinel, an intelligent AI operational assistant for a self-hosted homelab.
${hardwareLine}
Hypervisor: Proxmox VE${pve?.ip ? ` (${pve.ip})` : ''}.
Container Host: ${lxc?.hostname || 'Docker host'}${lxc?.ip ? ` (${lxc.ip})` : ''} with Docker.
Storage: ${config.storageMounts.join(', ')}.
Network: Tailscale mesh${selfTailscaleIp ? ` (${selfTailscaleIp})` : ''}.

Current Telemetry Snapshot:
${JSON.stringify({
  pveCpu: snap?.host.pve.cpuPercent,
  pveRamUsed: snap ? formatBytes(snap.host.pve.ramUsedBytes) : undefined,
  lxcCpu: snap?.host.dockerHost.cpuPercent,
  runningContainersCount: snap?.containers.filter(c => c.state === 'running').length,
  storageAlerts: snap?.storage.filter(s => s.status !== 'healthy').map(s => s.label),
  dasCanaryOk: snap?.storage.every(s => !s.isExternal || s.canaryPresent),
  lastBackup: snap?.host.pve.backupVitals?.lastBackupTime,
}, null, 2)}

User Question: "${prompt}"

Instructions:
- Provide a helpful, concise answer in the same language as the user (Indonesian or English).
- Be factual and reference the telemetry data if relevant.
- You are strictly an answering/formatting LLM and NEVER have execution tools.
- Keep response under 400 words.
`;

    try {
      const model = config.sentinel.geminiModel || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.sentinel.geminiApiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: systemContext }] }],
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        await this.sendMessage(chatId, `⚠️ Gemini API error: ${res.status} (${errorText.slice(0, 100)})`);
        return;
      }

      const data = (await res.json()) as any;
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
      await this.sendMessage(chatId, `🤖 *Sentinel AI:*\n\n${reply}`);
    } catch (err: any) {
      await this.sendMessage(chatId, `❌ Error querying Gemini: ${err.message}`);
    }
  }
}
