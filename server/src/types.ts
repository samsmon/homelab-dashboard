export interface ThermalThrottleVitals {
  isThrottling: boolean;
  throttleCount: number;
  packageTempCelsius: number;
  fanSpeedPercent?: number;
}

export interface PveBackupVitals {
  status: 'succeeded' | 'failed' | 'running' | 'unknown';
  lastBackupTime: string;
  lastBackupTimestamp: number;
  targetStorage: string;
  backupSizeBytes: number;
  durationSeconds: number;
  vmid: string;
  logSummary: string;
}

export interface StorageAllocationItem {
  id: string;
  name: string;
  type: 'pve-host' | 'lxc' | 'pool' | 'other';
  allocatedBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  shareOfDiskPercent: number;
  vmid?: string;
  status?: string;
  cpuPercent?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  memPercent?: number;
}

export interface PvePhysicalDisk {
  devpath: string;
  model: string;
  sizeBytes: number;
  smartStatus: 'PASSED' | 'WARNING' | 'FAILED' | 'UNKNOWN';
  type?: string;
  serial?: string;
  wearoutPercent?: number;
}

export interface PveStoragePool {
  id: string;
  type: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  active: boolean;
  content?: string;
}

export interface PveStorageVitals {
  connected: boolean;
  physicalDisk: PvePhysicalDisk;
  pools: PveStoragePool[];
  allocations: StorageAllocationItem[];
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  allocatedBytes: number;
}

export interface PveHostMetrics {
  connected: boolean;
  nodeName: string;
  ip: string;
  cpuPercent: number;
  cpuCores: number;
  cpuModel?: string;
  cpuTempCelsius?: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  ramPercent: number;
  uptimeSeconds: number;
  pveVersion?: string;
  backupVitals?: PveBackupVitals;
  storageVitals?: PveStorageVitals;
}

export interface DockerHostMetrics {
  connected: boolean;
  hostname: string;
  ip: string;
  cpuPercent: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  ramPercent: number;
  loadAverage: number[];
  uptimeSeconds: number;
  thermalThrottle?: ThermalThrottleVitals;
}

export interface HostMetrics {
  pve: PveHostMetrics;
  dockerHost: DockerHostMetrics;
}

export interface StorageItem {
  id: string;
  mount: string;
  label: string;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  status: 'healthy' | 'warning' | 'critical';
  isExternal: boolean;
  smartStatus?: 'PASSED' | 'WARNING' | 'FAILED' | 'UNKNOWN';
  canaryPresent?: boolean;
  isDisconnected?: boolean;
  readRateBytesPerSec?: number;
  writeRateBytesPerSec?: number;
  activeTimePercent?: number;
  avgResponseMs?: number;
  sparklineActiveTime?: number[];

  // Proxmox Physical SSD & Container Allocation Telemetry
  isPhysicalRoot?: boolean;
  physicalDisk?: PvePhysicalDisk;
  storagePools?: PveStoragePool[];
  allocations?: StorageAllocationItem[];
  unreachableHostFallback?: boolean;
}

export interface ProcessMetric {
  pid: number;
  name: string;
  user: string;
  command: string;
  cpuPercent: number;
  memBytes: number;
  memPercent: number;
  state: string;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
  source?: string;
}

export interface SslCertificate {
  id: string;
  domain: string;
  service: string;
  issuer: string;
  validTo: string;
  daysRemaining: number;
  status: 'healthy' | 'warning' | 'critical';
  autoRenewEnabled: boolean;
}

export interface DockerDiskHygiene {
  reclaimableBytes: number;
  danglingImagesCount: number;
  stoppedContainersCount: number;
  buildCacheBytes: number;
  volumesCount: number;
  lastPrunedTime?: string;
}

export interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
  dnsName: string;
  ipv4: string;
  ipv6?: string;
  os: 'linux' | 'windows' | 'macos' | 'android' | 'ios' | 'other';
  online: boolean;
  lastSeen: string;
  isCurrentDevice: boolean;
  isExitNode: boolean;
  subnetRoutes: string[];
  tags: string[];
  keyExpiryDays?: number;
}

export interface TailscaleStatus {
  connected: boolean;
  tailnetName: string;
  devices: TailscaleDevice[];
  totalOnline: number;
  totalDevices: number;
}

export interface HttpHealthProbe {
  status: 'healthy' | 'warning' | 'critical' | 'unchecked';
  statusCode?: number;
  latencyMs?: number;
  checkedAt?: string;
}

export interface ContainerMetric {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead';
  status: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  networkRxRateBytesPerSec: number;
  networkTxRateBytesPerSec: number;
  sparklineCpu: number[];
  sparklineMemory: number[];
  uptime: string;
  ports: string[];
  created: number;
  tailscaleEnabled: boolean;
  tailscaleIp?: string;
  tailscaleUrl?: string;
  lanUrl?: string;
  primaryPort?: number;
  httpHealth?: HttpHealthProbe;
  isPinned?: boolean;
  publicUrl?: string;
  dockerHost: string;
}

export interface DockerHostSummary {
  name: string;
  connected: boolean;
  containerCount: number;
}

export type RebuildCommand = 'compose-up-build' | 'compose-up-build-force-recreate';

export interface GitPullState {
  status: 'idle' | 'pulling' | 'rebuilding' | 'success' | 'failed';
  log: string[];
  startedAt?: number;
  finishedAt?: number;
  message?: string;
}

export interface GitProjectStatus {
  containerName: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  localPath?: string;
  sshTarget?: string;
  rebuildCommand?: RebuildCommand;
  autoDeploy: boolean;
  autoDeployBlocked: boolean;
  latestSha?: string;
  latestCommitMessage?: string;
  latestCommitDate?: string;
  lastKnownSha?: string;
  lastDeployedAt?: number;
  hasUpdate: boolean;
  lastPullStatus?: 'idle' | 'pulling' | 'rebuilding' | 'success' | 'failed';
  lastPullMessage?: string;
}

export interface BackupRunResult {
  lastRunAt: string;
  lastResult: 'success' | 'failed';
  lastError?: string;
  lastDurationMs: number;
}

export interface BackupStatus {
  configured: boolean;
  sourcePaths: string[];
  backup?: BackupRunResult;
  restore?: BackupRunResult;
}

export interface SentinelStatus {
  enabled: boolean;
  botUsername?: string;
  polling: boolean;
  allowedUsersCount: number;
  geminiConfigured: boolean;
  managedContainers: string[];
  lastCommandAt?: string;
  lastCommand?: string;
}

export interface UpdateAnnouncement {
  id: string;
  version?: string;
  title: string;
  date: string;
  description: string;
  highlights?: string[];
  commitSha?: string;
  commitUrl?: string;
}

export interface AppUpdateState {
  status: 'idle' | 'updating' | 'success' | 'failed';
  log: string[];
  startedAt?: number;
  finishedAt?: number;
  message?: string;
}

export interface AppUpdateStatus {
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  currentSha: string;
  currentCommitDate?: string;
  currentCommitSubject?: string;
  latestSha?: string;
  latestCommitDate?: string;
  latestCommitMessage?: string;
  hasUpdate: boolean;
  behindBy: number;
  announcement?: UpdateAnnouncement;
  recentCommits?: Array<{ sha: string; message: string; date?: string }>;
  lastCheckedAt: number;
  updateState: AppUpdateState;
}

export interface AppVersionInfo {
  version: string;
  commitSha: string;
  branch: string;
  buildDate?: string;
}

export interface CockpitSnapshot {
  timestamp: number;
  host: HostMetrics;
  storage: StorageItem[];
  tailscale: TailscaleStatus;
  containers: ContainerMetric[];
  dockerHosts: DockerHostSummary[];
  sslCertificates: SslCertificate[];
  dockerHygiene: DockerDiskHygiene;
  gitProjects: GitProjectStatus[];
  sentinel?: SentinelStatus;
  isDemoMode: boolean;
  appVersion?: AppVersionInfo;
  containerMonitoring?: {
    active: boolean;
    remainingMs: number;
  };
}

export interface DiskScanTarget {
  id: string;
  mount: string;
  label: string;
  isExternal: boolean;
}

export interface DiskScanState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: number;
  scannedAt?: number;
  elapsedMs?: number;
  error?: string;
  queuePosition?: number;
}

export interface DiskTreeNode {
  name: string;
  path: string;
  sizeBytes: number;
  type: 'dir' | 'file' | 'rollup';
  fileCount: number;
  children: DiskTreeNode[];
}
