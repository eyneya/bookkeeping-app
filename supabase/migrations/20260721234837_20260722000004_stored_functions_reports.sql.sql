/*
# Stored Functions: Reports (Read-Only)

## Summary
Creates PostgreSQL stored functions for the 11 report queries that previously
lived in routes/reports.js. Each returns a JSON document with the same shape
the Express endpoints returned, so the frontend only needs to swap the fetch
URL for `supabase.rpc()`.

## New Functions
1. `rpc_pl_report(p_client_id, p_start_date, p_end_date)` — Profit & Loss
2. `rpc_balance_sheet_report(p_client_id, p_as_of_date)` — Balance Sheet
3. `rpc_general_ledger(p_client_id, p_start_date, p_end_date)` — General Ledger
4. `rpc_capital_accounts(p_client_id, p_start_date, p_end_date)` — Capital Accounts (K-1)
5. `rpc_personal_statement(p_owner_id, p_start_date, p_end_date)` — Personal Statement
6. `rpc_1099_summary(p_client_id, p_year)` — 1099 Summary
7. `rpc_depreciation_schedule(p_client_id, p_year)` — Depreciation Schedule
8. `rpc_loan_amortization(p_loan_id)` — Loan Amortization Schedule
9. `rpc_payroll_summary(p_client_id, p_year)` — Payroll Summary
10. `rpc_ar_aging(p_client_id)` — AR Aging
11. `rpc_ap_aging(p_client_id)` — AP Aging

## Security
All functions are SECURITY DEFINER and check has_client_access() before
returning data. Depreciation and amortization calculations (straight-line)
are implemented in SQL/PLpgSQL, replacing the JS helper functions.
*/

-- ============================================================
-- 1. P&L Report
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_pl_report(
  p_client_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_type', a.account_type,
    'account_name', a.name,
    'total', COALESCE(SUM(t.amount), 0)
  ) ORDER BY a.account_type, a.name), '[]'::jsonb)
  INTO v_result
  FROM transactions t
  JOIN accounts a ON t.account_id = a.id
  WHERE t.client_id = p_client_id
    AND t.is_business = true
    AND a.account_type IN ('income', 'expense')
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date)
  GROUP BY a.account_type, a.name;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 2. Balance Sheet Report
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_balance_sheet_report(
  p_client_id uuid,
  p_as_of_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_net_income numeric;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_type', a.account_type,
    'account_name', a.name,
    'total', COALESCE(SUM(t.amount), 0)
  ) ORDER BY a.account_type, a.name), '[]'::jsonb)
  INTO v_rows
  FROM transactions t
  JOIN accounts a ON t.account_id = a.id
  WHERE t.client_id = p_client_id
    AND t.is_business = true
    AND a.account_type IN ('asset', 'liability', 'equity')
    AND (p_as_of_date IS NULL OR t.txn_date <= p_as_of_date)
  GROUP BY a.account_type, a.name;

  SELECT COALESCE(SUM(t.amount), 0) INTO v_net_income
  FROM transactions t
  JOIN accounts a ON t.account_id = a.id
  WHERE t.client_id = p_client_id
    AND t.is_business = true
    AND a.account_type IN ('income', 'expense')
    AND (p_as_of_date IS NULL OR t.txn_date <= p_as_of_date);

  IF ABS(v_net_income) > 0.005 THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'account_type', 'equity',
      'account_name', 'Net Income (Current)',
      'total', v_net_income
    ));
  END IF;

  RETURN v_rows;
END;
$$;

-- ============================================================
-- 3. General Ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_general_ledger(
  p_client_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'txn_date', t.txn_date,
    'description', t.description,
    'amount', t.amount,
    'is_business', t.is_business,
    'account_name', COALESCE(a.name, ''),
    'account_type', a.account_type
  ) ORDER BY t.txn_date ASC), '[]'::jsonb)
  INTO v_result
  FROM transactions t
  LEFT JOIN accounts a ON t.account_id = a.id
  WHERE t.client_id = p_client_id
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date);

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. Capital Accounts Report
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_capital_accounts(
  p_client_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_net_income numeric;
  v_effective_end date;
  v_effective_start date;
  v_owners_result jsonb;
  v_total_ownership numeric;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE = '404';
  END IF;

  IF NOT (v_client.entity_type IN ('partnership', 's_corp')) THEN
    RAISE EXCEPTION 'Capital account allocation only applies to partnership and s_corp clients.' USING ERRCODE = '400';
  END IF;

  -- Net income for period
  SELECT COALESCE(SUM(t.amount), 0) INTO v_net_income
  FROM transactions t
  JOIN accounts a ON t.account_id = a.id
  WHERE t.client_id = p_client_id
    AND t.is_business = true
    AND a.account_type IN ('income', 'expense')
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date);

  v_effective_end := COALESCE(p_end_date, CURRENT_DATE);
  v_effective_start := COALESCE(p_start_date, make_date(EXTRACT(YEAR FROM v_effective_end)::int, 1, 1));

  -- Build owners array with contributions/distributions/weighted pct/allocated income
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'owner_id', o.id,
    'name', o.name,
    'owner_type', o.owner_type,
    'ownership_percentage', public.rpc_weighted_ownership_percentage(o.id, v_effective_start, v_effective_end, o.ownership_percentage),
    'contributions', COALESCE((
      SELECT SUM(amount) FROM capital_account_entries
      WHERE owner_id = o.id AND entry_type = 'contribution'
        AND (p_start_date IS NULL OR entry_date >= p_start_date)
        AND (p_end_date IS NULL OR entry_date <= p_end_date)
    ), 0),
    'distributions', COALESCE((
      SELECT SUM(amount) FROM capital_account_entries
      WHERE owner_id = o.id AND entry_type = 'distribution'
        AND (p_start_date IS NULL OR entry_date >= p_start_date)
        AND (p_end_date IS NULL OR entry_date <= p_end_date)
    ), 0)
  ) ORDER BY o.name), '[]'::jsonb)
  INTO v_owners_result
  FROM owners o
  WHERE o.client_id = p_client_id;

  -- Add allocated_income and ending_balance to each owner
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'owner_id', elem->>'owner_id',
    'name', elem->>'name',
    'owner_type', elem->>'owner_type',
    'ownership_percentage', (elem->>'ownership_percentage')::numeric,
    'contributions', (elem->>'contributions')::numeric,
    'distributions', (elem->>'distributions')::numeric,
    'allocated_income', (elem->>'contributions')::numeric - (elem->>'distributions')::numeric + v_net_income * ((elem->>'ownership_percentage')::numeric / 100),
    'ending_balance', (elem->>'contributions')::numeric - (elem->>'distributions')::numeric + v_net_income * ((elem->>'ownership_percentage')::numeric / 100)
  )), '[]'::jsonb)
  INTO v_owners_result
  FROM jsonb_array_elements(v_owners_result) AS elem;

  -- Check total ownership = 100%
  SELECT COALESCE(SUM(ownership_percentage), 0) INTO v_total_ownership
  FROM owners WHERE client_id = p_client_id;

  RETURN jsonb_build_object(
    'entity_type', v_client.entity_type,
    'total_net_income', v_net_income,
    'period', jsonb_build_object('start', v_effective_start, 'end', v_effective_end),
    'owners', v_owners_result,
    'ownership_warning', CASE WHEN ABS(v_total_ownership - 100) > 0.01 THEN 'Current ownership percentages total ' || v_total_ownership || '%, not 100%. Check owner records.' ELSE NULL END
  );
END;
$$;

-- ============================================================
-- 5. Personal Statement
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_personal_statement(
  p_owner_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner public.owners%ROWTYPE;
  v_covered jsonb;
  v_total_covered numeric;
  v_personal jsonb;
  v_net_personal numeric;
BEGIN
  SELECT * INTO v_owner FROM public.owners WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner not found' USING ERRCODE = '404';
  END IF;

  IF NOT public.has_client_access(v_owner.client_id) THEN
    RAISE EXCEPTION 'You do not have access to this business.' USING ERRCODE = '42501';
  END IF;

  -- Business expenses covered personally for THIS business
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'txn_date', t.txn_date,
    'description', t.description,
    'amount', t.amount
  ) ORDER BY t.txn_date), '[]'::jsonb)
  INTO v_covered
  FROM transactions t
  WHERE t.customer_id = v_owner.customer_id
    AND t.flagged_as_business = true
    AND t.flagged_for_client_id = v_owner.client_id
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date);

  SELECT COALESCE(SUM(ABS(t.amount)), 0) INTO v_total_covered
  FROM transactions t
  WHERE t.customer_id = v_owner.customer_id
    AND t.flagged_as_business = true
    AND t.flagged_for_client_id = v_owner.client_id
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date);

  -- Full personal income/expense statement grouped by personal_category
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'personal_category', COALESCE(t.personal_category, '(uncategorized)'),
    'total', SUM(t.amount),
    'txn_count', COUNT(*)
  ) ORDER BY t.personal_category NULLS LAST), '[]'::jsonb)
  INTO v_personal
  FROM transactions t
  WHERE t.customer_id = v_owner.customer_id
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date)
  GROUP BY t.personal_category;

  SELECT COALESCE(SUM(t.amount), 0) INTO v_net_personal
  FROM transactions t
  WHERE t.customer_id = v_owner.customer_id
    AND (p_start_date IS NULL OR t.txn_date >= p_start_date)
    AND (p_end_date IS NULL OR t.txn_date <= p_end_date);

  RETURN jsonb_build_object(
    'owner', jsonb_build_object('id', v_owner.id, 'name', v_owner.name, 'owner_type', v_owner.owner_type),
    'business_expenses_covered', jsonb_build_object('transactions', v_covered, 'total', v_total_covered),
    'personal_statement', jsonb_build_object(
      'categories', v_personal,
      'net', v_net_personal
    )
  );
END;
$$;

-- ============================================================
-- 6. 1099 Summary
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_1099_summary(
  p_client_id uuid,
  p_year int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vendor_id', v.id,
    'name', v.name,
    'total_paid', COALESCE(SUM(ABS(t.amount)), 0),
    'needs_1099', COALESCE(SUM(ABS(t.amount)), 0) >= 600,
    'w9_on_file', v.w9_on_file
  ) ORDER BY COALESCE(SUM(ABS(t.amount)), 0) DESC), '[]'::jsonb)
  INTO v_result
  FROM vendors v
  LEFT JOIN transactions t ON t.vendor_id = v.id
    AND t.is_business = true
    AND EXTRACT(YEAR FROM t.txn_date) = p_year
  WHERE v.client_id = p_client_id
    AND v.requires_1099 = true
  GROUP BY v.id, v.name, v.w9_on_file
  HAVING COALESCE(SUM(ABS(t.amount)), 0) > 0;

  RETURN jsonb_build_object('year', p_year, 'vendors', v_result);
END;
$$;

-- ============================================================
-- 7. Depreciation Schedule (straight-line)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_depreciation_schedule(
  p_client_id uuid,
  p_year int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_asset RECORD;
  v_depreciable_amount numeric;
  v_annual_depreciation numeric;
  v_years_owned numeric;
  v_accumulated_depreciation numeric;
  v_book_value numeric;
  v_purchase_year int;
  v_current_year_depreciation numeric;
  v_total_depreciation numeric;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  v_result := '[]'::jsonb;
  v_total_depreciation := 0;

  FOR v_asset IN
    SELECT * FROM fixed_assets WHERE client_id = p_client_id ORDER BY purchase_date
  LOOP
    v_depreciable_amount := v_asset.purchase_amount - v_asset.section_179_amount - v_asset.bonus_depreciation_amount;
    v_purchase_year := EXTRACT(YEAR FROM v_asset.purchase_date);

    -- Skip disposed assets before the report year
    IF v_asset.disposed_date IS NOT NULL AND EXTRACT(YEAR FROM v_asset.disposed_date) < p_year THEN
      CONTINUE;
    END IF;

    -- Straight-line annual depreciation
    IF v_asset.useful_life_years > 0 AND v_depreciable_amount > 0 THEN
      v_annual_depreciation := v_depreciable_amount / v_asset.useful_life_years;
    ELSE
      v_annual_depreciation := 0;
    END IF;

    -- Years owned up to and including the report year (cap at useful_life)
    v_years_owned := LEAST(p_year - v_purchase_year + 1, v_asset.useful_life_years);
    IF v_years_owned < 0 THEN v_years_owned := 0; END IF;

    -- Current year depreciation: full year if owned all year, partial if purchased mid-year
    v_current_year_depreciation := v_annual_depreciation;
    IF v_asset.disposed_date IS NOT NULL AND EXTRACT(YEAR FROM v_asset.disposed_date) = p_year THEN
      -- Partial year if disposed mid-year (simple: half-year convention)
      v_current_year_depreciation := v_annual_depreciation / 2;
    END IF;

    v_accumulated_depreciation := v_annual_depreciation * v_years_owned;
    IF v_accumulated_depreciation > v_depreciable_amount THEN
      v_accumulated_depreciation := v_depreciable_amount;
    END IF;

    v_book_value := v_asset.purchase_amount - v_accumulated_depreciation;
    v_total_depreciation := v_total_depreciation + v_current_year_depreciation;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'asset_id', v_asset.id,
      'description', v_asset.description,
      'purchase_date', v_asset.purchase_date,
      'purchase_amount', v_asset.purchase_amount,
      'section_179_amount', v_asset.section_179_amount,
      'bonus_depreciation_amount', v_asset.bonus_depreciation_amount,
      'useful_life_years', v_asset.useful_life_years,
      'annualDepreciation', ROUND(v_current_year_depreciation, 2),
      'accumulatedDepreciation', ROUND(v_accumulated_depreciation, 2),
      'bookValue', ROUND(v_book_value, 2)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'year', p_year,
    'assets', v_result,
    'total_depreciation_this_year', ROUND(v_total_depreciation, 2),
    'caveat', 'Straight-line calculation only — verify against IRS Pub. 946 MACRS tables before filing.'
  );
END;
$$;

-- ============================================================
-- 8. Loan Amortization Schedule
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_loan_amortization(
  p_loan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_schedule jsonb := '[]'::jsonb;
  v_monthly_rate numeric;
  v_monthly_payment numeric;
  v_balance numeric;
  v_principal numeric;
  v_interest numeric;
  v_payment_date date;
  v_i int;
BEGIN
  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'loan not found' USING ERRCODE = '404';
  END IF;

  IF NOT public.has_client_access(v_loan.client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  v_monthly_rate := v_loan.annual_interest_rate / 100 / 12;
  v_balance := v_loan.original_principal;

  -- Calculate fixed monthly payment using amortization formula
  IF v_monthly_rate > 0 THEN
    v_monthly_payment := v_loan.original_principal * (v_monthly_rate * POWER(1 + v_monthly_rate, v_loan.term_months)) / (POWER(1 + v_monthly_rate, v_loan.term_months) - 1);
  ELSE
    v_monthly_payment := v_loan.original_principal / v_loan.term_months;
  END IF;

  v_payment_date := v_loan.origination_date;

  FOR v_i IN 1..v_loan.term_months LOOP
    v_interest := v_balance * v_monthly_rate;
    v_principal := v_monthly_payment - v_interest;

    IF v_principal > v_balance THEN
      v_principal := v_balance;
      v_monthly_payment := v_principal + v_interest;
    END IF;

    v_balance := v_balance - v_principal;

    v_schedule := v_schedule || jsonb_build_array(jsonb_build_object(
      'payment_number', v_i,
      'date', v_payment_date,
      'payment_amount', ROUND(v_monthly_payment, 2),
      'principal', ROUND(v_principal, 2),
      'interest', ROUND(v_interest, 2),
      'remaining_balance', ROUND(GREATEST(v_balance, 0), 2)
    ));

    v_payment_date := v_payment_date + INTERVAL '1 month';
  END LOOP;

  RETURN jsonb_build_object('loan', to_jsonb(v_loan), 'schedule', v_schedule);
END;
$$;

-- ============================================================
-- 9. Payroll Summary
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_payroll_summary(
  p_client_id uuid,
  p_year int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_worker RECORD;
  v_gross numeric;
  v_net numeric;
  v_employer_tax numeric;
  v_total_gross numeric := 0;
  v_total_employer_tax numeric := 0;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  FOR v_worker IN
    SELECT * FROM workers WHERE client_id = p_client_id ORDER BY name
  LOOP
    IF v_worker.worker_type = '1099_contractor' THEN
      SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_gross
      FROM transactions
      WHERE vendor_id = v_worker.vendor_id
        AND is_business = true
        AND EXTRACT(YEAR FROM txn_date) = p_year;

      IF v_gross > 0 THEN
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'worker_id', v_worker.id,
          'name', v_worker.name,
          'worker_type', v_worker.worker_type,
          'gross_pay', v_gross,
          'employer_tax_cost', 0,
          'net_pay', v_gross
        ));
        v_total_gross := v_total_gross + v_gross;
      END IF;
    ELSE
      SELECT
        COALESCE(SUM(gross_pay), 0),
        COALESCE(SUM(net_pay), 0),
        COALESCE(SUM(employer_social_security + employer_medicare + employer_futa + employer_suta + other_employer_costs), 0)
      INTO v_gross, v_net, v_employer_tax
      FROM payroll_payments
      WHERE worker_id = v_worker.id
        AND EXTRACT(YEAR FROM pay_date) = p_year;

      IF v_gross > 0 THEN
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'worker_id', v_worker.id,
          'name', v_worker.name,
          'worker_type', v_worker.worker_type,
          'gross_pay', v_gross,
          'employer_tax_cost', v_employer_tax,
          'net_pay', v_net
        ));
        v_total_gross := v_total_gross + v_gross;
        v_total_employer_tax := v_total_employer_tax + v_employer_tax;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'year', p_year,
    'workers', v_result,
    'total_gross_pay', v_total_gross,
    'total_employer_tax_cost', v_total_employer_tax,
    'caveat', 'Withholding and employer tax figures are entered manually from your payroll processor — this report does not calculate them.'
  );
END;
$$;

-- ============================================================
-- 10. AR Aging
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_ar_aging(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_inv RECORD;
  v_days_past_due int;
  v_bucket text;
  v_today date := CURRENT_DATE;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  FOR v_inv IN
    SELECT * FROM ar_invoices WHERE client_id = p_client_id
  LOOP
    v_days_past_due := v_today - v_inv.due_date;
    IF v_days_past_due <= 0 THEN v_bucket := 'current';
    ELSIF v_days_past_due <= 30 THEN v_bucket := '1-30';
    ELSIF v_days_past_due <= 60 THEN v_bucket := '31-60';
    ELSIF v_days_past_due <= 90 THEN v_bucket := '61-90';
    ELSE v_bucket := '90+'; END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_inv.id,
      'label', v_inv.customer_name || CASE WHEN v_inv.invoice_number IS NOT NULL THEN ' (#' || v_inv.invoice_number || ')' ELSE '' END,
      'due_date', v_inv.due_date,
      'days_past_due', GREATEST(v_days_past_due, 0),
      'bucket', v_bucket,
      'outstanding', v_inv.amount - v_inv.amount_paid
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 11. AP Aging
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_ap_aging(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_bill RECORD;
  v_days_past_due int;
  v_bucket text;
  v_today date := CURRENT_DATE;
BEGIN
  IF NOT public.has_client_access(p_client_id) THEN
    RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE = '42501';
  END IF;

  FOR v_bill IN
    SELECT * FROM invoices WHERE client_id = p_client_id
      AND due_date IS NOT NULL AND amount IS NOT NULL
  LOOP
    v_days_past_due := v_today - v_bill.due_date;
    IF v_days_past_due <= 0 THEN v_bucket := 'current';
    ELSIF v_days_past_due <= 30 THEN v_bucket := '1-30';
    ELSIF v_days_past_due <= 60 THEN v_bucket := '31-60';
    ELSIF v_days_past_due <= 90 THEN v_bucket := '61-90';
    ELSE v_bucket := '90+'; END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_bill.id,
      'label', COALESCE(v_bill.vendor_name, 'Unknown vendor') || CASE WHEN v_bill.invoice_number IS NOT NULL THEN ' (#' || v_bill.invoice_number || ')' ELSE '' END,
      'due_date', v_bill.due_date,
      'days_past_due', GREATEST(v_days_past_due, 0),
      'bucket', v_bucket,
      'outstanding', v_bill.amount - COALESCE(v_bill.amount_paid, 0)
    ));
  END LOOP;

  RETURN v_result;
END;
$$;
