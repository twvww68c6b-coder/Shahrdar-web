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
    clients: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'فعال', owner_user_id: 1, is_urgent: 0 })),
    properties: Array.from({ length: 32 }, (_, i) => ({ id: i + 1, status: i < 3 ? '🔵 معامله شد - توسط ما' : '🟢 فعال', owner_user_id: 1, is_urgent: i < 10 ? 1 : 0, code: 'P' + (i + 1), area: 'شهرک شریعتی', price: 12000000000, sqm: 120 })),
    activities: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, activity_type: 'پیگیری', created_at: new Date().toISOString() })),
    home_stat_snapshots: [{ user_id: 1, snap_date: yesterday, clients_total: 38, active_files: 30, urgent_files: 7, followups_today: 2, contracts: 1 }],
    panel_notifications: [
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

// 1) Layout: landscape phone, portrait phone, desktop
for (const vp of [
  { name: 'landscape phone 844x390', size: { width: 844, height: 390 }, mobile: true },
  { name: 'portrait phone 390x844', size: { width: 390, height: 844 }, mobile: true },
  { name: 'desktop 1440x900', size: { width: 1440, height: 900 } },
]) {
  const { ctx, page, errs } = await open(vp);
  const bottom = await visible(page, '#mobileNav');
  const side = await visible(page, '#sideNav');
  const more = await visible(page, '#moreBtn');
  if (vp.name.startsWith('desktop')) { check(vp.name + ': sidebar shown, bottom bar hidden', side && !bottom); }
  else { check(vp.name + ': bottom bar shown, sidebar hidden, سایر visible', bottom && !side && more, `(bottom=${bottom} side=${side} more=${more})`); }
  check(vp.name + ': no page errors', errs.length === 0, errs.join(' | '));
  if (vp.name.startsWith('landscape')) await page.screenshot({ path: path.join(SHOTS, 'android-landscape.png') });
  await ctx.close();
}

// 2) سایر sheet, settings navigation, language and theme persistence (phone portrait)
{
  const { ctx, page, errs } = await open({ size: { width: 390, height: 844 }, mobile: true });
  await page.click('#moreBtn');
  const items = await page.$$eval('#moreSheet [data-page]', bs => bs.map(b => b.dataset.page));
  check('سایر sheet lists the four items', ['citizen', 'performance', 'matching', 'settings'].every(k => items.includes(k)), JSON.stringify(items));
  await page.screenshot({ path: path.join(SHOTS, 'android-more-sheet.png') });
  await page.click('#moreSheet [data-page="settings"]');
  await page.waitForTimeout(150);
  check('settings opens from سایر', await page.evaluate(() => document.getElementById('page-settings').classList.contains('active')));
  check('settings title shown', (await page.textContent('#pageTitle')).trim() === 'تنظیمات');
  await page.click('[data-lang="en"]');
  const en = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, more: document.getElementById('moreBtn').textContent.trim(), title: document.getElementById('pageTitle').textContent.trim() }));
  check('English switches direction and labels', en.dir === 'ltr' && en.lang === 'en' && en.more.includes('More') && en.title === 'Settings', JSON.stringify(en));
  await page.screenshot({ path: path.join(SHOTS, 'android-settings-en.png') });
  await page.click('[data-theme-pref="light"]');
  check('light theme applied', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);
  await page.evaluate(async () => { await getCrmProfile(); document.body.classList.remove('auth-required'); openPage('settings'); });
  const kept = await page.evaluate(() => ({ dir: document.documentElement.dir, theme: document.documentElement.dataset.theme }));
  check('language and theme survive reload', kept.dir === 'ltr' && kept.theme === 'light', JSON.stringify(kept));
  await page.click('[data-lang="fa"]'); await page.click('[data-theme-pref="dark"]');
  check('back to Persian and dark', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.dataset.theme === 'dark'));
  check('no page errors in settings flow', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 3) System theme follows the device
{
  const { ctx, page } = await open({ size: { width: 1440, height: 900 }, scheme: 'light' });
  await page.click('[data-theme-pref]:nth-child(1)').catch(() => {});
  await page.evaluate(() => document.querySelector('[data-theme-pref="system"]').click());
  check('system theme follows light device', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
  await ctx.close();
}

// 4) Growth: stock cards need the snapshot exactly 7 days earlier (only yesterday exists here) -> wait message; follow-ups compare the same clock window
{
  const { ctx, page, errs } = await open({ size: { width: 1440, height: 900 } });
  await page.evaluate(() => refreshHome());
  await page.waitForTimeout(400);
  const deltas = await page.$$eval('#page-home .stat', cards => cards.map(c => (c.querySelector('.stat-delta') || {}).textContent || ''));
  console.log('   deltas:', JSON.stringify(deltas));
  [0, 1, 2, 4].forEach(i => check('stock card ' + i + ' waits for 7-day snapshot (6 days left)', deltas[i].includes('فعال می‌شود') && deltas[i].includes('۶'), deltas[i]));
  check('followups compares with activities (no past follow-ups here: ▲ ۵)', deltas[3].includes('▲') && deltas[3].includes('۵'), deltas[3]);
  const snap = await page.evaluate(() => window.__writes.filter(w => w.table === 'home_stat_snapshots'));
  check('today snapshot written once with upsert ignore-duplicates', snap.length === 1 && snap[0].mode === 'upsert' && snap[0].opts && snap[0].opts.ignoreDuplicates === true, JSON.stringify(snap).slice(0, 160));
  check('no page errors in growth', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 5) Growth with no previous snapshot stays neutral (no fake numbers)
{
  const { ctx, page } = await open({ size: { width: 1440, height: 900 } });
  await page.evaluate(() => { const orig = shahrdarAuth.from; shahrdarAuth.from = (t) => t === 'home_stat_snapshots' ? { upsert: () => Promise.resolve({ error: null }), select() { return this; }, eq() { return this; }, lt() { return this; }, order() { return this; }, limit: () => Promise.resolve({ data: [], error: null }) } : orig(t); });
  await page.evaluate(() => refreshHome());
  await page.waitForTimeout(400);
  const d = await page.$eval('#page-home .stat .stat-delta', el => el.textContent);
  check('no previous snapshot shows 7-day wait (no numbers invented)', d.includes('فعال می‌شود') && d.includes('۷'), d);
  await ctx.close();
}

// 6) Notifications: badge, list, mark read, live insert, no duplicate
{
  const { ctx, page, errs } = await open({ size: { width: 390, height: 844 }, mobile: true });
  await page.evaluate(() => refreshHome());
  await page.waitForTimeout(300);
  const badge = await page.textContent('#notifBadge');
  check('bell badge shows unread count', badge.trim() === '۲', `(badge=${badge})`);
  await page.click('#notifBell');
  const count = await page.$$eval('#notifList .notif-item', els => els.length);
  check('notification list shows only unread items (2 of 3)', count === 2, `(items=${count})`);
  await page.screenshot({ path: path.join(SHOTS, 'android-notifications.png') });
  await page.click('#notifReadAll');
  await page.waitForTimeout(150);
  check('mark all read hides badge', await page.evaluate(() => document.getElementById('notifBadge').hidden === true));
  const writes = await page.evaluate(() => window.__writes.filter(w => w.table === 'panel_notifications' && w.mode === 'update'));
  check('mark all read only updates read_at for own rows', writes.length === 1 && Object.keys(writes[0].payload).join() === 'read_at' && writes[0].filters.some(f => f.col === 'recipient_user_id' && f.val === 1), JSON.stringify(writes).slice(0, 200));
  await page.evaluate(() => window.__rt({ new: { id: 99, title: 'مشتری فوری', body: 'مشتری ب — شهرک بستان جنوبی', entity_kind: 'client', entity_id: 7, created_at: new Date().toISOString(), read_at: null } }));
  await page.waitForTimeout(150);
  check('live insert raises the badge to 1', (await page.textContent('#notifBadge')).trim() === '۱', await page.textContent('#notifBadge'));
  await page.evaluate(() => window.__rt({ new: { id: 99, title: 'مشتری فوری', body: 'dup', created_at: new Date().toISOString(), read_at: null } }));
  await page.waitForTimeout(100);
  check('same notification id is not shown twice', (await page.textContent('#notifBadge')).trim() === '۱');
  check('no page errors in notifications', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 7) Share notification: recipient is notified, text has no client name or phone
{
  const { ctx, page } = await open({ size: { width: 1440, height: 900 } });
  await page.evaluate(() => notifyShare('client', { id: 5, name: 'احمد محرمانه', phone: '0912' }, 2));
  await page.waitForTimeout(100);
  const w = await page.evaluate(() => window.__writes.find(x => x.table === 'panel_notifications' && x.mode === 'insert'));
  check('share notification inserted for recipient', !!w && w.payload.recipient_user_id === 2 && w.payload.created_by_user_id === 1 && w.payload.kind === 'share_client', JSON.stringify(w && w.payload).slice(0, 200));
  check('share notification hides client name and phone', !!w && !JSON.stringify(w.payload).includes('احمد') && !JSON.stringify(w.payload).includes('0912'));
  await ctx.close();
}

// 8) Phone header fits and English labels reach the toolbar (portrait and landscape)
for (const vp of [{ name: 'portrait 390', size: { width: 390, height: 844 } }, { name: 'landscape 844x390', size: { width: 844, height: 390 } }]) {
  const { ctx, page } = await open({ size: vp.size, mobile: true });
  const r = await page.evaluate(() => { const b = document.getElementById('logoutButton').getBoundingClientRect(); return { left: b.left, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
  check(vp.name + ': header buttons inside the screen, no horizontal scroll', r.left >= 0 && r.sw <= r.vw + 1, JSON.stringify(r));
  await ctx.close();
}
{
  const { ctx, page } = await open({ size: { width: 390, height: 844 }, mobile: true });
  await page.evaluate(() => { document.querySelector('[data-lang="en"]').click(); openPage('clients'); });
  const t = await page.evaluate(() => ({ ph: document.getElementById('clientSearch').placeholder, add: [...document.querySelectorAll('#page-clients button')].some(b => b.textContent.includes('Add client')), sort: [...document.querySelectorAll('#page-clients button')].some(b => b.textContent.includes('Sort')) }));
  check('English toolbar on clients page', t.ph.startsWith('Search') && t.add && t.sort, JSON.stringify(t));
  await page.evaluate(() => document.querySelector('[data-lang="fa"]').click());
  const back = await page.evaluate(() => document.getElementById('clientSearch').placeholder);
  check('Persian placeholder restored', back.startsWith('جست‌وجوی'), back);
  await ctx.close();
}

// 9) Work-area labels follow the language and come back exactly in Persian
{
  const { ctx, page, errs } = await open({ size: { width: 390, height: 844 }, mobile: true });
  await page.evaluate(() => openPage('quick'));
  const before = await page.evaluate(() => [...document.querySelectorAll('#page-quick .panel *')].filter(e => e.childNodes.length === 1 && e.firstChild.nodeType === 3).map(e => e.textContent.trim()).filter(t => t === 'نوع ثبت' || t === 'محله' || t === 'نوع معامله').length);
  await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
  await page.evaluate(() => openPage('quick'));
  await page.waitForTimeout(100);
  const en = await page.evaluate(() => document.getElementById('page-quick').innerText);
  check('quick page shows English labels', /Record type/.test(en) && /Neighborhood/.test(en) && /Deal type/.test(en), `(persian-before=${before})`);
  await page.evaluate(() => document.querySelector('[data-lang="fa"]').click());
  await page.waitForTimeout(100);
  const fa = await page.evaluate(() => document.getElementById('page-quick').innerText);
  check('quick page returns to Persian exactly', fa.includes('نوع ثبت') && fa.includes('محله') && !/Record type/.test(fa));
  check('no page errors in translation switch', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// 7) File details: price per square metre = total price / area (shown right under the price)
{
  const { ctx, page, errs } = await open({ size: { width: 1280, height: 900 } });
  await page.evaluate(() => openRecordModal('propertiesList', { id: 1 }));
  await page.waitForTimeout(300);
  const labels = await page.$$eval('.modal .form-field label', els => els.map(e => e.textContent));
  const vals = await page.$$eval('.modal .form-field', els => els.map(e => e.innerText.replace(/\n/g, ' | ')));
  const i = labels.indexOf('قیمت فروش');
  check('file details: price-per-metre row directly under price', i >= 0 && labels[i + 1] === 'قیمت هر متر', JSON.stringify(labels.slice(i, i + 2)));
  check('file details: price per metre = 12,000,000,000 / 120 = 100,000,000', i >= 0 && vals[i + 1] && vals[i + 1].includes('۱۰۰٬۰۰۰٬۰۰۰'), JSON.stringify(vals.slice(i + 1, i + 2)));
  check('file details: no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `ANDROID UI CHECKS FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL ANDROID UI CHECKS PASSED (headless browser, fake data)');
process.exit(fails.length ? 1 : 0);
