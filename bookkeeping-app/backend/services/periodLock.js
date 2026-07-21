/**
 * periodLock.js
 *
 * A business can be "locked through" a date (typically set once a return
 * has been filed for that period) to prevent transactions dated on or
 * before that date from being edited, deleted, flagged/unflagged, or
 * having new journal entries posted into them. Locking/unlocking is
 * admin-only (see routes/clients.js) — this module enforces it.
 *
 * Admins can override a lock on a specific action by passing
 * override_lock: true — this is deliberate, not automatic: an admin
 * touching a locked period always has to explicitly say so on that
 * request, and every override gets audit-logged by the calling route
 * (see routes/transactions.js, routes/journalEntries.js, routes/documents.js)
 * so there's a record of who reopened a filed period and when.
 */

const pool = require('../db/pool');

/**
 * @param {string} clientId
 * @param {string} txnDate
 * @param {{ role: string }} user - req.user
 * @param {boolean} overrideLock - explicit admin override flag from the request
 * @returns {Promise<boolean>} true if the check passed because of an active override (caller should audit-log this)
 */
async function assertPeriodNotLocked(clientId, txnDate, user, overrideLock) {
  if (!clientId || !txnDate) return false; // personal-tier transactions (no client_id) are never locked

  const result = await pool.query('SELECT locked_through_date FROM clients WHERE id = $1', [clientId]);
  const lockedThrough = result.rows[0]?.locked_through_date;
  if (!lockedThrough) return false;

  const isLocked = new Date(txnDate) <= new Date(lockedThrough);
  if (!isLocked) return false;

  if (user?.role === 'admin' && overrideLock === true) {
    return true; // overridden — caller must audit-log this
  }

  const err = new Error(
    `This date (${new Date(txnDate).toISOString().slice(0, 10)}) falls within a locked period ` +
    `(locked through ${new Date(lockedThrough).toISOString().slice(0, 10)}).` +
    (user?.role === 'admin'
      ? ' Pass override_lock: true to proceed anyway as admin.'
      : ' Ask an admin to unlock the period, or override it, if this needs to change.')
  );
  err.status = 400;
  throw err;
}

module.exports = { assertPeriodNotLocked };

