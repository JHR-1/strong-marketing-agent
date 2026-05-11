/**
 * Supabase-backed persistence — multi-company aware.
 *
 * Tables (see sql/schema.sql + sql/migrations/0001_multi_company.sql):
 *   calendars  — one row per (company, month_key) generated calendar
 *   posts      — every social post (incl. blog promo posts), scoped by
 *                company + month_key
 *   blogs      — blog records, scoped by company + month_key
 *   settings   — misc key/value (company-scoped via "<key>:<company>"
 *                naming convention — see setCompanySetting/getCompanySetting)
 *
 * All tables have a `company` TEXT column. For backwards compatibility
 * with the original single-company schema:
 *   - Rows missing a `company` value are treated as belonging to the
 *     default company (Strong Recruitment Group).
 *   - All exported helpers accept an optional `company` parameter and
 *     default it to the DEFAULT_COMPANY_SLUG so callers that haven't
 *     migrated to the multi-company API keep returning the same data.
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { env, companies } = require('../config');
const logger = require('./logger');

const DEFAULT_COMPANY = companies.DEFAULT_COMPANY_SLUG;

let client;

function getClient() {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error(
      'Supabase is not configured: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required'
    );
  }
  client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
  });
  logger.info({ url: env.supabaseUrl }, 'Supabase client initialised');
  return client;
}

/**
 * Lightweight connectivity check used at startup so we fail fast if
 * the Supabase project is unreachable or the service key is wrong.
 */
async function getDb() {
  const c = getClient();
  const { error } = await c
    .from('settings')
    .select('key', { count: 'exact', head: true });
  if (error) {
    logger.error(
      { err: error.message, code: error.code },
      'Supabase connectivity check failed'
    );
    throw new Error(`Supabase connectivity check failed: ${error.message}`);
  }
  logger.info('Supabase connection OK');
  return c;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function _normCompany(slug) {
  if (!slug) return DEFAULT_COMPANY;
  const s = String(slug).toLowerCase().trim();
  return s || DEFAULT_COMPANY;
}

/**
 * Apply a company filter that ALSO matches legacy rows where the
 * `company` column is NULL (pre-migration data, treated as the default
 * company).
 */
function _applyCompanyFilter(query, company) {
  if (company === DEFAULT_COMPANY) {
    return query.or(`company.eq.${company},company.is.null`);
  }
  return query.eq('company', company);
}

// ------------------------- calendars -----------------------------
async function saveCalendar(monthKey, payload, status = 'awaiting_images', company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();

  // Need an upsert keyed on (company, month_key). Postgres unique
  // constraint is set up by the migration. We use onConflict with the
  // composite key when available, falling back to manual upsert
  // semantics if the older single-column unique still exists.
  const row = {
    company,
    month_key: monthKey,
    raw_json: payload,
    status,
    created_at: new Date().toISOString()
  };

  // Try composite-key upsert first.
  let { data, error } = await c
    .from('calendars')
    .upsert(row, { onConflict: 'company,month_key' })
    .select('id')
    .single();

  if (error && /no unique|conflict/i.test(error.message)) {
    // Fallback for environments that haven't run the migration yet:
    // delete-then-insert so we don't lose data.
    await c
      .from('calendars')
      .delete()
      .eq('company', company)
      .eq('month_key', monthKey);
    const ins = await c.from('calendars').insert(row).select('id').single();
    data = ins.data;
    error = ins.error;
  }
  if (error) throw new Error(`saveCalendar failed: ${error.message}`);
  return data.id;
}

async function getCalendar(monthKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { data, error } = await _applyCompanyFilter(
    c.from('calendars').select('*').eq('month_key', monthKey),
    company
  ).maybeSingle();
  if (error) throw new Error(`getCalendar failed: ${error.message}`);
  if (!data) return null;
  return { ...data, raw: data.raw_json };
}

async function updateCalendarStatus(monthKey, status, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { error } = await _applyCompanyFilter(
    c.from('calendars').update({ status }).eq('month_key', monthKey),
    company
  );
  if (error) throw new Error(`updateCalendarStatus failed: ${error.message}`);
}

// ------------------------- posts ---------------------------------
async function insertPost(post) {
  const c = getClient();
  const company = _normCompany(post.company);
  const row = {
    kind: 'social',
    blog_id: null,
    sector: null,
    content_type: null,
    topic: null,
    caption: null,
    image_description: null,
    ...post,
    company,
    hashtags_json: post.hashtags || [],
    platforms_json: post.platforms || [],
    status: post.status || 'awaiting_image'
  };
  delete row.hashtags;
  delete row.platforms;

  const { error } = await c.from('posts').insert(row);
  if (error) throw new Error(`insertPost failed: ${error.message}`);
}

async function updatePost(id, patch) {
  if (!patch || !Object.keys(patch).length) return;
  const c = getClient();
  const updates = { ...patch, updated_at: new Date().toISOString() };
  const { error } = await c.from('posts').update(updates).eq('id', id);
  if (error) throw new Error(`updatePost failed: ${error.message}`);
}

async function getPost(id) {
  const c = getClient();
  const { data, error } = await c
    .from('posts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getPost failed: ${error.message}`);
  if (!data) return null;
  return hydratePost(data);
}

async function getPostByNumber(monthKey, postNumber, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { data, error } = await _applyCompanyFilter(
    c
      .from('posts')
      .select('*')
      .eq('month_key', monthKey)
      .eq('post_number', postNumber),
    company
  ).maybeSingle();
  if (error) throw new Error(`getPostByNumber failed: ${error.message}`);
  if (!data) return null;
  return hydratePost(data);
}

async function listPostsByMonth(monthKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { data, error } = await _applyCompanyFilter(
    c.from('posts').select('*').eq('month_key', monthKey),
    company
  ).order('post_number', { ascending: true });
  if (error) throw new Error(`listPostsByMonth failed: ${error.message}`);
  return (data || []).map(hydratePost);
}

async function listPostsByStatus(status, company = null) {
  const c = getClient();
  let q = c.from('posts').select('*').eq('status', status);
  if (company) {
    q = _applyCompanyFilter(q, _normCompany(company));
  }
  const { data, error } = await q.order('scheduled_for', { ascending: true });
  if (error) throw new Error(`listPostsByStatus failed: ${error.message}`);
  return (data || []).map(hydratePost);
}

async function countByStatus(company = null) {
  const c = getClient();
  let q = c.from('posts').select('status,company');
  if (company) {
    q = _applyCompanyFilter(q, _normCompany(company));
  }
  const { data, error } = await q;
  if (error) throw new Error(`countByStatus failed: ${error.message}`);
  const tally = new Map();
  for (const row of data || []) {
    tally.set(row.status, (tally.get(row.status) || 0) + 1);
  }
  return Array.from(tally.entries()).map(([status, count]) => ({
    status,
    count
  }));
}

async function deletePostsForMonth(monthKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { error } = await _applyCompanyFilter(
    c.from('posts').delete().eq('month_key', monthKey),
    company
  );
  if (error) throw new Error(`deletePostsForMonth failed: ${error.message}`);
}

/**
 * Retrieve a compact history of every previously generated post for a
 * given company (optionally excluding the given month).
 */
async function listPastPostsHistory({
  excludeMonthKey = null,
  limit = 200,
  company = DEFAULT_COMPANY
} = {}) {
  company = _normCompany(company);
  const c = getClient();
  let query = c
    .from('posts')
    .select(
      'month_key, post_number, kind, sector, content_type, topic, caption, hashtags_json, company'
    )
    .order('month_key', { ascending: false })
    .order('post_number', { ascending: true })
    .limit(limit);
  query = _applyCompanyFilter(query, company);
  if (excludeMonthKey) query = query.neq('month_key', excludeMonthKey);
  const { data, error } = await query;
  if (error) throw new Error(`listPastPostsHistory failed: ${error.message}`);
  return (data || []).map((row) => ({
    month_key: row.month_key,
    post_number: row.post_number,
    kind: row.kind,
    sector: row.sector,
    content_type: row.content_type,
    topic: row.topic,
    caption: row.caption,
    hashtags: parseJsonField(row.hashtags_json)
  }));
}

function hydratePost(row) {
  return {
    ...row,
    company: row.company || DEFAULT_COMPANY,
    hashtags: parseJsonField(row.hashtags_json),
    platforms: parseJsonField(row.platforms_json)
  };
}

function parseJsonField(value) {
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

// ------------------------- blogs ---------------------------------
async function insertBlog(blog) {
  const c = getClient();
  const row = {
    url: null,
    blog_description: null,
    topic: null,
    ...blog,
    company: _normCompany(blog.company)
  };
  const { data, error } = await c
    .from('blogs')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`insertBlog failed: ${error.message}`);
  return data.id;
}

async function updateBlog(id, patch) {
  if (!patch || !Object.keys(patch).length) return;
  const c = getClient();
  const { error } = await c.from('blogs').update(patch).eq('id', id);
  if (error) throw new Error(`updateBlog failed: ${error.message}`);
}

async function listBlogsByMonth(monthKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { data, error } = await _applyCompanyFilter(
    c.from('blogs').select('*').eq('month_key', monthKey),
    company
  ).order('id', { ascending: true });
  if (error) throw new Error(`listBlogsByMonth failed: ${error.message}`);
  return data || [];
}

async function deleteBlogsForMonth(monthKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const c = getClient();
  const { error } = await _applyCompanyFilter(
    c.from('blogs').delete().eq('month_key', monthKey),
    company
  );
  if (error) throw new Error(`deleteBlogsForMonth failed: ${error.message}`);
}

// ------------------------- settings ------------------------------
async function setSetting(key, value) {
  const c = getClient();
  const { error } = await c
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`setSetting failed: ${error.message}`);
}

async function getSetting(key) {
  const c = getClient();
  const { data, error } = await c
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`getSetting failed: ${error.message}`);
  return data ? data.value : null;
}

/**
 * Company-scoped settings: stored under the key `<base>:<company>`.
 * For the default company we also fall back to the un-scoped legacy
 * key when reading, so pre-migration settings (e.g.
 * `last_calendar_month`) keep working without manual backfill.
 */
async function setCompanySetting(baseKey, value, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  await setSetting(`${baseKey}:${company}`, value);
  // Mirror to the legacy un-scoped key for the default company so any
  // un-migrated callers (and the existing Strong dashboards) keep
  // seeing the right values.
  if (company === DEFAULT_COMPANY) {
    await setSetting(baseKey, value);
  }
}

async function getCompanySetting(baseKey, company = DEFAULT_COMPANY) {
  company = _normCompany(company);
  const scoped = await getSetting(`${baseKey}:${company}`);
  if (scoped != null && scoped !== '') return scoped;
  if (company === DEFAULT_COMPANY) {
    return getSetting(baseKey);
  }
  return null;
}

module.exports = {
  getDb,
  DEFAULT_COMPANY,
  // calendars
  saveCalendar,
  getCalendar,
  updateCalendarStatus,
  // posts
  insertPost,
  updatePost,
  getPost,
  getPostByNumber,
  listPostsByMonth,
  listPostsByStatus,
  countByStatus,
  deletePostsForMonth,
  listPastPostsHistory,
  // blogs
  insertBlog,
  updateBlog,
  listBlogsByMonth,
  deleteBlogsForMonth,
  // settings
  setSetting,
  getSetting,
  setCompanySetting,
  getCompanySetting
};
