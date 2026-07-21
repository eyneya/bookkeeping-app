/**
 * requireAuth — verifies a JWT on every protected request and attaches
 * req.user. This app handles sensitive client financial data (bank
 * transactions, SSNs may appear in extracted documents, etc.), so nothing
 * should be reachable without a valid session.
 */

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Restrict a route to admin-role users only (e.g. user management). */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
