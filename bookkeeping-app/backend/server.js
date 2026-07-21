require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const customersRouter = require('./routes/customers');
const documentsRouter = require('./routes/documents');
const transactionsRouter = require('./routes/transactions');
const reportsRouter = require('./routes/reports');
const ownersRouter = require('./routes/owners');
const vendorsRouter = require('./routes/vendors');
const fixedAssetsRouter = require('./routes/fixedAssets');
const loansRouter = require('./routes/loans');
const workersRouter = require('./routes/workers');
const payrollPaymentsRouter = require('./routes/payrollPayments');
const journalEntriesRouter = require('./routes/journalEntries');
const apBillsRouter = require('./routes/apBills');
const arInvoicesRouter = require('./routes/arInvoices');
const { requireAuth } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start — this would make sessions forgeable.');
  process.exit(1);
}

const app = express();

// SECURITY: sets a battery of protective HTTP headers (no-sniff, frame
// options, HSTS, etc.) — table stakes for anything handling financial data.
app.use(helmet());

// SECURITY: CORS locked to your actual frontend origin, not '*'. Set
// FRONTEND_ORIGIN in .env to your deployed frontend URL.
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' })); // caps JSON body size — files go through multer separately

// SECURITY: general API rate limit, on top of the stricter login-specific
// limiter inside routes/auth.js. Slows down scraping/abuse of any endpoint.
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth routes are the only ones reachable without a token (you need login/register to get one)
app.use('/api/auth', authRouter);

// SECURITY: everything below this line requires a valid, non-expired JWT.
// This is the single choke point — if a route is added later and forgotten
// here, it's unreachable rather than accidentally exposed.
app.use('/api', requireAuth);

app.use('/api/clients', clientsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/owners', ownersRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/fixed-assets', fixedAssetsRouter);
app.use('/api/loans', loansRouter);
app.use('/api/workers', workersRouter);
app.use('/api/payroll-payments', payrollPaymentsRouter);
app.use('/api/journal-entries', journalEntriesRouter);
app.use('/api/ap-bills', apBillsRouter);
app.use('/api/ar-invoices', arInvoicesRouter);

// Generic error handler — never leak stack traces or internal details to the client
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Something went wrong processing that request.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bookkeeping backend running on port ${PORT}`));
