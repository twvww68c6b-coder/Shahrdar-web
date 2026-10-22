// Headless check of the client status picker with the real index.html code.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => {
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: {} }), onAuthStateChange: () => ({}) }, from: () => ({}), rpc: () => Promise.resolve({ data: [], error: null }), functions: {} }) };
});
await page.route(/^https?:/, r => r.abort());
await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'domcontentloaded' });
const fails = [];
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!ok) fails.push(n); };
const opts = () => page.$$eval('#c_status option', os => os.map(o => o.value));

// Picker options for a new client.
const picker = await page.evaluate(() => [...document.querySelectorAll('#c_status option')].map(o => o.value));
check('picker has the new purchase statuses', ['خرید کرده توسط ما', 'خرید کرده توسط دیگری', 'منصرف شده'].every(v => picker.includes(v)), JSON.stringify(picker));
check('picker no longer has plain خرید کرده', !picker.includes('خرید کرده'));

// Editing a record that still has the legacy value keeps it (no silent reset to فعال).
await page.evaluate(() => startEditRecord('clients', { id: 9, name: 'قدیمی', status: 'خرید کرده', area: 'شهرک شریعتی' }));
let o = await opts(), v = await page.$eval('#c_status', el => el.value);
check('legacy record keeps خرید کرده selected', v === 'خرید کرده', `(value=${v})`);
check('legacy value is shown as an extra option only for that record', o.includes('خرید کرده') && o.filter(x => x === 'خرید کرده').length === 1);

// Next record: the legacy option goes away again.
await page.evaluate(() => startEditRecord('clients', { id: 10, name: 'جدید', status: 'خرید کرده توسط ما', area: 'شهرک شریعتی' }));
o = await opts(); v = await page.$eval('#c_status', el => el.value);
check('purchased-by-us record selects that status', v === 'خرید کرده توسط ما', `(value=${v})`);
check('legacy option removed for other records', !o.includes('خرید کرده'), JSON.stringify(o));

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails.length ? `CLIENT STATUS UI CHECKS FAILED (${fails.length})` : 'ALL CLIENT STATUS UI CHECKS PASSED (headless browser)');
process.exit(fails.length ? 1 : 0);
