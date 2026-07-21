/**
 * AI provider factory for document extraction. Both providers implement the
 * same interface: extractDocument(fileBuffer, mediaType, docType) -> JSON.
 *
 * Provider selection, in priority order:
 *   1. An explicit `ai_provider` passed with the upload request (per-document override)
 *   2. AI_PROVIDER in .env (your firm-wide default)
 *   3. Falls back to 'claude'
 */

const claudeProvider = require('./claudeProvider');
const openaiProvider = require('./openaiProvider');

function getAiProvider(providerName) {
  const resolved = providerName || process.env.AI_PROVIDER || 'claude';
  if (resolved === 'openai') return openaiProvider;
  if (resolved === 'claude') return claudeProvider;
  throw new Error(`Unknown AI provider: ${resolved}. Use 'claude' or 'openai'.`);
}

module.exports = { getAiProvider };
