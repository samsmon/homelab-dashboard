import React from 'react';
import {
  Server,
  RefreshCw,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Terminal,
  LogOut,
  Sun,
  Moon,
  MoreVertical,
} from 'lucide-react';
import { CockpitSnapshot } from '../types.js';
import { useAuth } from '../context/AuthContext.js';
import { Theme } from '../hooks/useTheme.js';
import { ClockWeatherWidget } from './ClockWeatherWidget.js';
import { NotificationsPanel } from './NotificationsPanel.js';

interface HeaderProps {
  snapshot: CockpitSnapshot | null;
  isConnected: boolean;
  lastUpdated: Date | null;
  isPrivacyMode: boolean;
  isFullscreen: boolean;
  theme: Theme;
  onTogglePrivacy: () => void;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  snapshot,
  isConnected,
  lastUpdated,
  isPrivacyMode,
  isFullscreen,
  theme,
  onTogglePrivacy,
  onToggleFullscreen,
  onToggleTheme,
  onOpenCommandPalette,
  onRefresh,
}) => {
  const { username, logout } = useAuth();
  const [isMoreOpen, setIsMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isMoreOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isMoreOpen]);

  const pve = snapshot?.host.pve;
  const pveOnline = pve?.connected ?? false;
  const allHealthy = isConnected && pveOnline;

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

  const displayNodeName = cachedNodeName || pve?.nodeName;

  return (
    <header className="sticky top-0 z-40 border-b border-cockpit-border bg-cockpit-topbar/80 backdrop-blur-xl shadow-sm">
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">
        {/* Primary bar */}
        <div className="flex items-center justify-between gap-3 sm:gap-6 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none sm:gap-3">
            <div className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-cockpit-border bg-cockpit-panel text-cockpit-accent">
              <Server className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
              <span
                className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-cockpit-topbar ${
                  allHealthy ? 'bg-state-good' : 'bg-state-warn'
                }`}
                title={allHealthy ? 'All systems nominal' : 'Degraded — check node status'}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="truncate text-[14px] sm:text-[15px] font-extrabold tracking-tight text-cockpit-text">Dashboard</h1>
                {username && <span className="pill pill-neutral normal-case hidden sm:inline-flex">{username}</span>}
                {snapshot?.isDemoMode && <span className="pill pill-warn hidden sm:inline-flex">Demo</span>}
              </div>
              <p className="label mt-0.5 truncate normal-case tracking-normal text-[10px] sm:text-[10.5px]">
                Owner POV{displayNodeName ? ` · ${displayNodeName}` : ''}{snapshot?.isDemoMode ? <span className="text-state-warn sm:hidden"> · Demo</span> : null}
              </p>
            </div>
          </div>

          <ClockWeatherWidget />

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={onOpenCommandPalette}
              title="Open Command Deck (Ctrl+K)"
              className="group inline-flex items-center gap-1.5 rounded-lg border border-cockpit-accent/30 bg-cockpit-accent/10 px-2.5 py-1.5 text-[12px] sm:text-[12.5px] font-semibold text-cockpit-accent transition-all duration-150 hover:bg-cockpit-accent/20 active:scale-95"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Command Deck</span>
              <kbd className="hidden rounded border border-cockpit-accent/30 px-1 font-mono text-[10px] normal-case opacity-80 lg:inline">
                Ctrl K
              </kbd>
            </button>

            <NotificationsPanel />

            <span className="hidden sm:contents">
              <button
                onClick={onToggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="icon-btn"
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
            </span>

            <button
              onClick={onTogglePrivacy}
              title={isPrivacyMode ? 'Disable privacy mode' : 'Enable privacy mode (masks IPs & IDs)'}
              className={`icon-btn ${isPrivacyMode ? 'bg-cockpit-accent/15 text-cockpit-accent' : ''}`}
            >
              {isPrivacyMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>

            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setIsMoreOpen((v) => !v)}
                title="More actions"
                className={`icon-btn ${isMoreOpen ? 'border-cockpit-accent/50 text-cockpit-accent' : ''}`}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>

              {isMoreOpen && (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-xl border border-cockpit-border/60 bg-cockpit-panel/95 backdrop-blur-xl shadow-panel animate-fade-in">
                  <button
                    onClick={() => {
                      setIsMoreOpen(false);
                      onToggleFullscreen();
                    }}
                    className="hidden w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-cockpit-text transition-colors hover:bg-cockpit-panelHover sm:flex"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-3.5 w-3.5 text-cockpit-muted" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5 text-cockpit-muted" />
                    )}
                    {isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  </button>
                  <button
                    onClick={() => {
                      setIsMoreOpen(false);
                      onRefresh();
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-cockpit-text transition-colors hover:bg-cockpit-panelHover"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-cockpit-muted" />
                    Refresh telemetry
                  </button>
                  <div className="border-t border-cockpit-border/60" />
                  <button
                    onClick={() => {
                      setIsMoreOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-state-bad transition-colors hover:bg-state-bad/10"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sub-header status bar */}
        <div className="hidden items-center justify-between border-t border-cockpit-border/60 py-1.5 text-[11px] font-mono text-cockpit-muted sm:flex">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isConnected ? 'bg-state-good' : 'bg-state-bad animate-pulse'
              }`}
            />
            <span>{isConnected ? 'Telemetry active' : 'Connecting stream…'}</span>
          </div>
          <div className="text-[11px] opacity-75">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : '—'}
          </div>
        </div>
      </div>
    </header>
  );
};
