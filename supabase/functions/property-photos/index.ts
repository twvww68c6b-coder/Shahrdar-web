// Read-only photo proxy for property photos uploaded through the Telegram bot.
// Deployed with verify_jwt=false. Secrets (service role, bot token) live in function env only.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TG_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const MAX_PHOTOS = 10;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

async function propertyIdFor(code: string): Promise<number | null> {
  const r = await fetch(`${SB_URL}/rest/v1/properties?select=id&code=eq.${encodeURIComponent(code)}&limit=1`, { headers: H });
  if (!r.ok) throw new Error('property lookup failed');
  const rows = await r.json();
  return rows.length ? Number(rows[0].id) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  try {
    const u = new URL(req.url);
    const code = (u.searchParams.get('code') || '').trim();
    if (!code || code.length > 64) return json({ error: 'bad code' }, 400);

    const propId = await propertyIdFor(code);
    if (propId === null) return json({ count: 0, photos: [] }, 404);

    const pidParam = u.searchParams.get('pid');

    // Image mode: stream one photo from Telegram
    if (pidParam) {
      const pid = Number(pidParam);
      if (!Number.isInteger(pid) || pid <= 0) return json({ error: 'bad pid' }, 400);
      const r = await fetch(`${SB_URL}/rest/v1/property_photos?select=file_id&id=eq.${pid}&property_id=eq.${propId}&limit=1`, { headers: H });
      const rows = r.ok ? await r.json() : [];
      if (!rows.length) return json({ error: 'not found' }, 404);
      const gf = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${encodeURIComponent(rows[0].file_id)}`);
      const gj = await gf.json();
      if (!gj.ok || !gj.result?.file_path) return json({ error: 'telegram unavailable' }, 502);
      const img = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${gj.result.file_path}`);
      if (!img.ok) return json({ error: 'telegram unavailable' }, 502);
      return new Response(img.body, {
        headers: { ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // List mode: ids and image URLs for this property
    const r = await fetch(
      `${SB_URL}/rest/v1/property_photos?select=id&property_id=eq.${propId}&order=created_at.asc,id.asc&limit=${MAX_PHOTOS}`,
      { headers: H },
    );
    if (!r.ok) throw new Error('photo lookup failed');
    const rows: { id: number }[] = await r.json();
    const base = `${SB_URL}/functions/v1/property-photos?code=${encodeURIComponent(code)}`;
    const photos = rows.map((x) => ({ id: x.id, url: `${base}&pid=${x.id}` }));
    return json({ count: photos.length, photos });
  } catch (_err) {
    // Never echo internal details (tokens, SQL) back to the client
    console.error('property-photos error');
    return json({ error: 'unavailable' }, 500);
  }
});
