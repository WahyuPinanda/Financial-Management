import type { FinanceSnapshot } from '@sawit/shared';
import { request, mutationHeaders } from '../../lib/api';
export type FinanceCommand = 'activate' | 'account' | 'transfer' | 'correction' | 'goal' | 'budget';
export const financeApi = {
  read: (params: URLSearchParams, signal?: AbortSignal) =>
    request<{ data: FinanceSnapshot }>(`/finance?${params}`, { signal }),
  command: (
    kind: FinanceCommand,
    fields: Record<string, unknown>,
    key: string,
    id?: string,
    version?: number,
  ) =>
    request(`/finance/${kind}${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(fields),
      headers: mutationHeaders(key, version),
    }),
};
