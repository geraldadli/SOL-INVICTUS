export const REPORT_GRACE = 7 * 24 * 60 * 60;
export const utcPeriod = timestamp => {
  const date = new Date(timestamp * 1000);
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
};
export const nextMonth = period => period % 100 === 12 ? period + 89 : period + 1;
export const previousMonth = period => period % 100 === 1 ? period - 89 : period - 1;
export const monthStart = period => Date.UTC(Math.floor(period / 100), period % 100 - 1, 1) / 1000;
export const reportAmounts = (kwh, costs, reserve) => {
  const gross = kwh * 1500;
  const result = gross - costs - reserve;
  return { gross, net: Math.max(0, result), loss: Math.max(0, -result) };
};
export function initialReporting(timestamp) {
  const current = utcPeriod(timestamp);
  return { nextReportingPeriod: previousMonth(current), reportingOpensAt: monthStart(current),
    reportDueAt: timestamp + REPORT_GRACE, purchasesPaused: false };
}
export function reportingAfter(period) {
  const nextReportingPeriod = nextMonth(period);
  const reportingOpensAt = monthStart(nextMonth(nextReportingPeriod));
  return { nextReportingPeriod, reportingOpensAt, reportDueAt: reportingOpensAt + REPORT_GRACE };
}
export function reportingState(data, timestamp) {
  const overdue = timestamp > data.reportDueAt;
  return { safeguards: true, nextReportingPeriod: data.nextReportingPeriod, reportingOpensAt: data.reportingOpensAt,
    reportDueAt: data.reportDueAt, purchasesPaused: data.purchasesPaused, overdue,
    purchasesAllowed: !data.purchasesPaused && !overdue, timestamp };
}
