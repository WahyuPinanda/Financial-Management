import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatestRequest, type WorkspaceSnapshot } from '@sawit/shared';
import { request } from '../../lib/api';
import { errorMessage } from '../../lib/format';
import { previewWorkspace } from './previewWorkspace';
import type { WorkspaceQuery } from './types';
export function useWorkspace(query: WorkspaceQuery, preview: boolean) {
  const key = JSON.stringify(query);
  const [data, setData] = useState<WorkspaceSnapshot | null>(null);
  const [dataKey,setDataKey]=useState<string | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const latest=useRef(new LatestRequest());
  const refresh = useCallback(async () => {
    if (preview) return true;
    const operation=latest.current.begin();
    setLoading(true);
    setError('');
    try {
      const parsed: WorkspaceQuery = JSON.parse(key);
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(parsed))
        if (value !== undefined) params.set(name, String(value));
      const response = await request<{ data: WorkspaceSnapshot }>(`/workspace?${params}`, {
        signal: operation.signal,
      });
      if (!operation.isCurrent()) return false;
      setData(response.data);
      setDataKey(key);
      return true;
    } catch (error) {
      if (operation.isCurrent()) {
        setData(null);
        setError(errorMessage(error));
      }
      return false;
    } finally {
      if (operation.isCurrent()) setLoading(false);
    }
  }, [key, preview]);
  useEffect(() => {
    void refresh();
    return () => {
      latest.current.cancel();
    };
  }, [refresh]);
  useEffect(() => {
    if (preview) return;
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    const channel = new BroadcastChannel('cash-flow-updates');
    channel.onmessage = visible;
    const timer = window.setInterval(visible, 60000);
    return () => {
      clearInterval(timer);
      channel.close();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [refresh, preview]);
  const sample = useMemo(
    () => (preview ? previewWorkspace(JSON.parse(key)) : null),
    [key, preview],
  );
  return { data: preview ? sample : dataKey===key ? data : null, loading, error, refresh };
}
