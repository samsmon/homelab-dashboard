export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatNetworkRate(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

export function redactText(text: string, isPrivacy: boolean): string {
  if (!isPrivacy || !text) return text;
  // Redact IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text)) {
    const parts = text.split('.');
    return `${parts[0]}.${parts[1]}.•••.•••`;
  }
  // Redact domain
  if (text.includes('.')) {
    const parts = text.split('.');
    return `••••••.${parts.slice(-1)[0]}`;
  }
  return '••••••';
}

const FREE_TEXT_DOMAIN = /\b(?:[a-z0-9-]+\.)+(com|net|org|io|dev|app|id|co|me|xyz|local|lan|home|cloud|ai|tech|online|site)\b/gi;
const FREE_TEXT_IPV4 = /\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g;

/**
 * Privacy-mode redaction for sentences (log lines, command lines) that embed IPs or hostnames,
 * where redactText would hide the whole string. Keeps the surrounding words readable.
 */
export function redactFreeText(text: string, isPrivacy: boolean): string {
  if (!isPrivacy || !text) return text;
  return text
    .replace(FREE_TEXT_IPV4, '$1.$2.•••.•••')
    .replace(FREE_TEXT_DOMAIN, (_m, tld: string) => `••••••.${tld}`);
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}

export function getStatusColor(percent: number): {
  bar: string;
  badge: string;
  text: string;
} {
  if (percent >= 90) {
    return { bar: 'bg-state-bad', badge: 'pill-bad', text: 'text-state-bad' };
  }
  if (percent >= 75) {
    return { bar: 'bg-state-warn', badge: 'pill-warn', text: 'text-state-warn' };
  }
  return { bar: 'bg-cockpit-accent', badge: 'pill-neutral', text: 'text-cockpit-text' };
}

export function getTempColor(temp: number): {
  bar: string;
  text: string;
  label: string;
} {
  if (temp > 75) return { bar: 'bg-state-bad', text: 'text-state-bad', label: 'HOT' };
  if (temp > 60) return { bar: 'bg-state-warn', text: 'text-state-warn', label: 'WARM' };
  return { bar: 'bg-cockpit-accent', text: 'text-cockpit-text', label: 'COOL' };
}
