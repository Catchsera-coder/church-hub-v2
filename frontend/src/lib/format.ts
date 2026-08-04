export const money = (cents: number | null | undefined, currency = 'USD') =>
  cents === null || cents === undefined
    ? '—'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);

export const date = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
