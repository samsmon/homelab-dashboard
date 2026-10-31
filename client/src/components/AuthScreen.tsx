import React, { useState } from 'react';
import { Server, AlertCircle, ArrowRight, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const AuthScreen: React.FC = () => {
  const { isRegistered, login, register } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSetupMode = isRegistered === false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('Enter a username.');
      return;
    }

    if (!password) {
      setError('Enter a password.');
      return;
    }

    if (isSetupMode) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setIsLoading(true);
    const res = isSetupMode
      ? await register(username.trim(), password)
      : await login(username.trim(), password, rememberMe);
    setIsLoading(false);

    if (!res.success) {
      setError(res.message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cockpit-bg px-4 py-8 relative overflow-hidden">
      <div className="w-full max-w-md rounded-2xl border border-cockpit-border/80 bg-cockpit-panel/90 p-1 shadow-2xl backdrop-blur-xl animate-fade-in">
        <div className="flex items-center gap-3.5 border-b border-cockpit-border/70 p-6 bg-cockpit-topbar/40 rounded-t-2xl">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cockpit-border bg-cockpit-panel text-cockpit-accent shadow-sm">
            <Server className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[16px] font-bold tracking-tight text-cockpit-text">
              {isSetupMode ? 'Set Up Owner Access' : 'Dashboard Portal'}
            </h1>
            <p className="text-[12px] text-cockpit-muted">
              {isSetupMode ? 'First run · One master account only' : 'Authenticate to access server telemetry'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {isSetupMode && (
            <p className="rounded-xl border border-cockpit-accent/20 bg-cockpit-accent/5 p-3 text-[12px] leading-relaxed text-cockpit-muted">
              Create the owner account now. Registration locks permanently once created.
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-state-bad/30 bg-state-bad/10 p-3 text-[12.5px] text-state-bad animate-fade-in">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="cockpit-username" className="block text-[12px] font-bold text-cockpit-text">
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-3 pointer-events-none text-cockpit-muted">
                <User className="h-3.5 w-3.5" />
              </div>
              <input
                id="cockpit-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                placeholder="root or admin"
                className="field w-full pl-9 pr-3.5 font-mono text-[13px]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cockpit-password" className="block text-[12px] font-bold text-cockpit-text">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-3 pointer-events-none text-cockpit-muted">
                <Lock className="h-3.5 w-3.5" />
              </div>
              <input
                id="cockpit-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                placeholder="••••••••"
                className="field w-full pl-9 pr-10 font-mono text-[13px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-cockpit-muted hover:text-cockpit-text transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {isSetupMode && (
            <div className="space-y-1.5">
              <label htmlFor="cockpit-confirm" className="block text-[12px] font-bold text-cockpit-text">
                Confirm password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-3 pointer-events-none text-cockpit-muted">
                  <Lock className="h-3.5 w-3.5" />
                </div>
                <input
                  id="cockpit-confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  placeholder="••••••••"
                  className="field w-full pl-9 pr-10 font-mono text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-cockpit-muted hover:text-cockpit-text transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {!isSetupMode && (
            <label className="flex cursor-pointer items-center gap-2.5 py-1 text-[12.5px] text-cockpit-muted transition-colors hover:text-cockpit-text select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-cockpit-border bg-cockpit-bg accent-cockpit-accent cursor-pointer"
              />
              Stay signed in for 30 days
            </label>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn-primary w-full justify-center gap-2 py-2.5 text-[13px] font-bold mt-2"
          >
            {isLoading ? 'Authenticating…' : isSetupMode ? 'Create owner account' : 'Sign in to Dashboard'}
            {!isLoading && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </div>

      <p className="mt-4 font-mono text-[11px] text-cockpit-muted">
        Proxmox VE · Docker · Tailscale
      </p>
    </div>
  );
};
