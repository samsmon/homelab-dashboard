import React, { useEffect, useState } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { TerminalView } from '../components/TerminalView.js';
import { StateBlock } from '../components/StateBlock.js';

export const TerminalPage: React.FC = () => {
  const [targets, setTargets] = useState<string[]>([]);
  const [connectedTarget, setConnectedTarget] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = () => {
    setState('loading');
    authFetch('/api/ssh-targets')
      .then((res) => res.json())
      .then((data) => {
        setTargets(data.targets ?? []);
        setState('ready');
      })
      .catch(() => setState('error'));
  };

  useEffect(load, []);

  if (connectedTarget) {
    return <TerminalView target={connectedTarget} onDisconnect={() => setConnectedTarget(null)} />;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Terminal</h2>
          <p className="panel-sub">Direct shell access — no command whitelist, real infrastructure</p>
        </div>
      </div>

      <div className="px-5 py-4">
        {state === 'loading' ? (
          <StateBlock kind="loading" />
        ) : state === 'error' ? (
          <StateBlock kind="error" title="Could not load SSH targets" onRetry={load} />
        ) : targets.length === 0 ? (
          <StateBlock
            kind="empty"
            title="No SSH targets configured"
            message={
              <>
                Set <code className="font-mono text-cockpit-text">SSH_TARGETS</code> and{' '}
                <code className="font-mono text-cockpit-text">SSH_PRIVATE_KEY_PATH</code> to enable this.
              </>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {targets.map((name) => (
              <button
                key={name}
                onClick={() => setConnectedTarget(name)}
                className="shortcut-card flex items-center gap-3 px-4 py-3.5 text-left font-bold text-cockpit-text"
              >
                <TerminalIcon className="h-4 w-4 text-cockpit-accent shrink-0" />
                <span className="font-mono tracking-wide truncate">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
