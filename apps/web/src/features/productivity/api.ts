import { request, mutationHeaders } from '../../lib/api';
import type { Money } from '@sawit/shared';
export interface GardenCostOption {
  id: string;
  date: string;
  items: { description: string; amount: number }[];
  amount: Money;
  available: Money;
  allocated: Money;
  allocationId: string | null;
  version: number | null;
  editable: boolean;
}
export const productivityApi = {
  command: (
    kind: 'template' | 'apply_template' | 'allocate_cost',
    fields: Record<string, unknown>,
    key: string,
    id?: string,
    version?: number,
  ) =>
    request(`/productivity/${kind}${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(fields),
      headers: mutationHeaders(key, version),
    }),
  gardenCosts: (params: URLSearchParams, signal: AbortSignal) =>
    request<{ data: { rows: GardenCostOption[]; hasNext: boolean } }>(
      `/garden-cost-options?${params}`,
      { signal },
    ),
};
