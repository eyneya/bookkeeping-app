/**
 * openaiProvider.js
 *
 * Same job as claudeProvider.js — reads a bank statement/invoice image and
 * returns structured transaction JSON — but calls OpenAI's API instead.
 *
 * IMPORTANT LIMITATION: OpenAI's vision input only accepts images (JPEG/PNG),
 * not PDF documents directly (Claude's API accepts PDFs natively). If a PDF
 * comes in and the OpenAI provider is selected, this throws a clear error
 * rather than silently failing — either switch that document to the Claude
 * provider, or convert the PDF to an image before upload.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
      "amount": number,
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
  "line_items": [{"description": "string", "amount": number}],
  "suggested_category": "string, a plain-language expense/income category guess",
  "confidence": "high" | "medium" | "low",
  "extraction_notes": "string describing anything illegible or ambiguous, or null"
}`;

/**
 * @param {Buffer} fileBuffer
 * @param {string} mediaType - e.g. 'image/jpeg', 'image/png', 'application/pdf'
 * @param {'bank_statement'|'invoice'} docType
 */
async function extractDocument(fileBuffer, mediaType, docType) {
  if (mediaType === 'application/pdf') {
    throw new Error(
      'The OpenAI provider only accepts image files (JPG/PNG), not PDFs. ' +
      'Either upload this document as an image, or switch AI_PROVIDER to "claude" for this document, which accepts PDFs natively.'
    );
  }

  const prompt = docType === 'bank_statement' ? BANK_STATEMENT_PROMPT : INVOICE_PROMPT;
  const base64Data = fileBuffer.toString('base64');
  const dataUrl = `data:${mediaType};base64,${base64Data}`;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // cheapest capable vision model; bump to gpt-4o for low-confidence re-runs
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse OpenAI response as JSON: ${err.message}\nRaw: ${content}`);
  }

  return parsed;
}

module.exports = { extractDocument };
