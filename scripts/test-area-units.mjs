// Headless checks (real index.html code, fake Supabase) for:
// neighborhood names matching the bot (legacy spellings mapped, nothing rewritten in DB)
// and the optional "واحد در هر طبقه" field (validation, edit prefill, display, save).
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

// A) Mapping helpers
const map = await page.evaluate(() => ({
  legacyToCanon: canonArea('بوستان جنوبی') === 'شهرک بستان جنوبی' && canonArea('بوستان شمالی') === 'شهرک بستان شمالی' && canonArea('شریعتی') === 'شهرک شریعتی',
  canonUnchanged: canonArea('شهرک بستان شمالی') === 'شهرک بستان شمالی' && canonArea(null) === '',
  dbValues: areaDbValues('شهرک بستان جنوبی').join('|'),
  detailArea: fmtDetail('area', 'بوستان جنوبی'),
  divar: extractFieldsFromText('آپارتمان ۸۰ متری در شریعتی فروش').area,
  divar2: extractFieldsFromText('فروش ویلا در بوستان شمالی').area,
  divar3: extractFieldsFromText('ویلا در شهرک بستان جنوبی').area,
}));
check('legacy spellings map to the bot names', map.legacyToCanon && map.canonUnchanged, JSON.stringify(map));
check('DB query values include the legacy spelling', map.dbValues === 'شهرک بستان جنوبی|بوستان جنوبی', map.dbValues);
check('details show the bot name for a legacy row', map.detailArea === 'شهرک بستان جنوبی', map.detailArea);
check('Divar text detects neighborhoods (legacy and canonical)', map.divar === 'شهرک شریعتی' && map.divar2 === 'بوستان شمالی'.replace('بوستان', 'شهرک بستان') && map.divar3 === 'شهرک بستان جنوبی', JSON.stringify(map));

// B) Form options use the bot names
const opts = await page.evaluate(() => ['p_area', 'recordArea', 'mhArea', 'srchArea'].map(id => [...document.getElementById(id).options].map(o => o.value)));
const botNames = ['شهرک شریعتی', 'شهرک بستان شمالی', 'شهرک بستان جنوبی'];
check('all four area selects use bot names only', opts.every(list => botNames.every(n => list.includes(n)) && !list.includes('بوستان جنوبی') && !list.includes('بوستان شمالی') && !list.includes('شریعتی')), JSON.stringify(opts[0]));

// C) Edit prefill: legacy area shows as bot name; units 0 shows empty
await page.evaluate(() => startEditRecord('properties', { id: 1, code: 'OLD1', area: 'بوستان جنوبی', address: 'x', owner_name: 'n', owner_phone: '09120000000', units_per_floor: 0, sqm: 80, deal_type: 'فروش', status: '🟢 فعال', description: 'd' }));
const pre = await page.evaluate(() => ({ area: document.getElementById('p_area').value, units: document.getElementById('p_unitsPerFloor').value }));
check('edit shows the bot neighborhood for a legacy file', pre.area === 'شهرک بستان جنوبی', JSON.stringify(pre));
check('edit leaves units empty when stored value is 0', pre.units === '', JSON.stringify(pre));
await page.evaluate(() => startEditRecord('properties', { id: 2, code: 'NEW1', area: 'شهرک شریعتی', units_per_floor: 3, address: 'x', owner_name: 'n', owner_phone: '09120000000', sqm: 80, deal_type: 'فروش', status: '🟢 فعال', description: 'd' }));
const pre2 = await page.evaluate(() => document.getElementById('p_unitsPerFloor').value);
check('edit shows saved units value', pre2 === '3', `(units=${pre2})`);

// D) Validation: optional, positive integer
await page.evaluate(() => {
  document.getElementById('p_code').value = 'T1'; document.getElementById('p_area').value = 'شهرک شریعتی';
  document.getElementById('p_address').value = 'آدرس'; document.getElementById('p_ownerName').value = 'مالک';
  document.getElementById('p_ownerPhone').value = '09120000000'; document.getElementById('p_desc').value = 'توضیح';
  document.getElementById('p_sqm').value = '80'; document.getElementById('p_vacancy').value = 'فوری'; document.getElementById('p_bedrooms').value = '2'; document.getElementById('p_floors').value = '5'; document.getElementById('p_unitFloor').value = '2'; document.getElementById('p_price').value = '1000';
});
const v = await page.evaluate(() => {
  const out = {};
  const set = (x) => { document.getElementById('p_unitsPerFloor').value = x; return validPropertyForm(); };
  out.empty = set('');
  out.two = set('2');
  out.fraction = set('2.5');
  out.zero = set('0');
  out.negative = set('-1');
  out.persianDigits = set('۴');
  return out;
});
check('units empty is accepted (optional)', v.empty == null, JSON.stringify(v));
check('units positive integer accepted', v.two == null && v.persianDigits == null, JSON.stringify(v));
check('units fraction/zero/negative rejected', v.fraction.includes('واحد در هر طبقه') && v.zero.includes('واحد در هر طبقه') && v.negative.includes('واحد در هر طبقه'), JSON.stringify(v));

// E) Save: empty units stored as 0 (column is NOT NULL), filled value stored as number
await page.evaluate(() => { editingRecord = null; document.getElementById('p_code').value = 'T2'; document.getElementById('p_unitsPerFloor').value = ''; });
await page.evaluate(() => submitRecord());
await page.waitForTimeout(300);
const ins1 = await page.evaluate(() => window.__inserts.filter(i => i.table === 'properties').slice(-1)[0]);
check('empty units saved as 0 (NOT NULL column)', ins1 && ins1.payload.units_per_floor === 0 && ins1.payload.area === 'شهرک شریعتی', JSON.stringify(ins1 && { u: ins1.payload.units_per_floor, a: ins1.payload.area }));
await page.evaluate(() => { editingRecord = null; document.getElementById('p_code').value = 'T3'; document.getElementById('p_area').value = 'شهرک شریعتی'; document.getElementById('p_address').value = 'آدرس'; document.getElementById('p_ownerName').value = 'مالک'; document.getElementById('p_ownerPhone').value = '09120000000'; document.getElementById('p_desc').value = 'توضیح'; document.getElementById('p_sqm').value = '80'; document.getElementById('p_vacancy').value = 'فوری'; document.getElementById('p_bedrooms').value = '2'; document.getElementById('p_floors').value = '5'; document.getElementById('p_unitFloor').value = '2'; document.getElementById('p_price').value = '1000'; document.getElementById('p_unitsPerFloor').value = '4'; });
const err2 = await page.evaluate(() => validPropertyForm());
await page.evaluate(() => submitRecord());
await page.waitForTimeout(300);
if(err2!==null) console.log('validation before 2nd save:', err2);
const ins2 = await page.evaluate(() => window.__inserts.filter(i => i.table === 'properties').slice(-1)[0]);
check('filled units saved as a number', ins2 && ins2.payload.units_per_floor === 4, JSON.stringify(ins2 && ins2.payload.units_per_floor));

// F) Details show the units value, and 0 shows a dash
const det = await page.evaluate(() => [fmtDetail('units_per_floor', 0), fmtDetail('units_per_floor', 4), PROPERTY_LABELS.units_per_floor]);
check('details label and display of units', det[0] === '—' && det[1] === '۴' && det[2] === 'واحد در هر طبقه', JSON.stringify(det));

// G) Citizen search merges both spellings and dedupes
await page.evaluate(() => { window.__rpc = []; });
await page.evaluate(() => { const host = document.createElement('div'); host.id = 'tHost'; document.body.appendChild(host); return runPropertySearch({ area: 'شهرک بستان جنوبی' }, host); });
await page.waitForTimeout(300);
const rpc = await page.evaluate(() => window.__rpc.map(r => r.args.p_area));
check('search asks the RPC for both spellings', rpc.includes('شهرک بستان جنوبی') && rpc.includes('بوستان جنوبی'), JSON.stringify(rpc));
const shown = await page.evaluate(() => document.getElementById('tHost').textContent);
check('search result has the legacy row exactly once', (shown.match(/OLD1/g) || []).length === 1, shown.slice(0, 80));

// H) List search by bot name finds legacy rows
await page.evaluate(() => { window.__calls = []; listState.properties.q = 'بستان جنوبی'; return loadListPage('properties'); });
await page.waitForTimeout(300);
const orsStr = await page.evaluate(() => (window.__calls.filter(c => c.table === 'properties').slice(-1)[0] || {}).ors || '');
check('list search includes legacy spelling via area.in', orsStr.includes('area.in.(') && orsStr.includes('"بوستان جنوبی"') && orsStr.includes('"شهرک بستان جنوبی"'), orsStr);

check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(fails.length ? `AREA/UNITS CHECKS FAILED (${fails.length})` : 'ALL AREA/UNITS CHECKS PASSED (headless browser, fake data)');
process.exit(fails.length ? 1 : 0);
