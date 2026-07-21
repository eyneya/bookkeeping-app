const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

// List pay runs for one worker
router.get('/', async (req, res) => {
  const { worker_id } = req.query;
  if (!worker_id) return res.status(400).json({ error: 'worker_id is required' });

  const workerResult = await pool.query('SELECT * FROM workers WHERE id = $1', [worker_id]);
  const worker = workerResult.rows[0];
  if (!worker) return res.status(404).json({ error: 'worker not found' });
  if (!(await userHasClientAccess(req.user, worker.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query('SELECT * FROM payroll_payments WHERE worker_id = $1 ORDER BY pay_date DESC', [worker_id]);
  res.json(result.rows);
});

/**
 * Record a pay run for a W-2 worker. Withholding/employer-tax figures are
 * entered directly (from your payroll processor's report) — this endpoint
 * does not calculate them.
 */
router.post('/', async (req, res) => {
  const {
    worker_id, pay_period_start, pay_period_end, pay_date, hours_worked, gross_pay,
    federal_withholding, state_withholding, social_security_employee, medicare_employee, other_deductions,
    employer_social_security, employer_medicare, employer_futa, employer_suta, other_employer_costs, notes,
  } = req.body;

  if (!worker_id || !pay_period_start || !pay_period_end || !pay_date || gross_pay === undefined) {
    return res.status(400).json({ error: 'worker_id, pay_period_start, pay_period_end, pay_date, and gross_pay are required' });
  }

  const workerResult = await pool.query('SELECT * FROM workers WHERE id = $1', [worker_id]);
  const worker = workerResult.rows[0];
  if (!worker) return res.status(404).json({ error: 'worker not found' });
  if (worker.worker_type === '1099_contractor') {
    return res.status(400).json({
      error: 'This worker is tracked as a 1099 contractor — record their payments as vendor transactions instead, not a payroll run.',
    });
  }
  if (!(await userHasClientAccess(req.user, worker.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const totalDeductions =
    Number(federal_withholding || 0) + Number(state_withholding || 0) +
    Number(social_security_employee || 0) + Number(medicare_employee || 0) + Number(other_deductions || 0);
  const netPay = Number(gross_pay) - totalDeductions;

  const result = await pool.query(
    `INSERT INTO payroll_payments (
       client_id, worker_id, pay_period_start, pay_period_end, pay_date, hours_worked, gross_pay,
       federal_withholding, state_withholding, social_security_employee, medicare_employee, other_deductions, net_pay,
       employer_social_security, employer_medicare, employer_futa, employer_suta, other_employer_costs, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [
      worker.client_id, worker_id, pay_period_start, pay_period_end, pay_date, hours_worked || null, gross_pay,
      federal_withholding || 0, state_withholding || 0, social_security_employee || 0, medicare_employee || 0, other_deductions || 0, netPay,
      employer_social_security || 0, employer_medicare || 0, employer_futa || 0, employer_suta || 0, other_employer_costs || 0, notes || null,
    ]
  );
  await auditLog(req, { action: 'payroll_payment.create', resourceType: 'payroll_payment', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

module.exports = router;
