import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CloudflareStatus } from '../types.js';
import { authFetch } from '../utils/api.js';
import { redactText } from '../utils/formatters.js';

interface CloudflareTunnelSectionProps {
  isPrivacyMode?: boolean;
}

const statusPill = (status: string): string => {
  if (status === 'healthy') return 'pill pill-good';
  if (status === 'degraded') return 'pill pill-warn';
  if (status === 'down') return 'pill pill-bad';
  return 'pill pill-neutral';
};

/** Read-only summary for the Infra page; editing lives on the Cloudflare page. */
export const CloudflareTunnelSection: React.FC<CloudflareTunnelSectionProps> = ({ isPrivacyMode = false }) => {
  const [status, setStatus] = useState<CloudflareStatus | null>(null);

  useEffect(() => {
    authFetch('/api/cloudflare')
      .then((res) => res.json())
      .then((json: CloudflareStatus) => setStatus(json))
      .catch(() => setStatus(null));
  }, []);

  if (!status?.configured) return null;

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Cloudflare tunnels</h2>
          <p className="panel-sub">
            {status.tunnels.length} tunnel{status.tunnels.length === 1 ? '' : 's'} · {status.zones.length} domain
            {status.zones.length === 1 ? '' : 's'}
            {status.isDemo ? ' (demo data)' : ''}
          </p>
        </div>
        <Link to="/cloudflare" className="btn-ghost inline-flex items-center gap-1.5 text-[12px]">
          Manage
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {status.error ? (
        <p className="bg-state-bad/10 px-5 py-3 text-[12px] text-state-bad">{status.error}</p>
      ) : (
        <ul className="divide-y divide-cockpit-border/60">
          {status.tunnels.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[12.5px]">
              <span className="min-w-0 truncate font-semibold text-cockpit-text">{redactText(t.name, isPrivacyMode)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-cockpit-muted">{t.hostnames.length} hostnames</span>
                <span className={statusPill(t.status)}>{t.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
