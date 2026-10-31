import React, { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CockpitSnapshot } from '../types.js';
import { Theme } from '../hooks/useTheme.js';
import { Header } from '../components/Header.js';
import { Sidebar } from '../components/Sidebar.js';
import { MobileNav } from '../components/MobileNav.js';
import { DasWatchdogAlert } from '../components/DasWatchdogAlert.js';

interface LegacyLayoutProps {
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

export const LegacyLayout: React.FC<LegacyLayoutProps> = (props) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setHeaderHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="flex min-h-screen flex-col bg-cockpit-bg text-cockpit-text transition-colors duration-250"
      style={{ '--header-h': headerHeight ? `${headerHeight}px` : '7.5rem' } as React.CSSProperties}
    >
      <div ref={headerRef}>
        <Header {...props} />
      </div>
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-start gap-5 px-4 sm:px-6 lg:px-8">
        <Sidebar />
        <main className="w-full min-w-0 flex-1 space-y-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 md:py-6">
          <DasWatchdogAlert storage={props.snapshot?.storage} />

          {props.snapshot?.host.pve && !props.snapshot.host.pve.connected && (
            <p className="rounded-panel border border-cockpit-border bg-cockpit-panel px-5 py-3.5 text-[12.5px] leading-relaxed text-cockpit-muted">
              <span className="font-semibold text-cockpit-text">Proxmox API not connected.</span> Set{' '}
              <code className="font-mono text-cockpit-accent">PROXMOX_TOKEN_ID</code> and{' '}
              <code className="font-mono text-cockpit-accent">PROXMOX_TOKEN_SECRET</code> in{' '}
              <code className="font-mono text-cockpit-accent">.env</code> to stream real hardware sensors and vzdump
              history from the PVE node. Showing simulated telemetry until then.
            </p>
          )}

          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
};
