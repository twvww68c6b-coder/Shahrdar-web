// Local test of the real crm-share handler with a MOCKED Supabase and Telegram (no network, no DB writes).
// Run: node --experimental-strip-types --no-warnings scripts/test-crm-share-local.mjs
const FN = new URL('../supabase/functions/crm-share/index.ts', import.meta.url).pathname;
const SB = 'https://mock-project.supabase.co';
const SECRET_SRV = 'SRV_KEY_TEST_ONLY';
const SECRET_TG = '123456:TG_TOKEN_TEST_ONLY';
let handler; let tgFail = false;
const tgCalls = [];
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRV, TELEGRAM_BOT_TOKEN: SECRET_TG })[k] },
  serve: (h) => { handler = h; },
};

// ---- fake data (not real records) ----
const users = {
  1: { id: 1, name: 'مدیر آزمایشی', role: 'مدیر', telegram_id: 111 },
  2: { id: 2, name: 'مشاور الف', role: 'مشاور', telegram_id: 222 },
  3: { id: 3, name: 'مشاور ب', role: 'مشاور', telegram_id: 333 },
  5: { id: 5, name: 'بدون تلگرام', role: 'مشاور', telegram_id: null },
};
const props = {
  1: { id: 1, code: 'T1', owner_user_id: 2, ownership_type: 'شخصی', deal_type: 'فروش', property_type: 'آپارتمان', area: 'بوستان',
       sqm: 90, bedrooms: 2, floor_label: '3', build_year: 1390, elevator: 'دارد', parking: 'دارد', storage: 'ندارد',
       price: 1000000000, rent: null, deposit: null, owner_name: 'مالک ساختگی', owner_phone: '09120000000',
       address: 'آدرس دقیق ساختگی', tenant: 'مستأجر ساختگی', document_type: 'سند ساختگی', description: 'یادداشت داخلی محرمانه' },
};
const clients = {
  1: { id: 1, name: 'مشتری آزمایشی', phone: '09130000000', owner_user_id: 2, ownership_type: 'شخصی', deal_type: 'فروش',
       property_type: 'آپارتمان', area: 'بوستان', min_budget: 100000000, max_budget: 200000000, min_sqm: 50, max_sqm: 80, bedrooms: 2 },
};
const INTERNAL = ['یادداشت داخلی محرمانه', 'پیگیری', 'فعالیت', 'تماس ثبت‌شده', 'محرمانه'];

const jres = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const auth = (opts.headers || {}).Authorization || '';
  if (u.startsWith(SB + '/auth/v1/user')) {
    const m = auth.match(/^Bearer GOOD_(\d)$/);
    return m ? jres(200, { id: 'uuid-' + m[1] }) : jres(401, { msg: 'invalid JWT' });
  }
  if (u.startsWith(SB + '/rest/v1/web_user_access')) {
    const m = u.match(/auth_user_id=eq\.uuid-(\d)/); return jres(200, m ? [{ crm_user_id: Number(m[1]), enabled: true }] : []);
  }
  if (u.startsWith(SB + '/rest/v1/users')) { const m = u.match(/id=eq\.(\d+)/); const x = users[m[1]]; return jres(200, x ? [x] : []); }
  if (u.startsWith(SB + '/rest/v1/properties')) { const m = u.match(/id=eq\.(\d+)/); const x = props[m[1]]; return jres(200, x ? [x] : []); }
  if (u.startsWith(SB + '/rest/v1/clients')) { const m = u.match(/id=eq\.(\d+)/); const x = clients[m[1]]; return jres(200, x ? [x] : []); }
  if (u.startsWith(SB + '/rest/v1/property_photos')) return jres(200, [{ file_id: 'PH_A' }, { file_id: 'PH_B' }]);
  if (u.startsWith('https://api.telegram.org/')) {
    const method = u.split('/').pop(); tgCalls.push({ method, body: JSON.parse(opts.body) });
    return tgFail ? jres(403, { ok: false, description: 'Forbidden: bot was blocked' }) : jres(200, { ok: true });
  }
  return jres(500, { msg: 'unmocked ' + u });
};

await import(FN);
const call = (body, token, method = 'POST') => handler(new Request(SB + '/functions/v1/crm-share', {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
}));

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
const sent = () => tgCalls.filter((c) => c.method === 'sendMessage');
const reset = () => { tgCalls.length = 0; tgFail = false; };

// 1. no token
reset();
let r = await call({ kind: 'property', id: 1, mode: 'full', recipient_user_id: 3 });
ok(r.status === 401 && tgCalls.length === 0, `no token -> ${r.status}, no Telegram call`);

// 2. forged token (Supabase rejects it)
reset();
r = await call({ kind: 'property', id: 1, mode: 'full', recipient_user_id: 3 }, 'forged.token.value');
ok(r.status === 401 && tgCalls.length === 0, `forged token -> ${r.status}, no Telegram call`);

// 3. authenticated consultant 3 cannot see consultant 2's private property -> 404, nothing sent
reset();
r = await call({ kind: 'property', id: 1, mode: 'full', recipient_user_id: 3 }, 'GOOD_3');
ok(r.status === 404 && tgCalls.length === 0, `non-owner consultant, private file -> ${r.status}, nothing sent`);

// 4. owner sends FULL property to consultant 3
reset();
r = await call({ kind: 'property', id: 1, mode: 'full', recipient_user_id: 3 }, 'GOOD_2');
const body4 = await r.json();
const msg4 = sent()[0]?.body?.text || '';
ok(r.status === 200 && body4.sent_text === true && body4.photos_sent === 2, `owner sends full property -> ${r.status}, text sent, ${body4.photos_sent} photos`);
ok(sent()[0]?.body?.chat_id === 333, 'full property goes only to the recipient chat (333)');
ok(msg4.includes('مالک ساختگی') && msg4.includes('آدرس دقیق ساختگی'), 'full property contains owner and exact address (authorized version)');
ok(INTERNAL.every((x) => !msg4.includes(x)), 'full property contains no internal note, follow-up or activity text');
ok(tgCalls.filter((c) => c.method === 'sendPhoto').map((c) => c.body.photo).join() === 'PH_A,PH_B', 'photos re-sent by file_id only');
ok(!JSON.stringify(body4).includes(SECRET_TG) && !JSON.stringify(body4).includes(SECRET_SRV), 'response body contains no secret');

// 5. PUBLIC property: no owner name/phone/address/tenant/document/description
reset();
r = await call({ kind: 'property', id: 1, mode: 'public', recipient_user_id: 3 }, 'GOOD_2');
const msg5 = sent()[0]?.body?.text || '';
ok(r.status === 200 && msg5.includes('کد فایل: T1'), 'public property sent with public fields');
ok(!['مالک ساختگی', '09120000000', 'آدرس دقیق', 'مستأجر ساختگی', 'سند ساختگی', 'یادداشت داخلی'].some((x) => msg5.includes(x)), 'public property has no owner, address, tenant, document or internal note');

// 6. CLIENT FULL: name and phone allowed; no notes
reset();
r = await call({ kind: 'client', id: 1, mode: 'full', recipient_user_id: 3 }, 'GOOD_2');
const msg6 = sent()[0]?.body?.text || '';
ok(r.status === 200 && msg6.includes('مشتری آزمایشی') && msg6.includes('09130000000'), 'client full includes name and phone');
ok(INTERNAL.every((x) => !msg6.includes(x)), 'client full contains no internal note, follow-up or activity text');

// 7. CLIENT PUBLIC: no name or phone
reset();
r = await call({ kind: 'client', id: 1, mode: 'public', recipient_user_id: 3 }, 'GOOD_2');
const msg7 = sent()[0]?.body?.text || '';
ok(r.status === 200 && !msg7.includes('مشتری آزمایشی') && !msg7.includes('09130000000'), 'client public has no name or phone');

// 8. recipient without Telegram account -> 422, nothing sent
reset();
r = await call({ kind: 'client', id: 1, mode: 'public', recipient_user_id: 5 }, 'GOOD_2');
ok(r.status === 422 && tgCalls.length === 0, `recipient without Telegram -> ${r.status}, nothing sent`);

// 9. manager sees a private file of another consultant
reset();
r = await call({ kind: 'property', id: 1, mode: 'public', recipient_user_id: 3 }, 'GOOD_1');
ok(r.status === 200, `manager can see private file -> ${r.status}`);

// 10. bad input and wrong method
reset();
r = await call({ kind: 'nope', id: 1, mode: 'full', recipient_user_id: 3 }, 'GOOD_2');
ok(r.status === 400 && tgCalls.length === 0, `bad kind -> ${r.status}`);
r = await call(null, 'GOOD_2', 'GET');
ok(r.status === 405, `GET -> ${r.status}`);

// 11. Telegram refuses (blocked bot) -> 502, generic error, no secret leaked
reset(); tgFail = true;
r = await call({ kind: 'client', id: 1, mode: 'public', recipient_user_id: 3 }, 'GOOD_2');
const body11 = await r.json();
ok(r.status === 502 && body11.error === 'telegram_send_failed' && !JSON.stringify(body11).includes('Forbidden') && !JSON.stringify(body11).includes(SECRET_TG), `telegram refusal -> ${r.status} generic error, no secret`);

console.log(fail ? `\n${fail} FAILED` : '\nALL LOCAL HANDLER CHECKS PASSED (mocked upstream; not a live Supabase or Telegram test)');
process.exit(fail ? 1 : 0);
