import { createPortal } from 'react-dom';
import React, { useEffect, useState } from 'react';
import { Cloud, ExternalLink, Pin, PinOff, X } from 'lucide-react';
import { CloudflareStatus, ContainerMetric } from '../types.js';
import { authFetch } from '../utils/api.js';

interface PinDomainModalProps {
  container: ContainerMetric | null;
  onClose: () => void;
  onSaved: () => void;
}

export const PinDomainModal: React.FC<PinDomainModalProps> = ({ container, onClose, onSaved }) => {
  const [publicUrl, setPublicUrl] = useState(container?.publicUrl ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cf, setCf] = useState<CloudflareStatus | null>(null);
  const [subdomain, setSubdomain] = useState(container?.name ?? '');
  const [origin, setOrigin] = useState(container?.lanUrl ?? '');
  const [cfError, setCfError] = useState<string | null>(null);
  const [tunnelId, setTunnelId] = useState('');
  const [zoneId, setZoneId] = useState('');

  useEffect(() => {
    if (!container) return;
    authFetch('/api/cloudflare')
      .then((res) => res.json())
      .then((json: CloudflareStatus) => {
        setCf(json);
        setTunnelId((cur) => cur || json.tunnels.find((t) => t.managed === 'remote')?.id || '');
        setZoneId((cur) => cur || json.zones[0]?.id || '');
      })
      .catch(() => setCf(null));
  }, [container]);

  if (!container) return null;

  const remoteTunnels = cf?.tunnels.filter((t) => t.managed === 'remote') ?? [];
  const zone = cf?.zones.find((z) => z.id === zoneId);
  const canPublish = Boolean(cf?.configured && zone && remoteTunnels.length > 0);

  const handlePublish = async () => {
    if (!zone || !tunnelId) return;
    const hostname = `${subdomain.trim().toLowerCase()}.${zone.name}`;
    setIsSubmitting(true);
    setCfError(null);
    try {
      const res = await authFetch('/api/cloudflare/hostnames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelId, hostname, service: origin.trim() }),
      });
      const json = (await res.json()) as { success: boolean; message?: string };
      if (!json.success) {
        setCfError(json.message || 'Publish failed');
        return;
      }
      await authFetch(`/api/pins/${encodeURIComponent(container.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: `https://${hostname}` }),
      });
      onSaved();
      onClose();
    } catch {
      setCfError('Publish failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePin = async () => {
    setIsSubmitting(true);
    try {
      await authFetch(`/api/pins/${encodeURIComponent(container.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: publicUrl.trim() || undefined }),
      });
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpin = async () => {
    setIsSubmitting(true);
    try {
      await authFetch(`/api/pins/${encodeURIComponent(container.name)}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="overlay">
      <div className="panel modal-panel w-full max-w-md shadow-2xl shadow-black/50">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">
              {container.isPinned ? 'Edit pin' : 'Pin'} · {container.name}
            </h3>
            <p className="panel-sub">Shows up in the command palette (Ctrl+K)</p>
          </div>
          <button onClick={onClose} className="icon-btn" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label htmlFor="public-url" className="label block">
              Public domain (optional)
            </label>
            <input
              id="public-url"
              type="url"
              placeholder="https://jellyfin.example.com"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
            <p className="text-[11.5px] text-cockpit-muted">
              If this container is exposed through a Cloudflare tunnel, the palette links here instead of the LAN
              or Tailscale address.
            </p>
          </div>

          {canPublish && cf ? (
            <div className="space-y-2.5 rounded-xl border border-cockpit-border/60 bg-cockpit-bg/50 p-3.5">
              <p className="label flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5" />
                Publish via Cloudflare Tunnel{cf.isDemo ? ' (demo)' : ''}
              </p>
              {(remoteTunnels.length > 1 || cf.zones.length > 1) && (
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="Tunnel" value={tunnelId} onChange={(e) => setTunnelId(e.target.value)} disabled={isSubmitting} className="field min-w-0">
                    {remoteTunnels.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Domain" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={isSubmitting} className="field min-w-0">
                    {cf.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <input
                  aria-label="Subdomain"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="jellyfin"
                  className="field min-w-0 flex-1"
                />
                <span className="shrink-0 font-mono text-[12px] text-cockpit-muted">.{zone?.name}</span>
              </div>
              <input
                aria-label="Origin"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                disabled={isSubmitting}
                placeholder="http://192.168.18.225:8096"
                className="field w-full"
              />
              <p className="text-[11.5px] text-cockpit-muted">
                Origin is what cloudflared on the docker host connects to. Adds the tunnel rule and the DNS record,
                then saves the pin.
              </p>
              {cfError && <p className="text-[12px] text-state-bad">{cfError}</p>}
              <button
                onClick={handlePublish}
                disabled={isSubmitting || !subdomain.trim() || !origin.trim()}
                className="btn-primary w-full"
              >
                <Cloud className="h-3.5 w-3.5" />
                Publish
              </button>
            </div>
          ) : (
            <a
              href="https://dash.cloudflare.com"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost w-full justify-center"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Manage this tunnel on Cloudflare
            </a>
          )}

          <div className="flex items-center justify-between gap-2.5 pt-1">
            {container.isPinned ? (
              <button onClick={handleUnpin} disabled={isSubmitting} className="btn-ghost">
                <PinOff className="h-3.5 w-3.5" />
                Unpin
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2.5">
              <button onClick={onClose} disabled={isSubmitting} className="btn-ghost">
                Cancel
              </button>
              <button onClick={handlePin} disabled={isSubmitting} className="btn-primary">
                <Pin className="h-3.5 w-3.5" />
                {container.isPinned ? 'Update' : 'Pin'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
