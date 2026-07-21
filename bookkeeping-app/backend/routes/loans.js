const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM loans WHERE client_id = $1 ORDER BY origination_date', [client_id]);
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { client_id, lender_name, original_principal, annual_interest_rate, origination_date, term_months, notes } = req.body;
  if (!client_id || !lender_name || !original_principal || annual_interest_rate === undefined || !origination_date || !term_months) {
    return res.status(400).json({
      error: 'client_id, lender_name, original_principal, annual_interest_rate, origination_date, and term_months are required',
    });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `INSERT INTO loans (client_id, lender_name, original_principal, annual_interest_rate, origination_date, term_months, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [client_id, lender_name, original_principal, annual_interest_rate, origination_date, term_months, notes || null]
  );
  await auditLog(req, { action: 'loan.create', resourceType: 'loan', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

module.exports = router;
