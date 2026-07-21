const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Login attempts are rate-limited hard — this is the #1 target for
// credential-stuffing against an app holding client financial data.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
  const user = result.rows[0];

  // Same error whether the email doesn't exist or the password is wrong —
  // don't leak which one it was.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

  const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '12h',
  });

  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

// Creating new preparer accounts requires an existing admin to be logged in —
// EXCEPT for the very first user ever created (bootstrap case).
router.post('/register', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }

  const existingCount = await pool.query('SELECT COUNT(*) FROM users');
  const isFirstUser = Number(existingCount.rows[0].count) === 0;

  if (!isFirstUser) {
    // Any registration after the first user requires a valid admin token
    return requireAuth(req, res, () =>
      requireAdmin(req, res, () => createUser(req, res, role || 'preparer'))
    );
  }

  // First user ever becomes admin automatically
  return createUser(req, res, 'admin');
});

async function createUser(req, res, role) {
  const { email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at`,
      [email.toLowerCase(), passwordHash, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    res.status(500).json({ error: err.message });
  }
}

// List all user accounts (admin only) — used by the staff access
// management UI to pick who to grant a business's access to.
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query('SELECT id, email, role, is_active, created_at, last_login_at FROM users ORDER BY email');
  res.json(result.rows);
});

module.exports = router;
