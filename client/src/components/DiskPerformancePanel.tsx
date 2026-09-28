import React, { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { StorageItem } from '../types.js';
import { formatBytes, formatNetworkRate } from '../utils/formatters.js';
import { PerformanceGraph } from './PerformanceGraph.js';

interface DiskPerformancePanelProps {
  storage: StorageItem[] | undefined;
}

export const DiskPerformancePanel: React.FC<DiskPerformancePanelProps> = ({ storage = [] }) => {
  const [selectedId, setSelectedId] = useState<string | null>(storage[0]?.id ?? null);

  useEffect(() => {
    if (!selectedId && storage.length > 0) {
      setSelectedId(storage[0].id);
      return;
    }
    if (selectedId && !storage.some((s) => s.id === selectedId) && storage.length > 0) {
      setSelectedId(storage[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage.length]);

  if (storage.length === 0) {
    return (
      <section className="panel flex flex-col">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Disk performance</h2>
            <p className="panel-sub">Live throughput and active time per volume</p>
          </div>
        </div>
        <p className="px-5 py-10 text-center text-[13px] text-cockpit-muted">No volumes configured.</p>
      </section>
    );
  }

  const selected = storage.find((s) => s.id === selectedId) ?? storage[0];
  const hasData = selected.activeTimePercent !== undefined;

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Disk performance</h2>
          <p className="panel-sub">Live throughput and active time, internal and external</p>
        </div>
        <span className="pill pill-neutral">{storage.length} volumes</span>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pt-4">
        <div className="seg flex-wrap">
          {storage.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              title={item.mount}
              className={`seg-btn flex items-center gap-1.5 ${selectedId === item.id ? 'seg-btn-on' : ''}`}
            >
              <HardDrive className="h-3 w-3" />
              {item.label}
              {item.isExternal && <span className="text-[9px] uppercase text-cockpit-muted">ext</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {!hasData ? (
          <p className="rounded-lg border border-cockpit-border bg-cockpit-bg px-4 py-8 text-center text-[13px] text-cockpit-muted">
            Performance data isn't available for {selected.label}. This reads /proc/diskstats directly, which
            exists only on a Linux host, and can't resolve a device behind LVM or device-mapper.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="label">Active time</p>
                <p className="metric-lg">
                  {(selected.activeTimePercent ?? 0).toFixed(0)}
                  <span className="metric-unit">%</span>
                </p>
              </div>
              <div>
                <p className="label">Avg response</p>
                <p className="metric-lg">
                  {(selected.avgResponseMs ?? 0).toFixed(1)}
                  <span className="metric-unit">ms</span>
                </p>
              </div>
              <div>
                <p className="label">Read speed</p>
                <p className="metric-lg">{formatNetworkRate(selected.readRateBytesPerSec ?? 0)}</p>
              </div>
              <div>
                <p className="label">Write speed</p>
                <p className="metric-lg">{formatNetworkRate(selected.writeRateBytesPerSec ?? 0)}</p>
              </div>
            </div>

            <div>
              <PerformanceGraph
                title={`${selected.label} Active Time History`}
                subtitle={`${selected.mount} · Windows Task Manager Grid`}
                data={selected.sparklineActiveTime ?? []}
                tone="warn"
                maxScale={100}
                height={200}
                valueFormatter={(v) => `${v.toFixed(0)}%`}
              />
            </div>

            <p className="font-mono text-[11px] text-cockpit-muted">
              {selected.mount} &middot; {formatBytes(selected.usedBytes)} used of {formatBytes(selected.totalBytes)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
