/**
 * claudeExtraction.js
 *
 * Sends a scanned/photographed bank statement or invoice to the Claude API
 * (vision) and gets back structured transaction data as JSON.
 *
 * Why Claude API instead of a dedicated OCR service (Textract/Google Vision):
 *   - One API call does OCR + structuring + categorization hinting in one shot
 *   - No separate OCR bill on top of a separate "parse this text" step
 *   - Handles messy handwriting/torn receipts better than template-based OCR
 *
 * Cost note: at 500 docs/month, using Claude Haiku 4.5 for extraction keeps
 * this to roughly a few dollars a month. Reserve Sonnet for cases the model
 * flags as low-confidence (see needs_review logic below) rather than using
 * the more expensive model on every single document.
 */

const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const BANK_STATEMENT_PROMPT = `You are extracting transaction data from a photo or scan of a bank statement page.

Return ONLY valid JSON (no markdown fences, no preamble) matching this exact shape:
{
  "account_last4": "string or null",
  "statement_period": {"start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null"},
  "beginning_balance": number or null,
  "ending_balance": number or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string, as printed on the statement",
      "amount": number,  // negative for withdrawals/debits, positive for deposits/credits
      "confidence": "high" | "medium" | "low"
    }
  ],
  "extraction_notes": "string describing anything illegible, cut off, or ambiguous, or null"
}

Rules:
- beginning_balance and ending_balance should be the statement's own printed balance figures for this page/period, if shown. Use null if not visible on this page.
- If any field is illegible or you are guessing, set confidence to "low" or "medium" and explain in extraction_notes.
- Do not invent transactions that aren't visible in the image.
- Preserve the exact dollar amounts as printed; do not round.`;

const INVOICE_PROMPT = `You are extracting data from a photo or scan of a customer invoice or receipt.

Return ONLY valid JSON (no markdown fences, no preamble) matching this exact shape:
{
  "vendor_name": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "amount": number,
  "line_items": [
    {"description": "string", "amount": number}
  ],
  "suggested_category": "string, a plain-language expense/income category guess (e.g. 'Office Supplies', 'Software/Subscriptions')",
  "confidence": "high" | "medium" | "low",
  "extraction_notes": "string describing anything illegible or ambiguous, or null"
}`;

/**
 * @param {Buffer} fileBuffer - the raw image/PDF bytes
 * @param {string} mediaType - e.g. 'image/jpeg', 'image/png', 'application/pdf'
 * @param {'bank_statement'|'invoice'} docType
 */
async function extractDocument(fileBuffer, mediaType, docType) {
  const prompt = docType === 'bank_statement' ? BANK_STATEMENT_PROMPT : INVOICE_PROMPT;
  const base64Data = fileBuffer.toString('base64');

  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // cheapest capable model; bump to sonnet for low-confidence re-runs
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude API');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse Claude response as JSON: ${err.message}\nRaw: ${cleaned}`);
  }

  return parsed;
}

module.exports = { extractDocument };
