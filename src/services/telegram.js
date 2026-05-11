/**
 * Telegram service
 * ----------------
 * Implements the new Strong Group marketing workflow:
 *
 *   1. /generate
 *      -> Agent calls calendar.generateCalendarForUpcomingMonth().
 *      -> Bot replies with the full content calendar for next month:
 *         12 social posts (numbered 1-12) and 2 blog posts (13-14),
 *         each with topic, caption, hashtags and suggested image
 *         description.
 *
 *   2. User creates each image in ChatGPT 5.5 and sends them as photos
 *      / documents to the bot.
 *      -> For every photo received the bot asks "Which post number is
 *         this image for? (1-14)".
 *      -> User replies with a number; bot saves the image, attaches it
 *         to that post and confirms.
 *      -> Alternatively the user can send a photo with the post number
 *         in the caption ("3") and the bot assigns it immediately.
 *
 *   3. /status — shows which posts still need an image.
 *
 *   4. /schedule — once every post has an image, the bot schedules all
 *      14 posts on Zernio across the 5 channels. Blog promo posts go
 *      out with the blog image + promo caption + blog URL (the user
 *      can set the URL with /seturl <post#> <url> or the bot inserts
 *      the Strong Group news page as a fallback).
 *
 *   5. /reset — wipes the active calendar and lets the user start over.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');

const { env, BRAND, PROMPTS, PLATFORMS } = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const openai = require('./openaiClient');

// Per-chat conversational state stored only in memory.
//   { awaitingImageForPost: number|null,
//     pendingImage: { fileId, filePath, publicUrl }|null,
//     editingPostId: string|null }
const chatState = new Map();

function getState(chatId) {
  let s = chatState.get(chatId);
  if (!s) {
    s = { awaitingImageForPost: null, pendingImage: null, editingPostId: null };
    chatState.set(chatId, s);
  }
  return s;
}

class TelegramService {
  /**
   * @param {object} deps
   * @param {object} deps.zernio   - zernio service module
   * @param {object} deps.calendar - calendar service module
   */
  constructor({ zernio, calendar }) {
    this.zernio = zernio;
    this.calendar = calendar;
    this.bot = null;
    this.imagesDir = path.resolve(env.dataDir, 'images');
    fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  start() {
    if (!env.telegramBotToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram service disabled');
      return;
    }
    this.bot = new TelegramBot(env.telegramBotToken, { polling: true });

    this.bot.on('message', (m) => this._onMessage(m).catch((err) => {
      logger.error({ err: err.message, stack: err.stack }, 'message handler failed');
    }));
    this.bot.on('polling_error', (err) =>
      logger.error({ err: err.message }, 'Telegram polling error')
    );

    this.bot.setMyCommands([
      { command: 'generate', description: 'Generate next month\'s content calendar' },
      { command: 'calendar', description: 'Show the current calendar' },
      { command: 'status',   description: 'Show which posts still need images' },
      { command: 'seturl',   description: 'Set the blog URL for a blog promo post: /seturl <post#> <url>' },
      { command: 'schedule', description: 'Schedule all posts on Zernio' },
      { command: 'reset',    description: 'Wipe the active calendar' },
      { command: 'help',     description: 'Show available commands' }
    ]).catch(() => {});

    logger.info('Telegram bot started');
  }

  // -------------------- public sending helpers --------------------

  async sendInfo(text) {
    if (!this.bot) return;
    await this._sendLong(env.telegramChatId, text);
  }

  // -------------------- command + message routing --------------------

  async _onMessage(msg) {
    if (!msg) return;
    // Only respond inside the configured chat ID.
    if (String(msg.chat.id) !== String(env.telegramChatId)) {
      logger.warn(
        { chatId: msg.chat.id, expected: env.telegramChatId },
        'Ignoring message from non-allowlisted chat'
      );
      return;
    }

    // Photo / document image upload.
    if (msg.photo && msg.photo.length) {
      return this._onPhoto(msg);
    }
    if (msg.document && /^image\//.test(msg.document.mime_type || '')) {
      return this._onDocumentImage(msg);
    }

    if (!msg.text) return;
    const text = msg.text.trim();

    // Slash commands
    if (text.startsWith('/')) {
      return this._handleCommand(msg, text);
    }

    // Plain text — either: a post-number reply for a pending image,
    // OR a caption-edit reply.
    return this._handleFreeText(msg, text);
  }

  async _handleCommand(msg, text) {
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().split('@')[0]; // strip @BotName if any

    switch (cmd) {
      case '/start':
      case '/help':
        return this._cmdHelp(msg);
      case '/generate':
        return this._cmdGenerate(msg);
      case '/calendar':
        return this._cmdShowCalendar(msg);
      case '/status':
        return this._cmdStatus(msg);
      case '/seturl':
        return this._cmdSetUrl(msg, args);
      case '/schedule':
        return this._cmdSchedule(msg);
      case '/reset':
        return this._cmdReset(msg);
      case '/cancel': {
        const state = getState(msg.chat.id);
        state.awaitingImageForPost = null;
        state.pendingImage = null;
        state.editingPostId = null;
        await this.bot.sendMessage(msg.chat.id, 'Cancelled.');
        return;
      }
      default:
        await this.bot.sendMessage(
          msg.chat.id,
          `Unknown command: ${cmd}. Send /help to see what I can do.`
        );
    }
  }

  // -------------------- commands --------------------

  async _cmdHelp(msg) {
    const text = [
      '<b>Strong Group Marketing Agent</b>',
      '',
      '<b>Workflow</b>',
      '1. /generate — I plan next month\'s content (12 social posts + 2 blog posts) and send you the full calendar.',
      '2. You create each image in ChatGPT 5.5 and send them to me here.',
      '3. For each image I\'ll ask "which post number?" — reply with the number, or send the photo with the number in the caption.',
      '4. /status — see which posts still need an image.',
      '5. /seturl &lt;post#&gt; &lt;url&gt; — set the blog URL for a blog promo post.',
      '6. /schedule — once all images are attached, I schedule everything across Facebook, Instagram, LinkedIn, Twitter/X and Google Business via Zernio.',
      '',
      '<b>Other commands</b>',
      '/calendar — re-send the current calendar',
      '/reset — wipe the active calendar and start over',
      '/cancel — cancel a pending image assignment'
    ].join('\n');
    await this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  }

  async _cmdGenerate(msg) {
    await this.bot.sendMessage(
      msg.chat.id,
      'Generating next month\'s content calendar — give me a moment…'
    );
    try {
      const result = await this.calendar.generateCalendarForUpcomingMonth();
      await this._sendCalendar(msg.chat.id, result);
      await this.bot.sendMessage(
        msg.chat.id,
        'Calendar ready. Create each image in ChatGPT 5.5 and send them to me here. ' +
          'When you send a photo I\'ll ask which post number it\'s for — or you can ' +
          'put the post number in the photo caption (e.g. send the photo with caption "3").'
      );
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'generate failed');
      await this.bot.sendMessage(
        msg.chat.id,
        `Calendar generation failed: ${err.message}`
      );
    }
  }

  async _cmdShowCalendar(msg) {
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey) {
      await this.bot.sendMessage(
        msg.chat.id,
        'No calendar yet. Send /generate to create next month\'s calendar.'
      );
      return;
    }
    const cal = storage.getCalendar(monthKey);
    const posts = storage.listPostsByMonth(monthKey);
    const blogs = storage.listBlogsByMonth(monthKey);
    const monthName = cal?.raw?.month || monthKey;
    await this._sendCalendar(msg.chat.id, {
      monthKey,
      monthName,
      posts,
      blogs
    });
  }

  async _cmdStatus(msg) {
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey) {
      await this.bot.sendMessage(msg.chat.id, 'No active calendar.');
      return;
    }
    const posts = storage.listPostsByMonth(monthKey);
    if (!posts.length) {
      await this.bot.sendMessage(msg.chat.id, 'No posts found for the active calendar.');
      return;
    }

    const lines = [`<b>Status — ${escapeHtml(monthKey)}</b>`, ''];
    const missing = [];
    const scheduled = [];
    for (const p of posts) {
      const tag = p.kind === 'blog_promo' ? 'BLOG' : 'POST';
      const dt = DateTime.fromISO(p.scheduled_for).setZone(env.tz);
      const when = dt.toFormat('ccc d LLL HH:mm');
      let icon;
      if (p.status === 'scheduled') { icon = '✅'; scheduled.push(p.post_number); }
      else if (p.status === 'image_attached') icon = '🖼';
      else if (p.status === 'schedule_failed') icon = '⚠️';
      else { icon = '⏳'; missing.push(p.post_number); }
      lines.push(
        `${icon} <b>${p.post_number}</b> [${tag}] ${escapeHtml(p.topic || p.sector)} — ${when}`
      );
    }
    lines.push('');
    if (missing.length) {
      lines.push(`<b>Awaiting images:</b> ${missing.join(', ')}`);
    } else {
      lines.push('<b>All images attached.</b> Run /schedule to publish.');
    }
    if (scheduled.length) {
      lines.push(`<b>Scheduled:</b> ${scheduled.join(', ')}`);
    }
    await this.bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'HTML' });
  }

  async _cmdSetUrl(msg, args) {
    const [postNumStr, url] = args;
    const postNum = parseInt(postNumStr, 10);
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey || !postNum || !url) {
      await this.bot.sendMessage(
        msg.chat.id,
        'Usage: <code>/seturl &lt;post#&gt; &lt;url&gt;</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const post = storage.getPostByNumber(monthKey, postNum);
    if (!post) {
      await this.bot.sendMessage(msg.chat.id, `No post #${postNum} in the active calendar.`);
      return;
    }
    if (post.kind !== 'blog_promo' || !post.blog_id) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Post #${postNum} is not a blog promo. /seturl only applies to blog posts.`
      );
      return;
    }
    storage.updateBlog(post.blog_id, { url });
    // Replace the <BLOG_URL> token in the caption preview (the
    // caption is persisted with the token; we substitute at schedule
    // time too, but we also persist the URL here so /calendar shows it).
    await this.bot.sendMessage(
      msg.chat.id,
      `Blog URL for post #${postNum} set to ${escapeHtml(url)}.`,
      { parse_mode: 'HTML' }
    );
  }

  async _cmdSchedule(msg) {
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey) {
      await this.bot.sendMessage(msg.chat.id, 'No active calendar to schedule.');
      return;
    }
    const posts = storage.listPostsByMonth(monthKey);
    const missing = posts.filter((p) => !p.image_url);
    if (missing.length) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Cannot schedule yet. Missing images for posts: ${missing
          .map((p) => p.post_number)
          .join(', ')}.`
      );
      return;
    }

    await this.bot.sendMessage(
      msg.chat.id,
      `Scheduling ${posts.length} posts across Facebook, Instagram, LinkedIn, Twitter/X and Google Business…`
    );

    const blogs = storage.listBlogsByMonth(monthKey);
    const blogsById = new Map(blogs.map((b) => [b.id, b]));

    let okCount = 0;
    const failures = [];
    for (const p of posts) {
      if (p.status === 'scheduled') {
        okCount++;
        continue;
      }
      try {
        storage.updatePost(p.id, { status: 'scheduling', schedule_error: null });

        const caption = this._buildCaptionForZernio(p, blogsById);
        const result = await this.zernio.schedulePost({
          caption,
          scheduledForIso: p.scheduled_for,
          platforms: p.platforms && p.platforms.length
            ? p.platforms
            : BRAND.defaultPlatforms,
          imageUrl: p.image_url,
          hashtags: p.hashtags || [],
          timezone: env.tz
        });
        const zernioId =
          result?.id || result?.postId || result?.data?.id || null;
        storage.updatePost(p.id, {
          status: 'scheduled',
          zernio_post_id: zernioId
        });
        okCount++;
      } catch (err) {
        logger.error(
          { err: err.message, postNumber: p.post_number },
          'Schedule failed for post'
        );
        storage.updatePost(p.id, {
          status: 'schedule_failed',
          schedule_error: err.message
        });
        failures.push({ number: p.post_number, error: err.message });
      }
    }

    if (!failures.length) {
      storage.updateCalendarStatus(monthKey, 'scheduled');
      await this.bot.sendMessage(
        msg.chat.id,
        `All ${okCount} posts scheduled successfully on Zernio across all 5 channels.`
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        `Scheduled ${okCount} of ${posts.length}. ` +
          `Failures:\n` +
          failures
            .map((f) => `  • Post ${f.number}: ${f.error}`)
            .join('\n') +
          `\n\nFix and run /schedule again to retry the failed ones.`
      );
    }
  }

  async _cmdReset(msg) {
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey) {
      await this.bot.sendMessage(msg.chat.id, 'Nothing to reset.');
      return;
    }
    storage.deletePostsForMonth(monthKey);
    storage.deleteBlogsForMonth(monthKey);
    storage.setSetting('last_calendar_month', '');
    const state = getState(msg.chat.id);
    state.awaitingImageForPost = null;
    state.pendingImage = null;
    state.editingPostId = null;
    await this.bot.sendMessage(
      msg.chat.id,
      `Wiped the active calendar (${monthKey}). Send /generate to start fresh.`
    );
  }

  // -------------------- photo handling --------------------

  async _onPhoto(msg) {
    // Telegram delivers multiple sizes; pick the largest.
    const photo = msg.photo[msg.photo.length - 1];
    const captionNum = parseInt((msg.caption || '').trim(), 10);

    const saved = await this._saveTelegramFile(photo.file_id, 'jpg');
    if (!saved) return;

    if (Number.isInteger(captionNum)) {
      await this._assignImageToPost(msg.chat.id, captionNum, saved);
      return;
    }

    // No caption → ask which post.
    const state = getState(msg.chat.id);
    state.pendingImage = saved;
    state.awaitingImageForPost = null;

    const monthKey = storage.getSetting('last_calendar_month');
    const posts = monthKey ? storage.listPostsByMonth(monthKey) : [];
    const list = posts.length
      ? '\n\n' +
        posts
          .map((p) => {
            const flag = p.image_url ? '✅' : '⏳';
            const tag = p.kind === 'blog_promo' ? ' [BLOG]' : '';
            return `${flag} ${p.post_number}.${tag} ${truncate(p.topic || p.sector, 60)}`;
          })
          .join('\n')
      : '';
    await this.bot.sendMessage(
      msg.chat.id,
      `Got it. Which post number is this image for? Reply with a number 1-${
        posts.length || 14
      }, or /cancel.${list}`
    );
  }

  async _onDocumentImage(msg) {
    const doc = msg.document;
    const ext = (doc.file_name || '').split('.').pop() || 'jpg';
    const captionNum = parseInt((msg.caption || '').trim(), 10);

    const saved = await this._saveTelegramFile(doc.file_id, ext);
    if (!saved) return;

    if (Number.isInteger(captionNum)) {
      await this._assignImageToPost(msg.chat.id, captionNum, saved);
      return;
    }
    const state = getState(msg.chat.id);
    state.pendingImage = saved;
    state.awaitingImageForPost = null;

    await this.bot.sendMessage(
      msg.chat.id,
      'Got the image. Which post number is this for? Reply with a number, or /cancel.'
    );
  }

  async _handleFreeText(msg, text) {
    const state = getState(msg.chat.id);

    // Number reply for a pending image
    if (state.pendingImage) {
      const num = parseInt(text, 10);
      if (Number.isInteger(num)) {
        const pending = state.pendingImage;
        state.pendingImage = null;
        await this._assignImageToPost(msg.chat.id, num, pending);
        return;
      }
      await this.bot.sendMessage(
        msg.chat.id,
        'Reply with the post number (e.g. 3), or /cancel.'
      );
      return;
    }

    // Caption editing
    if (state.editingPostId) {
      const post = storage.getPost(state.editingPostId);
      state.editingPostId = null;
      if (!post) return;
      let newCaption = text;
      if (text.toLowerCase().startsWith('!ai')) {
        const instruction = text.slice(3).trim();
        try {
          newCaption = await rewriteCaption({
            original: post.caption,
            instruction,
            post
          });
        } catch (err) {
          await this.bot.sendMessage(
            msg.chat.id,
            `AI rewrite failed: ${err.message}. Send caption manually or /cancel.`
          );
          state.editingPostId = post.id;
          return;
        }
      }
      storage.updatePost(post.id, { caption: newCaption });
      await this.bot.sendMessage(
        msg.chat.id,
        `Caption updated for post #${post.post_number}.`
      );
      return;
    }
    // Otherwise: gently nudge.
    await this.bot.sendMessage(
      msg.chat.id,
      'Send /help to see what I can do.'
    );
  }

  // -------------------- image storage / assignment --------------------

  async _saveTelegramFile(fileId, ext) {
    try {
      const file = await this.bot.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;
      const filename = `${fileId}.${(ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
      const dest = path.join(this.imagesDir, filename);

      const resp = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(dest, resp.data);

      const publicUrl = `${env.publicBaseUrl.replace(/\/$/, '')}/images/${filename}`;
      return { fileId, filePath: dest, publicUrl, filename };
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to save Telegram image');
      await this.bot.sendMessage(
        env.telegramChatId,
        `Failed to save image: ${err.message}`
      );
      return null;
    }
  }

  async _assignImageToPost(chatId, postNumber, saved) {
    const monthKey = storage.getSetting('last_calendar_month');
    if (!monthKey) {
      await this.bot.sendMessage(chatId, 'No active calendar.');
      return;
    }
    const post = storage.getPostByNumber(monthKey, postNumber);
    if (!post) {
      await this.bot.sendMessage(
        chatId,
        `No post #${postNumber} in the active calendar. Send a number from the calendar.`
      );
      return;
    }
    storage.updatePost(post.id, {
      image_path: saved.filePath,
      image_url: saved.publicUrl,
      image_telegram_file_id: saved.fileId,
      status: 'image_attached'
    });

    // Summary
    const posts = storage.listPostsByMonth(monthKey);
    const missing = posts.filter((p) => !p.image_url).map((p) => p.post_number);
    const done = posts.length - missing.length;

    let trailer;
    if (missing.length === 0) {
      trailer = '\n\nAll images attached — run /schedule to publish everything on Zernio.';
    } else {
      trailer = `\n\nProgress: ${done}/${posts.length} images attached. Still need: ${missing.join(', ')}.`;
    }
    await this.bot.sendMessage(
      chatId,
      `Image attached to post #${postNumber} (${escapeHtml(post.topic || post.sector)}).${trailer}`,
      { parse_mode: 'HTML' }
    );
  }

  // -------------------- calendar rendering --------------------

  async _sendCalendar(chatId, { monthKey, monthName, posts, blogs }) {
    const header = [
      `<b>📅 ${escapeHtml(monthName || monthKey)} content calendar</b>`,
      `Channels: Facebook · Instagram · LinkedIn · Twitter/X · Google Business`,
      ''
    ].join('\n');
    await this.bot.sendMessage(chatId, header, { parse_mode: 'HTML' });

    const social = posts.filter((p) => p.kind === 'social');
    const blogPromo = posts.filter((p) => p.kind === 'blog_promo');
    const blogsById = new Map(blogs.map((b) => [b.id, b]));

    // 12 social posts
    let chunk = '<b>Social posts (3/week × 4 weeks)</b>\n\n';
    for (const p of social) {
      const block = this._formatPostBlock(p);
      if ((chunk + block).length > 3500) {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
        chunk = '';
      }
      chunk += block + '\n';
    }
    if (chunk.trim()) {
      await this.bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
    }

    // 2 blog promo posts
    if (blogPromo.length) {
      chunk = '<b>Blog posts (scheduled as social promo + image)</b>\n\n';
      for (const p of blogPromo) {
        const blog = blogsById.get(p.blog_id);
        const block = this._formatBlogBlock(p, blog);
        if ((chunk + block).length > 3500) {
          await this.bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
          chunk = '';
        }
        chunk += block + '\n';
      }
      if (chunk.trim()) {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    }
  }

  _formatPostBlock(p) {
    const dt = DateTime.fromISO(p.scheduled_for).setZone(env.tz);
    const when = dt.toFormat("ccc d LLL 'at' HH:mm");
    const hashtags = (p.hashtags || []).join(' ');
    return [
      `<b>${p.post_number}. ${escapeHtml(p.topic || 'Untitled')}</b>`,
      `<i>${escapeHtml(p.sector || 'General')} · ${escapeHtml(formatContentType(p.content_type))} · ${when}</i>`,
      '',
      escapeHtml(p.caption || ''),
      '',
      `<b>Hashtags:</b> ${escapeHtml(hashtags)}`,
      `<b>Image idea:</b> ${escapeHtml(p.image_description || '—')}`,
      ''
    ].join('\n');
  }

  _formatBlogBlock(p, blog) {
    const dt = DateTime.fromISO(p.scheduled_for).setZone(env.tz);
    const when = dt.toFormat("ccc d LLL 'at' HH:mm");
    const hashtags = (p.hashtags || []).join(' ');
    return [
      `<b>${p.post_number}. [BLOG] ${escapeHtml(p.topic || 'Untitled')}</b>`,
      `<i>${escapeHtml(p.sector || 'General')} · Blog promo · ${when}</i>`,
      '',
      `<b>Blog summary:</b>\n${escapeHtml(blog?.blog_description || '—')}`,
      '',
      `<b>Promo caption:</b>\n${escapeHtml(p.caption || '')}`,
      '',
      `<b>Hashtags:</b> ${escapeHtml(hashtags)}`,
      `<b>Image idea:</b> ${escapeHtml(p.image_description || '—')}`,
      `<b>Blog URL:</b> ${escapeHtml(blog?.url || '(use /seturl ' + p.post_number + ' <url>)')}`,
      ''
    ].join('\n');
  }

  _buildCaptionForZernio(post, blogsById) {
    const hashtags = (post.hashtags || []).join(' ');
    let body = post.caption || '';

    if (post.kind === 'blog_promo' && post.blog_id) {
      const blog = blogsById.get(post.blog_id);
      const url = blog?.url || BRAND.blog.siteBaseUrl;
      body = body.replace(/<BLOG_URL>/g, url);
      // If the template didn't have the token, append the URL on its own line.
      if (!/https?:\/\//.test(body)) body += `\n\n${url}`;
    }

    return [body, hashtags].filter(Boolean).join('\n\n').trim();
  }

  // -------------------- utilities --------------------

  async _sendLong(chatId, text) {
    const MAX = 4000;
    for (let i = 0; i < text.length; i += MAX) {
      await this.bot.sendMessage(chatId, text.slice(i, i + MAX), {
        parse_mode: 'HTML'
      });
    }
  }
}

// ---------------- caption rewrite helper (used by /edit text) --------

async function rewriteCaption({ original, instruction, post }) {
  const completion = await openai.chat.completions.create({
    model: env.openaiTextModel,
    temperature: 0.7,
    messages: [
      { role: 'system', content: PROMPTS.CAPTION_EDIT_SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Sector: ${post.sector}\nContent type: ${post.content_type}\n` +
          `Topic: ${post.topic}\n\nOriginal caption:\n${original}\n\n` +
          `Instruction: ${instruction}\n\nReturn only the new caption text.`
      }
    ]
  });
  return completion.choices?.[0]?.message?.content?.trim() || original;
}

function formatContentType(ct = '') {
  return String(ct).replace(/_/g, ' ');
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s = '', n = 60) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = TelegramService;
