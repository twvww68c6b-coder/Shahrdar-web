// mayor-match: deterministic client→file matching for the advisor's own visible data.
// Action: 'match' only. No model is called. Not deployed yet.
//
// Data access uses the caller's JWT with the anon key (RLS applies). The service role is NOT used.
// Access rules and output are in ../_shared/mayor-match-core.ts (tested separately).

import { runMatch } from '../_shared/mayor-match-core.ts';
import type { ClientRow, CoreDeps } from '../_shared/mayor-match-core.ts';
import type { PropertyInput, Viewer } from '../_shared/match-engine.ts';
import { ACTIVE_PROPERTY_STATUSES } from '../_shared/match-engine.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLIENT_COLUMNS = [
  'id', 'deal_type', 'max_budget', 'min_budget', 'area', 'min_sqm', 'max_sqm', 'property_type',
  'elevator_pref', 'parking_pref', 'storage_pref', 'floor_pref', 'floor_min', 'floor_max',
  'ownership_type', 'owner_user_id',
];

const PROPERTY_COLUMNS = [
  'id', 'code', 'deal_type', 'price', 'area', 'sqm', 'property_type', 'elevator', 'parking', 'storage',
  'floor_label', 'unit_floor', 'floors', 'status', 'ownership_type', 'owner_user_id', 'created_at',
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Reads through PostgREST with the caller's token. RLS decides what is returned.
async function rest<T>(path: string, authz: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: authz, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`rest ${r.status}`);
  return (await r.json()) as T[];
}

function buildDeps(authz: string): CoreDeps {
  return {
    async fetchViewer(): Promise<Viewer | null> {
      // Same identity path as getCrmProfile() in index.html: auth user → web_user_access → users.
      const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: authz } });
      if (!ur.ok) return null;
      const au = (await ur.json()) as { id?: string };
      if (!au?.id) return null;
      const links = await rest<{ crm_user_id: number }>(
        `web_user_access?select=crm_user_id&auth_user_id=eq.${encodeURIComponent(au.id)}&enabled=eq.true&limit=1`,
        authz,
      );
      if (!links.length) return null;
      const users = await rest<{ id: number; role: string }>(
        `users?select=id,role&id=eq.${Number(links[0].crm_user_id)}&limit=1`,
        authz,
      );
      if (!users.length) return null;
      return { id: Number(users[0].id), role: String(users[0].role ?? '') };
    },

    async fetchClient(id: number): Promise<ClientRow | null> {
      const rows = await rest<ClientRow>(
        `clients?select=${CLIENT_COLUMNS.join(',')}&id=eq.${id}&limit=1`,
        authz,
      );
      return rows[0] ?? null;
    },

    async fetchActiveFiles(): Promise<{ rows: PropertyInput[]; complete: boolean }> {
      // Page through every active file in a stable order. The cap stops runaway reads; hitting it
      // reports complete=false so the core refuses to rank partial data.
      const statuses = `in.(${ACTIVE_PROPERTY_STATUSES.map((s) => `"${s}"`).join(',')})`;
      const PAGE = 500;
      const MAX_PAGES = 40; // 20,000 files
      const rows: PropertyInput[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const chunk = await rest<PropertyInput>(
          `properties?select=${PROPERTY_COLUMNS.join(',')}&status=${encodeURIComponent(statuses)}` +
          `&order=id.asc&limit=${PAGE}&offset=${page * PAGE}`,
          authz,
        );
        rows.push(...chunk);
        if (chunk.length < PAGE) return { rows, complete: true };
      }
      return { rows, complete: false };
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, code: 'method', error: 'method not allowed' }, 405);
  if (!SB_URL || !ANON_KEY) return json({ ok: false, code: 'config', error: 'پیکربندی سرور کامل نیست.' }, 500);

  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.startsWith('Bearer ')) return json({ ok: false, code: 'unauthorized', error: 'ورود لازم است.' }, 401);

  let body: { action?: unknown; client_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: 'bad_request', error: 'درخواست نامعتبر است.' }, 400);
  }

  try {
    const deps = buildDeps(authz);
    const out = await runMatch(body.action, body.client_id, deps);
    return json(out.body, out.status);
  } catch (e) {
    console.error('mayor-match error', (e as Error)?.message);
    return json({ ok: false, code: 'internal', error: 'خطای داخلی؛ دوباره تلاش کن.' }, 500);
  }
});
