const express = require('express');
const pool = require('../db/pool');
const { buildClientWorkbook } = require('../services/excelExport');
const { getStorageAdapter } = require('../services/storage');
const { userHasClientAccess } = require('../middleware/clientAccess');
const { calculateDepreciationForYear } = require('../services/depreciation');
const { calculateAmortizationSchedule } = require('../services/amortization');
const { buildAgingReport } = require('../services/aging');
const { calculateWeightedOwnershipPercentage } = require('../services/ownershipHistory');

const router = express.Router();

/**
 * AR Aging: open invoices the business has sent to its own customers,
 * bucketed by days past due.
 */
router.get('/ar-aging', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query('SELECT * FROM ar_invoices WHERE client_id = $1', [client_id]);
  const items = result.rows.map((inv) => ({
    id: inv.id,
    label: `${inv.customer_name}${inv.invoice_number ? ` (#${inv.invoice_number})` : ''}`,
    due_date: inv.due_date,
    outstanding: Number(inv.amount) - Number(inv.amount_paid),
  }));
  res.json(buildAgingReport(items));
});

/**
 * AP Aging: open bills owed to vendors, bucketed by days past due.
 */
router.get('/ap-aging', async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  const result = await pool.query(
    `SELECT * FROM invoices WHERE client_id = $1 AND due_date IS NOT NULL AND amount IS NOT NULL`,
    [client_id]
  );
  const items = result.rows.map((bill) => ({
    id: bill.id,
    label: `${bill.vendor_name || 'Unknown vendor'}${bill.invoice_number ? ` (#${bill.invoice_number})` : ''}`,
    due_date: bill.due_date,
    outstanding: Number(bill.amount) - Number(bill.amount_paid || 0),
  }));
  res.json(buildAgingReport(items));
});

/**
 * Profit & Loss: sums business-flagged transactions by income/expense account,
 * for a given client and date range.
 */
router.get('/pl', async (req, res) => {
  const { client_id, start_date, end_date } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `SELECT a.account_type, a.name AS account_name, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1
       AND t.is_business = true
       AND a.account_type IN ('income', 'expense')
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)
     GROUP BY a.account_type, a.name
     ORDER BY a.account_type, a.name`,
    [client_id, start_date || null, end_date || null]
  );

  const income = result.rows.filter((r) => r.account_type === 'income');
  const expenses = result.rows.filter((r) => r.account_type === 'expense');
  const totalIncome = income.reduce((sum, r) => sum + Number(r.total), 0);
  const totalExpenses = expenses.reduce((sum, r) => sum + Number(r.total), 0);

  res.json({
    income,
    expenses,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net_income: totalIncome + totalExpenses, // expenses are stored as negative amounts
  });
});

/**
 * Balance Sheet: sums business-flagged transactions by asset/liability/equity account,
 * as of a given date (cumulative, not just within a range).
 */
/**
 * Balance Sheet: sums business-flagged transactions by asset/liability/equity account,
 * as of a given date (cumulative, not just within a range).
 *
 * IMPORTANT: this includes a computed "Net Income (Current)" line within
 * equity — the cumulative income minus expenses from inception through
 * as_of_date. Without this, the balance sheet would NOT balance
 * (Assets = Liabilities + Equity) any time there's been income or expense
 * activity that hasn't been formally closed to Retained Earnings via a
 * journal entry, which is the normal state of a business mid-year. This is
 * standard practice — every real accounting system shows current-period
 * earnings as an equity line until a formal year-end close moves it to
 * Retained Earnings.
 */
router.get('/balance-sheet', async (req, res) => {
  const { client_id, as_of_date } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `SELECT a.account_type, a.name AS account_name, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1
       AND t.is_business = true
       AND a.account_type IN ('asset', 'liability', 'equity')
       AND ($2::date IS NULL OR t.txn_date <= $2)
     GROUP BY a.account_type, a.name
     ORDER BY a.account_type, a.name`,
    [client_id, as_of_date || null]
  );

  // Cumulative net income from inception through as_of_date — the "Current
  // Year Earnings" / "Net Income" equity line every real balance sheet has.
  const netIncomeResult = await pool.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS net_income
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('income', 'expense')
       AND ($2::date IS NULL OR t.txn_date <= $2)`,
    [client_id, as_of_date || null]
  );
  const cumulativeNetIncome = Number(netIncomeResult.rows[0].net_income);

  const assets = result.rows.filter((r) => r.account_type === 'asset');
  const liabilities = result.rows.filter((r) => r.account_type === 'liability');
  const equity = result.rows.filter((r) => r.account_type === 'equity');
  if (Math.abs(cumulativeNetIncome) > 0.005) {
    equity.push({ account_type: 'equity', account_name: 'Net Income (Current)', total: cumulativeNetIncome });
  }

  res.json({
    assets,
    liabilities,
    equity,
    total_assets: assets.reduce((s, r) => s + Number(r.total), 0),
    total_liabilities: liabilities.reduce((s, r) => s + Number(r.total), 0),
    total_equity: equity.reduce((s, r) => s + Number(r.total), 0),
  });
});

/**
 * General Ledger: every transaction, in date order, with running context —
 * the full audit trail a preparer or auditor would want to see.
 */
router.get('/general-ledger', async (req, res) => {
  const { client_id, start_date, end_date } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `SELECT t.txn_date, t.description, t.amount, t.is_business, a.name AS account_name, a.account_type
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)
     ORDER BY t.txn_date ASC`,
    [client_id, start_date || null, end_date || null]
  );

  res.json(result.rows);
});

/**
 * Download the full Excel workbook (Transactions, P&L, Balance Sheet, General Ledger)
 * directly in the response.
 */
router.get('/export', async (req, res) => {
  const { client_id, start_date, end_date } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const workbook = await buildClientWorkbook(client_id, { startDate: start_date, endDate: end_date });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="bookkeeping-export.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

/**
 * Build the same workbook and upload it to the client's chosen storage
 * provider (their clients.storage_provider + storage_folder_id), instead
 * of (or in addition to) downloading it locally.
 */
router.post('/export-to-storage', async (req, res) => {
  const { client_id, start_date, end_date } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'client not found' });
  if (!client.storage_folder_id) {
    return res.status(400).json({ error: 'This client has no storage folder set up yet.' });
  }

  const workbook = await buildClientWorkbook(client_id, { startDate: start_date, endDate: end_date });
  const buffer = await workbook.xlsx.writeBuffer();

  const adapter = getStorageAdapter(client.storage_provider);
  const filename = `${client.name.replace(/[^a-z0-9]+/gi, '_')}-bookkeeping.xlsx`;
  const uploadResult = await adapter.uploadFile(
    buffer,
    filename,
    client.storage_folder_id,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  res.json({ status: 'uploaded', ...uploadResult });
});

/**
 * Capital Accounts report: for each owner (partner/shareholder), shows
 * contributions, distributions, and their allocated share of net income —
 * calculated as ownership_percentage × total net income for the period.
 * This is the data K-1 prep needs. Only meaningful for partnership/s_corp
 * clients — C-corps have no per-shareholder allocation.
 */
router.get('/capital-accounts', async (req, res) => {
  const { client_id, start_date, end_date } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
  const client = clientResult.rows[0];
  if (!client) return res.status(404).json({ error: 'client not found' });
  if (!['partnership', 's_corp'].includes(client.entity_type)) {
    return res.status(400).json({
      error: `Capital account allocation doesn't apply to entity_type '${client.entity_type}' — only partnership and s_corp clients have pass-through allocation.`,
    });
  }

  // Net income for the period, same calculation as the P&L report
  const plResult = await pool.query(
    `SELECT SUM(t.amount) AS net_income
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('income','expense')
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)`,
    [client_id, start_date || null, end_date || null]
  );
  const netIncome = Number(plResult.rows[0].net_income || 0);

  // Weighted ownership % calculation needs concrete date bounds — default
  // to calendar-year-to-date if the caller didn't specify a range.
  const effectiveEndDate = end_date || new Date().toISOString().slice(0, 10);
  const effectiveStartDate = start_date || `${new Date(effectiveEndDate).getFullYear()}-01-01`;

  const ownersResult = await pool.query('SELECT * FROM owners WHERE client_id = $1 ORDER BY name', [client_id]);
  const totalOwnershipPct = ownersResult.rows.reduce((s, o) => s + Number(o.ownership_percentage), 0);

  if (ownersResult.rows.length > 0 && Math.abs(totalOwnershipPct - 100) > 0.01) {
    // Don't fail the report, but make it very visible — misallocated K-1s are a real problem.
    // (This check uses the flat current percentages — a per-period check would need to
    // verify the sum at every point in time, which the UI's ownership history editor should watch for.)
    res.set('X-Warning', `Current ownership percentages total ${totalOwnershipPct}%, not 100%. Check owner records.`);
  }

  const owners = [];
  for (const owner of ownersResult.rows) {
    const entriesResult = await pool.query(
      `SELECT entry_type, SUM(amount) AS total FROM capital_account_entries
       WHERE owner_id = $1 AND ($2::date IS NULL OR entry_date >= $2) AND ($3::date IS NULL OR entry_date <= $3)
       GROUP BY entry_type`,
      [owner.id, start_date || null, end_date || null]
    );
    const contributions = Number(entriesResult.rows.find((r) => r.entry_type === 'contribution')?.total || 0);
    const distributions = Number(entriesResult.rows.find((r) => r.entry_type === 'distribution')?.total || 0);

    // Time-weighted average ownership % over the period, accounting for
    // any mid-period changes recorded in ownership_history. Falls back to
    // the flat ownership_percentage if this owner has no history rows.
    const weightedPct = await calculateWeightedOwnershipPercentage(
      owner.id,
      effectiveStartDate,
      effectiveEndDate,
      owner.ownership_percentage
    );
    const allocatedIncome = netIncome * (weightedPct / 100);

    owners.push({
      owner_id: owner.id,
      name: owner.name,
      owner_type: owner.owner_type,
      ownership_percentage: weightedPct, // time-weighted average for this period, may differ from the flat current %
      contributions,
      distributions,
      allocated_income: allocatedIncome,
      ending_balance: contributions - distributions + allocatedIncome,
    });
  }

  res.json({ entity_type: client.entity_type, total_net_income: netIncome, period: { start: effectiveStartDate, end: effectiveEndDate }, owners });
});

/**
 * Personal financial forms for one partner/shareholder, scoped to a
 * specific business (since the same person's personal transactions might
 * be split across multiple businesses they own) — combines:
 *   1. A summary of business expenses they personally covered FOR THIS
 *      BUSINESS (their flagged/claimed transactions where
 *      flagged_for_client_id = this client_id).
 *   2. A full personal income/expense statement built from EVERYTHING in
 *      their personal upload tier (customer_id), regardless of which
 *      business claimed what — this is their whole personal picture,
 *      grouped by their free-text personal_category.
 */
router.get('/personal-statement', async (req, res) => {
  const { owner_id, start_date, end_date } = req.query;
  if (!owner_id) return res.status(400).json({ error: 'owner_id is required' });

  const ownerResult = await pool.query('SELECT * FROM owners WHERE id = $1', [owner_id]);
  const owner = ownerResult.rows[0];
  if (!owner) return res.status(404).json({ error: 'owner not found' });
  if (!(await userHasClientAccess(req.user, owner.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this business.' });
  }

  // 1. Business expenses covered personally, for THIS business specifically
  const coveredResult = await pool.query(
    `SELECT t.txn_date, t.description, t.amount
     FROM transactions t
     WHERE t.customer_id = $1 AND t.flagged_as_business = true AND t.flagged_for_client_id = $2
       AND ($3::date IS NULL OR t.txn_date >= $3)
       AND ($4::date IS NULL OR t.txn_date <= $4)
     ORDER BY t.txn_date`,
    [owner.customer_id, owner.client_id, start_date || null, end_date || null]
  );
  const totalCovered = coveredResult.rows.reduce((s, r) => s + Math.abs(Number(r.amount)), 0);

  // 2. Full personal income/expense statement — everything in their personal pool
  const personalResult = await pool.query(
    `SELECT personal_category, SUM(amount) AS total, COUNT(*) AS txn_count
     FROM transactions
     WHERE customer_id = $1
       AND ($2::date IS NULL OR txn_date >= $2)
       AND ($3::date IS NULL OR txn_date <= $3)
     GROUP BY personal_category
     ORDER BY personal_category NULLS LAST`,
    [owner.customer_id, start_date || null, end_date || null]
  );

  const income = personalResult.rows.filter((r) => Number(r.total) > 0);
  const expenses = personalResult.rows.filter((r) => Number(r.total) <= 0);

  res.json({
    owner: { id: owner.id, name: owner.name, owner_type: owner.owner_type },
    business_expenses_covered: {
      transactions: coveredResult.rows,
      total: totalCovered,
    },
    personal_statement: {
      income,
      expenses,
      net: personalResult.rows.reduce((s, r) => s + Number(r.total), 0),
    },
  });
});

/**
 * 1099 Summary: total payments per vendor for a calendar year, flagging
 * which vendors crossed the $600 threshold and need a 1099, and whether a
 * W-9 is on file. Only counts vendors marked requires_1099 = true.
 */
router.get('/1099-summary', async (req, res) => {
  const { client_id, year } = req.query;
  if (!client_id || !year) return res.status(400).json({ error: 'client_id and year are required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const result = await pool.query(
    `SELECT v.id AS vendor_id, v.name, v.tax_id_type, v.w9_on_file, v.requires_1099,
            COALESCE(SUM(ABS(t.amount)), 0) AS total_paid
     FROM vendors v
     LEFT JOIN transactions t ON t.vendor_id = v.id
       AND t.is_business = true
       AND EXTRACT(YEAR FROM t.txn_date) = $2
     WHERE v.client_id = $1 AND v.requires_1099 = true
     GROUP BY v.id, v.name, v.tax_id_type, v.w9_on_file, v.requires_1099
     ORDER BY total_paid DESC`,
    [client_id, year]
  );

  const vendors = result.rows.map((v) => ({
    vendor_id: v.vendor_id,
    name: v.name,
    total_paid: Number(v.total_paid),
    needs_1099: Number(v.total_paid) >= 600,
    w9_on_file: v.w9_on_file,
    // tax_id itself is intentionally NOT included in this report response —
    // view/edit it directly on the vendor record when actually preparing the 1099
  }));

  res.json({ year: Number(year), vendors: vendors.filter((v) => v.needs_1099 || v.total_paid > 0) });
});

/**
 * Depreciation schedule for every fixed asset a business owns, for a given
 * year. See services/depreciation.js for the straight-line method and its
 * limitations — verify against IRS Pub. 946 / your tax software before filing.
 */
router.get('/depreciation-schedule', async (req, res) => {
  const { client_id, year } = req.query;
  if (!client_id || !year) return res.status(400).json({ error: 'client_id and year are required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const assetsResult = await pool.query('SELECT * FROM fixed_assets WHERE client_id = $1 ORDER BY purchase_date', [client_id]);
  const schedule = assetsResult.rows.map((asset) => {
    const calc = calculateDepreciationForYear(asset, Number(year));
    return {
      asset_id: asset.id,
      description: asset.description,
      purchase_date: asset.purchase_date,
      purchase_amount: Number(asset.purchase_amount),
      section_179_amount: Number(asset.section_179_amount),
      bonus_depreciation_amount: Number(asset.bonus_depreciation_amount),
      useful_life_years: Number(asset.useful_life_years),
      ...calc,
    };
  });

  res.json({
    year: Number(year),
    assets: schedule,
    total_depreciation_this_year: schedule.reduce((s, a) => s + a.annualDepreciation, 0),
    caveat: 'Straight-line calculation only — verify against IRS Pub. 946 MACRS tables before filing.',
  });
});

/**
 * Full amortization schedule for one loan.
 */
router.get('/loan-amortization', async (req, res) => {
  const { loan_id } = req.query;
  if (!loan_id) return res.status(400).json({ error: 'loan_id is required' });

  const loanResult = await pool.query('SELECT * FROM loans WHERE id = $1', [loan_id]);
  const loan = loanResult.rows[0];
  if (!loan) return res.status(404).json({ error: 'loan not found' });
  if (!(await userHasClientAccess(req.user, loan.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const schedule = calculateAmortizationSchedule(loan);
  res.json({ loan, schedule });
});

/**
 * Payroll Summary: every worker for a business, for a given year.
 * - 1099 contractors: pulled from their linked vendor's transactions (same
 *   totals as the 1099 Summary report) — not double-counted from a separate table.
 * - W-2 hourly/salary: summed from payroll_payments for the year.
 */
router.get('/payroll-summary', async (req, res) => {
  const { client_id, year } = req.query;
  if (!client_id || !year) return res.status(400).json({ error: 'client_id and year are required' });
  if (!(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }

  const workersResult = await pool.query('SELECT * FROM workers WHERE client_id = $1 ORDER BY name', [client_id]);

  const workers = [];
  for (const worker of workersResult.rows) {
    if (worker.worker_type === '1099_contractor') {
      const paidResult = await pool.query(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS total
         FROM transactions
         WHERE vendor_id = $1 AND is_business = true AND EXTRACT(YEAR FROM txn_date) = $2`,
        [worker.vendor_id, year]
      );
      workers.push({
        worker_id: worker.id,
        name: worker.name,
        worker_type: worker.worker_type,
        gross_pay: Number(paidResult.rows[0].total),
        employer_tax_cost: 0, // no employer-side payroll tax on 1099 payments
        net_pay: Number(paidResult.rows[0].total), // no withholding on 1099 payments
      });
    } else {
      const payResult = await pool.query(
        `SELECT
           COALESCE(SUM(gross_pay), 0) AS gross_pay,
           COALESCE(SUM(net_pay), 0) AS net_pay,
           COALESCE(SUM(employer_social_security + employer_medicare + employer_futa + employer_suta + other_employer_costs), 0) AS employer_tax_cost
         FROM payroll_payments
         WHERE worker_id = $1 AND EXTRACT(YEAR FROM pay_date) = $2`,
        [worker.id, year]
      );
      const row = payResult.rows[0];
      workers.push({
        worker_id: worker.id,
        name: worker.name,
        worker_type: worker.worker_type,
        gross_pay: Number(row.gross_pay),
        employer_tax_cost: Number(row.employer_tax_cost),
        net_pay: Number(row.net_pay),
      });
    }
  }

  res.json({
    year: Number(year),
    workers: workers.filter((w) => w.gross_pay > 0),
    total_gross_pay: workers.reduce((s, w) => s + w.gross_pay, 0),
    total_employer_tax_cost: workers.reduce((s, w) => s + w.employer_tax_cost, 0),
    caveat: 'Withholding and employer tax figures are entered manually from your payroll processor — this report does not calculate them.',
  });
});

module.exports = router;
