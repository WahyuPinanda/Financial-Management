import type { PageKind } from '@sawit/shared';
export interface WorkspaceQuery {
  view: string;
  month: string;
  year: number;
  period: 'month' | 'year';
  search: string;
  harvest_id?: string;
  harvest_after?: string;
  spk_after?: string;
  expense_after?: string;
  cash_after?: string;
}
export type PageCursors = Record<PageKind, (string | undefined)[]>;
export const firstPages = (): PageCursors => ({
  harvest: [undefined],
  spk: [undefined],
  expense: [undefined],
  cash: [undefined],
});
