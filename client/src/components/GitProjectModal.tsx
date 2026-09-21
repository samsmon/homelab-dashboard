import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Search, Trash2, X } from 'lucide-react';
import { ContainerMetric, GitProjectStatus, RebuildCommand } from '../types.js';
import { authFetch } from '../utils/api.js';

const REBUILD_OPTIONS: { value: RebuildCommand; label: string }[] = [
  { value: 'compose-up-build', label: 'docker compose up -d --build' },
  { value: 'compose-up-build-force-recreate', label: 'docker compose up -d --build --force-recreate' },
];

interface GitProjectModalProps {
  containers: ContainerMetric[];
  existingNames: string[];
  editingProject: GitProjectStatus | null;
  onClose: () => void;
  onSaved: () => void;
}

export const GitProjectModal: React.FC<GitProjectModalProps> = ({
  containers,
  existingNames,
  editingProject,
  onClose,
  onSaved,
}) => {
  const [containerName, setContainerName] = useState(editingProject?.containerName ?? '');
  const [hostFilter, setHostFilter] = useState('all');
  const [containerQuery, setContainerQuery] = useState(editingProject?.containerName ?? '');
  const [isContainerListOpen, setIsContainerListOpen] = useState(false);
  const containerFieldRef = useRef<HTMLDivElement>(null);
  const [repoSlug, setRepoSlug] = useState(
    editingProject ? `${editingProject.repoOwner}/${editingProject.repoName}` : ''
  );
  const [branch, setBranch] = useState(editingProject?.branch ?? 'main');
  const [localPath, setLocalPath] = useState(editingProject?.localPath ?? '');
  const [sshTarget, setSshTarget] = useState(editingProject?.sshTarget ?? '');
  const [sshTargets, setSshTargets] = useState<string[]>([]);
  const [rebuildCommand, setRebuildCommand] = useState<RebuildCommand | ''>(editingProject?.rebuildCommand ?? '');
  const [autoDeploy, setAutoDeploy] = useState(editingProject?.autoDeploy ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/ssh-targets')
      .then((res) => res.json())
      .then((data: { targets: string[] }) => setSshTargets(data.targets ?? []))
      .catch(() => {});
  }, []);

  const isEditing = Boolean(editingProject);
  const trackableContainers = containers.filter(
    (c) => c.name === editingProject?.containerName || !existingNames.includes(c.name)
  );

  const hostNames = useMemo(
    () => Array.from(new Set(trackableContainers.map((c) => c.dockerHost))).sort(),
    [trackableContainers]
  );

  const availableContainers = trackableContainers.filter(
    (c) => hostFilter === 'all' || c.dockerHost === hostFilter
  );

  const filteredContainers = availableContainers.filter((c) =>
    c.name.toLowerCase().includes(containerQuery.toLowerCase())
  );

  const selectContainer = (name: string) => {
    setContainerName(name);
    setContainerQuery(name);
    setIsContainerListOpen(false);
  };

  const handleSave = async () => {
    setError(null);
    const [repoOwner, repoName] = repoSlug.split('/').map((s) => s.trim());
    if (!containerName || !repoOwner || !repoName) {
      setError('Pick a container and enter the repo as owner/name.');
      return;
    }

    setIsSubmitting(true);
    try {
      await authFetch(`/api/git-projects/${encodeURIComponent(containerName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoOwner,
          repoName,
          branch: branch.trim() || 'main',
          localPath: localPath.trim() || undefined,
          sshTarget: sshTarget || undefined,
          rebuildCommand: rebuildCommand || undefined,
          autoDeploy: rebuildCommand ? autoDeploy : false,
        }),
      });
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnregister = async () => {
    if (!editingProject) return;
    setIsSubmitting(true);
    try {
      await authFetch(`/api/git-projects/${encodeURIComponent(editingProject.containerName)}`, {
        method: 'DELETE',
      });
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="overlay">
      <div className="panel modal-panel w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl shadow-black/60 my-auto animate-scale-up">
        <div className="panel-head shrink-0">
          <div>
            <h3 className="panel-title">{isEditing ? 'Edit git project' : 'Track a git project'}</h3>
            <p className="panel-sub">Checks GitHub for new commits on this repo's branch</p>
          </div>
          <button onClick={onClose} className="icon-btn" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 overflow-y-auto flex-1 scrollbar-thin">
          <p className="rounded-lg border border-state-warn/40 bg-state-warn/10 p-3 text-[11.5px] leading-snug text-state-warn">
            Pull &amp; rebuild targets this daemon's own Docker socket by default — that's only correct if the
            container actually runs there. If it runs on a different machine (a separate Docker host or LXC), pick
            its SSH target below so the pull and rebuild run over SSH on that host instead. Picking a host in the
            tab strip above only filters which container you're linking; it doesn't change where the rebuild runs.
          </p>

          {hostNames.length > 1 && (
            <div className="space-y-1.5">
              <label className="label block">Docker host</label>
              <div className="seg flex-wrap">
                <button
                  type="button"
                  onClick={() => setHostFilter('all')}
                  disabled={isSubmitting || isEditing}
                  className={`seg-btn ${hostFilter === 'all' ? 'seg-btn-on' : ''}`}
                >
                  All hosts
                </button>
                {hostNames.map((host) => (
                  <button
                    key={host}
                    type="button"
                    onClick={() => setHostFilter(host)}
                    disabled={isSubmitting || isEditing}
                    className={`seg-btn ${hostFilter === host ? 'seg-btn-on' : ''}`}
                  >
                    {host}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative space-y-1.5" ref={containerFieldRef}>
            <label htmlFor="git-container" className="label block">
              Container
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cockpit-muted" />
              <input
                id="git-container"
                type="text"
                placeholder="Search containers…"
                value={containerQuery}
                onChange={(e) => {
                  setContainerQuery(e.target.value);
                  setContainerName('');
                  setIsContainerListOpen(true);
                }}
                onFocus={() => setIsContainerListOpen(true)}
                onBlur={() => setTimeout(() => setIsContainerListOpen(false), 150)}
                disabled={isSubmitting || isEditing}
                className="field w-full !pl-9 pr-7"
                autoComplete="off"
              />
              {containerQuery && !isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setContainerQuery('');
                    setContainerName('');
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-cockpit-muted hover:text-cockpit-text"
                  title="Clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {isContainerListOpen && !isEditing && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-cockpit-border bg-cockpit-panel shadow-2xl shadow-black/80">
                {filteredContainers.length === 0 ? (
                  <p className="px-3 py-2.5 text-[12px] text-cockpit-muted">No matching containers</p>
                ) : (
                  filteredContainers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectContainer(c.name);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] text-cockpit-text hover:bg-cockpit-panelHover transition-colors"
                    >
                      <span className="truncate font-medium">{c.name}</span>
                      {hostNames.length > 1 && (
                        <span className="shrink-0 font-mono text-[10px] text-cockpit-muted">{c.dockerHost}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="git-repo" className="label block">
              Repository
            </label>
            <input
              id="git-repo"
              type="text"
              placeholder="owner/repo"
              value={repoSlug}
              onChange={(e) => setRepoSlug(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="git-branch" className="label block">
              Branch
            </label>
            <input
              id="git-branch"
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
          </div>

          <div className="space-y-1.5 border-t border-cockpit-border pt-4">
            <label htmlFor="git-ssh-target" className="label block">
              Runs on
            </label>
            <select
              id="git-ssh-target"
              value={sshTarget}
              onChange={(e) => setSshTarget(e.target.value)}
              disabled={isSubmitting}
              className="field w-full font-mono"
            >
              <option value="">This daemon (docker.sock)</option>
              {sshTargets.map((target) => (
                <option key={target} value={target}>
                  {target} (over SSH)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="git-local-path" className="label block">
              Local path (optional, enables pull &amp; rebuild)
            </label>
            <input
              id="git-local-path"
              type="text"
              placeholder={sshTarget ? '/home/user/myapp' : 'myapp'}
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
            <p className="text-[11.5px] text-cockpit-muted">
              {sshTarget ? (
                <>Absolute path to this project's working tree on <span className="font-mono">{sshTarget}</span>.</>
              ) : (
                <>
                  Folder name under your Git Projects root (<code className="font-mono">GIT_PROJECTS_ROOT</code>) —
                  this project's working tree must already exist there.
                </>
              )}
            </p>
          </div>

          {localPath.trim() && (
            <div className="space-y-1.5">
              <label htmlFor="git-rebuild-command" className="label block">
                Rebuild command
              </label>
              <select
                id="git-rebuild-command"
                value={rebuildCommand}
                onChange={(e) => setRebuildCommand(e.target.value as RebuildCommand)}
                disabled={isSubmitting}
                className="field w-full font-mono"
              >
                <option value="">Not set — pull &amp; rebuild stays disabled</option>
                {REBUILD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {localPath.trim() && rebuildCommand && (
            <label className="flex items-start gap-2.5 rounded-lg border border-cockpit-border bg-cockpit-bg p-3">
              <input
                type="checkbox"
                checked={autoDeploy}
                onChange={(e) => setAutoDeploy(e.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <span className="text-[12px] text-cockpit-text">
                <span className="font-semibold">Auto-deploy new commits</span>
                <span className="block text-cockpit-muted">
                  Pulls and rebuilds on its own as soon as a new commit appears — but only when nothing in the diff
                  looks like a database migration. A migration-risk file always waits for you to pull manually.
                </span>
              </span>
            </label>
          )}

          {error && <p className="text-[12px] text-state-bad">{error}</p>}

          <div className="flex items-center justify-between gap-2.5 pt-1">
            {isEditing ? (
              <button onClick={handleUnregister} disabled={isSubmitting} className="btn-ghost">
                <Trash2 className="h-3.5 w-3.5" />
                Stop tracking
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2.5">
              <button onClick={onClose} disabled={isSubmitting} className="btn-ghost">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isSubmitting} className="btn-primary">
                <GitBranch className="h-3.5 w-3.5" />
                {isEditing ? 'Update' : 'Track'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
