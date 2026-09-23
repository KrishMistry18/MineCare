-- ====================================================================
-- MINECARE AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC) MIGRATION
-- ====================================================================

-- 1. USER PROFILES TABLE (Linked to Supabase Auth auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'WORKER' CHECK (role IN ('ADMIN', 'SUPERVISOR', 'WORKER')),
    worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_auth_id ON profiles (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_worker ON profiles (worker_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — LEAST-PRIVILEGE MODEL
-- ====================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION auth.current_profile_role()
RETURNS TEXT AS $$
    SELECT role FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth.current_worker_id()
RETURNS TEXT AS $$
    SELECT worker_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- --------------------------------------------------------------------
-- PROFILES POLICIES
-- --------------------------------------------------------------------
-- Admins can view and manage all profiles
CREATE POLICY "Admins full access to profiles"
    ON profiles FOR ALL
    USING (auth.current_profile_role() = 'ADMIN');

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = auth_user_id);

-- Supervisors can read profiles
CREATE POLICY "Supervisors read profiles"
    ON profiles FOR SELECT
    USING (auth.current_profile_role() = 'SUPERVISOR');

-- --------------------------------------------------------------------
-- REVISE OPERATIONAL TABLE POLICIES (DROP OVERLY PERMISSIVE PHASE 2 POLICIES)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read workers" ON workers;
DROP POLICY IF EXISTS "Public read helmets" ON helmets;
DROP POLICY IF EXISTS "Public read zone_assignments" ON zone_assignments;
DROP POLICY IF EXISTS "Public read telemetry" ON telemetry;
DROP POLICY IF EXISTS "Public read alerts" ON alerts;

-- --------------------------------------------------------------------
-- WORKERS POLICIES
-- --------------------------------------------------------------------
-- Admins and Supervisors can read all workers
CREATE POLICY "Admins and Supervisors read workers"
    ON workers FOR SELECT
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can read only their own record
CREATE POLICY "Workers read own worker record"
    ON workers FOR SELECT
    USING (auth.current_profile_role() = 'WORKER' AND id = auth.current_worker_id());

-- Admins can insert/update workers
CREATE POLICY "Admins write workers"
    ON workers FOR ALL
    USING (auth.current_profile_role() = 'ADMIN');

-- --------------------------------------------------------------------
-- HELMETS POLICIES
-- --------------------------------------------------------------------
-- Admins and Supervisors can read all helmets
CREATE POLICY "Admins and Supervisors read helmets"
    ON helmets FOR SELECT
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can read only their assigned helmet
CREATE POLICY "Workers read assigned helmet"
    ON helmets FOR SELECT
    USING (
        auth.current_profile_role() = 'WORKER'
        AND worker_id = auth.current_worker_id()
    );

-- Admins can manage helmets
CREATE POLICY "Admins manage helmets"
    ON helmets FOR ALL
    USING (auth.current_profile_role() = 'ADMIN');

-- --------------------------------------------------------------------
-- ZONE ASSIGNMENTS POLICIES
-- --------------------------------------------------------------------
-- Admins and Supervisors can read all zone assignments
CREATE POLICY "Admins and Supervisors read zone assignments"
    ON zone_assignments FOR SELECT
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can read their own assignments
CREATE POLICY "Workers read own zone assignments"
    ON zone_assignments FOR SELECT
    USING (
        auth.current_profile_role() = 'WORKER'
        AND worker_id = auth.current_worker_id()
    );

-- Supervisors and Admins can create/update assignments
CREATE POLICY "Supervisors and Admins manage zone assignments"
    ON zone_assignments FOR ALL
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can insert their own check-in assignment
CREATE POLICY "Workers self check-in"
    ON zone_assignments FOR INSERT
    WITH CHECK (
        auth.current_profile_role() = 'WORKER'
        AND worker_id = auth.current_worker_id()
    );

-- --------------------------------------------------------------------
-- TELEMETRY POLICIES
-- --------------------------------------------------------------------
-- Admins and Supervisors read all telemetry
CREATE POLICY "Admins and Supervisors read telemetry"
    ON telemetry FOR SELECT
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can read only their assigned helmet's telemetry
CREATE POLICY "Workers read assigned helmet telemetry"
    ON telemetry FOR SELECT
    USING (
        auth.current_profile_role() = 'WORKER'
        AND helmet_id IN (SELECT id FROM helmets WHERE worker_id = auth.current_worker_id())
    );

-- --------------------------------------------------------------------
-- ALERTS POLICIES
-- --------------------------------------------------------------------
-- Admins and Supervisors read and manage all alerts
CREATE POLICY "Admins and Supervisors read alerts"
    ON alerts FOR SELECT
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

CREATE POLICY "Admins and Supervisors update alerts"
    ON alerts FOR UPDATE
    USING (auth.current_profile_role() IN ('ADMIN', 'SUPERVISOR'));

-- Workers can read only alerts pertaining to themselves/their helmet
CREATE POLICY "Workers read own alerts"
    ON alerts FOR SELECT
    USING (
        auth.current_profile_role() = 'WORKER'
        AND worker_id = auth.current_worker_id()
    );

-- --------------------------------------------------------------------
-- AUDIT LOGS POLICIES
-- --------------------------------------------------------------------
-- Admins can read all audit logs
CREATE POLICY "Admins read audit logs"
    ON audit_logs FOR SELECT
    USING (auth.current_profile_role() = 'ADMIN');

-- Authenticated users or server can insert audit logs
CREATE POLICY "Authenticated insert audit logs"
    ON audit_logs FOR INSERT
    WITH CHECK (auth.role() = 'authenticated' OR auth.current_profile_role() IS NOT NULL);
