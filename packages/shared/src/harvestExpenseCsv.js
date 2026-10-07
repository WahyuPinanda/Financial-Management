/** Export exactly the expense records supplied by the selected harvest page. */
function createHarvestExpenseCsv(harvest) {
  const publication = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Makassar',
  });
  // Semicolon separator and decimal comma match Indonesian spreadsheet settings.
  const decimal = (value) => String(value).replace('.', ',');
  const rows = [
    [
      'Panen',
      'Tanggal panen',
      'ID pengeluaran',
      'Catatan',
      '1st Weight kg',
      '2nd Weight kg',
      'Overall Weight kg',
      'Upah Rp/kg',
      'Total upah Rp',
      'Ongkos supir Rp',
      'Pengeluaran Rp',
      'Status',
      'Publikasi WITA',
    ],
    ...harvest.expenses.map((expense, index) => [
      harvest.name,
      harvest.harvest_date,
      expense.id,
      `Pengeluaran #${index + 1}`,
      decimal(expense.first_weight),
      decimal(expense.second_weight),
      decimal(expense.overall_weight),
      decimal(expense.wage_per_kg),
      decimal(expense.labor_cost),
      decimal(expense.driver_cost),
      decimal(expense.total_expense),
      !expense.published_at ? 'Draft' : expense.editable ? 'Publikasi' : 'Terkunci',
      expense.published_at
        ? publication.format(new Date(expense.published_at))
        : 'Belum dipublikasikan',
    ]),
  ];
  const safe = (value) => {
    const text = String(value);
    return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  };
  return '\ufeff' + rows.map((row) => row.map(safe).join(';')).join('\r\n');
}
module.exports = { createHarvestExpenseCsv };
