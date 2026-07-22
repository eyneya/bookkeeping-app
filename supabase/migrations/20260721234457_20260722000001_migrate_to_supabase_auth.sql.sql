/*
# Migrate to Supabase Auth

## Summary
Replaces the custom `public.users` table (bcrypt-hashed passwords, custom JWT)
with Supabase's built-in `auth.users` table and a new `public.profiles` table
that stores app-specific user metadata (role, is_active). All foreign keys
that previously pointed to `public.users(id)` are repointed to
`auth.users(id)`. Helper SQL functions (`is_admin()`, `has_client_access()`,
`has_customer_access()`) centralize access-control logic so RLS policies can
call them without duplicating JOINs. A trigger auto-creates a `profiles` row
whenever a new auth user signs up, and the first user to sign up is
automatically assigned the `admin` role (bootstrapping the app).

## New Tables
- `public.profiles`
  - `id` (uuid, PK, references `auth.users(id)` ON DELETE CASCADE)
  - `email` (text, not null — copied from auth.users for convenience)
  - `role` (text, not null, default 'preparer') — 'admin' or 'preparer'
  - `is_active` (boolean, not null, default true)
  - `created_at` (timestamptz, default now())
  - `last_login_at` (timestamptz, nullable)

## Modified Tables
- `audit_log`: `user_id` FK repointed from `public.users(id)` to
  `auth.users(id)` ON DELETE SET NULL
- `customers`: `created_by` FK repointed from `public.users(id)` to
  `auth.users(id)` ON DELETE SET NULL
- `journal_entries`: `created_by` FK repointed from `public.users(id)` to
  `auth.users(id)` ON DELETE SET NULL
- `user_client_access`: `user_id` FK repointed from `public.users(id)` to
  `auth.users(id)` ON DELETE CASCADE; `granted_by` FK repointed from
  `public.users(id)` to `auth.users(id)` ON DELETE SET NULL

## Dropped Tables
- `public.users` — replaced by `auth.users` + `public.profiles`. No data to
  migrate (the table had zero rows).

## New Functions
- `public.is_admin()` → boolean
- `public.has_client_access(client_uuid uuid)` → boolean
- `public.has_customer_access(customer_uuid uuid)` → boolean
- `public.handle_new_user()` → trigger function

## New Triggers
- `on_auth_user_created`: AFTER INSERT ON `auth.users`

## Security
- RLS enabled on `profiles` with owner-scoped + admin policies.
- The old `public.users` table is dropped.

## Important Notes
1. The first user to sign up via Supabase Auth automatically becomes admin.
2. Helper functions are SECURITY DEFINER so they can read profiles/access
   tables regardless of caller RLS context.
3. No data migration needed — `public.users` had 0 rows.
*/

-- ============================================================
-- 1. Create profiles table FIRST (functions will reference it)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'preparer',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Repoint foreign keys from public.users to auth.users
--    (Done before dropping users table so constraints transfer cleanly)
-- ============================================================

-- audit_log.user_id
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- customers.created_by
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS fk_customers_created_by;
ALTER TABLE public.customers
  ADD CONSTRAINT fk_customers_created_by
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- journal_entries.created_by
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS fk_journal_entries_created_by;
ALTER TABLE public.journal_entries
  ADD CONSTRAINT fk_journal_entries_created_by
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- user_client_access.user_id
ALTER TABLE public.user_client_access DROP CONSTRAINT IF EXISTS user_client_access_user_id_fkey;
ALTER TABLE public.user_client_access
  ADD CONSTRAINT user_client_access_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_client_access.granted_by
ALTER TABLE public.user_client_access DROP CONSTRAINT IF EXISTS user_client_access_granted_by_fkey;
ALTER TABLE public.user_client_access
  ADD CONSTRAINT user_client_access_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 3. Drop the old users table
-- ============================================================
DROP TABLE IF EXISTS public.users CASCADE;

-- ============================================================
-- 4. Helper functions for access control (SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_client_access(client_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.user_client_access
    WHERE user_id = auth.uid() AND client_id = client_uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.has_customer_access(customer_uuid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.customers c
    LEFT JOIN public.owners o ON o.customer_id = c.id
    LEFT JOIN public.user_client_access uca ON uca.client_id = o.client_id AND uca.user_id = auth.uid()
    WHERE c.id = customer_uuid AND (c.created_by = auth.uid() OR uca.user_id = auth.uid())
    LIMIT 1
  );
$$;

-- ============================================================
-- 5. Auto-create profile on signup; first user becomes admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count integer;
  assigned_role text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  assigned_role := CASE WHEN user_count = 0 THEN 'admin' ELSE 'preparer' END;

  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, assigned_role);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 6. Profiles RLS policies
-- ============================================================
DROP POLICY IF EXISTS "select_own_or_all_profiles" ON public.profiles;
CREATE POLICY "select_own_or_all_profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
