// Username login without exposing the account email to the browser.
// Deployed with verify_jwt=false (it is the login entry point). Nothing is stored; the response is
// either a session (access/refresh token) or one generic error for every failure.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const GENERIC = { error: 'invalid_credentials', message: 'نام کاربری یا رمز عبور درست نیست.' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const body = await req.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim().slice(0, 64) : '';
    const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
    if (!username || !password) return json(GENERIC, 401);

    // 1) username -> email, using the same rule as the existing RPC (case-insensitive, enabled only).
    const lr = await fetch(`${SB_URL}/rest/v1/rpc/web_login_email`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_username: username }),
    });
    const email = lr.ok ? await lr.json().catch(() => null) : null;
    if (typeof email !== 'string' || !email) return json(GENERIC, 401);

    // 2) password grant with the public anon key, exactly like the browser did before.
    const tr = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!tr.ok) return json(GENERIC, 401);
    const s = await tr.json();
    return json({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type,
    });
  } catch (_e) {
    return json(GENERIC, 401);
  }
});
