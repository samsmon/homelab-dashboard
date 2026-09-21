import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

export interface AgentInstanceTelemetry {
  id: string;
  instanceId: string;
  displayName: string;
  provider: string;
  account: string;
  plan: string;
  status: 'idle' | 'running' | 'cooldown';
  currentModel: string;
  lastActiveAt?: string;
  lastError?: string;
  turnsToday: number;
  rolling5h: {
    turnsCount: number;
    estimatedLimit: number;
    usagePercent: number;
    resetAt?: string;
    cooldownSecondsRemaining: number;
  };
  weekly: {
    turnsCount: number;
    estimatedLimit: number;
    usagePercent: number;
    dailyCounts: { date: string; dayName: string; count: number }[];
  };
}

export interface AiTelemetryResponse {
  isT3Detected: boolean;
  t3Path: string;
  checkedAt: string;
  summary: {
    totalAgents: number;
    activeAgentsNow: number;
    totalTurnsToday: number;
    totalTurnsAllTime: number;
  };
  agents: AgentInstanceTelemetry[];
  recentTurns: {
    turnId: string;
    threadId: string;
    agentId: string;
    agentName: string;
    model: string;
    state: string;
    requestedAt: string;
    completedAt?: string;
    durationSeconds?: number;
  }[];
}

export class AiAgentsService {
  private t3Dir: string;

  constructor() {
    this.t3Dir = process.env.T3_DATA_DIR || path.join(os.homedir(), '.t3');
  }

  public getTelemetry(): AiTelemetryResponse {
    const isT3Detected = fs.existsSync(this.t3Dir);
    const checkedAt = new Date().toISOString();

    if (!isT3Detected) {
      return {
        isT3Detected: false,
        t3Path: this.t3Dir,
        checkedAt,
        summary: {
          totalAgents: 0,
          activeAgentsNow: 0,
          totalTurnsToday: 0,
          totalTurnsAllTime: 0,
        },
        agents: [],
        recentTurns: [],
      };
    }

    // 1. Discover registered cache configurations
    const cachesDir = path.join(this.t3Dir, 'caches');
    const registeredAgents: Map<string, any> = new Map();

    if (fs.existsSync(cachesDir)) {
      try {
        const files = fs.readdirSync(cachesDir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(cachesDir, file), 'utf-8');
            const data = JSON.parse(raw);
            const instanceId = data.instanceId || file.replace('.json', '');
            registeredAgents.set(instanceId, { ...data, instanceId, cacheFile: file });
          } catch {
            // ignore malformed JSON
          }
        }
      } catch {
        // ignore read error
      }
    }

    // 2. Query SQLite telemetry if available
    const sqlitePath = path.join(this.t3Dir, 'userdata', 'state.sqlite');
    let db: DatabaseSync | null = null;
    let allTurns: any[] = [];
    let recentTurnsList: any[] = [];
    let runningThreads: Set<string> = new Set();
    let threadSessionsMap: Map<string, { providerName: string; instanceId: string }> = new Map();

    if (fs.existsSync(sqlitePath)) {
      try {
        db = new DatabaseSync(sqlitePath, { readOnly: true });

        // Map thread_id -> provider & instanceId
        const sessionRows = db
          .prepare(
            'SELECT thread_id, provider_name, provider_instance_id, status FROM projection_thread_sessions'
          )
          .all() as any[];

        for (const row of sessionRows) {
          threadSessionsMap.set(row.thread_id, {
            providerName: row.provider_name || 'unknown',
            instanceId: row.provider_instance_id || row.provider_name || 'unknown',
          });
        }

        // Identify currently active turns
        const activeRows = db
          .prepare("SELECT thread_id FROM projection_turns WHERE state = 'running'")
          .all() as any[];
        for (const row of activeRows) {
          runningThreads.add(row.thread_id);
        }

        // Query all turns with timestamp for aggregation
        allTurns = db
          .prepare(
            `SELECT t.turn_id, t.thread_id, t.state, t.requested_at, t.completed_at,
                    s.provider_name, s.provider_instance_id, th.model_selection_json
             FROM projection_turns t
             LEFT JOIN projection_thread_sessions s ON t.thread_id = s.thread_id
             LEFT JOIN projection_threads th ON t.thread_id = th.thread_id
             ORDER BY t.requested_at DESC`
          )
          .all() as any[];

        // Take 15 most recent turns
        recentTurnsList = allTurns.slice(0, 15).map((turn) => {
          let model = 'default';
          try {
            if (turn.model_selection_json) {
              const parsed = JSON.parse(turn.model_selection_json);
              model = parsed.model || parsed.slug || model;
            }
          } catch {
            // ignore
          }

          let durationSeconds: number | undefined;
          if (turn.requested_at && turn.completed_at) {
            const start = new Date(turn.requested_at).getTime();
            const end = new Date(turn.completed_at).getTime();
            if (!isNaN(start) && !isNaN(end) && end >= start) {
              durationSeconds = Math.round((end - start) / 1000);
            }
          }

          const instanceId = turn.provider_instance_id || turn.provider_name || 'unknown';
          const cacheData = registeredAgents.get(instanceId);
          const agentName = cacheData?.displayName || instanceId;

          return {
            turnId: turn.turn_id,
            threadId: turn.thread_id,
            agentId: instanceId,
            agentName,
            model,
            state: turn.state,
            requestedAt: turn.requested_at,
            completedAt: turn.completed_at || undefined,
            durationSeconds,
          };
        });
      } catch (err) {
        console.warn('[AiAgentsService] SQLite read error:', err);
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            // ignore
          }
        }
      }
    }

    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    // Group turns by agent instanceId
    const turnsByAgent: Map<string, any[]> = new Map();
    let totalTurnsToday = 0;

    for (const turn of allTurns) {
      const instanceId = turn.provider_instance_id || turn.provider_name || 'unknown';
      if (!turnsByAgent.has(instanceId)) {
        turnsByAgent.set(instanceId, []);
      }
      turnsByAgent.get(instanceId)!.push(turn);

      const turnTime = new Date(turn.requested_at).getTime();
      if (turnTime >= startOfTodayMs) {
        totalTurnsToday++;
      }
    }

    // Default primary agent configurations we track
    const knownAgentKeys = ['claudeAgent', 'antigravity', 'antigravity_auth', 'antigravity_marmut'];
    // Merge any other registered agent keys from cache
    for (const key of registeredAgents.keys()) {
      if (!knownAgentKeys.includes(key)) {
        knownAgentKeys.push(key);
      }
    }

    const agentsTelemetry: AgentInstanceTelemetry[] = [];

    // Helper to generate last 7 days buckets
    const generateEmpty7Days = () => {
      const days = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        days.push({
          date: dateStr,
          dayName: dayNames[d.getDay()],
          count: 0,
        });
      }
      return days;
    };

    for (const key of knownAgentKeys) {
      const cache = registeredAgents.get(key) || {};
      const turns = turnsByAgent.get(key) || [];

      // Determine default display name & account
      let displayName = cache.displayName || key;
      if (key === 'claudeAgent') displayName = 'Claude Code';
      else if (key === 'antigravity') displayName = 'Gemini (Default)';
      else if (key === 'antigravity_auth') displayName = 'Gemini (Auth)';
      else if (key === 'antigravity_marmut') displayName = 'Gemini (Marmut)';

      const provider = cache.driver || (key.includes('claude') ? 'claude' : 'antigravity');
      const fallbackEmail = registeredAgents.get('claudeAgent')?.auth?.email || 'unknown';
      let account = cache.auth?.email;
      if (!account) {
        if (key.startsWith('antigravity') || cache.auth?.label === 'Google account') {
          account = fallbackEmail;
        } else {
          account = cache.auth?.label || 'Local Account';
        }
      }
      const plan = cache.auth?.type || (key === 'claudeAgent' ? 'Claude Pro' : 'Google Personal OAuth');

      // Models
      let currentModel = 'Default';
      if (Array.isArray(cache.models) && cache.models.length > 0) {
        const defaultModel = cache.models.find((m: any) => m.isDefault);
        currentModel = defaultModel?.name || cache.models[0]?.name || currentModel;
      }

      // Check running status
      const isRunningNow = turns.some((t) => t.state === 'running');
      const status: 'idle' | 'running' | 'cooldown' = isRunningNow ? 'running' : 'idle';

      // 5-Hour Rolling calculation
      const turnsIn5Hours = turns.filter((t) => {
        const ts = new Date(t.requested_at).getTime();
        return ts >= fiveHoursAgo;
      });

      // Estimated 5h message limit baseline (Claude Pro typical limit is ~45-50 messages per 5h window, Antigravity ~150)
      const estimated5hLimit = key === 'claudeAgent' ? 45 : 120;
      const usagePercent5h = Math.min(100, Math.round((turnsIn5Hours.length / estimated5hLimit) * 100));

      let resetAt: string | undefined;
      let cooldownSecondsRemaining = 0;

      if (turnsIn5Hours.length > 0) {
        // Find oldest turn in the current window
        const timestamps = turnsIn5Hours.map((t) => new Date(t.requested_at).getTime());
        const oldestTurnTime = Math.min(...timestamps);
        const slotFreesAt = oldestTurnTime + 5 * 60 * 60 * 1000;
        resetAt = new Date(slotFreesAt).toISOString();
        cooldownSecondsRemaining = Math.max(0, Math.round((slotFreesAt - now) / 1000));
      }

      // Weekly calculation (last 7 days)
      const dailyBuckets = generateEmpty7Days();
      const dailyMap = new Map(dailyBuckets.map((b) => [b.date, b]));

      let weeklyTurnsCount = 0;
      for (const turn of turns) {
        const turnTime = new Date(turn.requested_at).getTime();
        if (turnTime >= sevenDaysAgo) {
          weeklyTurnsCount++;
          const d = new Date(turnTime);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;
          const bucket = dailyMap.get(dateStr);
          if (bucket) {
            bucket.count++;
          }
        }
      }

      const estimatedWeeklyLimit = key === 'claudeAgent' ? 350 : 800;
      const weeklyUsagePercent = Math.min(
        100,
        Math.round((weeklyTurnsCount / estimatedWeeklyLimit) * 100)
      );

      const latestTurn = turns[0];
      const turnsToday = turns.filter((t) => new Date(t.requested_at).getTime() >= startOfTodayMs).length;

      agentsTelemetry.push({
        id: key,
        instanceId: key,
        displayName,
        provider,
        account,
        plan,
        status,
        currentModel,
        lastActiveAt: latestTurn?.requested_at,
        turnsToday,
        rolling5h: {
          turnsCount: turnsIn5Hours.length,
          estimatedLimit: estimated5hLimit,
          usagePercent: usagePercent5h,
          resetAt,
          cooldownSecondsRemaining,
        },
        weekly: {
          turnsCount: weeklyTurnsCount,
          estimatedLimit: estimatedWeeklyLimit,
          usagePercent: weeklyUsagePercent,
          dailyCounts: dailyBuckets,
        },
      });
    }

    const activeAgentsCount = agentsTelemetry.filter((a) => a.status === 'running').length;

    return {
      isT3Detected: true,
      t3Path: this.t3Dir,
      checkedAt,
      summary: {
        totalAgents: agentsTelemetry.length,
        activeAgentsNow: activeAgentsCount,
        totalTurnsToday,
        totalTurnsAllTime: allTurns.length,
      },
      agents: agentsTelemetry,
      recentTurns: recentTurnsList,
    };
  }
}
