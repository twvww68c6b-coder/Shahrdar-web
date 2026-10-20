// Local test of supabase/functions/web-login with mocked Supabase (no network).
const FN = new URL('../supabase/functions/web-login/index.ts', import.meta.url).pathname;
const SB = 'https://mock.supabase.co';
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'SRV_TEST', SUPABASE_ANON_KEY: 'ANON_TEST' })[k] }, serve: (h) => { globalThis.h = h; } };
const accounts = { 'matin': { email: 'matin@example.test', pass: 'Correct-Passw0rd!' } };
globalThis.fetch = async (url, o = {}) => {
  const u = String(url); const j = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/rest/v1/rpc/web_login_email')) { const a = accounts[JSON.parse(o.body).p_username.toLowerCase()]; return j(200, a ? a.email : null); }
  if (u.includes('/auth/v1/token')) { const b = JSON.parse(o.body); const hit = Object.values(accounts).find(a => a.email === b.email && a.pass === b.password);
    return hit ? j(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, expires_at: 1, token_type: 'bearer' }) : j(400, { error: 'invalid_grant' }); }
  return j(500, {});
};
await import(FN);
const call = (b) => h(new Request('https://x/functions/v1/web-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const cases = [
  ['correct login returns session', { username: 'matin', password: 'Correct-Passw0rd!' }, 200],
  ['wrong password -> generic 401', { username: 'matin', password: 'nope' }, 401],
  ['unknown username -> same generic 401', { username: 'nobody', password: 'x' }, 401],
  ['empty fields -> generic 401', { username: '', password: '' }, 401],
];
for (const [name, body, want] of cases) {
  const r = await call(body); const t = await r.text();
  ok(r.status === want, `${name}: ${r.status}`);
  ok(!t.includes('example.test') && !t.includes('SRV_TEST') && !t.includes('ANON_TEST'), `${name}: no email or key in response`);
  if (want === 401) ok(t.includes('نام کاربری یا رمز عبور درست نیست'), `${name}: same generic message`);
}
const okBody = await (await call(cases[0][1])).json();
ok(okBody.access_token === 'AT' && okBody.refresh_token === 'RT' && !('email' in okBody), 'success returns tokens only, no email');
console.log(fail ? `${fail} FAILED` : 'ALL WEB-LOGIN LOCAL CHECKS PASSED (mocked upstream)');
process.exit(fail ? 1 : 0);
