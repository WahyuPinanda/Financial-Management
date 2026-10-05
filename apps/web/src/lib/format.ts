export const number = (value: number, digits = 2) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(value);
export const rupiah = (value: number | string) => {
  const text =
    typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(2) : '0') : value;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return 'Rp —';
  const fraction = (match[3] ?? '').padEnd(2, '0').replace(/0+$/, '');
  return `${match[1] ? '-' : ''}Rp\u00a0${new Intl.NumberFormat('id-ID').format(BigInt(match[2]))}${fraction ? `,${fraction}` : ''}`;
};
export const date = (value: string) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Makassar',
  }).format(new Date(value));
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Makassar',
  }).format(new Date(value));
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba lagi.';
