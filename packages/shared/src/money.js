function decimalCents(value) {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('Nilai uang tidak valid.');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}
function decimalMoney(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function sumDecimalMoney(values) {
  return decimalMoney(values.reduce((sum, value) => sum + decimalCents(value), 0n));
}
module.exports = { decimalCents, decimalMoney, sumDecimalMoney };
