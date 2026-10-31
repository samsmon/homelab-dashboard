import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { NAV_GROUPS, NAV_ROUTES } from './Sidebar.js';

// Routes pinned to the bottom bar; everything else goes in the "More" sheet.
const PRIMARY_PATHS = ['/', '/fleet', '/infra', '/git-projects'];

export const MobileNav: React.FC = () => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { pathname } = useLocation();

  const primary = NAV_ROUTES.filter((r) => PRIMARY_PATHS.includes(r.path));
  const moreGroups = NAV_GROUPS.map((g) => ({ ...g, routes: g.routes.filter((r) => !PRIMARY_PATHS.includes(r.path)) })).filter(
    (g) => g.routes.length > 0,
  );
  const moreIsActive = moreGroups.some((g) => g.routes.some((r) => pathname.startsWith(r.path)));

  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  const itemClass = (active: boolean) =>
    `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors active:scale-95 ${
      active ? 'text-cockpit-accent' : 'text-cockpit-muted'
    }`;

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-cockpit-border bg-cockpit-topbar/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {primary.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink key={route.path} to={route.path} end={route.path === '/'} className={({ isActive }) => itemClass(isActive)}>
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate">{route.label}</span>
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setIsMoreOpen(true)} className={itemClass(moreIsActive)}>
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      {isMoreOpen &&
        createPortal(
          <div className="overlay !items-end !p-0 md:hidden" onClick={() => setIsMoreOpen(false)}>
            <div
              className="modal-panel max-h-[85vh] w-full overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="panel-title">More</h2>
                <button type="button" onClick={() => setIsMoreOpen(false)} className="icon-btn" title="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                {moreGroups.map((group) => (
                  <section key={group.id}>
                    <h3 className="label mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.1em]">{group.label}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {group.routes.map((route) => {
                        const Icon = route.icon;
                        return (
                          <NavLink
                            key={route.path}
                            to={route.path}
                            className={({ isActive }) =>
                              `flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 text-[13px] font-medium transition-all active:scale-95 ${
                                isActive
                                  ? 'border-cockpit-accent/50 bg-cockpit-accent/10 text-cockpit-accent'
                                  : 'border-cockpit-border/80 bg-cockpit-bg/50 text-cockpit-text'
                              }`
                            }
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{route.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
