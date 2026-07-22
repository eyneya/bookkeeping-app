/*
# Enable RLS Policies on All Tables

## Summary
Adds per-CRUD RLS policies (SELECT, INSERT, UPDATE, DELETE) on every table in
the schema, using the `is_admin()`, `has_client_access()`, and
`has_customer_access()` helper functions from the previous migration. Admins
bypass all restrictions; preparers can only access rows belonging to clients
(businesses) or customers (people) they've been granted access to.

## Policy Design
Each table gets 4 policies (one per CRUD verb), scoped to `TO authenticated`:

- **Client-owned tables** (clients, accounts, vendors, workers, fixed_assets,
  loans, journal_entries, ar_invoices, ownership_history): access is gated by
  `has_client_access(client_id)`.
- **Customer-owned tables** (customers): access gated by `has_customer_access(id)`.
- **Bridge/link tables** (owners, documents, transactions, capital_account_entries,
  payroll_payments, invoices): gated by access to their parent client or customer.
- **user_client_access**: preparers can see their own access rows; admins see all.
- **audit_log**: admins see all; preparers see their own entries. Inserts allowed
  for all authenticated users (audit trail).
- **profiles**: already configured in previous migration.

## Security Notes
1. INSERT/UPDATE policies use WITH CHECK to ensure the new row's parent
   client/customer is one the user has access to — prevents smuggling data
   into an unauthorized client.
2. For transactions, which can be either client-owned or customer-owned
   (enforced by a CHECK constraint), the policy checks BOTH paths: if
   client_id is set, require client access; if customer_id is set, require
   customer access.
3. `created_by` columns (customers, journal_entries, user_client_access) are
   defaulted to `auth.uid()` on insert where applicable.
*/

-- ============================================================
-- clients
-- ============================================================
DROP POLICY IF EXISTS "select_clients" ON public.clients;
CREATE POLICY "select_clients" ON public.clients FOR SELECT
  TO authenticated USING (public.has_client_access(id));

DROP POLICY IF EXISTS "insert_clients" ON public.clients;
CREATE POLICY "insert_clients" ON public.clients FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_clients" ON public.clients;
CREATE POLICY "update_clients" ON public.clients FOR UPDATE
  TO authenticated USING (public.has_client_access(id))
  WITH CHECK (public.has_client_access(id));

DROP POLICY IF EXISTS "delete_clients" ON public.clients;
CREATE POLICY "delete_clients" ON public.clients FOR DELETE
  TO authenticated USING (public.is_admin());

-- ============================================================
-- customers
-- ============================================================
DROP POLICY IF EXISTS "select_customers" ON public.customers;
CREATE POLICY "select_customers" ON public.customers FOR SELECT
  TO authenticated USING (public.has_customer_access(id));

DROP POLICY IF EXISTS "insert_customers" ON public.customers;
CREATE POLICY "insert_customers" ON public.customers FOR INSERT
  TO authenticated WITH CHECK (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.user_client_access WHERE user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "update_customers" ON public.customers;
CREATE POLICY "update_customers" ON public.customers FOR UPDATE
  TO authenticated USING (public.has_customer_access(id))
  WITH CHECK (public.has_customer_access(id));

DROP POLICY IF EXISTS "delete_customers" ON public.customers;
CREATE POLICY "delete_customers" ON public.customers FOR DELETE
  TO authenticated USING (public.has_customer_access(id));

-- ============================================================
-- owners (bridge: client + customer)
-- ============================================================
DROP POLICY IF EXISTS "select_owners" ON public.owners;
CREATE POLICY "select_owners" ON public.owners FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_owners" ON public.owners;
CREATE POLICY "insert_owners" ON public.owners FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_owners" ON public.owners;
CREATE POLICY "update_owners" ON public.owners FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_owners" ON public.owners;
CREATE POLICY "delete_owners" ON public.owners FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- documents (either client_id or customer_id)
-- ============================================================
DROP POLICY IF EXISTS "select_documents" ON public.documents;
CREATE POLICY "select_documents" ON public.documents FOR SELECT
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "insert_documents" ON public.documents;
CREATE POLICY "insert_documents" ON public.documents FOR INSERT
  TO authenticated WITH CHECK (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "update_documents" ON public.documents;
CREATE POLICY "update_documents" ON public.documents FOR UPDATE
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  )
  WITH CHECK (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "delete_documents" ON public.documents;
CREATE POLICY "delete_documents" ON public.documents FOR DELETE
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

-- ============================================================
-- accounts (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_accounts" ON public.accounts;
CREATE POLICY "select_accounts" ON public.accounts FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_accounts" ON public.accounts;
CREATE POLICY "insert_accounts" ON public.accounts FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_accounts" ON public.accounts;
CREATE POLICY "update_accounts" ON public.accounts FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_accounts" ON public.accounts;
CREATE POLICY "delete_accounts" ON public.accounts FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- transactions (either client_id or customer_id)
-- ============================================================
DROP POLICY IF EXISTS "select_transactions" ON public.transactions;
CREATE POLICY "select_transactions" ON public.transactions FOR SELECT
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "insert_transactions" ON public.transactions;
CREATE POLICY "insert_transactions" ON public.transactions FOR INSERT
  TO authenticated WITH CHECK (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "update_transactions" ON public.transactions;
CREATE POLICY "update_transactions" ON public.transactions FOR UPDATE
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  )
  WITH CHECK (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

DROP POLICY IF EXISTS "delete_transactions" ON public.transactions;
CREATE POLICY "delete_transactions" ON public.transactions FOR DELETE
  TO authenticated USING (
    (client_id IS NOT NULL AND public.has_client_access(client_id))
    OR (customer_id IS NOT NULL AND public.has_customer_access(customer_id))
  );

-- ============================================================
-- invoices (client-owned AP bills)
-- ============================================================
DROP POLICY IF EXISTS "select_invoices" ON public.invoices;
CREATE POLICY "select_invoices" ON public.invoices FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_invoices" ON public.invoices;
CREATE POLICY "insert_invoices" ON public.invoices FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_invoices" ON public.invoices;
CREATE POLICY "update_invoices" ON public.invoices FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_invoices" ON public.invoices;
CREATE POLICY "delete_invoices" ON public.invoices FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- ar_invoices (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_ar_invoices" ON public.ar_invoices;
CREATE POLICY "select_ar_invoices" ON public.ar_invoices FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_ar_invoices" ON public.ar_invoices;
CREATE POLICY "insert_ar_invoices" ON public.ar_invoices FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_ar_invoices" ON public.ar_invoices;
CREATE POLICY "update_ar_invoices" ON public.ar_invoices FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_ar_invoices" ON public.ar_invoices;
CREATE POLICY "delete_ar_invoices" ON public.ar_invoices FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- capital_account_entries (via owner → client)
-- ============================================================
DROP POLICY IF EXISTS "select_capital_entries" ON public.capital_account_entries;
CREATE POLICY "select_capital_entries" ON public.capital_account_entries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = capital_account_entries.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "insert_capital_entries" ON public.capital_account_entries;
CREATE POLICY "insert_capital_entries" ON public.capital_account_entries FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = capital_account_entries.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "update_capital_entries" ON public.capital_account_entries;
CREATE POLICY "update_capital_entries" ON public.capital_account_entries FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = capital_account_entries.owner_id AND public.has_client_access(owners.client_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = capital_account_entries.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "delete_capital_entries" ON public.capital_account_entries;
CREATE POLICY "delete_capital_entries" ON public.capital_account_entries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = capital_account_entries.owner_id AND public.has_client_access(owners.client_id))
  );

-- ============================================================
-- vendors (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_vendors" ON public.vendors;
CREATE POLICY "select_vendors" ON public.vendors FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_vendors" ON public.vendors;
CREATE POLICY "insert_vendors" ON public.vendors FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_vendors" ON public.vendors;
CREATE POLICY "update_vendors" ON public.vendors FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_vendors" ON public.vendors;
CREATE POLICY "delete_vendors" ON public.vendors FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- workers (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_workers" ON public.workers;
CREATE POLICY "select_workers" ON public.workers FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_workers" ON public.workers;
CREATE POLICY "insert_workers" ON public.workers FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_workers" ON public.workers;
CREATE POLICY "update_workers" ON public.workers FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_workers" ON public.workers;
CREATE POLICY "delete_workers" ON public.workers FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- payroll_payments (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_payroll" ON public.payroll_payments;
CREATE POLICY "select_payroll" ON public.payroll_payments FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_payroll" ON public.payroll_payments;
CREATE POLICY "insert_payroll" ON public.payroll_payments FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_payroll" ON public.payroll_payments;
CREATE POLICY "update_payroll" ON public.payroll_payments FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_payroll" ON public.payroll_payments;
CREATE POLICY "delete_payroll" ON public.payroll_payments FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- fixed_assets (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_fixed_assets" ON public.fixed_assets;
CREATE POLICY "select_fixed_assets" ON public.fixed_assets FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_fixed_assets" ON public.fixed_assets;
CREATE POLICY "insert_fixed_assets" ON public.fixed_assets FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_fixed_assets" ON public.fixed_assets;
CREATE POLICY "update_fixed_assets" ON public.fixed_assets FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_fixed_assets" ON public.fixed_assets;
CREATE POLICY "delete_fixed_assets" ON public.fixed_assets FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- loans (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_loans" ON public.loans;
CREATE POLICY "select_loans" ON public.loans FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_loans" ON public.loans;
CREATE POLICY "insert_loans" ON public.loans FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_loans" ON public.loans;
CREATE POLICY "update_loans" ON public.loans FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_loans" ON public.loans;
CREATE POLICY "delete_loans" ON public.loans FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- journal_entries (client-owned)
-- ============================================================
DROP POLICY IF EXISTS "select_journal_entries" ON public.journal_entries;
CREATE POLICY "select_journal_entries" ON public.journal_entries FOR SELECT
  TO authenticated USING (public.has_client_access(client_id));

DROP POLICY IF EXISTS "insert_journal_entries" ON public.journal_entries;
CREATE POLICY "insert_journal_entries" ON public.journal_entries FOR INSERT
  TO authenticated WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "update_journal_entries" ON public.journal_entries;
CREATE POLICY "update_journal_entries" ON public.journal_entries FOR UPDATE
  TO authenticated USING (public.has_client_access(client_id))
  WITH CHECK (public.has_client_access(client_id));

DROP POLICY IF EXISTS "delete_journal_entries" ON public.journal_entries;
CREATE POLICY "delete_journal_entries" ON public.journal_entries FOR DELETE
  TO authenticated USING (public.has_client_access(client_id));

-- ============================================================
-- ownership_history (via owner → client)
-- ============================================================
DROP POLICY IF EXISTS "select_ownership_history" ON public.ownership_history;
CREATE POLICY "select_ownership_history" ON public.ownership_history FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = ownership_history.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "insert_ownership_history" ON public.ownership_history;
CREATE POLICY "insert_ownership_history" ON public.ownership_history FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = ownership_history.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "update_ownership_history" ON public.ownership_history;
CREATE POLICY "update_ownership_history" ON public.ownership_history FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = ownership_history.owner_id AND public.has_client_access(owners.client_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = ownership_history.owner_id AND public.has_client_access(owners.client_id))
  );

DROP POLICY IF EXISTS "delete_ownership_history" ON public.ownership_history;
CREATE POLICY "delete_ownership_history" ON public.ownership_history FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.owners WHERE owners.id = ownership_history.owner_id AND public.has_client_access(owners.client_id))
  );

-- ============================================================
-- user_client_access (preparer sees own rows; admin sees all)
-- ============================================================
DROP POLICY IF EXISTS "select_user_client_access" ON public.user_client_access;
CREATE POLICY "select_user_client_access" ON public.user_client_access FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "insert_user_client_access" ON public.user_client_access;
CREATE POLICY "insert_user_client_access" ON public.user_client_access FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_user_client_access" ON public.user_client_access;
CREATE POLICY "update_user_client_access" ON public.user_client_access FOR UPDATE
  TO authenticated USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_user_client_access" ON public.user_client_access;
CREATE POLICY "delete_user_client_access" ON public.user_client_access FOR DELETE
  TO authenticated USING (public.is_admin());

-- ============================================================
-- audit_log (admin sees all; preparer sees own; all can insert)
-- ============================================================
DROP POLICY IF EXISTS "select_audit_log" ON public.audit_log;
CREATE POLICY "select_audit_log" ON public.audit_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "insert_audit_log" ON public.audit_log;
CREATE POLICY "insert_audit_log" ON public.audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_audit_log" ON public.audit_log;
CREATE POLICY "update_audit_log" ON public.audit_log FOR UPDATE
  TO authenticated USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_audit_log" ON public.audit_log;
CREATE POLICY "delete_audit_log" ON public.audit_log FOR DELETE
  TO authenticated USING (public.is_admin());
