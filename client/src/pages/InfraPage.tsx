import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Network,
  HardDrive,
  Activity,
  Database,
  Download,
  Upload,
  Server,
  ArrowRight,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { CockpitSnapshot, BackupStatus } from '../types.js';
import { HostDetailPanels } from '../components/HostDetailPanels.js';
import { StorageMatrixSection } from '../components/StorageMatrixSection.js';
import { DiskPerformancePanel } from '../components/DiskPerformancePanel.js';
import { TailscaleMatrixSection } from '../components/TailscaleMatrixSection.js';
import { SslTrackerSection } from '../components/SslTrackerSection.js';
import { BackupRestoreModal } from '../components/BackupRestoreModal.js';
import { ImportConfigModal } from '../components/ImportConfigModal.js';
import { authFetch } from '../utils/api.js';
import { PerformanceGraph } from '../components/PerformanceGraph.js';
import { useMetricHistory } from '../context/MetricHistoryContext.js';
import {
  formatBytes,
  formatNetworkRate,
  formatUptime,
  redactText,
  getStatusColor,
  getTempColor,
} from '../utils/formatters.js';

interface InfraPageProps {
  snapshot: CockpitSnapshot | null;
  isPrivacyMode: boolean;
  onOpenPruneModal: () => void;
}

type InfraCategory = 'overview' | 'network' | 'storage' | 'performance' | 'backup';

const CATEGORIES: { id: InfraCategory; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'backup', label: 'Backup', icon: Database },
];

export const DockerHostsPanel: React.FC<{ snapshot: CockpitSnapshot | null }> = ({ snapshot }) => {
  const hosts = snapshot?.dockerHosts ?? [];
  const primaryDocker = snapshot?.host.dockerHost;

  const displayHosts =
    hosts.length > 0
      ? hosts
      : primaryDocker
      ? [
          {
            name: primaryDocker.hostname || 'primary-docker',
            connected: true,
            containerCount: snapshot?.containers?.length ?? 0,
          },
        ]
      : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cockpit-accent/15 text-cockpit-accent">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h3 className="panel-title">Docker Hosts &amp; Daemons</h3>
            <p className="panel-sub">Active daemon connections managing containers across your homelab</p>
          </div>
        </div>
        <span className="pill pill-neutral tabular-nums">
          {displayHosts.filter((h) => h.connected).length}/{displayHosts.length} connected
        </span>
      </div>
      <div className="px-5 py-2">
        {displayHosts.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-cockpit-muted">No Docker hosts detected</p>
        ) : (
          displayHosts.map((host) => (
            <div key={host.name} className="data-row">
              <span className="flex items-center gap-2.5 font-medium text-cockpit-text">
                <span className={`h-2 w-2 rounded-full ${host.connected ? 'bg-state-good' : 'bg-state-warn'}`} />
                {host.name}
              </span>
              <span className="flex items-center gap-2">
                <span className="pill pill-neutral tabular-nums">{host.containerCount} containers</span>
                <span className={`pill ${host.connected ? 'pill-good' : 'pill-warn'}`}>
                  {host.connected ? 'Connected' : 'Simulated'}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export const BackupPanel: React.FC<{
  status: BackupStatus | null;
  isRunning: boolean;
  onRunBackup: () => void;
  onRefresh: () => void;
}> = ({ status, isRunning, onRunBackup, onRefresh }) => {
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const lastBackup = status?.backup;

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cockpit-accent/15 text-cockpit-accent">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h3 className="panel-title">Backup &amp; Disaster Recovery</h3>
            <p className="panel-sub">
              {status?.configured ? 'rclone remote configured' : 'No rclone remote configured'}
            </p>
          </div>
        </div>
        <span className={`pill ${lastBackup?.lastResult === 'success' ? 'pill-good' : lastBackup ? 'pill-bad' : 'pill-neutral'}`}>
          {lastBackup ? (lastBackup.lastResult === 'success' ? 'Last run OK' : 'Last run failed') : 'Never run'}
        </span>
      </div>

      <div className="space-y-3 px-5 py-4">
        {lastBackup && (
          <p className="font-mono text-[11px] text-cockpit-muted">
            {new Date(lastBackup.lastRunAt).toLocaleString()} · {(lastBackup.lastDurationMs / 1000).toFixed(1)}s
            {lastBackup.lastError && <span className="text-state-bad"> · {lastBackup.lastError}</span>}
          </p>
        )}

        {!status?.configured && (
          <p className="text-[12px] text-cockpit-muted">
            Set <code className="font-mono text-cockpit-text">BACKUP_RCLONE_REMOTE</code> to enable backup and
            restore. Config import works either way.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRunBackup}
            disabled={!status?.configured || isRunning}
            className="btn-ghost disabled:opacity-40"
          >
            <Database className={`h-3.5 w-3.5 ${isRunning ? 'animate-pulse' : ''}`} />
            {isRunning ? 'Running…' : 'Run backup now'}
          </button>
          <button
            onClick={() => setIsRestoreOpen(true)}
            disabled={!status?.configured}
            className="btn-ghost hover:border-state-bad/40 hover:text-state-bad disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Restore from backup
          </button>
          <button onClick={() => setIsImportOpen(true)} className="btn-ghost">
            <Upload className="h-3.5 w-3.5" />
            Import config from link
          </button>
        </div>
      </div>

      {isRestoreOpen && (
        <BackupRestoreModal
          sourcePaths={status?.sourcePaths ?? []}
          onClose={() => setIsRestoreOpen(false)}
          onSuccess={onRefresh}
        />
      )}

      {isImportOpen && <ImportConfigModal onClose={() => setIsImportOpen(false)} onSuccess={onRefresh} />}
    </section>
  );
};

export const InfraPage: React.FC<InfraPageProps> = ({ snapshot, isPrivacyMode, onOpenPruneModal }) => {
  const { history } = useMetricHistory();
  const [view, setView] = useState<InfraCategory>('overview');
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [isBackupRunning, setIsBackupRunning] = useState(false);

  const [cachedNodeName, setCachedNodeName] = useState<string | null>(() => {
    return localStorage.getItem('cockpit_primary_node_name');
  });

  useEffect(() => {
    const handleNodeUpdate = () => {
      setCachedNodeName(localStorage.getItem('cockpit_primary_node_name'));
    };
    window.addEventListener('cockpit_settings_updated', handleNodeUpdate);
    return () => window.removeEventListener('cockpit_settings_updated', handleNodeUpdate);
  }, []);

  const loadBackupStatus = () => {
    authFetch('/api/backup/status')
      .then((res) => res.json())
      .then(setBackupStatus)
      .catch(() => {});
  };

  useEffect(() => {
    loadBackupStatus();
    const interval = setInterval(loadBackupStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleRunBackup = async () => {
    setIsBackupRunning(true);
    try {
      await authFetch('/api/backup/run', { method: 'POST' });
      loadBackupStatus();
    } finally {
      setIsBackupRunning(false);
    }
  };

  // Compute metrics for Infrastructure Overview
  const pve = snapshot?.host.pve;
  const dockerHost = snapshot?.host.dockerHost;
  const displayNodeName = cachedNodeName || pve?.nodeName || dockerHost?.hostname || 'Homelab node';

  const cpuPercent = pve?.cpuPercent ?? dockerHost?.cpuPercent ?? 0;
  const cpuTone = getStatusColor(cpuPercent);
  const ramUsedBytes = pve?.ramUsedBytes ?? dockerHost?.ramUsedBytes ?? 0;
  const ramTotalBytes = pve?.ramTotalBytes ?? dockerHost?.ramTotalBytes ?? 0;
  const ramPercent = pve?.ramPercent ?? dockerHost?.ramPercent ?? 0;
  const ramTone = getStatusColor(ramPercent);

  const temp = pve?.cpuTempCelsius ?? dockerHost?.thermalThrottle?.packageTempCelsius ?? 48;
  const tempTone = getTempColor(temp);

  const storageItems = snapshot?.storage ?? [];
  const totalStorageUsed = storageItems.reduce((acc, s) => acc + (s.usedBytes || 0), 0);
  const totalStorageCap = storageItems.reduce((acc, s) => acc + (s.totalBytes || 0), 0);
  const overallStoragePercent = totalStorageCap > 0 ? (totalStorageUsed / totalStorageCap) * 100 : 0;
  const detachedStorageCount = storageItems.filter((s) => s.isDisconnected || s.canaryPresent === false).length;
  const rootDrive = storageItems.find((s) => s.isPhysicalRoot || s.mount === '/dev/sda (/)' || s.mount === '/');

  const tailscale = snapshot?.tailscale;
  const totalOnline = tailscale?.totalOnline ?? 0;
  const totalDevices = tailscale?.totalDevices ?? 0;

  const sslCerts = snapshot?.sslCertificates ?? [];
  const soonestSsl = sslCerts.length > 0 ? Math.min(...sslCerts.map((c) => c.daysRemaining)) : null;

  const dockerHostsList =
    (snapshot?.dockerHosts && snapshot.dockerHosts.length > 0)
      ? snapshot.dockerHosts
      : dockerHost
      ? [{ name: dockerHost.hostname || 'primary-docker', connected: true, containerCount: snapshot?.containers?.length ?? 0 }]
      : [];

  const lastBackup = backupStatus?.backup;

  return (
    <div className="space-y-4">
      {/* Category Navigation Bar */}
      <div className="seg flex flex-wrap gap-1 p-1">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`seg-btn flex items-center gap-2 px-3.5 py-1.5 transition-all ${
              view === id ? 'seg-btn-on shadow-sm' : 'text-cockpit-muted hover:text-cockpit-text'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="font-medium text-[12.5px]">{label}</span>
          </button>
        ))}
      </div>

      {/* 1. OVERVIEW: Rangkuman Infrastruktur yang Ada */}
      {view === 'overview' && (
        <div className="space-y-4 animate-fade-in">
          {/* Main Node Header Summary */}
          <section className="panel px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="label">Primary Infrastructure Node</p>
                <h1 className="mt-1 text-[19px] font-extrabold tracking-tight text-cockpit-text">
                  {displayNodeName}
                </h1>
                <p className="mt-1 font-mono text-[12px] text-cockpit-muted">
                  {pve ? `${pve.cpuModel || `${pve.cpuCores} cores`} · ` : ''}
                  {ramTotalBytes > 0 ? `${formatBytes(ramTotalBytes)} Total RAM · ` : ''}
                  Proxmox VE {redactText(pve?.ip || '—', isPrivacyMode)} · Docker {dockerHost?.hostname || 'host'}{' '}
                  {redactText(dockerHost?.ip || '—', isPrivacyMode)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="pill pill-good flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Online</span>
                </span>
                <span className="pill pill-neutral flex items-center gap-1.5 font-mono text-[11px]">
                  <Clock className="h-3 w-3 text-cockpit-muted" />
                  <span>Uptime {formatUptime(pve?.uptimeSeconds ?? dockerHost?.uptimeSeconds ?? 0)}</span>
                </span>
              </div>
            </div>
          </section>

          {/* 4 Infrastructure KPI Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Compute Card */}
            <div className="panel flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="label">Compute · CPU &amp; RAM</span>
                  <span className={`pill ${cpuTone.badge} text-[10px]`}>{tempTone.label}</span>
                </div>
                <div className="metric-lg mt-2">
                  {cpuPercent.toFixed(1)}
                  <span className="metric-unit">% CPU</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border">
                  <div
                    className={`h-full transition-all duration-500 ${cpuTone.bar}`}
                    style={{ width: `${Math.min(100, Math.max(0, cpuPercent))}%` }}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-cockpit-muted">
                RAM: <span className={ramTone.text}>{formatBytes(ramUsedBytes)}</span> of {formatBytes(ramTotalBytes)} ({ramPercent.toFixed(0)}%) · {temp.toFixed(0)}°C
              </p>
            </div>

            {/* Network Card */}
            <div className="panel flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="label">Network &amp; Mesh</span>
                  <span className="pill pill-neutral text-[10px]">
                    {totalOnline}/{totalDevices} Online
                  </span>
                </div>
                <div className="metric-lg mt-2">
                  {totalOnline}
                  <span className="metric-unit">devices</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border">
                  <div
                    className="h-full bg-cockpit-accent transition-all duration-500"
                    style={{ width: `${totalDevices > 0 ? (totalOnline / totalDevices) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-cockpit-muted">
                {dockerHostsList.length} Docker daemon(s) · {sslCerts.length} SSL certs
              </p>
            </div>

            {/* Storage Card */}
            <div className="panel flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="label">Storage Capacity</span>
                  <span className={`pill ${detachedStorageCount > 0 ? 'pill-bad' : 'pill-good'} text-[10px]`}>
                    {detachedStorageCount > 0 ? `${detachedStorageCount} Detached` : 'DAS Safe'}
                  </span>
                </div>
                <div className="metric-lg mt-2">
                  {totalStorageCap > 0 ? formatBytes(totalStorageUsed) : '0 B'}
                  <span className="metric-unit">of {formatBytes(totalStorageCap)}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border">
                  <div
                    className={`h-full transition-all duration-500 ${getStatusColor(overallStoragePercent).bar}`}
                    style={{ width: `${Math.min(100, Math.max(0, overallStoragePercent))}%` }}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-cockpit-muted">
                {storageItems.length} volume(s) · {formatBytes(totalStorageCap - totalStorageUsed)} free
              </p>
            </div>

            {/* Backup Card */}
            <div className="panel flex flex-col justify-between p-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="label">Disaster Recovery</span>
                  <span className={`pill ${lastBackup?.lastResult === 'success' ? 'pill-good' : lastBackup ? 'pill-bad' : 'pill-neutral'} text-[10px]`}>
                    {lastBackup?.lastResult === 'success' ? 'Healthy' : lastBackup ? 'Attention' : 'Unconfigured'}
                  </span>
                </div>
                <div className="metric-lg mt-2">
                  {lastBackup?.lastResult === 'success' ? 'OK' : lastBackup ? 'Failed' : 'None'}
                  <span className="metric-unit">last run</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border">
                  <div
                    className={`h-full transition-all duration-500 ${lastBackup?.lastResult === 'success' ? 'bg-state-good' : 'bg-cockpit-muted'}`}
                    style={{ width: lastBackup?.lastResult === 'success' ? '100%' : '0%' }}
                  />
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-cockpit-muted">
                {lastBackup ? `${new Date(lastBackup.lastRunAt).toLocaleDateString()} · ${(lastBackup.lastDurationMs / 1000).toFixed(1)}s` : 'No backup run recorded'}
              </p>
            </div>
          </div>

          {/* Detailed Subsystems Overview Cards with Direct Category Switching */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* 1. Network Subsystem Rangkuman */}
            <div className="panel flex flex-col justify-between p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cockpit-accent/15 text-cockpit-accent">
                      <Network className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-cockpit-text">Network &amp; Connectivity</h3>
                      <p className="text-[11px] text-cockpit-muted">Tailscale mesh, Docker daemons &amp; SSL certs</p>
                    </div>
                  </div>
                  <span className="pill pill-neutral tabular-nums">{totalOnline}/{totalDevices} peers</span>
                </div>

                <div className="space-y-2 border-t border-cockpit-border pt-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Tailnet Mesh</span>
                    <span className="font-mono text-cockpit-text">
                      {redactText(tailscale?.tailnetName || 'Tailscale Mesh', isPrivacyMode)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Connected Docker Daemons</span>
                    <span className="font-mono text-cockpit-text">
                      {dockerHostsList.filter((h) => h.connected).length} of {dockerHostsList.length} active
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">SSL Certificates</span>
                    <span className="font-mono text-cockpit-text">
                      {sslCerts.length} active {soonestSsl !== null ? `(next in ${soonestSsl}d)` : ''}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setView('network')}
                className="btn-ghost mt-4 w-full justify-between text-[12px]"
              >
                <span>Lihat Detail Network</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 2. Storage Subsystem Rangkuman */}
            <div className="panel flex flex-col justify-between p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cockpit-accent/15 text-cockpit-accent">
                      <HardDrive className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-cockpit-text">Storage &amp; Disks</h3>
                      <p className="text-[11px] text-cockpit-muted">Physical drives, DAS enclosures &amp; hygiene</p>
                    </div>
                  </div>
                  <span className="pill pill-neutral tabular-nums">
                    {storageItems.length} volume(s)
                  </span>
                </div>

                <div className="space-y-2 border-t border-cockpit-border pt-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Primary Root SSD</span>
                    <span className="font-mono text-cockpit-text">
                      {rootDrive ? `${formatBytes(rootDrive.usedBytes)} / ${formatBytes(rootDrive.totalBytes)} (${rootDrive.usedPercent.toFixed(0)}%)` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">DAS &amp; Enclosure Guard</span>
                    <span className={`font-mono ${detachedStorageCount > 0 ? 'text-state-bad font-semibold' : 'text-state-good'}`}>
                      {detachedStorageCount > 0 ? `${detachedStorageCount} drive(s) detached!` : 'All drives locked & safe'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Docker Disk Hygiene</span>
                    <span className="font-mono text-cockpit-text">
                      {snapshot?.dockerHygiene ? `${formatBytes(snapshot.dockerHygiene.reclaimableBytes)} reclaimable` : 'Clean'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setView('storage')}
                className="btn-ghost mt-4 w-full justify-between text-[12px]"
              >
                <span>Lihat Detail Storage</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 3. Performance Subsystem Rangkuman */}
            <div className="panel flex flex-col justify-between p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cockpit-accent/15 text-cockpit-accent">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-cockpit-text">Host Performance</h3>
                      <p className="text-[11px] text-cockpit-muted">Proxmox VE, Docker host vitals &amp; I/O</p>
                    </div>
                  </div>
                  <span className={`pill ${tempTone.text}`}>{temp.toFixed(0)}°C</span>
                </div>

                <div className="space-y-2 border-t border-cockpit-border pt-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Proxmox VE Vitals</span>
                    <span className="font-mono text-cockpit-text">
                      {pve ? `${pve.cpuPercent.toFixed(1)}% CPU · ${pve.ramPercent.toFixed(1)}% RAM` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Docker Daemon Host</span>
                    <span className="font-mono text-cockpit-text">
                      {dockerHost ? `${dockerHost.cpuPercent.toFixed(1)}% CPU · ${dockerHost.ramPercent.toFixed(1)}% RAM` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Thermal &amp; Throttle</span>
                    <span className="font-mono text-cockpit-text">
                      {dockerHost?.thermalThrottle?.isThrottling ? 'Throttling detected' : 'Normal / Not throttling'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setView('performance')}
                className="btn-ghost mt-4 w-full justify-between text-[12px]"
              >
                <span>Lihat Detail Performance</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 4. Backup Subsystem Rangkuman */}
            <div className="panel flex flex-col justify-between p-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cockpit-accent/15 text-cockpit-accent">
                      <Database className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-cockpit-text">Backup &amp; Recovery</h3>
                      <p className="text-[11px] text-cockpit-muted">Remote replication &amp; configuration snapshots</p>
                    </div>
                  </div>
                  <span className={`pill ${backupStatus?.configured ? 'pill-good' : 'pill-neutral'}`}>
                    {backupStatus?.configured ? 'Configured' : 'No remote'}
                  </span>
                </div>

                <div className="space-y-2 border-t border-cockpit-border pt-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Rclone Status</span>
                    <span className="font-mono text-cockpit-text">
                      {backupStatus?.configured ? 'Remote linked & active' : 'Not configured'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Last Backup Status</span>
                    <span className="font-mono text-cockpit-text">
                      {lastBackup ? (lastBackup.lastResult === 'success' ? 'Success' : 'Failed') : 'Never'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-cockpit-muted">Source Paths Tracked</span>
                    <span className="font-mono text-cockpit-text">
                      {backupStatus?.sourcePaths?.length ?? 0} directory path(s)
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setView('backup')}
                className="btn-ghost mt-4 w-full justify-between text-[12px]"
              >
                <span>Lihat Detail Backup</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. NETWORK: Tailscale, Docker Hosts, dan SSL Certificates */}
      {view === 'network' && (
        <div className="space-y-4 animate-fade-in">
          <DockerHostsPanel snapshot={snapshot} />

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TailscaleMatrixSection tailscale={snapshot?.tailscale} isPrivacyMode={isPrivacyMode} />
            <SslTrackerSection certificates={snapshot?.sslCertificates} isPrivacyMode={isPrivacyMode} />
          </div>
        </div>
      )}

      {/* 3. STORAGE: Storage & DAS Watchdog Matrix */}
      {view === 'storage' && (
        <div className="space-y-4 animate-fade-in">
          <StorageMatrixSection
            storage={snapshot?.storage}
            hygiene={snapshot?.dockerHygiene}
            onOpenPruneModal={onOpenPruneModal}
          />
        </div>
      )}

      {/* 4. PERFORMANCE: Host Detail Panels & Disk Performance Panel */}
      {view === 'performance' && (
        <div className="space-y-4 animate-fade-in">
          {/* Proxmox & Host Hardware Telemetry Waveforms */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cockpit-accent" />
                <h3 className="text-[14px] font-bold text-cockpit-text tracking-tight">
                  Proxmox &amp; Host Vitals Timeline
                </h3>
                <span className="pill pill-neutral font-mono text-[10.5px]">60s Live Rolling</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <PerformanceGraph
                title="Hypervisor CPU"
                subtitle="Proxmox VE Host"
                data={history.map((p) => p.pveCpu)}
                secondaryData={history.map((p) => p.dockerCpu)}
                secondaryLabel="LXC"
                tone="accent"
                secondaryTone="cyan"
                maxScale={100}
                height={150}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                secondaryFormatter={(v) => `${v.toFixed(1)}%`}
              />
              <PerformanceGraph
                title="Host Memory"
                subtitle="Proxmox RAM allocation"
                data={history.map((p) => p.pveRam)}
                secondaryData={history.map((p) => p.dockerRam)}
                secondaryLabel="LXC"
                tone="purple"
                secondaryTone="accent"
                maxScale={100}
                height={150}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                secondaryFormatter={(v) => `${v.toFixed(1)}%`}
              />
              <PerformanceGraph
                title="Network Traffic"
                subtitle="Fleet I/O Bandwidth"
                data={history.map((p) => p.netRxRate)}
                secondaryData={history.map((p) => p.netTxRate)}
                secondaryLabel="TX"
                tone="cyan"
                secondaryTone="accent"
                maxScale="auto"
                height={150}
                valueFormatter={formatNetworkRate}
                secondaryFormatter={formatNetworkRate}
              />
              <PerformanceGraph
                title="Package Thermal"
                subtitle="CPU Package Temp"
                data={history.map((p) => p.temp)}
                tone={snapshot?.host?.pve?.cpuTempCelsius && snapshot.host.pve.cpuTempCelsius >= 75 ? 'bad' : 'warn'}
                maxScale={100}
                height={150}
                valueFormatter={(v) => `${v.toFixed(1)}°C`}
              />
            </div>
          </div>

          <HostDetailPanels host={snapshot?.host} isPrivacyMode={isPrivacyMode} />
          <DiskPerformancePanel storage={snapshot?.storage} />
        </div>
      )}

      {/* 5. BACKUP: Backup Panel, Restore, Import */}
      {view === 'backup' && (
        <div className="space-y-4 animate-fade-in">
          <BackupPanel
            status={backupStatus}
            isRunning={isBackupRunning}
            onRunBackup={handleRunBackup}
            onRefresh={loadBackupStatus}
          />
        </div>
      )}
    </div>
  );
};
