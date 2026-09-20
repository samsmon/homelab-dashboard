import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, RefreshCw, Eye, Copy, Check, X } from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { AuditCategory, AuditLevel, AuditLogEntry } from '../types.js';

const POLL_MS = 5000;

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
}> = ({ entry, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!entry) return null;

  const rawJson = JSON.stringify(entry, null, 2);

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
              {entry.message}
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
                {entry.detail}
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

export const LogsPage: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [level, setLevel] = useState<AuditLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const load = () => {
    authFetch('/api/audit-log')
      .then((res) => res.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (level !== 'all' && e.level !== level) return false;
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
  }, [entries, category, level, search]);

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
          className="field w-full max-w-xs"
        />
        <div className="seg">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`seg-btn ${category === c ? 'seg-btn-on' : ''}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="seg">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={`seg-btn ${level === l ? 'seg-btn-on' : ''}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-cockpit-border/50">
        {isLoading && <div className="px-4 py-6 text-center text-[12.5px] text-cockpit-muted">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-[12.5px] text-cockpit-muted">No log entries match this filter.</div>
        )}
        {filtered.slice(0, 500).map((entry) => (
          <div
            key={entry.id}
            onClick={() => setSelectedEntry(entry)}
            className="data-row items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-cockpit-panelHover/60 transition-colors group"
            title="Click to view full log details"
          >
            <span className={`pill ${LEVEL_PILL[entry.level]} shrink-0 mt-0.5`}>{entry.level}</span>
            <span className="label shrink-0 w-20 !normal-case !tracking-normal text-cockpit-muted mt-0.5">{entry.category}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-cockpit-text break-words font-medium">{entry.message}</p>
              {entry.detail && (
                <p className="mt-0.5 font-mono text-[10.5px] text-cockpit-muted line-clamp-2 break-all">{entry.detail}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="metric text-[11px] text-cockpit-muted whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEntry(entry);
                }}
                className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                title="View full log detail"
              >
                <Eye className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedEntry && (
        <LogDetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
};
