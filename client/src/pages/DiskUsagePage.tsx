import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, HardDrive, Loader2, ScanSearch } from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { formatBytes } from '../utils/formatters.js';
import { Treemap } from '../components/Treemap.js';
import { DiskScanState, DiskScanTarget, DiskTreeNode } from '../types.js';

// Only polls the status endpoint while a scan THIS PAGE just triggered is
// actively running, and stops the moment it finishes or errors - never a
// standing interval. Manual trigger only (the "Scan" button), per the
// lesson in CHANGELOG.md (2026-09-15 #3): constant background polling of
// containers spiked host CPU to 65% for no real benefit. This is the
// opposite pattern - zero cost until the owner explicitly asks for a scan.
const SCAN_POLL_MS = 3000;

function findNodeByPath(root: DiskTreeNode, targetPath: string): DiskTreeNode | null {
  if (root.path === targetPath) return root;
  for (const child of root.children) {
    if (child.type !== 'dir') continue;
    if (targetPath === child.path || targetPath.startsWith(`${child.path}/`)) {
      const found = findNodeByPath(child, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export const DiskUsagePage: React.FC = () => {
  const [targets, setTargets] = useState<DiskScanTarget[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [scanState, setScanState] = useState<DiskScanState>({ status: 'idle' });
  const [tree, setTree] = useState<DiskTreeNode | null>(null);
  const [cursorPath, setCursorPath] = useState<string[]>([]); // breadcrumb of node.path segments from root
  const [dims, setDims] = useState({ width: 800, height: 480 });
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    authFetch('/api/disk-scan/targets')
      .then((r) => r.json())
      .then((data) => {
        setTargets(data.targets ?? []);
        if (data.targets?.length) setSelectedId(data.targets[0].id);
      })
      .catch(() => {});
  }, []);

  const loadStatus = useCallback(async (id: string) => {
    const res = await authFetch(`/api/disk-scan/${id}/status`);
    const state: DiskScanState = await res.json();
    setScanState(state);
    return state;
  }, []);

  const loadTree = useCallback(async (id: string) => {
    const res = await authFetch(`/api/disk-scan/${id}/tree`);
    if (!res.ok) return;
    const data: DiskTreeNode = await res.json();
    setTree(data);
    setCursorPath([data.path]);
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  // Switching targets: show whatever's cached for that mount (if any), no
  // scan triggered automatically.
  useEffect(() => {
    if (!selectedId) return;
    stopPolling();
    setTree(null);
    setCursorPath([]);
    loadStatus(selectedId).then((state) => {
      if (state.status === 'done') {
        loadTree(selectedId);
      } else if (state.status === 'running') {
        beginPolling(selectedId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const beginPolling = (id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const state = await loadStatus(id);
      if (state.status === 'done') {
        stopPolling();
        loadTree(id);
      } else if (state.status === 'error') {
        stopPolling();
      }
    }, SCAN_POLL_MS);
  };

  const handleScan = async () => {
    if (!selectedId) return;
    const res = await authFetch(`/api/disk-scan/${selectedId}/start`, { method: 'POST' });
    const state: DiskScanState = await res.json();
    setScanState(state);
    if (state.status === 'running') {
      beginPolling(selectedId);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDims({ width: entry.contentRect.width, height: Math.max(360, entry.contentRect.height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const currentPath = cursorPath[cursorPath.length - 1];
  const currentNode = tree && currentPath ? findNodeByPath(tree, currentPath) : null;
  const currentChildren = currentNode?.children.filter((c) => c.sizeBytes > 0) ?? [];

  const handleDrillDown = (node: DiskTreeNode) => {
    if (node.type !== 'dir') return;
    setCursorPath((prev) => [...prev, node.path]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setCursorPath((prev) => prev.slice(0, index + 1));
  };

  const isRunning = scanState.status === 'running';

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="panel-title">Disk usage explorer</h2>
          <p className="panel-sub">
            Manual, on-demand scan per drive — no background polling. Pick a target, hit Scan, then drill into folders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={isRunning}
            className="rounded-md border border-cockpit-border bg-cockpit-panel px-2.5 py-1.5 text-[12.5px] text-cockpit-text disabled:opacity-40"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.mount})
              </option>
            ))}
          </select>
          <button
            onClick={handleScan}
            disabled={isRunning || !selectedId}
            className="btn-primary inline-flex items-center gap-2 text-[12px] font-medium disabled:opacity-40"
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            {isRunning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
      </div>

      <div className="px-5 py-3">
        {scanState.status === 'idle' && !tree && (
          <p className="py-10 text-center text-[13px] text-cockpit-muted">
            No scan yet for this target. Click Scan to walk the directory tree — a full pass over a spinning HDD can
            take a few minutes, that's expected.
          </p>
        )}

        {scanState.status === 'running' && (
          <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-cockpit-muted">
            <Loader2 className="h-4 w-4 animate-spin text-cockpit-accent" />
            Scanning{scanState.queuePosition ? ` (queued, position ${scanState.queuePosition})` : '…'} — this runs
            single-threaded per drive so it doesn't stress a possibly-flaky enclosure.
          </p>
        )}

        {scanState.status === 'error' && (
          <p className="py-10 text-center text-[13px] text-state-bad">
            Scan failed: {scanState.error}
          </p>
        )}

        {tree && currentNode && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[11.5px] text-cockpit-muted">
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
              {cursorPath.map((p, i) => {
                const node = findNodeByPath(tree, p);
                return (
                  <React.Fragment key={p}>
                    {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                    <button
                      onClick={() => handleBreadcrumbClick(i)}
                      className={`truncate hover:text-cockpit-accent ${i === cursorPath.length - 1 ? 'font-bold text-cockpit-text' : ''}`}
                    >
                      {node?.name ?? p}
                    </button>
                  </React.Fragment>
                );
              })}
              <span className="ml-auto shrink-0 text-cockpit-muted">
                {formatBytes(currentNode.sizeBytes)} · {currentNode.fileCount} files
                {scanState.scannedAt && ` · scanned ${new Date(scanState.scannedAt).toLocaleString()}`}
              </span>
            </div>

            <div ref={containerRef} className="h-[480px] w-full overflow-hidden rounded-md border border-cockpit-border">
              {currentChildren.length > 0 ? (
                <Treemap nodes={currentChildren} width={dims.width} height={dims.height} onDrillDown={handleDrillDown} />
              ) : (
                <p className="flex h-full items-center justify-center text-[13px] text-cockpit-muted">Empty folder</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
