-- Enable Row Level Security on every table to block direct access via the
-- Supabase REST API using the exposed anon key. This app authenticates
-- users with its own JWT (users table + bcrypt + HS256 token), NOT Supabase
-- Auth, so there is no auth.uid() to bind policies to. The Express backend
-- connects as the postgres superuser (bypasses RLS) and remains the sole
-- authorized entry point. With RLS enabled and no permissive policies, the
-- anon role is denied all reads/writes on these tables.

ALTER TABLE IF EXISTS public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ar_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.capital_account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payroll_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ownership_history ENABLE ROW LEVEL SECURITY;
