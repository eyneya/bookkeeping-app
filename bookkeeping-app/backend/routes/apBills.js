const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List AP bills for a business (includes ones auto-created from uploaded invoice/receipt documents)
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM invoices WHERE client_id = $1 ORDER BY due_date NULLS LAST', [client_id]);
  res.json(result.rows);
});

// Manually add a bill (for vendor bills that didn't come from an uploaded document)
router.post('/', async (req, res) => {
  const { client_id, vendor_name, invoice_number, invoice_date, due_date, amount } = req.body;
  if (!client_id || !vendor_name || !due_date || amount === undefined) {
    return res.status(400).json({ error: 'client_id, vendor_name, due_date, and amount are required' });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query(
    `INSERT INTO invoices (client_id, vendor_name, invoice_number, invoice_date, due_date, amount, paid_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'unpaid') RETURNING *`,
    [client_id, vendor_name, invoice_number || null, invoice_date || null, due_date, amount]
  );
  await auditLog(req, { action: 'ap_bill.create', resourceType: 'invoice', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Record a payment against a bill (partial or full)
router.post('/:id/payments', async (req, res) => {
  const existing = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const { amount } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'amount is required' });

  const bill = existing.rows[0];
  const newAmountPaid = Number(bill.amount_paid) + Number(amount);
  const newStatus = newAmountPaid >= Number(bill.amount) - 0.005 ? 'paid' : 'partial';

  const result = await pool.query(
    `UPDATE invoices SET amount_paid = $1, paid_status = $2 WHERE id = $3 RETURNING *`,
    [newAmountPaid, newStatus, req.params.id]
  );
  await auditLog(req, { action: 'ap_bill.payment', resourceType: 'invoice', resourceId: req.params.id, metadata: { amount } });
  res.json(result.rows[0]);
});

module.exports = router;
