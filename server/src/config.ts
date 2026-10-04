import dotenv from 'dotenv';
dotenv.config();

export interface DockerHostConfig {
  name: string;
  socketPath?: string;
  url?: string;
  lanIp?: string;
  tailscaleIp?: string;
}

// "name=url|lanIp|tailscaleIp" (lanIp and tailscaleIp optional), comma-separated.
// tailscaleIp is omitted for a host that hasn't joined the tailnet.
function parseDockerHosts(raw: string | undefined): DockerHostConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, rest] = entry.split('=').map((s) => s.trim());
      const [url, lanIp, tailscaleIp] = (rest || '').split('|').map((s) => s.trim());
      return { name, url, lanIp: lanIp || undefined, tailscaleIp: tailscaleIp || undefined };
    })
    .filter((host) => host.name && host.url);
}

export interface ServiceProbeConfig {
  name: string;
  url: string;
  host: string;
}

// "name=url|hostLabel", comma-separated. For services that are not Docker
// containers (systemd units etc.) and so never show up in the Docker fleet.
// hostLabel is only the name shown in the Host column/filter; it is optional.
// e.g. "gamdl-dashboard=http://192.168.18.229:8110|media-hosts"
function parseServiceProbes(raw: string | undefined): ServiceProbeConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf('=');
      const name = idx === -1 ? '' : entry.slice(0, idx).trim();
      const [url, host] = (idx === -1 ? '' : entry.slice(idx + 1)).split('|').map((s) => s.trim());
      return { name, url, host: host || 'external' };
    })
    .filter((p) => p.name && /^https?:\/\//.test(p.url));
}

export interface SslDomainConfig {
  host: string;
  port: number;
  label: string;
}

// "host[:port][=Label]", comma-separated. Port defaults to 443; label defaults
// to the host itself when omitted. e.g. "jellyfin.example.com=Jellyfin,cloud.example.com:8443"
function parseSslDomains(raw: string | undefined): SslDomainConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hostPort, label] = entry.split('=').map((s) => s.trim());
      const [host, portStr] = hostPort.split(':');
      return { host, port: portStr ? parseInt(portStr, 10) : 443, label: label || host };
    })
    .filter((d) => Boolean(d.host));
}

export interface SshTargetConfig {
  name: string;
  user: string;
  host: string;
  port: number;
}

// "name=user@host:port" (port optional, defaults to 22), comma-separated —
// same shape as DOCKER_HOSTS. Never registerable through the running app;
// this is deliberate, see CLAUDE.md.
function parseSshTargets(raw: string | undefined): SshTargetConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, rest] = entry.split('=').map((s) => s.trim());
      const [userHost, portStr] = (rest || '').split(':');
      const [user, host] = userHost.split('@');
      return { name, user, host, port: portStr ? parseInt(portStr, 10) : 22 };
    })
    .filter((t) => t.name && t.user && t.host);
}

const primaryDockerHost: DockerHostConfig = {
  name: process.env.DOCKER_HOST_NAME || 'docker-host',
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  lanIp: process.env.DOCKER_HOST_LAN_IP || undefined,
  tailscaleIp: process.env.DOCKER_HOST_TAILSCALE_IP || undefined,
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dockerSocket: primaryDockerHost.socketPath!,
  dockerHosts: [primaryDockerHost, ...parseDockerHosts(process.env.DOCKER_HOSTS)] as DockerHostConfig[],
  proxmox: {
    url: process.env.PROXMOX_URL || 'https://pve.local:8006',
    node: process.env.PROXMOX_NODE || 'pve',
    tokenId: process.env.PROXMOX_TOKEN_ID || '', // e.g. root@pam!cockpit
    tokenSecret: process.env.PROXMOX_TOKEN_SECRET || '',
    rejectUnauthorized: process.env.PROXMOX_REJECT_UNAUTHORIZED === 'true',
  },
  tailscale: {
    apiKey: process.env.TAILSCALE_API_KEY || '',
    tailnet: process.env.TAILSCALE_TAILNET || '',
    socketPath: process.env.TAILSCALE_SOCKET || '/var/run/tailscale/tailscaled.sock',
  },
  storageMounts: (process.env.STORAGE_MOUNTS || '/,/mnt/hdd-media,/mnt/hdd-cloud,/mnt/hdd-music')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean),
  // Positional: storageLabels[i] names storageMounts[i]. Leave an entry empty
  // (e.g. "Movies,,Backups") to fall back to an auto-generated name for just
  // that mount — this list is NOT filtered for blanks, so position matters.
  storageLabels: (process.env.STORAGE_LABELS || '')
    .split(',')
    .map(label => label.trim()),
  sslDomains: parseSslDomains(process.env.SSL_DOMAINS),
  // Cert expiry doesn't change minute to minute; a real TLS handshake per
  // configured domain follows the same cache-and-throttle rule as the GitHub
  // check below rather than running on the 2s poll tick.
  sslCheckIntervalMs: parseInt(process.env.SSL_CHECK_INTERVAL_MS || '21600000', 10), // 6h
  githubToken: process.env.GITHUB_TOKEN || '',
  // How often to actually call the GitHub API per registered project, not
  // the dashboard's own poll rate — checking every 2s would exhaust GitHub's
  // rate limit (60/hr unauthenticated) within seconds.
  githubCheckIntervalMs: parseInt(process.env.GITHUB_CHECK_INTERVAL_MS || '60000', 10),
  // Fixed inside the container regardless of where GIT_PROJECTS_ROOT points
  // on the host — docker-compose.yml always bind-mounts it to /projects.
  gitProjectsRoot: '/projects',
  sshTargets: parseSshTargets(process.env.SSH_TARGETS),
  serviceProbes: parseServiceProbes(process.env.SERVICE_PROBES),
  // Cheap HTTP checks, but still not worth running on every 2s tick.
  serviceProbeIntervalMs: parseInt(process.env.SERVICE_PROBE_INTERVAL_MS || '15000', 10),
  // How often to sample metrics for the graphs while no browser is connected,
  // so a freshly opened page can be seeded with history instead of starting empty.
  idleSampleIntervalMs: parseInt(process.env.IDLE_SAMPLE_INTERVAL_MS || '10000', 10),
  // Fixed in-container path, like gitProjectsRoot — docker-compose.yml
  // bind-mounts SSH_PRIVATE_KEY_PATH from the host to here, read-only. One
  // shared key for every target; each target's authorized_keys gets the
  // matching public key.
  sshPrivateKeyPath: '/root/.ssh/cockpit_id_rsa',
  backup: {
    rcloneRemote: process.env.BACKUP_RCLONE_REMOTE || '',
    sourcePaths: (process.env.BACKUP_SOURCE_PATHS || '/app/data,/projects')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean),
    intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS || '0', 10),
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
  demoMode: process.env.DEMO_MODE === 'true',
  sentinel: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    managedContainers: (process.env.MANAGED_CONTAINERS || 'jellyfin,nextcloud,t3-code,nginx-proxy-manager,uptime-kuma,portainer-ce,transmission,paperless-ngx,home-assistant')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  },
};
