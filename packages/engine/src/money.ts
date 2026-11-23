/** Money helpers. Values are integer minor units (cents). */

export function createMoneyFormatter(currency: string, locale?: string): (minor: number) => string {
  let fmt: Intl.NumberFormat;
  try {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (minor) => fmt.format(minor / 100);
}
