import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  Boxes,
  Server,
  GitBranch,
  Cpu,
  TerminalSquare,
  Bot,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
  ScrollText,
  HardDrive,
} from 'lucide-react';

export const NAV_ROUTES = [
  { path: '/', label: 'Overview', icon: Home },
  { path: '/fleet', label: 'Fleet', icon: Boxes },
  { path: '/infra', label: 'Infra', icon: Server },
  { path: '/git-projects', label: 'Git projects', icon: GitBranch },
  { path: '/processes', label: 'Processes', icon: Cpu },
  { path: '/terminal', label: 'Terminal', icon: TerminalSquare },
  { path: '/sentinel', label: 'Sentinel', icon: Bot },
  { path: '/ai-agents', label: 'AI Agents', icon: Sparkles },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/disk-usage', label: 'Disk usage', icon: HardDrive },
];

const STORAGE_KEY = 'cockpit-sidebar-collapsed';

export const Sidebar: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <aside
      className={`hidden md:flex sticky top-[calc(var(--header-h,7.5rem)+1.5rem)] self-start max-h-[calc(100vh-var(--header-h,7.5rem)-2.5rem)] flex-col overflow-y-auto scrollbar-none rounded-2xl border border-cockpit-border/60 bg-cockpit-panel/85 backdrop-blur-xl shadow-panel transition-all duration-200 shrink-0 ${
        isCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ROUTES.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink
              key={route.path}
              to={route.path}
              end={route.path === '/'}
              title={route.label}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-all duration-150 active:scale-95 ${
                  isActive
                    ? 'bg-cockpit-accent/10 text-cockpit-accent'
                    : 'text-cockpit-muted hover:bg-cockpit-panelHover hover:text-cockpit-text'
                }`
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span className="truncate">{route.label}</span>}
              </div>
            </NavLink>
          );
        })}
      </nav>

      <button
        onClick={toggle}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="flex h-10 items-center justify-center border-t border-cockpit-border text-cockpit-muted transition-all duration-150 hover:bg-cockpit-panelHover hover:text-cockpit-text active:scale-95"
      >
        {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
};
