import React, { useEffect, useMemo, useState } from 'react';
import { CloudflareStatus } from '../types.js';
import { redactText } from '../utils/formatters.js';

interface CloudflareFlowMapProps {
  status: CloudflareStatus;
  isPrivacyMode: boolean;
}

interface MapNode {
  id: string;
  label: string;
  sub?: string;
  dim?: boolean;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

interface MapEdge {
  from: string;
  to: string;
  count: number;
  broken: boolean;
}

const NODE_W = 176;
const NODE_H = 40;
const ROW_H = 54;
const HEAD_H = 30;
const COL_X = [0, 272, 544];
const WIDTH = COL_X[2] + NODE_W;

const originHost = (service: string): string => {
  try {
    return new URL(service).host;
  } catch {
    return service;
  }
};

const toneVar = (tone: MapNode['tone']): string => {
  if (tone === 'good') return 'rgb(var(--state-good))';
  if (tone === 'warn') return 'rgb(var(--state-warn))';
  if (tone === 'bad') return 'rgb(var(--state-bad))';
  return 'rgb(var(--cockpit-muted))';
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Left-to-right picture of how traffic reaches the homelab: domains (zones)
 * resolve to a tunnel, and each tunnel forwards to origin hosts on the LAN.
 * A dashed amber line means at least one hostname on that hop has a DNS record
 * that does not point at the tunnel.
 */
const FlowMapGraph: React.FC<CloudflareFlowMapProps> = ({ status, isPrivacyMode }) => {
  const [hover, setHover] = useState<string | null>(null);

  const { columns, edges, height } = useMemo(() => {
    const zoneNodes: MapNode[] = status.zones.map((z) => ({ id: `z:${z.id}`, label: z.name, dim: true }));
    const tunnelNodes: MapNode[] = status.tunnels.map((t) => ({
      id: `t:${t.id}`,
      label: t.name,
      sub: `${t.hostnames.length} hostname${t.hostnames.length === 1 ? '' : 's'} · ${t.status}`,
      tone: t.status === 'healthy' ? 'good' : t.status === 'degraded' ? 'warn' : t.status === 'down' ? 'bad' : 'neutral',
    }));
    const originNodes = new Map<string, MapNode>();
    const edgeMap = new Map<string, MapEdge>();
    const bump = (from: string, to: string, broken: boolean) => {
      const key = `${from}>${to}`;
      const edge = edgeMap.get(key) ?? { from, to, count: 0, broken: false };
      edge.count += 1;
      edge.broken = edge.broken || broken;
      edgeMap.set(key, edge);
    };

    for (const t of status.tunnels) {
      for (const h of t.hostnames) {
        const originId = `o:${originHost(h.service)}`;
        const origin = originNodes.get(originId) ?? { id: originId, label: originHost(h.service), sub: '0 services' };
        originNodes.set(originId, origin);
        const broken = h.dns === 'missing' || h.dns === 'other';
        if (h.zoneId) {
          bump(`z:${h.zoneId}`, `t:${t.id}`, broken);
          const zone = zoneNodes.find((z) => z.id === `z:${h.zoneId}`);
          if (zone) zone.dim = false;
        }
        bump(`t:${t.id}`, originId, broken);
      }
    }
    for (const origin of originNodes.values()) {
      const n = [...edgeMap.values()].filter((e) => e.to === origin.id).reduce((s, e) => s + e.count, 0);
      origin.sub = `${n} service${n === 1 ? '' : 's'}`;
    }

    const cols = [zoneNodes, tunnelNodes, [...originNodes.values()]];
    const rows = Math.max(1, ...cols.map((c) => c.length));
    return { columns: cols, edges: [...edgeMap.values()], height: HEAD_H + rows * ROW_H };
  }, [status]);

  const pos = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    columns.forEach((col, ci) => {
      const slot = (height - HEAD_H) / Math.max(1, col.length);
      col.forEach((n, i) => map.set(n.id, { x: COL_X[ci], y: HEAD_H + slot * i + slot / 2 }));
    });
    return map;
  }, [columns, height]);

  const connected = (edge: MapEdge): boolean => !hover || edge.from === hover || edge.to === hover;
  const headings = ['Domain (DNS)', 'Tunnel', 'Origin (LAN)'];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="mx-auto block min-w-[620px] max-w-[760px]"
        role="img"
        aria-label="Domains to tunnels to origin hosts"
      >
        {headings.map((h, i) => (
          <text
            key={h}
            x={COL_X[i] + NODE_W / 2}
            y={14}
            textAnchor="middle"
            style={{ fill: 'rgb(var(--cockpit-muted))', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            {h}
          </text>
        ))}

        {edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const x2 = b.x;
          const mx = (x1 + x2) / 2;
          return (
            <g key={`${e.from}>${e.to}`} style={{ opacity: connected(e) ? 1 : 0.15, transition: 'opacity 150ms' }}>
              <path
                d={`M ${x1} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${x2} ${b.y}`}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={e.broken ? '5 4' : undefined}
                style={{ stroke: e.broken ? 'rgb(var(--state-warn))' : 'rgb(var(--cockpit-accent) / 0.55)' }}
              />
              <circle cx={mx} cy={(a.y + b.y) / 2} r={8} style={{ fill: 'rgb(var(--cockpit-bg))', stroke: 'rgb(var(--cockpit-border))' }} />
              <text
                x={mx}
                y={(a.y + b.y) / 2 + 3.5}
                textAnchor="middle"
                style={{ fill: 'rgb(var(--cockpit-text))', fontSize: 11, fontWeight: 600 }}
              >
                {e.count}
              </text>
            </g>
          );
        })}

        {columns.map((col) =>
          col.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const active = !hover || hover === n.id || edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y - NODE_H / 2})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                style={{ opacity: n.dim ? 0.45 : active ? 1 : 0.35, transition: 'opacity 150ms', cursor: 'default' }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  style={{ fill: 'rgb(var(--cockpit-bg))', stroke: 'rgb(var(--cockpit-border))' }}
                />
                {n.tone && <circle cx={14} cy={NODE_H / 2} r={4} style={{ fill: toneVar(n.tone) }} />}
                <text x={n.tone ? 26 : 12} y={n.sub ? 17 : 24} style={{ fill: 'rgb(var(--cockpit-text))', fontSize: 12, fontWeight: 600 }}>
                  {clip(redactText(n.label, isPrivacyMode), 22)}
                </text>
                {n.sub && (
                  <text x={n.tone ? 26 : 12} y={31} style={{ fill: 'rgb(var(--cockpit-muted))', fontSize: 11 }}>
                    {clip(n.sub, 28)}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
};

const useIsNarrow = (): boolean => {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
};

const dotTone = (status: string): string =>
  status === 'healthy' ? 'bg-state-good' : status === 'degraded' ? 'bg-state-warn' : status === 'down' ? 'bg-state-bad' : 'bg-cockpit-muted';

/**
 * Phone layout: the three-column map would need sideways scrolling, so the same
 * path reads top to bottom instead: domains, then each tunnel with its hostnames and origins.
 */
const FlowMapStack: React.FC<CloudflareFlowMapProps> = ({ status, isPrivacyMode }) => {
  const used = new Set(status.tunnels.flatMap((t) => t.hostnames.map((h) => h.zoneId)));
  return (
    <div className="space-y-2">
      <p className="label">Domain (DNS)</p>
      <div className="flex flex-wrap gap-1.5">
        {status.zones.map((z) => (
          <span key={z.id} className={`pill pill-neutral normal-case ${used.has(z.id) ? '' : 'opacity-60'}`}>
            {redactText(z.name, isPrivacyMode)}
          </span>
        ))}
      </div>
      <div className="flex justify-center py-1 text-cockpit-muted" aria-hidden="true">
        ↓
      </div>
      <p className="label">Tunnels → origin (LAN)</p>
      {status.tunnels.map((t) => (
        <div key={t.id} className="rounded-xl border border-cockpit-border/80 bg-cockpit-bg/50 p-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotTone(t.status)}`} />
            <span className="truncate text-[13px] font-semibold text-cockpit-text">{redactText(t.name, isPrivacyMode)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-cockpit-muted">{t.status}</span>
          </div>
          {t.hostnames.length === 0 ? (
            <p className="mt-2 text-[11px] text-cockpit-muted">{t.managed === 'local' ? 'Local config, not listed' : 'No hostnames'}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {t.hostnames.map((h) => (
                <li key={h.hostname} className="min-w-0 rounded-lg bg-cockpit-panel/60 px-2.5 py-1.5">
                  <p className="truncate font-mono text-[12px] text-cockpit-text">{redactText(h.hostname, isPrivacyMode)}</p>
                  <p className="truncate font-mono text-[11px] text-cockpit-muted">→ {redactText(h.service, isPrivacyMode)}</p>
                  {(h.dns === 'missing' || h.dns === 'other') && (
                    <span className="pill pill-warn mt-1">{h.dns === 'missing' ? 'DNS missing' : `DNS → ${redactText(h.dnsTarget ?? 'other', isPrivacyMode)}`}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

export const CloudflareFlowMap: React.FC<CloudflareFlowMapProps> = (props) => {
  const narrow = useIsNarrow();
  return narrow ? <FlowMapStack {...props} /> : <FlowMapGraph {...props} />;
};
