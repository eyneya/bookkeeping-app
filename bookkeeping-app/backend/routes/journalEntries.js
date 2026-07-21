const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');
const { checkJournalEntryBalance, calculatePlugAmount } = require('../services/journalBalance');
const { assertPeriodNotLocked } = require('../services/periodLock');

const router = express.Router();

const VALID_ENTRY_TYPES = ['opening_balance', 'depreciation', 'accrual', 'correction', 'adjustment', 'other'];

// List journal entries for a business, each with its lines
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const entriesResult = await pool.query(
    'SELECT * FROM journal_entries WHERE client_id = $1 ORDER BY entry_date DESC, created_at DESC',
    [client_id]
  );
  const entries = [];
  for (const entry of entriesResult.rows) {
    const linesResult = await pool.query(
      `SELECT t.id, t.account_id, a.name AS account_name, a.account_type, t.amount, t.description
       FROM transactions t JOIN accounts a ON t.account_id = a.id
       WHERE t.journal_entry_id = $1 ORDER BY t.created_at`,
      [entry.id]
    );
    entries.push({ ...entry, lines: linesResult.rows });
  }
  res.json(entries);
});

/**
 * Create a manual journal entry.
 * Body: { client_id, entry_date, description, entry_type, lines: [{account_id, amount, description}] }
 *
 * Lines must balance (see services/journalBalance.js for the sign
 * convention). Optionally, instead of providing every line yourself, pass
 * `auto_balance_account_id` (e.g. an "Opening Balance Equity" account) and
 * omit its line — the missing amount gets calculated and added
 * automatically so the entry balances. This is what the Opening Balances
 * quick-entry flow uses: you enter your actual account balances, and the
 * equity plug is computed for you.
 */
router.post('/', async (req, res) => {
  const { client_id, entry_date, description, entry_type, lines, auto_balance_account_id, override_lock } = req.body;

  if (!client_id || !entry_date || !description || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'client_id, entry_date, description, and a non-empty lines array are required' });
  }
  const entryType = entry_type || 'adjustment';
  if (!VALID_ENTRY_TYPES.includes(entryType)) {
    return res.status(400).json({ error: `entry_type must be one of: ${VALID_ENTRY_TYPES.join(', ')}` });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  let lockOverridden = false;
  try {
    lockOverridden = await assertPeriodNotLocked(client_id, entry_date, req.user, override_lock);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // Look up account_type for every line (and the auto-balance account, if any)
  const accountIds = lines.map((l) => l.account_id).concat(auto_balance_account_id ? [auto_balance_account_id] : []);
  const accountsResult = await pool.query('SELECT id, account_type FROM accounts WHERE id = ANY($1::uuid[]) AND client_id = $2', [
    accountIds,
    client_id,
  ]);
  const accountTypeById = Object.fromEntries(accountsResult.rows.map((a) => [a.id, a.account_type]));
  for (const id of accountIds) {
    if (!accountTypeById[id]) return res.status(400).json({ error: `Account ${id} not found for this client.` });
  }

  let allLines = lines.map((l) => ({ ...l, account_type: accountTypeById[l.account_id] }));

  if (auto_balance_account_id) {
    const plugAmount = calculatePlugAmount(allLines, accountTypeById[auto_balance_account_id]);
    allLines = allLines.concat([{
      account_id: auto_balance_account_id,
      amount: plugAmount,
      account_type: accountTypeById[auto_balance_account_id],
      description: `${description} (auto-balancing entry)`,
    }]);
  }

  const { balanced, weightedSum } = checkJournalEntryBalance(allLines);
  if (!balanced) {
    return res.status(400).json({
      error: `This entry does not balance (off by ${weightedSum}). Remember: increases to expenses are entered as negative amounts.`,
      weighted_sum: weightedSum,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const entryResult = await client.query(
      `INSERT INTO journal_entries (client_id, entry_date, description, entry_type, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [client_id, entry_date, description, entryType, req.user.userId]
    );
    const entry = entryResult.rows[0];

    for (const line of allLines) {
      await client.query(
        `INSERT INTO transactions (client_id, account_id, txn_date, description, amount, is_business, needs_review, journal_entry_id)
         VALUES ($1, $2, $3, $4, $5, true, false, $6)`,
        [client_id, line.account_id, entry_date, line.description || description, line.amount, entry.id]
      );
    }

    await client.query('COMMIT');
    await auditLog(req, { action: 'journal_entry.create', resourceType: 'journal_entry', resourceId: entry.id, metadata: { entry_type: entryType, lock_overridden: lockOverridden } });
    if (lockOverridden) {
      await auditLog(req, { action: 'period_lock.override', resourceType: 'journal_entry', resourceId: entry.id, metadata: { route: 'POST /api/journal-entries' } });
    }
    res.status(201).json({ ...entry, lines: allLines });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Delete a journal entry — cascades to delete its transaction lines automatically (FK ON DELETE CASCADE)
router.delete('/:id', async (req, res) => {
  const override_lock = req.query.override_lock === 'true' || req.body?.override_lock === true;
  const existing = await pool.query('SELECT * FROM journal_entries WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  let lockOverridden = false;
  try {
    lockOverridden = await assertPeriodNotLocked(existing.rows[0].client_id, existing.rows[0].entry_date, req.user, override_lock);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  await pool.query('DELETE FROM journal_entries WHERE id = $1', [req.params.id]);
  await auditLog(req, { action: 'journal_entry.delete', resourceType: 'journal_entry', resourceId: req.params.id, metadata: { lock_overridden: lockOverridden } });
  if (lockOverridden) {
    await auditLog(req, { action: 'period_lock.override', resourceType: 'journal_entry', resourceId: req.params.id, metadata: { route: 'DELETE /api/journal-entries/:id' } });
  }
  res.json({ status: 'deleted' });
});

module.exports = router;
