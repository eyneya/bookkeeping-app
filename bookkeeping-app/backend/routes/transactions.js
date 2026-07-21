const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess, userHasCustomerAccess } = require('../middleware/clientAccess');
const { assertPeriodNotLocked } = require('../services/periodLock');

const router = express.Router();

/** Checks access for a transaction already fetched from the DB, based on whichever tier it belongs to. */
async function userHasTxnAccess(user, txn) {
  if (txn.client_id) return userHasClientAccess(user, txn.client_id);
  return userHasCustomerAccess(user, txn.customer_id);
}

// List transactions. Pass client_id for a business's ledger, or customer_id
// for that person's shared personal pool (annotated with which business, if
// any, has already claimed each one). Supports pagination (limit/offset,
// default 100/max 500) and search (q, matches description).
router.get('/', async (req, res) => {
  const { client_id, customer_id, needs_review, q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  if (!client_id && !customer_id) return res.status(400).json({ error: 'client_id or customer_id is required' });

  if (client_id && !(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (customer_id && !(await userHasCustomerAccess(req.user, customer_id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }

  const params = [];
  let whereClause = '';

  if (client_id) {
    params.push(client_id);
    whereClause += `t.client_id = $${params.length}`;
  } else {
    params.push(customer_id);
    whereClause += `t.customer_id = $${params.length}`;
  }

  if (needs_review !== undefined) {
    params.push(needs_review === 'true');
    whereClause += ` AND t.needs_review = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    whereClause += ` AND t.description ILIKE $${params.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM transactions t WHERE ${whereClause}`,
    params
  );

  const listParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT t.*, a.name AS account_name, c.name AS claimed_by_business_name
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     LEFT JOIN clients c ON t.flagged_for_client_id = c.id
     WHERE ${whereClause}
     ORDER BY t.txn_date DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ transactions: result.rows, total: Number(countResult.rows[0].count), limit, offset });
});

// Categorize / correct a BUSINESS transaction
router.patch('/:id', async (req, res) => {
  const existing = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasTxnAccess(req.user, existing.rows[0]))) {
    return res.status(403).json({ error: 'You do not have access to this transaction.' });
  }

  const { account_id, is_business, notes, amount, description, txn_date, vendor_id, override_lock } = req.body;

  let lockOverridden = false;
  try {
    lockOverridden = (await assertPeriodNotLocked(existing.rows[0].client_id, existing.rows[0].txn_date, req.user, override_lock)) || lockOverridden;
    if (txn_date) {
      lockOverridden = (await assertPeriodNotLocked(existing.rows[0].client_id, txn_date, req.user, override_lock)) || lockOverridden;
    }
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (lockOverridden) {
    await auditLog(req, {
      action: 'period_lock.override',
      resourceType: 'transaction',
      resourceId: req.params.id,
      metadata: { route: 'PATCH /api/transactions/:id' },
    });
  }

  const result = await pool.query(
    `UPDATE transactions SET
       account_id = COALESCE($1, account_id),
       is_business = COALESCE($2, is_business),
       notes = COALESCE($3, notes),
       amount = COALESCE($4, amount),
       description = COALESCE($5, description),
       txn_date = COALESCE($6, txn_date),
       vendor_id = COALESCE($7, vendor_id),
       needs_review = false
     WHERE id = $8 RETURNING *`,
    [account_id, is_business, notes, amount, description, txn_date, vendor_id, req.params.id]
  );
  await auditLog(req, { action: 'transaction.categorize', resourceType: 'transaction', resourceId: req.params.id });
  res.json(result.rows[0]);
});

// Categorize a PERSONAL transaction with a free-text category
router.patch('/:id/personal-category', async (req, res) => {
  const existing = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasTxnAccess(req.user, existing.rows[0]))) {
    return res.status(403).json({ error: 'You do not have access to this transaction.' });
  }

  const { personal_category } = req.body;
  const result = await pool.query(
    `UPDATE transactions SET personal_category = $1, needs_review = false WHERE id = $2 RETURNING *`,
    [personal_category, req.params.id]
  );
  res.json(result.rows[0]);
});

/**
 * Cross-reference step (Tier 3): claim a personal transaction for a
 * specific business, because it was actually a business purchase paid from
 * personal funds. Requires owner_id (not just client_id) because the same
 * customer might be an owner of several businesses at different ownership
 * percentages — owner_id pins down exactly which business + which
 * percentage this contribution counts against.
 *
 * Does three things atomically:
 *   1. Creates a business-side expense transaction (reduces that business's
 *      taxable income on the P&L)
 *   2. Creates a capital contribution entry for that owner
 *   3. Marks the personal transaction claimed, recording exactly which
 *      business/owner/business-transaction it's tied to — this is what
 *      "flagged_for_client_id" shows other businesses so it can't be
 *      accidentally double-claimed, and what makes unflagging exact.
 */
router.post('/:id/flag-as-business-expense', async (req, res) => {
  const { owner_id, account_id, override_lock } = req.body;
  if (!owner_id || !account_id) {
    return res.status(400).json({ error: 'owner_id and account_id are required' });
  }

  const personalTxnResult = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  const personalTxn = personalTxnResult.rows[0];
  if (!personalTxn) return res.status(404).json({ error: 'transaction not found' });
  if (!(await userHasTxnAccess(req.user, personalTxn))) {
    return res.status(403).json({ error: 'You do not have access to this transaction.' });
  }
  if (!personalTxn.customer_id) return res.status(400).json({ error: 'This is not a personal-tier transaction.' });
  if (personalTxn.flagged_as_business) {
    return res.status(400).json({
      error: `Already claimed by ${personalTxn.flagged_for_client_id ? 'another business' : 'this business'}. Unflag it first if you need to reassign it.`,
    });
  }

  const ownerResult = await pool.query('SELECT * FROM owners WHERE id = $1', [owner_id]);
  const owner = ownerResult.rows[0];
  if (!owner) return res.status(404).json({ error: 'owner not found' });
  if (owner.customer_id !== personalTxn.customer_id) {
    return res.status(400).json({ error: 'This owner record does not belong to the same person as this personal transaction.' });
  }
  if (!(await userHasClientAccess(req.user, owner.client_id))) {
    return res.status(403).json({ error: 'You do not have access to the business you are trying to flag this for.' });
  }
  let lockOverridden = false;
  try {
    lockOverridden = await assertPeriodNotLocked(owner.client_id, personalTxn.txn_date, req.user, override_lock);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const businessTxnResult = await client.query(
      `INSERT INTO transactions (client_id, document_id, account_id, txn_date, description, amount, is_business, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, true, false) RETURNING id`,
      [
        owner.client_id,
        personalTxn.document_id,
        account_id,
        personalTxn.txn_date,
        `${personalTxn.description} (paid personally by ${owner.name})`,
        -Math.abs(Number(personalTxn.amount)),
      ]
    );
    const businessTxnId = businessTxnResult.rows[0].id;

    await client.query(
      `INSERT INTO capital_account_entries (owner_id, entry_date, entry_type, amount, source_transaction_id, notes)
       VALUES ($1, $2, 'contribution', $3, $4, $5)`,
      [
        owner_id,
        personalTxn.txn_date,
        Math.abs(Number(personalTxn.amount)),
        businessTxnId,
        `Business expense paid personally: ${personalTxn.description}`,
      ]
    );

    await client.query(
      `UPDATE transactions SET
         flagged_as_business = true,
         flagged_for_client_id = $1,
         linked_business_txn_id = $2,
         source_owner_id = $3,
         needs_review = false
       WHERE id = $4`,
      [owner.client_id, businessTxnId, owner_id, req.params.id]
    );

    await client.query('COMMIT');
    await auditLog(req, {
      action: 'transaction.flag_as_business',
      resourceType: 'transaction',
      resourceId: req.params.id,
      metadata: { business_transaction_id: businessTxnId, owner_id, client_id: owner.client_id, lock_overridden: lockOverridden },
    });
    if (lockOverridden) {
      await auditLog(req, { action: 'period_lock.override', resourceType: 'transaction', resourceId: req.params.id, metadata: { route: 'flag-as-business-expense' } });
    }
    res.json({ status: 'flagged', business_transaction_id: businessTxnId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * Reverses flag-as-business-expense exactly: deletes the business
 * transaction and the capital contribution entry it created, and resets
 * the personal transaction back to unclaimed. Safe to call any time since
 * it only touches records this specific flag action created
 * (linked_business_txn_id ties them together unambiguously).
 */
router.post('/:id/unflag-business-expense', async (req, res) => {
  const { override_lock } = req.body;
  const personalTxnResult = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  const personalTxn = personalTxnResult.rows[0];
  if (!personalTxn) return res.status(404).json({ error: 'transaction not found' });
  if (!(await userHasTxnAccess(req.user, personalTxn))) {
    return res.status(403).json({ error: 'You do not have access to this transaction.' });
  }
  if (!personalTxn.flagged_as_business) return res.status(400).json({ error: 'This transaction is not currently flagged.' });
  let lockOverridden = false;
  try {
    lockOverridden = await assertPeriodNotLocked(personalTxn.flagged_for_client_id, personalTxn.txn_date, req.user, override_lock);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete the capital contribution entry that was created from this flag
    await client.query('DELETE FROM capital_account_entries WHERE source_transaction_id = $1', [personalTxn.linked_business_txn_id]);

    // Clear the personal transaction's FK reference to the business
    // transaction FIRST — the business transaction can't be deleted while
    // something still points at it (transactions.linked_business_txn_id is
    // a self-referencing FK with no ON DELETE action).
    await client.query(
      `UPDATE transactions SET
         flagged_as_business = false,
         flagged_for_client_id = NULL,
         linked_business_txn_id = NULL,
         source_owner_id = NULL,
         needs_review = true
       WHERE id = $1`,
      [req.params.id]
    );

    // Now safe to delete the business-side expense transaction
    await client.query('DELETE FROM transactions WHERE id = $1', [personalTxn.linked_business_txn_id]);

    await client.query('COMMIT');
    await auditLog(req, { action: 'transaction.unflag_business', resourceType: 'transaction', resourceId: req.params.id, metadata: { lock_overridden: lockOverridden } });
    if (lockOverridden) {
      await auditLog(req, { action: 'period_lock.override', resourceType: 'transaction', resourceId: req.params.id, metadata: { route: 'unflag-business-expense' } });
    }
    res.json({ status: 'unflagged' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Bulk categorize BUSINESS transactions
router.post('/bulk-categorize', async (req, res) => {
  const { transaction_ids, account_id, is_business } = req.body;
  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    return res.status(400).json({ error: 'transaction_ids array is required' });
  }

  const existing = await pool.query('SELECT DISTINCT client_id FROM transactions WHERE id = ANY($1::uuid[])', [transaction_ids]);
  for (const row of existing.rows) {
    if (row.client_id && !(await userHasClientAccess(req.user, row.client_id))) {
      return res.status(403).json({ error: 'You do not have access to one or more of these transactions.' });
    }
  }

  const result = await pool.query(
    `UPDATE transactions SET
       account_id = COALESCE($1, account_id),
       is_business = COALESCE($2, is_business),
       needs_review = false
     WHERE id = ANY($3::uuid[]) RETURNING *`,
    [account_id, is_business, transaction_ids]
  );
  res.json({ updated: result.rows.length });
});

// Delete a transaction (e.g. a confirmed duplicate). Does not cascade to
// anything else — if this transaction was flagged as a business expense or
// created by a journal entry, delete/unflag through those flows instead so
// the related capital account entries stay consistent.
router.delete('/:id', async (req, res) => {
  const override_lock = req.query.override_lock === 'true' || req.body?.override_lock === true;
  const existing = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  const txn = existing.rows[0];
  if (!(await userHasTxnAccess(req.user, txn))) {
    return res.status(403).json({ error: 'You do not have access to this transaction.' });
  }
  if (txn.journal_entry_id) {
    return res.status(400).json({ error: 'This transaction is part of a journal entry — delete the journal entry instead.' });
  }
  if (txn.flagged_as_business) {
    return res.status(400).json({ error: 'This transaction is flagged as a business expense — unflag it first.' });
  }
  let lockOverridden = false;
  try {
    lockOverridden = await assertPeriodNotLocked(txn.client_id, txn.txn_date, req.user, override_lock);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
  await auditLog(req, { action: 'transaction.delete', resourceType: 'transaction', resourceId: req.params.id, metadata: { lock_overridden: lockOverridden } });
  if (lockOverridden) {
    await auditLog(req, { action: 'period_lock.override', resourceType: 'transaction', resourceId: req.params.id, metadata: { route: 'DELETE /api/transactions/:id' } });
  }
  res.json({ status: 'deleted' });
});

module.exports = router;
