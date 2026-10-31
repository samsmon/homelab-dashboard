import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { AuthScreen } from './components/AuthScreen.js';
import { useCockpitData } from './hooks/useCockpitData.js';
import { useTheme } from './hooks/useTheme.js';
import { CommandPalette } from './components/CommandPalette.js';
import { LogModal } from './components/LogModal.js';
import { RestartModal, PowerAction } from './components/RestartModal.js';
import { PruneModal } from './components/PruneModal.js';
import { PinDomainModal } from './components/PinDomainModal.js';
import { HomePage } from './pages/HomePage.js';
import { FleetPage } from './pages/FleetPage.js';
import { InfraPage } from './pages/InfraPage.js';
import { SentinelPage } from './pages/SentinelPage.js';
import { GitProjectsPage } from './pages/GitProjectsPage.js';
import { ProcessesPage } from './pages/ProcessesPage.js';
import { AiAgentsPage } from './pages/AiAgentsPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { DiskUsagePage } from './pages/DiskUsagePage.js';
import { CloudflarePage } from './pages/CloudflarePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LegacyLayout } from './layouts/LegacyLayout.js';

// Lazy-loaded: xterm.js is heavy and only needed by owners who use SSH.
const TerminalPage = lazy(() => import('./pages/TerminalPage.js').then((m) => ({ default: m.TerminalPage })));
import { ContainerMetric } from './types.js';
import { MetricHistoryProvider } from './context/MetricHistoryContext.js';

function CockpitDashboard() {
  const { isAuthenticated, isLoading } = useAuth();
  const { snapshot, isConnected, lastUpdated, refetch } = useCockpitData();
  const { theme, setTheme, toggleTheme } = useTheme();

  const [activeLogContainer, setActiveLogContainer] = useState<ContainerMetric | null>(null);
  const [activeRestartContainer, setActiveRestartContainer] = useState<ContainerMetric | null>(null);
  const [activePowerAction, setActivePowerAction] = useState<PowerAction>('restart');
  const [activePinContainer, setActivePinContainer] = useState<ContainerMetric | null>(null);
  const [isPruneModalOpen, setIsPruneModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const throughput = useMemo(() => {
    const containers = snapshot?.containers || [];
    return {
      rx: containers.reduce((sum, c) => sum + c.networkRxRateBytesPerSec, 0),
      tx: containers.reduce((sum, c) => sum + c.networkTxRateBytesPerSec, 0),
    };
  }, [snapshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Keep the flag in sync when fullscreen is left with Esc or F11, not just via the menu.
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cockpit-bg">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-cockpit-accent border-t-transparent" />
        <span className="label text-cockpit-muted font-mono uppercase tracking-[0.1em] text-[10.5px]">Checking session</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  const layoutProps = {
    snapshot,
    isConnected,
    lastUpdated,
    isPrivacyMode,
    isFullscreen,
    theme,
    onTogglePrivacy: () => setIsPrivacyMode(!isPrivacyMode),
    onToggleFullscreen: toggleFullscreen,
    onToggleTheme: toggleTheme,
    onOpenCommandPalette: () => setIsCommandPaletteOpen(true),
    onRefresh: refetch,
  };

  const PageRoutes = () => (
    <>
      <Route path="fleet" element={
        <FleetPage
          snapshot={snapshot}
          containers={snapshot?.containers}
          isPrivacyMode={isPrivacyMode}
          onViewLogs={(c) => setActiveLogContainer(c)}
          onPowerAction={(c, action) => {
            setActivePowerAction(action);
            setActiveRestartContainer(c);
          }}
          onPinContainer={(c) => setActivePinContainer(c)}
        />
      } />
      <Route path="infra" element={
        <InfraPage 
          snapshot={snapshot} 
          isPrivacyMode={isPrivacyMode} 
          onOpenPruneModal={() => setIsPruneModalOpen(true)} 
        />
      } />
      <Route path="cloudflare" element={<CloudflarePage isPrivacyMode={isPrivacyMode} />} />
      <Route path="settings" element={
        <SettingsPage
          theme={theme}
          onSetTheme={setTheme}
          currentPveNode={snapshot?.host.pve?.nodeName}
          onSettingsUpdated={refetch}
        />
      } />
      <Route path="processes" element={<ProcessesPage isPrivacyMode={isPrivacyMode} />} />
      <Route path="sentinel" element={<SentinelPage sentinel={snapshot?.sentinel} />} />
      <Route path="ai-agents" element={<AiAgentsPage />} />
      <Route path="logs" element={<LogsPage isPrivacyMode={isPrivacyMode} />} />
      <Route path="disk-usage" element={<DiskUsagePage />} />
      <Route path="git-projects" element={<GitProjectsPage snapshot={snapshot} onRefetch={refetch} isPrivacyMode={isPrivacyMode} />} />
      <Route path="terminal" element={
        <Suspense fallback={<p className="label font-mono text-[10.5px]">Loading terminal…</p>}>
          <TerminalPage />
        </Suspense>
      } />
    </>
  );

  return (
    <MetricHistoryProvider snapshot={snapshot}>
      <div>
        <Routes>
          <Route path="/" element={<LegacyLayout {...layoutProps} />}>
            <Route index element={<HomePage snapshot={snapshot} throughput={throughput} isPrivacyMode={isPrivacyMode} />} />
            {PageRoutes()}
          </Route>
          
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          containers={snapshot?.containers}
          isPrivacyMode={isPrivacyMode}
        />

        {activeLogContainer && (
          <LogModal container={activeLogContainer} onClose={() => setActiveLogContainer(null)} />
        )}

        {activeRestartContainer && (
          <RestartModal
            container={activeRestartContainer}
            action={activePowerAction}
            onClose={() => setActiveRestartContainer(null)}
            onSuccess={() => refetch()}
          />
        )}

        {isPruneModalOpen && (
          <PruneModal
            hygiene={snapshot?.dockerHygiene}
            onClose={() => setIsPruneModalOpen(false)}
            onSuccess={() => refetch()}
          />
        )}

        {activePinContainer && (
          <PinDomainModal
            container={activePinContainer}
            onClose={() => setActivePinContainer(null)}
            onSaved={() => refetch()}
          />
        )}
      </div>
    </MetricHistoryProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CockpitDashboard />
      </BrowserRouter>
    </AuthProvider>
  );
}
