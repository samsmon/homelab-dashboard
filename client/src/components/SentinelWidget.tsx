import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SentinelStatus } from '../types.js';

interface SentinelWidgetProps {
  sentinel: SentinelStatus | undefined;
}

const Cell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-lg border border-cockpit-border bg-cockpit-bg px-3.5 py-3">
    <p className="label">{label}</p>
    <p className="mt-1.5 text-[13px] font-semibold text-cockpit-text">{children}</p>
  </div>
);

const TIERS = [
  {
    name: 'Tier 1 · read-only',
    note: 'Nothing changes state.',
    commands: ['/status — host & containers', '/resources — storage matrix', '/backup_status — vzdump', '/logs <name>'],
  },
  {
    name: 'Tier 2 · AI assistant',
    note: 'Gemini answers, never acts.',
    commands: ['"is jellyfin running ok?"', '"which disk is about to fill up?"', '/ask <prompt>'],
  },
  {
    name: 'Tier 3 · state actions',
    note: 'Whitelisted, needs /confirm within 60s.',
    commands: ['/restart <container>', '/prune — clean image cache', '/confirm', '/cancel'],
  },
];

export const SentinelWidget: React.FC<SentinelWidgetProps> = ({ sentinel }) => {
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const isEnabled = Boolean(sentinel?.enabled && sentinel?.polling);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Sentinel companion</h2>
          <p className="panel-sub">Telegram control · Gemini Q&amp;A · fail-closed allowlist</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`pill ${isEnabled ? 'pill-good' : 'pill-neutral'}`}>
            {isEnabled ? `online @${sentinel?.botUsername || 'bot'}` : 'standby'}
          </span>
          <button
            onClick={() => setShowCheatSheet(!showCheatSheet)}
            className="btn-ghost py-1.5"
            aria-expanded={showCheatSheet}
          >
            Commands
            <ChevronRight className={`h-3 w-3 transition-transform ${showCheatSheet ? 'rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-5">
        {isEnabled && sentinel ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cell label="Long polling">
              <span className="text-state-good">Listening</span>
            </Cell>
            <Cell label="Gemini Q&amp;A">
              {sentinel.geminiConfigured ? '2.0 Flash ready' : <span className="text-state-warn">API key missing</span>}
            </Cell>
            <Cell label="Authorized owners">{sentinel.allowedUsersCount} Telegram ID(s)</Cell>
            <Cell label="Last command">
              {sentinel.lastCommand ? `${sentinel.lastCommand} · ${sentinel.lastCommandAt}` : 'Idle'}
            </Cell>
          </div>
        ) : (
          <p className="max-w-[75ch] text-[13px] leading-relaxed text-cockpit-muted">
            Run the homelab from Telegram without a second container. Set{' '}
            <code className="font-mono text-cockpit-text">TELEGRAM_BOT_TOKEN</code> and{' '}
            <code className="font-mono text-cockpit-text">TELEGRAM_ALLOWED_USER_IDS</code> in{' '}
            <code className="font-mono text-cockpit-text">.env</code> to activate the companion.
          </p>
        )}

        {showCheatSheet && (
          <div className="mt-4 grid animate-fadeIn gap-4 border-t border-cockpit-border pt-4 md:grid-cols-3">
            {TIERS.map((tier) => (
              <div key={tier.name}>
                <p className="label">{tier.name}</p>
                <p className="mt-1 text-[12px] text-cockpit-muted">{tier.note}</p>
                <ul className="mt-2 space-y-1">
                  {tier.commands.map((command) => (
                    <li key={command} className="font-mono text-[11.5px] text-cockpit-text">
                      {command}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
