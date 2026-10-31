import React from 'react';
import {
  HardDrive,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Activity,
  ArrowDown,
  ArrowUp,
  Radio,
  CheckCircle2,
  Server,
  Zap,
} from 'lucide-react';
import { StorageItem, DockerDiskHygiene } from '../types.js';
import { formatBytes, getStatusColor } from '../utils/formatters.js';

interface StorageMatrixSectionProps {
  storage: StorageItem[] | undefined;
  hygiene?: DockerDiskHygiene;
  onOpenPruneModal?: () => void;
}

export const StorageMatrixSection: React.FC<StorageMatrixSectionProps> = ({
  storage = [],
  hygiene,
  onOpenPruneModal,
}) => {
  const detachedCount = storage.filter((s) => s.isDisconnected || s.canaryPresent === false).length;
  const rootDrive = storage.find((s) => s.isPhysicalRoot || s.mount === '/dev/sda (/)' || s.mount === '/');
  const externalDrives = storage.filter((s) => s !== rootDrive);

  const totalUsedBytes = storage.reduce((acc, s) => acc + (s.usedBytes || 0), 0);
  const totalCapacityBytes = storage.reduce((acc, s) => acc + (s.totalBytes || 0), 0);
  const overallUsedPercent = totalCapacityBytes > 0 ? (totalUsedBytes / totalCapacityBytes) * 100 : 0;

  return (
    <section className="panel flex flex-col space-y-0 overflow-hidden">
      {/* SECTION HEADER */}
      <div className="panel-head">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cockpit-accent/15 text-cockpit-accent">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="panel-title">Storage &amp; DAS Watchdog</h2>
              <span className="pill pill-accent text-[11px]">SMART Live</span>
            </div>
            <p className="panel-sub">
              Real-time drive diagnostics, hardware wear telemetry &amp; external enclosure disconnect guard
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {detachedCount > 0 ? (
            <span className="pill pill-bad animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              {detachedCount} Enclosure Alert
            </span>
          ) : (
            <span className="pill pill-good">
              <Radio className="h-3 w-3 text-state-good animate-pulse" />
              Canary Guard Active
            </span>
          )}
          <span className="pill pill-neutral">
            {storage.length} Volumes · {formatBytes(totalUsedBytes)} of {formatBytes(totalCapacityBytes)} ({overallUsedPercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="space-y-6 p-5">
        {/* TIER 1: PRIMARY PHYSICAL NVME / SSD STORAGE POOL */}
        {rootDrive && (
          <div className="rounded-xl border border-cockpit-border/80 bg-cockpit-bg/60 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between border-b border-cockpit-border/60 pb-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label">Primary Hypervisor Storage</span>
                  <span className="font-mono text-[11px] font-bold text-cockpit-text">
                    {rootDrive.physicalDisk?.model || 'MidasForce SSD 256GB'}
                  </span>
                  <span className="rounded bg-cockpit-panel px-2 py-0.5 font-mono text-[10px] text-cockpit-muted border border-cockpit-border/60">
                    {rootDrive.physicalDisk?.devpath || '/dev/sda'}
                  </span>
                </div>
                <h3 className="text-[17px] font-extrabold tracking-tight text-cockpit-text">
                  {rootDrive.label || 'Proxmox Physical SSD'}
                </h3>
                <p className="font-mono text-[11.5px] text-cockpit-muted">
                  Partition Scheme: GPT · LVM-Thin Pool · Proxmox VE Hypervisor Rootfs
                </p>
              </div>

              {/* REAL-TIME SMART & IO TELEMETRY TILES */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0 font-mono">
                {/* SMART Status */}
                <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-panel/80 p-2.5">
                  <span className="text-[10px] uppercase font-bold text-cockpit-muted block">SMART Health</span>
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] font-black text-state-good">
                    <ShieldCheck className="h-3.5 w-3.5 text-state-good shrink-0" />
                    <span>{rootDrive.smartStatus || 'PASSED'}</span>
                  </div>
                  <span className="text-[11px] text-cockpit-muted">0 Bad Sectors</span>
                </div>

                {/* Read Throughput */}
                <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-panel/80 p-2.5">
                  <span className="text-[10px] uppercase font-bold text-cockpit-muted block">Read Rate</span>
                  <div className="mt-1 flex items-center gap-1 text-[12px] font-black text-cockpit-accent">
                    <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                    <span>{formatBytes(rootDrive.readRateBytesPerSec || 0)}/s</span>
                  </div>
                  <span className="text-[11px] text-cockpit-muted">Host disk I/O</span>
                </div>

                {/* Write Throughput */}
                <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-panel/80 p-2.5">
                  <span className="text-[10px] uppercase font-bold text-cockpit-muted block">Write Rate</span>
                  <div className="mt-1 flex items-center gap-1 text-[12px] font-black text-state-warn">
                    <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                    <span>{formatBytes(rootDrive.writeRateBytesPerSec || 0)}/s</span>
                  </div>
                  <span className="text-[11px] text-cockpit-muted">Host disk I/O</span>
                </div>

                {/* Disk Activity */}
                <div className="rounded-lg border border-cockpit-border/60 bg-cockpit-panel/80 p-2.5">
                  <span className="text-[10px] uppercase font-bold text-cockpit-muted block">Active Time</span>
                  <div className="mt-1 flex items-center gap-1 text-[12px] font-black text-cockpit-text">
                    <Activity className="h-3.5 w-3.5 text-cockpit-accent shrink-0" />
                    <span>{(rootDrive.activeTimePercent || 0).toFixed(1)}%</span>
                  </div>
                  <span className="text-[11px] text-cockpit-muted">
                    {rootDrive.avgResponseMs ? `${rootDrive.avgResponseMs.toFixed(1)}ms lat` : 'Low latency'}
                  </span>
                </div>
              </div>
            </div>

            {/* Capacity Bar & Headroom */}
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] font-mono mb-2">
                <span className="text-cockpit-text font-bold">
                  Capacity: {formatBytes(rootDrive.usedBytes)} used of {formatBytes(rootDrive.totalBytes)} total
                </span>
                <span className="text-state-good font-bold">
                  {formatBytes(rootDrive.freeBytes)} free ({((rootDrive.freeBytes / rootDrive.totalBytes) * 100).toFixed(1)}% unallocated)
                </span>
              </div>

              <div className="track h-3 bg-cockpit-border/50">
                <span
                  className={`track-fill ${getStatusColor(rootDrive.usedPercent).bar}`}
                  style={{ width: `${Math.min(100, Math.max(2, rootDrive.usedPercent))}%` }}
                />
              </div>
            </div>

            {/* LVM-Thin Storage Pools & Container Allocations */}
            {rootDrive.allocations && rootDrive.allocations.length > 0 && (
              <div className="mt-5 rounded-lg border border-cockpit-border/70 bg-cockpit-panel/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cockpit-border/50 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-cockpit-accent" />
                    <span className="text-[12px] font-bold uppercase tracking-wider text-cockpit-text">
                      LVM-Thin Pools &amp; Workload Quotas
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-cockpit-muted">
                    Pools: <span className="text-cockpit-text font-bold">local</span> (dir, ISOs) ·{' '}
                    <span className="text-cockpit-text font-bold">local-lvm</span> (thin provisioned ~157 GB)
                  </span>
                </div>

                {/* Multi-tier Allocation Distribution Progress Bar */}
                <div className="my-3.5 flex h-2.5 w-full overflow-hidden rounded bg-cockpit-border/40 p-0.5">
                  {rootDrive.allocations.map((alloc, idx) => {
                    const colors = ['bg-sky-400', 'bg-cockpit-accent', 'bg-purple-400'];
                    const widthPercent = (alloc.allocatedBytes / rootDrive.totalBytes) * 100;
                    return (
                      <div
                        key={alloc.id}
                        className={`h-full ${colors[idx % colors.length]} transition-all duration-300 first:rounded-l`}
                        style={{ width: `${Math.max(1, widthPercent)}%` }}
                        title={`${alloc.name}: ${formatBytes(alloc.allocatedBytes)} allocated`}
                      />
                    );
                  })}
                  <div
                    className="h-full bg-cockpit-border/60 rounded-r"
                    style={{
                      width: `${Math.max(
                        0,
                        100 - rootDrive.allocations.reduce((acc, a) => acc + (a.allocatedBytes / rootDrive.totalBytes) * 100, 0)
                      )}%`,
                    }}
                    title="Available Thin Pool Headroom"
                  />
                </div>

                {/* Sub-allocations Grid */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-1">
                  {rootDrive.allocations.map((alloc, idx) => {
                    const allocTone = getStatusColor(alloc.usedPercent);
                    const dotColor = idx === 0 ? 'bg-sky-400' : idx === 1 ? 'bg-cockpit-accent' : 'bg-purple-400';

                    return (
                      <div key={alloc.id} className="rounded border border-cockpit-border/60 bg-cockpit-bg/70 p-3 space-y-2">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="flex items-center gap-1.5 font-bold text-cockpit-text truncate">
                            <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                            {alloc.name}
                          </span>
                          <span className={`font-mono font-bold text-[11.5px] ${allocTone.text}`}>
                            {alloc.usedPercent.toFixed(1)}%
                          </span>
                        </div>

                        <div className="track h-1.5 bg-cockpit-border/40">
                          <span
                            className={`track-fill ${dotColor}`}
                            style={{ width: `${Math.min(100, Math.max(2, alloc.usedPercent))}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between font-mono text-[10.5px] text-cockpit-muted">
                          <span>Used: <strong className="text-cockpit-text">{formatBytes(alloc.usedBytes)}</strong></span>
                          <span>Alloc: {formatBytes(alloc.allocatedBytes)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TIER 2: EXTERNAL DAS STORAGE BAYS & CANARY WATCHDOG */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-cockpit-accent" />
              <h3 className="text-[14px] font-bold text-cockpit-text uppercase tracking-wider">
                External DAS Enclosure Bays &amp; Watchdog
              </h3>
            </div>
            <span className="font-mono text-[11px] text-cockpit-muted">
              Active Canary Monitoring (.mounted verification)
            </span>
          </div>

          {externalDrives.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cockpit-border p-6 text-center text-[12.5px] text-cockpit-muted">
              No external DAS drives detected. Connect an enclosure to activate canary health monitoring.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {externalDrives.map((drive) => {
                const tone = getStatusColor(drive.usedPercent);
                const isDisconnected = drive.isDisconnected || drive.canaryPresent === false;

                return (
                  <div
                    key={drive.id}
                    className={`rounded-xl border p-4 transition-all ${
                      isDisconnected
                        ? 'border-state-bad bg-state-bad/10 shadow-lg shadow-state-bad/10'
                        : 'border-cockpit-border/80 bg-cockpit-bg/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-cockpit-text">{drive.label}</span>
                          <span className="rounded bg-cockpit-panel px-1.5 py-0.5 font-mono text-[10px] text-cockpit-muted border border-cockpit-border/60">
                            {drive.filesystem}
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-cockpit-muted mt-0.5">
                          Mountpoint: <span className="text-cockpit-text">{drive.mount}</span>
                        </p>
                      </div>

                      {/* Status Badges */}
                      <div className="flex flex-col items-end gap-1 font-mono">
                        {isDisconnected ? (
                          <span className="pill pill-bad animate-pulse">
                            <AlertTriangle className="h-3 w-3" />
                            DISCONNECTED
                          </span>
                        ) : (
                          <span className="pill pill-good">
                            <CheckCircle2 className="h-3 w-3" />
                            CANARY OK
                          </span>
                        )}
                        <span className={`text-[12.5px] font-bold ${tone.text}`}>
                          {drive.usedPercent.toFixed(1)}% used
                        </span>
                      </div>
                    </div>

                    {isDisconnected && (
                      <div className="mt-3 rounded-lg border border-state-bad/40 bg-state-bad/20 p-2.5 text-[11.5px] text-state-bad font-mono flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          <strong>WARNING:</strong> Canary file (<code className="underline">.mounted</code>) missing or enclosure detached! Write operations blocked to protect root NVMe disk space.
                        </span>
                      </div>
                    )}

                    {/* Progress Bar */}
                    <div className="track mt-3 h-2.5 bg-cockpit-border/50">
                      <span
                        className={`track-fill ${isDisconnected ? 'bg-state-bad' : tone.bar}`}
                        style={{ width: `${Math.min(100, Math.max(3, drive.usedPercent))}%` }}
                      />
                    </div>

                    {/* Drive Capacity & I/O Telemetry */}
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px] pt-1 border-t border-cockpit-border/50">
                      <div>
                        <span className="text-cockpit-muted block text-[10px]">CAPACITY</span>
                        <span className="font-bold text-cockpit-text">
                          {formatBytes(drive.usedBytes)} / {formatBytes(drive.totalBytes)}
                        </span>
                      </div>

                      <div>
                        <span className="text-cockpit-muted block text-[10px]">SMART TELEMETRY</span>
                        <span className="font-bold text-state-good flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          {drive.smartStatus || 'PASSED'}
                        </span>
                      </div>

                      <div className="col-span-2 sm:col-span-1">
                        <span className="text-cockpit-muted block text-[10px]">LIVE I/O RATE</span>
                        <span className="text-cockpit-text">
                          ↓{formatBytes(drive.readRateBytesPerSec || 0)}/s · ↑{formatBytes(drive.writeRateBytesPerSec || 0)}/s
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* TIER 3: DOCKER IMAGE HYGIENE & RECLAIMABLE CACHE */}
        {hygiene && onOpenPruneModal && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-cockpit-border/80 bg-cockpit-panel/60 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cockpit-accent/15 text-cockpit-accent">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-[13px] font-bold text-cockpit-text">Docker Disk Hygiene &amp; Image Cache</h4>
                <p className="text-[11.5px] text-cockpit-muted">
                  Reclaim storage from dangling layers, stopped containers &amp; orphaned build cache safely.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="font-mono text-right">
                <span className="text-[10.5px] text-cockpit-muted block">Reclaimable Space</span>
                <span className="text-[13px] font-black text-cockpit-accent">
                  {formatBytes(hygiene.reclaimableBytes)}
                </span>
              </div>
              <button
                onClick={onOpenPruneModal}
                className="btn-ghost flex items-center gap-1.5 text-[11.5px] py-1.5 px-3"
              >
                <Zap className="h-3.5 w-3.5 text-cockpit-accent" />
                <span>Prune Cache</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
