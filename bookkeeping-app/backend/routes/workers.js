const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

const VALID_TYPES = ['1099_contractor', 'w2_hourly', 'w2_salary'];

// List workers for a business
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query(
    `SELECT w.*, v.name AS vendor_name, v.w9_on_file
     FROM workers w LEFT JOIN vendors v ON w.vendor_id = v.id
     WHERE w.client_id = $1 ORDER BY w.name`,
    [client_id]
  );
  res.json(result.rows);
});

/**
 * Add a worker. For '1099_contractor', pass EITHER an existing vendor_id
 * (they're already tracked as a vendor) OR nothing and a new vendor record
 * gets created automatically from their name — either way, their payments
 * flow through the existing vendor/1099 tracking rather than a separate
 * payroll table, so the same dollars never get counted twice.
 */
router.post('/', async (req, res) => {
  const { client_id, name, worker_type, vendor_id, hourly_rate, annual_salary, pay_frequency, ssn, start_date, notes } = req.body;
  if (!client_id || !name || !worker_type) {
    return res.status(400).json({ error: 'client_id, name, and worker_type are required' });
  }
  if (!VALID_TYPES.includes(worker_type)) {
    return res.status(400).json({ error: `worker_type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  let resolvedVendorId = vendor_id || null;

  if (worker_type === '1099_contractor') {
    if (vendor_id) {
      const vendorCheck = await pool.query('SELECT * FROM vendors WHERE id = $1 AND client_id = $2', [vendor_id, client_id]);
      if (vendorCheck.rows.length === 0) return res.status(404).json({ error: 'vendor_id not found for this client' });
    } else {
      // Auto-create a vendor record so this worker's payments feed the 1099 summary
      const vendorInsert = await pool.query(
        `INSERT INTO vendors (client_id, name, requires_1099) VALUES ($1, $2, true) RETURNING id`,
        [client_id, name]
      );
      resolvedVendorId = vendorInsert.rows[0].id;
    }
  } else {
    // W-2 workers shouldn't carry a vendor link — that's the 1099 pathway
    resolvedVendorId = null;
  }

  const result = await pool.query(
    `INSERT INTO workers (client_id, name, worker_type, vendor_id, hourly_rate, annual_salary, pay_frequency, ssn, start_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      client_id, name, worker_type, resolvedVendorId,
      worker_type === 'w2_hourly' ? hourly_rate || null : null,
      worker_type === 'w2_salary' ? annual_salary || null : null,
      worker_type !== '1099_contractor' ? pay_frequency || null : null,
      ssn || null,
      start_date || null,
      notes || null,
    ]
  );
  // Never log SSN in audit metadata — sensitive PII
  await auditLog(req, { action: 'worker.create', resourceType: 'worker', resourceId: result.rows[0].id, metadata: { worker_type } });
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const existing = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const { name, hourly_rate, annual_salary, pay_frequency, active, end_date, notes } = req.body;
  const result = await pool.query(
    `UPDATE workers SET
       name = COALESCE($1, name),
       hourly_rate = COALESCE($2, hourly_rate),
       annual_salary = COALESCE($3, annual_salary),
       pay_frequency = COALESCE($4, pay_frequency),
       active = COALESCE($5, active),
       end_date = COALESCE($6, end_date),
       notes = COALESCE($7, notes)
     WHERE id = $8 RETURNING *`,
    [name, hourly_rate, annual_salary, pay_frequency, active, end_date, notes, req.params.id]
  );
  res.json(result.rows[0]);
});

module.exports = router;
