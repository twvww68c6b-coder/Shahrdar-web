// Core logic of the mayor-match function (action: 'match').
// Pure: all data access is injected, so the access rules and output can be tested without a database.
// The Edge Function (mayor-match/index.ts) supplies the data using the caller's JWT (RLS applies).
// No model is called here. Explanations are template text built from the engine output.

import { canSeeProperty, rankTopFiles, MATCH_MIN_SCORE, ACTIVE_PROPERTY_STATUSES } from './match-engine.ts';
import type { ClientInput, PropertyInput, RankedFile, Viewer } from './match-engine.ts';

export interface ClientRow extends ClientInput {
  id: number;
  ownership_type?: unknown;
  owner_user_id?: unknown;
}

export interface CoreDeps {
  // Resolves the CRM user behind the caller's JWT. Returns null when the caller is not an enabled CRM user.
  fetchViewer(): Promise<Viewer | null>;
  // Returns the client row if the caller's RLS allows reading it, otherwise null.
  fetchClient(clientId: number): Promise<ClientRow | null>;
  // Returns ALL active files readable with the caller's JWT (RLS), paged to the end.
  // complete=false means the reader hit its safety cap, so the data is partial.
  fetchActiveFiles(): Promise<{ rows: PropertyInput[]; complete: boolean }>;
}

export interface CoreResponse {
  status: number;
  body: Record<string, unknown>;
}

export const CLIENT_OWNERSHIP_RULE = 'مدیر: همه؛ مشاور: مشتری‌های غیرشخصی یا با owner_user_id خودش (همان قاعدهٔ visibleToProfile پنل).';

// Same rule as visibleToProfile() in index.html, applied to a client row.
export function canSeeClient(client: ClientRow, viewer: Viewer): boolean {
  return canSeeProperty(client as unknown as PropertyInput, viewer);
}

export function parseClientId(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

const TIER_LABEL: Record<string, string> = {
  'مناسب': 'مناسب',
  'نزدیک ولی ناقص': 'نزدیک ولی ناقص',
  'تطبیق ضعیف': 'تطبیق ضعیف',
};

// Template explanation: uses only engine output (scores, statuses, reasons). No numbers are invented.
export function templateExplanation(clientId: number, considered: number, top: RankedFile[]): string {
  if (considered === 0) {
    return `برای مشتری #${clientId} فایل فعال و قابل‌دسترسی با نوع معامله مشابه پیدا نشد.`;
  }
  const counts = { 'مناسب': 0, 'نزدیک ولی ناقص': 0, 'تطبیق ضعیف': 0 } as Record<string, number>;
  for (const f of top) counts[f.tier] = (counts[f.tier] ?? 0) + 1;
  const head = `از ${considered} فایل قابل بررسی، ${top.length} فایل برتر (حد مناسب بودن: امتیاز ${MATCH_MIN_SCORE} و بدون نقص الزامی):`;
  const lines = top.map((f) => {
    const code = String(f.property.code ?? `#${f.property.id}`);
    const good = f.result.criteria.filter((c) => c.status === 'match').map((c) => c.label);
    const bad = f.result.criteria.filter((c) => c.status === 'miss' || c.status === 'partial').map((c) => c.label);
    const parts = [`${f.rank}. فایل ${code} — امتیاز ${f.result.score} (${TIER_LABEL[f.tier] ?? f.tier})`];
    if (good.length) parts.push(`مطابق: ${good.join('، ')}`);
    if (bad.length) parts.push(`نامطابق یا جزئی: ${bad.join('، ')}`);
    if (f.result.missing.length) parts.push(`ناقص الزامی: ${f.result.missing.join('، ')}`);
    return parts.join('؛ ');
  });
  return [head, ...lines, 'این توضیح قالبی است و مستقیماً از خروجی موتور تطبیق ساخته شده است.'].join('\n');
}

export async function runMatch(action: unknown, rawClientId: unknown, deps: CoreDeps): Promise<CoreResponse> {
  if (action !== 'match') {
    return { status: 400, body: { ok: false, code: 'bad_action', error: 'عملیات نامعتبر است.' } };
  }
  const clientId = parseClientId(rawClientId);
  if (clientId === null) {
    return { status: 400, body: { ok: false, code: 'bad_request', error: 'شناسه مشتری نامعتبر است.' } };
  }

  const viewer = await deps.fetchViewer();
  if (!viewer) {
    return { status: 401, body: { ok: false, code: 'unauthorized', error: 'این حساب به پروفایل CRM فعال وصل نیست.' } };
  }

  // Same response for "missing" and "not allowed" so the caller cannot probe which client ids exist.
  const client = await deps.fetchClient(clientId);
  if (!client || !canSeeClient(client, viewer)) {
    return { status: 404, body: { ok: false, code: 'not_found', error: 'مشتری پیدا نشد یا برای تو قابل‌دسترسی نیست.' } };
  }

  const fetched = await deps.fetchActiveFiles();
  // Partial data must never be ranked: the top 5 would look complete when it is not.
  if (!fetched.complete) {
    return { status: 503, body: { ok: false, code: 'incomplete_data', error: 'داده فایل‌ها کامل خوانده نشد؛ نتیجه نمایش داده نمی‌شود. دوباره تلاش کن.' } };
  }
  const out = rankTopFiles(client, fetched.rows, { viewer });
  const considered = out.considered;
  // Hidden-file counts reveal how many personal files others have, so only managers see that count.
  const excluded = viewer.role === 'مدیر'
    ? out.excluded
    : { notActive: out.excluded.notActive, dealMismatch: out.excluded.dealMismatch };

  return {
    status: 200,
    body: {
      ok: true,
      kind: 'match',
      client: { id: client.id },
      data_sufficiency: considered === 0 ? 'ناکافی' : 'کافی',
      summary: {
        considered,
        excluded,
        min_score: MATCH_MIN_SCORE,
        active_statuses: ACTIVE_PROPERTY_STATUSES,
      },
      files: out.top.map((f) => ({
        rank: f.rank,
        property_id: f.property.id,
        code: f.property.code ?? null,
        tier: f.tier,
        score: f.result.score,
        coverage: f.result.coverage,
        eligible: f.result.eligible,
        missing: f.result.missing,
        reasons: f.result.reasons,
        criteria: f.result.criteria,
        link: { table: 'properties', id: f.property.id },
      })),
      explanation: {
        text: templateExplanation(client.id as number, considered, out.top),
        source: 'template',
      },
      provider: null,
    },
  };
}
