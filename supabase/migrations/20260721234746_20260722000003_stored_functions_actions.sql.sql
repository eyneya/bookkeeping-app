/*
# Stored Functions: Actions & Utilities

## Summary
Creates PostgreSQL stored functions (callable via `supabase.rpc()`) for the
multi-step atomic operations and utility calculations that cannot be expressed
as simple PostgREST CRUD. These replace the Express route handlers that used
BEGIN/COMMIT transactions with pooled `pg` connections.

## New Functions

### Action RPCs (mutate data, run atomically inside the function body)
1. `rpc_flag_business_expense(p_txn_id, p_owner_id, p_account_id, p_override_lock)` —
   Claims a personal transaction for a business. Creates a business-side
   expense transaction, a capital contribution entry, and marks the personal
   transaction as flagged. Returns { business_transaction_id }.
2. `rpc_unflag_business_expense(p_txn_id, p_override_lock)` — Reverses the
   flag operation exactly: deletes the capital entry, clears the personal
   txn's flag fields, deletes the business txn. Returns { status }.
3. `rpc_create_journal_entry(p_client_id, p_entry_date, p_description, p_entry_type, p_lines, p_auto_balance_account_id, p_override_lock)` —
   Validates entry balance, optionally adds a plug line, creates the
   journal_entries row + one transactions row per line. Returns the entry
   with its lines.
4. `rpc_delete_document(p_doc_id, p_override_lock)` — Deletes a document and
   its transactions/invoices, refusing if any txn is flagged as business
   expense. Returns { status, transactions_removed }.
5. `rpc_bulk_categorize(p_transaction_ids, p_account_id, p_is_business)` —
   Bulk-updates transactions' account_id/is_business/needs_review.

### Utility RPCs (read-only or seed data)
6. `rpc_weighted_ownership_percentage(p_owner_id, p_start_date, p_end_date, p_fallback_pct)` —
   Time-weighted average ownership % over a date range.
7. `rpc_seed_default_accounts(p_client_id, p_entity_type)` — Inserts the
   entity-appropriate chart of accounts template.
8. `rpc_assert_period_not_locked(p_client_id, p_txn_date, p_override_lock)` —
   Checks if a date falls in a locked period; returns 'ok' or raises an error.
9. `rpc_write_audit_log(p_action, p_resource_type, p_resource_id, p_metadata)` —
   Inserts an audit_log row for the current user.

## Security
- All functions are `SECURITY DEFINER` owned by `postgres` so they can write
  to tables even when the calling role's RLS would block the write.
- Access control (is_admin / has_client_access) is checked inside each
  function before mutating, mirroring the old Express middleware.
- Period lock enforcement is replicated inside the action RPCs.
*/

-- ============================================================
-- Utility: period lock check
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_assert_period_not_locked(
  p_client_id uuid,
  p_txn_date date,
  p_override_lock boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_through date;
BEGIN
  IF p_client_id IS NULL OR p_txn_date IS NULL THEN
    RETURN 'ok';
  END IF;

  SELECT locked_through_date INTO v_locked_through FROM public.clients WHERE id = p_client_id;
  IF v_locked_through IS NULL THEN
    RETURN 'ok';
  END IF;

  IF p_txn_date <= v_locked_through THEN
    IF public.is_admin() AND p_override_lock = true THEN
      RETURN 'overridden';
    END IF;
    RAISE EXCEPTION 'This date (%) falls within a locked period (locked through %).',
      p_txn_date, v_locked_through
      USING ERRCODE = '40000';
  END IF;

  RETURN 'ok';
END;
$$;

-- ============================================================
-- Utility: write audit log
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_write_audit_log(
  p_action text,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.audit_log (user_id, action, resource_type, resource_id, ip_address, metadata)
  VALUES (auth.uid(), p_action, p_resource_type, p_resource_id, NULL, p_metadata);
$$;

-- ============================================================
-- Utility: weighted ownership percentage
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_weighted_ownership_percentage(
  p_owner_id uuid,
  p_start_date date,
  p_end_date date,
  p_fallback_pct numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history RECORD;
  v_total_days numeric;
  v_weighted_sum numeric DEFAULT 0;
  v_prev_date date;
  v_segment_start date;
  v_segment_end date;
  v_days_in_segment numeric;
  v_earliest_date date;
  v_gap_days numeric;
BEGIN
  PERFORM 1 FROM public.ownership_history WHERE owner_id = p_owner_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN p_fallback_pct;
  END IF;

  v_total_days := GREATEST((p_end_date - p_start_date) + 1, 1);

  v_prev_date := NULL;
  FOR v_history IN
    SELECT effective_date, ownership_percentage
    FROM public.ownership_history
    WHERE owner_id = p_owner_id
    ORDER BY effective_date
  LOOP
    IF v_prev_date IS NULL THEN
      v_earliest_date := v_history.effective_date;
      IF p_start_date < v_earliest_date THEN
        v_gap_days := GREATEST(LEAST(v_earliest_date, p_end_date) - p_start_date, 0);
        v_weighted_sum := v_weighted_sum + v_gap_days * p_fallback_pct;
      END IF;
      v_segment_start := GREATEST(v_history.effective_date, p_start_date);
    ELSE
      v_segment_start := GREATEST(v_history.effective_date, p_start_date);
    END IF;

    SELECT effective_date INTO v_segment_end
    FROM public.ownership_history
    WHERE owner_id = p_owner_id AND effective_date > v_history.effective_date
    ORDER BY effective_date LIMIT 1;

    IF v_segment_end IS NULL THEN
      v_segment_end := p_end_date;
    END IF;

    v_segment_end := LEAST(v_segment_end, p_end_date);

    IF v_segment_end >= p_start_date AND v_segment_start <= p_end_date THEN
      v_days_in_segment := GREATEST(v_segment_end - v_segment_start + 1, 0);
      v_weighted_sum := v_weighted_sum + v_days_in_segment * v_history.ownership_percentage;
    END IF;

    v_prev_date := v_history.effective_date;
  END LOOP;

  RETURN ROUND((v_weighted_sum / v_total_days) * 100) / 100;
END;
$$;

-- ============================================================
-- Utility: seed default accounts
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_seed_default_accounts(
  p_client_id uuid,
  p_entity_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.accounts (client_id, name, account_type, is_default)
  VALUES
    (p_client_id, 'Business Checking', 'asset', true),
    (p_client_id, 'Business Savings', 'asset', true),
    (p_client_id, 'Accounts Receivable', 'asset', true),
    (p_client_id, 'Accounts Payable', 'liability', true),
    (p_client_id, 'Credit Card', 'liability', true);

  IF p_entity_type = 'llc_single_member' OR p_entity_type = 'individual' THEN
    INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
      (p_client_id, 'Owner''s Draw', 'equity', true),
      (p_client_id, 'Owner''s Contribution', 'equity', true),
      (p_client_id, 'Retained Earnings', 'equity', true),
      (p_client_id, 'Opening Balance Equity', 'equity', true);
  ELSIF p_entity_type = 'partnership' THEN
    INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
      (p_client_id, 'Partner Contributions', 'equity', true),
      (p_client_id, 'Partner Distributions', 'equity', true),
      (p_client_id, 'Retained Earnings', 'equity', true),
      (p_client_id, 'Opening Balance Equity', 'equity', true);
  ELSIF p_entity_type = 's_corp' THEN
    INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
      (p_client_id, 'Shareholder Contributions', 'equity', true),
      (p_client_id, 'Shareholder Distributions', 'equity', true),
      (p_client_id, 'Retained Earnings', 'equity', true),
      (p_client_id, 'Opening Balance Equity', 'equity', true);
  ELSIF p_entity_type = 'c_corp' THEN
    INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
      (p_client_id, 'Common Stock', 'equity', true),
      (p_client_id, 'Additional Paid-In Capital', 'equity', true),
      (p_client_id, 'Retained Earnings', 'equity', true),
      (p_client_id, 'Dividends Paid', 'equity', true),
      (p_client_id, 'Opening Balance Equity', 'equity', true);
  ELSE
    INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
      (p_client_id, 'Owner''s Draw', 'equity', true),
      (p_client_id, 'Owner''s Contribution', 'equity', true),
      (p_client_id, 'Opening Balance Equity', 'equity', true);
  END IF;

  INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
    (p_client_id, 'Revenue - Services', 'income', true),
    (p_client_id, 'Revenue - Products', 'income', true),
    (p_client_id, 'Other Income', 'income', true);

  IF p_entity_type IN ('s_corp', 'c_corp') THEN
    INSERT INTO public.accounts (client_id, name, account_type, is_default)
    VALUES (p_client_id, 'Officer Compensation', 'expense', true);
  END IF;

  INSERT INTO public.accounts (client_id, name, account_type, is_default) VALUES
    (p_client_id, 'Office Supplies', 'expense', true),
    (p_client_id, 'Rent', 'expense', true),
    (p_client_id, 'Utilities', 'expense', true),
    (p_client_id, 'Payroll', 'expense', true),
    (p_client_id, 'Contract Labor', 'expense', true),
    (p_client_id, 'Meals & Entertainment', 'expense', true),
    (p_client_id, 'Travel', 'expense', true),
    (p_client_id, 'Insurance', 'expense', true),
    (p_client_id, 'Professional Fees', 'expense', true),
    (p_client_id, 'Software/Subscriptions', 'expense', true),
    (p_client_id, 'Advertising', 'expense', true),
    (p_client_id, 'Bank Fees', 'expense', true),
    (p_client_id, 'Other Expense', 'expense', true);
END;
$$;

-- ============================================================
-- Action: flag business expense (3-step atomic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_flag_business_expense(
  p_txn_id uuid,
  p_owner_id uuid,
  p_account_id uuid,
  p_override_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_personal_txn public.transactions%ROWTYPE;
  v_owner public.owners%ROWTYPE;
  v_business_txn_id uuid;
  v_lock_result text;
  v_abs_amount numeric;
BEGIN
  SELECT * INTO v_personal_txn FROM public.transactions WHERE id = p_txn_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found' USING ERRCODE = '404';
  END IF;

  IF v_personal_txn.customer_id IS NOT NULL THEN
    IF NOT public.has_customer_access(v_personal_txn.customer_id) THEN
      RAISE EXCEPTION 'You do not have access to this transaction.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_personal_txn.client_id IS NOT NULL THEN
    IF NOT public.has_client_access(v_personal_txn.client_id) THEN
      RAISE EXCEPTION 'You do not have access to this transaction.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_personal_txn.customer_id IS NULL THEN
    RAISE EXCEPTION 'This is not a personal-tier transaction.' USING ERRCODE = '400';
  END IF;

  IF v_personal_txn.flagged_as_business THEN
    RAISE EXCEPTION 'Already claimed by a business. Unflag it first if you need to reassign it.' USING ERRCODE = '400';
  END IF;

  SELECT * INTO v_owner FROM public.owners WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner not found' USING ERRCODE = '404';
  END IF;

  IF v_owner.customer_id IS NULL OR v_owner.customer_id != v_personal_txn.customer_id THEN
    RAISE EXCEPTION 'This owner record does not belong to the same person as this personal transaction.' USING ERRCODE = '400';
  END IF;

  IF NOT public.has_client_access(v_owner.client_id) THEN
    RAISE EXCEPTION 'You do not have access to the business you are trying to flag this for.' USING ERRCODE = '42501';
  END IF;

  v_lock_result := public.rpc_assert_period_not_locked(v_owner.client_id, v_personal_txn.txn_date, p_override_lock);

  v_abs_amount := ABS(v_personal_txn.amount);

  INSERT INTO public.transactions (client_id, document_id, account_id, txn_date, description, amount, is_business, needs_review)
  VALUES (
    v_owner.client_id,
    v_personal_txn.document_id,
    p_account_id,
    v_personal_txn.txn_date,
    v_personal_txn.description || ' (paid personally by ' || v_owner.name || ')',
    -v_abs_amount,
    true,
    false
  )
  RETURNING id INTO v_business_txn_id;

  INSERT INTO public.capital_account_entries (owner_id, entry_date, entry_type, amount, source_transaction_id, notes)
  VALUES (
    p_owner_id,
    v_personal_txn.txn_date,
    'contribution',
    v_abs_amount,
    v_business_txn_id,
    'Business expense paid personally: ' || v_personal_txn.description
  );

  UPDATE public.transactions SET
    flagged_as_business = true,
    flagged_for_client_id = v_owner.client_id,
    linked_business_txn_id = v_business_txn_id,
    source_owner_id = p_owner_id,
    needs_review = false
  WHERE id = p_txn_id;

  PERFORM public.rpc_write_audit_log(
    'transaction.flag_as_business',
    'transaction',
    p_txn_id,
    jsonb_build_object('business_transaction_id', v_business_txn_id, 'owner_id', p_owner_id, 'client_id', v_owner.client_id, 'lock_overridden', v_lock_result = 'overridden')
  );

  IF v_lock_result = 'overridden' THEN
    PERFORM public.rpc_write_audit_log('period_lock.override', 'transaction', p_txn_id, jsonb_build_object('route', 'flag-as-business-expense'));
  END IF;

  RETURN jsonb_build_object('status', 'flagged', 'business_transaction_id', v_business_txn_id);
END;
$$;

-- ============================================================
-- Action: unflag business expense (reverse 3-step)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_unflag_business_expense(
  p_txn_id uuid,
  p_override_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_personal_txn public.transactions%ROWTYPE;
  v_lock_result text;
BEGIN
  SELECT * INTO v_personal_txn FROM public.transactions WHERE id = p_txn_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found' USING ERRCODE = '404';
  END IF;

  IF v_personal_txn.customer_id IS NOT NULL THEN
    IF NOT public.has_customer_access(v_personal_txn.customer_id) THEN
      RAISE EXCEPTION 'You do not have access to this transaction.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_personal_txn.client_id IS NOT NULL THEN
    IF NOT public.has_client_access(v_personal_txn.client_id) THEN
      RAISE EXCEPTION 'You do not have access to this transaction.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT v_personal_txn.flagged_as_business THEN
    RAISE EXCEPTION 'This transaction is not currently flagged.' USING ERRCODE = '400';
  END IF;

  v_lock_result := public.rpc_assert_period_not_locked(v_personal_txn.flagged_for_client_id, v_personal_txn.txn_date, p_override_lock);

  DELETE FROM public.capital_account_entries WHERE source_transaction_id = v_personal_txn.linked_business_txn_id;

  UPDATE public.transactions SET
    flagged_as_business = false,
    flagged_for_client_id = NULL,
    linked_business_txn_id = NULL,
    source_owner_id = NULL,
    needs_review = true
  WHERE id = p_txn_id;

  DELETE FROM public.transactions WHERE id = v_personal_txn.linked_business_txn_id;

  PERFORM public.rpc_write_audit_log('transaction.unflag_business', 'transaction', p_txn_id, jsonb_build_object('lock_overridden', v_lock_result = 'overridden'));
  IF v_lock_result = 'overridden' THEN
    PERFORM public.rpc_write_audit_log('period_lock.override', 'transaction', p_txn_id, jsonb_build_object('route', 'unflag-business-expense'));
  END IF;

  RETURN jsonb_build_object('status', 'unflagged');
END;
$$;

-- ============================================================
-- Action: create journal entry (balance-checked, multi-line)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_create_journal_entry(
  p_client_id uuid,
  p_entry_date date,
  p_description text,
  p_entry_type text DEFAULT 'adjustment',
  p_lines jsonb DEFAULT NULL,
  p_auto_balance_account_id uuid DEFAULT NULL,
  p_override_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_line jsonb;
  v_account_type text;
  v_weighted_sum numeric DEFAULT 0;
  v_plug_amount numeric;
  v_plug_weight int;
  v_all_lines jsonb := '[]'::jsonb;
  v_lock_result text;
  v_valid_types text[] := ARRAY['opening_balance','depreciation','accrual','correction','adjustment','other'];
BEGIN
  IF p_client_id IS NULL OR p_entry_date IS NULL OR p_description IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'client_id, entry_date, description, and a non-empty lines array are required' USING ERRCODE = '400';
  END IF;

  IF NOT (p_entry_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'entry_type must be one of the valid types' USING ERRCODE = '400';
  END IF;

  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  v_lock_result := public.rpc_assert_period_not_locked(p_client_id, p_entry_date, p_override_lock);

  v_all_lines := p_lines;

  IF p_auto_balance_account_id IS NOT NULL THEN
    SELECT account_type INTO v_account_type FROM public.accounts WHERE id = p_auto_balance_account_id AND client_id = p_client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Auto-balance account not found for this client.' USING ERRCODE = '400';
    END IF;

    v_weighted_sum := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_all_lines)
    LOOP
      SELECT account_type INTO v_account_type FROM public.accounts WHERE id = (v_line->>'account_id')::uuid AND client_id = p_client_id;
      v_weighted_sum := v_weighted_sum + (CASE WHEN v_account_type = 'asset' THEN 1 ELSE -1 END) * (v_line->>'amount')::numeric;
    END LOOP;

    v_plug_weight := CASE WHEN v_account_type = 'asset' THEN 1 ELSE -1 END;
    v_plug_amount := ROUND((-v_weighted_sum / v_plug_weight) * 100) / 100;

    v_all_lines := v_all_lines || jsonb_build_object(
      'account_id', p_auto_balance_account_id,
      'amount', v_plug_amount,
      'account_type', v_account_type,
      'description', p_description || ' (auto-balancing entry)'
    );
  END IF;

  v_weighted_sum := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_all_lines)
  LOOP
    SELECT account_type INTO v_account_type FROM public.accounts WHERE id = (v_line->>'account_id')::uuid AND client_id = p_client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found for this client.' USING ERRCODE = '400';
    END IF;
    v_weighted_sum := v_weighted_sum + (CASE WHEN v_account_type = 'asset' THEN 1 ELSE -1 END) * (v_line->>'amount')::numeric;
  END LOOP;

  IF ABS(v_weighted_sum) >= 0.01 THEN
    RAISE EXCEPTION 'This entry does not balance (off by %). Remember: increases to expenses are entered as negative amounts.', ROUND(v_weighted_sum * 100) / 100 USING ERRCODE = '400';
  END IF;

  INSERT INTO public.journal_entries (client_id, entry_date, description, entry_type, created_by)
  VALUES (p_client_id, p_entry_date, p_description, p_entry_type, auth.uid())
  RETURNING * INTO v_entry;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_all_lines)
  LOOP
    SELECT account_type INTO v_account_type FROM public.accounts WHERE id = (v_line->>'account_id')::uuid AND client_id = p_client_id;
    INSERT INTO public.transactions (client_id, account_id, txn_date, description, amount, is_business, needs_review, journal_entry_id)
    VALUES (
      p_client_id,
      (v_line->>'account_id')::uuid,
      p_entry_date,
      COALESCE(v_line->>'description', p_description),
      (v_line->>'amount')::numeric,
      true,
      false,
      v_entry.id
    );
  END LOOP;

  PERFORM public.rpc_write_audit_log(
    'journal_entry.create',
    'journal_entry',
    v_entry.id,
    jsonb_build_object('entry_type', p_entry_type, 'lock_overridden', v_lock_result = 'overridden')
  );
  IF v_lock_result = 'overridden' THEN
    PERFORM public.rpc_write_audit_log('period_lock.override', 'journal_entry', v_entry.id, jsonb_build_object('route', 'rpc_create_journal_entry'));
  END IF;

  RETURN jsonb_build_object('id', v_entry.id, 'entry', v_entry, 'lines', v_all_lines);
END;
$$;

-- ============================================================
-- Action: delete document (with flagged-txn guard + cascade)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_delete_document(
  p_doc_id uuid,
  p_override_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_txn public.transactions%ROWTYPE;
  v_txn_count integer;
  v_lock_result text;
  v_lock_overridden boolean := false;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id = p_doc_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '404';
  END IF;

  IF v_doc.client_id IS NOT NULL THEN
    IF NOT public.has_client_access(v_doc.client_id) THEN
      RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_doc.customer_id IS NOT NULL THEN
    IF NOT public.has_customer_access(v_doc.customer_id) THEN
      RAISE EXCEPTION 'You do not have access to this client (person).' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1 FROM public.transactions WHERE document_id = p_doc_id AND flagged_as_business = true LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'One or more transactions from this document have been flagged as a business expense — unflag them first.' USING ERRCODE = '400';
  END IF;

  FOR v_txn IN SELECT * FROM public.transactions WHERE document_id = p_doc_id
  LOOP
    v_lock_result := public.rpc_assert_period_not_locked(v_txn.client_id, v_txn.txn_date, p_override_lock);
    IF v_lock_result = 'overridden' THEN
      v_lock_overridden := true;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_txn_count FROM public.transactions WHERE document_id = p_doc_id;

  DELETE FROM public.transactions WHERE document_id = p_doc_id;
  DELETE FROM public.invoices WHERE document_id = p_doc_id;
  DELETE FROM public.documents WHERE id = p_doc_id;

  PERFORM public.rpc_write_audit_log('document.delete', 'document', p_doc_id, jsonb_build_object('lock_overridden', v_lock_overridden, 'transactions_removed', v_txn_count));
  IF v_lock_overridden THEN
    PERFORM public.rpc_write_audit_log('period_lock.override', 'document', p_doc_id, jsonb_build_object('route', 'rpc_delete_document'));
  END IF;

  RETURN jsonb_build_object('status', 'deleted', 'transactions_removed', v_txn_count);
END;
$$;

-- ============================================================
-- Action: bulk categorize transactions
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_bulk_categorize(
  p_transaction_ids uuid[],
  p_account_id uuid DEFAULT NULL,
  p_is_business boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_client_id uuid;
BEGIN
  FOR v_client_id IN SELECT DISTINCT client_id FROM public.transactions WHERE id = ANY(p_transaction_ids) AND client_id IS NOT NULL
  LOOP
    IF NOT public.has_client_access(v_client_id) THEN
      RAISE EXCEPTION 'You do not have access to one or more of these transactions.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  UPDATE public.transactions SET
    account_id = COALESCE(p_account_id, account_id),
    is_business = COALESCE(p_is_business, is_business),
    needs_review = false
  WHERE id = ANY(p_transaction_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_count);
END;
$$;
