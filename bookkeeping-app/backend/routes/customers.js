const express = require('express');
const pool = require('../db/pool');
const { getStorageAdapter } = require('../services/storage');
const { auditLog } = require('../middleware/auditLog');
const { userHasCustomerAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List all customers. Admins see everyone; preparers see customers they
// created themselves OR who co-own at least one business they've been
// granted access to.
router.get('/', async (req, res) => {
  if (req.user.role === 'admin') {
    const result = await pool.query('SELECT * FROM customers ORDER BY name');
    return res.json(result.rows);
  }
  const result = await pool.query(
    `SELECT DISTINCT c.* FROM customers c
     LEFT JOIN owners o ON o.customer_id = c.id
     LEFT JOIN user_client_access uca ON uca.client_id = o.client_id AND uca.user_id = $1
     WHERE c.created_by = $1 OR uca.user_id = $1
     ORDER BY c.name`,
    [req.user.userId]
  );
  res.json(result.rows);
});

// Create a customer (a person) — separate from any specific business
router.post('/', async (req, res) => {
  const { name, storage_provider, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const provider = storage_provider || process.env.DEFAULT_STORAGE_PROVIDER || 'google';
  let storageFolderId = null;
  try {
    const adapter = getStorageAdapter(provider);
    const folder = await adapter.createClientFolder(name);
    storageFolderId = folder.folderId;
  } catch (err) {
    console.error(`Storage folder creation failed for customer ${name}:`, err.message);
  }

  const result = await pool.query(
    `INSERT INTO customers (name, notes, storage_provider, storage_folder_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, notes || null, provider, storageFolderId, req.user.userId]
  );
  await auditLog(req, { action: 'customer.create', resourceType: 'customer', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Get a customer + every business they own/co-own (via the owners join table)
router.get('/:id', async (req, res) => {
  if (!(await userHasCustomerAccess(req.user, req.params.id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }
  const customer = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (customer.rows.length === 0) return res.status(404).json({ error: 'not found' });

  const businesses = await pool.query(
    `SELECT c.*, o.id AS owner_record_id, o.ownership_percentage, o.owner_type
     FROM owners o
     JOIN clients c ON o.client_id = c.id
     WHERE o.customer_id = $1
     ORDER BY c.name`,
    [req.params.id]
  );

  res.json({ ...customer.rows[0], businesses: businesses.rows });
});

/**
 * The core "multiple businesses, same statements" view: every personal
 * transaction for this customer, annotated with which business (if any)
 * has already claimed it. This is what lets you open a second business for
 * the same person and immediately see what's already spoken for vs. still
 * available to flag for the new business.
 */
router.get('/:id/transactions', async (req, res) => {
  if (!(await userHasCustomerAccess(req.user, req.params.id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const { q } = req.query;

  const params = [req.params.id];
  let whereClause = 't.customer_id = $1';
  if (q) {
    params.push(`%${q}%`);
    whereClause += ` AND t.description ILIKE $${params.length}`;
  }

  const countResult = await pool.query(`SELECT COUNT(*) FROM transactions t WHERE ${whereClause}`, params);

  const listParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT t.*, c.name AS claimed_by_business_name
     FROM transactions t
     LEFT JOIN clients c ON t.flagged_for_client_id = c.id
     WHERE ${whereClause}
     ORDER BY t.txn_date DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  res.json({ transactions: result.rows, total: Number(countResult.rows[0].count), limit, offset });
});

module.exports = router;
