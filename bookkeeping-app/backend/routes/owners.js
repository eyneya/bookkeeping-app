const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List owners (partners/shareholders) for a business
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM owners WHERE client_id = $1 ORDER BY name', [client_id]);
  res.json(result.rows);
});

/**
 * Add an owner to a business. Pass EITHER:
 *   - customer_id (an existing customer, e.g. adding their second business), OR
 *   - name (a brand new customer gets created automatically)
 * This is what supports "same person, multiple businesses" — you link the
 * same customer_id as an owner on more than one client, and their personal
 * document pool becomes visible for allocation to whichever one you're
 * working on.
 */
router.post('/', async (req, res) => {
  const { client_id, customer_id, name, owner_type, ownership_percentage } = req.body;
  if (!client_id || ownership_percentage === undefined) {
    return res.status(400).json({ error: 'client_id and ownership_percentage are required' });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (!customer_id && !name) {
    return res.status(400).json({ error: 'Provide either customer_id (existing person) or name (creates a new one)' });
  }

  let resolvedCustomerId = customer_id || null;
  let resolvedName = name;

  if (customer_id) {
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (customerResult.rows.length === 0) return res.status(404).json({ error: 'customer not found' });
    resolvedName = customerResult.rows[0].name;
  } else {
    // Auto-create a new customer for this name, so their personal tier exists from the start
    const newCustomer = await pool.query(
      `INSERT INTO customers (name) VALUES ($1) RETURNING id`,
      [name]
    );
    resolvedCustomerId = newCustomer.rows[0].id;
  }

  const result = await pool.query(
    `INSERT INTO owners (client_id, customer_id, name, owner_type, ownership_percentage)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [client_id, resolvedCustomerId, resolvedName, owner_type || 'partner', ownership_percentage]
  );
  await auditLog(req, { action: 'owner.create', resourceType: 'owner', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Record a capital account movement (contribution or distribution) for an owner
router.post('/:ownerId/capital-entries', async (req, res) => {
  const ownerResult = await pool.query('SELECT * FROM owners WHERE id = $1', [req.params.ownerId]);
  const owner = ownerResult.rows[0];
  if (!owner) return res.status(404).json({ error: 'owner not found' });
  if (!(await userHasClientAccess(req.user, owner.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const { entry_date, entry_type, amount, notes } = req.body;
  if (!entry_date || !entry_type || amount === undefined) {
    return res.status(400).json({ error: 'entry_date, entry_type, and amount are required' });
  }
  if (!['contribution', 'distribution'].includes(entry_type)) {
    return res.status(400).json({ error: "entry_type must be 'contribution' or 'distribution'" });
  }
  const result = await pool.query(
    `INSERT INTO capital_account_entries (owner_id, entry_date, entry_type, amount, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.ownerId, entry_date, entry_type, amount, notes || null]
  );
  await auditLog(req, { action: 'capital_entry.create', resourceType: 'capital_account_entry', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Delete a manually-entered capital account movement (not ones created by flagging —
// those get reversed via the unflag endpoint in transactions.js, to keep the reversal atomic)
router.delete('/capital-entries/:entryId', async (req, res) => {
  const entryResult = await pool.query(
    `SELECT ce.*, o.client_id FROM capital_account_entries ce JOIN owners o ON ce.owner_id = o.id WHERE ce.id = $1`,
    [req.params.entryId]
  );
  const entry = entryResult.rows[0];
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, entry.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (entry.source_transaction_id) {
    return res.status(400).json({
      error: 'This entry came from a flagged transaction — use the unflag action on that transaction instead of deleting it directly.',
    });
  }
  await pool.query('DELETE FROM capital_account_entries WHERE id = $1', [req.params.entryId]);
  await auditLog(req, { action: 'capital_entry.delete', resourceType: 'capital_account_entry', resourceId: req.params.entryId });
  res.json({ status: 'deleted' });
});

/**
 * Ownership percentage history — record a change in an owner's percentage
 * effective from a given date (e.g. a partner buying in/out mid-year).
 * The Capital Accounts report uses this to compute a time-weighted average
 * instead of a flat percentage once any history exists for an owner.
 */
router.get('/:ownerId/ownership-history', async (req, res) => {
  const ownerResult = await pool.query('SELECT * FROM owners WHERE id = $1', [req.params.ownerId]);
  const owner = ownerResult.rows[0];
  if (!owner) return res.status(404).json({ error: 'owner not found' });
  if (!(await userHasClientAccess(req.user, owner.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query(
    'SELECT * FROM ownership_history WHERE owner_id = $1 ORDER BY effective_date',
    [req.params.ownerId]
  );
  res.json(result.rows);
});

router.post('/:ownerId/ownership-history', async (req, res) => {
  const ownerResult = await pool.query('SELECT * FROM owners WHERE id = $1', [req.params.ownerId]);
  const owner = ownerResult.rows[0];
  if (!owner) return res.status(404).json({ error: 'owner not found' });
  if (!(await userHasClientAccess(req.user, owner.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const { effective_date, ownership_percentage, notes } = req.body;
  if (!effective_date || ownership_percentage === undefined) {
    return res.status(400).json({ error: 'effective_date and ownership_percentage are required' });
  }
  const result = await pool.query(
    `INSERT INTO ownership_history (owner_id, effective_date, ownership_percentage, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.ownerId, effective_date, ownership_percentage, notes || null]
  );
  await auditLog(req, { action: 'ownership_history.create', resourceType: 'owner', resourceId: req.params.ownerId });
  res.status(201).json(result.rows[0]);
});

module.exports = router;
