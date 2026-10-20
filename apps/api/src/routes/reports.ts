import { Router } from 'express';
import { z } from 'zod';
import { localDateKey, resolveRange, type ResolvedRange } from '@spendly/shared';
import { csvRow } from '../lib/csv';
import { authOf } from '../middleware/context';
import { exportLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { loadLookups } from '../services/lookups';
import { rangeQuery, rangesFor } from '../services/query';
import { renderReportPdf } from '../services/report-pdf';
import { buildReport, DEFAULT_RANGE, REPORT_TYPES, reportToCsvRows, type ReportType } from '../services/reports';

export const reportsRouter = Router();

const query = rangeQuery.extend({ format: z.enum(['json', 'csv', 'pdf']).default('json') });

reportsRouter.get('/types', (_req, res) => {
  res.json({
    data: [
      { type: 'monthly-spending', title: 'Monthly spending', description: 'Totals, categories, platforms and your largest purchases for a month.' },
      { type: 'yearly-spending', title: 'Yearly spending', description: 'Month-by-month totals and category breakdown across a year.' },
      { type: 'platform-comparison', title: 'Platform comparison', description: 'Spend, orders and average order per platform against the previous period.' },
      { type: 'category-analysis', title: 'Category analysis', description: 'Where your money goes, with shares and changes.' },
      { type: 'subscriptions', title: 'Subscriptions', description: 'Detected recurring payments with monthly and yearly cost estimates.' },
      { type: 'budget-performance', title: 'Budget performance', description: 'Progress and projections for each active budget.' },
      { type: 'spending-changes', title: 'Spending changes', description: 'What moved most compared with the previous period.' },
      { type: 'ai-summary', title: 'Monthly summary', description: 'Plain-language highlights built only from your verified data.' },
    ],
  });
});

reportsRouter.get('/:type', exportLimiter, validate({ params: z.object({ type: z.enum(REPORT_TYPES) }), query }), async (req, res) => {
  const auth = authOf(req);
  const type = req.valid.params.type as ReportType;
  const q = req.valid.query as z.output<typeof query>;
  const explicit = q.preset || q.from || q.to;
  const now = new Date();
  const range: ResolvedRange = explicit
    ? rangesFor(auth, q, now).range
    : resolveRange({ preset: DEFAULT_RANGE[type] }, auth.tz, now, { weekStartsOn: auth.weekStartsOn });
  const lk = await loadLookups(auth.userId);
  const report = await buildReport(auth, lk, type, range, now);

  const stamp = localDateKey(now, auth.tz);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="spendly-${type}-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.write('﻿');
    for (const row of reportToCsvRows(report)) res.write(csvRow(row));
    res.end();
    return;
  }
  if (q.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="spendly-${type}-${stamp}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    const doc = renderReportPdf(report);
    doc.pipe(res);
    doc.end();
    return;
  }
  res.json({ data: report });
});
