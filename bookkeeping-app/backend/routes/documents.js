const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { getAiProvider } = require('../services/aiExtraction');
const { auditLog } = require('../middleware/auditLog');
const { userHasClientAccess, userHasCustomerAccess } = require('../middleware/clientAccess');
const { assertPeriodNotLocked } = require('../services/periodLock');

const router = express.Router();

// SECURITY: strict allowlist of file types — never trust the client-supplied
// extension alone, and cap size to prevent abuse/DoS via huge uploads.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPG, PNG, and PDF are accepted.`));
    }
    cb(null, true);
  },
});

/** Strip any path components from a filename before storing/displaying it. */
function sanitizeFilename(filename) {
  return path.basename(filename).replace(/[^\w.\-() ]/g, '_');
}

/**
 * Duplicate detection: before inserting a newly-extracted transaction,
 * check whether a transaction already exists for this same client/customer
 * with the same date, amount, and description. This is the case that's
 * easy to hit across the multi-tier workflow — re-uploading the same
 * statement page, or uploading it once as a business doc and once into a
 * personal tier by mistake. Doesn't block the insert; flags it instead, so
 * the preparer decides (delete it, or confirm it's a legitimate repeat
 * transaction, which does happen — e.g. the same rent amount every month).
 */
async function findPossibleDuplicate(clientId, customerId, txnDate, amount, description) {
  const params = [txnDate, amount, description];
  let query = `
    SELECT id FROM transactions
    WHERE txn_date = $1 AND amount = $2 AND lower(description) = lower($3)`;
  if (clientId) {
    params.push(clientId);
    query += ` AND client_id = $${params.length}`;
  } else {
    params.push(customerId);
    query += ` AND customer_id = $${params.length}`;
  }
  query += ' LIMIT 1';
  const result = await pool.query(query, params);
  return result.rows[0]?.id || null;
}

/**
 * Reconciliation: compares beginning_balance + sum(extracted transactions)
 * against ending_balance from the statement itself. A mismatch means either
 * a misread number, a skipped transaction, or a page boundary issue — worth
 * a human look before trusting the data.
 */
function calculateReconciliation(beginningBalance, endingBalance, transactions) {
  if (beginningBalance === null || beginningBalance === undefined || endingBalance === null || endingBalance === undefined) {
    return { status: 'not_checked', diff: null };
  }
  const transactionSum = (transactions || []).reduce((s, t) => s + Number(t.amount), 0);
  const calculatedEnding = Number(beginningBalance) + transactionSum;
  const diff = Math.round((calculatedEnding - Number(endingBalance)) * 100) / 100;
  return { status: Math.abs(diff) < 0.01 ? 'matched' : 'mismatch', diff };
}

/**
 * Upload + process a single document.
 * Field name in the multipart form must be "file".
 * Body must include: doc_type ('bank_statement' | 'invoice'), and EITHER:
 *   - client_id  => a business-level document (Tier 1)
 *   - customer_id => a personal document (Tier 2) — shared pool, not yet
 *     tied to any specific business
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  const { client_id, customer_id, doc_type, ai_provider } = req.body;
  const file = req.file;

  if (!file || !doc_type) return res.status(400).json({ error: 'file and doc_type are required' });
  if (!client_id && !customer_id) return res.status(400).json({ error: 'Provide either client_id or customer_id' });
  if (client_id && customer_id) return res.status(400).json({ error: 'Provide only one of client_id or customer_id, not both' });

  if (client_id && !(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (customer_id && !(await userHasCustomerAccess(req.user, customer_id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }

  const safeFilename = sanitizeFilename(file.originalname);

  const docInsert = await pool.query(
    `INSERT INTO documents (client_id, customer_id, doc_type, original_filename, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [client_id || null, customer_id || null, doc_type, safeFilename]
  );
  const documentId = docInsert.rows[0].id;

  try {
    const provider = getAiProvider(ai_provider);
    const extraction = await provider.extractDocument(file.buffer, file.mimetype, doc_type);

    await pool.query(
      `UPDATE documents SET raw_extraction = $1, status = 'processed', processed_at = now() WHERE id = $2`,
      [JSON.stringify(extraction), documentId]
    );

    let duplicateCount = 0;

    if (doc_type === 'bank_statement') {
      for (const txn of extraction.transactions || []) {
        const duplicateOfId = await findPossibleDuplicate(client_id, customer_id, txn.date, txn.amount, txn.description);
        if (duplicateOfId) duplicateCount++;

        await pool.query(
          `INSERT INTO transactions (client_id, customer_id, document_id, txn_date, description, amount, needs_review, possible_duplicate, duplicate_of_transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [client_id || null, customer_id || null, documentId, txn.date, txn.description, txn.amount, true, !!duplicateOfId, duplicateOfId]
        );
      }

      // Reconciliation check against the statement's own beginning/ending balance
      const recon = calculateReconciliation(extraction.beginning_balance, extraction.ending_balance, extraction.transactions);
      await pool.query(
        `UPDATE documents SET statement_beginning_balance = $1, statement_ending_balance = $2, reconciliation_status = $3, reconciliation_diff = $4 WHERE id = $5`,
        [extraction.beginning_balance ?? null, extraction.ending_balance ?? null, recon.status, recon.diff, documentId]
      );
    } else if (doc_type === 'invoice') {
      const txnResult = await pool.query(
        `INSERT INTO transactions (client_id, customer_id, document_id, txn_date, description, amount, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          client_id || null,
          customer_id || null,
          documentId,
          extraction.invoice_date,
          `Invoice ${extraction.invoice_number || ''} - ${extraction.vendor_name || 'Unknown vendor'}`.trim(),
          -Math.abs(extraction.amount || 0),
          true,
        ]
      );
      // Invoices-table detail only applies to business-side invoices
      if (client_id) {
        await pool.query(
          `INSERT INTO invoices (client_id, document_id, transaction_id, vendor_name, invoice_number, invoice_date, due_date, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            client_id,
            documentId,
            txnResult.rows[0].id,
            extraction.vendor_name,
            extraction.invoice_number,
            extraction.invoice_date,
            extraction.due_date,
            extraction.amount,
          ]
        );
      }
    }

    await auditLog(req, {
      action: 'document.upload',
      resourceType: client_id ? 'client' : 'customer',
      resourceId: client_id || customer_id,
      metadata: { document_id: documentId, doc_type, filename: safeFilename, duplicate_count: duplicateCount },
    });

    const documentResult = await pool.query('SELECT * FROM documents WHERE id = $1', [documentId]);
    res.json({ document_id: documentId, status: 'processed', extraction, duplicate_count: duplicateCount, document: documentResult.rows[0] });
  } catch (err) {
    await pool.query(`UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2`, [err.message, documentId]);
    res.status(500).json({ document_id: documentId, status: 'error', error: err.message });
  }
});

// List documents for a business or a customer's personal pool.
// Supports pagination (limit/offset) and search (q, matches filename).
router.get('/', async (req, res) => {
  const { client_id, customer_id, status, q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  if (!client_id && !customer_id) return res.status(400).json({ error: 'client_id or customer_id is required' });

  if (client_id && !(await userHasClientAccess(req.user, client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (customer_id && !(await userHasCustomerAccess(req.user, customer_id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }

  const params = [];
  let whereClause = '';
  if (client_id) {
    params.push(client_id);
    whereClause += `client_id = $${params.length}`;
  } else {
    params.push(customer_id);
    whereClause += `customer_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    whereClause += ` AND original_filename ILIKE $${params.length}`;
  }

  const countResult = await pool.query(`SELECT COUNT(*) FROM documents WHERE ${whereClause}`, params);

  const listParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT * FROM documents WHERE ${whereClause} ORDER BY uploaded_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ documents: result.rows, total: Number(countResult.rows[0].count), limit, offset });
});

/**
 * Delete a document — for junk uploads (wrong file, bad scan, uploaded to
 * the wrong place). Also deletes its transactions, UNLESS any of them have
 * already been flagged as a business expense or are locked in a closed
 * period, in which case it refuses and tells you what to undo first — this
 * prevents silently losing capital-account entries or reopening filed periods.
 */
router.delete('/:id', async (req, res) => {
  const override_lock = req.query.override_lock === 'true' || req.body?.override_lock === true;
  const docResult = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  const doc = docResult.rows[0];
  if (!doc) return res.status(404).json({ error: 'not found' });

  if (doc.client_id && !(await userHasClientAccess(req.user, doc.client_id))) {
    return res.status(403).json({ error: 'You do not have access to this client.' });
  }
  if (doc.customer_id && !(await userHasCustomerAccess(req.user, doc.customer_id))) {
    return res.status(403).json({ error: 'You do not have access to this client (person).' });
  }

  const txnsResult = await pool.query('SELECT * FROM transactions WHERE document_id = $1', [req.params.id]);
  const flaggedTxn = txnsResult.rows.find((t) => t.flagged_as_business);
  if (flaggedTxn) {
    return res.status(400).json({ error: 'One or more transactions from this document have been flagged as a business expense — unflag them first.' });
  }

  let lockOverridden = false;
  for (const txn of txnsResult.rows) {
    try {
      lockOverridden = (await assertPeriodNotLocked(txn.client_id, txn.txn_date, req.user, override_lock)) || lockOverridden;
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transactions WHERE document_id = $1', [req.params.id]);
    await client.query('DELETE FROM invoices WHERE document_id = $1', [req.params.id]);
    await client.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    await auditLog(req, { action: 'document.delete', resourceType: 'document', resourceId: req.params.id, metadata: { lock_overridden: lockOverridden } });
    if (lockOverridden) {
      await auditLog(req, { action: 'period_lock.override', resourceType: 'document', resourceId: req.params.id, metadata: { route: 'DELETE /api/documents/:id' } });
    }
    res.json({ status: 'deleted', transactions_removed: txnsResult.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
