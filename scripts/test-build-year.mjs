// Headless checks (real index.html code, fake Supabase) for the optional "سال ساخت" (build_year) field:
// validation (Shamsi year 1300-1410, optional, Persian digits), save (empty -> 0, value -> number),
// edit prefill (0 -> empty), edit patch (build_year editable), and details (shown only when set).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const file = path.resolve('index.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => {
  window.__calls = []; window.__rpc = []; window.__inserts = [];
  const DATA = {
    properties: [
      { id: 1, code: 'OLD1', area: 'بوستان جنوبی', sqm: 80, price: 1, status: '🟢 فعال', created_at: '2026-10-01' },
      { id: 2, code: 'NEW1', area: 'شهرک بستان جنوبی', sqm: 90, price: 2, status: '🟢 فعال', created_at: '2026-10-02' },
    ],
    clients: [],
  };
  const builder = (table) => {
    const st = { eqs: [], ins: [], ors: '' };
    const b = {
      select() { return b; }, not() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; },
      or(s) { st.ors = s; return b; }, in(c, v) { st.ins.push([c, v]); return b; },
      eq(c, v) { st.eqs.push([c, v]); return b; }, is() { return b; },
      insert(p) { window.__inserts.push({ table, payload: p }); return b; },
      update() { return b; }, single() { return b; }, maybeSingle() { return b; },
      then(res, rej) {
        window.__calls.push({ table, eqs: st.eqs, ins: st.ins, ors: st.ors });
        return Promise.resolve({ data: DATA[table] ? DATA[table].filter(r => st.eqs.every(([c, v]) => r[c] === v)) : [{ id: 99 }], error: null, count: 0 }).then(res, rej);
      },
    };
    return b;
  };
  const client = {
    auth: { getSession: async () => ({ data: {} }), onAuthStateChange: () => ({}) },
    from: (t) => builder(t),
    rpc: (name, args) => {
      window.__rpc.push({ name, args });
      const rows = [
        { code: 'OLD1', area: 'بوستان جنوبی', sqm: 80, price: 1 },
        { code: 'SHARED', area: 'شریعتی', sqm: 70, price: 3 },
      ];
      const pick = rows.filter(r => !args.p_area || r.area.includes(args.p_area));
      return Promise.resolve({ data: pick, error: null });
    },
    functions: {},
  };
  window.supabase = { createClient: () => client };
});
await page.route(/^https?:/, r => r.abort());
await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { window.getCrmProfile = async () => ({ telegramId: 1, crmId: 1, role: 'مدیر' }); });

const fails = [];
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails.push(name); };

// A) Validation: optional; a Shamsi year 1300-1410 is accepted; anything else is rejected
await page.evaluate(() => { showRecordForm('property'); editingRecord = null; document.getElementById('p_code').value = 'B1'; document.getElementById('p_area').value = 'شهرک شریعتی'; document.getElementById('p_address').value = 'آدرس'; document.getElementById('p_ownerName').value = 'مالک'; document.getElementById('p_ownerPhone').value = '09120000000'; document.getElementById('p_desc').value = 'توضیح'; document.getElementById('p_sqm').value = '80'; document.getElementById('p_vacancy').value = 'فوری'; document.getElementById('p_bedrooms').value = '2'; document.getElementById('p_floors').value = '5'; document.getElementById('p_unitFloor').value = '2'; document.getElementById('p_price').value = '1000'; });
const val = await page.evaluate(() => {
  const set = (x) => { document.getElementById('p_buildYear').value = x; return validPropertyForm(); };
  return { empty: set(''), y1395: set('1395'), y1398: set('1398'), y1402: set('1402'), persian: set('۱۳۹۸'),
    tooOld: set('1299'), tooNew: set('1411'), fraction: set('1398.5'), negative: set('-1398'), words: set('abc') };
});
check('build year empty is accepted (optional)', val.empty == null, JSON.stringify(val.empty));
check('build year 1395, 1398, 1402 accepted', val.y1395 == null && val.y1398 == null && val.y1402 == null, JSON.stringify([val.y1395, val.y1398, val.y1402]));
check('build year accepts Persian digits', val.persian == null, JSON.stringify(val.persian));
check('build year out of range or invalid is rejected with the field message',
  [val.tooOld, val.tooNew, val.fraction, val.negative].every(m => typeof m === 'string' && m.includes('سال ساخت')), JSON.stringify([val.tooOld, val.tooNew, val.fraction, val.negative]));

// B) Save: empty stored as 0 (existing convention, bot hides 0); a value is stored as a number
await page.evaluate(() => { showRecordForm('property'); editingRecord = null; document.getElementById('p_code').value = 'B1'; document.getElementById('p_area').value = 'شهرک شریعتی'; document.getElementById('p_address').value = 'آدرس'; document.getElementById('p_ownerName').value = 'مالک'; document.getElementById('p_ownerPhone').value = '09120000000'; document.getElementById('p_desc').value = 'توضیح'; document.getElementById('p_sqm').value = '80'; document.getElementById('p_vacancy').value = 'فوری'; document.getElementById('p_bedrooms').value = '2'; document.getElementById('p_floors').value = '5'; document.getElementById('p_unitFloor').value = '2'; document.getElementById('p_price').value = '1000'; document.getElementById('p_buildYear').value = ''; });
await page.evaluate(() => submitRecord());
await page.waitForTimeout(300);
const insEmpty = await page.evaluate(() => window.__inserts.filter(i => i.table === 'properties').slice(-1)[0]);
check('empty build year saved as 0 (form still saves)', insEmpty && insEmpty.payload.build_year === 0 && insEmpty.payload.code === 'B1', JSON.stringify(insEmpty && [insEmpty.payload.code, insEmpty.payload.build_year]));
await page.evaluate(() => { showRecordForm('property'); editingRecord = null; document.getElementById('p_code').value = 'B2'; document.getElementById('p_area').value = 'شهرک شریعتی'; document.getElementById('p_address').value = 'آدرس'; document.getElementById('p_ownerName').value = 'مالک'; document.getElementById('p_ownerPhone').value = '09120000000'; document.getElementById('p_desc').value = 'توضیح'; document.getElementById('p_sqm').value = '80'; document.getElementById('p_vacancy').value = 'فوری'; document.getElementById('p_bedrooms').value = '2'; document.getElementById('p_floors').value = '5'; document.getElementById('p_unitFloor').value = '2'; document.getElementById('p_price').value = '1000'; document.getElementById('p_buildYear').value = '۱۳۹۸'; });
const err3 = await page.evaluate(() => validPropertyForm());
await page.evaluate(() => submitRecord());
await page.waitForTimeout(300);
const insVal = await page.evaluate(() => window.__inserts.filter(i => i.table === 'properties').slice(-1)[0]);
check('build year 1398 (Persian digits) saved as number 1398', err3 === null && insVal && insVal.payload.build_year === 1398, JSON.stringify([err3, insVal && insVal.payload.build_year]));

// C) Edit prefill: a stored year shows; 0 shows empty
const pre = await page.evaluate(() => {
  startEditRecord('properties', { id: 7, code: 'E1', area: 'شهرک شریعتی', build_year: 1395, address: 'a', owner_name: 'o', owner_phone: '09120000000', description: 'd', vacancy_date: 'x', sqm: 80, price: 1, deal_type: 'فروش' });
  const withYear = document.getElementById('p_buildYear').value;
  startEditRecord('properties', { id: 8, code: 'E2', area: 'شهرک شریعتی', build_year: 0, address: 'a', owner_name: 'o', owner_phone: '09120000000', description: 'd', vacancy_date: 'x', sqm: 80, price: 1, deal_type: 'فروش' });
  const zero = document.getElementById('p_buildYear').value;
  editingRecord = null;
  return { withYear, zero };
});
check('edit prefill shows stored year', pre.withYear === '1395', JSON.stringify(pre));
check('edit prefill shows empty for 0', pre.zero === '', JSON.stringify(pre));

// D) Edit patch: build_year is no longer excluded from updates; owner and created_by still are
const patch = await page.evaluate(() => editPatch({ build_year: 1398, owner_user_id: 4, created_by: 9, code: 'X' }));
check('edit patch includes build_year and still excludes owner/creator', patch.build_year === 1398 && !('owner_user_id' in patch) && !('created_by' in patch) && patch.code === 'X', JSON.stringify(patch));

// E) Details: label is exact; field is shown when set and hidden when empty
const label = await page.evaluate(() => PROPERTY_LABELS.build_year);
check('detail label is exactly سال ساخت', label === 'سال ساخت', label);
const detailText = async (yearValue) => {
  await page.evaluate((y) => {
    const orig = window.__origFrom || shahrdarAuth.from.bind(shahrdarAuth);
    window.__origFrom = orig;
    shahrdarAuth.from = (t) => t === 'properties'
      ? { select() { return { eq() { return { single: async () => ({ data: { id: 3, code: 'D1', area: 'شهرک شریعتی', sqm: 80, price: 1, status: '🟢 فعال', deal_type: 'فروش', build_year: y, units_per_floor: 0 }, error: null }) }; } }; } }
      : orig(t);
  }, yearValue);
  await page.evaluate(() => openRecordModal('properties', { id: 3, code: 'D1' }));
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => { document.querySelectorAll('.modal-back,[class*="back"]').forEach(n => { if (n.querySelector && n.querySelector('.close')) n.remove(); }); document.querySelectorAll('.close').forEach(b => b.closest('div')?.parentElement?.remove()); });
  return txt;
};
const shown = await detailText(1398);
check('details show سال ساخت when set', shown.includes('سال ساخت') && shown.includes('۱۳۹۸'), 'shown=' + shown.includes('سال ساخت'));
const hidden = await detailText(0);
check('details hide سال ساخت when empty (0)', !hidden.includes('سال ساخت'));

// F) Existing units field still behaves
const units = await page.evaluate(() => [fmtDetail('units_per_floor', 0), fmtDetail('units_per_floor', 4)]);
check('units field display unchanged', units[0] === '—' && units[1] === '۴', JSON.stringify(units));

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails.length ? `BUILD-YEAR CHECKS FAILED (${fails.length})` : 'ALL BUILD-YEAR CHECKS PASSED (headless browser, fake data)');
process.exit(fails.length ? 1 : 0);
