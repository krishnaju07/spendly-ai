import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { formatINR, type ReportDto } from '@spendly/shared';

const require_ = createRequire(import.meta.url);
const font = (name: string) => require_.resolve(`@fontsource/inter/files/${name}.woff`);

/**
 * The built-in PDF fonts have no ₹ glyph, and Inter keeps it in the Latin-ext subset. Text is
 * therefore drawn in runs: the rupee sign from the Latin-ext font, everything else from Latin.
 */
const FONTS = {
  regular: font('inter-latin-400-normal'),
  semibold: font('inter-latin-600-normal'),
  regularExt: font('inter-latin-ext-400-normal'),
  semiboldExt: font('inter-latin-ext-600-normal'),
};

const INK = '#111418';
const MUTED = '#5B636E';
const RULE = '#D9DEE3';
const ACCENT = '#0F766E';

function formatCell(value: string | number | null, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (format === 'money') return formatINR(value, { decimals: 'auto' });
    if (format === 'percent') return `${value >= 0 ? '' : '−'}${Math.abs(Math.round(value * 10) / 10)}%`;
    if (format === 'number') return new Intl.NumberFormat('en-IN').format(value);
  }
  if (format === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  return String(value);
}

type Doc = InstanceType<typeof PDFDocument>;

function setup(doc: Doc) {
  doc.registerFont('r', FONTS.regular);
  doc.registerFont('b', FONTS.semibold);
  doc.registerFont('rx', FONTS.regularExt);
  doc.registerFont('bx', FONTS.semiboldExt);
}

/** Draws text that may contain ₹, mixing the two Inter subsets, with optional right alignment. */
function drawText(doc: Doc, text: string, x: number, y: number, opts: { size: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' }) {
  const runs = text.split(/(₹)/).filter(Boolean).map((t) => ({ t, f: t === '₹' ? (opts.bold ? 'bx' : 'rx') : opts.bold ? 'b' : 'r' }));
  doc.fontSize(opts.size).fillColor(opts.color ?? INK);
  const widths = runs.map((r) => doc.font(r.f).widthOfString(r.t));
  const total = widths.reduce((a, b) => a + b, 0);
  let cursor = opts.align === 'right' && opts.width ? x + opts.width - total : x;
  runs.forEach((r, i) => {
    doc.font(r.f).text(r.t, cursor, y, { lineBreak: false });
    cursor += widths[i] as number;
  });
  return total;
}

function wrap(doc: Doc, text: string, width: number, size: number, bold = false): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  const measure = (s: string) => s.split(/(₹)/).reduce((w, part) => w + doc.fontSize(size).font(part === '₹' ? (bold ? 'bx' : 'rx') : bold ? 'b' : 'r').widthOfString(part), 0);
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReportPdf(report: ReportDto): Doc {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: report.title, Author: 'Spendly AI', Subject: report.subtitle } });
  setup(doc);
  const left = 40;
  const width = doc.page.width - 80;
  const bottom = () => doc.page.height - 56;

  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // header
  drawText(doc, 'Spendly AI', left, 40, { size: 9, bold: true, color: ACCENT });
  if (report.isDemo) drawText(doc, 'DEMO DATA — not real spending', left, 40, { size: 9, bold: true, color: '#B45309', width, align: 'right' });
  drawText(doc, report.title, left, 58, { size: 22, bold: true });
  drawText(doc, report.subtitle, left, 88, { size: 10.5, color: MUTED });
  drawText(doc, `${report.range.fromDate} to ${report.range.toDate} · ${report.timezone} · generated ${report.generatedAt.slice(0, 10)}`, left, 104, { size: 8.5, color: MUTED });
  doc.y = 128;

  // key figures
  const colW = width / 3;
  let rowY = doc.y;
  report.summary.forEach((s, i) => {
    const col = i % 3;
    if (col === 0) {
      ensure(40);
      rowY = doc.y;
    }
    drawText(doc, s.label.toUpperCase(), left + col * colW, rowY, { size: 7, bold: true, color: MUTED });
    drawText(doc, s.value, left + col * colW, rowY + 11, { size: 13, bold: true });
    if (col === 2 || i === report.summary.length - 1) doc.y = rowY + 40;
  });

  for (const section of report.sections) {
    ensure(70);
    doc.y += 6;
    drawText(doc, section.title, left, doc.y, { size: 12, bold: true });
    doc.y += 20;
    if (section.note) {
      for (const line of wrap(doc, section.note, width, 8.5)) {
        drawText(doc, line, left, doc.y, { size: 8.5, color: MUTED });
        doc.y += 11;
      }
      doc.y += 2;
    }
    const cols = section.columns;
    const textCols = cols.filter((c) => c.align !== 'right');
    const numW = cols.length > 6 ? 58 : 70;
    const nameW = (width - (cols.length - textCols.length) * numW) / Math.max(1, textCols.length);
    const widths = cols.map((c) => (c.align === 'right' ? numW : nameW));
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] as number) + w], [left]);

    const header = () => {
      cols.forEach((c, i) => drawText(doc, c.label, (xs[i] as number) + 2, doc.y, { size: 7.5, bold: true, color: MUTED, width: (widths[i] as number) - 6, align: c.align }));
      doc.y += 12;
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(RULE).stroke();
      doc.y += 5;
    };
    ensure(40);
    header();
    for (const row of section.rows) {
      const cells = cols.map((c, i) => wrap(doc, formatCell(row[c.key] ?? null, c.format), (widths[i] as number) - 8, 8.5));
      const lines = Math.max(...cells.map((l) => l.length), 1);
      const h = lines * 11 + 6;
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
      }
      cells.forEach((cell, i) =>
        cell.forEach((line, j) => drawText(doc, line, (xs[i] as number) + 2, doc.y + j * 11, { size: 8.5, width: (widths[i] as number) - 6, align: cols[i]?.align })),
      );
      doc.y += h;
      doc.moveTo(left, doc.y - 3).lineTo(left + width, doc.y - 3).lineWidth(0.3).strokeColor('#ECEFF2').stroke();
    }
    if (section.rows.length === 0) {
      drawText(doc, 'No data for this period.', left, doc.y, { size: 9, color: MUTED });
      doc.y += 16;
    }
  }

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawText(doc, 'Budgeting information from your own data — not investment, tax or legal advice. Figures marked estimate are projections.', left, doc.page.height - 40, { size: 7, color: MUTED });
    drawText(doc, `Page ${i + 1} of ${range.count}`, left, doc.page.height - 40, { size: 7, color: MUTED, width, align: 'right' });
  }
  return doc;
}
