import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, RefreshCw, RotateCcw } from 'lucide-react';
import { GitProjectStatus, GitPullState } from '../types.js';
import { authFetch } from '../utils/api.js';

interface CheckPullResult {
  ok: boolean;
  message?: string;
  riskyFiles: string[];
  changedFiles: string[];
}

interface GitPullInlineProps {
  project: GitProjectStatus;
  onDone: () => void;
}

const STATUS_LABEL: Record<GitPullState['status'], string> = {
  idle: 'Idle',
  pulling: 'Pulling…',
  rebuilding: 'Rebuilding…',
  success: 'Done',
  failed: 'Failed',
};

export const GitPullInline: React.FC<GitPullInlineProps> = ({ project, onDone }) => {
  const [check, setCheck] = useState<CheckPullResult | null>(null);
  const [pullState, setPullState] = useState<GitPullState | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const isSelf = !project.sshTarget && (project.containerName === 'homelab-cockpit' || project.repoName === 'homelab-dashboard');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const failCountRef = useRef(0);
  
  const logRef = useRef<HTMLDivElement>(null);
  const isRunning = pullState?.status === 'pulling' || pullState?.status === 'rebuilding';

  // Pick up whatever's already happening server-side — this project may
  // have been started from another tab, or the owner navigated away and
  // came back, so this can't assume the run starts fresh from here.
  useEffect(() => {
    authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/pull-status`)
      .then((res) => res.json())
      .then(setPullState)
      .catch(() => {});
  }, [project.containerName]);

  useEffect(() => {
    if (pullState && pullState.status !== 'idle') return; // already running or finished, nothing to check
    authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/check-pull`, { method: 'POST' })
      .then((res) => res.json())
      .then(setCheck)
      .catch(() => setCheck({ ok: false, message: 'Network error', riskyFiles: [], changedFiles: [] }));
  }, [project.containerName, pullState]);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/pull-status`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to get status');
          return res.json();
        })
        .then((data: GitPullState) => {
          failCountRef.current = 0;
          if (isReconnecting) setIsReconnecting(false);
          setPullState(data);
          if (data.status === 'success' || data.status === 'failed') {
            onDone();
          }
        })
        .catch(async () => {
          if (isSelf) {
            failCountRef.current += 1;
            if (failCountRef.current >= 2) {
              setIsReconnecting(true);
              try {
                const healthRes = await fetch('/api/health');
                if (healthRes.ok) {
                  setIsReconnecting(false);
                  window.location.reload();
                }
              } catch {}
            }
          }
        });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, project.containerName]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTo({ top: logRef.current.scrollHeight });
    }
  }, [pullState?.log.length, autoScroll]);

  const startPull = async () => {
    setAutoScroll(true);
    const res = await authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/pull`, {
      method: 'POST',
    });
    const data = await res.json();
    if (data.started) {
      setPullState({ status: 'pulling', log: [] });
    }
  };

  const handleReset = async () => {
    try {
      await authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/reset-pull`, {
        method: 'POST',
      });
    } catch {}
    setPullState(null);
    setCheck(null);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (autoScroll !== isNearBottom) {
      setAutoScroll(isNearBottom);
    }
  };

  const showLog = pullState && pullState.status !== 'idle';

  return (
    <div className="animate-fadeIn space-y-3 border-t border-cockpit-border bg-cockpit-bg px-4 py-3.5">
      {project.lastDeployedAt && (
        <p className="label !normal-case !tracking-normal text-[11px] text-cockpit-muted">
          Last pull &amp; redeploy: {new Date(project.lastDeployedAt).toLocaleString()}
        </p>
      )}

      {!showLog && check === null && (
        <div className="flex items-center gap-2 text-[12.5px] text-cockpit-muted">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-cockpit-accent" />
          Checking what would change…
        </div>
      )}

      {!showLog && check && !check.ok && (
        <div className="space-y-2.5 rounded-lg border border-state-bad/30 bg-state-bad/[0.06] p-3">
          <div className="flex items-start gap-2 text-[12px] text-state-bad">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Check failed or project diverged</p>
              <p className="mt-0.5 font-mono text-[11px] text-cockpit-muted break-all">{check.message || 'Could not check this project.'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={startPull}
              className="btn-danger flex items-center gap-1.5 text-[11.5px] py-1 px-2.5"
              title="Force sync repository and rebuild container via docker compose"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Repull & Redeploy (Force Sync)
            </button>
            <button
              type="button"
              onClick={() => {
                setCheck(null);
                authFetch(`/api/git-projects/${encodeURIComponent(project.containerName)}/check-pull`, { method: 'POST' })
                  .then((res) => res.json())
                  .then(setCheck)
                  .catch(() => setCheck({ ok: false, message: 'Network error', riskyFiles: [], changedFiles: [] }));
              }}
              className="btn-ghost flex items-center gap-1.5 text-[11.5px] py-1 px-2.5"
            >
              <RefreshCw className="h-3 w-3" />
              Retry Check
            </button>
          </div>
        </div>
      )}

      {!showLog && check?.ok && (
        <>
          <p className="text-[12px] text-cockpit-muted">
            {check.changedFiles.length === 0
              ? 'Already up to date — nothing new to pull.'
              : `${check.changedFiles.length} file(s) would change.`}
          </p>

          {check.riskyFiles.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-state-bad/40 bg-state-bad/[0.07] px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-state-bad" />
              <div className="text-[12px] leading-relaxed text-cockpit-text">
                <p className="font-semibold text-state-bad">Possible database migration</p>
                <p className="mt-1 text-cockpit-muted">
                  These changed files look like they touch a schema or migration — check them before pulling if
                  you're not sure:
                </p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-cockpit-text">
                  {check.riskyFiles.map((f) => (
                    <li key={f} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {check.changedFiles.length > 0 ? (
              <>
                <button onClick={startPull} className={check.riskyFiles.length > 0 ? 'btn-danger' : 'btn-primary'}>
                  <Download className="h-3.5 w-3.5" />
                  {check.riskyFiles.length > 0 ? 'Pull anyway' : 'Pull & rebuild'}
                </button>
                <button
                  type="button"
                  onClick={startPull}
                  className="btn-ghost flex items-center gap-1.5 text-[12px]"
                  title="Force pull remote branch and recreate container"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Force Pull & Redeploy
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startPull}
                className="btn-primary flex items-center gap-1.5 text-[12px]"
                title="Runs force pull & rebuild — useful if previous deploy failed or container diverged"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Force Pull & Redeploy
              </button>
            )}
          </div>
        </>
      )}

      {showLog && pullState && (
        <div className="space-y-2.5">
          {pullState.status === 'failed' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-bad/40 bg-state-bad/10 p-3">
              <div className="flex items-start gap-2.5 text-[12px] text-state-bad min-w-0">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold">Deploy Failed</p>
                  <p className="text-[11.5px] text-cockpit-muted break-all">
                    {pullState.message || 'Build or deployment command exited with an error. Check logs below.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={startPull}
                className="btn-danger flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold shadow-sm shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Force Pull & Redeploy
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <div className="flex items-center gap-2 min-w-0">
              {isRunning && <RefreshCw className="h-3.5 w-3.5 animate-spin text-cockpit-accent shrink-0" />}
              <span
                className={
                  pullState.status === 'success'
                    ? 'font-medium text-state-good'
                    : pullState.status === 'failed'
                      ? 'font-medium text-state-bad'
                      : 'font-medium text-cockpit-text'
                }
              >
                {STATUS_LABEL[pullState.status]}
              </span>
              {pullState.message && <span className="truncate text-cockpit-muted">— {pullState.message}</span>}
            </div>

            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded border border-state-bad/30 bg-state-bad/10 px-2.5 py-1 text-[11px] font-medium text-state-bad hover:bg-state-bad/20 transition-colors"
                  title="Cancel pull & rebuild process"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startPull}
                    className="btn-danger flex items-center gap-1.5 px-2.5 py-1 text-[11px] h-auto"
                    title="Repull and redeploy project cleanly"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Repull & Redeploy
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="btn-ghost px-2.5 py-1 text-[11px] h-auto"
                    title="Dismiss log output and return to project status"
                  >
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </div>

          <div
            ref={logRef}
            onScroll={handleScroll}
            className="max-h-56 overflow-y-auto rounded-lg border border-cockpit-border bg-cockpit-panel p-3 font-mono text-[11px] leading-relaxed text-cockpit-muted"
          >
            {pullState.log.length === 0 ? (
              <span>Waiting for output…</span>
            ) : (
              pullState.log.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>

          {/* Bottom sticky action bar so user never misses the button when scrolling through logs */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-cockpit-border/60">
            <div className="text-[12px] text-cockpit-muted min-w-0 flex items-center gap-1.5">
              {pullState.status === 'failed' ? (
                <span className="font-semibold text-state-bad flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Deploy failed. Click Force Pull & Redeploy to retry cleanly.
                </span>
              ) : pullState.status === 'success' ? (
                <span className="font-semibold text-state-good">
                  Deployment succeeded.
                </span>
              ) : isRunning ? (
                <span className="text-cockpit-accent animate-pulse">Running deployment pipeline...</span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startPull}
                disabled={isRunning}
                className="btn-danger flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold shadow-sm"
                title="Force sync and rebuild project container"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Force Pull & Redeploy
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isRunning}
                className="btn-ghost px-3 py-1.5 text-[12px]"
                title="Close and dismiss log"
              >
                Dismiss Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
