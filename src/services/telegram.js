/**
 * Telegram service — multi-company workflow
 * -----------------------------------------
 *
 * The bot operates against ONE company at a time per chat. The
 * currently-selected company is persisted in Supabase settings
 * (`active_company:<chatId>`), so it survives restarts and deploys.
 *
 *   /company             — show current company + list of available ones
 *   /company strong      — switch to Strong Recruitment Group
 *   /company zentra      — switch to Zentra Peptides
 *
 *   /generate            — generate next month's calendar for the active company
 *   /calendar            — re-render the current calendar for the active company
 *   /status              — show post status for the active company
 *   /seturl <post#> <url>— set blog URL (only meaningful for companies with blog promos)
 *   /schedule            — schedule everything for the active company on Zernio
 *   /reset               — wipe the active company's current calendar
 *   /help                — show available commands (rendered for the active company)
 *
 * Image uploads (photo or image document) attach to the active
 * company's calendar. Captions can include the post number for
 * one-shot assignment.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');

const {
  env,
  getCompany,
  getDefaultCompany,
  listCompanies
} = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const openai = require('./openaiClient');

// Per-chat conversational state stored in memory.
//   { awaitingImageForPost, pendingImage, editingPostId, companySlug }
const chatState = new Map();

function getState(chatId) {
  let s = chatState.get(chatId);
  if (!s) {
    s = {
      awaitingImageForPost: null,
      pendingImage: null,
      editingPostId: null,
      companySlug: null
    };
    chatState.set(chatId, s);
  }
  return s;
}

class TelegramService {
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

    this.bot.on('message', (m) =>
      this._onMessage(m).catch((err) => {
        logger.error(
          { err: err.message, stack: err.stack },
          'message handler failed'
        );
      })
    );
    this.bot.on('polling_error', (err) =>
      logger.error({ err: err.message }, 'Telegram polling error')
    );

    this.bot
      .setMyCommands([
        { command: 'company',  description: 'Switch active company (e.g. /company zentra)' },
        { command: 'generate', description: "Generate next month's calendar for the active company" },
        { command: 'calendar', description: 'Show the current calendar' },
        { command: 'status',   description: 'Show which posts still need images' },
        { command: 'seturl',   description: '/seturl <post#> <url> — set a blog URL' },
        { command: 'schedule', description: 'Schedule all posts on Zernio' },
        { command: 'reset',    description: 'Wipe the active calendar' },
        { command: 'help',     description: 'Show available commands' }
      ])
      .catch(() => {});

    logger.info('Telegram bot started');
  }

  // -------------------- public sending helpers --------------------

  async sendInfo(text) {
    if (!this.bot) return;
    await this._sendLong(env.telegramChatId, text);
  }

  // -------------------- company selection --------------------

  async _getActiveCompany(chatId) {
    const state = getState(chatId);
    if (state.companySlug) {
      const c = getCompany(state.companySlug);
      if (c) return c;
    }
    // Fall back to persisted setting, then default.
    const persisted = await storage.getSetting(`active_company:${chatId}`);
    const c = (persisted && getCompany(persisted)) || getDefaultCompany();
    state.companySlug = c.slug;
    return c;
  }

  async _setActiveCompany(chatId, slug) {
    const c = getCompany(slug);
    if (!c) return null;
    const state = getState(chatId);
    state.companySlug = c.slug;
    state.awaitingImageForPost = null;
    state.pendingImage = null;
    state.editingPostId = null;
    await storage.setSetting(`active_company:${chatId}`, c.slug);
    return c;
  }

  // -------------------- command + message routing --------------------

  async _onMessage(msg) {
    if (!msg) return;
    if (String(msg.chat.id) !== String(env.telegramChatId)) {
      logger.warn(
        { chatId: msg.chat.id, expected: env.telegramChatId },
        'Ignoring message from non-allowlisted chat'
      );
      return;
    }

    if (msg.photo && msg.photo.length) return this._onPhoto(msg);
    if (msg.document && /^image\//.test(msg.document.mime_type || '')) {
      return this._onDocumentImage(msg);
    }

    if (!msg.text) return;
    const text = msg.text.trim();

    if (text.startsWith('/')) return this._handleCommand(msg, text);
    return this._handleFreeText(msg, text);
  }

  async _handleCommand(msg, text) {
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().split('@')[0];

    switch (cmd) {
      case '/start':
      case '/help':
        return this._cmdHelp(msg);
      case '/company':
        return this._cmdCompany(msg, args);
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
    const company = await this._getActiveCompany(msg.chat.id);
    const all = listCompanies();
    const lines = [
      `<b>Marketing Agent — Active company: ${escapeHtml(company.displayName)}</b>`,
      `<i>Platforms:</i> ${escapeHtml(company.platformOrderLabel)}`,
      '',
      '<b>Switch company</b>',
      ...all.map(
        (c) =>
          `  • <code>/company ${escapeHtml(c.slug)}</code> — ${escapeHtml(c.displayName)}${
            c.slug === company.slug ? ' (current)' : ''
          }`
      ),
      '',
      '<b>Workflow</b>',
      "1. /generate — I plan next month's content and send you the full calendar.",
      '2. You create each image in ChatGPT 5.5 and send them to me here.',
      '3. For each image I\'ll ask "which post number?" — reply with the number, or send the photo with the number as its caption.',
      '4. /status — see which posts still need an image.'
    ];
    if (company.monthly?.hasBlogPromos) {
      lines.push(
        '5. /seturl &lt;post#&gt; &lt;url&gt; — set the blog URL for a blog promo post.'
      );
    }
    lines.push(
      `${company.monthly?.hasBlogPromos ? '6' : '5'}. /schedule — once all images are attached, I schedule everything across ${escapeHtml(company.platformOrderLabel)} via Zernio.`,
      '',
      '<b>Other commands</b>',
      '/company — show / switch active company',
      '/calendar — re-send the current calendar',
      '/reset — wipe the active calendar and start over',
      '/cancel — cancel a pending image assignment'
    );
    await this.bot.sendMessage(msg.chat.id, lines.join('\n'), {
      parse_mode: 'HTML'
    });
  }

  async _cmdCompany(msg, args) {
    const current = await this._getActiveCompany(msg.chat.id);
    if (!args.length) {
      const all = listCompanies();
      const lines = [
        `<b>Active company:</b> ${escapeHtml(current.displayName)} (<code>${escapeHtml(current.slug)}</code>)`,
        `<i>Platforms:</i> ${escapeHtml(current.platformOrderLabel)}`,
        '',
        '<b>Available companies</b>',
        ...all.map(
          (c) =>
            `  • <code>/company ${escapeHtml(c.slug)}</code> — ${escapeHtml(c.displayName)}${
              c.slug === current.slug ? ' (current)' : ''
            }`
        )
      ];
      await this.bot.sendMessage(msg.chat.id, lines.join('\n'), {
        parse_mode: 'HTML'
      });
      return;
    }
    const slug = args[0].toLowerCase();
    const next = await this._setActiveCompany(msg.chat.id, slug);
    if (!next) {
      const known = listCompanies().map((c) => c.slug).join(', ');
      await this.bot.sendMessage(
        msg.chat.id,
        `Unknown company "${slug}". Known: ${known}.`
      );
      return;
    }
    await this.bot.sendMessage(
      msg.chat.id,
      `Switched active company to <b>${escapeHtml(next.displayName)}</b>.\n` +
        `Platforms: ${escapeHtml(next.platformOrderLabel)}\n\n` +
        'Send /generate to plan the next month, or /calendar to see the current one.',
      { parse_mode: 'HTML' }
    );
  }

  async _cmdGenerate(msg) {
    const company = await this._getActiveCompany(msg.chat.id);
    await this.bot.sendMessage(
      msg.chat.id,
      `Generating next month's content calendar for <b>${escapeHtml(company.displayName)}</b> — give me a moment…`,
      { parse_mode: 'HTML' }
    );
    try {
      const result = await this.calendar.generateCalendarForUpcomingMonth({
        company
      });
      await this._sendCalendar(msg.chat.id, result, company);
      await this.bot.sendMessage(
        msg.chat.id,
        'Calendar ready. Create each image in ChatGPT 5.5 and send them to me here. ' +
          "When you send a photo I'll ask which post number it's for — or you can " +
          'put the post number in the photo caption (e.g. send the photo with caption "3").'
      );
    } catch (err) {
      logger.error(
        { err: err.message, stack: err.stack, company: company.slug },
        'generate failed'
      );
      await this.bot.sendMessage(
        msg.chat.id,
        `Calendar generation failed for ${company.displayName}: ${err.message}`
      );
    }
  }

  async _cmdShowCalendar(msg) {
    const company = await this._getActiveCompany(msg.chat.id);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey) {
      await this.bot.sendMessage(
        msg.chat.id,
        `No calendar yet for ${company.displayName}. Send /generate to create next month's calendar.`
      );
      return;
    }
    const cal = await storage.getCalendar(monthKey, company.slug);
    const posts = await storage.listPostsByMonth(monthKey, company.slug);
    const blogs = await storage.listBlogsByMonth(monthKey, company.slug);
    const monthName = cal?.raw?.month || monthKey;
    await this._sendCalendar(
      msg.chat.id,
      { monthKey, monthName, posts, blogs, company: company.slug },
      company
    );
  }

  async _cmdStatus(msg) {
    const company = await this._getActiveCompany(msg.chat.id);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey) {
      await this.bot.sendMessage(
        msg.chat.id,
        `No active calendar for ${company.displayName}.`
      );
      return;
    }
    const posts = await storage.listPostsByMonth(monthKey, company.slug);
    if (!posts.length) {
      await this.bot.sendMessage(
        msg.chat.id,
        `No posts found for ${company.displayName}'s active calendar.`
      );
      return;
    }

    const lines = [
      `<b>${escapeHtml(company.displayName)} — Status — ${escapeHtml(monthKey)}</b>`,
      ''
    ];
    const missing = [];
    const scheduled = [];
    for (const p of posts) {
      const tag = p.kind === 'blog_promo' ? 'BLOG' : 'POST';
      const dt = DateTime.fromISO(p.scheduled_for).setZone(env.tz);
      const when = dt.toFormat('ccc d LLL HH:mm');
      let icon;
      if (p.status === 'scheduled') {
        icon = '✅';
        scheduled.push(p.post_number);
      } else if (p.status === 'image_attached') {
        icon = '🖼';
      } else if (p.status === 'schedule_failed') {
        icon = '⚠️';
      } else {
        icon = '⏳';
        missing.push(p.post_number);
      }
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
    await this.bot.sendMessage(msg.chat.id, lines.join('\n'), {
      parse_mode: 'HTML'
    });
  }

  async _cmdSetUrl(msg, args) {
    const company = await this._getActiveCompany(msg.chat.id);
    if (!company.monthly?.hasBlogPromos) {
      await this.bot.sendMessage(
        msg.chat.id,
        `${company.displayName} doesn't use blog promo posts, so /seturl doesn't apply.`
      );
      return;
    }
    const [postNumStr, url] = args;
    const postNum = parseInt(postNumStr, 10);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey || !postNum || !url) {
      await this.bot.sendMessage(
        msg.chat.id,
        'Usage: <code>/seturl &lt;post#&gt; &lt;url&gt;</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    const post = await storage.getPostByNumber(monthKey, postNum, company.slug);
    if (!post) {
      await this.bot.sendMessage(
        msg.chat.id,
        `No post #${postNum} in the active ${company.displayName} calendar.`
      );
      return;
    }
    if (post.kind !== 'blog_promo' || !post.blog_id) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Post #${postNum} is not a blog promo. /seturl only applies to blog posts.`
      );
      return;
    }
    await storage.updateBlog(post.blog_id, { url });
    await this.bot.sendMessage(
      msg.chat.id,
      `Blog URL for post #${postNum} set to ${escapeHtml(url)}.`,
      { parse_mode: 'HTML' }
    );
  }

  async _cmdSchedule(msg) {
    const company = await this._getActiveCompany(msg.chat.id);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey) {
      await this.bot.sendMessage(
        msg.chat.id,
        `No active calendar to schedule for ${company.displayName}.`
      );
      return;
    }
    const posts = await storage.listPostsByMonth(monthKey, company.slug);
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
      `Scheduling ${posts.length} ${escapeHtml(company.displayName)} posts across ${escapeHtml(company.platformOrderLabel)}…`,
      { parse_mode: 'HTML' }
    );

    const blogs = await storage.listBlogsByMonth(monthKey, company.slug);
    const blogsById = new Map(blogs.map((b) => [b.id, b]));

    let okCount = 0;
    const failures = [];
    for (const p of posts) {
      if (p.status === 'scheduled') {
        okCount++;
        continue;
      }
      try {
        await storage.updatePost(p.id, {
          status: 'scheduling',
          schedule_error: null
        });

        const caption = this._buildCaptionForZernio(p, blogsById, company);
        const result = await this.zernio.schedulePost({
          caption,
          scheduledForIso: p.scheduled_for,
          platforms:
            p.platforms && p.platforms.length
              ? p.platforms
              : company.brand.defaultPlatforms,
          imageUrl: p.image_url,
          hashtags: p.hashtags || [],
          timezone: env.tz,
          company
        });
        const zernioId =
          result?.id || result?.postId || result?.data?.id || null;
        await storage.updatePost(p.id, {
          status: 'scheduled',
          zernio_post_id: zernioId
        });
        okCount++;
      } catch (err) {
        logger.error(
          { err: err.message, postNumber: p.post_number, company: company.slug },
          'Schedule failed for post'
        );
        await storage.updatePost(p.id, {
          status: 'schedule_failed',
          schedule_error: err.message
        });
        failures.push({ number: p.post_number, error: err.message });
      }
    }

    if (!failures.length) {
      await storage.updateCalendarStatus(monthKey, 'scheduled', company.slug);
      await this.bot.sendMessage(
        msg.chat.id,
        `All ${okCount} ${escapeHtml(company.displayName)} posts scheduled successfully on Zernio across ${escapeHtml(company.platformOrderLabel)}.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await this.bot.sendMessage(
        msg.chat.id,
        `Scheduled ${okCount} of ${posts.length} for ${company.displayName}. ` +
          `Failures:\n` +
          failures
            .map((f) => `  • Post ${f.number}: ${f.error}`)
            .join('\n') +
          `\n\nFix and run /schedule again to retry the failed ones.`
      );
    }
  }

  async _cmdReset(msg) {
    const company = await this._getActiveCompany(msg.chat.id);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey) {
      await this.bot.sendMessage(
        msg.chat.id,
        `Nothing to reset for ${company.displayName}.`
      );
      return;
    }
    await storage.deletePostsForMonth(monthKey, company.slug);
    await storage.deleteBlogsForMonth(monthKey, company.slug);
    await storage.setCompanySetting('last_calendar_month', '', company.slug);
    const state = getState(msg.chat.id);
    state.awaitingImageForPost = null;
    state.pendingImage = null;
    state.editingPostId = null;
    await this.bot.sendMessage(
      msg.chat.id,
      `Wiped ${company.displayName}'s active calendar (${monthKey}). Send /generate to start fresh.`
    );
  }

  // -------------------- photo handling --------------------

  async _onPhoto(msg) {
    const photo = msg.photo[msg.photo.length - 1];
    const captionNum = parseInt((msg.caption || '').trim(), 10);

    const saved = await this._saveTelegramFile(photo.file_id, 'jpg');
    if (!saved) return;

    if (Number.isInteger(captionNum)) {
      await this._assignImageToPost(msg.chat.id, captionNum, saved);
      return;
    }

    const state = getState(msg.chat.id);
    state.pendingImage = saved;
    state.awaitingImageForPost = null;

    const company = await this._getActiveCompany(msg.chat.id);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    const posts = monthKey ? await storage.listPostsByMonth(monthKey, company.slug) : [];
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
      `Got it. (Active company: ${company.displayName}.) Which post number is this image for? Reply with a number 1-${
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

    const company = await this._getActiveCompany(msg.chat.id);
    await this.bot.sendMessage(
      msg.chat.id,
      `Got the image. (Active company: ${company.displayName}.) Which post number is this for? Reply with a number, or /cancel.`
    );
  }

  async _handleFreeText(msg, text) {
    const state = getState(msg.chat.id);

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

    if (state.editingPostId) {
      const post = await storage.getPost(state.editingPostId);
      state.editingPostId = null;
      if (!post) return;
      let newCaption = text;
      if (text.toLowerCase().startsWith('!ai')) {
        const instruction = text.slice(3).trim();
        try {
          const company =
            getCompany(post.company) || (await this._getActiveCompany(msg.chat.id));
          newCaption = await rewriteCaption({
            original: post.caption,
            instruction,
            post,
            company
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
      await storage.updatePost(post.id, { caption: newCaption });
      await this.bot.sendMessage(
        msg.chat.id,
        `Caption updated for post #${post.post_number}.`
      );
      return;
    }
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
    const company = await this._getActiveCompany(chatId);
    const monthKey = await storage.getCompanySetting(
      'last_calendar_month',
      company.slug
    );
    if (!monthKey) {
      await this.bot.sendMessage(
        chatId,
        `No active calendar for ${company.displayName}.`
      );
      return;
    }
    const post = await storage.getPostByNumber(monthKey, postNumber, company.slug);
    if (!post) {
      await this.bot.sendMessage(
        chatId,
        `No post #${postNumber} in the active ${company.displayName} calendar. Send a number from the calendar.`
      );
      return;
    }
    await storage.updatePost(post.id, {
      image_path: saved.filePath,
      image_url: saved.publicUrl,
      image_telegram_file_id: saved.fileId,
      status: 'image_attached'
    });

    const posts = await storage.listPostsByMonth(monthKey, company.slug);
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
      `Image attached to ${company.displayName} post #${postNumber} (${escapeHtml(post.topic || post.sector)}).${trailer}`,
      { parse_mode: 'HTML' }
    );
  }

  // -------------------- calendar rendering ---

  async _sendCalendar(chatId, { monthKey, monthName, posts, blogs }, companyArg) {
    // Resolve the company so headers / labels render correctly. If a
    // caller didn't pass one (e.g. cron), infer from the first post.
    let company = companyArg;
    if (!company) {
      const slug = (posts && posts[0] && posts[0].company) || null;
      company = (slug && getCompany(slug)) || getDefaultCompany();
    }

    const header = [
      `<b>📅 ${escapeHtml(company.displayName)} — ${escapeHtml(monthName || monthKey)} content calendar</b>`,
      `Channels: ${escapeHtml(company.platformOrderLabel)}`,
      ''
    ].join('\n');
    await this.bot.sendMessage(chatId, header, { parse_mode: 'HTML' });

    const social = posts.filter((p) => p.kind === 'social');
    const blogPromo = posts.filter((p) => p.kind === 'blog_promo');
    const blogsById = new Map((blogs || []).map((b) => [b.id, b]));

    let chunk = '<b>Social posts</b>\n\n';
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

  _buildCaptionForZernio(post, blogsById, company) {
    const hashtags = (post.hashtags || []).join(' ');
    let body = post.caption || '';

    if (post.kind === 'blog_promo' && post.blog_id) {
      const blog = blogsById.get(post.blog_id);
      const url = blog?.url || company.brand.blog?.siteBaseUrl || '';
      body = body.replace(/<BLOG_URL>/g, url);
      if (url && !/https?:\/\//.test(body)) body += `\n\n${url}`;
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

async function rewriteCaption({ original, instruction, post, company }) {
  const cfg = company || getDefaultCompany();
  const completion = await openai.chat.completions.create({
    model: env.openaiTextModel,
    temperature: 0.7,
    messages: [
      { role: 'system', content: cfg.prompts.CAPTION_EDIT_SYSTEM_PROMPT },
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
