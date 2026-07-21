-- Bookkeeping App Schema
-- Designed for Postgres (Supabase free tier is a good economical fit)

-- ============================================================
-- CORE ENTITY MODEL
--
-- CUSTOMER = a real person (your tax client). Their personal bank
--   statements/receipts get uploaded ONCE and extracted ONCE into a shared
--   pool of personal transactions belonging to them.
-- CLIENT = a business/entity you file taxes for (SMLLC, partnership,
--   S-corp, C-corp). A customer can own or co-own MULTIPLE clients.
-- OWNERS = the join between a customer and a client, with an ownership %
--   for that specific business (a customer can have different ownership
--   percentages in different businesses they're part of).
--
-- Because a customer's personal transactions aren't tied to one business,
-- the SAME uploaded statement can have some transactions claimed for
-- Business A and others claimed for Business B — the app tracks which
-- business (if any) has claimed each transaction so nothing gets used twice
-- by accident, and shows what's still available to claim.
-- ============================================================

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  notes TEXT,
  storage_provider TEXT NOT NULL DEFAULT 'google', -- where THEIR personal documents get stored
  storage_folder_id TEXT,
  created_by UUID, -- the user who added them; lets that preparer see them before any business is linked yet
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- the business name
  entity_type TEXT NOT NULL DEFAULT 'individual', -- individual, llc_single_member, partnership, s_corp, c_corp
  storage_provider TEXT NOT NULL DEFAULT 'google', -- 'google' or 'microsoft'
  storage_folder_id TEXT,
  locked_through_date DATE, -- transactions/journal entries on or before this date can't be edited/deleted/flagged (e.g. after a return is filed)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Join table: which customers own which businesses, and at what percentage
CREATE TABLE owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL, -- links to the shared personal document pool
  name TEXT NOT NULL, -- denormalized for convenience/display, should match customers.name when customer_id is set
  owner_type TEXT NOT NULL DEFAULT 'partner', -- 'partner' or 'shareholder'
  ownership_percentage NUMERIC(5,2) NOT NULL, -- e.g. 33.33, specific to THIS business
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every uploaded source file. EITHER client_id is set (a business-level
-- document — bank statement/invoice belonging directly to that business)
-- OR customer_id is set (a personal document — belongs to the person, not
-- yet tied to any one business). Never both, never neither.
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL, -- bank_statement, invoice, receipt
  original_filename TEXT NOT NULL,
  storage_path TEXT, -- Drive/OneDrive file id or local path
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processed, needs_review, error
  raw_extraction JSONB, -- full Claude response, kept for audit trail
  error_message TEXT,
  -- Reconciliation: for bank statements, the extracted beginning/ending
  -- balance vs. what the extracted transactions actually sum to. Lets a
  -- misread number or a skipped page get caught instead of silently
  -- flowing into the books.
  statement_beginning_balance NUMERIC(12,2),
  statement_ending_balance NUMERIC(12,2),
  reconciliation_status TEXT NOT NULL DEFAULT 'not_checked', -- 'not_checked', 'matched', 'mismatch'
  reconciliation_diff NUMERIC(12,2), -- (beginning + sum of transactions) - ending; 0 when matched
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT documents_exactly_one_owner CHECK (
    (client_id IS NOT NULL AND customer_id IS NULL) OR
    (client_id IS NULL AND customer_id IS NOT NULL)
  )
);

-- Chart of accounts — per business
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL, -- asset, liability, equity, income, expense
  is_default BOOLEAN NOT NULL DEFAULT false
);

-- The ledger. Same either/or rule as documents:
--   client_id set, customer_id null   => a BUSINESS transaction (Tier 1)
--   customer_id set, client_id null   => a PERSONAL transaction (Tier 2),
--     sitting in the shared pool, not yet claimed by any business
--
-- flagged_as_business = true         => this personal transaction has been
--   claimed by a specific business (flagged_for_client_id) via the
--   cross-reference step (Tier 3). linked_business_txn_id points to the
--   business-side expense transaction that got created from it, and
--   source_owner_id records which owner record supplied the ownership %
--   used for the capital contribution — needed because unflagging must
--   reverse the exact capital account entry that was created.
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  account_id UUID REFERENCES accounts(id),
  txn_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL, -- positive = inflow, negative = outflow
  is_business BOOLEAN, -- null until categorized; co-mingled personal vs business flag (Tier 1 only)
  personal_category TEXT, -- free-text category for Tier 2 transactions
  needs_review BOOLEAN NOT NULL DEFAULT true,
  flagged_as_business BOOLEAN NOT NULL DEFAULT false,
  flagged_for_client_id UUID REFERENCES clients(id), -- which business claimed this personal transaction
  linked_business_txn_id UUID REFERENCES transactions(id),
  source_owner_id UUID REFERENCES owners(id), -- the owner record used for the capital contribution, so unflagging can reverse it exactly
  journal_entry_id UUID, -- set when this row was created by a manual journal entry, not a document (FK added after journal_entries exists below)
  possible_duplicate BOOLEAN NOT NULL DEFAULT false, -- flagged at upload time if a same-date/amount/description transaction already exists
  duplicate_of_transaction_id UUID REFERENCES transactions(id), -- which existing transaction this looks like a duplicate of
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_exactly_one_owner CHECK (
    (client_id IS NOT NULL AND customer_id IS NULL) OR
    (client_id IS NULL AND customer_id IS NOT NULL)
  )
);

-- Invoices/bills received FROM vendors (accounts payable) — one row per
-- bill, whether it came from an uploaded document or was entered manually.
-- amount_paid tracks partial/full payment so AP aging can be calculated
-- from a real outstanding balance instead of just the paid_status label.
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  vendor_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  amount NUMERIC(12,2),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_status TEXT DEFAULT 'unknown' -- kept for backward display; outstanding balance (amount - amount_paid) is authoritative
);

-- Invoices the BUSINESS sends to ITS OWN customers (accounts receivable) —
-- a completely different concept from this app's "customers" table (which
-- represents your tax clients, the people). customer_name here is free
-- text since a business's own customers aren't tracked as full records in
-- this app, just enough to know who owes what and chase aging.
CREATE TABLE ar_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capital account movements per owner. source_transaction_id is set when
-- auto-created from flagging a personal transaction — this is what makes
-- unflagging exact and safe (delete this row + the linked business txn).
CREATE TABLE capital_account_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL, -- 'contribution' or 'distribution'
  amount NUMERIC(12,2) NOT NULL,
  source_transaction_id UUID REFERENCES transactions(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 1099 TRACKING
--
-- Vendors are tracked per business. tax_id is sensitive (SSN or EIN) —
-- treat this column with the same care as any PII: never log it, never
-- include it in the audit_log metadata, restrict who can view it.
-- ============================================================

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_id TEXT, -- SSN or EIN — sensitive, handle with care (see note above)
  tax_id_type TEXT, -- 'ssn' or 'ein'
  address TEXT,
  requires_1099 BOOLEAN NOT NULL DEFAULT true, -- most contractors/services do; set false for corporations, most goods purchases
  w9_on_file BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Links a business transaction to the vendor it was paid to. Nullable —
-- most transactions (e.g. bank fees, transfers) have no vendor to track.
ALTER TABLE transactions ADD COLUMN vendor_id UUID REFERENCES vendors(id);

-- ============================================================
-- PAYROLL TRACKING
--
-- This is a REGISTER, not a payroll tax engine — it does not calculate
-- federal/state withholding, FICA, or FUTA/SUTA. Those figures come from
-- your payroll processor (Gusto, ADP, etc.) or manual calculation; this
-- table is where you record them so they feed the P&L and year-end
-- reports correctly.
--
-- A worker's type determines how they're tracked:
--   '1099_contractor' — reuses the existing vendors/1099 tracking (vendor_id
--     is set, either linking an existing vendor or auto-creating one).
--     Payments to them are tracked as ordinary vendor transactions, NOT as
--     payroll_payments rows, to avoid double-counting the same dollars.
--   'w2_hourly' / 'w2_salary' — tracked via payroll_payments below, one row
--     per pay run.
-- ============================================================

CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  worker_type TEXT NOT NULL, -- '1099_contractor', 'w2_hourly', 'w2_salary'
  vendor_id UUID REFERENCES vendors(id), -- set when worker_type = '1099_contractor'
  hourly_rate NUMERIC(8,2), -- for w2_hourly
  annual_salary NUMERIC(12,2), -- for w2_salary
  pay_frequency TEXT, -- 'weekly', 'biweekly', 'semimonthly', 'monthly' — W-2 only
  ssn TEXT, -- sensitive PII — handle with the same care as vendors.tax_id; W-2 workers only
  active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workers_valid_type CHECK (worker_type IN ('1099_contractor', 'w2_hourly', 'w2_salary'))
);

-- One row per pay run, W-2 workers only (1099 contractor payments are
-- tracked as ordinary vendor transactions instead — see note above).
CREATE TABLE payroll_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  hours_worked NUMERIC(6,2), -- hourly workers only
  gross_pay NUMERIC(12,2) NOT NULL,
  federal_withholding NUMERIC(12,2) NOT NULL DEFAULT 0,
  state_withholding NUMERIC(12,2) NOT NULL DEFAULT 0,
  social_security_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  medicare_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL,
  employer_social_security NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_medicare NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_futa NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_suta NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_employer_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  transaction_id UUID REFERENCES transactions(id), -- link to the business ledger entry for this pay run, if posted
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FIXED ASSETS / DEPRECIATION
--
-- This produces a straight-line depreciation schedule as a practical
-- working baseline. Real MACRS conventions (mid-quarter/mid-month rules,
-- bonus depreciation phase-outs, listed property limits) are genuinely
-- complex — treat this schedule as a starting point to verify against IRS
-- Pub. 946 tables and/or your tax software's depreciation module, not as
-- the final authoritative MACRS calculation.
-- ============================================================

CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_amount NUMERIC(12,2) NOT NULL,
  section_179_amount NUMERIC(12,2) NOT NULL DEFAULT 0, -- immediately expensed under Sec. 179
  bonus_depreciation_amount NUMERIC(12,2) NOT NULL DEFAULT 0, -- immediately expensed as bonus depreciation
  useful_life_years NUMERIC(4,1) NOT NULL, -- e.g. 5, 7, 27.5, 39 — verify against IRS Pub. 946 class life tables
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line', -- this build only implements straight_line
  disposed_date DATE,
  disposed_amount NUMERIC(12,2), -- sale/disposal proceeds, for gain/loss calculation
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LOANS / AMORTIZATION
--
-- Standard fixed-rate amortization. Doesn't handle variable rates,
-- balloon payments, or interest-only periods — flag those to your
-- preparer's own calculation if a loan has those features.
-- ============================================================

CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lender_name TEXT NOT NULL,
  original_principal NUMERIC(12,2) NOT NULL,
  annual_interest_rate NUMERIC(6,4) NOT NULL, -- as a percentage, e.g. 6.5 for 6.5%
  origination_date DATE NOT NULL,
  term_months INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MANUAL JOURNAL ENTRIES
--
-- Real double-entry: every entry has 2+ lines, and the lines must balance
-- to zero using this rule (see services/journalBalance.js):
--   weight(asset) = +1, weight(liability/equity/income/expense) = -1
--   sum(weight(account_type) * line.amount) must equal 0
-- In practice: enter a POSITIVE amount for an increase to an asset,
-- liability, equity, or income account; enter a NEGATIVE amount for an
-- increase to an EXPENSE account (matching how expenses are stored
-- everywhere else in this app, e.g. flag-as-business-expense).
--
-- Each line also creates a row in `transactions` (via journal_entry_id) so
-- it flows into the existing P&L/Balance Sheet/General Ledger reports
-- without those reports needing to know journal entries exist separately.
-- Deleting a journal entry cascades to delete those transaction rows.
-- ============================================================

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'adjustment', -- 'opening_balance', 'depreciation', 'accrual', 'correction', 'adjustment', 'other'
  created_by UUID, -- FK to users added after users table exists, below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_journal_entry
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;

-- ============================================================
-- OWNERSHIP PERCENTAGE HISTORY
--
-- owners.ownership_percentage remains the CURRENT/default percentage (used
-- when no history exists at all, e.g. a business that's never had a
-- mid-year ownership change). Once history rows exist for an owner, the
-- Capital Accounts report computes a time-weighted average ownership % over
-- the report's date range instead of using the flat value — see
-- services/ownershipHistory.js.
-- ============================================================

CREATE TABLE ownership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL, -- the percentage applies FROM this date forward, until the next entry's effective_date
  ownership_percentage NUMERIC(5,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SECURITY: authentication, per-client staff access, + audit trail
-- ============================================================

-- Preparer/staff accounts. Passwords are bcrypt hashes — never plaintext.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'preparer', -- 'admin' or 'preparer'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- customers.created_by couldn't reference users at CREATE TABLE time since
-- users didn't exist yet — added here instead.
ALTER TABLE customers ADD CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users(id);

-- Same deal for journal_entries.created_by
ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_created_by FOREIGN KEY (created_by) REFERENCES users(id);

-- Which preparers can access which businesses. Admins bypass this check
-- entirely (see everything); preparers only see clients/businesses they've
-- been explicitly granted here. Access to a customer's personal tier is
-- derived from having access to at least one of their businesses (see
-- middleware/clientAccess.js) rather than tracked separately.
CREATE TABLE user_client_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES users(id),
  UNIQUE (user_id, client_id)
);

-- Every access to client/customer financial data gets logged here — who,
-- what action, on which record, when. This is both a security control
-- (detect unauthorized access) and increasingly an expectation from IRS
-- Pub. 4557 / FTC Safeguards Rule compliance for tax preparers.
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- e.g. 'document.upload', 'report.export', 'transaction.flag'
  resource_type TEXT, -- 'client', 'customer', 'document', 'transaction', etc.
  resource_id UUID,
  ip_address TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_client_date ON transactions(client_id, txn_date);
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_flagged_for_client ON transactions(flagged_for_client_id);
CREATE INDEX idx_transactions_vendor ON transactions(vendor_id);
CREATE INDEX idx_documents_client_status ON documents(client_id, status);
CREATE INDEX idx_documents_customer ON documents(customer_id);
CREATE INDEX idx_owners_client ON owners(client_id);
CREATE INDEX idx_owners_customer ON owners(customer_id);
CREATE INDEX idx_capital_entries_owner ON capital_account_entries(owner_id);
CREATE INDEX idx_vendors_client ON vendors(client_id);
CREATE INDEX idx_fixed_assets_client ON fixed_assets(client_id);
CREATE INDEX idx_loans_client ON loans(client_id);
CREATE INDEX idx_workers_client ON workers(client_id);
CREATE INDEX idx_payroll_payments_worker ON payroll_payments(worker_id);
CREATE INDEX idx_payroll_payments_client_date ON payroll_payments(client_id, pay_date);
CREATE INDEX idx_user_client_access_user ON user_client_access(user_id);
CREATE INDEX idx_user_client_access_client ON user_client_access(client_id);
CREATE INDEX idx_audit_log_user_date ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_journal_entries_client ON journal_entries(client_id);
CREATE INDEX idx_transactions_journal_entry ON transactions(journal_entry_id);
CREATE INDEX idx_ownership_history_owner ON ownership_history(owner_id, effective_date);
CREATE INDEX idx_ar_invoices_client ON ar_invoices(client_id);
CREATE INDEX idx_invoices_client ON invoices(client_id);
