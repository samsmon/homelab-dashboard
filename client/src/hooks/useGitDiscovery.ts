import { useCallback, useEffect, useState } from 'react';
import { GitDiscoveryResult } from '../types.js';
import { authFetch } from '../utils/api.js';

const REFRESH_MS = 60_000;

/**
 * Repositories found on the servers. The server rescans on its own schedule and caches the
 * answer, so this only re-reads that cache while the page is open; "scan" forces a fresh one.
 */
export function useGitDiscovery() {
  const [data, setData] = useState<GitDiscoveryResult | null>(null);
  const [error, setError] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/git-projects/discovered');
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as GitDiscoveryResult);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const scan = useCallback(async () => {
    setIsScanning(true);
    try {
      const res = await authFetch('/api/git-projects/scan', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as GitDiscoveryResult);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const setIgnored = useCallback(async (host: string, path: string, ignored: boolean) => {
    const res = await authFetch('/api/git-projects/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, path, ignored }),
    });
    if (res.ok) setData((await res.json()) as GitDiscoveryResult);
  }, []);

  return { data, error, isScanning, reload: load, scan, setIgnored };
}
