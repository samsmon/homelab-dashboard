import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ProcessMetric } from '../types.js';
import { authFetch } from '../utils/api.js';
import { StateBlock } from '../components/StateBlock.js';
import { formatBytes, formatNetworkRate, getStatusColor, redactFreeText } from '../utils/formatters.js';

type SortKey = 'cpu' | 'mem' | 'name' | 'disk';

// Docker top() and the remote SSH `ps` are both heavier than the local host
// list, so they poll slower — and only the active tab's endpoint is hit at
// all, not all three sources at once.
const POLL_MS: Record<string, number> = { host: 3000, docker: 5000 };
const REMOTE_POLL_MS = 8000;
const PAGE_SIZE = 50;

export const ProcessesPage: React.FC<{ isPrivacyMode?: boolean }> = ({ isPrivacyMode = false }) => {
  const [sshTargets, setSshTargets] = useState<string[]>([]);
  const [source, setSource] = useState('host');
  const [processes, setProcesses] = useState<ProcessMetric[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('cpu');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Switching source or filter starts again from the top of the list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [source, search]);

  useEffect(() => {
    authFetch('/api/ssh-targets')
      .then((res) => res.json())
      .then((data: { targets: string[] }) => setSshTargets(data.targets ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const endpoint =
      source === 'host'
        ? '/api/processes'
        : source === 'docker'
        ? '/api/processes/docker'
        : `/api/processes/remote/${encodeURIComponent(source.slice(4))}`;
    const pollMs = POLL_MS[source] ?? REMOTE_POLL_MS;

    const load = () => {
      authFetch(endpoint)
        .then((res) => res.json())
        .then((data: ProcessMetric[]) => {
          if (!cancelled) {
            setProcesses(data);
            setLoadError(false);
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadError(true);
            setIsLoading(false);
          }
        });
    };

    load();
    const interval = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [source, reloadKey]);

  const toggleSort = (column: SortKey) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return processes
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.command.toLowerCase().includes(q) ||
          p.user.toLowerCase().includes(q) ||
          String(p.pid).includes(q)
      )
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'cpu') diff = a.cpuPercent - b.cpuPercent;
        else if (sortBy === 'mem') diff = a.memBytes - b.memBytes || a.memPercent - b.memPercent;
        else if (sortBy === 'name') diff = a.name.localeCompare(b.name);
        else
          diff =
            (a.diskReadBytesPerSec ?? 0) +
            (a.diskWriteBytesPerSec ?? 0) -
            ((b.diskReadBytesPerSec ?? 0) + (b.diskWriteBytesPerSec ?? 0));
        return sortOrder === 'desc' ? -diff : diff;
      });
  }, [processes, search, sortBy, sortOrder]);

  const shown = filtered.slice(0, visibleCount);
  const hasDiskData = processes.some((p) => p.diskReadBytesPerSec !== undefined);
  const hasMemBytes = processes.some((p) => p.memBytes > 0);

  const SortHeader: React.FC<{ column: SortKey; children: React.ReactNode; className?: string }> = ({
    column,
    children,
    className = '',
  }) => (
    <th className={`px-4 py-2.5 font-medium ${className}`}>
      <button
        onClick={() => toggleSort(column)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-cockpit-text ${
          sortBy === column ? 'text-cockpit-accent' : ''
        }`}
      >
        {children}
        {sortBy === column && <span aria-hidden="true">{sortOrder === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  );

  return (
    <section className="panel overflow-hidden animate-fade-in-up">
      <div className="panel-head flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="panel-title">Processes</h2>
          <p className="panel-sub">
            {isLoading ? 'Loading…' : `${processes.length} processes`} · sorted by CPU by default
          </p>
        </div>

        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cockpit-muted" />
          <input
            type="text"
            placeholder="Filter name, user, PID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field w-full sm:w-56 !pl-9 pr-7 text-[12.5px]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-cockpit-muted hover:text-cockpit-text"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-cockpit-border px-4 sm:px-5 py-3">
        <div className="seg flex-wrap">
          <button onClick={() => setSource('host')} className={`seg-btn ${source === 'host' ? 'seg-btn-on' : ''}`}>
            This host
          </button>
          <button
            onClick={() => setSource('docker')}
            className={`seg-btn ${source === 'docker' ? 'seg-btn-on' : ''}`}
          >
            Docker containers
          </button>
          {sshTargets.map((target) => (
            <button
              key={target}
              onClick={() => setSource(`ssh:${target}`)}
              className={`seg-btn ${source === `ssh:${target}` ? 'seg-btn-on' : ''}`}
            >
              {target}
            </button>
          ))}
        </div>
      </div>

      <div className="sm:hidden">
        <div className="flex items-center gap-2 border-b border-cockpit-border px-4 py-2.5">
          <span className="label shrink-0">Sort</span>
          <div className="seg">
            {(['cpu', 'mem', 'name'] as SortKey[]).map((key) => (
              <button key={key} onClick={() => toggleSort(key)} className={`seg-btn ${sortBy === key ? 'seg-btn-on' : ''}`}>
                {key === 'mem' ? 'Memory' : key === 'cpu' ? 'CPU' : 'Name'}
                {sortBy === key && <span aria-hidden="true"> {sortOrder === 'desc' ? '↓' : '↑'}</span>}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-cockpit-border">
          {shown.map((p) => (
            <li key={`m-${p.source ?? ''}-${p.pid}-${p.name}`} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-cockpit-text">{p.name}</p>
                <p className="truncate font-mono text-[11px] text-cockpit-muted">{redactFreeText(p.command, isPrivacyMode)}</p>
                <p className="font-mono text-[11px] text-cockpit-muted">
                  PID {p.pid} · {p.user}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`metric text-[13px] tabular-nums ${getStatusColor(p.cpuPercent).text}`}>{p.cpuPercent.toFixed(1)}%</p>
                <p className="font-mono text-[11px] tabular-nums text-cockpit-muted">
                  {hasMemBytes ? formatBytes(p.memBytes) : `${p.memPercent.toFixed(1)}%`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="hidden overflow-x-auto scrollbar-thin sm:block">
        <table className="w-full min-w-0 text-left text-[13px]">
          <thead>
            <tr className="border-b border-cockpit-border font-mono text-[11px] uppercase tracking-[0.09em] text-cockpit-muted">
              <SortHeader column="name" className="w-auto">Process</SortHeader>
              <th className="hidden sm:table-cell px-4 py-2.5 font-medium w-24">PID</th>
              <th className="hidden md:table-cell px-4 py-2.5 font-medium w-28">User</th>
              <SortHeader column="cpu" className="w-24 whitespace-nowrap">CPU</SortHeader>
              <SortHeader column="mem" className="w-28 whitespace-nowrap">Memory</SortHeader>
              {source === 'host' && (
                <SortHeader column="disk" className="hidden lg:table-cell w-36 whitespace-nowrap">Disk I/O</SortHeader>
              )}
            </tr>
          </thead>
          <tbody className="animate-fadeIn">
            {shown.map((p) => {
              const cpuTone = getStatusColor(p.cpuPercent);
              return (
                <tr
                  key={`${p.source ?? ''}-${p.pid}-${p.name}`}
                  className="border-b border-cockpit-border transition-colors last:border-b-0 hover:bg-cockpit-panelHover"
                >
                  <td className="w-full max-w-0 px-4 py-3">
                    <div className="min-w-0">
                      <span className="block font-semibold text-cockpit-text truncate">{p.name}</span>
                      <span className="block truncate font-mono text-[11px] text-cockpit-muted" title={redactFreeText(p.command, isPrivacyMode)}>
                        {redactFreeText(p.command, isPrivacyMode)}
                      </span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-mono text-[12px] tabular-nums text-cockpit-muted whitespace-nowrap">
                    {p.pid}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 font-mono text-[12px] text-cockpit-muted whitespace-nowrap">
                    {p.user}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`metric text-[12.5px] tabular-nums ${cpuTone.text}`}>{p.cpuPercent.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="metric text-[12.5px] tabular-nums">
                      {hasMemBytes ? formatBytes(p.memBytes) : `${p.memPercent.toFixed(1)}%`}
                    </span>
                    {hasMemBytes && (
                      <span className="ml-1.5 font-mono text-[11px] text-cockpit-muted tabular-nums">
                        {p.memPercent.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  {source === 'host' && (
                    <td className="hidden lg:table-cell px-4 py-3 font-mono text-[11.5px] tabular-nums text-cockpit-muted whitespace-nowrap">
                      {p.diskReadBytesPerSec === undefined
                        ? '—'
                        : `${formatNetworkRate(p.diskReadBytesPerSec)} / ${formatNetworkRate(p.diskWriteBytesPerSec ?? 0)}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

      </div>

      {isLoading && processes.length === 0 && <StateBlock kind="loading" />}
      {!isLoading && loadError && processes.length === 0 && (
        <StateBlock kind="error" title="Could not load processes" message="The source did not answer." onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {!isLoading && !loadError && filtered.length === 0 && (
        <StateBlock
          kind="empty"
          title="No processes to show"
          message={
            source === 'docker'
              ? 'No running containers reported a process list; some base images ship a ps that this cannot parse.'
              : 'No processes match this filter.'
          }
        />
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cockpit-border px-4 py-3 text-[11.5px] text-cockpit-muted sm:px-5">
          <span>
            Showing {shown.length} of {filtered.length}
          </span>
          {shown.length < filtered.length && (
            <div className="flex gap-2">
              <button onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="btn-ghost text-[12px]">
                Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
              </button>
              <button onClick={() => setVisibleCount(filtered.length)} className="btn-ghost text-[12px]">
                Show all
              </button>
            </div>
          )}
        </div>
      )}

      {source === 'host' && !hasDiskData && !isLoading && processes.length > 0 && (
        <p className="border-t border-cockpit-border px-5 py-3 text-[11.5px] text-cockpit-muted">
          Per-process disk I/O reads /proc/[pid]/io and is only available on Linux, for processes the daemon has
          permission to inspect.
        </p>
      )}
    </section>
  );
};
