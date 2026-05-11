/**
 * Shared OpenAI SDK client.
 *
 * Used by:
 *   - services/calendar.js  (monthly calendar JSON)
 *   - services/telegram.js  (caption rewrite on /edit)
 */

const OpenAI = require('openai');
const { env } = require('../config');

if (!env.openaiApiKey) {
  // Do not throw so the service still boots / serves /health. Calls
  // will fail loudly when actually invoked.
  console.warn('[openai] OPENAI_API_KEY not set — calls will fail');
}

const client = new OpenAI({
  apiKey: env.openaiApiKey,
  baseURL: env.openaiBaseUrl || 'https://api.openai.com/v1'
});

module.exports = client;
