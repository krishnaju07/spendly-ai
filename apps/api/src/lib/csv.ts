/**
 * CSV output that is safe to open in a spreadsheet. A cell that starts with = + - @ (or a control
 * character) would be executed as a formula by Excel/Sheets — an attacker-controlled merchant name
 * could exfiltrate data — so such cells are prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[]): string => `${cells.map(csvCell).join(',')}\r\n`;

/** Paise → "1234.50" using integer arithmetic only. */
export function paiseToDecimal(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
