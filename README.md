# WorkBridge

WorkBridge is a React/Vite job board with an Express API and PostgreSQL. Security controls are applied at the browser, API, database, and file-storage layers. The controls below are implementation details, not a claim that the system is invulnerable or certified compliant.

## Security controls

- **CSRF:** Double-submit `wb_csrf` cookie (`SameSite=Strict`) plus matching `X-CSRF-Token` header on every `POST`, `PUT`, `PATCH`, and `DELETE` under `/api`.
- **Transport:** Production HTTP requests redirect to HTTPS. Helmet sets HSTS with a one-year max age, `includeSubDomains`, and `preload`. PostgreSQL TLS validates certificates in production; `DB_SSL=true` enables it outside production.
- **Rate limiting:** Login, registration, and refresh endpoints are limited to 5 requests per 10 seconds. Blocks return `429` and are audited.
- **Audit trail:** Admin-only audit view and API; append-only database permissions for the runtime role; a SHA-256 hash chain covers event action, target, IP, metadata, and timestamp.
- **Data at rest:** PostgreSQL `pgcrypto` encrypts profile names, cover notes, and optional applicant phone numbers. Resume files use AES-256-GCM with a random 12-byte IV and authentication tag.
- **Authentication and authorization:** Bcrypt password hashes, short-lived JWT access tokens, rotating refresh tokens in `HttpOnly` cookies, server-side role checks, and owner checks for employer operations.
- **Other protections:** Zod input validation, parameterized SQL, explicit CORS origin allowlist, Helmet headers, React escaping and DOMPurify for rich job descriptions, and PDF signature/size checks.

## Setup

Requirements: Node.js 18+, PostgreSQL 14+, and npm.

### 1. Configure independent secrets

Copy `backend/.env.example` to `backend/.env`. Generate three independent values (run the command separately for each key):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set the generated values as `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `DB_ENCRYPTION_KEY`. Generate another 32-byte value for `FILE_ENCRYPTION_KEY`; it may be stored as base64 or as 64 hex characters. Do not reuse any key, commit `.env`, or place secrets in `VITE_*` variables.

`SSL_KEY_PATH` and `SSL_CERT_PATH` are optional for local HTTPS. Set both to a PEM private key and matching certificate; if omitted in development, the API serves HTTP. Production deployments should terminate TLS at a trusted proxy/load balancer or provide both paths. If TLS terminates at a proxy, forward `X-Forwarded-Proto: https`.

Set `DB_SSL=true` for a TLS-validated database connection, including non-production environments. Production always requires validated PostgreSQL TLS.

### 2. Create and migrate the database

`database/schema.sql` is safe to re-apply and no longer drops application data. Back up the database before applying schema changes. The schema creates a `workbridge_app` role without a login password and grants it only required table privileges, including `SELECT`/`INSERT` (not `UPDATE`/`DELETE`) for `audit_logs`.

```powershell
psql -U postgres -c "CREATE DATABASE workbridge;"
psql -U postgres -d workbridge -v ON_ERROR_STOP=1 -f database/schema.sql
psql -U postgres -d workbridge
```

In the `psql` prompt, set a unique runtime-role password:

```sql
ALTER ROLE workbridge_app LOGIN;
\password workbridge_app
```

For an existing installation, run the schema first, then run the legacy encryption migration as a database owner (not as `workbridge_app`). This encrypts old `users.full_name` and `applications.cover_letter` values before clearing their plaintext columns, and encrypts any existing `backend/uploads/*.pdf` files in place. Keep a verified backup and retain the same encryption keys for as long as data encrypted with them is needed.

```powershell
Set-Location backend
$env:DATABASE_URL = "postgres://migration_owner:REPLACE_ME@localhost:5432/workbridge"
npm run migrate:encryption
```

After migration, point the runtime `DATABASE_URL` in `backend/.env` to `workbridge_app`. Do not run the migration under the application role: it performs schema/data migration and must be privileged.

### 3. Install and start

```powershell
Set-Location backend
npm install
npm run dev
```

In another terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

Create the initial admin through a controlled database provisioning process; the schema does not seed a known default admin password.

## Verification commands

The commands below assume the backend is running at `http://localhost:3000`, the database schema and encryption migration have been applied, and environment values are configured.

### CSRF rejection and automatic browser header

First obtain a CSRF cookie. Then send a mutating request without the header; it must return `403`:

```powershell
curl.exe -i -c cookies.txt http://localhost:3000/api/auth/csrf-token
curl.exe -i -b cookies.txt -X POST http://localhost:3000/api/jobs/employer/listings `
  -H "Content-Type: application/json" -d "{}"
```

For a valid browser request, the Axios client fetches the token when necessary and attaches `X-CSRF-Token` automatically. The server requires the header to be a 64-character hex token and compares it to `wb_csrf` using `crypto.timingSafeEqual`.

### Authentication rate limit

Use an invalid login so responses do not rotate the CSRF cookie. The first five requests should return `401`; the sixth within 10 seconds should return `429`:

```powershell
$csrf = (curl.exe -s -c cookies.txt http://localhost:3000/api/auth/csrf-token | ConvertFrom-Json).csrfToken
for ($i = 1; $i -le 6; $i++) {
  curl.exe -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/login `
    -H "Content-Type: application/json" `
    -H "X-CSRF-Token: $csrf" `
    -d '{"email":"limit-test@example.invalid","password":"not-a-real-password"}'
}
```

The 429 body is `{"error":"Too many authentication attempts. Try again in 10 seconds."}`. The limit event records the IP and endpoint, not credentials or tokens.

To confirm profile names are written as PostgreSQL `BYTEA`, register a disposable test account with a valid CSRF token:

```powershell
$csrf = (curl.exe -s -c register-cookies.txt http://localhost:3000/api/auth/csrf-token | ConvertFrom-Json).csrfToken
curl.exe -i -b register-cookies.txt -c register-cookies.txt `
  -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" `
  -d '{"email":"encrypted-test@example.invalid","password":"SecurePass123!","role":"job_seeker","full_name":"Encrypted Test","consent_given":true}' `
  http://localhost:3000/api/auth/register
```

### Audit log and append-only application privileges

Trigger audit events by making a login attempt or by submitting a CSRF-invalid request, then inspect the database:

```powershell
psql "$env:DATABASE_URL" -c "SELECT action, target_type, target_id, created_at, previous_hash, entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 10;"
```

Using the `workbridge_app` connection, this `UPDATE` must fail with a permission error:

```powershell
psql "postgres://workbridge_app:REPLACE_ME@localhost:5432/workbridge" `
  -c "UPDATE audit_logs SET action = 'CHANGED' WHERE id = (SELECT id FROM audit_logs LIMIT 1);"
```

The admin UI exposes the records under **Audit Logs**; `GET /api/admin/audit-logs` requires an admin token.

### PostgreSQL PII encryption

Register a test user through the UI/API, then verify the encrypted `BYTEA` is present and decrypts only with the configured key. This PowerShell example passes the key as a psql variable:

```powershell
psql "$env:DATABASE_URL" -v encryption_key="$env:DB_ENCRYPTION_KEY" `
  -c "SELECT full_name_enc IS NOT NULL AS encrypted, encode(full_name_enc, 'hex') AS ciphertext, pgp_sym_decrypt(full_name_enc, :'encryption_key') AS plaintext FROM users WHERE email = 'encrypted-test@example.invalid';"
```

`applications.cover_note` and `applications.applicant_phone_enc` are also `BYTEA` values written with `pgp_sym_encrypt`; authorized API queries decrypt them using `DB_ENCRYPTION_KEY`.

### Encrypted resumes and transport

After a job seeker submits a PDF, only `<uuid>.pdf.enc` should be stored in `backend/uploads/`; authorized employer downloads decrypt it in memory after the job-ownership check. In production, verify the HTTP redirect and HSTS header:

```powershell
curl.exe -i http://localhost:3000/health
curl.exe -k -I https://localhost:3000/health
```

The first request should return `301` to HTTPS when `NODE_ENV=production`; the HTTPS response should include `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`. `-k` is only for a local self-signed certificate; omit it when testing a trusted certificate.

To verify resume encryption, sign in as a job seeker, obtain an open `JOB_ID`, and upload a real test PDF. A registered session's access and CSRF tokens are returned by the auth API; login and registration rotate the CSRF token.

```powershell
$csrf = (curl.exe -s -c seeker-cookies.txt http://localhost:3000/api/auth/csrf-token | ConvertFrom-Json).csrfToken
$login = curl.exe -s -b seeker-cookies.txt -c seeker-cookies.txt `
  -H "X-CSRF-Token: $csrf" -H "Content-Type: application/json" `
  -d '{"email":"seeker@example.invalid","password":"SecurePass123!"}' `
  http://localhost:3000/api/auth/login | ConvertFrom-Json
curl.exe -i -b seeker-cookies.txt -H "Authorization: Bearer $($login.accessToken)" `
  -H "X-CSRF-Token: $($login.csrfToken)" `
  -F "resume=@C:\path\to\test-resume.pdf;type=application/pdf" `
  -F "cover_letter=Test application" -F "applicant_phone=5550100" `
  http://localhost:3000/api/jobs/JOB_ID/apply
Get-ChildItem backend\uploads -Filter '*.pdf.enc'
```

## Project layout

- `backend/src/server.js` — Express middleware, transport enforcement, CORS, and rate limits.
- `backend/src/middleware/` — authentication, CSRF, validation, and encrypted PDF handling.
- `backend/src/services/auditLogger.js` — reusable append-only audit writer.
- `backend/src/routes/` — auth, job, and admin APIs.
- `database/schema.sql` — repeatable schema and application-role grants.
- `backend/src/scripts/migrate-encryption.js` — one-time safe migration for legacy PII and resumes.
- `frontend/src/api/client.js` — in-memory access token and automatic CSRF header.

## Operational notes

- Keep `DB_ENCRYPTION_KEY` and `FILE_ENCRYPTION_KEY` backed up separately from the database; losing either makes corresponding data unrecoverable. Rotate via a planned decrypt/re-encrypt migration.
- Use a privileged database account only for schema/migration work. The runtime account must remain `workbridge_app`.
- Configure production HTTPS termination and trusted proxy/network boundaries. The application cannot compensate for a misconfigured proxy or insecure host.
- Audit logs may contain IP addresses and identifiers; restrict access and apply an appropriate retention policy.
- Run dependency, configuration, and application security reviews before production deployment.
