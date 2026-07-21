const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List AR invoices for a business
router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM ar_invoices WHERE client_id = $1 ORDER BY due_date', [client_id]);
  res.json(result.rows);
});

// Add an invoice sent to the business's own customer
router.post('/', async (req, res) => {
  const { client_id, customer_name, invoice_number, invoice_date, due_date, amount, notes } = req.body;
  if (!client_id || !customer_name || !invoice_date || !due_date || amount === undefined) {
    return res.status(400).json({ error: 'client_id, customer_name, invoice_date, due_date, and amount are required' });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query(
    `INSERT INTO ar_invoices (client_id, customer_name, invoice_number, invoice_date, due_date, amount, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [client_id, customer_name, invoice_number || null, invoice_date, due_date, amount, notes || null]
  );
  await auditLog(req, { action: 'ar_invoice.create', resourceType: 'ar_invoice', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Record a payment received against an AR invoice (partial or full)
router.post('/:id/payments', async (req, res) => {
  const existing = await pool.query('SELECT * FROM ar_invoices WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const { amount } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'amount is required' });

  const invoice = existing.rows[0];
  const newAmountPaid = Number(invoice.amount_paid) + Number(amount);

  const result = await pool.query(
    `UPDATE ar_invoices SET amount_paid = $1 WHERE id = $2 RETURNING *`,
    [newAmountPaid, req.params.id]
  );
  await auditLog(req, { action: 'ar_invoice.payment', resourceType: 'ar_invoice', resourceId: req.params.id, metadata: { amount } });
  res.json(result.rows[0]);
});

module.exports = router;
