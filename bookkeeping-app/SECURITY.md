# Security

This app handles sensitive client financial data — bank transactions,
potentially SSNs/EINs inside scanned documents, business financials. Tax
preparers are also subject to specific regulatory expectations here (IRS
Publication 4557, "Safeguarding Taxpayer Data," and the FTC Safeguards Rule
for financial institutions, which covers paid tax preparers). This document
is honest about what's implemented vs. what you still need to do before
this touches real client data in production.

## Implemented

- **Authentication**: every API route except `/api/auth/*` and `/api/health`
  requires a valid JWT (`middleware/auth.js`). Tokens expire after 12 hours.
- **Password storage**: bcrypt with a cost factor of 12 (`routes/auth.js`) —
  never plaintext, never reversible.
- **Rate limiting**: login attempts are capped at 10 per 15 minutes per IP
  (the most common attack surface for an app like this); the whole API is
  additionally capped at 300 requests/15min per IP.
- **Security headers**: `helmet()` is applied globally (HSTS, no-sniff,
  frame options, etc.).
- **CORS lockdown**: restricted to `FRONTEND_ORIGIN` from your `.env`, not `*`.
- **SQL injection protection**: every query in this codebase uses
  parameterized queries (`$1, $2...`) — never string-concatenated SQL.
- **File upload validation**: uploads are restricted to an allowlist of MIME
  types (JPG/PNG/PDF), capped at 15MB, and filenames are sanitized to strip
  path components before storage.
- **Audit logging**: every document upload, transaction categorization, and
  flag/unflag action is recorded in `audit_log` with who did it, when, and
  from what IP (`middleware/auditLog.js`). Query this table if you ever need
  to answer "who touched this client's data."
- **Least-exposure error handling**: the global error handler in `server.js`
  never leaks stack traces or internal error details to the client.
- **No secrets in code**: API keys, DB credentials, and the JWT signing
  secret all come from environment variables, never hardcoded.
- **Per-client access control**: preparers only see businesses they've been
  explicitly granted access to (`user_client_access` table,
  `middleware/clientAccess.js`); admins see everything. Manage grants from
  the Staff tab (admin only) or `POST/DELETE /api/clients/:id/staff`.

## You still need to do before production use with real client data

- **HTTPS/TLS**: this app assumes a reverse proxy or hosting platform
  (Render, Railway, Vercel, etc.) terminates TLS in front of it. Never run
  this over plain HTTP once it's reachable outside localhost.
- **Encryption at rest**: Supabase and Google Drive/OneDrive encrypt data at
  rest by default, but confirm this for whichever specific plan/tier you're
  on — free tiers sometimes differ from paid ones.
- **Database access control**: use a dedicated, least-privilege Postgres
  user for this app (not a superuser), and restrict network access to your
  database (Supabase lets you allowlist IPs).
- **Backups**: set up automated backups for your Postgres database. Losing
  a client's entire bookkeeping history is a business-ending failure mode
  worth protecting against explicitly.
- **Multi-factor authentication**: the current login is email + password
  only. If you or staff access this from shared or less-trusted networks,
  add MFA (e.g. TOTP via a library like `otplib`) before relying on this
  for real client data.
- **Session/token revocation**: JWTs here can't be revoked before they
  expire (12h). If a device is lost/stolen, that token is valid until it
  naturally expires. A production-hardened version would check a
  denylist/session table on each request.
- **Data retention & deletion policy**: decide how long you keep client
  documents/data after an engagement ends, and implement deletion — both a
  security practice and often a contractual/regulatory expectation.
- **Incident response plan**: know in advance who to notify and what steps
  to take if a breach is suspected — the FTC Safeguards Rule requires
  preparers to have a written incident response plan.
- **Dependency updates**: keep `npm audit` clean and dependencies current —
  this app pulls in `googleapis`, `@azure/msal-node`, `pg`, and others that
  will need periodic security updates.

## Reporting a concern

If you find a security issue in this generated codebase, the right first
step is a manual code review with someone who has security experience
before this goes anywhere near production client data — this was built
quickly and should get an independent security pass, not just this document's
self-assessment.
