// Sends due follow-up reminders to the responsible consultant on Telegram.
// Called every minute by pg_cron (see SQL in supabase/migrations). Deployed with verify_jwt=false;
// access is limited to callers that send the shared cron secret (kept in Supabase Vault).
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TG_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`rpc ${name} failed: ${r.status}`);
  return r.json();
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const fmtTehran = (iso: string) =>
  new Date(iso).toLocaleString('fa-IR', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  try {
    const got = req.headers.get('x-cron-secret') || '';
    const expected = String((await rpc('followup_cron_secret', {})) || '');
    if (!expected || !sameSecret(got, expected)) return json({ ok: false, error: 'unauthorized' }, 401);

    const due: any[] = await rpc('claim_due_followups', { p_limit: 50 });
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      const dueIso = new Date(row.due_at).toISOString();
      const markArgs = { p_id: row.id, p_due: row.due_at };
      if (!row.telegram_id) {
        await rpc('mark_followup_reminder', { ...markArgs, p_ok: false, p_error: 'مسئول پیگیری تلگرام ندارد' });
        failed++;
        continue;
      }
      const text =
        '🔔 یادآوری پیگیری\n' +
        `مشتری: ${row.client_name || '—'}\n` +
        `کد ملک: ${row.property_code || '—'}\n` +
        `یادداشت مشاور: ${row.note || '—'}\n` +
        `موعد: ${fmtTehran(dueIso)}`;
      try {
        const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: row.telegram_id, text }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (r.ok && j.ok) {
          await rpc('mark_followup_reminder', { ...markArgs, p_ok: true, p_error: null });
          sent++;
        } else {
          await rpc('mark_followup_reminder', { ...markArgs, p_ok: false, p_error: String(j.description || `telegram ${r.status}`) });
          failed++;
        }
      } catch (_e) {
        await rpc('mark_followup_reminder', { ...markArgs, p_ok: false, p_error: 'اتصال به تلگرام انجام نشد' });
        failed++;
      }
    }
    return json({ ok: true, claimed: due.length, sent, failed });
  } catch (_e) {
    console.error('followup-reminders error');
    return json({ ok: false, error: 'internal' }, 500);
  }
});
