import React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

interface StateBlockProps {
  kind: 'loading' | 'empty' | 'error';
  /** Short headline; defaults per kind. */
  title?: string;
  message?: React.ReactNode;
  /** Shows a Retry button on error states. */
  onRetry?: () => void;
  action?: React.ReactNode;
}

const DEFAULT_TITLE: Record<StateBlockProps['kind'], string> = {
  loading: 'Loading…',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
};

/** One look for loading, empty and error states so every page reads the same. */
export const StateBlock: React.FC<StateBlockProps> = ({ kind, title, message, onRetry, action }) => {
  const Icon = kind === 'loading' ? Loader2 : kind === 'error' ? AlertTriangle : Inbox;
  const tone = kind === 'error' ? 'text-state-bad' : 'text-cockpit-muted';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className="flex flex-col items-center gap-2 px-5 py-8 text-center">
      <Icon className={`h-5 w-5 ${tone} ${kind === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
      <p className={`text-[13px] font-semibold ${kind === 'error' ? 'text-state-bad' : 'text-cockpit-text'}`}>{title ?? DEFAULT_TITLE[kind]}</p>
      {message && <p className="max-w-md text-[12px] leading-relaxed text-cockpit-muted">{message}</p>}
      {kind === 'error' && onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost mt-1 inline-flex items-center gap-1.5 text-[12px]">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
      {action}
    </div>
  );
};
