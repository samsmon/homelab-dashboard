import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, GitBranch, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { CockpitSnapshot, GitProjectStatus } from '../types.js';
import { GitProjectModal } from '../components/GitProjectModal.js';
import { GitPullInline } from '../components/GitPullInline.js';
import { authFetch } from '../utils/api.js';

interface GitProjectsPageProps {
  snapshot: CockpitSnapshot | null;
  onRefetch: () => void;
}

export const GitProjectsPage: React.FC<GitProjectsPageProps> = ({ snapshot, onRefetch }) => {
  const [editingProject, setEditingProject] = useState<GitProjectStatus | null>(null);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [markingDeployed, setMarkingDeployed] = useState<string | null>(null);

  const projects = snapshot?.gitProjects ?? [];
  const containers = snapshot?.containers ?? [];
  const isEditModalOpen = isAdding || editingProject !== null;

  const closeEditModal = () => {
    setIsAdding(false);
    setEditingProject(null);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await authFetch('/api/git-projects/refresh', { method: 'POST' });
      onRefetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMarkDeployed = async (containerName: string) => {
    setMarkingDeployed(containerName);
    try {
      await authFetch(`/api/git-projects/${encodeURIComponent(containerName)}/mark-deployed`, { method: 'POST' });
      onRefetch();
    } finally {
      setMarkingDeployed(null);
    }
  };

  return (
    <>
      <section className="panel overflow-hidden">
        <div className="panel-head flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="panel-title">Git projects</h2>
            <p className="panel-sub">
              {projects.length === 0 ? 'Nothing tracked yet' : `${projects.length} tracked`} · click refresh to check for newest commits
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || projects.length === 0}
              title="Fetch newest commit version from GitHub to detect container updates"
              className="btn-ghost inline-flex items-center gap-2 text-[12px] font-medium disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-cockpit-accent' : ''}`} />
              <span>{isRefreshing ? 'Fetching newest commits…' : 'Refresh to get newest commit version'}</span>
            </button>
            <button onClick={() => setIsAdding(true)} className="btn-primary">
              <Plus className="h-3.5 w-3.5" />
              Track a project
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="animate-fadeIn px-5 py-10 text-center text-[13px] text-cockpit-muted">
            Track a container that's built from your own git repo — a personal project, not an off-the-shelf
            service — to see when it has new commits upstream.
          </p>
        ) : (
          <div className="px-5 py-1.5">
            {projects.map((project) => {
              const canPull = Boolean(project.localPath && project.rebuildCommand);
              const canMarkDeployed = Boolean(project.localPath);
              const isExpanded = expandedContainer === project.containerName;

              return (
                <div key={project.containerName} className="border-b border-cockpit-border last:border-b-0">
                  <div className="data-row flex-wrap gap-3 border-b-0">
                    <button
                      onClick={() => setEditingProject(project)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      title="Edit this project"
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-cockpit-muted" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="block font-semibold text-cockpit-text">{project.containerName}</span>
                          {project.autoDeploy && (
                            <span className="pill pill-accent" title="Auto-deploys safe commits on its own">
                              Auto
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-cockpit-muted">
                          {project.repoOwner}/{project.repoName}@{project.branch}
                          {project.sshTarget && ` · ssh:${project.sshTarget}`}
                        </span>
                        {project.autoDeployBlocked && (
                          <span className="block text-[11px] text-state-warn">
                            Auto-deploy paused — a migration-risk file was detected, pull manually to review it
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2.5">
                      {project.latestCommitMessage ? (
                        <span className="hidden text-right sm:block">
                          <span className="block max-w-[240px] truncate text-[12px] text-cockpit-text">
                            {project.latestCommitMessage}
                          </span>
                          <span className="block font-mono text-[10.5px] text-cockpit-muted">
                            {project.latestCommitDate ? new Date(project.latestCommitDate).toLocaleString() : ''}
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-cockpit-muted">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          checking…
                        </span>
                      )}
                      {project.lastPullStatus === 'failed' ? (
                        <div className="flex items-center gap-1.5">
                          <span className="pill pill-bad" title={project.lastPullMessage || 'Deploy failed'}>
                            Deploy failed
                          </span>
                          {canPull && (
                            <button
                              type="button"
                              onClick={() => setExpandedContainer(project.containerName)}
                              className="btn-danger flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold animate-pulse hover:animate-none"
                              title="Open console to Force Pull & Redeploy"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Force Pull & Redeploy</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className={`pill ${project.hasUpdate ? 'pill-warn' : 'pill-neutral'}`}>
                          {project.hasUpdate ? 'Update available' : project.lastKnownSha ? 'Up to date' : 'Not deployed yet'}
                        </span>
                      )}
                      {canMarkDeployed && (
                        <button
                          onClick={() => handleMarkDeployed(project.containerName)}
                          disabled={markingDeployed === project.containerName}
                          title="Sync the deployed marker with whatever commit is actually checked out right now — use this if the status looks wrong (e.g. still says Update available with nothing left to pull)"
                          className="icon-btn hover:border-state-good/40 hover:text-state-good disabled:opacity-30"
                        >
                          <CheckCircle2
                            className={`h-3.5 w-3.5 ${markingDeployed === project.containerName ? 'animate-pulse' : ''}`}
                          />
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedContainer(isExpanded ? null : project.containerName)}
                        disabled={!canPull}
                        title={canPull ? 'Open pull & redeploy options' : 'Set a local path and rebuild command to enable this'}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                          isExpanded
                            ? 'border-cockpit-accent bg-cockpit-accent/15 text-cockpit-accent'
                            : 'border-cockpit-border bg-cockpit-panel text-cockpit-text hover:border-cockpit-accent/40 hover:text-cockpit-accent'
                        } disabled:opacity-30`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span className="hidden sm:inline">{isExpanded ? 'Close Console' : 'Pull & Deploy'}</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && <GitPullInline project={project} onDone={onRefetch} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isEditModalOpen && (
        <GitProjectModal
          containers={containers}
          existingNames={projects.map((p) => p.containerName)}
          editingProject={editingProject}
          onClose={closeEditModal}
          onSaved={onRefetch}
        />
      )}
    </>
  );
};
