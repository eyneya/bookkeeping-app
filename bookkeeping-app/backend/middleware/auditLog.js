/**
 * auditLog — records who did what, to which record, and when. Call this
 * from within route handlers after a successful action (not as blanket
 * middleware), since it needs to know the specific resource affected.
 *
 * This exists both as a security control (you can answer "who touched this
 * client's data and when" if something looks wrong) and because tax
 * preparers are expected to maintain access records under IRS Pub. 4557
 * and the FTC Safeguards Rule.
 */

const pool = require('../db/pool');

async function auditLog(req, { action, resourceType, resourceId, metadata }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user?.userId || null,
        action,
        resourceType || null,
        resourceId || null,
        req.ip,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    // Never let audit logging failure break the actual request
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { auditLog };
