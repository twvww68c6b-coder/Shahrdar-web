// Sends a property or client card to a registered consultant through the existing Telegram bot.
// Deployed with verify_jwt=true; the caller is resolved from the session JWT (web_user_access -> users).
// The bot token lives only in function secrets. Nothing is written to the database or Storage:
// the text is built, sent, and discarded. Photos are re-sent by Telegram file_id from property_photos.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TG_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const str = (v: unknown) => String(v ?? '').trim();
const fa = (v: unknown) => Number(v).toLocaleString('fa-IR');
const money = (v: unknown) => (Number(v) ? fa(v) + ' تومان' : '');

async function sbGet<T>(path: string): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json() as Promise<T>;
}

async function caller(req: Request) {
  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.startsWith('Bearer ')) return null;
  const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: authz } });
  if (!ur.ok) return null;
  const au = await ur.json();
  const wa = await sbGet<any[]>(`web_user_access?select=crm_user_id,enabled&auth_user_id=eq.${au.id}&limit=1`);
  if (!wa.length || !wa[0].enabled) return null;
  const us = await sbGet<any[]>(`users?select=id,name,role&id=eq.${wa[0].crm_user_id}&limit=1`);
  if (!us.length) return null;
  return { id: Number(us[0].id), role: String(us[0].role ?? '') };
}

// Same visibility rule as the bot and the mayor function.
const visibleTo = (row: any, me: { id: number; role: string }) =>
  me.role === 'مدیر' || !row.ownership_type || row.ownership_type !== 'شخصی' || Number(row.owner_user_id) === me.id;

function propertyCard(p: any, full: boolean): string {
  const lines: [string, unknown][] = [
    ['کد فایل', p.code], ['نوع معامله', p.deal_type], ['نوع ملک', p.property_type], ['محله', p.area],
    ['متراژ', p.sqm ? fa(p.sqm) + ' متر' : ''], ['تعداد خواب', p.bedrooms ? fa(p.bedrooms) : ''],
    ['طبقه', p.floor_label], ['سال ساخت', p.build_year], ['آسانسور', p.elevator], ['پارکینگ', p.parking], ['انباری', p.storage],
    ['قیمت', money(p.price)], ['اجاره ماهانه', money(p.rent)], ['ودیعه', money(p.deposit)],
  ];
  if (full) {
    lines.push(['آدرس دقیق', p.address], ['نام مالک', p.owner_name], ['شماره مالک', p.owner_phone],
      ['مستأجر', p.tenant], ['نوع سند', p.document_type]);
  }
  const body = lines.filter(([, v]) => str(v) !== '' && str(v) !== '0').map(([k, v]) => `${k}: ${str(v)}`).join('\n');
  const tag = full ? 'نسخه کامل' : 'نسخه عمومی';
  return `🏢 شهردار ایران‌زمین — معرفی فایل ملک (${tag})\n\n${body}` +
    (full ? '' : '\n\nبرای اطلاعات بیشتر با مشاور تماس بگیرید.');
}

function clientCard(c: any, full: boolean): string {
  const lines: [string, unknown][] = [
    ['نوع معامله', c.deal_type], ['نوع ملک درخواستی', c.property_type], ['محدوده', c.area],
    ['بودجه از', money(c.min_budget)], ['بودجه تا', money(c.max_budget)],
    ['متراژ از', c.min_sqm ? fa(c.min_sqm) + ' متر' : ''], ['متراژ تا', c.max_sqm ? fa(c.max_sqm) + ' متر' : ''],
    ['تعداد خواب', c.bedrooms ? fa(c.bedrooms) : ''], ['ودیعه حداکثر', money(c.max_deposit)], ['اجاره حداکثر', money(c.max_rent)],
  ];
  if (full) lines.unshift(['نام مشتری', c.name], ['شماره تماس', c.phone]);
  const body = lines.filter(([, v]) => str(v) !== '' && str(v) !== '0').map(([k, v]) => `${k}: ${str(v)}`).join('\n');
  const tag = full ? 'نسخه کامل' : 'نسخه عمومی';
  return `🤝 شهردار ایران‌زمین — معرفی درخواست مشتری (${tag})\n\n${body}`;
}

async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.description || ('telegram ' + r.status));
  return j;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const me = await caller(req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    const id = Number(body?.id);
    const mode = body?.mode === 'full' ? 'full' : 'public';
    const recipientId = Number(body?.recipient_user_id);
    if (!['property', 'client'].includes(kind) || !Number.isInteger(id) || id <= 0 || !Number.isInteger(recipientId) || recipientId <= 0)
      return json({ error: 'bad_request' }, 400);

    // Source record: the caller must be allowed to see it.
    const table = kind === 'property' ? 'properties' : 'clients';
    const cols = kind === 'property'
      ? 'id,code,deal_type,property_type,area,sqm,bedrooms,floor_label,build_year,elevator,parking,storage,price,rent,deposit,ownership_type,owner_user_id,owner_name,owner_phone,address,tenant,document_type'
      : 'id,name,phone,deal_type,property_type,area,min_sqm,max_sqm,min_budget,max_budget,bedrooms,max_deposit,max_rent,ownership_type,owner_user_id';
    const rows = await sbGet<any[]>(`${table}?select=${cols}&id=eq.${id}&limit=1`);
    if (!rows.length || !visibleTo(rows[0], me)) return json({ error: 'not_found' }, 404);
    const rec = rows[0];

    // Recipient: must be a registered staff member with a Telegram account.
    const rc = await sbGet<any[]>(`users?select=id,telegram_id,name&id=eq.${recipientId}&limit=1`);
    if (!rc.length || !rc[0].telegram_id) return json({ error: 'recipient_not_reachable' }, 422);
    const chatId = Number(rc[0].telegram_id);

    const text = kind === 'property' ? propertyCard(rec, mode === 'full') : clientCard(rec, mode === 'full');
    const result: Record<string, unknown> = { ok: true, sent_text: false, photos_sent: 0 };
    try {
      await tg('sendMessage', { chat_id: chatId, text });
      result.sent_text = true;
    } catch (e) {
      return json({ ok: false, error: 'telegram_send_failed' }, 502);
    }

    // Photos are only for property files and are re-sent by file_id (max 5), nothing is stored.
    if (kind === 'property') {
      const photos = await sbGet<any[]>(`property_photos?select=file_id&property_id=eq.${id}&order=id.asc&limit=5`);
      for (const ph of photos) {
        try { await tg('sendPhoto', { chat_id: chatId, photo: ph.file_id }); result.photos_sent = Number(result.photos_sent) + 1; }
        catch (_e) { /* keep going; report count */ }
      }
    }
    return json(result);
  } catch (e) {
    console.error('crm-share', e);
    return json({ error: 'server' }, 500);
  }
});
