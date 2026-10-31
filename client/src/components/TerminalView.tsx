import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

// Soft keyboards have no Esc, Tab, Ctrl or arrow keys, so phones get a row of them.
const EXTRA_KEYS: { label: string; data: string; title: string }[] = [
  { label: 'Esc', data: '', title: 'Escape' },
  { label: 'Tab', data: '	', title: 'Tab' },
  { label: '^C', data: '', title: 'Ctrl+C' },
  { label: '^D', data: '', title: 'Ctrl+D' },
  { label: '↑', data: '[A', title: 'Arrow up' },
  { label: '↓', data: '[B', title: 'Arrow down' },
  { label: '←', data: '[D', title: 'Arrow left' },
  { label: '→', data: '[C', title: 'Arrow right' },
  { label: '|', data: '|', title: 'Pipe' },
  { label: '~', data: '~', title: 'Tilde' },
  { label: '/', data: '/', title: 'Slash' },
  { label: '-', data: '-', title: 'Dash' },
];

interface TerminalViewProps {
  target: string;
  onDisconnect: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ target, onDisconnect }) => {
  const { token } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed'>('connecting');
  const [session, setSession] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  const sendKey = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'input', data }));
    terminalRef.current?.focus();
  };

  useEffect(() => {
    if (!containerRef.current || !token) return;
    setStatus('connecting');

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 13,
      theme: {
        background: '#101115',
        foreground: '#eef0f4',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddon.fit();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?target=${encodeURIComponent(target)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      const { cols, rows } = terminal;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'error') {
            terminal.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
          }
          return;
        } catch {
          // not a control frame, fall through to raw write
        }
        terminal.write(event.data);
      } else {
        terminal.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => setStatus('closed');
    ws.onerror = () => setStatus('closed');

    const dataDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      ws.close();
      terminal.dispose();
      wsRef.current = null;
      terminalRef.current = null;
    };
  }, [target, token, session]);

  return (
    <div className="panel flex h-[calc(100dvh-15rem)] min-h-[320px] flex-col overflow-hidden md:h-[70vh]">
      <div className="panel-head flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[12px]">
          {status === 'connected' ? (
            <Wifi className="h-3.5 w-3.5 text-state-good" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-state-warn" />
          )}
          <span className="font-bold tracking-wider">{target}</span>
          <span className="opacity-75" role="status" aria-live="polite">
            ({status === 'connecting' ? 'connecting…' : status === 'connected' ? 'connected' : 'disconnected'})
          </span>
        </span>
        <div className="flex items-center gap-2">
          {status === 'closed' && (
            <button onClick={() => setSession((k) => k + 1)} className="btn-primary py-1 text-xs">
              Reconnect
            </button>
          )}
          <button onClick={onDisconnect} className="btn-ghost py-1 text-xs">
            Disconnect
          </button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 p-2 bg-[#101115]" />
      <div className="flex gap-1.5 overflow-x-auto border-t border-cockpit-border bg-cockpit-panel p-2 md:hidden" role="toolbar" aria-label="Extra keys">
        {EXTRA_KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            title={k.title}
            aria-label={k.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => sendKey(k.data)}
            className="btn-ghost min-w-[2.75rem] shrink-0 px-3 font-mono text-[12px]"
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
};
