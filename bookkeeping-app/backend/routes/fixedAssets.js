const express = require('express');
const pool = require('../db/pool');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess } = require('../middleware/clientAccess');

const router = express.Router();

const VALID_METHODS = ['straight_line']; // only method this build actually calculates

router.get('/', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM fixed_assets WHERE client_id = $1 ORDER BY purchase_date', [client_id]);
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const {
    client_id, description, purchase_date, purchase_amount,
    section_179_amount, bonus_depreciation_amount, useful_life_years, depreciation_method,
  } = req.body;

  if (!client_id || !description || !purchase_date || purchase_amount === undefined || !useful_life_years) {
    return res.status(400).json({ error: 'client_id, description, purchase_date, purchase_amount, and useful_life_years are required' });
  }
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const method = depreciation_method || 'straight_line';
  if (!VALID_METHODS.includes(method)) {
    return res.status(400).json({ error: `Only 'straight_line' is implemented in this build. Consult your tax software for MACRS/other methods.` });
  }

  const result = await pool.query(
    `INSERT INTO fixed_assets (client_id, description, purchase_date, purchase_amount, section_179_amount, bonus_depreciation_amount, useful_life_years, depreciation_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [client_id, description, purchase_date, purchase_amount, section_179_amount || 0, bonus_depreciation_amount || 0, useful_life_years, method]
  );
  await auditLog(req, { action: 'fixed_asset.create', resourceType: 'fixed_asset', resourceId: result.rows[0].id });
  res.status(201).json(result.rows[0]);
});

// Record a disposal (sale/scrap) — needed for gain/loss calculation
router.patch('/:id/dispose', async (req, res) => {
  const existing = await pool.query('SELECT * FROM fixed_assets WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'not found' });
  if (!(await userHasClientAccess(req.user, existing.rows[0].client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const { disposed_date, disposed_amount } = req.body;
  if (!disposed_date) return res.status(400).json({ error: 'disposed_date is required' });

  const result = await pool.query(
    `UPDATE fixed_assets SET disposed_date = $1, disposed_amount = $2 WHERE id = $3 RETURNING *`,
    [disposed_date, disposed_amount || 0, req.params.id]
  );
  res.json(result.rows[0]);
});

module.exports = router;
