// Pure client↔file matching engine for the AI insight layer.
//
// Mirrors matchScore() in index.html (the manual matcher). The manual matcher is
// NOT changed and this module must produce the same score, eligibility and reasons
// for the same inputs. Equivalence is checked by scripts/test-match-engine.mjs.
//
// Rules here: no I/O, no database access, no model calls. Scores are deterministic.

export const MATCH_W = { budget: 30, area: 20, sqm: 20, type: 10, elevator: 7, parking: 7, storage: 3, floor: 3 } as const;
export const MATCH_MIN_SCORE = 40;
export const LAST_FLOOR_SENTINEL = 9999;
export const TOP_N = 5;
export const ACTIVE_PROPERTY_STATUSES = ['🟢 فعال', '🟡 در مذاکره', 'فعال', 'در مذاکره'];

// Old platform spellings → bot spellings. Same mapping as canonArea() in index.html.
const AREA_LEGACY: Record<string, string> = {
  'شریعتی': 'شهرک شریعتی',
  'بوستان شمالی': 'شهرک بستان شمالی',
  'بوستان جنوبی': 'شهرک بستان جنوبی',
};

export function canonArea(a: unknown): string {
  const s = String(a ?? '');
  return Object.prototype.hasOwnProperty.call(AREA_LEGACY, s) ? AREA_LEGACY[s] : s;
}

// Loose input shapes: the engine tolerates null/undefined/strings the same way the UI does.
export interface ClientInput {
  id?: unknown;
  deal_type?: unknown;
  max_budget?: unknown;
  min_budget?: unknown;
  area?: unknown;
  min_sqm?: unknown;
  max_sqm?: unknown;
  property_type?: unknown;
  elevator_pref?: unknown;
  parking_pref?: unknown;
  storage_pref?: unknown;
  floor_pref?: unknown;
  floor_min?: unknown;
  floor_max?: unknown;
}

export interface PropertyInput {
  id?: unknown;
  code?: unknown;
  deal_type?: unknown;
  price?: unknown;
  area?: unknown;
  sqm?: unknown;
  property_type?: unknown;
  elevator?: unknown;
  parking?: unknown;
  storage?: unknown;
  floor_label?: unknown;
  unit_floor?: unknown;
  floors?: unknown;
  status?: unknown;
  ownership_type?: unknown;
  owner_user_id?: unknown;
  created_at?: unknown;
}

export interface Viewer {
  id: number;
  role: string;
}

export type CriterionStatus = 'match' | 'partial' | 'miss' | 'not_applicable';

export interface Criterion {
  key: 'budget' | 'area' | 'sqm' | 'type' | 'elevator' | 'parking' | 'storage' | 'floor';
  label: string;
  weight: number;          // maximum points for this criterion (from MATCH_W)
  applicable: boolean;     // false when the client did not specify this criterion
  points: number;          // points earned (0..weight), 0 when not applicable
  status: CriterionStatus;
  reason: string;          // same text as the manual matcher's reasons entry
}

export interface MatchResult {
  score: number;           // 0..100, rounded like the manual matcher
  coverage: number;        // sum of weights of applicable criteria (out of 100)
  eligible: boolean;       // false when a required feature is missing
  missing: string[];       // labels of required features the file lacks
  reasons: string[];       // manual-matcher reasons, same strings
  criteria: Criterion[];   // structured per-criterion breakdown
}

const numOr0 = (v: unknown): number => Number(v) || 0;
const hasFeature = (v: unknown): boolean => String(v || '').trim() === 'دارد';

function limitFit(value: number, limit: number): number {
  if (!(limit > 0)) return 1;
  if (value <= limit) return 1;
  if ((value - limit) / limit <= 0.1) return 0.5;
  return 0;
}

function floorValueOf(p: PropertyInput): number {
  const label = String(p.floor_label || '').trim();
  if (label === 'زیرزمین') return -1;
  if (label === 'همکف') return 0;
  return numOr0(p.unit_floor);
}

function isLastFloorOf(p: PropertyInput): boolean {
  if (String(p.floor_label || '').trim() === 'آخرین طبقه') return true;
  return !!numOr0(p.floors) && numOr0(p.unit_floor) === numOr0(p.floors);
}

// Returns null when deal types differ (the manual matcher does the same: no score at all).
export function matchScore(client: ClientInput, prop: PropertyInput): MatchResult | null {
  if ((String(client.deal_type || 'فروش')) !== (String(prop.deal_type || 'فروش'))) return null;

  let earned = 0;
  let possible = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  const criteria: Criterion[] = [];

  const push = (c: Omit<Criterion, 'weight' | 'applicable'> & { weight: number; applicable?: boolean }) => {
    criteria.push({ applicable: true, ...c });
  };

  // ---- budget
  {
    const bmax = numOr0(client.max_budget);
    const bmin = numOr0(client.min_budget);
    if (bmax <= 0 && bmin <= 0) {
      reasons.push('⚪ بودجه مشخص نشده');
      push({ key: 'budget', label: 'بودجه', weight: MATCH_W.budget, applicable: false, points: 0, status: 'not_applicable', reason: 'بودجه مشخص نشده' });
    } else {
      possible += MATCH_W.budget;
      const price = numOr0(prop.price);
      const fit = limitFit(price, bmax);
      if (fit === 1 && bmin > 0 && price < bmin) {
        const pts = MATCH_W.budget * 0.75;
        earned += pts;
        reasons.push('⚠️ قیمت کمتر از حداقل بودجه');
        push({ key: 'budget', label: 'بودجه', weight: MATCH_W.budget, points: pts, status: 'partial', reason: 'قیمت کمتر از حداقل بودجه' });
      } else {
        const pts = MATCH_W.budget * fit;
        earned += pts;
        if (fit === 1) {
          reasons.push('✅ بودجه');
          push({ key: 'budget', label: 'بودجه', weight: MATCH_W.budget, points: pts, status: 'match', reason: 'در بودجه' });
        } else if (fit > 0) {
          reasons.push('⚠️ تا ۱۰٪ بالاتر از سقف بودجه');
          push({ key: 'budget', label: 'بودجه', weight: MATCH_W.budget, points: pts, status: 'partial', reason: 'تا ۱۰٪ بالاتر از سقف بودجه' });
        } else {
          reasons.push('❌ بودجه');
          push({ key: 'budget', label: 'بودجه', weight: MATCH_W.budget, points: pts, status: 'miss', reason: 'بالاتر از سقف بودجه' });
        }
      }
    }
  }

  // ---- area
  if (!client.area || client.area === 'همه مناطق') {
    reasons.push('⚪ منطقه مهم نیست');
    push({ key: 'area', label: 'منطقه', weight: MATCH_W.area, applicable: false, points: 0, status: 'not_applicable', reason: 'منطقه مهم نیست' });
  } else {
    possible += MATCH_W.area;
    if (canonArea(client.area) === canonArea(prop.area)) {
      earned += MATCH_W.area;
      reasons.push('✅ منطقه');
      push({ key: 'area', label: 'منطقه', weight: MATCH_W.area, points: MATCH_W.area, status: 'match', reason: 'همان محله' });
    } else {
      reasons.push('❌ منطقه');
      push({ key: 'area', label: 'منطقه', weight: MATCH_W.area, points: 0, status: 'miss', reason: 'محله متفاوت' });
    }
  }

  // ---- sqm
  {
    const lo = numOr0(client.min_sqm);
    const hi = numOr0(client.max_sqm);
    if (lo <= 0 && hi <= 0) {
      reasons.push('⚪ متراژ مهم نیست');
      push({ key: 'sqm', label: 'متراژ', weight: MATCH_W.sqm, applicable: false, points: 0, status: 'not_applicable', reason: 'متراژ مهم نیست' });
    } else {
      possible += MATCH_W.sqm;
      const sqm = numOr0(prop.sqm);
      const upper = hi > 0 ? hi : Infinity;
      if (lo <= sqm && sqm <= upper) {
        earned += MATCH_W.sqm;
        reasons.push('✅ متراژ');
        push({ key: 'sqm', label: 'متراژ', weight: MATCH_W.sqm, points: MATCH_W.sqm, status: 'match', reason: 'داخل بازه متراژ' });
      } else {
        const ref = hi > 0 && sqm > hi ? hi : lo;
        if (ref > 0 && Math.abs(sqm - ref) / ref <= 0.1) {
          const pts = MATCH_W.sqm * 0.5;
          earned += pts;
          reasons.push('⚠️ متراژ نزدیک');
          push({ key: 'sqm', label: 'متراژ', weight: MATCH_W.sqm, points: pts, status: 'partial', reason: 'تا ۱۰٪ خارج از بازه' });
        } else {
          reasons.push('❌ متراژ');
          push({ key: 'sqm', label: 'متراژ', weight: MATCH_W.sqm, points: 0, status: 'miss', reason: 'خارج از بازه متراژ' });
        }
      }
    }
  }

  // ---- property type
  if (!client.property_type || client.property_type === 'سایر') {
    reasons.push('⚪ نوع ملک مهم نیست');
    push({ key: 'type', label: 'نوع ملک', weight: MATCH_W.type, applicable: false, points: 0, status: 'not_applicable', reason: 'نوع ملک مهم نیست' });
  } else {
    possible += MATCH_W.type;
    if (client.property_type === prop.property_type) {
      earned += MATCH_W.type;
      reasons.push('✅ نوع ملک');
      push({ key: 'type', label: 'نوع ملک', weight: MATCH_W.type, points: MATCH_W.type, status: 'match', reason: 'نوع ملک برابر' });
    } else {
      reasons.push('❌ نوع ملک');
      push({ key: 'type', label: 'نوع ملک', weight: MATCH_W.type, points: 0, status: 'miss', reason: 'نوع ملک متفاوت' });
    }
  }

  // ---- yes/no features (elevator, parking, storage)
  const feature = (
    key: Criterion['key'],
    label: string,
    pref: unknown,
    has: boolean,
    weight: number,
  ) => {
    const p = String(pref || 'مهم نیست');
    if (p === 'مهم نیست') {
      reasons.push('⚪ ' + label + ' مهم نیست');
      push({ key, label, weight, applicable: false, points: 0, status: 'not_applicable', reason: label + ' مهم نیست' });
      return;
    }
    possible += weight;
    if (has) {
      earned += weight;
      reasons.push('✅ ' + label);
      push({ key, label, weight, points: weight, status: 'match', reason: 'فایل دارد' });
    } else if (p === 'الزامی') {
      missing.push(label);
      reasons.push('🔴 ' + label + ' الزامی بود ولی فایل ندارد');
      push({ key, label, weight, points: 0, status: 'miss', reason: 'الزامی بود و فایل ندارد' });
    } else {
      reasons.push('⚠️ ' + label + ' ترجیحی بود ولی فایل ندارد');
      push({ key, label, weight, points: 0, status: 'miss', reason: 'ترجیحی بود و فایل ندارد' });
    }
  };
  feature('elevator', 'آسانسور', client.elevator_pref, hasFeature(prop.elevator), MATCH_W.elevator);
  feature('parking', 'پارکینگ', client.parking_pref, hasFeature(prop.parking), MATCH_W.parking);
  feature('storage', 'انباری', client.storage_pref, hasFeature(prop.storage), MATCH_W.storage);

  // ---- floor
  {
    const fpref = String(client.floor_pref || 'مهم نیست');
    const fmin = client.floor_min;
    const fmax = client.floor_max;
    if (fpref === 'مهم نیست' || (fmin == null && fmax == null)) {
      reasons.push('⚪ طبقه مهم نیست');
      push({ key: 'floor', label: 'طبقه', weight: MATCH_W.floor, applicable: false, points: 0, status: 'not_applicable', reason: 'طبقه مهم نیست' });
    } else {
      let ok: boolean;
      if (Number(fmin) === LAST_FLOOR_SENTINEL) {
        ok = isLastFloorOf(prop);
      } else {
        const val = floorValueOf(prop);
        ok = (fmin == null || val >= Number(fmin)) && (fmax == null || val <= Number(fmax));
      }
      feature('floor', 'طبقه', fpref, ok, MATCH_W.floor);
    }
  }

  const score = possible > 0 ? Math.round((100 * earned) / possible) : 0;
  return { score, coverage: possible, eligible: missing.length === 0, missing, reasons, criteria };
}

// Visibility rule copied from mayor/index.ts visibleTo(): managers see all;
// personal files are visible only to their owner.
export function canSeeProperty(p: PropertyInput, me: Viewer): boolean {
  return me.role === 'مدیر' || !p.ownership_type || p.ownership_type !== 'شخصی' || Number(p.owner_user_id) === me.id;
}

export type MatchTier = 'مناسب' | 'نزدیک ولی ناقص' | 'تطبیق ضعیف';

export interface RankedFile {
  property: PropertyInput;
  result: MatchResult;
  tier: MatchTier;
  rank: number;
}

export interface RankOptions {
  viewer: Viewer;                       // required: access is never skipped
  activeStatuses?: string[];            // defaults to ACTIVE_PROPERTY_STATUSES
  limit?: number;                       // defaults to TOP_N
}

export interface RankOutput {
  top: RankedFile[];
  excluded: { notActive: number; notVisible: number; dealMismatch: number };
  considered: number;                   // files that were scored
}

function tierOf(r: MatchResult): { tier: MatchTier; order: number } {
  if (r.eligible && r.score >= MATCH_MIN_SCORE) return { tier: 'مناسب', order: 2 };
  if (!r.eligible && r.score >= MATCH_MIN_SCORE) return { tier: 'نزدیک ولی ناقص', order: 1 };
  return { tier: 'تطبیق ضعیف', order: 0 };
}

// Ranking: tier (مناسب > نزدیک ولی ناقص > ضعیف), then score, coverage, newest, id.
// Same main/near split as the manual matcher, so the top files agree with what the advisor sees.
export function rankTopFiles(client: ClientInput, properties: PropertyInput[], opts: RankOptions): RankOutput {
  if (!opts || !opts.viewer || typeof opts.viewer.id !== 'number' || !opts.viewer.role) {
    throw new Error('rankTopFiles: viewer is required');
  }
  const active = new Set(opts.activeStatuses ?? ACTIVE_PROPERTY_STATUSES);
  const limit = opts.limit ?? TOP_N;
  const excluded = { notActive: 0, notVisible: 0, dealMismatch: 0 };
  const scored: { property: PropertyInput; result: MatchResult; tier: MatchTier; order: number }[] = [];

  for (const p of properties) {
    if (!active.has(String(p.status ?? ''))) { excluded.notActive++; continue; }
    if (!canSeeProperty(p, opts.viewer)) { excluded.notVisible++; continue; }
    const result = matchScore(client, p);
    if (!result) { excluded.dealMismatch++; continue; }
    const { tier, order } = tierOf(result);
    scored.push({ property: p, result, tier, order });
  }

  scored.sort((a, b) =>
    (b.order - a.order) ||
    (b.result.score - a.result.score) ||
    (b.result.coverage - a.result.coverage) ||
    String(b.property.created_at ?? '').localeCompare(String(a.property.created_at ?? '')) ||
    (numOr0(b.property.id) - numOr0(a.property.id)),
  );

  const top = scored.slice(0, limit).map((s, i) => ({ property: s.property, result: s.result, tier: s.tier, rank: i + 1 }));
  return { top, excluded, considered: scored.length };
}
