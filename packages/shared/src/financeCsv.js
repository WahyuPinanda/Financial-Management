const financeCsvHeaders = [
  'Tanggal',
  'Jenis',
  'Kategori',
  'Keterangan',
  'Rekening asal',
  'Rekening tujuan',
  'Jumlah Rp',
  'Pengaruh cash Rp',
  'ID catatan',
  'ID bukti',
  'Versi catatan',
];
function csvCell(value, numeric = false) {
  const text = String(value ?? '');
  const safe =
    numeric && /^-?\d+(\.\d{1,2})?$/.test(text)
      ? text.replace('.', ',')
      : /^[\s]*[=+\-@]/.test(text)
        ? "'" + text
        : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function financeCsvRows(rows) {
  return (
    rows
      .map((row) =>
        [
          row.event_date,
          row.kind,
          row.category,
          row.description,
          row.accountName,
          row.destinationName,
          row.amount,
          row.cashDelta,
          row.source_id ?? row.id,
          row.receiptIds ?? '',
          row.source_version ?? '',
        ]
          .map((value, i) => csvCell(value, i === 6 || i === 7))
          .join(';'),
      )
      .join('\r\n') + (rows.length ? '\r\n' : '')
  );
}
const financeCsvHeader = () =>
  '\ufeff' + financeCsvHeaders.map((v) => csvCell(v)).join(';') + '\r\n';
module.exports = { financeCsvRows, financeCsvHeader };
