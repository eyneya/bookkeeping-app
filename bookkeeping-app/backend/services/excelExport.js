/**
 * excelExport.js
 *
 * Builds a single .xlsx workbook for a client with tabs for Transactions,
 * P&L, Balance Sheet, and General Ledger. This is the primary deliverable
 * format — it's what gets uploaded to the client's Drive/OneDrive folder
 * and/or downloaded directly from the Reports tab.
 */

const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { calculateDepreciationForYear } = require('./depreciation');
const { calculateAmortizationSchedule } = require('./amortization');
const { calculateWeightedOwnershipPercentage } = require('./ownershipHistory');
const { buildAgingReport } = require('./aging');

async function buildClientWorkbook(clientId, { startDate, endDate } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bookkeeping Processor';
  workbook.created = new Date();

  const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientResult.rows[0];

  await addTransactionsSheet(workbook, clientId);
  await addPLSheet(workbook, clientId, startDate, endDate);
  await addBalanceSheetSheet(workbook, clientId, endDate);
  await addGeneralLedgerSheet(workbook, clientId, startDate, endDate);

  // Capital Accounts / K-1 support tab only applies to pass-through entities
  if (client && ['partnership', 's_corp'].includes(client.entity_type)) {
    await addCapitalAccountsSheet(workbook, clientId, startDate, endDate);

    // One "Personal - {Name}" sheet per owner, combining what they covered
    // for the business personally and their own personal income/expenses.
    const ownersResult = await pool.query('SELECT * FROM owners WHERE client_id = $1 ORDER BY name', [clientId]);
    for (const owner of ownersResult.rows) {
      await addPersonalStatementSheet(workbook, owner, startDate, endDate);
    }
  }

  // These tabs only get added if the business actually has vendors/assets/loans/workers on file
  const year = endDate ? new Date(endDate).getFullYear() : new Date().getFullYear();
  await add1099SummarySheet(workbook, clientId, year);
  await addDepreciationSheet(workbook, clientId, year);
  await addLoanAmortizationSheets(workbook, clientId);
  await addPayrollSummarySheet(workbook, clientId, year);
  await addAgingSheets(workbook, clientId);

  return workbook;
}

async function addAgingSheets(workbook, clientId) {
  const arResult = await pool.query('SELECT * FROM ar_invoices WHERE client_id = $1', [clientId]);
  if (arResult.rows.length > 0) {
    const arItems = arResult.rows.map((inv) => ({
      label: `${inv.customer_name}${inv.invoice_number ? ` (#${inv.invoice_number})` : ''}`,
      due_date: inv.due_date,
      outstanding: Number(inv.amount) - Number(inv.amount_paid),
    }));
    const arAging = buildAgingReport(arItems);
    if (arAging.detail.length > 0) addAgingSheet(workbook, 'AR Aging', arAging);
  }

  const apResult = await pool.query('SELECT * FROM invoices WHERE client_id = $1 AND due_date IS NOT NULL AND amount IS NOT NULL', [clientId]);
  if (apResult.rows.length > 0) {
    const apItems = apResult.rows.map((bill) => ({
      label: `${bill.vendor_name || 'Unknown vendor'}${bill.invoice_number ? ` (#${bill.invoice_number})` : ''}`,
      due_date: bill.due_date,
      outstanding: Number(bill.amount) - Number(bill.amount_paid || 0),
    }));
    const apAging = buildAgingReport(apItems);
    if (apAging.detail.length > 0) addAgingSheet(workbook, 'AP Aging', apAging);
  }
}

function addAgingSheet(workbook, sheetName, aging) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: 'Name/Invoice', key: 'label', width: 30 },
    { header: 'Due Date', key: 'due_date', width: 14 },
    { header: 'Days Past Due', key: 'days', width: 16 },
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Outstanding', key: 'outstanding', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  aging.detail.forEach((d) => {
    sheet.addRow({ label: d.label, due_date: d.due_date, days: d.days_past_due, bucket: d.bucket, outstanding: d.outstanding });
  });
  sheet.addRow({});
  sheet.addRow({ label: 'Totals by bucket:' }).font = { bold: true };
  Object.entries(aging.buckets).forEach(([bucket, total]) => {
    sheet.addRow({ label: bucket, outstanding: total });
  });
  sheet.getColumn('outstanding').numFmt = '#,##0.00';
}

async function addPayrollSummarySheet(workbook, clientId, year) {
  const workersResult = await pool.query('SELECT * FROM workers WHERE client_id = $1 ORDER BY name', [clientId]);
  if (workersResult.rows.length === 0) return;

  const rows = [];
  for (const worker of workersResult.rows) {
    if (worker.worker_type === '1099_contractor') {
      const paidResult = await pool.query(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM transactions
         WHERE vendor_id = $1 AND is_business = true AND EXTRACT(YEAR FROM txn_date) = $2`,
        [worker.vendor_id, year]
      );
      const total = Number(paidResult.rows[0].total);
      if (total > 0) rows.push({ name: worker.name, type: '1099 Contractor', gross: total, employerTax: 0, net: total });
    } else {
      const payResult = await pool.query(
        `SELECT COALESCE(SUM(gross_pay),0) AS gross, COALESCE(SUM(net_pay),0) AS net,
                COALESCE(SUM(employer_social_security+employer_medicare+employer_futa+employer_suta+other_employer_costs),0) AS employer_tax
         FROM payroll_payments WHERE worker_id = $1 AND EXTRACT(YEAR FROM pay_date) = $2`,
        [worker.id, year]
      );
      const r = payResult.rows[0];
      if (Number(r.gross) > 0) {
        rows.push({
          name: worker.name,
          type: worker.worker_type === 'w2_hourly' ? 'W-2 Hourly' : 'W-2 Salary',
          gross: Number(r.gross),
          employerTax: Number(r.employer_tax),
          net: Number(r.net),
        });
      }
    }
  }
  if (rows.length === 0) return;

  const sheet = workbook.addWorksheet(`Payroll Summary ${year}`);
  sheet.columns = [
    { header: 'Worker', key: 'name', width: 26 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Gross Pay', key: 'gross', width: 16 },
    { header: 'Employer Tax Cost', key: 'employerTax', width: 18 },
    { header: 'Net Pay', key: 'net', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));
  ['gross', 'employerTax', 'net'].forEach((k) => (sheet.getColumn(k).numFmt = '#,##0.00'));
  sheet.addRow({});
  sheet.addRow({ name: 'Withholding/employer tax figures entered manually — not calculated by this app.' });
}

async function add1099SummarySheet(workbook, clientId, year) {
  const result = await pool.query(
    `SELECT v.name, v.w9_on_file, COALESCE(SUM(ABS(t.amount)), 0) AS total_paid
     FROM vendors v
     LEFT JOIN transactions t ON t.vendor_id = v.id AND t.is_business = true AND EXTRACT(YEAR FROM t.txn_date) = $2
     WHERE v.client_id = $1 AND v.requires_1099 = true
     GROUP BY v.id, v.name, v.w9_on_file
     HAVING COALESCE(SUM(ABS(t.amount)), 0) > 0
     ORDER BY total_paid DESC`,
    [clientId, year]
  );
  if (result.rows.length === 0) return; // skip the tab entirely if there's nothing to show

  const sheet = workbook.addWorksheet(`1099 Summary ${year}`);
  sheet.columns = [
    { header: 'Vendor', key: 'name', width: 30 },
    { header: 'Total Paid', key: 'total', width: 16 },
    { header: 'Needs 1099', key: 'needs', width: 14 },
    { header: 'W-9 on File', key: 'w9', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  result.rows.forEach((v) => {
    sheet.addRow({
      name: v.name,
      total: Number(v.total_paid),
      needs: Number(v.total_paid) >= 600 ? 'Yes' : 'No',
      w9: v.w9_on_file ? 'Yes' : 'No',
    });
  });
  sheet.getColumn('total').numFmt = '#,##0.00';
}

async function addDepreciationSheet(workbook, clientId, year) {
  const assetsResult = await pool.query('SELECT * FROM fixed_assets WHERE client_id = $1 ORDER BY purchase_date', [clientId]);
  if (assetsResult.rows.length === 0) return;

  const sheet = workbook.addWorksheet(`Depreciation ${year}`);
  sheet.columns = [
    { header: 'Asset', key: 'description', width: 30 },
    { header: 'Purchase Date', key: 'date', width: 14 },
    { header: 'Purchase Amount', key: 'amount', width: 16 },
    { header: `${year} Depreciation`, key: 'annual', width: 18 },
    { header: 'Accumulated Depreciation', key: 'accumulated', width: 20 },
    { header: 'Book Value', key: 'book', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  assetsResult.rows.forEach((asset) => {
    const calc = calculateDepreciationForYear(asset, year);
    sheet.addRow({
      description: asset.description,
      date: asset.purchase_date,
      amount: Number(asset.purchase_amount),
      annual: calc.annualDepreciation,
      accumulated: calc.accumulatedDepreciation,
      book: calc.bookValue,
    });
  });
  ['amount', 'annual', 'accumulated', 'book'].forEach((k) => (sheet.getColumn(k).numFmt = '#,##0.00'));
  sheet.addRow({});
  sheet.addRow({ description: 'Straight-line only — verify against IRS Pub. 946 before filing.' });
}

async function addLoanAmortizationSheets(workbook, clientId) {
  const loansResult = await pool.query('SELECT * FROM loans WHERE client_id = $1 ORDER BY origination_date', [clientId]);
  for (const loan of loansResult.rows) {
    const sheetName = `Loan - ${loan.lender_name}`.slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = [
      { header: 'Payment #', key: 'n', width: 10 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Payment', key: 'payment', width: 14 },
      { header: 'Principal', key: 'principal', width: 14 },
      { header: 'Interest', key: 'interest', width: 14 },
      { header: 'Remaining Balance', key: 'balance', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    const schedule = calculateAmortizationSchedule(loan);
    schedule.forEach((row) =>
      sheet.addRow({
        n: row.payment_number,
        date: row.date,
        payment: row.payment_amount,
        principal: row.principal,
        interest: row.interest,
        balance: row.remaining_balance,
      })
    );
    ['payment', 'principal', 'interest', 'balance'].forEach((k) => (sheet.getColumn(k).numFmt = '#,##0.00'));
  }
}

async function addPersonalStatementSheet(workbook, owner, startDate, endDate) {
  // Sheet names must be <=31 chars and unique — truncate long owner names
  const sheetName = `Personal - ${owner.name}`.slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow(['Business expenses covered personally (this business)']).font = { bold: true };
  sheet.addRow(['Date', 'Description', 'Amount']).font = { bold: true };
  const coveredResult = await pool.query(
    `SELECT txn_date, description, amount FROM transactions
     WHERE customer_id = $1 AND flagged_as_business = true AND flagged_for_client_id = $2
       AND ($3::date IS NULL OR txn_date >= $3) AND ($4::date IS NULL OR txn_date <= $4)
     ORDER BY txn_date`,
    [owner.customer_id, owner.client_id, startDate || null, endDate || null]
  );
  let totalCovered = 0;
  coveredResult.rows.forEach((r) => {
    sheet.addRow([r.txn_date, r.description, Math.abs(Number(r.amount))]);
    totalCovered += Math.abs(Number(r.amount));
  });
  sheet.addRow(['', 'Total covered', totalCovered]).font = { bold: true };

  sheet.addRow([]);
  sheet.addRow(['Personal income/expense statement (all personal transactions)']).font = { bold: true };
  sheet.addRow(['Category', 'Amount', '# Transactions']).font = { bold: true };
  const personalResult = await pool.query(
    `SELECT personal_category, SUM(amount) AS total, COUNT(*) AS txn_count
     FROM transactions WHERE customer_id = $1
       AND ($2::date IS NULL OR txn_date >= $2) AND ($3::date IS NULL OR txn_date <= $3)
     GROUP BY personal_category ORDER BY personal_category NULLS LAST`,
    [owner.customer_id, startDate || null, endDate || null]
  );
  let netPersonal = 0;
  personalResult.rows.forEach((r) => {
    sheet.addRow([r.personal_category || '(uncategorized)', Number(r.total), Number(r.txn_count)]);
    netPersonal += Number(r.total);
  });
  sheet.addRow(['Net', netPersonal, '']).font = { bold: true };

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 40;
  sheet.getColumn(3).width = 16;
}

async function addCapitalAccountsSheet(workbook, clientId, startDate, endDate) {
  const sheet = workbook.addWorksheet('Capital Accounts');
  sheet.columns = [
    { header: 'Owner', key: 'name', width: 24 },
    { header: 'Type', key: 'owner_type', width: 14 },
    { header: 'Ownership %', key: 'pct', width: 14 },
    { header: 'Contributions', key: 'contributions', width: 16 },
    { header: 'Distributions', key: 'distributions', width: 16 },
    { header: 'Allocated Income/Loss', key: 'allocated', width: 20 },
    { header: 'Ending Balance', key: 'ending', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  const netIncomeResult = await pool.query(
    `SELECT SUM(t.amount) AS net_income
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('income','expense')
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)`,
    [clientId, startDate || null, endDate || null]
  );
  const netIncome = Number(netIncomeResult.rows[0].net_income || 0);

  const ownersResult = await pool.query('SELECT * FROM owners WHERE client_id = $1 ORDER BY name', [clientId]);
  const effectiveEndDate = endDate || new Date().toISOString().slice(0, 10);
  const effectiveStartDate = startDate || `${new Date(effectiveEndDate).getFullYear()}-01-01`;

  for (const owner of ownersResult.rows) {
    const entriesResult = await pool.query(
      `SELECT entry_type, SUM(amount) AS total FROM capital_account_entries
       WHERE owner_id = $1 AND ($2::date IS NULL OR entry_date >= $2) AND ($3::date IS NULL OR entry_date <= $3)
       GROUP BY entry_type`,
      [owner.id, startDate || null, endDate || null]
    );
    const contributions = Number(entriesResult.rows.find((r) => r.entry_type === 'contribution')?.total || 0);
    const distributions = Number(entriesResult.rows.find((r) => r.entry_type === 'distribution')?.total || 0);
    const weightedPct = await calculateWeightedOwnershipPercentage(owner.id, effectiveStartDate, effectiveEndDate, owner.ownership_percentage);
    const allocatedIncome = netIncome * (weightedPct / 100);

    sheet.addRow({
      name: owner.name,
      owner_type: owner.owner_type,
      pct: weightedPct,
      contributions,
      distributions,
      allocated: allocatedIncome,
      ending: contributions - distributions + allocatedIncome,
    });
  }

  ['contributions', 'distributions', 'allocated', 'ending'].forEach((key) => {
    sheet.getColumn(key).numFmt = '#,##0.00';
  });
}

async function addTransactionsSheet(workbook, clientId) {
  const sheet = workbook.addWorksheet('Transactions');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Account', key: 'account', width: 24 },
    { header: 'Business?', key: 'business', width: 12 },
    { header: 'Needs Review', key: 'review', width: 14 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  const result = await pool.query(
    `SELECT t.txn_date, t.description, t.amount, a.name AS account_name, t.is_business, t.needs_review, t.notes
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1
     ORDER BY t.txn_date ASC`,
    [clientId]
  );

  for (const row of result.rows) {
    sheet.addRow({
      date: row.txn_date,
      description: row.description,
      amount: Number(row.amount),
      account: row.account_name || '',
      business: row.is_business === null ? '' : row.is_business ? 'Business' : 'Personal',
      review: row.needs_review ? 'Yes' : '',
      notes: row.notes || '',
    });
  }
  sheet.getColumn('amount').numFmt = '#,##0.00';
}

async function addPLSheet(workbook, clientId, startDate, endDate) {
  const sheet = workbook.addWorksheet('P&L');
  sheet.columns = [{ header: 'Category', key: 'category', width: 30 }, { header: 'Amount', key: 'amount', width: 16 }];
  sheet.getRow(1).font = { bold: true };

  const result = await pool.query(
    `SELECT a.account_type, a.name AS account_name, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('income','expense')
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)
     GROUP BY a.account_type, a.name ORDER BY a.account_type, a.name`,
    [clientId, startDate || null, endDate || null]
  );

  const income = result.rows.filter((r) => r.account_type === 'income');
  const expenses = result.rows.filter((r) => r.account_type === 'expense');

  sheet.addRow({ category: 'INCOME', amount: '' }).font = { bold: true };
  income.forEach((r) => sheet.addRow({ category: r.account_name, amount: Number(r.total) }));
  const totalIncome = income.reduce((s, r) => s + Number(r.total), 0);
  sheet.addRow({ category: 'Total Income', amount: totalIncome }).font = { bold: true };

  sheet.addRow({});
  sheet.addRow({ category: 'EXPENSES', amount: '' }).font = { bold: true };
  expenses.forEach((r) => sheet.addRow({ category: r.account_name, amount: Number(r.total) }));
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.total), 0);
  sheet.addRow({ category: 'Total Expenses', amount: totalExpenses }).font = { bold: true };

  sheet.addRow({});
  sheet.addRow({ category: 'NET INCOME', amount: totalIncome + totalExpenses }).font = { bold: true };
  sheet.getColumn('amount').numFmt = '#,##0.00';
}

async function addBalanceSheetSheet(workbook, clientId, asOfDate) {
  const sheet = workbook.addWorksheet('Balance Sheet');
  sheet.columns = [{ header: 'Category', key: 'category', width: 30 }, { header: 'Amount', key: 'amount', width: 16 }];
  sheet.getRow(1).font = { bold: true };

  const result = await pool.query(
    `SELECT a.account_type, a.name AS account_name, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('asset','liability','equity')
       AND ($2::date IS NULL OR t.txn_date <= $2)
     GROUP BY a.account_type, a.name ORDER BY a.account_type, a.name`,
    [clientId, asOfDate || null]
  );

  // Same fix as the /api/reports/balance-sheet endpoint: include cumulative
  // net income as a "Net Income (Current)" equity line so the sheet
  // actually balances (Assets = Liabilities + Equity) without requiring a
  // formal year-end close first.
  const netIncomeResult = await pool.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS net_income
     FROM transactions t JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1 AND t.is_business = true AND a.account_type IN ('income','expense')
       AND ($2::date IS NULL OR t.txn_date <= $2)`,
    [clientId, asOfDate || null]
  );
  const cumulativeNetIncome = Number(netIncomeResult.rows[0].net_income);
  if (Math.abs(cumulativeNetIncome) > 0.005) {
    result.rows.push({ account_type: 'equity', account_name: 'Net Income (Current)', total: cumulativeNetIncome });
  }

  for (const type of ['asset', 'liability', 'equity']) {
    const rows = result.rows.filter((r) => r.account_type === type);
    sheet.addRow({ category: type.toUpperCase() + 'S', amount: '' }).font = { bold: true };
    rows.forEach((r) => sheet.addRow({ category: r.account_name, amount: Number(r.total) }));
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    sheet.addRow({ category: `Total ${type}`, amount: total }).font = { bold: true };
    sheet.addRow({});
  }
  sheet.getColumn('amount').numFmt = '#,##0.00';
}

async function addGeneralLedgerSheet(workbook, clientId, startDate, endDate) {
  const sheet = workbook.addWorksheet('General Ledger');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Account', key: 'account', width: 24 },
    { header: 'Business?', key: 'business', width: 12 },
    { header: 'Amount', key: 'amount', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  const result = await pool.query(
    `SELECT t.txn_date, t.description, t.amount, t.is_business, a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.client_id = $1
       AND ($2::date IS NULL OR t.txn_date >= $2)
       AND ($3::date IS NULL OR t.txn_date <= $3)
     ORDER BY t.txn_date ASC`,
    [clientId, startDate || null, endDate || null]
  );

  result.rows.forEach((r) =>
    sheet.addRow({
      date: r.txn_date,
      description: r.description,
      account: r.account_name || '',
      business: r.is_business === null ? '' : r.is_business ? 'Business' : 'Personal',
      amount: Number(r.amount),
    })
  );
  sheet.getColumn('amount').numFmt = '#,##0.00';
}

module.exports = { buildClientWorkbook };
