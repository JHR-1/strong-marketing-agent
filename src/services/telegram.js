/**
 * Telegram service
 * ----------------
 * Implements the human-in-the-loop approval flow.
 *
 *   Agent -> Telegram:
 *      Photo + caption + inline buttons [Approve] [Reject] [Edit Caption]
 *
 *   User taps Approve   -> we schedule on Zernio
 *   User taps Reject    -> we mark the post 'rejected' and skip
 *   User taps Edit Cap. -> we set state 'awaiting_edit', user replies
 *                          with new text, we update + ask for approval again
 */

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { DateTime } = require('luxon');

const { env, BRAND, PROMPTS } = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const openai = require('./openaiClient');

class TelegramService {
  /**
   * @param {object} deps
   * @param {object} deps.zernio - zernio service module
   */
  constructor({ zernio }) {
    this.zernio = zernio;
    this.bot = null;
    this.editingFor = new Map(); // chatId -> postId waiting for new caption
  }

  start() {
    if (!env.telegramBotToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram service disabled');
      return;
    }
    this.bot = new TelegramBot(env.telegramBotToken, { polling: true });

    this.bot.on('callback_query', (q) => this._onCallback(q));
    this.bot.on('message', (m) => this._onMessage(m));
    this.bot.on('polling_error', (err) =>
      logger.error({ err: err.message }, 'Telegram polling error')
    );

    this.bot.setMyCommands([
      { command: 'status', description: 'Show pending posts' },
      { command: 'help', description: 'Show available commands' },
      { command: 'generate', description: "Generate next month's calendar now" }
    ]).catch(() => {});

    logger.info('Telegram bot started');
  }

  // --------------------------- public API ---------------------------

  async sendPostForApproval({ post, imagePath, imageUrl }) {
    if (!this.bot) {
      logger.warn('Telegram not initialised — cannot send for approval');
      return null;
    }

    const caption = this._formatApprovalCaption(post);

    let msg;
    try {
      const stream = fs.createReadStream(imagePath);
      msg = await this.bot.sendPhoto(env.telegramChatId, stream, {
        caption,
        parse_mode: 'HTML',
        reply_markup: this._approvalKeyboard(post.id)
      });
    } catch (err) {
      logger.error({ err: err.message, postId: post.id }, 'sendPhoto failed, retrying with URL');
      msg = await this.bot.sendPhoto(env.telegramChatId, imageUrl, {
        caption,
        parse_mode: 'HTML',
        reply_markup: this._approvalKeyboard(post.id)
      });
    }
    return msg.message_id;
  }

  async sendBlogSummary({ monthName, year, blogs }) {
    if (!this.bot) return;
    let text = `<b>Blog outlines for ${monthName} ${year}</b>\n\n`;
    blogs.forEach((b, i) => {
      text += `<b>${i + 1}. ${escapeHtml(b.title)}</b>\n`;
      text += `Tone: ${escapeHtml(b.tone || 'Professional')} · ~${
        b.target_word_count || 900
      } words\n`;
      (b.outline || []).forEach((s, j) => {
        text += `  ${j + 1}. ${escapeHtml(s)}\n`;
      });
      text += '\n';
    });
    await this.bot.sendMessage(env.telegramChatId, text, { parse_mode: 'HTML' });
  }

  async sendInfo(text) {
    if (!this.bot) return;
    await this.bot.sendMessage(env.telegramChatId, text, { parse_mode: 'HTML' });
  }

  // --------------------------- internals ----------------------------

  _approvalKeyboard(postId) {
    return {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: `approve:${postId}` },
          { text: 'Reject', callback_data: `reject:${postId}` },
          { text: 'Edit Caption', callback_data: `edit:${postId}` }
        ]
      ]
    };
  }

  _formatApprovalCaption(post) {
    const dt = DateTime.fromISO(post.scheduled_for).setZone(env.tz);
    const when = dt.toFormat("ccc d LLL yyyy 'at' HH:mm 'UK'");
    const platforms = (post.platforms || []).join(', ');
    return [
      `<b>${escapeHtml(post.headline)}</b>`,
      `<i>${escapeHtml(post.sector)} · ${escapeHtml(post.content_type)}</i>`,
      `Scheduled: <b>${when}</b>`,
      `Channels: ${escapeHtml(platforms)}`,
      '',
      escapeHtml(post.caption)
    ].join('\n').slice(0, 1024); // Telegram caption hard limit
  }

  async _onCallback(query) {
    try {
      const [action, postId] = (query.data || '').split(':');
      const post = storage.getPost(postId);
      if (!post) {
        await this.bot.answerCallbackQuery(query.id, {
          text: 'Post not found.',
          show_alert: true
        });
        return;
      }

      if (action === 'approve') {
        await this._handleApprove(query, post);
      } else if (action === 'reject') {
        await this._handleReject(query, post);
      } else if (action === 'edit') {
        await this._handleEditRequest(query, post);
      } else {
        await this.bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'callback_query handler failed');
      try {
        await this.bot.answerCallbackQuery(query.id, {
          text: 'Error: ' + err.message,
          show_alert: true
        });
      } catch (_) { /* ignore */ }
    }
  }

  async _handleApprove(query, post) {
    await this.bot.answerCallbackQuery(query.id, { text: 'Scheduling…' });

    try {
      const result = await this.zernio.schedulePost({
        caption: post.caption,
        scheduledForIso: post.scheduled_for,
        platforms: post.platforms,
        imageUrl: post.image_url
      });

      const zernioId = result?.id || result?.postId || result?.data?.id || null;
      storage.updatePost(post.id, {
        status: 'scheduled',
        zernio_post_id: zernioId
      });

      const dt = DateTime.fromISO(post.scheduled_for).setZone(env.tz);
      await this.bot.editMessageCaption(
        `<b>Scheduled</b> for ${dt.toFormat("ccc d LLL 'at' HH:mm")} UK\n` +
          `${escapeHtml(post.headline)}\n` +
          (zernioId ? `Zernio ID: <code>${zernioId}</code>` : ''),
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'HTML'
        }
      );
    } catch (err) {
      storage.updatePost(post.id, { status: 'schedule_failed' });
      await this.bot.sendMessage(
        query.message.chat.id,
        `Failed to schedule on Zernio: ${err.message}`
      );
    }
  }

  async _handleReject(query, post) {
    storage.updatePost(post.id, { status: 'rejected' });
    await this.bot.answerCallbackQuery(query.id, { text: 'Rejected' });
    await this.bot.editMessageCaption(
      `<b>Rejected</b>\n${escapeHtml(post.headline)}`,
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML'
      }
    );
  }

  async _handleEditRequest(query, post) {
    this.editingFor.set(query.message.chat.id, post.id);
    storage.updatePost(post.id, { status: 'awaiting_edit' });
    await this.bot.answerCallbackQuery(query.id, { text: 'Send the new caption' });
    await this.bot.sendMessage(
      query.message.chat.id,
      `Send the new caption for <b>${escapeHtml(post.headline)}</b>.\n` +
        `Reply with <code>/cancel</code> to abort. ` +
        `Prefix with <code>!ai</code> to ask the model to rewrite, e.g. ` +
        `<code>!ai shorten and add a stronger CTA</code>.`,
      { parse_mode: 'HTML' }
    );
  }

  async _onMessage(msg) {
    if (!msg.text) return;
    if (String(msg.chat.id) !== String(env.telegramChatId)) return;

    const text = msg.text.trim();

    // Slash commands
    if (text.startsWith('/')) return this._handleCommand(msg, text);

    // Caption-edit mode?
    const postId = this.editingFor.get(msg.chat.id);
    if (!postId) return;

    const post = storage.getPost(postId);
    if (!post) {
      this.editingFor.delete(msg.chat.id);
      return;
    }

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
        return;
      }
    }

    storage.updatePost(post.id, {
      caption: newCaption,
      status: 'awaiting_approval'
    });
    this.editingFor.delete(msg.chat.id);

    // Re-send for approval with new caption (image unchanged)
    await this.bot.sendMessage(
      msg.chat.id,
      'Caption updated. Re-sending for approval…'
    );

    const newCaptionFmt = this._formatApprovalCaption({ ...post, caption: newCaption });
    const sent = await this.bot.sendPhoto(msg.chat.id, post.image_url, {
      caption: newCaptionFmt,
      parse_mode: 'HTML',
      reply_markup: this._approvalKeyboard(post.id)
    });
    storage.updatePost(post.id, { telegram_message_id: sent.message_id });
  }

  async _handleCommand(msg, text) {
    const cmd = text.split(/\s+/)[0].toLowerCase();
    if (cmd === '/cancel') {
      this.editingFor.delete(msg.chat.id);
      await this.bot.sendMessage(msg.chat.id, 'Edit cancelled.');
      return;
    }
    if (cmd === '/status') {
      const counts = storage.countByStatus();
      const summary = counts.length
        ? counts.map((c) => `${c.status}: ${c.count}`).join('\n')
        : 'No posts yet.';
      await this.bot.sendMessage(msg.chat.id, `<b>Posts</b>\n${escapeHtml(summary)}`, {
        parse_mode: 'HTML'
      });
      return;
    }
    if (cmd === '/help') {
      await this.bot.sendMessage(
        msg.chat.id,
        '<b>Commands</b>\n' +
          '/status - show post counts by status\n' +
          '/generate - generate next month\'s calendar now\n' +
          '/cancel - cancel a pending caption edit\n\n' +
          'When approving a post, tap [Edit Caption] and send your new ' +
          'text, or prefix with <code>!ai</code> to ask the model to rewrite it.',
        { parse_mode: 'HTML' }
      );
      return;
    }
    if (cmd === '/generate') {
      await this.bot.sendMessage(msg.chat.id, 'Triggering calendar generation…');
      try {
        // Lazy require to avoid circular dependency
        const calendar = require('./calendar');
        const imageGen = require('./imageGen');
        await calendar.generateCalendarForUpcomingMonth({
          imageGen,
          telegram: this
        });
        await this.bot.sendMessage(msg.chat.id, 'Calendar generated.');
      } catch (err) {
        await this.bot.sendMessage(
          msg.chat.id,
          `Generation failed: ${err.message}`
        );
      }
      return;
    }
  }
}

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
          `Headline: ${post.headline}\n\n` +
          `Original caption:\n${original}\n\n` +
          `Instruction: ${instruction}\n\nReturn only the new caption text.`
      }
    ]
  });
  return completion.choices?.[0]?.message?.content?.trim() || original;
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = TelegramService;
