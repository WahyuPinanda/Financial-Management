import { createHarvestExpenseCsv, type Harvest } from '@sawit/shared';

export function exportExpensesCsv(harvest: Harvest) {
  const blob = new Blob([createHarvestExpenseCsv(harvest)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pengeluaran-panen-${harvest.harvest_date}.csv`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to start reading the blob before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
