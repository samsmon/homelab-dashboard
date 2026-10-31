import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { DiscoveredRepo, GitDiscoveryResult, GitProjectStatus } from '../types.js';
import { StateBlock } from './StateBlock.js';

interface GitDiscoverySectionProps {
  discovery: GitDiscoveryResult | null;
  error: boolean;
  isScanning: boolean;
  registered: GitProjectStatus[];
  onScan: () => void;
  onRetry: () => void;
  onIgnore: (host: string, path: string, ignored: boolean) => void;
}

type Tone = 'good' | 'warn' | 'neutral';
interface Chip {
  tone: Tone;
  text: string;
  title?: string;
}

const ago = (iso?: string): string => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
};

const scannedAgo = (ms: number | null): string => {
  if (!ms) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};

/** Every label here is something the server actually observed; nothing is inferred from a stored marker. */
export function describeRepo(r: DiscoveredRepo): Chip[] {
  const chips: Chip[] = [];
  if (r.dirty > 0) chips.push({ tone: 'warn', text: `${r.dirty} changed file${r.dirty === 1 ? '' : 's'}`, title: 'Tracked files with local changes; an automatic deploy would skip this repository' });
  const main = r.defaultBranch ?? (['main', 'master'].includes(r.branch) ? r.branch : undefined);
  if (main !== r.branch) chips.push({ tone: 'warn', text: `on ${r.branch}`, title: main ? `The default branch is ${main}` : 'Not on main or master' });

  if (r.remoteState === 'ok') {
    if (r.remoteHead && r.remoteHead !== r.head) {
      const text = r.behind ? `${r.behind} behind` : 'update available';
      chips.push({ tone: 'warn', text, title: `The remote branch is at ${r.remoteHead}, this copy is at ${r.head}` });
      if (r.ahead) chips.push({ tone: 'warn', text: `${r.ahead} ahead` });
    } else {
      chips.push({ tone: 'good', text: 'up to date' });
    }
  } else if (r.remoteState === 'unreachable') {
    chips.push({ tone: 'neutral', text: 'remote unreachable', title: 'git ls-remote failed from this host (private repository, renamed, or no network)' });
  } else if (r.remoteState === 'no-branch') {
    chips.push({ tone: 'neutral', text: 'branch not on remote' });
  } else {
    chips.push({ tone: 'neutral', text: 'no remote' });
  }
  return chips;
}

const toneClass: Record<Tone, string> = { good: 'pill pill-good', warn: 'pill pill-warn', neutral: 'pill pill-neutral' };

export const GitDiscoverySection: React.FC<GitDiscoverySectionProps> = ({ discovery, error, isScanning, registered, onScan, onRetry, onIgnore }) => {
  const [showHidden, setShowHidden] = useState(false);

  const trackedKeys = useMemo(
    () => new Set(registered.map((p) => `${p.sshTarget ?? 'docker-host'}:${(p.localPath ?? '').split('/').filter(Boolean).pop() ?? ''}`)),
    [registered],
  );

  // The same repository on two servers at different commits is the usual sign of a forgotten copy.
  const otherCopies = useMemo(() => {
    const byName = new Map<string, DiscoveredRepo[]>();
    for (const h of discovery?.hosts ?? []) for (const r of h.repos) if (!r.ignored) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    return byName;
  }, [discovery]);

  if (!discovery) {
    return (
      <section className="panel">
        {error ? <StateBlock kind="error" title="Could not load the server scan" onRetry={onRetry} /> : <StateBlock kind="loading" title="Loading the server scan…" />}
      </section>
    );
  }

  const allRepos = discovery.hosts.flatMap((h) => h.repos);
  const hiddenCount = allRepos.filter((r) => r.ignored).length;
  const shownCount = allRepos.length - hiddenCount;
  const okHosts = discovery.hosts.filter((h) => h.ok).length;

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="panel-title">On the servers</h2>
          <p className="panel-sub">
            {shownCount} repositories on {okHosts} of {discovery.hosts.length} hosts · scanned {scannedAgo(discovery.scannedAt)}
            {error ? ' · could not refresh just now' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <button onClick={() => setShowHidden((v) => !v)} className="btn-ghost inline-flex items-center gap-1.5 text-[12px]">
              {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showHidden ? 'Hide' : 'Show'} hidden ({hiddenCount})
            </button>
          )}
          <button onClick={onScan} disabled={isScanning || discovery.scanning} className="btn-ghost inline-flex items-center gap-2 text-[12px] font-medium disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning || discovery.scanning ? 'animate-spin text-cockpit-accent' : ''}`} />
            {isScanning || discovery.scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </div>

      {discovery.hosts.map((host) => {
        const rows = host.repos.filter((r) => showHidden || !r.ignored);
        return (
          <div key={host.host} className="border-t border-cockpit-border/60">
            <div className="flex flex-wrap items-center gap-2 bg-cockpit-bg/40 px-5 py-2">
              <span className="font-mono text-[12.5px] font-semibold text-cockpit-text">{host.host}</span>
              <span className={host.ok ? 'pill pill-good' : 'pill pill-bad'}>{host.ok ? 'scanned' : 'scan failed'}</span>
              <span className="text-[11px] text-cockpit-muted">{rows.length} repositories</span>
            </div>

            {!host.ok && (
              <p className="px-5 py-3 text-[12px] text-state-bad">
                {host.error === 'not scanned yet' ? 'Waiting for the first scan.' : `Could not scan this host: ${host.error}.`}
                {host.error === 'SSH key not authorized' && ' Add the dashboard’s public key to this host’s authorized_keys.'}
                {host.repos.length > 0 && ' Showing the last successful scan.'}
              </p>
            )}

            {host.ok && rows.length === 0 && <p className="px-5 py-4 text-[12px] text-cockpit-muted">No git repositories found in the scanned folders.</p>}

            <ul className="divide-y divide-cockpit-border/60">
              {rows.map((r) => {
                const chips = describeRepo(r);
                const copies = (otherCopies.get(r.name) ?? []).filter((o) => o.host !== r.host && o.head !== r.head);
                const tracked = trackedKeys.has(`${r.host}:${r.name}`);
                return (
                  <li key={r.path} className={`px-5 py-3 ${r.ignored ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-cockpit-text">{r.name}</span>
                          <span className="pill pill-neutral normal-case">{r.branch}</span>
                          {tracked && <span className="pill pill-accent" title="Registered below for pull and deploy">tracked</span>}
                        </div>
                        <p className="truncate font-mono text-[11px] text-cockpit-muted">{r.path}</p>
                        <p className="truncate text-[12px] text-cockpit-text">
                          <span className="font-mono text-cockpit-muted">{r.head}</span>
                          {r.headDate && <span className="text-cockpit-muted"> · {ago(r.headDate)}</span>}
                          {r.headSubject && <span> · {r.headSubject}</span>}
                        </p>
                        {copies.length > 0 && (
                          <p className="text-[11px] text-state-warn">
                            Also on {copies.map((o) => `${o.host} @ ${o.head}`).join(', ')}: these copies differ
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {chips.map((c) => (
                          <span key={c.text} className={toneClass[c.tone]} title={c.title}>
                            {c.text}
                          </span>
                        ))}
                        <button
                          onClick={() => onIgnore(r.host, r.path, !r.ignored)}
                          className="icon-btn"
                          title={r.ignored ? 'Show this repository again' : 'Hide this repository (not one of your projects)'}
                          aria-label={r.ignored ? `Show ${r.name} again` : `Hide ${r.name}`}
                        >
                          {r.ignored ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
};
