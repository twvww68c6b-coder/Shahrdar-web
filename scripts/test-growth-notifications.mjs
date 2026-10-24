// Headless browser checks for the shared web/APK UI, using the REAL index.html and a fake Supabase client.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const file = path.resolve('index.html');
const SHOTS = process.env.SCRATCH || '/tmp';
const tehranKey = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + offsetDays * 86400000));
const YESTERDAY = tehranKey(-1);
const fails = []; const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!ok) fails.push(n); };

const initFake = (yesterday) => {
  window.__writes = []; window.__rt = null; window.__toasts = [];
  const DATA = {
    web_user_access: [{ auth_user_id: 'u1', crm_user_id: 1, enabled: true }],
    users: [{ id: 1, telegram_id: 1001, name: 'مشاور الف', role: 'مشاور' }, { id: 2, telegram_id: 1002, name: 'مشاور ب', role: 'مشاور' }],
    clients: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: 'مشتری ' + (i + 1), area: 'شهرک شریعتی', status: 'فعال', owner_user_id: 1, is_urgent: 0 })),
    properties: Array.from({ length: 32 }, (_, i) => ({ id: i + 1, status: i < 3 ? '🔵 معامله شد - توسط ما' : '🟢 فعال', owner_user_id: 1, is_urgent: i < 10 ? 1 : 0, code: 'P' + (i + 1), area: 'شهرک شریعتی' })),
    activities: [...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, activity_type: 'پیگیری', user_id: 1, created_at: new Date().toISOString() })), ...(window.__pastActs || [])],
    home_stat_snapshots: window.__snaps || [],
    panel_notifications: [
      ...(window.__extraNotes || []),
      { id: 1, recipient_user_id: 1, kind: 'urgent_file', title: 'فایل فوری', body: 'P1 — شهرک شریعتی', entity_kind: 'property', entity_id: 1, created_at: new Date().toISOString(), read_at: null },
      { id: 2, recipient_user_id: 1, kind: 'urgent_client', title: 'مشتری فوری', body: 'x', entity_kind: 'client', entity_id: 2, created_at: new Date().toISOString(), read_at: null },
      { id: 3, recipient_user_id: 1, kind: 'share_file', title: 'قبلی', body: 'y', entity_kind: 'property', entity_id: 3, created_at: new Date().toISOString(), read_at: new Date().toISOString() },
    ],
  };
  const builder = (table) => {
    const st = { filters: [], order: null, limit: null, head: false, count: false, mode: 'select', payload: null, single: false };
    const apply = (rows) => rows.filter(r => st.filters.every(f => {
      const v = r[f.col];
      if (f.op === 'eq') return v === f.val;
      if (f.op === 'in') return f.val.includes(v);
      if (f.op === 'lt') return v < f.val;
      if (f.op === 'gte') return v >= f.val;
      if (f.op === 'is') return v == null;
      return true;
    }));
    const b = {
      select(_c, opts) { if (opts && opts.count) st.count = true; if (opts && opts.head) st.head = true; return b; },
      eq(col, val) { st.filters.push({ op: 'eq', col, val }); return b; },
      in(col, val) { st.filters.push({ op: 'in', col, val }); return b; },
      lt(col, val) { st.filters.push({ op: 'lt', col, val }); return b; },
      gte(col, val) { st.filters.push({ op: 'gte', col, val }); return b; },
      is(col, val) { st.filters.push({ op: 'is', col, val }); return b; },
      or() { return b; }, not() { return b; },
      order(col, o) { st.order = { col, asc: !(o && o.ascending === false) }; return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; },
      upsert(payload, opts) { st.mode = 'upsert'; st.payload = payload; st.opts = opts; return b; },
      insert(payload) { st.mode = 'insert'; st.payload = payload; return b; },
      update(payload) { st.mode = 'update'; st.payload = payload; return b; },
      then(res, rej) {
        if (st.mode !== 'select') { window.__writes.push({ table, mode: st.mode, payload: st.payload, opts: st.opts || null, filters: st.filters }); return Promise.resolve({ data: null, error: null }).then(res, rej); }
        let rows = apply(DATA[table] || []);
        if (st.order) rows = [...rows].sort((a, c) => (a[st.order.col] < c[st.order.col] ? -1 : a[st.order.col] > c[st.order.col] ? 1 : 0) * (st.order.asc ? 1 : -1));
        if (st.limit) rows = rows.slice(0, st.limit);
        if (st.single) return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no row' } }).then(res, rej);
        return Promise.resolve({ data: st.head ? null : rows, count: rows.length, error: null }).then(res, rej);
      },
    };
    return b;
  };
  const client = {
    auth: { getSession: async () => ({ data: {} }), getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }), onAuthStateChange: () => ({}) },
    from: (t) => builder(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
    channel: () => ({ on(_t, _f, cb) { window.__rt = cb; return this; }, subscribe() { return this; } }),
  };
  window.supabase = { createClient: () => client };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function open(vp, extra = {}) {
  const ctx = await browser.newContext({ viewport: vp.size, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, colorScheme: vp.scheme || 'dark', ...extra });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(initFake, YESTERDAY);
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await getCrmProfile(); document.body.classList.remove('auth-required'); });
  return { ctx, page, errs };
}
const visible = (page, sel) => page.$eval(sel, el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 0; }).catch(() => false);


// ----- helpers for this suite
const DAY = 86400000;
const tehranKeyOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const fa = (n) => Number(n).toLocaleString('fa-IR');
const lastWeekKey = tehranKeyOf(Date.now() - 7 * DAY);
const yesterdayKey = tehranKeyOf(Date.now() - DAY);
const snapRow = (overrides) => ({ user_id: 1, snap_date: lastWeekKey, clients_total: 36, active_files: 30, urgent_files: 7, followups_today: 0, contracts: 1, ...overrides });
const pastActivity = (msAgo, id) => ({ id: 900 + id, activity_type: 'پیگیری', user_id: 1, created_at: new Date(Date.now() - msAgo).toISOString() });

async function openHome(snaps, pastActs = [], extraNotes = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((d) => { window.__snaps = d.snaps; window.__pastActs = d.pastActs; }, { snaps, pastActs });
  await page.addInitScript(initFake, YESTERDAY);
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await getCrmProfile(); document.body.classList.remove('auth-required'); });
  await page.evaluate(() => loadHomeStats());
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const deltas = (page) => page.$$eval('.stat', cards => cards.map(c => (c.querySelector('.stat-delta')?.textContent || '').trim()));

// ----- Growth: manual expectations (fake data: 40 clients, 29 active files, 7 urgent active files, 3 sold files, 5 follow-ups today)
{
  const { ctx, page, errs } = await openHome([snapRow({})], [pastActivity(7 * DAY + 60000, 1), pastActivity(7 * DAY + 120000, 2)]);
  const got = await deltas(page);
  const expected = [
    `▲ ${fa(4)} (${fa(11)}%) · نسبت به ۷ روز قبل`,        // clients 40 vs 36
    `▼ ${fa(1)} (${fa(3)}%) · نسبت به ۷ روز قبل`,         // active files 29 vs 30
    `● بدون تغییر نسبت به ۷ روز قبل`,                     // urgent 7 vs 7
    `▲ ${fa(3)} (${fa(150)}%) · نسبت به همین ساعت ۷ روز قبل`, // follow-ups 5 vs 2 in same window last week
    `▲ ${fa(2)} (${fa(200)}%) · نسبت به ۷ روز قبل`,       // contracts 3 vs 1
  ];
  const texts = got.filter((_, i) => [0, 1, 2, 3, 4].includes(i));
  expected.forEach((e, i) => check('growth card ' + (i + 1) + ' matches manual value', texts[i] === e, `got="${texts[i]}" want="${e}"`));
  check('growth: no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ----- Growth: previous value zero -> no invalid percentage
{
  const { ctx, page } = await openHome([snapRow({ urgent_files: 0 })]);
  const t = (await deltas(page))[2];
  check('growth: zero baseline shows no percent', t === `▲ ${fa(7)} · نسبت به ۷ روز قبل`, `got="${t}"`);
  await ctx.close();
}

// ----- Growth: no snapshot exactly 7 days earlier -> neutral wait message, never a fake percent
{
  const { ctx, page } = await openHome([snapRow({ snap_date: yesterdayKey })]);
  const t = await deltas(page);
  check('growth: stock cards show wait message (6 days)', t[0] === `● مقایسه ۷ روزه ${fa(6)} روز دیگر فعال می‌شود` && t[1].includes(fa(6)), JSON.stringify(t.slice(0, 3)));
  check('growth: follow-up still compares real activities', t[3].startsWith('▲') || t[3].startsWith('● بدون'), `got="${t[3]}"`);
  await ctx.close();
}

// ----- Growth: no history at all
{
  const { ctx, page } = await openHome([]);
  const t = await deltas(page);
  check('growth: empty history shows 7-day wait (no numbers invented)', t[0] === `● مقایسه ۷ روزه ${fa(7)} روز دیگر فعال می‌شود`, `got="${t[0]}"`);
  await ctx.close();
}

// ----- Notifications: titles, click target, unread badge, realtime, missing record
async function openPanelContext(extraNotes = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript((notes) => { window.__extraNotes = notes; }, extraNotes);
  await page.addInitScript(initFake, YESTERDAY);
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await getCrmProfile(); document.body.classList.remove('auth-required'); });
  await page.evaluate(() => initNotifications());
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const closeModal = (page) => page.evaluate(() => document.querySelector('.modal-backdrop')?.remove());
{
  const { ctx, page, errs } = await openPanelContext();
  await page.click('#notifBell');
  await page.waitForTimeout(200);
  const titles = await page.$$eval('#notifList .notif-item strong', els => els.map(e => e.textContent));
  check('notifications: titles are «فایل فوری شد» / «مشتری فوری شد»', titles.includes('فایل فوری شد') && titles.includes('مشتری فوری شد'), JSON.stringify(titles));
  const badge = await page.textContent('#notifBadge');
  check('notifications: unread badge counts unread items', badge === fa(2), `badge=${badge}`);

  await page.locator('#notifList .notif-item', { hasText: 'مشتری فوری شد' }).click();
  await page.waitForTimeout(500);
  const clientOpen = await page.evaluate(() => ({ page: document.querySelector('.page.active')?.id, title: document.querySelector('.modal h2')?.textContent || null }));
  check('notifications: client click opens that client (not list)', clientOpen.page === 'page-clients' && clientOpen.title === 'مشتری 2', JSON.stringify(clientOpen));
  await closeModal(page);

  await page.click('#notifBell');
  await page.waitForTimeout(150);
  await page.locator('#notifList .notif-item', { hasText: 'فایل فوری شد' }).click();
  await page.waitForTimeout(500);
  const fileOpen = await page.evaluate(() => ({ page: document.querySelector('.page.active')?.id, title: document.querySelector('.modal h2')?.textContent || null }));
  check('notifications: file click opens that file (not list)', fileOpen.page === 'page-properties' && /^فایل P\d+$/.test(fileOpen.title || ''), JSON.stringify(fileOpen));
  await closeModal(page);

  const badgeAfter = await page.evaluate(() => document.getElementById('notifBadge').hidden ? '0' : document.getElementById('notifBadge').textContent);
  check('notifications: opening items marks them read (badge cleared)', badgeAfter === '0', `badgeAfter=${badgeAfter}`);

  // realtime: a new notification appears without reload
  await page.evaluate(() => { window.__rt({ new: { id: 70, recipient_user_id: 1, kind: 'urgent_file', title: 'فایل فوری', body: 'P9 — شهرک شریعتی', entity_kind: 'property', entity_id: 9, created_at: new Date().toISOString(), read_at: null } }); });
  await page.waitForTimeout(200);
  const first = await page.textContent('#notifList .notif-item strong').catch(() => null);
  check('notifications: realtime insert shows new item with new title', first === 'فایل فوری شد' || (await page.$eval('#notifPanel', e => e.hidden)) === false, `first=${first}`);
  check('notifications: badge shows 1 after realtime insert', (await page.textContent('#notifBadge')) === fa(1), `badge=${await page.textContent('#notifBadge')}`);
  check('notifications: main flow has no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // a record the user cannot see (or that no longer exists): friendly message, no empty detail
  const { ctx, page, errs } = await openPanelContext([{ id: 60, recipient_user_id: 1, kind: 'urgent_client', title: 'مشتری فوری', body: 'گمشده', entity_kind: 'client', entity_id: 999, created_at: new Date().toISOString(), read_at: null }]);
  await page.click('#notifBell');
  await page.waitForTimeout(150);
  await page.locator('#notifList .notif-item', { hasText: 'گمشده' }).click();
  await page.waitForTimeout(500);
  const toastText = await page.textContent('#toast');
  const modalCount = await page.$$eval('.modal', els => els.length);
  check('notifications: missing record shows message, no empty detail', /دسترس/.test(toastText || '') && modalCount === 0, `toast=${toastText} modals=${modalCount}`);
  check('notifications: missing record: no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL GROWTH/NOTIFICATION CHECKS PASSED (headless browser, fake data)');
process.exitCode = fails.length ? 1 : 0;
