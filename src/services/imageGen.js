/**
 * Image generation service
 * ------------------------
 * Wraps OpenAI's gpt-image-1 endpoint, saves PNGs to disk, and exposes
 * a public URL (served by Express) so Zernio can fetch them.
 */

const fs = require('fs');
const path = require('path');

const { env, PROMPTS } = require('../config');
const openai = require('./openaiClient');
const logger = require('../utils/logger');

const IMAGE_DIR = path.resolve(env.dataDir, 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

/**
 * Generate a 1080x1080 PNG for a single planned post.
 *
 * @param {object} post — normalised post object from calendar service
 * @returns {{ localPath: string, publicUrl: string, fileName: string }}
 */
async function generatePostImage(post) {
  const prompt = PROMPTS.buildImagePrompt(post);

  // gpt-image-1 supports 1024x1024, 1024x1536 (portrait), and 1536x1024 (landscape).
  // We use the portrait size (4:5 / closest available) to match Nick's reference style.
  const result = await openai.images.generate({
    model: env.openaiImageModel,
    prompt,
    size: '1024x1536',
    quality: 'high',
    n: 1
  });

  const item = result?.data?.[0];
  if (!item) {
    throw new Error('No image returned from gpt-image-1');
  }

  // gpt-image-1 returns base64-encoded PNG by default
  let buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    // Fallback: fetch the URL
    const axios = require('axios');
    const resp = await axios.get(item.url, { responseType: 'arraybuffer' });
    buffer = Buffer.from(resp.data);
  } else {
    throw new Error('Image response missing both b64_json and url');
  }

  const fileName = `${post.id}.png`;
  const localPath = path.join(IMAGE_DIR, fileName);
  fs.writeFileSync(localPath, buffer);

  const publicUrl = `${env.publicBaseUrl.replace(/\/$/, '')}/images/${fileName}`;

  logger.info(
    { postId: post.id, bytes: buffer.length, publicUrl },
    'Image generated'
  );

  return { localPath, publicUrl, fileName };
}

module.exports = {
  generatePostImage,
  IMAGE_DIR
};
