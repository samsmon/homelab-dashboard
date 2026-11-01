import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderPlus,
  FolderCog,
  GitBranch,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
  ArrowUpDown,
} from 'lucide-react';
import { authFetch } from '../utils/api.js';

interface Bookmark {
  id: string;
  name: string;
  url: string;
  group?: string;
}

const faviconFor = (url: string): string | null => {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=64&domain=${host}`;
  } catch {
    return null;
  }
};

const UNGROUPED = 'Shortcuts';

/** Modal for managing groups (create, view, rename, delete) */
const ManageGroupsModal: React.FC<{
  groups: string[];
  bookmarks: Bookmark[];
  onClose: () => void;
  onGroupAdded: (name: string) => Promise<void>;
  onGroupRenamed: (oldName: string, newName: string) => Promise<void>;
  onGroupDeleted: (name: string, deleteShortcuts: boolean) => Promise<void>;
}> = ({ groups, bookmarks, onClose, onGroupAdded, onGroupRenamed, onGroupDeleted }) => {
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ name: string; count: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    if (groups.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      setError('A group with this name already exists');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onGroupAdded(trimmed);
      setNewGroupName('');
    } catch (err: any) {
      setError(err?.message || 'Failed to create group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartRename = (name: string) => {
    setEditingGroup(name);
    setRenameValue(name);
    setError(null);
  };

  const handleSaveRename = async (oldName: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingGroup(null);
      return;
    }
    if (groups.some((g) => g.toLowerCase() === trimmed.toLowerCase() && g.toLowerCase() !== oldName.toLowerCase())) {
      setError('Group name is already in use');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onGroupRenamed(oldName, trimmed);
      setEditingGroup(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to rename group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePrompt = (name: string) => {
    const count = bookmarks.filter((b) => b.group === name).length;
    if (count === 0) {
      // Empty group, delete immediately
      onGroupDeleted(name, false);
    } else {
      setConfirmDeleteGroup({ name, count });
    }
  };

  const countForGroup = (name: string) => {
    return bookmarks.filter((b) => b.group === name).length;
  };

  return createPortal(
    <div className="overlay">
      <div className="panel modal-panel w-full max-w-md shadow-2xl shadow-black/50">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cockpit-accent" />
            <h3 className="panel-title">Manage Shortcut Groups</h3>
          </div>
          <button onClick={onClose} className="icon-btn" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {/* Create Group Form */}
          <form onSubmit={handleCreate} className="space-y-2">
            <label className="label block">Create New Group</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Contoh: Media, Work, Dev, Tools..."
                value={newGroupName}
                onChange={(e) => {
                  setNewGroupName(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                className="field flex-1"
                autoFocus
              />
              <button
                type="submit"
                disabled={isSubmitting || !newGroupName.trim()}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>
            {error && <p className="text-[11.5px] text-state-bad">{error}</p>}
          </form>

          {/* Delete confirmation modal overlay within groups */}
          {confirmDeleteGroup && (
            <div className="rounded-xl border border-state-bad/30 bg-state-bad/10 p-3.5 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-state-bad">
                  Delete group "{confirmDeleteGroup.name}"?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteGroup(null)}
                  className="text-cockpit-muted hover:text-cockpit-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11.5px] text-cockpit-muted leading-relaxed">
                This group contains <strong className="text-cockpit-text">{confirmDeleteGroup.count}</strong> shortcuts. Choose a deletion option:
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onGroupDeleted(confirmDeleteGroup.name, false);
                    setConfirmDeleteGroup(null);
                  }}
                  disabled={isSubmitting}
                  className="btn-ghost justify-start text-[11.5px] text-cockpit-text hover:bg-cockpit-panel"
                >
                  <Trash2 className="h-3 w-3 text-cockpit-muted" />
                  <span>Delete group only (move all links to Ungrouped)</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onGroupDeleted(confirmDeleteGroup.name, true);
                    setConfirmDeleteGroup(null);
                  }}
                  disabled={isSubmitting}
                  className="btn-ghost justify-start text-[11.5px] text-state-bad hover:bg-state-bad/20"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Delete group and its {confirmDeleteGroup.count} shortcuts</span>
                </button>
              </div>
            </div>
          )}

          {/* Available Groups List */}
          <div className="pt-2">
            <label className="label mb-2 block">Available Groups ({groups.length})</label>
            {groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-cockpit-border p-4 text-center text-[12px] text-cockpit-muted">
                No groups yet. Create a group above to organize your shortcuts.
              </div>
            ) : (
              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {groups.map((group) => {
                  const count = countForGroup(group);
                  const isEditingThis = editingGroup === group;

                  return (
                    <div
                      key={group}
                      className="flex items-center justify-between rounded-lg border border-cockpit-border bg-cockpit-bg px-3 py-2 text-[12.5px] gap-2"
                    >
                      {isEditingThis ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            disabled={isSubmitting}
                            className="field py-1 px-2 text-[12px] flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(group);
                              if (e.key === 'Escape') setEditingGroup(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(group)}
                            disabled={isSubmitting}
                            className="rounded p-1 text-state-good hover:bg-cockpit-panel"
                            title="Save name"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingGroup(null)}
                            className="rounded p-1 text-cockpit-muted hover:bg-cockpit-panel"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-semibold text-cockpit-text truncate">{group}</span>
                            <span className="pill pill-neutral font-mono text-[10px] shrink-0">
                              {count} shortcut
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartRename(group)}
                              className="rounded p-1 text-cockpit-muted hover:bg-cockpit-panel hover:text-cockpit-text transition-colors"
                              title="Rename group"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePrompt(group)}
                              className="rounded p-1 text-cockpit-muted hover:bg-cockpit-panel hover:text-state-bad transition-colors"
                              title="Delete group"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="btn-primary">
              Selesai
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const BookmarkModal: React.FC<{
  editing: Bookmark | null;
  groups: string[];
  initialGroup?: string;
  onOpenManageGroups: () => void;
  onClose: () => void;
  onSaved: () => void;
}> = ({ editing, groups, initialGroup, onOpenManageGroups, onClose, onSaved }) => {
  const [name, setName] = useState(editing?.name ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [group, setGroup] = useState(editing?.group ?? initialGroup ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !url.trim()) return;
    setIsSubmitting(true);
    try {
      if (editing) {
        await authFetch(`/api/bookmarks/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, url, group }),
        });
      } else {
        await authFetch('/api/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, url, group }),
        });
      }
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setIsSubmitting(true);
    try {
      await authFetch(`/api/bookmarks/${editing.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="overlay">
      <div className="panel modal-panel w-full max-w-sm shadow-2xl shadow-black/50">
        <div className="panel-head">
          <h3 className="panel-title">{editing ? 'Edit shortcut' : 'Add shortcut'}</h3>
          <button onClick={onClose} className="icon-btn" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="label block">Name</label>
            <input
              type="text"
              placeholder="YouTube"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
          </div>
          <div className="space-y-1.5">
            <label className="label block">URL</label>
            <input
              type="text"
              placeholder="youtube.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isSubmitting}
              className="field w-full"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="label block">Select Group</label>
              <button
                type="button"
                onClick={onOpenManageGroups}
                className="text-[11px] font-semibold text-cockpit-accent hover:underline inline-flex items-center gap-1"
              >
                <FolderPlus className="h-3 w-3" />
                <span>+ Manage Groups</span>
              </button>
            </div>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              disabled={isSubmitting}
              className="field w-full cursor-pointer"
            >
              <option value="">No Group (Default / Ungrouped)</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2.5 pt-1">
            {editing ? (
              <button onClick={handleDelete} disabled={isSubmitting} className="btn-ghost text-state-bad hover:bg-state-bad/10">
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2.5">
              <button onClick={onClose} disabled={isSubmitting} className="btn-ghost">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isSubmitting} className="btn-primary">
                {editing ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const BookmarksSection: React.FC = () => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [originalBookmarks, setOriginalBookmarks] = useState<Bookmark[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [initialGroup, setInitialGroup] = useState<string | undefined>(undefined);
  const [isManagingGroups, setIsManagingGroups] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  // Drag & drop bookmark across groups
  const [draggedBookmarkId, setDraggedBookmarkId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Collapsed / Minimized groups persistence
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('homelab_collapsed_bookmark_groups');
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      try {
        localStorage.setItem('homelab_collapsed_bookmark_groups', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const loadData = async () => {
    try {
      const [resB, resG] = await Promise.all([
        authFetch('/api/bookmarks'),
        authFetch('/api/bookmarks/groups'),
      ]);
      if (resB.ok) {
        const bData: Bookmark[] = await resB.json();
        setBookmarks(bData);
      }
      if (resG.ok) {
        const gData: string[] = await resG.json();
        setGroups(gData);
      }
    } catch (e) {
      console.warn('Failed to load bookmarks or groups:', e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGroupAdded = async (name: string) => {
    const res = await authFetch('/api/bookmarks/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.groups) setGroups(data.groups);
      await loadData();
    }
  };

  const handleGroupRenamed = async (oldName: string, newName: string) => {
    const res = await authFetch('/api/bookmarks/groups/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName }),
    });
    if (res.ok) {
      await loadData();
    }
  };

  const handleGroupDeleted = async (name: string, deleteShortcuts = false) => {
    const res = await authFetch(
      `/api/bookmarks/groups/${encodeURIComponent(name)}?deleteShortcuts=${deleteShortcuts}`,
      {
        method: 'DELETE',
      }
    );
    if (res.ok) {
      await loadData();
    }
  };

  // Move bookmark to a different group via drag & drop
  const handleMoveBookmarkToGroup = async (bookmarkId: string, targetGroup: string) => {
    const b = bookmarks.find((item) => item.id === bookmarkId);
    if (!b) return;

    const normalizedTarget = targetGroup === UNGROUPED ? '' : targetGroup;
    const currentGroup = b.group || '';
    if (currentGroup === normalizedTarget) return;

    // Optimistic UI update
    setBookmarks((prev) =>
      prev.map((item) => (item.id === bookmarkId ? { ...item, group: normalizedTarget || undefined } : item))
    );

    try {
      await authFetch(`/api/bookmarks/${bookmarkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: b.name,
          url: b.url,
          group: normalizedTarget,
        }),
      });
      await loadData();
    } catch (err) {
      console.error('Failed to move bookmark to group:', err);
      loadData();
    }
  };

  // Reorder mode handlers
  const handleStartReorder = () => {
    setOriginalBookmarks([...bookmarks]);
    setIsReordering(true);
  };

  const handleCancelReorder = () => {
    setBookmarks(originalBookmarks);
    setIsReordering(false);
    setDraggedIndex(null);
  };

  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    try {
      const res = await authFetch('/api/bookmarks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: bookmarks.map((b) => b.id) }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.bookmarks) {
          setBookmarks(data.bookmarks);
        }
      }
      setIsReordering(false);
      setDraggedIndex(null);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleReorderDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleReorderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex === null || draggedIndex === index) return;

    const updated = [...bookmarks];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    setBookmarks(updated);
  };

  const handleOpenAdd = (group?: string) => {
    setInitialGroup(group);
    setIsAdding(true);
  };

  // Combined unique groups: explicitly registered groups + groups currently in bookmarks
  const allGroups = useMemo(() => {
    const set = new Set(groups);
    for (const b of bookmarks) {
      if (b.group?.trim()) set.add(b.group.trim());
    }
    return Array.from(set).sort();
  }, [groups, bookmarks]);

  // Grouped entries to render on the dashboard:
  // 1. UNGROUPED (Shortcuts) if there are ungrouped bookmarks
  // 2. All user groups (including empty ones so user can drop into them)
  const groupSections = useMemo(() => {
    const result: { groupName: string; items: Bookmark[] }[] = [];

    // Check ungrouped bookmarks
    const ungroupedItems = bookmarks.filter((b) => !b.group?.trim());
    if (ungroupedItems.length > 0 || allGroups.length === 0) {
      result.push({ groupName: UNGROUPED, items: ungroupedItems });
    }

    // Add each defined group
    for (const g of allGroups) {
      const items = bookmarks.filter((b) => b.group === g);
      result.push({ groupName: g, items });
    }

    return result;
  }, [bookmarks, allGroups]);

  return (
    <section className="panel animate-fade-in-up stagger-2">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Shortcuts</h2>
          <p className="panel-sub">
            {isReordering
              ? 'Drag & drop shortcuts to set the order, then click Save'
              : 'Drag & drop shortcuts straight into the target group, or minimize the groups you want'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick link shortcut to GitHub Repo */}
          <a
            href="https://github.com/srytmj/homelab-dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            title="Open GitHub Repository"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Repo</span>
          </a>

          {/* Manage Groups session button */}
          {!isReordering && (
            <button
              onClick={() => setIsManagingGroups(true)}
              className="btn-ghost inline-flex items-center gap-1.5"
              title="Manage shortcut groups (create, edit, rename, delete)"
            >
              <Layers className="h-3.5 w-3.5 text-cockpit-accent" />
              <span className="hidden sm:inline">Manage Groups</span>
            </button>
          )}

          {isReordering ? (
            <>
              <button
                onClick={handleCancelReorder}
                disabled={isSavingOrder}
                className="btn-ghost"
                title="Cancel reordering"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                onClick={handleSaveOrder}
                disabled={isSavingOrder}
                className="btn-primary"
                title="Save new order"
              >
                <Check className="h-3.5 w-3.5" />
                {isSavingOrder ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <>
              {bookmarks.length > 1 && (
                <button
                  onClick={handleStartReorder}
                  className="btn-ghost"
                  title="Edit urutan shortcut (drag & drop)"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Edit Order</span>
                </button>
              )}
              <button onClick={() => handleOpenAdd()} className="btn-ghost">
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </>
          )}
        </div>
      </div>

      {bookmarks.length === 0 && allGroups.length === 0 ? (
        <div className="px-5 py-8 text-center flex flex-col items-center justify-center gap-3">
          <p className="text-[13px] text-cockpit-muted">
            No shortcuts saved yet. Add the links you use often.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleOpenAdd()}
              className="btn-primary flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Shortcut</span>
            </button>
            <button
              onClick={() => setIsManagingGroups(true)}
              className="btn-ghost flex items-center gap-1.5"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Create Group</span>
            </button>
          </div>
        </div>
      ) : isReordering ? (
        /* REORDER VIEW */
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {bookmarks.map((b, index) => {
            const favicon = faviconFor(b.url);
            return (
              <div
                key={b.id}
                draggable={true}
                onDragStart={(e) => handleReorderDragStart(e, index)}
                onDragOver={(e) => handleReorderDragOver(e, index)}
                onDragEnd={() => setDraggedIndex(null)}
                className={`shortcut-card group relative flex flex-col items-center justify-center gap-2 rounded-lg border p-3.5 text-center select-none transition-all cursor-grab active:cursor-grabbing ${
                  draggedIndex === index
                    ? 'border-cockpit-accent bg-cockpit-accent/15 opacity-40 scale-95 shadow-inner'
                    : 'border-cockpit-accent/40 bg-cockpit-accent/5 hover:border-cockpit-accent hover:bg-cockpit-panel'
                }`}
                title="Drag to reorder"
              >
                <div className="absolute left-1.5 top-1.5 text-cockpit-accent/70">
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                {favicon ? (
                  <img src={favicon} alt="" className="pointer-events-none h-7 w-7 rounded object-contain" />
                ) : (
                  <ExternalLink className="pointer-events-none h-7 w-7 text-cockpit-accent" />
                )}
                <span className="pointer-events-none w-full truncate text-[11.5px] font-medium text-cockpit-text">
                  {b.name}
                </span>
                {b.group && (
                  <span className="pointer-events-none font-mono text-[11px] text-cockpit-muted">
                    {b.group}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* NORMAL GROUPED VIEW WITH DRAG-TO-GROUP AND MINIMIZE */
        <div className="space-y-4 p-4">
          {groupSections.map(({ groupName, items }) => {
            const isCollapsed = collapsedGroups.has(groupName);
            const isHoveredDrop = dragOverGroup === groupName;

            return (
              <div
                key={groupName}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverGroup !== groupName) setDragOverGroup(groupName);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dragOverGroup === groupName) setDragOverGroup(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverGroup(null);
                  const bId = e.dataTransfer.getData('text/plain') || draggedBookmarkId;
                  if (bId) {
                    handleMoveBookmarkToGroup(bId, groupName);
                  }
                  setDraggedBookmarkId(null);
                }}
                className={`rounded-xl border transition-all ${
                  isHoveredDrop
                    ? 'border-cockpit-accent bg-cockpit-accent/10 shadow-md ring-2 ring-cockpit-accent/30'
                    : 'border-cockpit-border/60 bg-cockpit-bg/40'
                }`}
              >
                {/* Group Header with Minimize toggle */}
                <div
                  onClick={() => toggleGroupCollapse(groupName)}
                  className="flex cursor-pointer items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-cockpit-panel/50 rounded-t-xl select-none"
                  title="Click to minimize / expand group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      className="text-cockpit-muted hover:text-cockpit-text transition-transform"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <span className="font-bold text-[13px] text-cockpit-text truncate">
                      {groupName}
                    </span>
                    <span className="pill pill-neutral font-mono text-[10px]">
                      {items.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-cockpit-muted">
                    {isHoveredDrop && (
                      <span className="font-semibold text-cockpit-accent animate-pulse">
                        Release to move to this group
                      </span>
                    )}
                    <span className="text-[11px] opacity-70 hidden sm:inline">
                      {isCollapsed ? 'Minimized (click to open)' : 'Drag shortcut here'}
                    </span>
                    {/* Quick action buttons in group header */}
                    <div
                      className="flex items-center gap-1 pl-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenAdd(groupName === UNGROUPED ? undefined : groupName)}
                        className="icon-btn h-6 w-6 text-cockpit-muted hover:text-cockpit-text"
                        title={`Add shortcut to group ${groupName}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      {groupName !== UNGROUPED && (
                        <button
                          type="button"
                          onClick={() => setIsManagingGroups(true)}
                          className="icon-btn h-6 w-6 text-cockpit-muted hover:text-cockpit-text"
                          title="Manage this group in the modal"
                        >
                          <FolderCog className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Group Body: Shortcuts or Empty Drop Target */}
                {!isCollapsed && (
                  <div className="p-3 pt-0.5">
                    {items.length === 0 ? (
                      <div
                        className={`rounded-lg border-2 border-dashed p-5 text-center transition-all ${
                          isHoveredDrop
                            ? 'border-cockpit-accent bg-cockpit-accent/10 text-cockpit-accent'
                            : 'border-cockpit-border/80 text-cockpit-muted'
                        }`}
                      >
                        <p className="text-[12px] font-medium">
                          {isHoveredDrop
                            ? 'Release to add the shortcut to this group'
                            : 'This group is empty. Drag a shortcut here or click + to add one'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                        {items.map((b) => {
                          const favicon = faviconFor(b.url);
                          const isBeingDragged = draggedBookmarkId === b.id;

                          return (
                            <div
                              key={b.id}
                              draggable={true}
                              onDragStart={(e) => {
                                setDraggedBookmarkId(b.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', b.id);
                              }}
                              onDragEnd={() => {
                                setDraggedBookmarkId(null);
                                setDragOverGroup(null);
                              }}
                              className={`shortcut-card group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-cockpit-border bg-cockpit-bg p-3.5 text-center transition-all hover:border-cockpit-accent/50 hover:bg-cockpit-panel/60 active:scale-[0.98] cursor-grab active:cursor-grabbing select-none ${
                                isBeingDragged ? 'opacity-30 border-dashed border-cockpit-accent scale-95' : ''
                              }`}
                              title="Click to open the link, or drag to another group"
                            >
                              <a
                                href={b.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex flex-col items-center justify-center gap-2 w-full"
                                onClick={(e) => {
                                  // Don't open if dragged
                                  if (draggedBookmarkId) e.preventDefault();
                                }}
                              >
                                {favicon ? (
                                  <img
                                    src={favicon}
                                    alt=""
                                    className="pointer-events-none h-7 w-7 rounded object-contain"
                                  />
                                ) : (
                                  <ExternalLink className="pointer-events-none h-7 w-7 text-cockpit-muted" />
                                )}
                                <span className="pointer-events-none w-full truncate text-[11.5px] font-medium text-cockpit-text">
                                  {b.name}
                                </span>
                              </a>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditing(b);
                                }}
                                title="Edit shortcut"
                                className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-cockpit-muted opacity-0 transition-opacity hover:bg-cockpit-panel hover:text-cockpit-text group-hover:opacity-100"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Shortcut Modal */}
      {(isAdding || editing) && (
        <BookmarkModal
          editing={editing}
          groups={allGroups}
          initialGroup={initialGroup}
          onOpenManageGroups={() => setIsManagingGroups(true)}
          onClose={() => {
            setIsAdding(false);
            setEditing(null);
            setInitialGroup(undefined);
          }}
          onSaved={loadData}
        />
      )}

      {/* Manage Groups Modal */}
      {isManagingGroups && (
        <ManageGroupsModal
          groups={allGroups}
          bookmarks={bookmarks}
          onClose={() => setIsManagingGroups(false)}
          onGroupAdded={handleGroupAdded}
          onGroupRenamed={handleGroupRenamed}
          onGroupDeleted={handleGroupDeleted}
        />
      )}
    </section>
  );
};
