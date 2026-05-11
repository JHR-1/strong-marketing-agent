const OpenAI = require('openai');
const { env } = require('../config');

if (!env.openaiApiKey) {
  // We don't throw on import so that the service can still boot for
  // health checks; calls will fail loudly.
  console.warn('[openai] OPENAI_API_KEY not set — calls will fail');
}

const client = new OpenAI({
  apiKey: env.openaiApiKey,
  // Force the canonical OpenAI endpoint (some Manus envs override base_url)
  baseURL: 'https://api.openai.com/v1'
});

module.exports = client;
