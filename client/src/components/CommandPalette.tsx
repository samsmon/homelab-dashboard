import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Pin, X } from 'lucide-react';
import { ContainerMetric } from '../types.js';
import { redactText } from '../utils/formatters.js';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  containers?: ContainerMetric[];
  isPrivacyMode?: boolean;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  run: () => void;
}

const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/fleet', label: 'Fleet' },
  { path: '/infra', label: 'Infra' },
  { path: '/git-projects', label: 'Git projects' },
  { path: '/processes', label: 'Processes' },
  { path: '/terminal', label: 'Terminal' },
  { path: '/sentinel', label: 'Sentinel' },
  { path: '/ai-agents', label: 'AI Agents' },
  { path: '/logs', label: 'Logs' },
  { path: '/disk-usage', label: 'Disk usage' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  containers = [],
  isPrivacyMode = false,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const pageItems: PaletteItem[] = PAGES.map((p) => {
      return {
        id: `page-${p.path}`,
        group: 'Pages',
        label: p.label,
        icon: <ArrowRight className="h-3.5 w-3.5" />,
        run: () => navigate(p.path),
      };
    });

    const pinnedItems: PaletteItem[] = containers
      .filter((c) => c.isPinned)
      .map((c) => {
        const url = c.publicUrl || c.tailscaleUrl || c.lanUrl;
        return {
          id: `container-${c.id}`,
          group: 'Pinned containers',
          label: c.name,
          sublabel: url ? redactText(url, isPrivacyMode) : 'No reachable URL — pin it with a LAN/Tailscale port',
          icon: <Pin className="h-3.5 w-3.5 fill-current" />,
          run: () => {
            if (url) window.open(url, '_blank', 'noreferrer');
          },
        };
      });

    return [...pageItems, ...pinnedItems];
  }, [containers, isPrivacyMode, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) => item.label.toLowerCase().includes(q) || item.sublabel?.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!isOpen) return null;

  const activate = (item: PaletteItem) => {
    item.run();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selected]) {
        activate(filtered[selected]);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 p-4 pt-16 sm:pt-24 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-cockpit-border bg-cockpit-panel shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-cockpit-border px-3.5 py-2.5">
          <Search className="h-4 w-4 text-cockpit-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or jump to page…"
            className="flex-1 bg-transparent font-sans text-[13px] text-cockpit-text placeholder:text-cockpit-muted focus:outline-none"
          />
          <kbd className="rounded border border-cockpit-border px-1.5 py-0.5 font-mono text-[10px] text-cockpit-muted">
            ESC
          </kbd>
          <button onClick={onClose} className="text-cockpit-muted hover:text-cockpit-text ml-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-[12.5px] text-cockpit-muted">No commands match &ldquo;{query}&rdquo;</div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selected;
              return (
                <button
                  key={item.id}
                  onClick={() => activate(item)}
                  onMouseEnter={() => setSelected(index)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${
                    isSelected
                      ? 'bg-cockpit-accent/15 text-cockpit-accent'
                      : 'text-cockpit-text hover:bg-cockpit-panelHover'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0 text-cockpit-muted">{item.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.label}</div>
                      {item.sublabel && (
                        <div className="text-[11px] text-cockpit-muted truncate">{item.sublabel}</div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10.5px] font-mono text-cockpit-muted uppercase tracking-wider shrink-0 ml-2">
                    {item.group}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
