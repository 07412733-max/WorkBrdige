-- WorkBridge PostgreSQL schema. Safe to re-apply; this script does not drop data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('job_seeker', 'employer', 'admin')),
    full_name_enc BYTEA NOT NULL,
    consent_given BOOLEAN NOT NULL DEFAULT false,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255) NOT NULL,
    salary_range VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    seeker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_uuid VARCHAR(255) NOT NULL,
    cover_note BYTEA,
    applicant_phone_enc BYTEA,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewed', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_application UNIQUE (job_id, seeker_id)
);

-- Add encrypted columns to existing installations without dropping user data.
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name_enc BYTEA;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cover_note BYTEA;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_phone_enc BYTEA;

-- Legacy plaintext columns are cleared by backend/src/scripts/migrate-encryption.js.
-- Make them nullable so new encrypted-only records can be written after migration.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users'
          AND column_name = 'full_name'
    ) THEN
        ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'applications'
          AND column_name = 'cover_letter'
    ) THEN
        ALTER TABLE applications ALTER COLUMN cover_letter DROP NOT NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id TEXT,
    ip_address VARCHAR(45),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_hash CHAR(64),
    entry_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_listings_title ON job_listings USING BTREE (title);
CREATE INDEX IF NOT EXISTS idx_job_listings_location ON job_listings USING BTREE (location);
CREATE INDEX IF NOT EXISTS idx_job_listings_created_at ON job_listings USING BTREE (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_listings_status ON job_listings USING BTREE (status);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications USING BTREE (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_seeker_id ON applications USING BTREE (seeker_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens USING BTREE (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens USING BTREE (token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs USING BTREE (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs USING BTREE (action);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_listings_updated_at ON job_listings;
CREATE TRIGGER update_job_listings_updated_at BEFORE UPDATE ON job_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_applications_updated_at ON applications;
CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION append_audit_log_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    prior_hash CHAR(64);
BEGIN
    PERFORM pg_advisory_xact_lock(208144, 1);
    NEW.created_at := clock_timestamp();
    SELECT entry_hash INTO prior_hash
      FROM audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 1;
    NEW.previous_hash := prior_hash;
    NEW.entry_hash := encode(
      digest(
        convert_to(
          COALESCE(NEW.previous_hash, '') ||
          jsonb_build_object(
            'id', NEW.id,
            'action', NEW.action,
            'target_type', NEW.target_type,
            'target_id', NEW.target_id,
            'ip_address', NEW.ip_address,
            'metadata', NEW.metadata,
            'created_at', to_char(
              NEW.created_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_hash_chain ON audit_logs;
CREATE TRIGGER audit_logs_hash_chain BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION append_audit_log_hash();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workbridge_app') THEN
        CREATE ROLE workbridge_app NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO workbridge_app;
GRANT CONNECT ON DATABASE workbridge TO workbridge_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO workbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO workbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON job_listings TO workbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON applications TO workbridge_app;
REVOKE ALL PRIVILEGES ON audit_logs FROM workbridge_app;
GRANT SELECT, INSERT ON audit_logs TO workbridge_app;
REVOKE EXECUTE ON FUNCTION append_audit_log_hash() FROM PUBLIC;

COMMENT ON TABLE audit_logs IS 'Append-only audit events with a SHA-256 hash chain';
COMMENT ON COLUMN users.full_name_enc IS 'PGP-encrypted full name; decrypted only by authorized API queries';
COMMENT ON COLUMN applications.cover_note IS 'PGP-encrypted application cover note';
COMMENT ON COLUMN applications.applicant_phone_enc IS 'PGP-encrypted applicant phone';
COMMENT ON COLUMN audit_logs.entry_hash IS 'Hash chain digest covering this event and its predecessor';
