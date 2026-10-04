import fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { AuthService } from './services/auth.service.js';
import { SettingsService } from './services/settings.service.js';
import { DockerService } from './services/docker.service.js';
import { ProxmoxService } from './services/proxmox.service.js';
import { SystemService } from './services/system.service.js';
import { TailscaleService } from './services/tailscale.service.js';
import { SslService } from './services/ssl.service.js';
import { PinsService } from './services/pins.service.js';
import { BookmarksService } from './services/bookmarks.service.js';
import { NotificationsService } from './services/notifications.service.js';
import { GitProjectsService, RebuildCommand } from './services/git-projects.service.js';
import { BackupService } from './services/backup.service.js';
import { TerminalService } from './services/terminal.service.js';
import { CollectorService } from './services/collector.service.js';
import { ServiceProbeService } from './services/service-probe.service.js';
import { MetricHistoryService } from './services/metric-history.service.js';
import { SentinelService } from './services/sentinel.service.js';
import { AppUpdateService } from './services/app-update.service.js';
import { AiAgentsService } from './services/ai-agents.service.js';
import { auditLogService } from './services/audit-log.service.js';
import { DiskScanService } from './services/disk-scan.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const app = fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  await app.register(fastifyWebsocket);

  // Initialize services
  const authService = new AuthService();
  const settingsService = new SettingsService();
  const dockerServices = config.dockerHosts.map(
    (hostConfig, index) => new DockerService(hostConfig, index === 0)
  );
  const primaryDockerService = dockerServices[0];
  const proxmoxService = new ProxmoxService();
  const systemService = new SystemService();
  const tailscaleService = new TailscaleService();
  const sslService = new SslService();
  const pinsService = new PinsService();
  const bookmarksService = new BookmarksService();
  const notificationsService = new NotificationsService();
  const gitProjectsService = new GitProjectsService(notificationsService);
  const backupService = new BackupService();
  const terminalService = new TerminalService();
  const appUpdateService = new AppUpdateService(notificationsService);
  const aiAgentsService = new AiAgentsService();
  const diskScanService = new DiskScanService();

  let sentinelService: SentinelService | null = null;

  const collectorService = new CollectorService(
    dockerServices,
    proxmoxService,
    systemService,
    tailscaleService,
    sslService,
    pinsService,
    gitProjectsService,
    new ServiceProbeService(),
    new MetricHistoryService(),
    () => sentinelService?.getStatus(),
    () => appUpdateService.getVersionInfo(),
    () => settingsService.getPrimaryNodeName()
  );

  // The Sentinel bot and disk hygiene/prune only ever act on the primary
  // Docker host — each additional host has its own separate disk and is
  // not part of the managed-container whitelist.
  sentinelService = new SentinelService(
    primaryDockerService,
    () => collectorService.getLastSnapshot()
  );

  collectorService.start();
  sentinelService.start();
  backupService.start();

  // Helper to extract bearer token
  const extractToken = (req: any): string => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    if (req.query && req.query.token) {
      return req.query.token as string;
    }
    return '';
  };

  const actorFor = (_req: any): string | null => authService.getUsername();

  app.setErrorHandler((error: Error, request, reply) => {
    auditLogService.log('system', 'error', `${request.method} ${request.url} failed: ${error.message}`, {
      actor: actorFor(request),
      detail: error.stack,
    });
    reply.status((error as any).statusCode || 500).send({ error: error.message });
  });

  // Auth Protection Hook for /api/*
  app.addHook('preHandler', async (request, reply) => {
    const url = request.url.split('?')[0];

    // Allow public health & auth routes
    if (url === '/api/health' || url.startsWith('/api/auth/')) {
      return;
    }

    // Only protect /api routes
    if (url.startsWith('/api/')) {
      // If no owner is registered yet, prompt client to register
      if (!authService.isRegistered()) {
        reply.status(401).send({ error: 'Initial owner registration required', code: 'SETUP_REQUIRED' });
        return;
      }

      const token = extractToken(request);
      if (!authService.validateToken(token)) {
        reply.status(401).send({ error: 'Unauthorized access. Please login.', code: 'AUTH_REQUIRED' });
        return;
      }
    }
  });

  // WebSocket Route with Auth Check
  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!authService.isRegistered()) {
      socket.send(JSON.stringify({ type: 'ERROR', message: 'Owner setup required' }));
      socket.close();
      return;
    }

    const token = extractToken(req);
    if (!authService.validateToken(token)) {
      socket.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized WebSocket' }));
      socket.close();
      return;
    }

    collectorService.addClient(socket);
  });

  // Terminal WebSocket — same auth as /ws. See terminal.service.ts: this is
  // the one feature with no command whitelist, by design.
  app.get('/ws/terminal', { websocket: true }, (socket, req) => {
    if (!authService.isRegistered()) {
      socket.close();
      return;
    }

    const token = extractToken(req);
    if (!authService.validateToken(token)) {
      socket.close();
      return;
    }

    const { target } = req.query as { target?: string };
    if (!target) {
      socket.close();
      return;
    }

    terminalService.openSession(target, socket);
  });

  // REST API: Public Auth Routes
  app.get('/api/auth/status', async (req) => {
    const token = extractToken(req);
    const isAuthenticated = authService.validateToken(token);
    return {
      registered: authService.isRegistered(),
      authenticated: isAuthenticated,
    };
  });

  app.post('/api/auth/register', async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    const result = authService.registerOwner(body?.username || '', body?.password || '');
    auditLogService.log('auth', result.success ? 'info' : 'warn', result.success ? `Owner account registered (${body?.username})` : `Registration failed: ${result.message}`, { actor: body?.username || null });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string; rememberMe?: boolean };
    const result = authService.login(body?.username || '', body?.password || '', body?.rememberMe ?? true);
    auditLogService.log('auth', result.success ? 'info' : 'warn', result.success ? `Login succeeded (${body?.username})` : `Login failed: ${result.message}`, { actor: body?.username || null });
    if (!result.success) {
      reply.status(401);
    }
    return result;
  });

  app.post('/api/auth/logout', async (req) => {
    const token = extractToken(req);
    const actor = actorFor(req);
    if (token) {
      authService.logout(token);
    }
    auditLogService.log('auth', 'info', 'Logged out', { actor });
    return { success: true, message: 'Logged out successfully.' };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const token = extractToken(req);
    if (!authService.validateToken(token)) {
      reply.status(401);
      return { success: false, message: 'Unauthorized. Please login first.' };
    }
    const body = req.body as { currentPassword?: string; newPassword?: string };
    const result = authService.changePassword(body?.currentPassword || '', body?.newPassword || '');
    auditLogService.log('auth', result.success ? 'info' : 'warn', result.success ? 'Password changed' : `Password change failed: ${result.message}`, { actor: actorFor(req) });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  // Settings routes (protected by preHandler)
  app.get('/api/settings', async () => {
    return settingsService.getSettings();
  });

  app.patch('/api/settings', async (req) => {
    const body = req.body as { primaryNodeName?: string };
    const updated = settingsService.updateSettings(body || {});
    await collectorService.collectAndBroadcast();
    return updated;
  });

  // REST API: Protected Cockpit Routes
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  });

  app.get('/api/metrics/history', async (request) => {
    const { limit } = request.query as { limit?: string };
    return collectorService.getMetricHistory(parseInt(limit || '60', 10) || 60);
  });

  app.get('/api/snapshot', async () => {
    const snapshot = await collectorService.collect();
    return snapshot;
  });

  app.get('/api/tailscale', async () => {
    const status = await tailscaleService.getStatus();
    return status;
  });

  app.get('/api/ssl', async () => {
    const certs = await sslService.getCertificates();
    return certs;
  });

  app.get('/api/sentinel', async () => {
    return sentinelService?.getStatus() || { enabled: false, polling: false };
  });

  app.get('/api/processes', async () => {
    return systemService.getProcesses();
  });

  app.get('/api/processes/docker', async () => {
    const perHost = await Promise.all(dockerServices.map((svc) => svc.getContainerProcesses()));
    return perHost.flat();
  });

  app.get('/api/processes/remote/:target', async (request) => {
    const { target } = request.params as { target: string };
    return terminalService.getRemoteProcesses(target);
  });

  // Live container usage monitoring (on-demand, 5m auto-stop)
  app.get('/api/containers/monitor', async () => {
    return {
      active: collectorService.isContainerMonitoringActive(),
      remainingMs: collectorService.getContainerMonitoringRemainingMs(),
    };
  });

  app.post('/api/containers/monitor', async (request) => {
    const body = request.body as { active?: boolean; durationMs?: number };
    const shouldActive = Boolean(body?.active);
    const duration = typeof body?.durationMs === 'number' ? body.durationMs : 300000;
    collectorService.setContainerMonitoring(shouldActive, duration);
    collectorService.collectAndBroadcast().catch(() => {});
    return {
      active: shouldActive,
      remainingMs: shouldActive ? duration : 0,
      message: shouldActive ? 'Live container usage monitoring started' : 'Live container usage monitoring stopped',
    };
  });

  app.post('/api/docker/prune', async (request) => {
    const result = await primaryDockerService.pruneSystem();
    auditLogService.log('container', 'info', 'Docker prune executed', { actor: actorFor(request), detail: JSON.stringify(result) });
    return result;
  });

  app.get('/api/containers/:id/logs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tail } = request.query as { tail?: string };
    const tailCount = tail ? parseInt(tail, 10) : 100;
    const service = collectorService.getDockerServiceForContainer(id) || primaryDockerService;
    const logs = await service.getLogs(id, tailCount);
    return logs;
  });

  app.post('/api/containers/:id/restart', async (request, reply) => {
    const { id } = request.params as { id: string };
    const service = collectorService.getDockerServiceForContainer(id) || primaryDockerService;
    const result = await service.restartContainer(id);
    auditLogService.log('container', result.success ? 'info' : 'error', `Restart ${id.slice(0, 12)}: ${result.message}`, { actor: actorFor(request) });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/containers/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const service = collectorService.getDockerServiceForContainer(id) || primaryDockerService;
    const result = await service.stopContainer(id);
    auditLogService.log('container', result.success ? 'info' : 'error', `Stop ${id.slice(0, 12)}: ${result.message}`, { actor: actorFor(request) });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/containers/:id/start', async (request, reply) => {
    const { id } = request.params as { id: string };
    const service = collectorService.getDockerServiceForContainer(id) || primaryDockerService;
    const result = await service.startContainer(id);
    auditLogService.log('container', result.success ? 'info' : 'error', `Start ${id.slice(0, 12)}: ${result.message}`, { actor: actorFor(request) });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/pins/:name', async (request) => {
    const { name } = request.params as { name: string };
    const body = request.body as { publicUrl?: string };
    const record = pinsService.pin(name, body?.publicUrl);
    notificationsService.add('pin', `Pinned ${name}`);
    auditLogService.log('pin', 'info', `Pinned ${name}`, { actor: actorFor(request) });
    return { success: true, pin: record };
  });

  app.delete('/api/pins/:name', async (request) => {
    const { name } = request.params as { name: string };
    pinsService.unpin(name);
    notificationsService.add('unpin', `Unpinned ${name}`);
    auditLogService.log('pin', 'info', `Unpinned ${name}`, { actor: actorFor(request) });
    return { success: true };
  });

  app.get('/api/audit-log', async () => {
    return auditLogService.getAll();
  });

  app.post('/api/audit-log/clear', async (request) => {
    auditLogService.clear();
    auditLogService.log('system', 'info', 'Audit log cleared', { actor: actorFor(request) });
    return { success: true };
  });

  app.get('/api/notifications', async () => {
    return notificationsService.getAll();
  });

  app.post('/api/notifications/clear', async () => {
    notificationsService.clear();
    return { success: true };
  });

  app.get('/api/bookmarks', async () => {
    return bookmarksService.getAll();
  });

  app.get('/api/bookmarks/groups', async () => {
    return bookmarksService.getGroups();
  });

  app.post('/api/bookmarks/groups', async (request, reply) => {
    const body = request.body as { name?: string };
    if (!body?.name?.trim()) {
      reply.status(400);
      return { success: false, message: 'Group name is required' };
    }
    const groups = bookmarksService.addGroup(body.name);
    return { success: true, groups };
  });

  app.post('/api/bookmarks', async (request, reply) => {
    const body = request.body as { name?: string; url?: string; group?: string };
    if (!body?.name?.trim() || !body?.url?.trim()) {
      reply.status(400);
      return { success: false, message: 'name and url are required' };
    }
    const record = bookmarksService.add(body.name, body.url, body.group);
    auditLogService.log('bookmark', 'info', `Added bookmark ${body.name}`, { actor: actorFor(request) });
    return { success: true, bookmark: record };
  });

  app.put('/api/bookmarks/reorder', async (request, reply) => {
    const body = request.body as { ids?: string[] };
    if (!Array.isArray(body?.ids)) {
      reply.status(400);
      return { success: false, message: 'ids array is required' };
    }
    const bookmarks = bookmarksService.reorder(body.ids);
    return { success: true, bookmarks };
  });

  app.put('/api/bookmarks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; url?: string; group?: string };
    if (!body?.name?.trim() || !body?.url?.trim()) {
      reply.status(400);
      return { success: false, message: 'name and url are required' };
    }
    const record = bookmarksService.update(id, body.name, body.url, body.group);
    if (!record) {
      reply.status(404);
      return { success: false, message: 'Bookmark not found' };
    }
    return { success: true, bookmark: record };
  });

  app.delete('/api/bookmarks/:id', async (request) => {
    const { id } = request.params as { id: string };
    bookmarksService.remove(id);
    return { success: true };
  });

  app.put('/api/bookmarks/groups/rename', async (request, reply) => {
    const body = request.body as { oldName?: string; newName?: string };
    if (!body?.oldName?.trim() || !body?.newName?.trim()) {
      reply.status(400);
      return { success: false, message: 'oldName and newName are required' };
    }
    const count = bookmarksService.renameGroup(body.oldName, body.newName);
    auditLogService.log('bookmark', 'info', `Renamed shortcut group '${body.oldName}' to '${body.newName}' (${count} items)`, { actor: actorFor(request) });
    return { success: true, count, bookmarks: bookmarksService.getAll() };
  });

  app.delete('/api/bookmarks/groups/:groupName', async (request, reply) => {
    const { groupName } = request.params as { groupName: string };
    const { deleteShortcuts } = request.query as { deleteShortcuts?: string };
    const shouldDelete = deleteShortcuts === 'true';
    const count = bookmarksService.deleteGroup(decodeURIComponent(groupName), shouldDelete);
    auditLogService.log('bookmark', 'info', `Deleted shortcut group '${groupName}' (removed shortcuts: ${shouldDelete})`, { actor: actorFor(request) });
    return { success: true, count, bookmarks: bookmarksService.getAll() };
  });

  app.post('/api/git-projects/:containerName', async (request, reply) => {
    const { containerName } = request.params as { containerName: string };
    const body = request.body as {
      repoOwner?: string;
      repoName?: string;
      branch?: string;
      localPath?: string;
      sshTarget?: string;
      rebuildCommand?: RebuildCommand;
      autoDeploy?: boolean;
    };
    if (!body?.repoOwner || !body?.repoName) {
      reply.status(400);
      return { success: false, message: 'repoOwner and repoName are required' };
    }
    if (body.sshTarget && !terminalService.getTargetNames().includes(body.sshTarget)) {
      reply.status(400);
      return { success: false, message: `Unknown SSH target "${body.sshTarget}"` };
    }
    const record = await gitProjectsService.register(
      containerName,
      body.repoOwner,
      body.repoName,
      body.branch || 'main',
      body.localPath,
      body.rebuildCommand,
      body.autoDeploy,
      body.sshTarget
    );
    auditLogService.log('git', 'info', `Tracked ${containerName} (${body.repoOwner}/${body.repoName})`, { actor: actorFor(request) });
    return { success: true, project: record };
  });

  app.delete('/api/git-projects/:containerName', async (request) => {
    const { containerName } = request.params as { containerName: string };
    gitProjectsService.unregister(containerName);
    auditLogService.log('git', 'info', `Untracked ${containerName}`, { actor: actorFor(request) });
    return { success: true };
  });

  app.post('/api/git-projects/refresh', async () => {
    await gitProjectsService.refreshAll();
    return { success: true };
  });

  app.post('/api/git-projects/:containerName/check-pull', async (request) => {
    const { containerName } = request.params as { containerName: string };
    return gitProjectsService.checkPull(containerName);
  });

  app.post('/api/git-projects/:containerName/mark-deployed', async (request, reply) => {
    const { containerName } = request.params as { containerName: string };
    const result = await gitProjectsService.markDeployedFromLocal(containerName);
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/git-projects/:containerName/pull', async (request, reply) => {
    const { containerName } = request.params as { containerName: string };
    const result = gitProjectsService.startPull(containerName);
    auditLogService.log('git', result.started ? 'info' : 'warn', `Pull & rebuild ${result.started ? 'started' : 'rejected'} for ${containerName}`, { actor: actorFor(request) });
    if (!result.started) {
      reply.status(400);
    }
    return result;
  });

  app.get('/api/git-projects/:containerName/pull-status', async (request) => {
    const { containerName } = request.params as { containerName: string };
    return gitProjectsService.getPullState(containerName);
  });

  app.post('/api/git-projects/:containerName/reset-pull', async (request) => {
    const { containerName } = request.params as { containerName: string };
    gitProjectsService.resetPullState(containerName);
    return { success: true };
  });

  // Self App-Update Routes
  app.get('/api/app-update/status', async () => {
    return appUpdateService.getStatus();
  });

  app.post('/api/app-update/check', async () => {
    return appUpdateService.checkForUpdates(true);
  });

  app.post('/api/app-update/update', async (request, reply) => {
    const result = appUpdateService.startUpdate();
    if (!result.started) {
      reply.status(400);
    }
    return result;
  });

  app.get('/api/app-update/update-status', async () => {
    return appUpdateService.getUpdateState();
  });

  app.get('/api/ssh-targets', async () => {
    return { targets: terminalService.getTargetNames() };
  });

  // Disk Usage Explorer: manual, on-demand only (see disk-scan.service.ts) -
  // never part of the polling snapshot loop.
  app.get('/api/disk-scan/targets', async () => {
    return { targets: diskScanService.getTargets() };
  });

  app.get('/api/disk-scan/:id/status', async (request) => {
    const { id } = request.params as { id: string };
    return diskScanService.getStatus(id);
  });

  app.post('/api/disk-scan/:id/start', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const state = diskScanService.startScan(id);
      auditLogService.log('storage', 'info', `Disk usage scan started: ${id}`, { actor: actorFor(request) });
      return state;
    } catch (err) {
      reply.status(400);
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get('/api/disk-scan/:id/tree', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tree = diskScanService.getTree(id);
    if (!tree) {
      reply.status(404);
      return { error: 'No completed scan for this target yet' };
    }
    return tree;
  });

  app.get('/api/ai-agents/telemetry', async () => {
    return aiAgentsService.getTelemetry();
  });

  app.get('/api/backup/status', async () => {
    return backupService.getStatus();
  });

  app.post('/api/backup/run', async (request, reply) => {
    const result = await backupService.runBackup();
    auditLogService.log('backup', result.lastResult === 'success' ? 'info' : 'error', `Backup run: ${result.lastResult}${result.lastError ? ` (${result.lastError})` : ''}`, { actor: actorFor(request) });
    if (result.lastResult !== 'success') {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/backup/restore', async (request, reply) => {
    const body = request.body as { confirm?: boolean };
    if (!body?.confirm) {
      reply.status(400);
      return { lastRunAt: new Date().toISOString(), lastResult: 'failed', lastError: 'Confirmation required', lastDurationMs: 0 };
    }
    const result = await backupService.runRestore();
    auditLogService.log('backup', result.lastResult === 'success' ? 'warn' : 'error', `Restore run: ${result.lastResult}${result.lastError ? ` (${result.lastError})` : ''}`, { actor: actorFor(request) });
    if (result.lastResult !== 'success') {
      reply.status(400);
    }
    return result;
  });

  app.post('/api/backup/import-config', async (request, reply) => {
    const body = request.body as { url?: string };
    if (!body?.url) {
      reply.status(400);
      return { success: false, message: 'url is required', imported: [] };
    }
    const result = await backupService.importConfig(body.url);
    auditLogService.log('config', result.success ? 'info' : 'error', `Config import: ${result.message}`, { actor: actorFor(request) });
    if (!result.success) {
      reply.status(400);
    }
    return result;
  });

  // Serve Client SPA in Production
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    console.log(`[Fastify] Serving static production frontend from ${clientDist}`);
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });

    app.setNotFoundHandler((req, reply) => {
      if (!req.raw.url?.startsWith('/api') && !req.raw.url?.startsWith('/ws')) {
        reply.sendFile('index.html');
      } else {
        reply.status(404).send({ error: 'Endpoint not found' });
      }
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down gracefully...');
    gitProjectsService.stop();
    sentinelService?.stop();
    backupService.stop();
    collectorService.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[Dashboard] Server ready at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap().catch(err => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
