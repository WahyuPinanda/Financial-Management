import type { CashExpense, CashExpenseCategory, CashExpenseInput } from '@sawit/shared';
import { request, mutationHeaders } from '../../lib/api';
export const cashExpenseApi = {
  list: () => request<{ data: CashExpense[] }>('/cash-expenses'),
  save: (
    category: CashExpenseCategory,
    input: CashExpenseInput,
    requestKey: string,
    id?: string,
    version?: number,
  ) =>
    request<{ data: CashExpense }>(`/cash-expenses/${category}${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(input),
      headers: mutationHeaders(requestKey, version),
    }),
};
