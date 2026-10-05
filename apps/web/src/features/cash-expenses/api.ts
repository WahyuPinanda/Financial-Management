import type { CashExpense, CashExpenseCategory, CashExpenseInput } from '@sawit/shared';
import { request } from '../../lib/api';
export const cashExpenseApi = {
  list: () => request<{ data: CashExpense[] }>('/cash-expenses'),
  save: (category: CashExpenseCategory, input: CashExpenseInput, id?: string) =>
    request<{ data: CashExpense }>(`/cash-expenses/${category}${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(input),
    }),
};
