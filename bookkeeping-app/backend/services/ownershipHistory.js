/**
 * ownershipHistory.js
 *
 * Computes a time-weighted average ownership percentage for an owner over
 * a date range, accounting for percentage changes mid-period (e.g. a
 * partner buying in/out partway through the year). Falls back to the
 * owner's flat ownership_percentage if no history rows exist at all.
 *
 * Example: an owner is at 30% from Jan 1, then buys in to 50% on July 1.
 * For a full calendar year report (Jan 1 - Dec 31), the weighted average
 * accounts for how many days each percentage was actually in effect,
 * rather than a naive average of the two numbers.
 */

const pool = require('../db/pool');

/**
 * @param {string} ownerId
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 * @param {number} fallbackPercentage - owners.ownership_percentage, used if there's no history
 */
async function calculateWeightedOwnershipPercentage(ownerId, startDate, endDate, fallbackPercentage) {
  const historyResult = await pool.query(
    'SELECT effective_date, ownership_percentage FROM ownership_history WHERE owner_id = $1 ORDER BY effective_date',
    [ownerId]
  );

  if (historyResult.rows.length === 0) {
    return Number(fallbackPercentage);
  }

  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  const totalDays = Math.max((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24) + 1, 1);

  // Build segments: each history row's percentage applies from its
  // effective_date until the next row's effective_date (or the range end).
  const history = historyResult.rows.map((r) => ({ date: new Date(r.effective_date), pct: Number(r.ownership_percentage) }));

  let weightedSum = 0;
  for (let i = 0; i < history.length; i++) {
    const segmentStart = history[i].date > rangeStart ? history[i].date : rangeStart;
    const segmentEnd = i + 1 < history.length ? history[i + 1].date : rangeEnd;
    const effectiveEnd = segmentEnd < rangeEnd ? segmentEnd : rangeEnd;

    if (effectiveEnd < rangeStart || segmentStart > rangeEnd) continue; // segment entirely outside the range

    const daysInSegment = Math.max((effectiveEnd - segmentStart) / (1000 * 60 * 60 * 24) + (i + 1 < history.length ? 0 : 1), 0);
    weightedSum += daysInSegment * history[i].pct;
  }

  // If the range starts before the earliest history row, use the fallback
  // percentage for that gap (assume it was the flat rate before tracking began).
  const earliestHistoryDate = history[0].date;
  if (rangeStart < earliestHistoryDate) {
    const gapDays = Math.max((Math.min(earliestHistoryDate, rangeEnd) - rangeStart) / (1000 * 60 * 60 * 24), 0);
    weightedSum += gapDays * Number(fallbackPercentage);
  }

  return Math.round((weightedSum / totalDays) * 100) / 100;
}

module.exports = { calculateWeightedOwnershipPercentage };
