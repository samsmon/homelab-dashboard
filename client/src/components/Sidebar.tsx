import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  Boxes,
  Cloud,
  Server,
  GitBranch,
  Cpu,
  TerminalSquare,
  Bot,
  Sparkles,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ScrollText,
  HardDrive,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavRoute {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  routes: NavRoute[];
}

// Overview stands alone at the top; everything else is grouped so the menu
// stays scannable as features are added.
export const OVERVIEW_ROUTE: NavRoute = { path: '/', label: 'Overview', icon: Home };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    routes: [
      { path: '/fleet', label: 'Fleet', icon: Boxes },
      { path: '/infra', label: 'Infra', icon: Server },
      { path: '/processes', label: 'Processes', icon: Cpu },
      { path: '/disk-usage', label: 'Disk usage', icon: HardDrive },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    routes: [{ path: '/cloudflare', label: 'Cloudflare', icon: Cloud }],
  },
  {
    id: 'develop',
    label: 'Develop',
    routes: [
      { path: '/git-projects', label: 'Git projects', icon: GitBranch },
      { path: '/terminal', label: 'Terminal', icon: TerminalSquare },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    routes: [
      { path: '/sentinel', label: 'Sentinel', icon: Bot },
      { path: '/ai-agents', label: 'AI Agents', icon: Sparkles },
    ],
  },
  {
    id: 'system',
    label: 'System',
    routes: [
      { path: '/logs', label: 'Logs', icon: ScrollText },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const NAV_ROUTES: NavRoute[] = [OVERVIEW_ROUTE, ...NAV_GROUPS.flatMap((g) => g.routes)];

const STORAGE_KEY = 'cockpit-sidebar-collapsed';
const GROUPS_KEY = 'cockpit-sidebar-groups-closed';

const readClosedGroups = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export const Sidebar: React.FC = () => {
  const { pathname } = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);

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

  const toggleGroup = (id: string) => {
    setClosedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const isActivePath = (path: string) => (path === '/' ? pathname === '/' : pathname.startsWith(path));

  const linkClass = (isActive: boolean) =>
    `flex items-center rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-all duration-150 active:scale-95 ${
      isActive
        ? 'bg-cockpit-accent/10 text-cockpit-accent'
        : 'text-cockpit-muted hover:bg-cockpit-panelHover hover:text-cockpit-text'
    }`;

  const renderLink = (route: NavRoute, indented: boolean) => {
    const Icon = route.icon;
    return (
      <NavLink
        key={route.path}
        to={route.path}
        end={route.path === '/'}
        title={route.label}
        className={({ isActive }) => `${linkClass(isActive)} ${indented && !isCollapsed ? 'ml-2' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="truncate">{route.label}</span>}
        </div>
      </NavLink>
    );
  };

  return (
    <aside
      className={`hidden md:flex sticky top-[calc(var(--header-h,7.5rem)+1.5rem)] self-start max-h-[calc(100vh-var(--header-h,7.5rem)-2.5rem)] flex-col overflow-y-auto scrollbar-none rounded-2xl border border-cockpit-border/60 bg-cockpit-panel/85 backdrop-blur-xl shadow-panel transition-all duration-200 shrink-0 ${
        isCollapsed ? 'w-16' : 'w-56'
      }`}
    >
      <nav className="flex-1 space-y-1 p-3">
        {renderLink(OVERVIEW_ROUTE, false)}

        {NAV_GROUPS.map((group) => {
          const hasActive = group.routes.some((r) => isActivePath(r.path));
          const isClosed = !isCollapsed && closedGroups.includes(group.id);
          return (
            <div key={group.id} className="pt-1.5">
              {isCollapsed ? (
                <div className="mx-1 mb-1.5 border-t border-cockpit-border/60" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!isClosed}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors hover:text-cockpit-text ${
                    isClosed && hasActive ? 'text-cockpit-accent' : 'text-cockpit-muted'
                  }`}
                >
                  <span>{group.label}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${isClosed ? '-rotate-90' : ''}`} />
                </button>
              )}
              {!isClosed && <div className="space-y-0.5">{group.routes.map((r) => renderLink(r, true))}</div>}
            </div>
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
