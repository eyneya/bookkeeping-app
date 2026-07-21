const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List vendors for a business
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM vendors WHERE client_id = $1 ORDER BY name', [client_id]);
  res.json(result.rows);
});

// Add a vendor
router.post('/', async (req, res) => {
  const { client_id, name, tax_id, tax_id_type, address, requires_1099, w9_on_file, notes } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name are required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `INSERT INTO vendors (client_id, name, tax_id, tax_id_type, address, requires_1099, w9_on_file, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [client_id, name, tax_id || null, tax_id_type || null, address || null, requires_1099 !== false, w9_on_file || false, notes || null]
  );
  // Never log the tax_id itself in audit metadata — it's sensitive PII
  await auditLog(req, { action: 'vendor.create', resourceType: 'vendor', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Update a vendor (e.g. mark W-9 received, correct tax ID)
router.patch('/:id', async (req, res) => {
  const existing = await pool.query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const { name, tax_id, tax_id_type, address, requires_1099, w9_on_file, notes } = req.body;
  const result = await pool.query(
    `UPDATE vendors SET
       name = COALESCE($1, name),
       tax_id = COALESCE($2, tax_id),
       tax_id_type = COALESCE($3, tax_id_type),
       address = COALESCE($4, address),
       requires_1099 = COALESCE($5, requires_1099),
       w9_on_file = COALESCE($6, w9_on_file),
       notes = COALESCE($7, notes)
     WHERE id = $8 RETURNING *`,
    [name, tax_id, tax_id_type, address, requires_1099, w9_on_file, notes, req.params.id]
  );
  await auditLog(req, { action: 'vendor.update', resourceType: 'vendor', resourceId: req.params.id });
  res.json(result.rows[0]);
});

module.exports = router;
