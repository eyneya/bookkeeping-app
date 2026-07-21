const express = require('express');
const pool = require('../db/pool');
const { seedDefaultAccounts } = require('../services/defaultAccounts');
const { getStorageAdapter } = require('../services/storage');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess, requireClientAccess } = require('../middleware/clientAccess');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List clients (businesses). Admins see everything; preparers only see
// businesses they've been explicitly granted access to.
router.get('/', async (req, res) => {
  if (req.user.role === 'admin') {
    const result = await pool.query('SELECT * FROM clients ORDER BY name');
    return res.json(result.rows);
  }
  const result = await pool.query(
    `SELECT c.* FROM clients c
     JOIN user_client_access uca ON uca.client_id = c.id
     WHERE uca.user_id = $1
     ORDER BY c.name`,
    [req.user.userId]
  );
  res.json(result.rows);
});

const VALID_ENTITY_TYPES = ['individual', 'llc_single_member', 'partnership', 's_corp', 'c_corp'];

/**
 * Create a new business. If customer_id + ownership_percentage are provided,
 * this also creates the owners link in one step. The creating user is
 * automatically granted access to the new business (admins already see
 * everything, but this matters for preparers creating their own clients).
 */
router.post('/', async (req, res) => {
  const { name, entity_type, storage_provider, customer_id, owner_type, ownership_percentage } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const entityType = entity_type || 'individual';
  if (!VALID_ENTITY_TYPES.includes(entityType)) {
    return res.status(400).json({ error: `entity_type must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });
  }

  const provider = storage_provider || process.env.DEFAULT_STORAGE_PROVIDER || 'google';

  let storageFolderId = null;
  try {
    const adapter = getStorageAdapter(provider);
    const folder = await adapter.createClientFolder(name);
    storageFolderId = folder.folderId;
  } catch (err) {
    console.error(`Storage folder creation failed for ${provider}:`, err.message);
  }

  const result = await pool.query(
    'INSERT INTO clients (name, entity_type, storage_provider, storage_folder_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, entityType, provider, storageFolderId]
  );
  const client = result.rows[0];
  await seedDefaultAccounts(pool, client.id, entityType);

  // Grant the creator access (no-op in effect for admins, but keeps the
  // access-grant table complete/consistent even if their role changes later)
  await pool.query(
    `INSERT INTO user_client_access (user_id, client_id, granted_by) VALUES ($1, $2, $1) ON CONFLICT DO NOTHING`,
    [req.user.userId, client.id]
  );

  let ownerRecord = null;
  if (customer_id && ownership_percentage !== undefined) {
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'customer_id not found — business was created, but not linked to an owner.' });
    }
    const ownerInsert = await pool.query(
      `INSERT INTO owners (client_id, customer_id, name, owner_type, ownership_percentage)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [client.id, customer_id, customerResult.rows[0].name, owner_type || 'partner', ownership_percentage]
    );
    ownerRecord = ownerInsert.rows[0];
  }

  await auditLog(req, { action: 'client.create', resourceType: 'client', resourceId: client.id });
  res.status(201).json({ ...client, owner: ownerRecord });
});

// Get one client + their chart of accounts
router.get('/:id', requireClientAccess((req) => req.params.id), async (req, res) => {
  const client = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (client.rows.length === 0) return res.status(404).json({ error: 'not found' });
  const accounts = await pool.query('SELECT * FROM accounts WHERE client_id = $1 ORDER BY account_type, name', [req.params.id]);
  res.json({ ...client.rows[0], accounts: accounts.rows });
});

// --- Staff access management (admin only) ---

// List who currently has access to this business
router.get('/:id/staff', requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, uca.granted_at
     FROM user_client_access uca
     JOIN users u ON u.id = uca.user_id
     WHERE uca.client_id = $1
     ORDER BY u.email`,
    [req.params.id]
  );
  res.json(result.rows);
});

// Grant a preparer access to this business
router.post('/:id/staff', requireAdmin, async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  await pool.query(
    `INSERT INTO user_client_access (user_id, client_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [user_id, req.params.id, req.user.userId]
  );
  await auditLog(req, { action: 'staff_access.grant', resourceType: 'client', resourceId: req.params.id, metadata: { granted_to: user_id } });
  res.status(201).json({ status: 'granted' });
});

// Revoke a preparer's access to this business
router.delete('/:id/staff/:userId', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM user_client_access WHERE client_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
  await auditLog(req, { action: 'staff_access.revoke', resourceType: 'client', resourceId: req.params.id, metadata: { revoked_from: req.params.userId } });
  res.json({ status: 'revoked' });
});

// --- Period locking (admin only) ---
// Locks all transactions/journal entries dated on or before locked_through_date
// against edits/deletes/flagging — use once a return has been filed for that period.
router.patch('/:id/lock-period', requireAdmin, async (req, res) => {
  const { locked_through_date } = req.body;
  if (!locked_through_date) return res.status(400).json({ error: 'locked_through_date is required' });
  const result = await pool.query(
    'UPDATE clients SET locked_through_date = $1 WHERE id = $2 RETURNING *',
    [locked_through_date, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
  await auditLog(req, { action: 'client.lock_period', resourceType: 'client', resourceId: req.params.id, metadata: { locked_through_date } });
  res.json(result.rows[0]);
});

router.delete('/:id/lock-period', requireAdmin, async (req, res) => {
  const result = await pool.query('UPDATE clients SET locked_through_date = NULL WHERE id = $1 RETURNING *', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
  await auditLog(req, { action: 'client.unlock_period', resourceType: 'client', resourceId: req.params.id });
  res.json(result.rows[0]);
});

module.exports = router;
