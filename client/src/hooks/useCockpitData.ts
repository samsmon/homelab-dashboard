import { useState, useEffect, useRef, useCallback } from 'react';
import { CockpitSnapshot } from '../types.js';
import { useAuth } from '../context/AuthContext.js';

export function useCockpitData() {
  const { token, isAuthenticated } = useAuth();
  const [snapshot, setSnapshot] = useState<CockpitSnapshot | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInitialSnapshot = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch('/api/snapshot', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data: CockpitSnapshot = await res.json();
        setSnapshot(data);
        setLastUpdated(new Date());
        setError(null);
      } else if (res.status === 401) {
        setError('Authentication required');
      }
    } catch (err: any) {
      console.warn('[useCockpitData] Initial snapshot fetch error:', err.message);
    }
  }, [token]);

  const connectWs = useCallback(() => {
    if (!token) return;

    if (socketRef.current) {
      socketRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'SNAPSHOT' && message.data) {
          setSnapshot(message.data);
          setLastUpdated(new Date());
        } else if (message.type === 'SNAPSHOT_DELTA' && message.data) {
          // Server only sends the top-level keys that changed since its last tick;
          // merge onto the existing snapshot rather than replacing it. If we somehow
          // don't have a base snapshot yet, drop it — a full one is always sent first.
          setSnapshot(prev => (prev ? { ...prev, ...message.data } : prev));
          setLastUpdated(new Date());
        }
      } catch (err) {
        console.error('[useCockpitData] Parse error:', err);
      }
    };

    ws.onerror = () => {
      setIsConnected(false);
      setError('Connection disrupted');
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isAuthenticated) {
          connectWs();
        }
      }, 3000);
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchInitialSnapshot();
      connectWs();

      const pollingInterval = setInterval(() => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          fetchInitialSnapshot();
        }
      }, 5000);

      return () => {
        clearInterval(pollingInterval);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        if (socketRef.current) {
          socketRef.current.close();
        }
      };
    } else {
      if (socketRef.current) {
        socketRef.current.close();
      }
      setSnapshot(null);
      setIsConnected(false);
    }
  }, [isAuthenticated, fetchInitialSnapshot, connectWs]);

  return {
    snapshot,
    isConnected,
    lastUpdated,
    error,
    refetch: fetchInitialSnapshot,
  };
}
