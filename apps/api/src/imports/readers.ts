import { parse as parseCsv } from 'csv-parse/sync';
import { fileTypeFromBuffer } from 'file-type';
import { simpleParser } from 'mailparser';
import readXlsx from 'read-excel-file/node';
import { extractText, getDocumentProxy } from 'unpdf';
import { PLATFORMS, parseAmount } from '@spendly/shared';
import { unprocessable } from '../lib/errors';

export type FileKind = 'csv' | 'xlsx' | 'pdf' | 'eml' | 'image';

export interface Sniffed {
  fileType: FileKind;
  ext: string;
  mime: string;
}

const MAX_ROWS = 200_000;

/** Decides what a file really is from its bytes. The extension and declared type are never trusted alone. */
export async function sniffFile(buffer: Buffer, filename: string): Promise<Sniffed> {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const head = buffer.subarray(0, 8192);
  const isText = !head.includes(0);

  if (buffer.length === 0) throw unprocessable('That file is empty', undefined, 'EMPTY_FILE');
  if (ext === 'xls') {
    throw unprocessable('Old .xls files are not supported. Open it in Excel or Sheets and save it as .xlsx or .csv.', undefined, 'UNSUPPORTED_FILE');
  }
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const pdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';

  if (ext === 'xlsx') {
    if (!zip) throw unprocessable('That file is not a valid .xlsx workbook', undefined, 'FILE_TYPE_MISMATCH');
    assertSafeZip(buffer);
    return { fileType: 'xlsx', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  if (ext === 'pdf') {
    if (!pdf) throw unprocessable('That file is not a valid PDF', undefined, 'FILE_TYPE_MISMATCH');
    return { fileType: 'pdf', ext: 'pdf', mime: 'application/pdf' };
  }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const sniffed = await fileTypeFromBuffer(buffer);
    if (!sniffed || !['image/png', 'image/jpeg', 'image/webp'].includes(sniffed.mime)) {
      throw unprocessable('That file is not a valid PNG, JPEG or WebP image', undefined, 'FILE_TYPE_MISMATCH');
    }
    return { fileType: 'image', ext: sniffed.ext, mime: sniffed.mime };
  }
  if (ext === 'eml') {
    if (!isText || !/^(?:received|from|date|subject|mime-version|return-path|delivered-to):/im.test(head.toString('latin1'))) {
      throw unprocessable('That file does not look like an email (.eml) message', undefined, 'FILE_TYPE_MISMATCH');
    }
    return { fileType: 'eml', ext: 'eml', mime: 'message/rfc822' };
  }
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    if (!isText || zip || pdf) throw unprocessable('That file does not look like a text/CSV file', undefined, 'FILE_TYPE_MISMATCH');
    return { fileType: 'csv', ext: 'csv', mime: 'text/csv' };
  }
  throw unprocessable('Unsupported file type. Upload a CSV, XLSX, PDF statement, .eml receipt, or a PNG/JPEG/WebP receipt image.', { ext }, 'UNSUPPORTED_FILE');
}

/** Rejects zip archives that would balloon when unpacked (zip bombs) by reading the central directory. */
function assertSafeZip(buffer: Buffer): void {
  const tail = Math.max(0, buffer.length - 66_000);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= tail; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unprocessable('That workbook is damaged or not a valid .xlsx file', undefined, 'INVALID_FILE');
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries > 2000) throw unprocessable('That workbook contains too many parts', undefined, 'UNSAFE_FILE');
  let uncompressed = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    uncompressed += buffer.readUInt32LE(offset + 24);
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (uncompressed > 250 * 1024 * 1024 || uncompressed / Math.max(1, buffer.length) > 250) {
    throw unprocessable('That workbook expands to an unsafe size and was rejected', undefined, 'UNSAFE_FILE');
  }
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.replace(/"[^"]*"/g, '').split(d).length - 1);
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length < Math.min(3, lines.length)) continue;
    const mode = nonZero.sort((a, b) => a - b)[Math.floor(nonZero.length / 2)] as number;
    const consistent = counts.filter((c) => c === mode).length;
    const score = consistent * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export interface RawTable {
  sheets: string[];
  sheet: string | null;
  rows: string[][];
  notes: string[];
}

const cellToString = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
  }
  return String(v).trim();
};

function readCsvText(buffer: Buffer): string[][] {
  const text = decodeText(buffer);
  const delimiter = detectDelimiter(text);
  try {
    const rows = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, bom: true, trim: true }) as string[][];
    return rows.slice(0, MAX_ROWS + 1);
  } catch (error) {
    throw unprocessable(`The file could not be read as CSV: ${(error as Error).message}`, undefined, 'PARSE_ERROR');
  }
}

async function readPdfStatement(buffer: Buffer): Promise<{ rows: string[][]; notes: string[] }> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    pages = text;
  } catch (error) {
    if (/password/i.test((error as Error).message)) {
      throw unprocessable('This PDF is password-protected. Remove the password in your PDF viewer and upload it again.', undefined, 'PDF_PASSWORD');
    }
    throw unprocessable('This PDF could not be read. It may be damaged.', undefined, 'PARSE_ERROR');
  }
  const lines = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.join('').length < 40) {
    throw unprocessable('This PDF has no selectable text (it looks scanned). Download a text-based statement or a CSV/XLSX export instead.', undefined, 'PDF_NO_TEXT');
  }
  const dateStart = /^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -,]*\d{2,4})\b\s*(.*)$/;
  const money = /(-?\(?[\d,]+\.\d{2}\)?)\s*(Dr|Cr|DR|CR)?/g;
  const rows: string[][] = [['Date', 'Description', 'Amount', 'Balance']];
  let current: { date: string; text: string } | null = null;
  const flush = () => {
    if (!current) return;
    const amounts = [...current.text.matchAll(money)];
    if (amounts.length >= 1) {
      const first = amounts[0] as RegExpMatchArray;
      const description = current.text.slice(0, first.index).trim();
      const txn = `${first[1]}${first[2] ? ` ${first[2]}` : ''}`;
      const bal = amounts.length > 1 ? `${(amounts[amounts.length - 1] as RegExpMatchArray)[1]}` : '';
      rows.push([current.date, description, txn, bal]);
    }
    current = null;
  };
  for (const line of lines) {
    const m = dateStart.exec(line);
    if (m) {
      flush();
      current = { date: m[1] as string, text: m[2] as string };
    } else if (current && !/^(page \d|opening balance|closing balance|total|statement)/i.test(line)) {
      current.text += ` ${line}`;
    }
  }
  flush();
  inferPdfDirections(rows);
  if (rows.length < 2) {
    throw unprocessable('No transaction rows were found in this PDF. Statement layouts vary — a CSV or XLSX export is more reliable.', undefined, 'PDF_NO_ROWS');
  }
  return { rows: rows.slice(0, MAX_ROWS + 1), notes: ['PDF rows were extracted from text and may be imperfect — please review them carefully.'] };
}


/**
 * PDF statements often show debit and credit in separate columns that text extraction merges. When
 * a row has no Dr/Cr marker or sign, compare its running balance with the previous row's: if the
 * balance fell by the amount it was a debit, if it rose it was a credit. Rows that cannot be
 * resolved are flagged so they surface as invalid instead of being guessed.
 */
function inferPdfDirections(rows: string[][]): void {
  const toPaise = (v: string): number | null => {
    try {
      return parseAmount(v).paise;
    } catch {
      return null;
    }
  };
  let prev: number | null = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string[];
    const amount = row[2] ?? '';
    const balance = toPaise(row[3] ?? '');
    const explicit = /(dr|cr)\b/i.test(amount) || /^\s*[-(]/.test(amount);
    if (!explicit) {
      const a = toPaise(amount);
      if (a !== null && balance !== null && prev !== null) {
        if (prev - balance === a) row[2] = `-${amount}`;
        else if (balance - prev === a) row[2] = `${amount} Cr`;
        else row[2] = `${amount} ?`;
      } else row[2] = `${amount} ?`;
    }
    if (balance !== null) prev = balance;
  }
}

async function readPdfReceipt(buffer: Buffer): Promise<string[][]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw unprocessable('This PDF could not be read', undefined, 'PARSE_ERROR');
  }
  const lines = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.join('').length < 20) throw unprocessable('This PDF has no selectable text. Upload a photo of the receipt instead.', undefined, 'PDF_NO_TEXT');
  const amountRe = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/gi;
  let total: string | null = null;
  for (const line of lines) {
    if (/(grand total|total amount|amount paid|total paid|net payable|total)\b/i.test(line)) {
      const found = [...line.matchAll(amountRe)];
      if (found.length) total = (found[found.length - 1] as RegExpMatchArray)[1] as string;
    }
  }
  const date = lines.join(' ').match(/\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2} [A-Za-z]{3,9} \d{2,4})\b/)?.[1] ?? '';
  return [['Date', 'Merchant', 'Description', 'Amount'], [date, (lines[0] ?? '').slice(0, 80), 'Receipt', total ?? '']];
}

const HTML_TAGS = /<[^>]+>/g;

async function readEmail(buffer: Buffer): Promise<string[][]> {
  const mail = await simpleParser(buffer);
  const body = (mail.text ?? (mail.html ? String(mail.html).replace(HTML_TAGS, ' ') : '')).replace(/&nbsp;|&#160;/g, ' ');
  const amountRe = /(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/gi;
  const lines = body.split(/\r?\n/);
  let total: string | null = null;
  for (const line of lines) {
    if (/(grand total|total amount|amount paid|total paid|order total|bill total|net payable|total)\b/i.test(line)) {
      const found = [...line.matchAll(amountRe)];
      if (found.length) total = (found[found.length - 1] as RegExpMatchArray)[1] as string;
    }
  }
  if (!total) {
    const all = [...body.matchAll(amountRe)].map((m) => m[1] as string);
    total = all.sort((a, b) => Number(b.replace(/,/g, '')) - Number(a.replace(/,/g, '')))[0] ?? null;
  }
  const from = mail.from?.value[0];
  const domain = from?.address?.split('@')[1]?.toLowerCase() ?? '';
  const platform = PLATFORMS.find((p) => p.emailDomains?.some((d) => domain === d || domain.endsWith(`.${d}`)));
  const merchant = platform?.name ?? from?.name ?? domain.split('.')[0] ?? 'Unknown merchant';
  const date = mail.date ? `${mail.date.toISOString().slice(0, 10)}` : '';
  return [['Date', 'Merchant', 'Description', 'Amount'], [date, merchant, (mail.subject ?? '').slice(0, 200), total ?? '']];
}

export async function readTable(buffer: Buffer, fileType: FileKind, opts: { sheet?: string | null; receipt?: boolean } = {}): Promise<RawTable> {
  switch (fileType) {
    case 'csv':
      return { sheets: [], sheet: null, rows: readCsvText(buffer), notes: [] };
    case 'xlsx': {
      let sheets: Awaited<ReturnType<typeof readXlsx>>;
      try {
        sheets = await readXlsx(buffer);
      } catch (error) {
        throw unprocessable(`The workbook could not be read: ${(error as Error).message}`, undefined, 'PARSE_ERROR');
      }
      const usable = sheets.filter((s) => s.data.length > 0);
      if (usable.length === 0) throw unprocessable('That workbook has no data', undefined, 'EMPTY_FILE');
      const chosen = usable.find((s) => s.sheet === opts.sheet) ?? usable[0]!;
      const rows = chosen.data.slice(0, MAX_ROWS + 1).map((r) => r.map(cellToString));
      return { sheets: usable.map((s) => s.sheet), sheet: chosen.sheet, rows, notes: usable.length > 1 ? [`The workbook has ${usable.length} sheets; "${chosen.sheet}" is being used.`] : [] };
    }
    case 'pdf': {
      if (opts.receipt) return { sheets: [], sheet: null, rows: await readPdfReceipt(buffer), notes: ['Receipt PDFs are read heuristically — check the merchant, date and amount.'] };
      const { rows, notes } = await readPdfStatement(buffer);
      return { sheets: [], sheet: null, rows, notes };
    }
    case 'eml':
      return { sheets: [], sheet: null, rows: await readEmail(buffer), notes: ['Receipt emails are read heuristically — check the merchant, date and amount.'] };
    case 'image':
      return { sheets: [], sheet: null, rows: [['Date', 'Merchant', 'Description', 'Amount'], ['', '', '', '']], notes: [] };
  }
}

// ── header detection and mapping suggestion ────────────────────────────────────────────────────

const SYNONYMS = {
  date: ['date', 'txn date', 'transaction date', 'tran date', 'value date', 'posting date', 'post date', 'trans date', 'booking date', 'date of transaction', 'transaction dt'],
  description: ['description', 'narration', 'particulars', 'details', 'transaction details', 'remarks', 'transaction remarks', 'transaction description', 'narrative', 'memo', 'transaction particulars'],
  merchant: ['merchant', 'merchant name', 'payee', 'beneficiary', 'vendor', 'name', 'to', 'other transaction details'],
  amount: ['amount', 'amt', 'transaction amount', 'amount inr', 'txn amount', 'value', 'amount rs'],
  debit: ['debit', 'withdrawal', 'withdrawal amt', 'withdrawal amount', 'dr', 'debit amount', 'paid out', 'debits', 'amount debited', 'withdrawals'],
  credit: ['credit', 'deposit', 'deposit amt', 'deposit amount', 'cr', 'credit amount', 'paid in', 'credits', 'amount credited', 'deposits'],
  drcr: ['dr cr', 'cr dr', 'debit credit', 'transaction type', 'type', 'dr cr indicator'],
  reference: ['ref no', 'reference', 'chq ref no', 'chq ref', 'utr', 'txn id', 'transaction id', 'order id', 'upi ref no', 'ref', 'reference number', 'transaction ref', 'upi ref', 'utr no'],
  time: ['time', 'transaction time'],
  category: ['category'],
  paymentMethod: ['payment method', 'mode', 'payment mode', 'instrument', 'payment type'],
} as const;

type Field = keyof typeof SYNONYMS;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function matchScore(header: string, field: Field): number {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const syn of SYNONYMS[field]) {
    if (h === syn) best = Math.max(best, 3);
    else if (h.startsWith(`${syn} `) || h.endsWith(` ${syn}`)) best = Math.max(best, 2);
    else if (syn.length > 4 && h.includes(syn)) best = Math.max(best, 1);
  }
  return best;
}

export function detectHeaderRow(rows: string[][]): number {
  let bestRow = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const row = rows[i] ?? [];
    if (row.filter(Boolean).length < 3) continue;
    const fields = new Set<Field>();
    for (const cell of row) {
      for (const f of Object.keys(SYNONYMS) as Field[]) if (matchScore(cell, f) >= 2) fields.add(f);
    }
    const hasMoney = fields.has('amount') || fields.has('debit') || fields.has('credit');
    const score = fields.size + (fields.has('date') && hasMoney ? 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestScore >= 3 ? bestRow : 0;
}

export interface MappingSuggestion {
  columns: Record<string, string | null>;
  kind: 'generic' | 'bank_statement' | 'credit_card_statement' | 'upi_export';
  amountSign: 'negative_is_expense' | 'positive_is_expense' | 'all_expenses';
  dateOrder: 'dmy' | 'mdy' | 'ymd';
  detectedFormat: string;
  notes: string[];
}

export function suggestMapping(header: string[], sample: string[][], detectDateOrder: (samples: string[]) => 'dmy' | 'mdy' | 'ymd'): MappingSuggestion {
  const taken = new Set<number>();
  const pick = (field: Field): string | null => {
    let bestIdx = -1;
    let best = 0;
    header.forEach((h, i) => {
      if (taken.has(i)) return;
      const s = matchScore(h, field);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (best >= 1 && bestIdx >= 0) {
      taken.add(bestIdx);
      return header[bestIdx] as string;
    }
    return null;
  };
  const date = pick('date');
  const time = pick('time');
  const debit = pick('debit');
  const credit = pick('credit');
  const drcr = debit && credit ? null : pick('drcr');
  const amount = debit && credit ? null : pick('amount');
  const merchant = pick('merchant');
  const description = pick('description');
  const reference = pick('reference');
  const category = pick('category');
  const paymentMethod = pick('paymentMethod');

  const notes: string[] = [];
  const colIndex = (name: string | null) => (name ? header.indexOf(name) : -1);
  const values = (name: string | null) => sample.map((r) => r[colIndex(name)] ?? '').filter(Boolean);

  let amountSign: MappingSuggestion['amountSign'] = 'negative_is_expense';
  if (amount) {
    const parsed = values(amount).flatMap((v) => {
      try {
        return [parseAmount(v)];
      } catch {
        return [];
      }
    });
    const hasNegative = parsed.some((p) => p.negative);
    if (!hasNegative && !drcr && !parsed.some((p) => p.drcr)) {
      amountSign = 'all_expenses';
      notes.push('All amounts are positive with no debit/credit marker, so every row is treated as an expense. Change this if the file also contains credits.');
    }
  }
  const dateOrder = detectDateOrder(values(date));

  const headerText = header.map(norm).join(' ');
  const hasUpi = /upi/.test(headerText) || values(description).concat(values(merchant)).filter((v) => /\bupi\b/i.test(v)).length > sample.length / 3;
  const kind: MappingSuggestion['kind'] = /card|merchant/.test(headerText) && !debit && !credit ? 'credit_card_statement' : hasUpi && !debit && !credit ? 'upi_export' : debit || credit ? 'bank_statement' : 'generic';
  const detectedFormat =
    debit && credit ? 'Bank statement with separate debit and credit columns' : drcr ? 'Statement with a Dr/Cr indicator column' : amount ? 'Single amount column' : 'Unrecognised layout';
  if (!date) notes.push('No date column was recognised — choose one to continue.');
  if (!amount && !(debit && credit)) notes.push('No amount column was recognised — choose one (or separate debit/credit columns).');

  return { columns: { date, time, description, merchant, amount, debit, credit, drcr, reference, category, paymentMethod }, kind, amountSign, dateOrder, detectedFormat, notes };
}
