import type { Harvest } from '@sawit/shared';

export function exportCsv(harvests: Harvest[]) {
  const rows = [
    [
      'Panen',
      'Tanggal panen',
      'Perusahaan',
      'Tanggal SPK',
      'Janjang',
      '1st Weight kg',
      '2nd Weight kg',
      'Potongan kg',
      'Potongan %',
      'Harga Rp/kg',
      'Berat bersih kg',
      'Pendapatan Rp',
      'Status',
      'Publikasi UTC',
    ],
    ...harvests.flatMap((h) =>
      h.spks.map((s) => [
        h.name,
        h.harvest_date,
        s.company_name,
        s.delivery_date,
        s.bunch_count,
        s.first_weight,
        s.second_weight,
        s.deduction_kg,
        s.deduction_percent,
        s.price_per_kg,
        s.net_weight,
        s.total_income,
        s.published_at ? 'Publikasi' : 'Draft',
        s.published_at ?? '',
      ]),
    ),
  ];
  // Quoting alone does not prevent spreadsheet formula injection.
  const safe = (v: string | number) => {
    const text = String(v);
    return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(['\ufeff' + rows.map((row) => row.map(safe).join(';')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pendapatan-panen.csv';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
