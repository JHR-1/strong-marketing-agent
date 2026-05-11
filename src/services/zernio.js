/**
 * Zernio service
 * --------------
 * Thin wrapper around Zernio's REST API.
 *  - listAccounts()
 *  - schedulePost({ caption, scheduledForIso, platforms[], imageUrl })
 *
 * The platform/account-id mapping lives in config/platforms.js so it
 * is rotatable via environment variables.
 */

const axios = require('axios');

const { env, toZernioPlatforms } = require('../config');
const logger = require('../utils/logger');

const http = axios.create({
  baseURL: env.zernioBaseUrl,
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${env.zernioApiKey}`,
    'Content-Type': 'application/json'
  }
});

async function listAccounts() {
  const { data } = await http.get('/accounts');
  return data;
}

async function listProfiles() {
  const { data } = await http.get('/profiles');
  return data;
}

/**
 * Schedule a post.
 *
 * @param {object} args
 * @param {string} args.caption          - text content of the post
 * @param {string} args.scheduledForIso  - ISO 8601 timestamp (UTC ok)
 * @param {string[]} args.platforms      - internal platform keys
 *                                         (e.g. ['linkedin','facebook','instagram','twitter','google'])
 * @param {string} [args.imageUrl]       - public URL of the image to attach
 * @param {string} [args.timezone='Europe/London']
 * @param {boolean} [args.publishNow=false]
 */
async function schedulePost({
  caption,
  scheduledForIso,
  platforms,
  imageUrl,
  timezone = 'Europe/London',
  publishNow = false
}) {
  const platformObjects = toZernioPlatforms(platforms, logger);
  if (!platformObjects.length) {
    throw new Error('Cannot schedule post: no valid platforms resolved');
  }

  const body = {
    content: caption,
    timezone,
    platforms: platformObjects
  };

  if (publishNow) {
    body.publishNow = true;
  } else {
    body.scheduledFor = scheduledForIso;
  }

  if (imageUrl) {
    body.mediaItems = [{ type: 'image', url: imageUrl }];
  }

  logger.info(
    { scheduledForIso, platforms, imageUrl, hasImage: !!imageUrl },
    'Scheduling Zernio post'
  );

  try {
    const { data } = await http.post('/posts', body);
    logger.info(
      { zernioId: data?.id || data?.postId || data?.data?.id },
      'Zernio scheduled'
    );
    return data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    logger.error({ status, detail }, 'Zernio scheduling failed');
    throw new Error(
      `Zernio API error ${status || ''}: ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`
    );
  }
}

async function deletePost(zernioPostId) {
  const { data } = await http.delete(`/posts/${zernioPostId}`);
  return data;
}

async function getPost(zernioPostId) {
  const { data } = await http.get(`/posts/${zernioPostId}`);
  return data;
}

module.exports = {
  http,
  listAccounts,
  listProfiles,
  schedulePost,
  deletePost,
  getPost
};
