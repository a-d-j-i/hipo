const formatters = new Map<string, Intl.NumberFormat>();

function fmt(currency: string, locale = "es-AR"): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency });
    formatters.set(key, f);
  }
  return f;
}

export function formatCents(cents: number, currency: string): string {
  return fmt(currency).format(cents / 100);
}

export function centsToMajor(cents: number): number {
  return cents / 100;
}

export function majorToCents(major: number): number {
  return Math.round(major * 100);
}

export const COMMON_CURRENCIES = [
  "ARS",
  "USD",
  "EUR",
  "BRL",
  "UYU",
  "CLP",
  "MXN",
  "GBP",
];
