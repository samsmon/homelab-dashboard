import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '../utils/api.js';
import {
  Search,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pin,
  Server,
  LayoutGrid,
  List,
  Rows3,
  X,
  Square,
  Play,
  Activity,
} from 'lucide-react';
import { ContainerMetric, CockpitSnapshot } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { formatBytes, formatNetworkRate, redactText, getStatusColor } from '../utils/formatters.js';
import { PowerAction } from './RestartModal.js';
import { PerformanceGraph } from './PerformanceGraph.js';
import { useMetricHistory } from '../context/MetricHistoryContext.js';

interface ContainerGridSectionProps {
  snapshot?: CockpitSnapshot | null;
  containers?: ContainerMetric[];
  isPrivacyMode?: boolean;
  onViewLogs: (container: ContainerMetric) => void;
  onPowerAction: (container: ContainerMetric, action: PowerAction) => void;
  onPinContainer: (container: ContainerMetric) => void;
}


function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}

const WebUiMenu: React.FC<{ container: ContainerMetric; isPrivacyMode: boolean }> = ({
  container,
  isPrivacyMode,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const ref = useClickOutside(() => setIsOpen(false));

  const links = [
    { label: 'Public domain', url: container.publicUrl },
    { label: 'Tailscale', url: container.tailscaleUrl },
    { label: 'LAN', url: container.lanUrl },
  ].filter((l): l is { label: string; url: string } => Boolean(l.url));

  if (links.length === 0) {
    return <span className="font-mono text-[11px] text-cockpit-muted">internal</span>;
  }

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        title="Choose which address to open"
        className="inline-flex items-center gap-1 rounded-md border border-cockpit-border px-2 py-1 font-mono text-[11px] text-cockpit-accent transition-colors hover:border-cockpit-accent/40"
      >
        <ExternalLink className="h-3 w-3" />:{container.primaryPort}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {isOpen && (
        <div className="modal-panel absolute left-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-lg border border-cockpit-border bg-cockpit-panel shadow-lg shadow-black/30">
          {links.map((link) => (
            <div
              key={link.label}
              className="flex items-center justify-between gap-2 border-b border-cockpit-border px-3 py-2 last:border-b-0 hover:bg-cockpit-panelHover"
            >
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => setIsOpen(false)}
                className="min-w-0 flex-1"
              >
                <span className="block text-[11.5px] font-semibold text-cockpit-text">{link.label}</span>
                <span className="block truncate font-mono text-[10.5px] text-cockpit-muted">
                  {redactText(link.url, isPrivacyMode)}
                </span>
              </a>
              <button onClick={() => copy(link.url)} title="Copy URL" className="icon-btn shrink-0 p-1">
                {copiedUrl === link.url ? (
                  <Check className="h-3 w-3 animate-popIn text-state-good" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ALL_HOSTS = '__all__';
const PAGE_SIZES = [15, 30, 0]; // 0 = show everything on one page

type StatusFilter = 'all' | 'running' | 'stopped' | 'problem';
type SortKey = 'name' | 'problems' | 'cpu' | 'memory';
type ViewMode = 'list' | 'cards' | 'table';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  problems: 'Problems first',
  cpu: 'CPU high to low',
  memory: 'RAM high to low',
};

// A container needs attention when its HTTP probe is critical or Docker reports
// it restarting/dead. A plain "exited" container is treated as intentionally stopped.
function isProblem(c: ContainerMetric): boolean {
  if (c.state === 'restarting' || c.state === 'dead') return true;
  return c.state === 'running' && c.httpHealth?.status === 'critical';
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function useStoredToggle(key: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {}
    return defaultOpen;
  });
  const toggle = () =>
    setOpen((prev) => {
      try {
        localStorage.setItem(key, String(!prev));
      } catch {}
      return !prev;
    });
  return [open, toggle];
}

const StatusPills: React.FC<{ container: ContainerMetric }> = ({ container }) => {
  const isRunning = container.state === 'running';
  const probe = container.httpHealth;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`pill ${isRunning ? 'pill-good' : isProblem(container) ? 'pill-bad' : 'pill-neutral'}`}>
        {isRunning ? 'Running' : container.state === 'exited' ? 'Stopped' : container.state}
      </span>
      {isRunning && probe?.status === 'healthy' && (
        <span className="pill pill-neutral normal-case tabular-nums">
          {probe.statusCode || 200} · {probe.latencyMs}ms
        </span>
      )}
      {isRunning && probe?.status === 'critical' && <span className="pill pill-bad">502 error</span>}
    </div>
  );
};

interface ContainerActionsProps {
  container: ContainerMetric;
  showPin?: boolean;
  onViewLogs: (container: ContainerMetric) => void;
  onPowerAction: (container: ContainerMetric, action: PowerAction) => void;
  onPinContainer: (container: ContainerMetric) => void;
}

const ContainerActions: React.FC<ContainerActionsProps> = ({
  container,
  showPin = false,
  onViewLogs,
  onPowerAction,
  onPinContainer,
}) => {
  const isRunning = container.state === 'running';
  return (
    <div className="flex items-center justify-end gap-1.5">
      {showPin && (
        <button
          onClick={() => onPinContainer(container)}
          title={container.isPinned ? 'Edit pin' : 'Pin to command palette'}
          className={`icon-btn hover:border-cockpit-accent/40 hover:text-cockpit-accent ${
            container.isPinned ? 'border-cockpit-accent/30 text-cockpit-accent' : ''
          }`}
        >
          <Pin className={`h-3.5 w-3.5 ${container.isPinned ? 'fill-current' : ''}`} />
        </button>
      )}
      {!container.isExternal && (
        <>
          <button onClick={() => onViewLogs(container)} title="View logs" className="icon-btn">
            <Terminal className="h-3.5 w-3.5" />
          </button>
          {isRunning ? (
            <button
              onClick={() => onPowerAction(container, 'stop')}
              title="Stop container"
              className="icon-btn hover:border-state-bad/40 hover:text-state-bad"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => onPowerAction(container, 'start')}
              title="Start container"
              className="icon-btn hover:border-state-good/40 hover:text-state-good"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onPowerAction(container, 'restart')}
            title="Restart container"
            className="icon-btn hover:border-state-warn/40 hover:text-state-warn"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
};

export const ContainerGridSection: React.FC<ContainerGridSectionProps> = ({
  snapshot,
  containers = [],
  isPrivacyMode = false,
  onViewLogs,
  onPowerAction,
  onPinContainer,
}) => {
  const isNarrow = useMediaQuery('(max-width: 639px)');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [selectedHost, setSelectedHost] = useState<string>(ALL_HOSTS);
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [storedViewMode, setStoredViewMode] = useState<ViewMode | null>(() => {
    try {
      const v = localStorage.getItem('cockpit-fleet-view');
      return v === 'list' || v === 'cards' || v === 'table' ? v : null;
    } catch {
      return null;
    }
  });

  // First visit: compact list on phones, cards elsewhere. Table needs width.
  const viewMode: ViewMode =
    isNarrow && (storedViewMode === 'table' || storedViewMode === null)
      ? 'list'
      : (storedViewMode ?? 'cards');

  const handleSetViewMode = (mode: ViewMode) => {
    setStoredViewMode(mode);
    try {
      localStorage.setItem('cockpit-fleet-view', mode);
    } catch {}
  };

  const [showHostCards, toggleHostCards] = useStoredToggle('cockpit-fleet-hosts', !isNarrow);
  const [showFleetGraphs, toggleFleetGraphs] = useStoredToggle('cockpit-fleet-graphs', !isNarrow);

  // Extract all unique docker hosts from containers + dockerHosts snapshot
  const hostNames = useMemo(() => {
    const list = Array.from(new Set(containers.map((c) => c.dockerHost))).filter(Boolean);
    if (list.length === 0 && snapshot?.dockerHosts) {
      return snapshot.dockerHosts.map((h) => h.name);
    }
    return list.sort();
  }, [containers, snapshot]);

  const { history } = useMetricHistory();

  // Live container metrics monitoring (on-demand, 5m auto-stop)
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
  const [isTogglingMonitor, setIsTogglingMonitor] = useState(false);
  const isMonitoringRef = useRef(isMonitoring);
  isMonitoringRef.current = isMonitoring;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync state if snapshot has containerMonitoring telemetry
  useEffect(() => {
    if (snapshot?.containerMonitoring) {
      if (snapshot.containerMonitoring.active) {
        setIsMonitoring(true);
        const remSec = Math.max(0, Math.round(snapshot.containerMonitoring.remainingMs / 1000));
        setCountdown(remSec);
      } else if (isMonitoring) {
        setIsMonitoring(false);
        setCountdown(300);
      }
    }
  }, [snapshot?.containerMonitoring]);

  const stopMonitoring = useCallback(async () => {
    setIsMonitoring(false);
    setCountdown(300);
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      await authFetch('/api/containers/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
    } catch (e) {
      console.warn('Failed to stop container monitoring:', e);
    }
  }, []);

  const startMonitoring = useCallback(async () => {
    setIsTogglingMonitor(true);
    try {
      const res = await authFetch('/api/containers/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, durationMs: 300000 }),
      });
      if (res.ok) {
        setIsMonitoring(true);
        setCountdown(300);
      }
    } catch (e) {
      console.warn('Failed to start container monitoring:', e);
    } finally {
      setIsTogglingMonitor(false);
    }
  }, []);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      stopMonitoring();
    } else {
      startMonitoring();
    }
  };

  // 5-minute countdown timer: automatically stops when reaches 0
  useEffect(() => {
    if (!isMonitoring) {
      if (timerRef.current) clearInterval(timerRef.current);
      setCountdown(300);
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          stopMonitoring();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isMonitoring, stopMonitoring]);

  // Automatically stop monitoring when navigating away from Fleet page (component unmount)
  useEffect(() => {
    return () => {
      if (isMonitoringRef.current) {
        authFetch('/api/containers/monitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        }).catch(() => {});
      }
    };
  }, []);

  const formatCountdown = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Compute stats per docker host
  const hostStats = useMemo(() => {
    const map: Record<
      string,
      {
        total: number;
        running: number;
        stopped: number;
        problems: number;
        totalCpu: number;
        totalRamBytes: number;
      }
    > = {};

    const blank = () => ({ total: 0, running: 0, stopped: 0, problems: 0, totalCpu: 0, totalRamBytes: 0 });
    for (const h of hostNames) {
      map[h] = blank();
    }

    for (const c of containers) {
      const h = c.dockerHost || hostNames[0] || 'docker-host';
      if (!map[h]) {
        map[h] = blank();
      }
      map[h].total += 1;
      if (isProblem(c)) map[h].problems += 1;
      if (c.state === 'running') {
        map[h].running += 1;
        map[h].totalCpu += c.cpuPercent || 0;
        map[h].totalRamBytes += c.memoryBytes || 0;
      } else {
        map[h].stopped += 1;
      }
    }

    return map;
  }, [containers, hostNames]);

  const dockerHostTelemetry = snapshot?.host.dockerHost;

  // Everything except the host filter, so we can tell the user when a search
  // has hits on another host.
  const matchesFilters = useCallback(
    (c: ContainerMetric) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const hit =
          c.name.toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          (c.dockerHost || '').toLowerCase().includes(q) ||
          c.ports.some((p) => p.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (statusFilter === 'running' && c.state !== 'running') return false;
      if (statusFilter === 'stopped' && c.state === 'running') return false;
      if (statusFilter === 'problem' && !isProblem(c)) return false;
      if (pinnedOnly && !c.isPinned) return false;
      return true;
    },
    [search, statusFilter, pinnedOnly],
  );

  const byName = (x: ContainerMetric, y: ContainerMetric) =>
    x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' });

  const filteredContainers = useMemo(() => {
    const rank = (c: ContainerMetric) => (isProblem(c) ? 0 : c.state !== 'running' ? 1 : 2);
    return containers
      .filter((c) => (selectedHost === ALL_HOSTS || c.dockerHost === selectedHost) && matchesFilters(c))
      .sort((x, y) => {
        if (sortKey === 'problems') return rank(x) - rank(y) || byName(x, y);
        if (sortKey === 'cpu') return (y.cpuPercent || 0) - (x.cpuPercent || 0) || byName(x, y);
        if (sortKey === 'memory') return (y.memoryBytes || 0) - (x.memoryBytes || 0) || byName(x, y);
        return byName(x, y);
      });
  }, [containers, selectedHost, matchesFilters, sortKey]);

  const hitsOnOtherHosts = useMemo(() => {
    if (selectedHost === ALL_HOSTS || filteredContainers.length > 0) return 0;
    return containers.filter((c) => c.dockerHost !== selectedHost && matchesFilters(c)).length;
  }, [containers, selectedHost, filteredContainers.length, matchesFilters]);

  const statusCounts = useMemo(() => {
    const inScope = containers.filter((c) => selectedHost === ALL_HOSTS || c.dockerHost === selectedHost);
    return {
      all: inScope.length,
      running: inScope.filter((c) => c.state === 'running').length,
      stopped: inScope.filter((c) => c.state !== 'running').length,
      problem: inScope.filter(isProblem).length,
    };
  }, [containers, selectedHost]);

  const effectivePageSize = pageSize === 0 ? Math.max(1, filteredContainers.length) : pageSize;
  const pageCount = Math.max(1, Math.ceil(filteredContainers.length / effectivePageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * effectivePageSize;
  const visibleContainers = filteredContainers.slice(pageStart, pageStart + effectivePageSize);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pinnedOnly, selectedHost, pageSize, sortKey]);

  const runningCount = filteredContainers.filter((c) => c.state === 'running').length;
  const scopeLabel = selectedHost === ALL_HOSTS ? 'all hosts' : selectedHost;
  const hasActiveFilters = search !== '' || statusFilter !== 'all' || pinnedOnly;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPinnedOnly(false);
  };

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const actionProps = { onViewLogs, onPowerAction, onPinContainer };

  const statusOptions: [StatusFilter, string, number | null][] = [
    ['all', 'All', null],
    ['running', 'Running', null],
    ['stopped', 'Stopped', null],
    ['problem', 'Problems', statusCounts.problem],
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header: title, live monitor */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold text-cockpit-text">Docker &amp; LXC Fleets</h2>
          <p className="text-[12px] text-cockpit-muted">
            {containers.length} containers across {hostNames.length} {hostNames.length === 1 ? 'host' : 'hosts'}
            {statusCounts.problem > 0 && selectedHost === ALL_HOSTS ? ` · ${statusCounts.problem} need attention` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleMonitoring}
          disabled={isTogglingMonitor}
          title={
            isMonitoring
              ? 'Live usage telemetry active. Click to stop (auto-stops in 5m or upon navigating away).'
              : 'Click to track live CPU and memory usage for running containers (auto-stops in 5m or when leaving page).'
          }
          className={`inline-flex min-h-[2.5rem] items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all sm:min-h-0 sm:py-1.5 ${
            isMonitoring
              ? 'border border-state-good/60 bg-state-good/15 text-state-good shadow-sm hover:bg-state-good/25'
              : 'border border-cockpit-border bg-cockpit-panel text-cockpit-muted hover:border-cockpit-accent/50 hover:text-cockpit-text'
          }`}
        >
          {isMonitoring ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-good opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-state-good" />
              </span>
              <span className="font-semibold text-cockpit-text">Stop Monitor</span>
              <span className="font-mono tabular-nums text-[11px] bg-state-good/20 text-state-good px-1.5 py-0.5 rounded-md">
                {formatCountdown(countdown)}
              </span>
            </>
          ) : (
            <>
              <Activity className="h-3.5 w-3.5 text-cockpit-accent" />
              <span>Live Usage Monitor</span>
              <span className="pill pill-neutral hidden font-mono text-[10px] sm:inline-flex">5m auto-stop</span>
            </>
          )}
        </button>
      </div>

      {/* Host chips: one tap to scope the list, "All hosts" is the default */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
        {[ALL_HOSTS, ...hostNames].map((host) => {
          const isAll = host === ALL_HOSTS;
          const isSelected = selectedHost === host;
          const total = isAll ? containers.length : (hostStats[host]?.total ?? 0);
          const problems = isAll ? statusCounts.problem : (hostStats[host]?.problems ?? 0);
          const isConnected = isAll ? true : (snapshot?.dockerHosts?.find((d) => d.name === host)?.connected ?? true);
          return (
            <button
              key={host}
              type="button"
              onClick={() => setSelectedHost(host)}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-all active:scale-95 ${
                isSelected
                  ? 'border-cockpit-accent bg-cockpit-accent/15 text-cockpit-accent'
                  : 'border-cockpit-border/80 bg-cockpit-panel/85 text-cockpit-muted hover:border-cockpit-border hover:text-cockpit-text'
              }`}
            >
              {isAll ? (
                <LayoutGrid className="h-3.5 w-3.5" />
              ) : (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? 'bg-state-good' : 'bg-state-warn'}`}
                  title={isConnected ? 'Connected' : 'Degraded'}
                />
              )}
              <span className="whitespace-nowrap">{isAll ? 'All hosts' : host}</span>
              <span className="font-mono text-[11px] tabular-nums opacity-80">{total}</span>
              {problems > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-state-bad" title={`${problems} need attention`} />}
            </button>
          );
        })}
      </div>

      {/* Main container list */}
      <section className="panel overflow-hidden">
        {isMonitoring && (
          <div className="border-b border-state-good/30 bg-state-good/10 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-2 text-cockpit-text">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-good opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-state-good" />
              </span>
              <span>
                Live usage monitoring active for running containers on <strong className="text-cockpit-accent">{scopeLabel}</strong>.
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-cockpit-muted">
              <span>Auto-stop in <strong className="text-cockpit-text tabular-nums">{formatCountdown(countdown)}</strong></span>
              <button
                type="button"
                onClick={stopMonitoring}
                className="font-semibold text-state-good hover:underline"
              >
                Stop Now
              </button>
            </div>
          </div>
        )}

        <div className="panel-head flex-col !items-stretch gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="panel-title">
              Containers on <span className="text-cockpit-accent">{scopeLabel}</span>
            </h3>
            <p className="panel-sub">
              {runningCount} running of {filteredContainers.length} shown
            </p>
          </div>

          {/* Search always spans the full width */}
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cockpit-muted" />
            <input
              type="search"
              placeholder="Search name, image, port or host…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="field w-full !pl-9 pr-9 text-[13px]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-cockpit-muted hover:text-cockpit-text"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* One status control instead of two overlapping "All" groups */}
            <div className="seg max-w-full overflow-x-auto scrollbar-none">
              {statusOptions.map(([mode, label, badge]) => (
                <button
                  key={mode}
                  onClick={() => setStatusFilter(mode)}
                  className={`seg-btn whitespace-nowrap ${statusFilter === mode ? 'seg-btn-on' : ''}`}
                >
                  {label}
                  {badge ? (
                    <span className="ml-1.5 rounded-full bg-state-bad/20 px-1.5 text-[10px] font-bold text-state-bad">
                      {badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPinnedOnly((v) => !v)}
              aria-pressed={pinnedOnly}
              title="Show pinned containers only"
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-all active:scale-95 ${
                pinnedOnly
                  ? 'border-cockpit-accent/50 bg-cockpit-accent/15 text-cockpit-accent'
                  : 'border-cockpit-border/80 bg-cockpit-bg/50 text-cockpit-muted hover:text-cockpit-text'
              }`}
            >
              <Pin className={`h-3.5 w-3.5 ${pinnedOnly ? 'fill-current' : ''}`} />
              Pinned
            </button>

            <label className="flex items-center gap-1.5">
              <span className="sr-only">Sort by</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="field min-h-[38px] w-[7.5rem] !py-1.5 !pl-2.5 !pr-1 text-[12px] sm:w-auto"
                title="Sort order"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>

            <div className="seg ml-auto" title="Switch layout view">
              <button
                onClick={() => handleSetViewMode('list')}
                className={`seg-btn px-2.5 ${viewMode === 'list' ? 'seg-btn-on' : ''}`}
                title="Compact list"
              >
                <Rows3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleSetViewMode('cards')}
                className={`seg-btn px-2.5 ${viewMode === 'cards' ? 'seg-btn-on' : ''}`}
                title="Cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleSetViewMode('table')}
                className={`seg-btn hidden px-2.5 sm:inline-flex ${viewMode === 'table' ? 'seg-btn-on' : ''}`}
                title="Table"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'list' && (
          <ul key={`${currentPage}-${pageSize}`} className="animate-fadeIn divide-y divide-cockpit-border/60">
            {visibleContainers.map((container) => {
              const isRunning = container.state === 'running';
              const cpuTone = getStatusColor(container.cpuPercent);
              const problem = isProblem(container);
              const expanded = expandedIds.has(container.id);
              return (
                <li key={container.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(container.id)}
                    aria-expanded={expanded}
                    className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cockpit-panelHover active:bg-cockpit-panelHover"
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        problem ? 'bg-state-bad' : isRunning ? 'bg-state-good' : 'bg-cockpit-muted'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {container.isPinned && <Pin className="h-3 w-3 shrink-0 fill-cockpit-accent text-cockpit-accent" />}
                        <span className="truncate text-[14px] font-semibold text-cockpit-text">{container.name}</span>
                      </span>
                      <span className="block truncate font-mono text-[11.5px] text-cockpit-muted">
                        {selectedHost === ALL_HOSTS && hostNames.length > 1 ? `${container.dockerHost} · ` : ''}
                        {container.image}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {isRunning ? (
                        <>
                          <span className={`metric block text-[13px] tabular-nums ${cpuTone.text}`}>
                            {container.cpuPercent.toFixed(1)}%
                          </span>
                          <span className="block font-mono text-[11px] tabular-nums text-cockpit-muted">
                            {formatBytes(container.memoryBytes)}
                          </span>
                        </>
                      ) : (
                        <span className={`pill ${problem ? 'pill-bad' : 'pill-neutral'}`}>{container.state === 'exited' ? 'Stopped' : container.state}</span>
                      )}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-cockpit-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {expanded && (
                    <div className="animate-fadeIn space-y-3 bg-cockpit-bg/40 px-4 pb-4 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <StatusPills container={container} />
                        <span className="font-mono text-[11px] text-cockpit-muted">{container.uptime}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-cockpit-border/50 bg-cockpit-panel/40 p-2 text-center">
                        <div>
                          <p className="label">CPU</p>
                          <p className={`metric mt-0.5 text-[13px] ${isRunning ? cpuTone.text : 'text-cockpit-muted'}`}>
                            {isRunning ? container.cpuPercent.toFixed(1) : '0.0'}%
                          </p>
                        </div>
                        <div className="border-x border-cockpit-border/40">
                          <p className="label">RAM</p>
                          <p className="metric mt-0.5 text-[13px]">{isRunning ? formatBytes(container.memoryBytes) : '0 B'}</p>
                        </div>
                        <div>
                          <p className="label">NET</p>
                          <div className="mt-0.5 font-mono text-[11px] tabular-nums leading-tight text-cockpit-text">
                            <div>↓ {formatNetworkRate(container.networkRxRateBytesPerSec)}</div>
                            <div className="text-cockpit-muted">↑ {formatNetworkRate(container.networkTxRateBytesPerSec)}</div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <WebUiMenu container={container} isPrivacyMode={isPrivacyMode} />
                        <ContainerActions container={container} showPin {...actionProps} />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {viewMode === 'cards' && (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 animate-fadeIn">
              {visibleContainers.map((container) => {
                const isRunning = container.state === 'running';
                const cpuTone = getStatusColor(container.cpuPercent);

                return (
                  <div key={container.id} className="container-card flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              isProblem(container) ? 'bg-state-bad' : isRunning ? 'bg-state-good' : 'bg-cockpit-muted'
                            }`}
                          />
                          <span className="font-bold text-cockpit-text truncate text-[14px]" title={container.name}>
                            {container.name}
                          </span>
                          <span className="font-mono text-[11px] text-cockpit-muted shrink-0">#{container.shortId}</span>
                        </div>
                        <button
                          onClick={() => onPinContainer(container)}
                          title={container.isPinned ? 'Edit pin' : 'Pin to command palette'}
                          className={`icon-btn p-1.5 shrink-0 hover:border-cockpit-accent/40 hover:text-cockpit-accent ${
                            container.isPinned ? 'border-cockpit-accent/30 text-cockpit-accent' : ''
                          }`}
                        >
                          <Pin className={`h-3 w-3 ${container.isPinned ? 'fill-current' : ''}`} />
                        </button>
                      </div>

                      <div className="mt-1 truncate font-mono text-[11.5px] text-cockpit-muted" title={container.image}>
                        {container.image}
                      </div>

                      {hostNames.length > 1 && selectedHost === ALL_HOSTS && (
                        <div className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-cockpit-muted bg-cockpit-border/40 px-1.5 py-0.5 rounded">
                          <Server className="h-2.5 w-2.5" />
                          {container.dockerHost}
                        </div>
                      )}

                      {/* Health & Uptime */}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-cockpit-border/60 pt-2.5">
                        <StatusPills container={container} />
                        <span className="font-mono text-[11px] text-cockpit-muted whitespace-nowrap">{container.uptime}</span>
                      </div>

                      {/* Metrics Grid */}
                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-cockpit-border/50 bg-cockpit-panel/40 p-2 text-center">
                        <div>
                          <p className="label text-[10.5px]">CPU</p>
                          <p className={`metric mt-0.5 text-[12.5px] ${isRunning ? cpuTone.text : 'text-cockpit-muted'}`}>
                            {isRunning ? container.cpuPercent.toFixed(1) : '0.0'}%
                          </p>
                        </div>
                        <div className="border-x border-cockpit-border/40">
                          <p className="label text-[10.5px]">RAM</p>
                          <p className="metric mt-0.5 text-[12.5px]">{isRunning ? formatBytes(container.memoryBytes) : '0 B'}</p>
                        </div>
                        <div>
                          <p className="label text-[10.5px]">NET</p>
                          <div className="mt-0.5 font-mono text-[11px] tabular-nums leading-tight text-cockpit-text">
                            <div className="flex items-center justify-center gap-0.5">
                              <ArrowDown className="h-2.5 w-2.5 text-cockpit-accent" />
                              {formatNetworkRate(container.networkRxRateBytesPerSec)}
                            </div>
                            <div className="flex items-center justify-center gap-0.5 text-cockpit-muted">
                              <ArrowUp className="h-2.5 w-2.5" />
                              {formatNetworkRate(container.networkTxRateBytesPerSec)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions footer */}
                    <div className="mt-3.5 flex items-center justify-between border-t border-cockpit-border/60 pt-3">
                      <WebUiMenu container={container} isPrivacyMode={isPrivacyMode} />
                      <ContainerActions container={container} {...actionProps} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {viewMode === 'table' && (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-[13px] min-w-[680px]">
              <thead>
                <tr className="border-b border-cockpit-border font-mono text-[10px] uppercase tracking-[0.09em] text-cockpit-muted">
                  <th className="px-4 py-2.5 font-medium w-auto">Service</th>
                  <th className="px-4 py-2.5 font-medium w-32 whitespace-nowrap">Health</th>
                  <th className="px-4 py-2.5 font-medium w-24 whitespace-nowrap">Web UI</th>
                  <th className="px-4 py-2.5 font-medium w-24 whitespace-nowrap">CPU</th>
                  <th className="px-4 py-2.5 font-medium w-28 whitespace-nowrap">Memory</th>
                  <th className="px-4 py-2.5 font-medium w-36 whitespace-nowrap">Throughput</th>
                  <th className="px-4 py-2.5 text-right font-medium w-32 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody key={`${currentPage}-${pageSize}`} className="animate-fadeIn">
                {visibleContainers.map((container) => {
                  const isRunning = container.state === 'running';
                  const cpuTone = getStatusColor(container.cpuPercent);

                  return (
                    <tr
                      key={container.id}
                      className="group border-b border-cockpit-border transition-colors last:border-b-0 hover:bg-cockpit-panelHover"
                    >
                      <td className="px-4 py-3 min-w-[160px] max-w-[280px]">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isProblem(container) ? 'bg-state-bad' : isRunning ? 'bg-state-good' : 'bg-cockpit-muted'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 truncate">
                              {container.isPinned && (
                                <Pin className="h-3 w-3 shrink-0 fill-cockpit-accent text-cockpit-accent" />
                              )}
                              <span className="font-semibold text-cockpit-text truncate">{container.name}</span>
                              <span className="font-mono text-[10.5px] text-cockpit-muted shrink-0">#{container.shortId}</span>
                            </div>
                            <div className="truncate font-mono text-[11px] text-cockpit-muted" title={container.image}>
                              {container.image}
                            </div>
                            {hostNames.length > 1 && (
                              <div className="mt-0.5 truncate font-mono text-[10px] text-cockpit-muted">
                                {container.dockerHost}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusPills container={container} />
                        <div className="mt-1 font-mono text-[10.5px] text-cockpit-muted">{container.uptime}</div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <WebUiMenu container={container} isPrivacyMode={isPrivacyMode} />
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`metric text-[12.5px] tabular-nums shrink-0 ${isRunning ? cpuTone.text : 'text-cockpit-muted'}`}>
                            {isRunning ? container.cpuPercent.toFixed(1) : '0.0'}%
                          </span>
                          <div className="hidden xl:block shrink-0">
                            <Sparkline
                              data={container.sparklineCpu}
                              tone={container.cpuPercent > 75 ? 'warn' : 'accent'}
                              width={48}
                              height={18}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="metric text-[12.5px] tabular-nums shrink-0">
                            {isRunning ? formatBytes(container.memoryBytes) : '0 B'}
                          </span>
                          <div className="hidden xl:block shrink-0">
                            <Sparkline data={container.sparklineMemory} tone="muted" width={48} height={18} />
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[12px] tabular-nums">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-0.5 text-cockpit-text">
                              <ArrowDown className="h-3 w-3 text-cockpit-accent shrink-0" />
                              {formatNetworkRate(container.networkRxRateBytesPerSec)}
                            </span>
                            <span className="inline-flex items-center gap-0.5 text-cockpit-muted">
                              <ArrowUp className="h-3 w-3 shrink-0" />
                              {formatNetworkRate(container.networkTxRateBytesPerSec)}
                            </span>
                          </div>
                          <div className="text-[10px] text-cockpit-muted truncate">
                            {formatBytes(container.networkRxBytes)} / {formatBytes(container.networkTxBytes)}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <ContainerActions container={container} showPin {...actionProps} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredContainers.length === 0 && (
          <div className="animate-fadeIn space-y-3 px-5 py-10 text-center text-[13px] text-cockpit-muted">
            <p>
              {hitsOnOtherHosts > 0
                ? `No match on ${selectedHost}, but ${hitsOnOtherHosts} on other hosts.`
                : 'No containers match this filter.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {hitsOnOtherHosts > 0 && (
                <button type="button" className="btn-primary" onClick={() => setSelectedHost(ALL_HOSTS)}>
                  Search all hosts
                </button>
              )}
              {hasActiveFilters && (
                <button type="button" className="btn-ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cockpit-border px-4 sm:px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="label">Rows</span>
            <div className="seg">
              {PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setPageSize(size)}
                  className={`seg-btn ${pageSize === size ? 'seg-btn-on' : ''}`}
                >
                  {size === 0 ? 'All' : size}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-cockpit-muted">
            <span className="tabular-nums">
              {filteredContainers.length === 0
                ? '0 of 0'
                : `${pageStart + 1}–${Math.min(pageStart + effectivePageSize, filteredContainers.length)} of ${filteredContainers.length}`}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="icon-btn disabled:pointer-events-none disabled:opacity-40"
                  title="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-1.5 tabular-nums text-cockpit-text">
                  {currentPage} / {pageCount}
                </span>
                <button
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount}
                  className="icon-btn disabled:pointer-events-none disabled:opacity-40"
                  title="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Host resources: per-host CPU and RAM, collapsed by default on phones */}
      <section className="panel overflow-hidden">
        <button
          type="button"
          onClick={toggleHostCards}
          aria-expanded={showHostCards}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <Server className="h-4 w-4 text-cockpit-accent" />
            <span className="text-[14px] font-bold tracking-tight text-cockpit-text">Host resources</span>
            <span className="pill pill-neutral font-mono text-[10.5px]">{hostNames.length}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-cockpit-muted transition-transform ${showHostCards ? 'rotate-180' : ''}`} />
        </button>

        {showHostCards && (
          <div className="grid grid-cols-1 gap-3.5 border-t border-cockpit-border/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {hostNames.map((host) => {
              const stats = hostStats[host] || { total: 0, running: 0, stopped: 0, problems: 0, totalCpu: 0, totalRamBytes: 0 };
              const isSelected = selectedHost === host;
              const isConnected = snapshot?.dockerHosts?.find((d) => d.name === host)?.connected ?? true;

              // Check if Proxmox has telemetry for this host/LXC
              const rootAllocations = snapshot?.storage?.find((s) => s.allocations)?.allocations || [];
              const lxcAlloc = rootAllocations.find((a) => {
                if (a.type !== 'lxc') return false;
                const cleanHost = host.toLowerCase().replace(/[-_]hosts?$/, '');
                const cleanName = a.name.toLowerCase();
                return cleanName.includes(cleanHost) || (host === 'docker-host' && a.vmid === '100');
              });

              // Approximate host cpu / ram: prefer Proxmox LXC telemetry, fallback to primary dockerHostTelemetry or container sums
              const isPrimary = host === dockerHostTelemetry?.hostname || host === 'docker-host';
              const displayCpu = lxcAlloc?.cpuPercent !== undefined
                ? lxcAlloc.cpuPercent
                : (isPrimary && dockerHostTelemetry ? dockerHostTelemetry.cpuPercent : stats.totalCpu);

              const displayRamUsed = lxcAlloc?.memUsedBytes !== undefined
                ? lxcAlloc.memUsedBytes
                : (isPrimary && dockerHostTelemetry ? dockerHostTelemetry.ramUsedBytes : stats.totalRamBytes);

              const displayRamTotal = lxcAlloc?.memTotalBytes !== undefined
                ? lxcAlloc.memTotalBytes
                : (isPrimary && dockerHostTelemetry ? dockerHostTelemetry.ramTotalBytes : 32 * 1024 * 1024 * 1024);

              const ramPercent = displayRamTotal > 0
                ? Math.min(100, Math.round((displayRamUsed / displayRamTotal) * 100))
                : 0;

              return (
                <button
                  key={host}
                  type="button"
                  onClick={() => setSelectedHost(host)}
                  className={`relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                    isSelected
                      ? 'border-cockpit-accent bg-cockpit-accent/10 shadow-panel ring-1 ring-cockpit-accent/50'
                      : 'border-cockpit-border/80 bg-cockpit-panel/85 hover:border-cockpit-border hover:bg-cockpit-panelHover/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isSelected
                            ? 'border-cockpit-accent/50 bg-cockpit-accent/20 text-cockpit-accent'
                            : 'border-cockpit-border bg-cockpit-bg text-cockpit-muted'
                        }`}
                      >
                        <Server className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[13.5px] text-cockpit-text truncate">{host}</span>
                          <span
                            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                              isConnected ? 'bg-state-good' : 'bg-state-warn'
                            }`}
                            title={isConnected ? 'Connected' : 'Degraded'}
                          />
                        </div>
                        <p className="font-mono text-[11px] text-cockpit-muted">
                          {stats.running} running · {stats.stopped} stopped
                        </p>
                      </div>
                    </div>

                    <span className={`pill text-[10px] ${isSelected ? 'bg-cockpit-accent text-white font-bold' : 'pill-neutral'}`}>
                      {stats.total}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-cockpit-border/60 pt-3 text-[11.5px]">
                    <div>
                      <div className="flex justify-between items-center text-cockpit-muted font-mono text-[11px] mb-1">
                        <span>CPU Usage</span>
                        <span className="text-cockpit-text font-bold">{displayCpu.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border/70">
                        <div
                          className="h-full bg-cockpit-accent rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(2, displayCpu))}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center text-cockpit-muted font-mono text-[11px] mb-1">
                        <span>RAM Usage</span>
                        <span className="text-cockpit-text font-bold">
                          {formatBytes(displayRamUsed)} ({ramPercent}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-cockpit-border/70">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(2, ramPercent))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Fleet Cluster Performance Timeline (Proxmox / Task Manager Style) */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleFleetGraphs}
          aria-expanded={showFleetGraphs}
          className="flex min-h-[40px] w-full items-center justify-between gap-3 px-1 text-left"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cockpit-accent" />
            <span className="text-[14px] font-bold text-cockpit-text tracking-tight">Fleet Cluster Performance</span>
            <span className="pill pill-neutral font-mono text-[10.5px]">
              {containers.filter((c) => c.state === 'running').length} active
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 text-cockpit-muted transition-transform ${showFleetGraphs ? 'rotate-180' : ''}`} />
        </button>

        {showFleetGraphs && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PerformanceGraph
              title="Fleet Aggregate CPU"
              subtitle="Combined container CPU load"
              data={history.map((p) => p.fleetCpu)}
              tone="accent"
              maxScale="auto"
              height={145}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
            />
            <PerformanceGraph
              title="Fleet Aggregate Memory"
              subtitle="Total container RAM footprint"
              data={history.map((p) => p.fleetMemBytes / (1024 * 1024))}
              tone="purple"
              maxScale="auto"
              height={145}
              valueFormatter={(v) => `${v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : v.toFixed(0) + ' MB'}`}
            />
            <PerformanceGraph
              title="Fleet Network I/O"
              subtitle="Inbound RX & Outbound TX"
              data={history.map((p) => p.netRxRate)}
              secondaryData={history.map((p) => p.netTxRate)}
              secondaryLabel="TX"
              tone="cyan"
              secondaryTone="accent"
              maxScale="auto"
              height={145}
              valueFormatter={formatNetworkRate}
              secondaryFormatter={formatNetworkRate}
            />
          </div>
        )}
      </div>
    </div>
  );
};
