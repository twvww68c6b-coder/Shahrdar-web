// Drives the REAL index.html list code in headless Chromium with a fake Supabase client.
// Checks: the sort menu's محله entry, the neighborhood list, filtering by one neighborhood, and همه محله‌ها.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const file = path.resolve('index.html');
const shotDir = process.env.SCRATCH || '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => {
  window.__calls = [];
  const DATA = {
    clients: [
      { id: 1, name: 'مشتری یک', phone: '1', area: 'شهرک شریعتی', max_budget: 5, status: 'فعال', created_at: '2026-10-01' },
      { id: 2, name: 'مشتری دو', phone: '2', area: 'شهرک بستان شمالی', max_budget: 6, status: 'فعال', created_at: '2026-10-02' },
      { id: 3, name: 'مشتری سه', phone: '3', area: 'شهرک شریعتی', max_budget: 7, status: 'فعال', created_at: '2026-10-03' },
      { id: 4, name: 'مشتری چهار', phone: '4', area: null, max_budget: 8, status: 'فعال', created_at: '2026-10-04' },
    ],
    properties: [
      { id: 10, code: 'P1', area: 'خانی‌آباد نو شمالی', sqm: 80, price: 1, status: 'فعال', created_at: '2026-10-01' },
      { id: 11, code: 'P2', area: 'شهرک بستان جنوبی', sqm: 90, price: 2, status: 'فعال', created_at: '2026-10-02' },
    ],
  };
  const builder = (table) => {
    const st = { eqs: [] };
    const b = {
      select() { return b; }, or() { return b; }, in() { return b; }, not() { return b; },
      order() { return b; }, range() { return b; }, limit() { return b; },
      eq(c, v) { st.eqs.push([c, v]); return b; },
      then(res, rej) {
        const rows = (DATA[table] || []).filter(r => st.eqs.every(([c, v]) => r[c] === v));
        window.__calls.push({ table, eqs: st.eqs });
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej);
      },
    };
    return b;
  };
  const client = {
    auth: { getSession: async () => ({ data: {} }), onAuthStateChange: () => ({}) },
    from: (t) => builder(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: {},
  };
  window.supabase = { createClient: () => client };
});
await page.route(/^https?:/, r => r.abort());
await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { window.getCrmProfile = async () => ({ telegramId: 1, crmId: 1, role: 'مدیر' }); });

const fails = [];
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails.push(name); };

// 1) Open the clients list, then the sort menu.
await page.evaluate(() => loadListPage('clients'));
await page.waitForTimeout(300);
const rowsBefore = await page.evaluate(() => document.querySelectorAll('#clientsList tbody tr').length);
check('clients list renders rows', rowsBefore >= 1, `(rows=${rowsBefore})`);

await page.evaluate(() => openSortMenu('clients', document.getElementById('clientStatusFilter')));
const menuItems = await page.$$eval('#sortMenu button', bs => bs.map(b => b.textContent.trim()));
check('sort menu has a محله entry', menuItems.some(t => t.startsWith('محله:')), JSON.stringify(menuItems));
check('sort menu has no alphabetical area sort', !menuItems.some(t => t.includes('الف')), '');

// 2) Open the neighborhood list.
await page.click('#sortMenu button:has-text("محله:")');
await page.waitForTimeout(300);
const areaItems = await page.$$eval('#sortMenu button', bs => bs.map(b => b.textContent.trim()));
const expectedAreas = ['خانی‌آباد نو جنوبی','خانی‌آباد نو شمالی','شهرک شریعتی','شهرک بستان شمالی','شهرک بستان جنوبی'];
check('neighborhood list shows the five bot neighborhoods', expectedAreas.every(a => areaItems.includes(a)) && areaItems.length === 7, JSON.stringify(areaItems));
check('neighborhood list has همه محله‌ها and back', areaItems.includes('همه محله‌ها') && areaItems.some(t => t.includes('بازگشت')));
check('no duplicate neighborhood entries', new Set(areaItems).size === areaItems.length);
await page.screenshot({ path: path.join(shotDir, 'area-menu.png') });

// 3) Choose one neighborhood: list filters to it and the menu closes.
await page.click('#sortMenu button:text-is("شهرک شریعتی")');
await page.waitForTimeout(400);
const state1 = await page.evaluate(() => listState.clients.area);
check('choosing a neighborhood sets the filter', state1 === 'شهرک شریعتی', `(area=${state1})`);
check('menu closes after choosing', (await page.$('#sortMenu')) === null);
const lastCall = await page.evaluate(() => window.__calls.filter(c => c.table === 'clients').pop());
check('query is filtered by area', lastCall && lastCall.eqs.some(([c, v]) => c === 'area' && v === 'شهرک شریعتی'), JSON.stringify(lastCall));
const rowsFiltered = await page.$$eval('#clientsList tbody tr', rs => rs.map(r => r.textContent));
check('only the chosen neighborhood rows are shown', rowsFiltered.length === 2 && rowsFiltered.every(t => t.includes('مشتری یک') || t.includes('مشتری سه')), `(rows=${rowsFiltered.length})`);

// 4) Clear back to همه محله‌ها.
await page.evaluate(() => openSortMenu('clients', document.getElementById('clientStatusFilter')));
await page.click('#sortMenu button:has-text("محله:")');
await page.waitForTimeout(300);
await page.click('#sortMenu button:text-is("همه محله‌ها")');
await page.waitForTimeout(400);
const state2 = await page.evaluate(() => listState.clients.area);
check('همه محله‌ها clears the filter', state2 === '', `(area="${state2}")`);
const rowsAll = await page.$$eval('#clientsList tbody tr', rs => rs.length);
check('all rows are back after clearing', rowsAll === rowsBefore, `(rows=${rowsAll})`);

// 5) Files list uses the same control.
await page.evaluate(() => loadListPage('properties'));
await page.waitForTimeout(300);
await page.evaluate(() => openSortMenu('properties', document.getElementById('propertyStatusFilter')));
await page.click('#sortMenu button:has-text("محله:")');
await page.waitForTimeout(300);
const propAreas = await page.$$eval('#sortMenu button', bs => bs.map(b => b.textContent.trim()));
check('files neighborhood list works', ['خانی‌آباد نو شمالی', 'شهرک بستان جنوبی'].every(a => propAreas.includes(a)), JSON.stringify(propAreas));
await page.click('#sortMenu button:text-is("خانی‌آباد نو شمالی")');
await page.waitForTimeout(400);
const pState = await page.evaluate(() => listState.properties.area);
check('files list filters by neighborhood', pState === 'خانی‌آباد نو شمالی');

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails.length ? `AREA FILTER UI CHECKS FAILED (${fails.length})` : 'ALL AREA FILTER UI CHECKS PASSED (headless browser, fake data)');
process.exit(fails.length ? 1 : 0);
