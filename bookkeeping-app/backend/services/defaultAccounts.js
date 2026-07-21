/**
 * Entity-specific chart of account templates.
 *
 * Why these differ by entity type:
 * - SMLLC (disregarded entity): simplest — one "Owner's Draw"/"Owner's
 *   Contribution" pair, no per-partner allocation needed (Schedule C filer).
 * - Partnership: adds "Partner Distributions" / "Partner Contributions"
 *   (per-partner detail lives in the owners/capital_account_entries tables,
 *   this is just the aggregate GL account each of those entries posts to).
 * - S-corp: adds "Officer Compensation" as its own expense line, separate
 *   from "Payroll" and "Distributions" — the IRS scrutinizes reasonable
 *   officer comp vs. distributions specifically for S-corps, so these must
 *   never be commingled in one bucket.
 * - C-corp: adds stock/paid-in-capital accounts and "Dividends Paid" instead
 *   of an owner's draw concept, since C-corp income is taxed at the entity
 *   level with no pass-through allocation.
 */

const SHARED_ASSET_LIABILITY_ACCOUNTS = [
  { name: 'Business Checking', account_type: 'asset' },
  { name: 'Business Savings', account_type: 'asset' },
  { name: 'Accounts Receivable', account_type: 'asset' },
  { name: 'Accounts Payable', account_type: 'liability' },
  { name: 'Credit Card', account_type: 'liability' },
];

const SHARED_INCOME_ACCOUNTS = [
  { name: 'Revenue - Services', account_type: 'income' },
  { name: 'Revenue - Products', account_type: 'income' },
  { name: 'Other Income', account_type: 'income' },
];

const SHARED_EXPENSE_ACCOUNTS = [
  { name: 'Office Supplies', account_type: 'expense' },
  { name: 'Rent', account_type: 'expense' },
  { name: 'Utilities', account_type: 'expense' },
  { name: 'Payroll', account_type: 'expense' },
  { name: 'Contract Labor', account_type: 'expense' },
  { name: 'Meals & Entertainment', account_type: 'expense' },
  { name: 'Travel', account_type: 'expense' },
  { name: 'Insurance', account_type: 'expense' },
  { name: 'Professional Fees', account_type: 'expense' },
  { name: 'Software/Subscriptions', account_type: 'expense' },
  { name: 'Advertising', account_type: 'expense' },
  { name: 'Bank Fees', account_type: 'expense' },
  { name: 'Other Expense', account_type: 'expense' },
];

const OPENING_BALANCE_EQUITY = { name: 'Opening Balance Equity', account_type: 'equity' };
// ^ Standard bookkeeping practice (same pattern QuickBooks uses): a
// dedicated equity account that opening-balance journal entries plug into,
// so you don't need to know a continuing business's historical retained
// earnings breakdown just to record where its accounts stood on day one.

const ACCOUNT_TEMPLATES = {
  llc_single_member: [
    ...SHARED_ASSET_LIABILITY_ACCOUNTS,
    { name: "Owner's Draw", account_type: 'equity' },
    { name: "Owner's Contribution", account_type: 'equity' },
    { name: 'Retained Earnings', account_type: 'equity' },
    OPENING_BALANCE_EQUITY,
    ...SHARED_INCOME_ACCOUNTS,
    ...SHARED_EXPENSE_ACCOUNTS,
  ],

  partnership: [
    ...SHARED_ASSET_LIABILITY_ACCOUNTS,
    { name: 'Partner Contributions', account_type: 'equity' },
    { name: 'Partner Distributions', account_type: 'equity' },
    { name: 'Retained Earnings', account_type: 'equity' },
    OPENING_BALANCE_EQUITY,
    ...SHARED_INCOME_ACCOUNTS,
    ...SHARED_EXPENSE_ACCOUNTS,
  ],

  s_corp: [
    ...SHARED_ASSET_LIABILITY_ACCOUNTS,
    { name: 'Shareholder Contributions', account_type: 'equity' },
    { name: 'Shareholder Distributions', account_type: 'equity' },
    { name: 'Retained Earnings', account_type: 'equity' },
    OPENING_BALANCE_EQUITY,
    ...SHARED_INCOME_ACCOUNTS,
    { name: 'Officer Compensation', account_type: 'expense' }, // kept separate from Payroll — reasonable comp scrutiny
    ...SHARED_EXPENSE_ACCOUNTS,
  ],

  c_corp: [
    ...SHARED_ASSET_LIABILITY_ACCOUNTS,
    { name: 'Common Stock', account_type: 'equity' },
    { name: 'Additional Paid-In Capital', account_type: 'equity' },
    { name: 'Retained Earnings', account_type: 'equity' },
    { name: 'Dividends Paid', account_type: 'equity' }, // no pass-through allocation at C-corp level
    OPENING_BALANCE_EQUITY,
    ...SHARED_INCOME_ACCOUNTS,
    { name: 'Officer Compensation', account_type: 'expense' },
    ...SHARED_EXPENSE_ACCOUNTS,
  ],

  // Fallback for plain 'individual' clients (personal returns, no entity accounting needed)
  individual: [
    ...SHARED_ASSET_LIABILITY_ACCOUNTS,
    { name: "Owner's Draw", account_type: 'equity' },
    { name: "Owner's Contribution", account_type: 'equity' },
    OPENING_BALANCE_EQUITY,
    ...SHARED_INCOME_ACCOUNTS,
    ...SHARED_EXPENSE_ACCOUNTS,
  ],
};

/** Insert the correct default chart of accounts for a client, based on entity_type. */
async function seedDefaultAccounts(pool, clientId, entityType) {
  const template = ACCOUNT_TEMPLATES[entityType] || ACCOUNT_TEMPLATES.individual;
  const values = template
    .map((a) => `('${clientId}', '${a.name.replace(/'/g, "''")}', '${a.account_type}', true)`)
    .join(',\n');
  await pool.query(`
    INSERT INTO accounts (client_id, name, account_type, is_default)
    VALUES ${values}
  `);
}

module.exports = { ACCOUNT_TEMPLATES, seedDefaultAccounts };
