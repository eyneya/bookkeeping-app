/**
 * aging.js
 *
 * Buckets open invoices/bills by days past due, relative to today. Shared
 * logic for both AR (customer invoices) and AP (vendor bills) aging reports.
 */

const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

function bucketForDaysPastDue(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

/**
 * @param {Array<{due_date: string|Date, outstanding: number}>} items
 * @param {Date} asOfDate - defaults to today
 */
function buildAgingReport(items, asOfDate = new Date()) {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const detail = [];

  for (const item of items) {
    if (item.outstanding <= 0.005) continue; // fully paid, skip
    const dueDate = new Date(item.due_date);
    const daysPastDue = Math.floor((asOfDate - dueDate) / (1000 * 60 * 60 * 24));
    const bucket = bucketForDaysPastDue(daysPastDue);
    buckets[bucket] += item.outstanding;
    detail.push({ ...item, days_past_due: daysPastDue, bucket });
  }

  return {
    as_of_date: asOfDate.toISOString().slice(0, 10),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    total_outstanding: Math.round(Object.values(buckets).reduce((s, v) => s + v, 0) * 100) / 100,
    detail,
  };
}

module.exports = { buildAgingReport, BUCKETS };
