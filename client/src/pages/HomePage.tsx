import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Activity } from 'lucide-react';
import { CockpitSnapshot } from '../types.js';
import { redactText, formatBytes, formatNetworkRate } from '../utils/formatters.js';
import { HostSummaryTiles } from '../components/HostSummaryTiles.js';
import { AppUpdateBanner } from '../components/AppUpdateBanner.js';
import { BookmarksSection } from '../components/BookmarksSection.js';
import { PerformanceGraph } from '../components/PerformanceGraph.js';
import { useMetricHistory } from '../context/MetricHistoryContext.js';

interface HomePageProps {
  snapshot: CockpitSnapshot | null;
  throughput: { rx: number; tx: number };
  isPrivacyMode: boolean;
}

export const HomePage: React.FC<HomePageProps> = ({ snapshot, throughput, isPrivacyMode }) => {
  const { history } = useMetricHistory();
  const [selectedMetricTab, setSelectedMetricTab] = useState<'grid' | 'cpu' | 'memory' | 'network' | 'disk'>('grid');

  const runningCount = snapshot?.containers.filter((c) => c.state === 'running').length ?? 0;
  const totalCount = snapshot?.containers.length ?? 0;
  const pinnedCount = snapshot?.containers.filter((c) => c.isPinned).length ?? 0;
  const pve = snapshot?.host.pve;
  const dockerHost = snapshot?.host.dockerHost;
  const physicalDrive = snapshot?.storage.find((s) => s.isPhysicalRoot);

  const [cachedNodeName, setCachedNodeName] = React.useState<string | null>(() => {
    return localStorage.getItem('cockpit_primary_node_name');
  });

  React.useEffect(() => {
    const handleNodeUpdate = () => {
      setCachedNodeName(localStorage.getItem('cockpit_primary_node_name'));
    };
    window.addEventListener('cockpit_settings_updated', handleNodeUpdate);
    return () => window.removeEventListener('cockpit_settings_updated', handleNodeUpdate);
  }, []);

  const displayNodeName = cachedNodeName || pve?.nodeName || 'Homelab node';

  // History datasets
  const cpuData = history.map((p) => p.pveCpu);
  const dockerCpuData = history.map((p) => p.dockerCpu);
  const ramData = history.map((p) => p.pveRam);
  const netRxData = history.map((p) => p.netRxRate);
  const netTxData = history.map((p) => p.netTxRate);
  const diskActiveData = history.map((p) => p.diskActiveTime);

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Homelab Dashboard update banner at the very top */}
      <AppUpdateBanner />

      <section className="panel px-5 py-4">
        <p className="label">This machine</p>
        <h1 className="mt-1 text-[19px] font-extrabold tracking-tight text-cockpit-text">
          {displayNodeName}
        </h1>
        <p className="mt-1 font-mono text-[12px] text-cockpit-muted">
          {pve ? `${pve.cpuModel || `${pve.cpuCores} cores`} · ${formatBytes(dockerHost?.ramTotalBytes ?? 0)} RAM · ` : ''}
          Proxmox VE {redactText(pve?.ip || '—', isPrivacyMode)} · Docker {dockerHost?.hostname || 'host'}{' '}
          {redactText(dockerHost?.ip || '—', isPrivacyMode)}
        </p>
      </section>

      {/* Host Summary Tiles with live waveforms */}
      <HostSummaryTiles host={snapshot?.host} throughput={throughput} />

      {/* Real-time Proxmox & Task Manager Style Performance Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cockpit-accent" />
            <h2 className="text-[14px] font-bold text-cockpit-text tracking-tight">
              Host Performance Timeline
            </h2>
            <span className="pill pill-neutral font-mono text-[10.5px]">
              Task Manager &amp; Proxmox Summary
            </span>
          </div>

          {/* View selector tabs */}
          <div className="seg">
            <button
              onClick={() => setSelectedMetricTab('grid')}
              className={`seg-btn ${selectedMetricTab === 'grid' ? 'seg-btn-on' : ''}`}
            >
              All (Grid)
            </button>
            <button
              onClick={() => setSelectedMetricTab('cpu')}
              className={`seg-btn ${selectedMetricTab === 'cpu' ? 'seg-btn-on' : ''}`}
            >
              CPU
            </button>
            <button
              onClick={() => setSelectedMetricTab('memory')}
              className={`seg-btn ${selectedMetricTab === 'memory' ? 'seg-btn-on' : ''}`}
            >
              Memory
            </button>
            <button
              onClick={() => setSelectedMetricTab('network')}
              className={`seg-btn ${selectedMetricTab === 'network' ? 'seg-btn-on' : ''}`}
            >
              Network
            </button>
            <button
              onClick={() => setSelectedMetricTab('disk')}
              className={`seg-btn ${selectedMetricTab === 'disk' ? 'seg-btn-on' : ''}`}
            >
              Disk
            </button>
          </div>
        </div>

        {/* Performance Graphs Display */}
        <div className={`grid gap-4 ${selectedMetricTab === 'grid' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {(selectedMetricTab === 'grid' || selectedMetricTab === 'cpu') && (
            <PerformanceGraph
              title="CPU Utilization"
              subtitle={pve?.cpuModel || `${pve?.cpuCores || 4} vCPUs`}
              data={cpuData}
              secondaryData={dockerCpuData.length > 0 ? dockerCpuData : undefined}
              secondaryLabel="Docker Host"
              tone="accent"
              secondaryTone="cyan"
              maxScale={100}
              height={selectedMetricTab === 'cpu' ? 240 : 170}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              secondaryFormatter={(v) => `${v.toFixed(1)}%`}
            />
          )}

          {(selectedMetricTab === 'grid' || selectedMetricTab === 'memory') && (
            <PerformanceGraph
              title="Memory Usage"
              subtitle={`${formatBytes(pve?.ramUsedBytes ?? 0)} of ${formatBytes(pve?.ramTotalBytes ?? 0)}`}
              data={ramData}
              tone="purple"
              maxScale={100}
              height={selectedMetricTab === 'memory' ? 240 : 170}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
            />
          )}

          {(selectedMetricTab === 'grid' || selectedMetricTab === 'network') && (
            <PerformanceGraph
              title="Network Throughput"
              subtitle="Fleet Inbound (RX) & Outbound (TX)"
              data={netRxData}
              secondaryData={netTxData}
              secondaryLabel="TX Out"
              tone="cyan"
              secondaryTone="accent"
              maxScale="auto"
              height={selectedMetricTab === 'network' ? 240 : 170}
              valueFormatter={formatNetworkRate}
              secondaryFormatter={formatNetworkRate}
            />
          )}

          {(selectedMetricTab === 'grid' || selectedMetricTab === 'disk') && (
            <PerformanceGraph
              title="Storage Active Time"
              subtitle={physicalDrive ? physicalDrive.label : 'Primary Storage Volume'}
              data={diskActiveData}
              tone="warn"
              maxScale={100}
              height={selectedMetricTab === 'disk' ? 240 : 170}
              valueFormatter={(v) => `${v.toFixed(0)}%`}
            />
          )}
        </div>
      </section>

      {/* Quick Navigation Panels */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/fleet" className="panel flex items-center justify-between px-5 py-4 transition-colors hover:bg-cockpit-panelHover">
          <div>
            <p className="label">Container fleet</p>
            <p className="metric-lg mt-1">
              {runningCount}
              <span className="metric-unit">of {totalCount} running</span>
            </p>
            {pinnedCount > 0 && (
              <p className="mt-1 text-[11.5px] text-cockpit-muted">{pinnedCount} pinned to the command palette</p>
            )}
          </div>
          <ArrowRight className="h-4 w-4 text-cockpit-muted" />
        </Link>

        <Link to="/infra" className="panel flex items-center justify-between px-5 py-4 transition-colors hover:bg-cockpit-panelHover">
          <div>
            <p className="label">Infrastructure</p>
            <p className="metric-lg mt-1">
              {physicalDrive ? formatBytes(physicalDrive.totalBytes) : (snapshot?.storage.length ?? 0)}
              <span className="metric-unit">{physicalDrive ? 'Physical SSD' : 'volumes tracked'}</span>
            </p>
            <p className="mt-1 text-[11.5px] text-cockpit-muted">
              {physicalDrive
                ? `${formatBytes(physicalDrive.freeBytes)} free (${(100 - physicalDrive.usedPercent).toFixed(0)}%) · ${snapshot?.storage.length ?? 0} volumes`
                : 'Storage, Tailscale mesh, SSL certificates'}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-cockpit-muted" />
        </Link>
      </div>

      <BookmarksSection />
    </div>
  );
};
