import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CockpitSnapshot, MetricHistoryPoint } from '../types.js';
import { authFetch } from '../utils/api.js';

export type { MetricHistoryPoint };

interface MetricHistoryContextType {
  history: MetricHistoryPoint[];
  latestPoint: MetricHistoryPoint | null;
}

const MetricHistoryContext = createContext<MetricHistoryContextType>({
  history: [],
  latestPoint: null,
});

const MAX_HISTORY_POINTS = 60; // ~2 minutes live at 2s; seeded points may be spaced wider

export const MetricHistoryProvider: React.FC<{
  snapshot: CockpitSnapshot | null;
  children: React.ReactNode;
}> = ({ snapshot, children }) => {
  const [history, setHistory] = useState<MetricHistoryPoint[]>([]);
  const lastTimestampRef = useRef<number>(0);

  // Seed from the server's ring buffer so the graphs are populated on first paint
  // instead of filling up one point per tick. Live points that arrived before the
  // response are kept (merged by timestamp).
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/metrics/history?limit=${MAX_HISTORY_POINTS}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((seed: MetricHistoryPoint[]) => {
        if (cancelled || !Array.isArray(seed) || seed.length === 0) return;
        setHistory((prev) => {
          const firstLive = prev[0]?.timestamp ?? Infinity;
          const merged = [...seed.filter((p) => p.timestamp < firstLive), ...prev];
          return merged.slice(-MAX_HISTORY_POINTS);
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The server computes the point (see MetricHistoryService) and ships it with every snapshot.
    const point = snapshot?.metricPoint;
    if (!point || point.timestamp <= lastTimestampRef.current) return;
    lastTimestampRef.current = point.timestamp;

    setHistory((prev) => {
      if (prev.length > 0 && point.timestamp <= prev[prev.length - 1].timestamp) return prev;
      const next = [...prev, point];
      return next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
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
