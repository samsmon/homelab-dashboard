import tls from 'node:tls';
import { SslCertificate } from '../types.js';
import { config, SslDomainConfig } from '../config.js';

const CHECK_TIMEOUT_MS = 5000;

export class SslService {
  private cache: SslCertificate[] = [];
  private lastCheckedAt = 0;
  private isRefreshing = false;

  /**
   * Real TLS handshakes are external I/O with real-world latency, so — same
   * rule as GitProjectsService's GitHub polling — they never run inline on the
   * 2s poll tick. This returns whatever's cached and kicks off a background
   * refresh only once the cache is older than config.sslCheckIntervalMs.
   */
  public async getCertificates(): Promise<SslCertificate[]> {
    if (config.demoMode || config.sslDomains.length === 0) {
      return config.demoMode ? this.getSimulatedCertificates() : [];
    }

    const now = Date.now();
    if (!this.isRefreshing && now - this.lastCheckedAt > config.sslCheckIntervalMs) {
      this.refreshInBackground();
    }

    return this.cache;
  }

  private async refreshInBackground(): Promise<void> {
    this.isRefreshing = true;
    try {
      this.cache = await Promise.all(config.sslDomains.map((d) => this.checkDomain(d)));
      this.lastCheckedAt = Date.now();
    } finally {
      this.isRefreshing = false;
    }
  }

  private checkDomain(domain: SslDomainConfig): Promise<SslCertificate> {
    const id = `ssl_${domain.host.replace(/[^a-zA-Z0-9]/g, '_')}`;

    return new Promise((resolve) => {
      const socket = tls.connect(
        {
          host: domain.host,
          port: domain.port,
          servername: domain.host,
          // We're reading whatever certificate is actually presented, not
          // validating trust — a homelab-internal cert (self-signed, or issued
          // by an internal CA) still has a real expiry worth tracking.
          rejectUnauthorized: false,
          timeout: CHECK_TIMEOUT_MS,
        },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();

          if (!cert || !cert.valid_to) {
            resolve(this.unreachableResult(id, domain, 'No certificate presented'));
            return;
          }

          const validTo = new Date(cert.valid_to);
          const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86400000);

          resolve({
            id,
            domain: domain.host,
            service: domain.label,
            issuer: this.firstString(cert.issuer?.O) || this.firstString(cert.issuer?.CN) || 'Unknown',
            validTo: validTo.toISOString().split('T')[0],
            daysRemaining,
            status: daysRemaining < 0 ? 'critical' : daysRemaining <= 14 ? 'warning' : 'healthy',
            // A TLS handshake can't tell us whether ACME/certbot auto-renewal
            // is configured behind this domain — never claim to know.
            autoRenewEnabled: false,
          });
        }
      );

      socket.on('error', (err) => resolve(this.unreachableResult(id, domain, err.message)));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(this.unreachableResult(id, domain, 'Connection timed out'));
      });
    });
  }

  private firstString(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private unreachableResult(id: string, domain: SslDomainConfig, reason: string): SslCertificate {
    return {
      id,
      domain: domain.host,
      service: `${domain.label} (unreachable: ${reason})`,
      issuer: 'Unknown',
      validTo: '—',
      daysRemaining: 0,
      status: 'critical',
      autoRenewEnabled: false,
    };
  }

  private getSimulatedCertificates(): SslCertificate[] {
    const now = new Date();
    const demo = [
      { id: 'ssl_jellyfin', domain: 'jellyfin.homelab.lan', service: 'Jellyfin Media Server', days: 64 },
      { id: 'ssl_nextcloud', domain: 'cloud.homelab.lan', service: 'Nextcloud Hub', days: 58 },
      { id: 'ssl_vaultwarden', domain: 'vault.homelab.lan', service: 'Vaultwarden Password Vault', days: 19 },
      { id: 'ssl_npm', domain: 'npm.homelab.lan', service: 'Nginx Proxy Manager', days: 42 },
      { id: 'ssl_kuma', domain: 'kuma.homelab.lan', service: 'Uptime Kuma Healthcheck', days: 75 },
      { id: 'ssl_t3code', domain: 'code.homelab.lan', service: 'T3 Code IDE Server', days: 82 },
    ];

    return demo.map((d) => ({
      id: d.id,
      domain: d.domain,
      service: d.service,
      issuer: "Let's Encrypt Authority X3",
      validTo: new Date(now.getTime() + d.days * 86400000).toISOString().split('T')[0],
      daysRemaining: d.days,
      status: d.days <= 14 ? 'warning' : 'healthy',
      autoRenewEnabled: true,
    }));
  }
}
