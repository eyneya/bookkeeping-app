/**
 * Per-client (per-business) access control. Admins bypass this entirely.
 * Preparers can only access a business if there's a matching row in
 * user_client_access.
 *
 * Access to a CUSTOMER's personal tier is derived from having access to at
 * least one business they own (via the owners join) — there's no separate
 * customer-level grant, since a customer only matters in the context of
 * the business/businesses you're preparing for them.
 */

const pool = require('../db/pool');

async function userHasClientAccess(user, clientId) {
  if (user.role === 'admin') return true;
  const result = await pool.query(
    'SELECT 1 FROM user_client_access WHERE user_id = $1 AND client_id = $2',
    [user.userId, clientId]
  );
  return result.rows.length > 0;
}

async function userHasCustomerAccess(user, customerId) {
  if (user.role === 'admin') return true;
  const result = await pool.query(
    `SELECT 1 FROM customers c
     LEFT JOIN owners o ON o.customer_id = c.id
     LEFT JOIN user_client_access uca ON uca.client_id = o.client_id AND uca.user_id = $2
     WHERE c.id = $1 AND (c.created_by = $2 OR uca.user_id = $2)
     LIMIT 1`,
    [customerId, user.userId]
  );
  return result.rows.length > 0;
}

/** Express middleware: checks req.params.clientId or req.query.client_id / req.body.client_id */
function requireClientAccess(getClientId) {
  return async (req, res, next) => {
    const clientId = getClientId ? getClientId(req) : (req.params.id || req.query.client_id || req.body.client_id);
    if (!clientId) return next(); // let the route's own validation handle a missing id
    const hasAccess = await userHasClientAccess(req.user, clientId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this client.' });
    next();
  };
}

/** Express middleware: checks req.params.customerId or req.query.customer_id / req.body.customer_id */
function requireCustomerAccess(getCustomerId) {
  return async (req, res, next) => {
    const customerId = getCustomerId ? getCustomerId(req) : (req.params.id || req.query.customer_id || req.body.customer_id);
    if (!customerId) return next();
    const hasAccess = await userHasCustomerAccess(req.user, customerId);
    if (!hasAccess) return res.status(403).json({ error: 'You do not have access to this client (person).' });
    next();
  };
}

module.exports = { userHasClientAccess, userHasCustomerAccess, requireClientAccess, requireCustomerAccess };
