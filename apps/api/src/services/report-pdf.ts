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
  bold: font('inter-latin-700-normal'),
  regularExt: font('inter-latin-ext-400-normal'),
  semiboldExt: font('inter-latin-ext-600-normal'),
  boldExt: font('inter-latin-ext-700-normal'),
};

type Weight = 'regular' | 'semibold' | 'bold';
const FACE: Record<Weight, { latin: string; ext: string }> = {
  regular: { latin: 'r', ext: 'rx' },
  semibold: { latin: 's', ext: 'sx' },
  bold: { latin: 'b', ext: 'bx' },
};

// ── look ───────────────────────────────────────────────────────────────────────────────────────
const INK = '#14161B';
const MUTED = '#667085';
const RULE = '#E4E7EC';
const PANEL = '#F5F6FA';
const STRIPE = '#FAFAFD';
const HEAD = '#EEF0F8';
const VIOLET = '#6250D6';
const NIGHT = '#17123A';
const TEAL = '#14B8A6';
const GOOD = '#0B7A47';
const GOOD_BG = '#E3F6EC';
const WARN = '#B45309';
const WARN_BG = '#FFF1D6';
/** The chart palette, in the order the app draws its series. */
const PALETTE = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];
const OTHER = '#8B95A1';
const VEG = '#1BAF7A';
const NONVEG = '#E34948';
const EGG = '#EDA100';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 40;
const WIDTH = PAGE_W - 80;
const FOOT = 52;

type Doc = InstanceType<typeof PDFDocument>;

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

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const money = (paise: number) => formatINR(paise, { decimals: 'auto' });

function setup(doc: Doc) {
  doc.registerFont('r', FONTS.regular);
  doc.registerFont('s', FONTS.semibold);
  doc.registerFont('b', FONTS.bold);
  doc.registerFont('rx', FONTS.regularExt);
  doc.registerFont('sx', FONTS.semiboldExt);
  doc.registerFont('bx', FONTS.boldExt);
}

function runs(text: string, weight: Weight) {
  return text
    .split(/(₹)/)
    .filter(Boolean)
    .map((t) => ({ t, f: t === '₹' ? FACE[weight].ext : FACE[weight].latin }));
}

function widthOf(doc: Doc, text: string, size: number, weight: Weight = 'regular'): number {
  return runs(text, weight).reduce((w, r) => w + doc.fontSize(size).font(r.f).widthOfString(r.t), 0);
}

/** Draws text that may contain ₹, mixing the two Inter subsets, with optional right or centre alignment inside `width`. */
function drawText(doc: Doc, text: string, x: number, y: number, o: { size: number; weight?: Weight; color?: string; width?: number; align?: 'left' | 'right' | 'center' }): number {
  const weight = o.weight ?? 'regular';
  const parts = runs(text, weight);
  // drawing text moves PDFKit's own cursor; layout here keeps its place in doc.y, so put it back
  const cursorY = doc.y;
  doc.fontSize(o.size).fillColor(o.color ?? INK);
  const widths = parts.map((r) => doc.font(r.f).widthOfString(r.t));
  const total = widths.reduce((a, b) => a + b, 0);
  let cursor = x;
  if (o.width && o.align === 'right') cursor = x + o.width - total;
  else if (o.width && o.align === 'center') cursor = x + (o.width - total) / 2;
  parts.forEach((r, i) => {
    doc.font(r.f).text(r.t, cursor, y, { lineBreak: false });
    cursor += widths[i] as number;
  });
  doc.y = cursorY;
  return total;
}

/** Shortens text with an ellipsis so it fits. */
function fit(doc: Doc, text: string, width: number, size: number, weight: Weight = 'regular'): string {
  if (widthOf(doc, text, size, weight) <= width) return text;
  let out = text;
  while (out.length > 1 && widthOf(doc, `${out}…`, size, weight) > width) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function wrap(doc: Doc, text: string, width: number, size: number, weight: Weight = 'regular'): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (widthOf(doc, next, size, weight) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A small rounded label; returns its width. */
function chip(doc: Doc, text: string, x: number, y: number, o: { fg: string; bg: string; size?: number; opacity?: number }): number {
  const size = o.size ?? 7.5;
  const w = widthOf(doc, text, size, 'semibold') + 12;
  doc.save();
  doc.fillOpacity(o.opacity ?? 1).roundedRect(x, y, w, size + 8, (size + 8) / 2).fill(o.bg);
  doc.restore();
  drawText(doc, text, x + 6, y + 4.2, { size, weight: 'semibold', color: o.fg });
  return w;
}

/** The Spendly mark: a ring of coloured segments. */
function logoMark(doc: Doc, cx: number, cy: number, r: number) {
  doc.lineWidth(r * 0.3).lineCap('round');
  const arc = (a0: number, a1: number, color: string) => {
    const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    doc.path(`M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`).stroke(color);
  };
  arc(-Math.PI / 2 + 0.2, Math.PI / 2 - 0.5, '#B8F8FD');
  arc(Math.PI / 2 - 0.1, Math.PI + 0.7, '#9085E9');
  arc(Math.PI + 0.9, Math.PI * 1.5 - 0.15, '#E87BA4');
  doc.lineCap('butt');
}

function pageHeader(doc: Doc, report: ReportDto) {
  doc.rect(0, 0, PAGE_W, 34).fill(NIGHT);
  logoMark(doc, LEFT + 6, 17, 5);
  drawText(doc, 'Spendly AI', LEFT + 18, 12, { size: 8.5, weight: 'bold', color: '#FFFFFF' });
  drawText(doc, `${report.title} · ${report.subtitle}`, LEFT, 13, { size: 8, color: '#CFCBF5', width: WIDTH, align: 'right' });
}

function coverHeader(doc: Doc, report: ReportDto) {
  const grad = doc.linearGradient(0, 0, PAGE_W, 150);
  grad.stop(0, '#15103A').stop(0.6, '#2B2178').stop(1, '#4636B5');
  doc.rect(0, 0, PAGE_W, 150).fill(grad);
  // soft rings, as on the sign-in page
  doc.save();
  doc.lineWidth(26).strokeOpacity(0.07).circle(PAGE_W - 30, 36, 96).stroke('#FFFFFF');
  doc.lineWidth(2).strokeOpacity(0.12).circle(PAGE_W - 30, 36, 132).stroke('#FFFFFF');
  doc.restore();

  logoMark(doc, LEFT + 8, 40, 8);
  drawText(doc, 'Spendly AI', LEFT + 24, 33, { size: 11, weight: 'bold', color: '#FFFFFF' });
  if (report.isDemo) chip(doc, 'DEMO DATA — not real spending', PAGE_W - LEFT - 150, 30, { fg: '#7C4A03', bg: '#FDE68A' });
  else drawText(doc, `Generated ${day(report.generatedAt.slice(0, 10))}`, LEFT, 34, { size: 8.5, color: '#CFCBF5', width: WIDTH, align: 'right' });

  // long report names shrink to the page instead of running past the margin
  let titleSize = 27;
  while (titleSize > 18 && widthOf(doc, report.title, titleSize, 'bold') > WIDTH) titleSize -= 1;
  drawText(doc, report.title, LEFT, 72 + (27 - titleSize) * 0.7, { size: titleSize, weight: 'bold', color: '#FFFFFF' });
  drawText(doc, fit(doc, report.subtitle, WIDTH, 12), LEFT, 106, { size: 12, color: '#D9D6F7' });
  let x = LEFT;
  x += chip(doc, `${day(report.range.fromDate)} – ${day(report.range.toDate)}`, x, 124, { fg: '#FFFFFF', bg: '#FFFFFF', opacity: 0.16 }) + 6;
  chip(doc, report.timezone, x, 124, { fg: '#FFFFFF', bg: '#FFFFFF', opacity: 0.16 });
}

function sectionTitle(doc: Doc, title: string, aside?: string) {
  doc.roundedRect(LEFT, doc.y + 1, 3, 14, 1.5).fill(VIOLET);
  drawText(doc, title, LEFT + 11, doc.y, { size: 13, weight: 'bold' });
  if (aside) drawText(doc, aside, LEFT, doc.y + 2, { size: 8, color: MUTED, width: WIDTH, align: 'right' });
  doc.y += 24;
}

// ── blocks ─────────────────────────────────────────────────────────────────────────────────────

function kpiCards(doc: Doc, summary: ReportDto['summary']) {
  const gap = 10;
  const w = (WIDTH - gap * 2) / 3;
  const h = 64;
  const top = doc.y;
  summary.forEach((s, i) => {
    const x = LEFT + (i % 3) * (w + gap);
    const y = top + Math.floor(i / 3) * (h + gap);
    doc.roundedRect(x, y, w, h, 12).fill(PANEL);
    drawText(doc, s.label.toUpperCase(), x + 13, y + 12, { size: 6.8, weight: 'semibold', color: MUTED, width: w - 26 });
    drawText(doc, fit(doc, s.value, w - 26, 17, 'bold'), x + 13, y + 25, { size: 17, weight: 'bold' });
    if (s.delta) {
      const tone = s.tone === 'good' ? { fg: GOOD, bg: GOOD_BG } : s.tone === 'bad' ? { fg: WARN, bg: WARN_BG } : { fg: MUTED, bg: RULE };
      chip(doc, s.delta, x + 13, y + 46, { ...tone, size: 6.8 });
    }
  });
  doc.y = top + Math.ceil(summary.length / 3) * (h + gap) + 4;
}

function barChart(doc: Doc, chart: NonNullable<ReportDto['chart']>) {
  const bars = chart.bars;
  if (bars.length < 2) return;
  const total = bars.reduce((n, b) => n + b.paise, 0);
  const peak = bars.reduce((a, b) => (b.paise > a.paise ? b : a));
  const H = 196;
  sectionTitle(doc, chart.title, total > 0 ? `Highest ${money(peak.paise)}${peak.full ? ` on ${peak.full}` : ''}` : undefined);
  const y0 = doc.y;
  doc.roundedRect(LEFT, y0, WIDTH, H, 14).fill(PANEL);
  const pad = 18;
  const innerW = WIDTH - pad * 2;
  const base = y0 + H - 28;
  const maxH = H - 28 - 36;
  const step = innerW / bars.length;
  const bw = Math.min(16, step * 0.64);
  const max = Math.max(...bars.map((b) => b.paise), 1);
  // faint guide lines
  for (const f of [0.5, 1]) doc.moveTo(LEFT + pad, base - maxH * f).lineTo(LEFT + pad + innerW, base - maxH * f).lineWidth(0.4).dash(1.5, { space: 2.5 }).strokeColor('#D5D9E3').stroke();
  doc.undash();
  bars.forEach((b, i) => {
    const x = LEFT + pad + i * step + (step - bw) / 2;
    const h = b.paise === 0 ? 2 : Math.max(3.5, (b.paise / max) * maxH);
    const color = b === peak && b.paise > 0 ? TEAL : b.paise === 0 ? '#D5D9E3' : VIOLET;
    doc.save();
    doc.fillOpacity(b === peak ? 1 : b.paise === 0 ? 1 : 0.82).roundedRect(x, base - h, bw, h, Math.min(3, bw / 3)).fill(color);
    doc.restore();
    // a label under the first bar, the last, and every few between; every bar when there are only a dozen
    const every = bars.length <= 12 ? 1 : Math.ceil(bars.length / 8);
    if (i % every === 0 || i === bars.length - 1) drawText(doc, b.label, x - 10, base + 8, { size: 6.8, color: MUTED, width: bw + 20, align: 'center' });
  });
  if (peak.paise > 0) {
    const i = bars.indexOf(peak);
    const x = LEFT + pad + i * step + step / 2;
    const h = (peak.paise / max) * maxH;
    const label = money(peak.paise);
    const w = widthOf(doc, label, 7.2, 'bold') + 10;
    const cx = Math.min(Math.max(x - w / 2, LEFT + 6), LEFT + WIDTH - w - 6);
    chip(doc, label, cx, base - h - 18, { fg: '#FFFFFF', bg: INK, size: 7.2 });
  }
  doc.y = y0 + H + 18;
}

/** The share column of the category table, as one bar split in colour, with a key. */
function compositionBar(doc: Doc, rows: Array<{ name: string; share: number }>) {
  const top = rows.slice(0, 6);
  const rest = 100 - top.reduce((n, r) => n + r.share, 0);
  const parts = [...top.map((r, i) => ({ name: r.name, share: r.share, color: PALETTE[i % PALETTE.length] as string })), ...(rest > 0.5 ? [{ name: 'Other', share: rest, color: OTHER }] : [])];
  const y = doc.y;
  let x = LEFT;
  const barH = 12;
  doc.save();
  doc.roundedRect(LEFT, y, WIDTH, barH, 6).clip();
  parts.forEach((p) => {
    const w = (p.share / 100) * WIDTH;
    doc.rect(x, y, w + 0.5, barH).fill(p.color);
    x += w;
  });
  doc.restore();
  const colW = WIDTH / 3;
  parts.forEach((p, i) => {
    const cx = LEFT + (i % 3) * colW;
    const cy = y + 24 + Math.floor(i / 3) * 16;
    doc.circle(cx + 4, cy + 4, 3.5).fill(p.color);
    const label = `${Math.round(p.share)}%`;
    const name = fit(doc, p.name, colW - 56, 8.5);
    const nameW = drawText(doc, name, cx + 13, cy, { size: 8.5, color: INK });
    drawText(doc, label, cx + 13 + nameW + 5, cy, { size: 8.5, weight: 'bold', color: MUTED });
  });
  doc.y = y + 24 + Math.ceil(parts.length / 3) * 16 + 6;
}

function foodBlock(doc: Doc, food: NonNullable<ReportDto['food']>) {
  sectionTitle(doc, 'What you ordered');
  const gap = 12;
  const cw = (WIDTH - gap) / 2;
  const rows = 5;
  const rowH = 33;
  const h = 34 + rows * rowH + (food.diet ? 46 : 8);
  const y0 = doc.y;

  const card = (x: number, title: string) => {
    doc.roundedRect(x, y0, cw, h, 14).fill(PANEL);
    drawText(doc, title.toUpperCase(), x + 16, y0 + 14, { size: 6.8, weight: 'semibold', color: MUTED });
  };

  // places
  card(LEFT, 'Where you ordered from');
  const maxP = Math.max(...food.places.map((p) => p.paise), 1);
  food.places.slice(0, rows).forEach((p, i) => {
    const y = y0 + 34 + i * rowH;
    doc.circle(LEFT + 24, y + 9, 8).fill(i === 0 ? VIOLET : '#E2E5F1');
    drawText(doc, String(i + 1), LEFT + 16, y + 5.4, { size: 8, weight: 'bold', color: i === 0 ? '#FFFFFF' : MUTED, width: 16, align: 'center' });
    drawText(doc, fit(doc, p.name, cw - 120, 9.2, 'semibold'), LEFT + 40, y + 1.5, { size: 9.2, weight: 'semibold' });
    drawText(doc, money(p.paise), LEFT, y + 1.5, { size: 9.2, weight: 'bold', width: cw - 16, align: 'right' });
    drawText(doc, `${p.orders} ${p.orders === 1 ? 'order' : 'orders'}`, LEFT + 40, y + 14, { size: 7.4, color: MUTED });
    doc.roundedRect(LEFT + 40, y + 24, cw - 56, 3, 1.5).fill('#E2E5F1');
    doc.roundedRect(LEFT + 40, y + 24, Math.max(3, ((cw - 56) * p.paise) / maxP), 3, 1.5).fill(i === 0 ? VIOLET : '#9C93E0');
  });

  // dishes
  const rx = LEFT + cw + gap;
  card(rx, 'Most ordered dishes');
  const maxD = Math.max(...food.dishes.map((d) => d.times), 1);
  food.dishes.slice(0, rows).forEach((d, i) => {
    const y = y0 + 34 + i * rowH;
    drawText(doc, fit(doc, d.name, cw - 78, 9.2, 'semibold'), rx + 16, y + 1.5, { size: 9.2, weight: 'semibold' });
    drawText(doc, `×${d.times}`, rx, y + 1.5, { size: 9.2, weight: 'bold', width: cw - 16, align: 'right' });
    doc.roundedRect(rx + 16, y + 17, cw - 32, 3, 1.5).fill('#E2E5F1');
    doc.roundedRect(rx + 16, y + 17, Math.max(3, ((cw - 32) * d.times) / maxD), 3, 1.5).fill(i === 0 ? TEAL : '#7AD5C9');
  });

  // veg split across both cards
  if (food.diet) {
    const total = food.diet.veg + food.diet.nonveg + food.diet.egg;
    const parts = [
      { n: food.diet.veg, c: VEG, l: 'veg' },
      { n: food.diet.nonveg, c: NONVEG, l: 'non-veg' },
      { n: food.diet.egg, c: EGG, l: 'egg' },
    ].filter((p) => p.n > 0);
    const by = y0 + h - 40;
    drawText(doc, 'ON YOUR PLATE', rx + 16, by, { size: 6.8, weight: 'semibold', color: MUTED });
    let x = rx + 16;
    const bw = cw - 32;
    doc.save();
    doc.roundedRect(x, by + 13, bw, 7, 3.5).clip();
    parts.forEach((p) => {
      const w = (p.n / total) * bw;
      doc.rect(x, by + 13, w + 0.5, 7).fill(p.c);
      x += w;
    });
    doc.restore();
    let lx = rx + 16;
    parts.forEach((p) => {
      doc.circle(lx + 3, by + 28.5, 2.6).fill(p.c);
      lx += 9 + drawText(doc, `${Math.round((p.n / total) * 100)}% ${p.l}`, lx + 9, by + 25, { size: 7.6, weight: 'semibold' }) + 10;
    });
  }
  doc.y = y0 + h + 20;
}

// ── tables ─────────────────────────────────────────────────────────────────────────────────────

function table(doc: Doc, section: ReportDto['sections'][number]) {
  const cols = section.columns;
  const textCols = cols.filter((c) => c.align !== 'right');
  const numW = cols.length > 6 ? 58 : 70;
  const nameW = (WIDTH - (cols.length - textCols.length) * numW) / Math.max(1, textCols.length);
  const widths = cols.map((c) => (c.align === 'right' ? numW : nameW));
  const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] as number) + w], [LEFT]);
  const firstText = cols.findIndex((c) => c.align !== 'right');

  // labels wrap onto a second line where a column is narrow, so neighbouring headings never run together
  const labels = cols.map((c, i) => wrap(doc, c.label.toUpperCase(), (widths[i] as number) - 14, 6.6, 'semibold'));
  const headLines = Math.max(...labels.map((l) => l.length), 1);
  const header = () => {
    const h = headLines * 8 + 12;
    doc.roundedRect(LEFT, doc.y, WIDTH, h, 6).fill(HEAD);
    cols.forEach((c, i) => (labels[i] as string[]).forEach((line, j) => drawText(doc, line, (xs[i] as number) + 7, doc.y + 6 + j * 8, { size: 6.6, weight: 'semibold', color: MUTED, width: (widths[i] as number) - 14, align: c.align })));
    doc.y += h + 4;
  };
  header();

  const maxShare = Math.max(...section.rows.map((r) => Number(r.share ?? 0)), 1);
  section.rows.forEach((row, ri) => {
    const cells = cols.map((c, i) => wrap(doc, formatCell(row[c.key] ?? null, c.format), (widths[i] as number) - 14, 8.5, i === firstText ? 'semibold' : 'regular'));
    const lines = Math.max(...cells.map((l) => l.length), 1);
    const h = lines * 11 + 9;
    if (doc.y + h > PAGE_H - FOOT) {
      doc.addPage();
      header();
    }
    if (ri % 2 === 1) doc.roundedRect(LEFT, doc.y - 2, WIDTH, h, 5).fill(STRIPE);
    cols.forEach((c, i) => {
      const x = xs[i] as number;
      const value = row[c.key];
      let color = INK;
      // spending that went up is the warning; down is the good news
      if (c.key === 'change' && typeof value === 'number') color = value > 0.5 ? WARN : value < -0.5 ? GOOD : MUTED;
      if (c.key === 'share' && typeof value === 'number') {
        doc.roundedRect(x + 7, doc.y + 3.5, 20, 3.4, 1.7).fill('#E2E5F1');
        doc.roundedRect(x + 7, doc.y + 3.5, Math.max(1.5, (20 * value) / maxShare), 3.4, 1.7).fill(VIOLET);
      }
      (cells[i] as string[]).forEach((line, j) => drawText(doc, line, x + 7, doc.y + 1 + j * 11, { size: 8.5, weight: i === firstText ? 'semibold' : color !== INK ? 'semibold' : 'regular', color, width: (widths[i] as number) - 14, align: c.align }));
    });
    doc.y += h;
  });
  if (section.rows.length === 0) {
    drawText(doc, 'No data for this period.', LEFT + 7, doc.y, { size: 9, color: MUTED });
    doc.y += 18;
  }
  doc.y += 8;
}

export function renderReportPdf(report: ReportDto): Doc {
  // no page margin of its own: every position here is drawn explicitly, and the footer sits in what would be the margin
  const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: LEFT, right: LEFT }, bufferPages: true, info: { Title: report.title, Author: 'Spendly AI', Subject: report.subtitle } });
  setup(doc);
  const ensure = (h: number) => {
    if (doc.y + h > PAGE_H - FOOT) doc.addPage();
  };
  doc.on('pageAdded', () => {
    pageHeader(doc, report);
    doc.y = 56;
  });

  coverHeader(doc, report);
  doc.y = 172;
  kpiCards(doc, report.summary);

  if (report.chart) {
    doc.y += 8;
    ensure(200);
    barChart(doc, report.chart);
  }
  if (report.food) {
    ensure(250);
    foodBlock(doc, report.food);
  }

  for (const section of report.sections) {
    ensure(110);
    sectionTitle(doc, section.title);
    // a table of category shares opens with the whole picture in one bar
    const shares = section.rows.filter((r) => typeof r.share === 'number' && typeof r.name === 'string');
    if (shares.length >= 2 && section.columns.some((c) => c.key === 'share')) compositionBar(doc, shares.map((r) => ({ name: String(r.name), share: Number(r.share) })));
    if (section.note) {
      for (const line of wrap(doc, section.note, WIDTH, 8.5)) {
        drawText(doc, line, LEFT, doc.y, { size: 8.5, color: MUTED });
        doc.y += 11.5;
      }
      doc.y += 4;
    }
    ensure(60);
    table(doc, section);
  }

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(LEFT, PAGE_H - 44).lineTo(LEFT + WIDTH, PAGE_H - 44).lineWidth(0.5).strokeColor(RULE).stroke();
    const note = 'Budgeting information from your own data — not investment, tax or legal advice. Figures marked estimate are projections.';
    wrap(doc, note, WIDTH - 140, 6.8).forEach((line, j) => drawText(doc, line, LEFT, PAGE_H - 36 + j * 9, { size: 6.8, color: MUTED }));
    drawText(doc, `Spendly AI  ·  Page ${i + 1} of ${range.count}`, LEFT, PAGE_H - 36, { size: 7.2, weight: 'semibold', color: MUTED, width: WIDTH, align: 'right' });
  }
  return doc;
}
