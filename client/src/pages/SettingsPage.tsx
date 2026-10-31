import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, Eye, EyeOff, Key, Lock, Moon, RotateCcw, Save, ShieldAlert, ShieldCheck, Sun } from 'lucide-react';
import { authFetch } from '../utils/api.js';
import { Theme } from '../hooks/useTheme.js';

interface SettingsPageProps {
  theme: Theme;
  onSetTheme: (theme: Theme) => void;
  currentPveNode?: string;
  onSettingsUpdated?: () => void;
}

const Notice: React.FC<{ tone: 'good' | 'bad'; children: React.ReactNode }> = ({ tone, children }) => {
  const Icon = tone === 'good' ? CheckCircle2 : ShieldAlert;
  const cls = tone === 'good' ? 'border-state-good/30 bg-state-good/10 text-state-good' : 'border-state-bad/30 bg-state-bad/10 text-state-bad';
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`flex items-center gap-2 rounded-xl border p-3 text-[12px] animate-fade-in ${cls}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
};

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon: React.ReactNode;
  minLength?: number;
  invalid?: boolean;
  aside?: React.ReactNode;
}

const PasswordField: React.FC<PasswordFieldProps> = ({ id, label, value, onChange, placeholder, icon, minLength, invalid, aside }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-[12px] font-bold text-cockpit-text">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3 text-cockpit-muted">{icon}</div>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={id === 'current-password' ? 'current-password' : 'new-password'}
          className={`field w-full pl-9 pr-11 font-mono text-[13px] ${invalid ? 'border-state-bad' : ''}`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-center text-cockpit-muted transition-colors hover:text-cockpit-text"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
};

export const SettingsPage: React.FC<SettingsPageProps> = ({ theme, onSetTheme, currentPveNode, onSettingsUpdated }) => {
  const [primaryNodeName, setPrimaryNodeName] = useState<string>(() => localStorage.getItem('cockpit_primary_node_name') || '');
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [nodeSuccess, setNodeSuccess] = useState<string | null>(null);
  const [nodeError, setNodeError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.primaryNodeName) {
          setPrimaryNodeName(data.primaryNodeName);
          localStorage.setItem('cockpit_primary_node_name', data.primaryNodeName);
        } else if (currentPveNode) {
          setPrimaryNodeName(currentPveNode);
        }
      })
      .catch(() => {});
  }, [currentPveNode]);

  const handleSaveNodeName = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingNode(true);
    setNodeSuccess(null);
    setNodeError(null);
    const trimmed = primaryNodeName.trim();
    try {
      if (trimmed) localStorage.setItem('cockpit_primary_node_name', trimmed);
      else localStorage.removeItem('cockpit_primary_node_name');
      window.dispatchEvent(new CustomEvent('cockpit_settings_updated', { detail: { primaryNodeName: trimmed } }));

      const res = await authFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ primaryNodeName: trimmed }) });
      const data = await res.json();
      if (res.ok) {
        setNodeSuccess('Node name saved.');
        onSettingsUpdated?.();
        setTimeout(() => setNodeSuccess(null), 4000);
      } else {
        setNodeError(data?.error || 'Failed to update the node name on the server.');
      }
    } catch {
      setNodeError('Network error while saving settings.');
    } finally {
      setIsSavingNode(false);
    }
  };

  const handleResetNodeName = async () => {
    setIsSavingNode(true);
    setNodeSuccess(null);
    setNodeError(null);
    try {
      localStorage.removeItem('cockpit_primary_node_name');
      window.dispatchEvent(new CustomEvent('cockpit_settings_updated', { detail: { primaryNodeName: '' } }));
      const res = await authFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ primaryNodeName: '' }) });
      if (res.ok) {
        setPrimaryNodeName(currentPveNode || '');
        setNodeSuccess('Reset to the default node name.');
        onSettingsUpdated?.();
        setTimeout(() => setNodeSuccess(null), 4000);
      }
    } catch {
      setNodeError('Failed to reset the node name.');
    } finally {
      setIsSavingNode(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setIsChangingPassword(true);
    try {
      const res = await authFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await res.json();
      if (res.ok && data.success) {
        setPasswordSuccess('Password updated. The next login needs the new password.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setPasswordSuccess(null), 5000);
      } else {
        setPasswordError(data?.message || 'Failed to change password. Check your current password.');
      }
    } catch {
      setPasswordError('Network error while changing password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const strength = (() => {
    if (!newPassword) return { score: 0, text: '', color: '' };
    let score = 0;
    if (newPassword.length >= 6) score += 1;
    if (newPassword.length >= 10) score += 1;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1;
    if (/[0-9]/.test(newPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1;
    if (score <= 2) return { score: 1, text: 'Weak', color: 'bg-state-bad' };
    if (score <= 3) return { score: 2, text: 'Moderate', color: 'bg-state-warn' };
    return { score: 3, text: 'Strong', color: 'bg-state-good' };
  })();

  const mismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;

  const themeOption = (value: Theme, label: string, hint: string, icon: React.ReactNode, iconClass: string) => (
    <button
      type="button"
      onClick={() => onSetTheme(value)}
      aria-pressed={theme === value}
      className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition-all ${
        theme === value ? 'border-cockpit-accent bg-cockpit-accent/15 shadow-sm' : 'border-cockpit-border bg-cockpit-bg/50 hover:border-cockpit-border/80'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm ${iconClass}`}>{icon}</div>
        <div>
          <p className="text-[12.5px] font-bold text-cockpit-text">{label}</p>
          <p className="text-[10.5px] text-cockpit-muted">{hint}</p>
        </div>
      </div>
      {theme === value && <Check className="h-4 w-4 text-cockpit-accent" />}
    </button>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-cockpit-text">Settings</h1>
        <p className="text-[12px] text-cockpit-muted">Node identity, appearance and security</p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Primary node name</h2>
            <p className="panel-sub">
              Replaces the default <code className="font-mono text-cockpit-accent">pve</code> label with your own, for example homelab-server.
            </p>
          </div>
        </div>
        <form onSubmit={handleSaveNodeName} className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <label htmlFor="node-name" className="sr-only">
              Primary node name
            </label>
            <input
              id="node-name"
              type="text"
              value={primaryNodeName}
              onChange={(e) => setPrimaryNodeName(e.target.value)}
              placeholder={currentPveNode || 'e.g. homelab-server'}
              className="field min-w-0 flex-1 basis-48 font-mono text-[13px]"
            />
            <button type="submit" disabled={isSavingNode} className="btn-primary inline-flex items-center gap-1.5 px-3.5 text-[12px] font-bold">
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
            <button
              type="button"
              onClick={handleResetNodeName}
              disabled={isSavingNode}
              title="Reset to the default hypervisor node name"
              className="btn-ghost inline-flex items-center gap-1 px-3 text-[12px]"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          {nodeSuccess && <Notice tone="good">{nodeSuccess}</Notice>}
          {nodeError && <Notice tone="bad">{nodeError}</Notice>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Appearance</h2>
            <p className="panel-sub">Dark for low light, light for daytime. Remembered on this device.</p>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          {themeOption('dark', 'Dark mode', 'OLED contrast', <Moon className="h-4 w-4" />, 'border-zinc-700 bg-zinc-900 text-zinc-100')}
          {themeOption('light', 'Light mode', 'Daylight reading', <Sun className="h-4 w-4" />, 'border-amber-300 bg-amber-100 text-amber-900')}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Change password</h2>
            <p className="panel-sub">Applies to every device the next time it logs in.</p>
          </div>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4 px-5 py-4">
          <div className="flex items-start gap-3 rounded-xl border border-cockpit-accent/20 bg-cockpit-accent/5 p-3.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cockpit-accent" />
            <p className="text-[12px] leading-relaxed text-cockpit-muted">This is your root login credential. Use at least 6 characters.</p>
          </div>

          <PasswordField
            id="current-password"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Enter current password"
            icon={<Lock className="h-3.5 w-3.5" />}
          />
          <div className="space-y-1.5">
            <PasswordField
              id="new-password"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="At least 6 characters"
              icon={<Key className="h-3.5 w-3.5" />}
              minLength={6}
              aside={
                newPassword ? (
                  <span className="font-mono text-[11px] text-cockpit-muted">
                    Strength:{' '}
                    <strong className={strength.score === 1 ? 'text-state-bad' : strength.score === 2 ? 'text-state-warn' : 'text-state-good'}>
                      {strength.text}
                    </strong>
                  </span>
                ) : undefined
              }
            />
            {newPassword && (
              <div className="flex gap-1.5">
                {[1, 2, 3].map((n) => (
                  <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${strength.score >= n ? strength.color : 'bg-cockpit-border'}`} />
                ))}
              </div>
            )}
          </div>
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Re-enter new password"
            icon={<Key className="h-3.5 w-3.5" />}
            minLength={6}
            invalid={mismatch}
          />
          {mismatch && <p className="text-[11px] font-medium text-state-bad">Passwords do not match.</p>}

          {passwordSuccess && <Notice tone="good">{passwordSuccess}</Notice>}
          {passwordError && <Notice tone="bad">{passwordError}</Notice>}

          <button type="submit" disabled={isChangingPassword || mismatch} className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-bold sm:w-auto sm:px-6">
            <Key className="h-4 w-4" />
            {isChangingPassword ? 'Updating password…' : 'Save new password'}
          </button>
        </form>
      </section>
    </div>
  );
};
