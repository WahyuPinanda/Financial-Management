import { useEffect, type RefObject } from 'react';
import { LatestRequest } from '@sawit/shared';
import { ApiError, request } from '../../lib/api';
import { errorMessage } from '../../lib/format';

type ExportStatus = { id: string; status: string; expires_at: string };

export function useExportPolling<T extends ExportStatus>({
  preview,
  revision,
  running,
  latest,
  onJobs,
  onError,
}: {
  preview: boolean;
  revision: number;
  running: RefObject<boolean>;
  latest: RefObject<LatestRequest>;
  onJobs: (jobs: T[]) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    if (preview) return;
    let stopped = false;
    let reading = false;
    let lastRead = -Infinity;
    let nextRead = 0;
    let retryDelay = 5000;
    let wakeOffset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState === 'visible' && navigator.onLine !== false;
    const clear = () => clearTimeout(timer);
    function schedule(delay: number) {
      clear();
      if (!stopped && visible()) {
        nextRead = Date.now() + delay;
        timer = setTimeout(() => void poll(), delay);
      }
    }
    async function poll() {
      if (stopped || reading || running.current || !visible()) return;
      clear();
      reading = true;
      lastRead = Date.now();
      const op = latest.current.begin();
      let nextDelay: number | undefined;
      try {
        const listed = await request<{ data: T[] }>('/exports', { signal: op.signal });
        if (stopped || !op.isCurrent() || !visible()) return;
        onJobs(listed.data);
        onError('');
        const pending = listed.data.filter(
          (job) =>
            ['queued', 'processing'].includes(job.status) &&
            Date.parse(job.expires_at) > Date.now(),
        );
        // Two workers can run per instance. Rotate jobs so large queues do not flood
        // the API with one status request per job or starve jobs at the end.
        for (let i = 0; i < Math.min(2, pending.length); i++) {
          if (stopped || !op.isCurrent() || !visible()) return;
          const job = pending[(wakeOffset + i) % pending.length];
          await request(`/exports/${job.id}`, { signal: op.signal });
        }
        wakeOffset = pending.length ? (wakeOffset + 2) % pending.length : 0;
        retryDelay = 5000;
        if (pending.length) nextDelay = 5000;
      } catch (error) {
        if (stopped || !op.isCurrent()) return;
        onError(errorMessage(error));
        if (!(error instanceof ApiError && [401, 403].includes(error.status))) {
          nextDelay = error instanceof ApiError && error.status === 429 ? 60000 : retryDelay;
          retryDelay = Math.min(retryDelay * 2, 60000);
        }
      } finally {
        reading = false;
        if (nextDelay !== undefined && op.isCurrent()) schedule(nextDelay);
        else if (!stopped && !op.isCurrent() && visible() && !running.current)
          schedule(Math.max(0, nextRead - Date.now(), 5000 - (Date.now() - lastRead)));
      }
    }
    function activate() {
      if (!visible()) {
        clear();
        latest.current.cancel();
      } else if (!reading && !running.current) {
        // visibilitychange and focus often arrive together.
        schedule(Math.max(0, nextRead - Date.now(), 5000 - (Date.now() - lastRead)));
      }
    }
    void poll();
    document.addEventListener('visibilitychange', activate);
    window.addEventListener('focus', activate);
    window.addEventListener('online', activate);
    window.addEventListener('offline', activate);
    return () => {
      stopped = true;
      clear();
      latest.current.cancel();
      document.removeEventListener('visibilitychange', activate);
      window.removeEventListener('focus', activate);
      window.removeEventListener('online', activate);
      window.removeEventListener('offline', activate);
    };
  }, [preview, revision, running, latest, onJobs, onError]);
}
