import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CockpitSnapshot } from '../types.js';

export interface MetricHistoryPoint {
  timestamp: number;
  pveCpu: number;
  dockerCpu: number;
  pveRam: number;
  pveRamBytes: number;
  dockerRam: number;
  dockerRamBytes: number;
  netRxRate: number;
  netTxRate: number;
  temp: number;
  diskActiveTime: number;
  diskReadRate: number;
  diskWriteRate: number;
  fleetCpu: number;
  fleetMemBytes: number;
  fleetRunningCount: number;
}

interface MetricHistoryContextType {
  history: MetricHistoryPoint[];
  latestPoint: MetricHistoryPoint | null;
}

const MetricHistoryContext = createContext<MetricHistoryContextType>({
  history: [],
  latestPoint: null,
});

const MAX_HISTORY_POINTS = 60; // ~2 minutes at 2s interval

export const MetricHistoryProvider: React.FC<{
  snapshot: CockpitSnapshot | null;
  children: React.ReactNode;
}> = ({ snapshot, children }) => {
  const [history, setHistory] = useState<MetricHistoryPoint[]>([]);
  const lastTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (!snapshot) return;

    // Avoid duplicate points if snapshot reference updates without metric changes
    const now = Date.now();
    if (now - lastTimestampRef.current < 800) {
      return;
    }
    lastTimestampRef.current = now;

    const pve = snapshot.host?.pve;
    const dockerHost = snapshot.host?.dockerHost;
    const containers = snapshot.containers || [];
    const primaryDisk =
      snapshot.storage?.find((s) => s.isPhysicalRoot) ||
      snapshot.storage?.find((s) => s.activeTimePercent !== undefined) ||
      snapshot.storage?.[0];

    const fleetCpu = containers.reduce((sum, c) => sum + (c.cpuPercent || 0), 0);
    const fleetMemBytes = containers.reduce((sum, c) => sum + (c.memoryBytes || 0), 0);
    const netRxRate = containers.reduce((sum, c) => sum + (c.networkRxRateBytesPerSec || 0), 0);
    const netTxRate = containers.reduce((sum, c) => sum + (c.networkTxRateBytesPerSec || 0), 0);
    const runningCount = containers.filter((c) => c.state === 'running').length;

    const temp =
      pve?.cpuTempCelsius ??
      dockerHost?.thermalThrottle?.packageTempCelsius ??
      45;

    const newPoint: MetricHistoryPoint = {
      timestamp: now,
      pveCpu: pve?.cpuPercent ?? dockerHost?.cpuPercent ?? 0,
      dockerCpu: dockerHost?.cpuPercent ?? 0,
      pveRam: pve?.ramPercent ?? dockerHost?.ramPercent ?? 0,
      pveRamBytes: pve?.ramUsedBytes ?? dockerHost?.ramUsedBytes ?? 0,
      dockerRam: dockerHost?.ramPercent ?? 0,
      dockerRamBytes: dockerHost?.ramUsedBytes ?? 0,
      netRxRate,
      netTxRate,
      temp,
      diskActiveTime: primaryDisk?.activeTimePercent ?? 0,
      diskReadRate: primaryDisk?.readRateBytesPerSec ?? 0,
      diskWriteRate: primaryDisk?.writeRateBytesPerSec ?? 0,
      fleetCpu,
      fleetMemBytes,
      fleetRunningCount: runningCount,
    };

    setHistory((prev) => {
      const next = [...prev, newPoint];
      if (next.length > MAX_HISTORY_POINTS) {
        return next.slice(next.length - MAX_HISTORY_POINTS);
      }
      return next;
    });
  }, [snapshot]);

  return (
    <MetricHistoryContext.Provider
      value={{
        history,
        latestPoint: history[history.length - 1] ?? null,
      }}
    >
      {children}
    </MetricHistoryContext.Provider>
  );
};

export function useMetricHistory() {
  return useContext(MetricHistoryContext);
}
