import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { HostMetrics } from '../types.js';
import { formatBytes, formatNetworkRate, getStatusColor, getTempColor } from '../utils/formatters.js';
import { Tile, Bar } from './hostVitalsShared.js';
import { Sparkline } from './Sparkline.js';
import { useMetricHistory } from '../context/MetricHistoryContext.js';

interface HostSummaryTilesProps {
  host: HostMetrics | undefined;
  throughput?: { rx: number; tx: number };
}

export const HostSummaryTiles: React.FC<HostSummaryTilesProps> = ({ host, throughput }) => {
  const { history } = useMetricHistory();

  if (!host) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel h-[104px] animate-pulse" />
        ))}
      </div>
    );
  }

  const { pve, dockerHost } = host;
  const cpuTone = getStatusColor(pve.cpuPercent);
  const ramTone = getStatusColor(pve.ramPercent);
  const temp = pve.cpuTempCelsius ?? dockerHost.thermalThrottle?.packageTempCelsius ?? 48;
  const tempTone = getTempColor(temp);
  const tempScale = ((temp - 30) / 60) * 100;

  const cpuHistory = history.map((p) => p.pveCpu);
  const ramHistory = history.map((p) => p.pveRam);
  const netHistory = history.map((p) => p.netRxRate + p.netTxRate);
  const tempHistory = history.map((p) => p.temp);

  const getSparkTone = (percent: number) => {
    if (percent >= 90) return 'bad';
    if (percent >= 75) return 'warn';
    return 'accent';
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
      <Tile label="CPU · Proxmox">
        <div className="flex items-center justify-between">
          <div className="metric-lg">
            {pve.cpuPercent.toFixed(1)}
            <span className="metric-unit">%</span>
          </div>
          {cpuHistory.length > 1 && (
            <div className="opacity-90">
              <Sparkline data={cpuHistory} width={76} height={26} tone={getSparkTone(pve.cpuPercent)} />
            </div>
          )}
        </div>
        <Bar percent={pve.cpuPercent} tone={cpuTone.bar} />
      </Tile>

      <Tile label="Memory · Host">
        <div className="flex items-center justify-between">
          <div className="metric-lg">
            {formatBytes(pve.ramUsedBytes)}
            <span className="metric-unit">of {formatBytes(pve.ramTotalBytes)}</span>
          </div>
          {ramHistory.length > 1 && (
            <div className="opacity-90">
              <Sparkline data={ramHistory} width={76} height={26} tone={getSparkTone(pve.ramPercent)} />
            </div>
          )}
        </div>
        <Bar percent={pve.ramPercent} tone={ramTone.bar} />
      </Tile>

      <Tile label="Fleet throughput">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="metric-lg flex items-baseline">
              <ArrowDown className="mr-1 h-3.5 w-3.5 self-center text-cockpit-accent" />
              {formatNetworkRate(throughput?.rx ?? 0)}
            </span>
          </div>
          {netHistory.length > 1 && (
            <div className="opacity-90">
              <Sparkline data={netHistory} width={76} height={26} tone="accent" />
            </div>
          )}
        </div>
        <p className="mt-3 flex items-center gap-1 font-mono text-[11.5px] tabular-nums text-cockpit-muted">
          <ArrowUp className="h-3 w-3" />
          {formatNetworkRate(throughput?.tx ?? 0)} outbound
        </p>
      </Tile>

      <Tile label="Package temp">
        <div className="flex items-center justify-between">
          <div className={`metric-lg ${tempTone.text}`}>
            {temp.toFixed(1)}
            <span className="metric-unit">°C · {tempTone.label}</span>
          </div>
          {tempHistory.length > 1 && (
            <div className="opacity-90">
              <Sparkline data={tempHistory} width={76} height={26} tone={temp >= 75 ? 'bad' : temp >= 65 ? 'warn' : 'accent'} />
            </div>
          )}
        </div>
        <Bar percent={tempScale} tone={tempTone.bar} />
      </Tile>
    </div>
  );
};
