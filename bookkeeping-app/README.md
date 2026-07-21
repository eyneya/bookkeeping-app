# Bookkeeping Processor

Turns photographed/scanned bank statements and invoices into structured
transactions, a review queue for categorizing (including flagging co-mingled
personal vs. business spend), and P&L / Balance Sheet / General Ledger
reports — across single-member LLCs, partnerships, S-corps, and C-corps,
including clients who own more than one business.

**Read SECURITY.md before using this with real client data.** It documents
what's actually implemented (auth, rate limiting, audit logging, file
validation) vs. what you still need to add (HTTPS termination, backups,
MFA, etc.) before this is production-ready for sensitive financial data.

## The data model

- **Client** = a real person (your tax client). Their personal bank
  statements/receipts upload once into a shared pool that isn't tied to any
  one business.
- **Business** = an entity you file taxes for (SMLLC, partnership, S-corp,
  C-corp). A client can own or co-own multiple businesses.
- **Owner** = the link between a client and a business, with an ownership %
  specific to that business (the same person can have different percentages
  in different businesses they're part of).

This is what makes "same person, multiple businesses, same bank statement"
work: the personal transaction pool belongs to the client, not to one
business, so you can open a second business for the same person and see —
and claim — whatever's left over from their statements.

## How it works end to end

1. **Business documents**: upload a business's own bank statements/invoices
   → extracted straight into that business's ledger.
2. **Personal documents**: from the Owners tab, open a specific owner's
   "personal tier" and upload their own bank statements/receipts →
   extracted into their shared personal pool (not yet tied to any business).
3. **Categorize**: business transactions get assigned to a chart-of-accounts
   account and flagged business/personal; personal transactions get a
   free-text category for the client's own records.
4. **Cross-reference**: for any personal transaction that was actually a
   business purchase, "Flag as business expense" — picks which business and
   which expense account. This atomically creates a real business expense
   (reduces that business's taxable income) AND a capital contribution for
   that owner (correct K-1 basis), and marks the transaction claimed so it
   shows grayed out if you check this same person's pool from a different
   business. Made a mistake? **Unflag** reverses both parts exactly.
5. **Report**: P&L, Balance Sheet, General Ledger, Capital Accounts, and
   Personal Statement reports pull from the categorized data — viewable in
   the UI or exported as a full Excel workbook, downloaded directly or
   pushed to the business's Google Drive/OneDrive folder.

## Entity-specific accounting

The chart of accounts a new business gets is chosen automatically from its
`entity_type`:

| Entity type | What's different |
|---|---|
| Single-Member LLC | Owner's Draw / Owner's Contribution, no per-owner allocation (Schedule C filer) |
| Partnership | Partner Contributions/Distributions, plus per-partner capital account tracking |
| S-Corp | Shareholder Contributions/Distributions, **Officer Compensation kept separate from Payroll** (a real IRS scrutiny point) |
| C-Corp | Common Stock, Additional Paid-In Capital, Dividends Paid — no per-shareholder allocation, since C-corp income is taxed at the entity level |

The **Capital Accounts report** (partnership/S-corp only) calculates each
owner's allocated share of net income (ownership % × net income) alongside
their contributions/distributions, for an ending balance — the data K-1 prep
needs. The app warns if ownership percentages for a business don't total 100%.

## Stack (chosen for low cost at ~500 docs/month)

| Piece | Choice | Why |
|---|---|---|
| Extraction | Claude API (Haiku 4.5) | One call does OCR + structuring; no separate OCR bill |
| Database | Postgres (Supabase free tier) | Free up to 500MB; real SQL for reporting |
| Backend | Node/Express | — |
| Frontend | React + Vite | Fast dev, tiny build, free static hosting |
| Hosting | Render/Railway (backend) + Vercel/Netlify (frontend), free tiers | Scales to ~$0 at low traffic |
| File storage | **Your choice per business**: Google Drive or Microsoft OneDrive/SharePoint | Mix providers across your client base |
| Deliverable format | Excel (.xlsx) via `exceljs` | Downloaded directly or pushed to the business's storage folder |

**Estimated monthly cost at 500 docs/month:** roughly $5–15 in Claude API
calls, $0 on free-tier hosting until you scale well past this volume.

## Setup

### 1. Database
- Create a free Supabase project (or any Postgres instance)
- Run `backend/db/schema.sql` against it
- Copy the connection string into `backend/.env` as `DATABASE_URL`

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY, and JWT_SECRET (openssl rand -hex 32)
npm install
npm run dev            # runs on http://localhost:3001
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev             # runs on http://localhost:5173
```
Create `frontend/.env` with `VITE_API_BASE=http://localhost:3001` if your
backend runs elsewhere.

### 4. First login
There's no seed account. The first person to register becomes admin
automatically — use "First time? Create the admin account" on the login
screen. Every registration after that requires an existing admin's token.

## Storage provider choice (Google Drive vs. Microsoft OneDrive/SharePoint)

Postgres is always the source of truth — storage is only for original
scanned documents and exported Excel workbooks, never live data. Each
business has its own `storage_provider`, so you can mix providers across
your client base. Set `DEFAULT_STORAGE_PROVIDER` in `.env`, and override per
business when creating it.

- **Google Drive** needs a service account — see `.env.example`.
- **Microsoft OneDrive/SharePoint** needs an Azure AD app registration with
  `Files.ReadWrite.All` — see comments at the top of
  `backend/services/storage/oneDriveAdapter.js`.

## Additional tracking: 1099s, fixed assets, loans, and payroll

- **Vendors tab**: track vendors per business, flag which require a 1099,
  mark W-9 status. Assign a vendor to any transaction in the Review tab —
  the **1099 Summary report** (`/api/reports/1099-summary`) totals payments
  per vendor for a year and flags who crossed the $600 threshold without a
  W-9 on file.
- **Assets tab**: a fixed asset register with a straight-line depreciation
  engine (mid-month proration, Section 179 and bonus depreciation as
  immediate expensing). **This is a working baseline, not authoritative
  MACRS** — verify final depreciation figures against IRS Pub. 946 or your
  tax software before filing.
- **Loans tab**: a loan register with standard fixed-rate amortization
  (equal payment, principal/interest split calculated per period). Doesn't
  handle variable rates, balloons, or interest-only periods.
- **Payroll tab**: add a worker as a **1099 Contractor** (auto-creates/links
  a vendor so their payments flow through the 1099 tracking above, not a
  separate table), **W-2 Hourly**, or **W-2 Salary** (both get pay-run
  tracking). **This is a payroll register, not a payroll tax engine** — it
  does not calculate withholding, FICA, or FUTA/SUTA; those figures come
  from your payroll processor's report and get entered per pay run.
- **Staff tab** (admin only): grant or revoke a specific preparer's access
  to a specific business. Preparers only see businesses they've been
  explicitly granted; admins always see everything. The preparer who
  creates a business or a client (person) automatically gets access to it.

All of the above get their own tab in the Excel export when a business
actually has vendors/assets/loans/workers on file (empty tabs are skipped).

## AI provider choice (Claude vs. ChatGPT/OpenAI)

Document extraction is behind the same kind of swappable adapter as
storage — `backend/services/aiExtraction/`, with `claudeProvider.js` and
`openaiProvider.js` both implementing `extractDocument(fileBuffer, mediaType, docType)`.

- Set `AI_PROVIDER=claude` or `AI_PROVIDER=openai` in `.env` for your default.
- Every upload can also override it — the dropdown in the Upload tab and in
  each owner's personal tier lets you pick per-document.

**One real limitation to know about**: OpenAI's vision API only accepts
image files (JPG/PNG), not PDFs directly — Claude's API accepts PDFs
natively. If you upload a PDF with the OpenAI provider selected, it fails
with a clear error telling you to either switch that document to Claude or
convert it to an image first. If most of your source documents are PDFs,
Claude is the more capable default; OpenAI is there as an option/comparison,
not necessarily a full replacement.

You only need whichever API key(s) you actually use — set just
`ANTHROPIC_API_KEY` if you're staying on Claude, or add `OPENAI_API_KEY` too
if you want the option.

## Operational features: editing, search, period locking

- **Edit/delete**: business transactions can be edited (PATCH) or deleted
  (DELETE) directly from the Review tab, with guardrails — you can't delete
  a transaction that's flagged as a business expense or part of a journal
  entry without undoing that link first. Documents can also be deleted
  (removes their transactions too), refusing if any are flagged or locked.
- **Search and pagination**: the Review tab and document listing endpoints
  support `q` (search descriptions/filenames) and `limit`/`offset`
  pagination, so this stays usable well past 500 documents/month instead of
  rendering one giant unfiltered table.
- **Period locking** (admin only): `PATCH /api/clients/:id/lock-period`
  with a `locked_through_date` prevents any transaction, journal entry, or
  flag/unflag action dated on or before that date from being created,
  edited, or deleted — use this once you've filed a return for a period.
  `DELETE` the same endpoint to unlock if something genuinely needs fixing.
- **No more browser prompt()/confirm()/alert() dialogs** for real actions —
  capital account entries, flagging/unflagging, asset disposal, and staff
  revocation all use proper modal dialogs (`components/Modal.jsx`,
  `components/ConfirmDialog.jsx`) instead.

## What's intentionally left for you to wire up

- **Original document storage**: uploads currently only pass through memory
  for Claude extraction — add an `adapter.uploadFile()` call in
  `backend/routes/documents.js` to persist the original scan to Drive/OneDrive.
- **Confidence-based re-extraction**: extraction flags `confidence: "low"`
  fields but doesn't auto-retry with a stronger model — worth adding once
  you see how often Haiku struggles with real scan quality.
- Everything listed under "You still need to do" in **SECURITY.md** —
  HTTPS termination, backups, MFA, session revocation, and a data retention
  policy. (Per-client staff permissions ARE implemented — see the Staff tab
  and `middleware/clientAccess.js`.)
