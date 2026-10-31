import React, { useEffect, useState, useMemo } from 'react';
import {
  Sparkles,
  Bot,
  Flame,
  Clock,
  Calendar,
  Zap,
  Info,
  RefreshCw,
  Radio,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { AiTelemetryResponse } from '../types.js';

export const AiAgentsPage: React.FC = () => {
  const [data, setData] = useState<AiTelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'claude' | 'gemini'>('all');
  const [showDocs, setShowDocs] = useState(false);
  const [, setTick] = useState(0);

  const fetchTelemetry = async () => {
    try {
      const res = await authFetch('/api/ai-agents/telemetry');
      if (!res.ok) {
        throw new Error(`Failed to fetch AI telemetry (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading AI telemetry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(interval);
  }, []);

  // Timer tick for live cooldown second countdown
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredAgents = useMemo(() => {
    if (!data?.agents) return [];
    return data.agents.filter((agent) => {
      if (filter === 'active') return agent.status === 'running';
      if (filter === 'claude') return agent.provider.toLowerCase().includes('claude') || agent.id.includes('claude');
      if (filter === 'gemini') return agent.provider.toLowerCase().includes('antigravity') || agent.id.includes('antigravity');
      return true;
    });
  }, [data, filter]);

  const formatCountdown = (targetDateStr?: string) => {
    if (!targetDateStr) return 'No active cooldown';
    const target = new Date(targetDateStr).getTime();
    const now = Date.now();
    const diff = Math.max(0, Math.floor((target - now) / 1000));
    if (diff <= 0) return 'Slot freed';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-black uppercase tracking-tight text-cockpit-text">
            <Sparkles className="h-6 w-6 text-cockpit-accent animate-pulse" />
            AI Agents Monitor
          </h1>
          <p className="font-mono text-xs text-cockpit-muted mt-1 uppercase tracking-wide">
            Real-time usage tracking, 5-hour rolling windows, cooldown counters, and weekly burn rates via T3 Code.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowDocs(!showDocs)}
            className="btn-ghost inline-flex items-center gap-1.5 py-1.5 px-3 text-xs"
          >
            <Info className="h-3.5 w-3.5 text-cockpit-accent" />
            <span>T3 Setup &amp; Docs</span>
            {showDocs ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
          </button>
          <button
            onClick={fetchTelemetry}
            className="btn-ghost inline-flex items-center gap-1.5 py-1.5 px-3 text-xs"
            title="Refresh telemetry"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border-2 border-state-bad bg-state-bad/10 p-3.5 text-xs font-mono text-state-bad shadow-[3px_3px_0_rgba(var(--state-bad)/0.4)]">
          {error}
        </div>
      )}

      {/* Accuracy disclaimer — always visible, not tucked into the collapsible docs */}
      <div className="rounded-panel border border-state-warn/30 bg-state-warn/[0.06] px-4 py-3 text-[12px] leading-relaxed text-cockpit-muted">
        <span className="font-semibold text-cockpit-text">Estimated, not the account's real limit.</span> These 5-hour and
        weekly numbers are counted from turns recorded in this host's local T3 session history
        (<code className="font-mono text-cockpit-accent">{data?.t3Path || '~/.t3'}</code>), not from Anthropic's own usage
        counters. If the same account is used from another machine, another T3 session, or a different app, that usage
        isn't visible here and the real remaining quota will be lower than shown.
      </div>

      {/* Docs / How It Works Collapsible Banner */}
      {showDocs && (
        <div className="panel animate-fade-in-up p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 text-cockpit-text font-bold text-sm uppercase tracking-wide">
              <Info className="h-4 w-4 text-cockpit-accent" />
              <span>How AI Telemetry Works &amp; Prerequisites</span>
            </div>
            <span className="pill pill-accent text-[10.5px]">
              Zero-API-Key Architecture
            </span>
          </div>
          <div className="text-xs text-cockpit-muted space-y-2.5 leading-relaxed">
            <p>
              This dashboard monitors AI agents authenticated through <strong>T3 Code</strong> (such as your{' '}
              <span className="text-cockpit-text font-semibold">Claude Pro Subscription</span> and{' '}
              <span className="text-cockpit-text font-semibold">Google Account OAuth</span> for Gemini/Antigravity).
              It tracks message turns and calculates sliding 5-hour limits and weekly reset cycles without requiring separate metered API keys.
            </p>
            <div className="border-2 border-cockpit-border/80 bg-cockpit-bg/60 p-3.5 space-y-1.5 font-mono text-[11px]">
              <div className="text-cockpit-text font-bold uppercase tracking-wider">Requirements for other Homelab setups:</div>
              <div>• <strong>T3 Data Directory:</strong> Default path is <code className="text-cockpit-accent">~/.t3</code> (configurable via <code className="text-cockpit-accent">T3_DATA_DIR</code> environment variable).</div>
              <div>• <strong>Docker Deployment:</strong> Mount the host T3 directory into the container: <code className="text-cockpit-accent">-v ~/.t3:/root/.t3:ro</code>.</div>
              <div>• <strong>Files Read:</strong> <code className="text-cockpit-accent">~/.t3/caches/*.json</code> (agent metadata) and <code className="text-cockpit-accent">~/.t3/userdata/state.sqlite</code> (read-only turn history).</div>
            </div>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel p-4 animate-fade-in-up stagger-1">
          <div className="flex items-center justify-between text-cockpit-muted text-xs">
            <span className="label">Active Agents</span>
            <Radio className="h-4 w-4 text-state-good animate-pulse" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-cockpit-text">
              {data?.summary.activeAgentsNow ?? 0}
            </span>
            <span className="text-xs text-cockpit-muted font-mono">/ {data?.summary.totalAgents ?? 4} registered</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-state-good flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 bg-state-good inline-block"></span>
            Real-time sync
          </div>
        </div>

        <div className="panel p-4 animate-fade-in-up stagger-2">
          <div className="flex items-center justify-between text-cockpit-muted text-xs">
            <span className="label">Turns Today</span>
            <Flame className="h-4 w-4 text-cockpit-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-cockpit-text">
              {data?.summary.totalTurnsToday ?? 0}
            </span>
            <span className="text-xs text-cockpit-muted font-mono">prompts</span>
          </div>
          <div className="mt-1 text-[11px] text-cockpit-muted font-mono">
            All-time: <span className="text-cockpit-text font-bold">{data?.summary.totalTurnsAllTime ?? 0}</span>
          </div>
        </div>

        <div className="panel p-4 animate-fade-in-up stagger-3">
          <div className="flex items-center justify-between text-cockpit-muted text-xs">
            <span className="label">5H Peak Load</span>
            <Clock className="h-4 w-4 text-state-warn" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-cockpit-text">
              {data ? Math.max(...data.agents.map((a) => a.rolling5h.usagePercent), 0) : 0}%
            </span>
            <span className="text-xs text-cockpit-muted font-mono">window</span>
          </div>
          <div className="mt-1 text-[11px] text-cockpit-muted font-mono">
            Safe zone (&lt;85%)
          </div>
        </div>

        <div className="panel p-4 animate-fade-in-up stagger-4">
          <div className="flex items-center justify-between text-cockpit-muted text-xs">
            <span className="label">Telemetry</span>
            <Zap className="h-4 w-4 text-cockpit-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-sm font-bold font-mono text-cockpit-text">
              {data?.isT3Detected ? 'T3 Code Linked' : 'Offline'}
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-cockpit-muted font-mono truncate" title={data?.t3Path}>
            {data?.t3Path || '~/.t3'}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-cockpit-border pb-3">
        <div className="seg flex-wrap">
          {(['all', 'active', 'claude', 'gemini'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`seg-btn ${filter === tab ? 'seg-btn-on' : ''}`}
            >
              {tab === 'all' && 'All Agents'}
              {tab === 'active' && 'Active Only'}
              {tab === 'claude' && 'Claude'}
              {tab === 'gemini' && 'Gemini / Antigravity'}
            </button>
          ))}
        </div>
        <span className="text-xs text-cockpit-muted font-mono font-bold uppercase tracking-wider">
          {filteredAgents.length} agents displayed
        </span>
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filteredAgents.map((agent) => {
          const isClaude = agent.provider.toLowerCase().includes('claude') || agent.id.includes('claude');
          const isRunning = agent.status === 'running';
          const usage5h = agent.rolling5h.usagePercent;
          const usageColor =
            usage5h >= 85 ? 'bg-state-bad text-state-bad' : usage5h >= 60 ? 'bg-state-warn text-state-warn' : 'bg-cockpit-accent text-cockpit-accent';

          return (
            <div
              key={agent.id}
              className={`panel relative overflow-hidden p-5 ${
                isRunning ? 'ring-2 ring-cockpit-accent' : ''
              }`}
            >
              {/* Top Card Bar */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center border-2 ${
                      isClaude
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                        : 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                    }`}
                  >
                    {isClaude ? <Bot className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-cockpit-text text-sm uppercase tracking-wide">{agent.displayName}</h3>
                      <span className={`pill ${isRunning ? 'pill-good' : 'pill-neutral'}`}>
                        {isRunning && <span className="h-1.5 w-1.5 bg-cockpit-bg inline-block animate-ping"></span>}
                        {isRunning ? 'Running' : 'Idle'}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-cockpit-muted truncate max-w-[240px] mt-0.5 uppercase">
                      {agent.account} · <span className="text-cockpit-accent font-semibold">{agent.plan}</span>
                    </div>
                    <div className="text-[10.5px] font-mono text-cockpit-muted mt-0.5">
                      {agent.turnsToday} turn{agent.turnsToday === 1 ? '' : 's'} today
                      {agent.lastActiveAt && ` · last active ${new Date(agent.lastActiveAt).toLocaleTimeString()}`}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="pill pill-neutral font-mono text-[10.5px]">
                    {agent.currentModel}
                  </span>
                </div>
              </div>

              {/* 5-Hour Rolling Limit Section */}
              <div className="mt-5 border-2 border-cockpit-border/80 bg-cockpit-bg/50 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-cockpit-text font-bold uppercase tracking-wider text-[11px]">
                    <Clock className="h-3.5 w-3.5 text-cockpit-accent" />
                    5-Hour Rolling Window
                  </span>
                  <div className="font-mono text-xs">
                    <span className="font-black text-cockpit-text">{agent.rolling5h.turnsCount}</span>
                    <span className="text-cockpit-muted"> / ~{agent.rolling5h.estimatedLimit} turns</span>
                    <span className={`ml-2 font-bold ${usageColor.split(' ')[1]}`}>
                      ({agent.rolling5h.usagePercent}%)
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="track">
                  <div
                    className={`track-fill ${usageColor.split(' ')[0]}`}
                    style={{ width: `${Math.max(agent.rolling5h.usagePercent, 2)}%` }}
                  />
                </div>

                {/* Cooldown Timer */}
                <div className="flex items-center justify-between text-[11px] font-mono text-cockpit-muted pt-1">
                  <span>
                    {agent.rolling5h.turnsCount > 0 ? (
                      <>
                        Turn frees:{' '}
                        <strong className="text-cockpit-text font-bold">
                          {formatCountdown(agent.rolling5h.resetAt)}
                        </strong>
                      </>
                    ) : (
                      'Quota fully refreshed'
                    )}
                  </span>
                  {agent.rolling5h.resetAt && (
                    <span className="text-[10px]">
                      {new Date(agent.rolling5h.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Weekly History Section */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-cockpit-muted">
                  <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10.5px]">
                    <Calendar className="h-3.5 w-3.5 text-cockpit-muted" />
                    Past 7 Days Activity
                  </span>
                  <span className="font-mono text-[11px]">
                    <span className="text-cockpit-text font-bold">{agent.weekly.turnsCount}</span>
                    <span className="text-cockpit-muted"> / ~{agent.weekly.estimatedLimit} turns ({agent.weekly.usagePercent}%)</span>
                  </span>
                </div>

                {/* Weekly Mini Bars */}
                <div className="grid grid-cols-7 gap-1.5 pt-1">
                  {agent.weekly.dailyCounts.map((day) => {
                    const maxVal = Math.max(...agent.weekly.dailyCounts.map((d) => d.count), 1);
                    const heightPercent = Math.max(Math.round((day.count / maxVal) * 100), 12);

                    return (
                      <div key={day.date} className="flex flex-col items-center gap-1">
                        <div className="relative flex h-14 w-full items-end justify-center bg-cockpit-bg/50 p-0.5 border border-cockpit-border/60">
                          <div
                            className={`w-full transition-all duration-100 ${
                              day.count > 0 ? 'bg-cockpit-accent' : 'bg-cockpit-border/40'
                            }`}
                            style={{ height: `${heightPercent}%` }}
                            title={`${day.date}: ${day.count} turns`}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-cockpit-muted uppercase">{day.dayName}</span>
                        <span className="font-mono text-[9px] text-cockpit-text font-bold">{day.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Turns Activity Stream */}
      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-cockpit-accent animate-pulse" />
            <h2 className="font-black text-cockpit-text text-sm uppercase tracking-wider">Recent Interactions Stream</h2>
          </div>
          <span className="text-xs text-cockpit-muted font-mono uppercase tracking-wider">Live turn timeline</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b-2 border-cockpit-border text-cockpit-muted text-[11px] uppercase tracking-wider">
                <th className="pb-2 font-bold">Timestamp</th>
                <th className="pb-2 font-bold">Agent</th>
                <th className="pb-2 font-bold">Model</th>
                <th className="pb-2 font-bold">Duration</th>
                <th className="pb-2 font-bold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cockpit-border/40">
              {data?.recentTurns && data.recentTurns.length > 0 ? (
                data.recentTurns.map((turn) => {
                  const isRunning = turn.state === 'running';
                  return (
                    <tr key={turn.turnId} className="hover:bg-cockpit-text/5 transition-colors">
                      <td className="py-2.5 text-cockpit-muted text-[11px]">
                        {new Date(turn.requestedAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 text-cockpit-text font-bold">
                        {turn.agentName}
                      </td>
                      <td className="py-2.5">
                        <span className="pill pill-neutral text-[10px]">
                          {turn.model}
                        </span>
                      </td>
                      <td className="py-2.5 text-cockpit-muted">
                        {turn.durationSeconds !== undefined ? `${turn.durationSeconds}s` : isRunning ? 'In progress...' : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={`pill ${isRunning ? 'pill-warn' : 'pill-good'}`}>
                          {isRunning ? 'Processing' : 'Completed'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-cockpit-muted font-mono uppercase">
                    No recent interaction turns recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
