import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, RefreshCw, Copy, Check, X, Download } from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { AuditCategory, AuditLevel, AuditLogEntry } from '../types.js';
import { StateBlock } from '../components/StateBlock.js';
import { redactFreeText } from '../utils/formatters.js';

const POLL_MS = 5000;
const PAGE_SIZE = 50;

const CATEGORIES: (AuditCategory | 'all')[] = [
  'all',
  'auth',
  'pin',
  'bookmark',
  'container',
  'git',
  'backup',
  'config',
  'app-update',
  'system',
  'storage',
];

const LEVELS: (AuditLevel | 'all')[] = ['all', 'info', 'warn', 'error'];

const LEVEL_PILL: Record<AuditLevel, string> = {
  info: 'pill-neutral',
  warn: 'pill-warn',
  error: 'pill-bad',
};

const LogDetailModal: React.FC<{
  entry: AuditLogEntry | null;
  onClose: () => void;
  isPrivacyMode: boolean;
}> = ({ entry, onClose, isPrivacyMode }) => {
  const [copied, setCopied] = useState(false);

  if (!entry) return null;

  const rawJson = redactFreeText(JSON.stringify(entry, null, 2), isPrivacyMode);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className="overlay">
      <div className="panel modal-panel flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl shadow-black/50">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <span className={`pill ${LEVEL_PILL[entry.level]}`}>{entry.level}</span>
            <span className="label !normal-case !tracking-normal font-semibold text-cockpit-muted">
              {entry.category}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyToClipboard} className="icon-btn" title="Copy raw JSON">
              {copied ? <Check className="h-4 w-4 animate-popIn text-state-good" /> : <Copy className="h-4 w-4" />}
            </button>
            <button onClick={onClose} className="icon-btn" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5 text-[12.5px]">
          <div>
            <span className="label block mb-1">Message</span>
            <p className="rounded-lg border border-cockpit-border/60 bg-cockpit-bg/80 p-3 font-medium text-cockpit-text break-words">
              {redactFreeText(entry.message, isPrivacyMode)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11.5px] font-mono">
            <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-bg/60 p-2.5">
              <span className="label text-[10px] block mb-0.5">Timestamp</span>
              <span className="text-cockpit-text">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-bg/60 p-2.5">
              <span className="label text-[10px] block mb-0.5">Actor</span>
              <span className="text-cockpit-text">{entry.actor || 'system'}</span>
            </div>
          </div>

          {entry.detail && (
            <div>
              <span className="label block mb-1">Full Detail</span>
              <pre className="max-h-64 overflow-y-auto rounded-lg border border-cockpit-border/70 bg-black/70 p-3 font-mono text-[11.5px] leading-relaxed text-cockpit-text whitespace-pre-wrap break-all">
                {redactFreeText(entry.detail, isPrivacyMode)}
              </pre>
            </div>
          )}

          <div>
            <span className="label block mb-1">Raw Payload</span>
            <pre className="max-h-48 overflow-y-auto rounded-lg border border-cockpit-border/60 bg-cockpit-bg p-3 font-mono text-[11px] leading-relaxed text-cockpit-muted whitespace-pre-wrap break-all">
              {rawJson}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-cockpit-border/60 px-5 py-2.5 font-mono text-[11px] text-cockpit-muted">
          <span>Log ID: {entry.id}</span>
          <button onClick={onClose} className="btn-ghost py-1 px-2.5 text-[11.5px]">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const formatTime = (iso: string | number, compact: boolean): string =>
  compact
    ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(iso).toLocaleString();

export const LogsPage: React.FC<{ isPrivacyMode?: boolean }> = ({ isPrivacyMode = false }) => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [level, setLevel] = useState<AuditLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    authFetch('/api/audit-log')
      .then((res) => res.json())
      .then((data) => {
        setEntries(Array.isArray(data) ? data : []);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // A new filter starts again from the newest page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [category, level, search, actor, from, to]);

  const actors = useMemo(() => [...new Set(entries.map((e) => e.actor || 'system'))].sort(), [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return entries.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (level !== 'all' && e.level !== level) return false;
      if (actor && (e.actor || 'system') !== actor) return false;
      if (fromMs !== null && e.createdAt < fromMs) return false;
      if (toMs !== null && e.createdAt > toMs) return false;
      if (
        q &&
        !e.message.toLowerCase().includes(q) &&
        !(e.actor || '').toLowerCase().includes(q) &&
        !(e.detail || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, category, level, search, actor, from, to]);

  const hasFilters = category !== 'all' || level !== 'all' || search !== '' || actor !== '' || from !== '' || to !== '';
  const clearFilters = () => {
    setCategory('all');
    setLevel('all');
    setSearch('');
    setActor('');
    setFrom('');
    setTo('');
  };

  // Exports honor privacy mode, so a shared export never carries IPs or hostnames the screen hides.
  const download = (name: string, type: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportRows = () =>
    filtered.map((e) => ({
      time: new Date(e.createdAt).toISOString(),
      level: e.level,
      category: e.category,
      actor: e.actor || 'system',
      message: redactFreeText(e.message, isPrivacyMode),
      detail: redactFreeText(e.detail || '', isPrivacyMode),
    }));
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportJson = () => download(`audit-log-${stamp()}.json`, 'application/json', JSON.stringify(exportRows(), null, 2));
  const exportCsv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = exportRows();
    const lines = ['time,level,category,actor,message,detail', ...rows.map((r) => [r.time, r.level, r.category, r.actor, r.message, r.detail].map(cell).join(','))];
    download(`audit-log-${stamp()}.csv`, 'text/csv', lines.join('\n'));
  };

  const visible = filtered.slice(0, visibleCount);

  const clear = async () => {
    if (!window.confirm('Clear the entire audit log? This cannot be undone.')) return;
    await authFetch('/api/audit-log/clear', { method: 'POST' });
    load();
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">System log</h2>
          <p className="panel-sub">Every state-changing action and error, in one place — auth, pins, containers, git, backup, config.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="icon-btn" title="Refresh now">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={clear} className="btn-danger flex items-center gap-1.5 text-[11.5px] py-1.5 px-2.5" title="Clear log">
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-cockpit-border/60 px-4 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, actor, or detail…"
          aria-label="Search log"
          className="field w-full sm:max-w-xs"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as AuditCategory | 'all')}
          aria-label="Category"
          className="field min-w-0 flex-1 sm:flex-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
        <div className="seg">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={`seg-btn ${level === l ? 'seg-btn-on' : ''}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-cockpit-border/60 px-4 py-3">
        <label className="flex items-center gap-1.5 text-[11.5px] text-cockpit-muted">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="field" aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-[11.5px] text-cockpit-muted">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="field" aria-label="To date" />
        </label>
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor" className="field min-w-0">
          <option value="">All actors</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="btn-ghost text-[12px]">
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportCsv} disabled={filtered.length === 0} className="btn-ghost inline-flex items-center gap-1.5 text-[12px] disabled:opacity-40" title="Download the filtered entries as CSV">
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button onClick={exportJson} disabled={filtered.length === 0} className="btn-ghost inline-flex items-center gap-1.5 text-[12px] disabled:opacity-40" title="Download the filtered entries as JSON">
            <Download className="h-3.5 w-3.5" />
            JSON
          </button>
        </div>
      </div>

      <div className="divide-y divide-cockpit-border/50">
        {isLoading && <StateBlock kind="loading" />}
        {!isLoading && loadError && entries.length === 0 && (
          <StateBlock kind="error" title="Could not load the log" message="The server did not answer." onRetry={load} />
        )}
        {!isLoading && !loadError && filtered.length === 0 && (
          <StateBlock
            kind="empty"
            title={entries.length === 0 ? 'The log is empty' : 'No entries match'}
            message={entries.length === 0 ? 'Actions and errors will show up here as they happen.' : 'Try a different search, category or level.'}
          />
        )}
        {visible.map((entry) => (
          <div
            key={entry.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedEntry(entry)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedEntry(entry);
              }
            }}
            className="flex cursor-pointer flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-cockpit-panelHover/60 focus-visible:bg-cockpit-panelHover/60 focus-visible:outline-none sm:flex-row sm:items-start sm:gap-3"
            title="Click to view full log details"
          >
            <div className="flex items-center gap-2 sm:contents">
              <span className={`pill ${LEVEL_PILL[entry.level]} shrink-0 sm:mt-0.5`}>{entry.level}</span>
              <span className="label shrink-0 !normal-case !tracking-normal text-cockpit-muted sm:mt-0.5 sm:w-20">{entry.category}</span>
              <span className="metric ml-auto whitespace-nowrap text-[11px] text-cockpit-muted sm:hidden">
                {formatTime(entry.createdAt, true)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-[12.5px] font-medium text-cockpit-text">{redactFreeText(entry.message, isPrivacyMode)}</p>
              {entry.detail && (
                <p className="mt-0.5 line-clamp-2 break-all font-mono text-[11px] text-cockpit-muted">{redactFreeText(entry.detail, isPrivacyMode)}</p>
              )}
            </div>
            <span className="metric hidden shrink-0 whitespace-nowrap text-[11px] text-cockpit-muted sm:block">
              {formatTime(entry.createdAt, false)}
            </span>
          </div>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cockpit-border/60 px-4 py-3 text-[11.5px] text-cockpit-muted">
          <span>
            Showing {visible.length} of {filtered.length}
          </span>
          {visible.length < filtered.length && (
            <div className="flex gap-2">
              <button onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="btn-ghost text-[12px]">
                Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
              </button>
              <button onClick={() => setVisibleCount(filtered.length)} className="btn-ghost text-[12px]">
                Show all
              </button>
            </div>
          )}
        </div>
      )}

      {selectedEntry && (
        <LogDetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} isPrivacyMode={isPrivacyMode} />
      )}
    </div>
  );
};
