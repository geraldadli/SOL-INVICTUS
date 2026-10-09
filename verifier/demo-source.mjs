import { nextMonth, previousMonth, utcPeriod } from '../src/reporting.js';
import { evidenceRecord } from '../src/verification.js';

// Deterministic test records stand in for meter, billing, and cost records. Never accept
// operator-submitted readings as source data. A real source adapter is intentionally absent.
export function createDemoSource(timestamp) {
  let period = previousMonth(utcPeriod(timestamp));
  const records = new Map();
  for (let i = 0; i < 24 && period <= 210012; i++, period = nextMonth(period)) {
    const offline = i % 3 === 1;
    records.set(period, evidenceRecord({ schema: 1, period, kwh: offline ? 0 : 1265,
      receiptsIdr: offline ? 0 : 1897500, costsIdr: 420000, reserveIdr: 250000,
      operatingStatus: offline ? 3 : 1, sourceKind: 'simulated', source: 'Synthetic meter, billing and expense fixtures',
      references: [`demo:meter:${period}`, `demo:billing:${period}`, `demo:expenses:${period}`, `demo:reserve:${period}`] }));
  }
  return { read(period) { const record = records.get(period); if (!record) throw new Error('No source records for this month.'); return structuredClone(record); } };
}
