// Tests for supabase/functions/_shared/match-engine.ts
//  1) equivalence with the manual matchScore() in index.html (extracted and run unchanged)
//  2) ranking of top files on a real CRM snapshot (fixture, not committed)
//  3) edge, boundary, missing-data and access-control cases
// Run: node --experimental-strip-types scripts/test-match-engine.mjs
// Fixture: MATCH_FIXTURE=/path/to/snapshot.json  (JSON: {clients:[...], properties:[...]}; no contact fields)
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const engine = await import(path.join(root, 'supabase/functions/_shared/match-engine.ts'));
const { matchScore: engineScore, rankTopFiles, MATCH_W, MATCH_MIN_SCORE, canonArea } = engine;

// ---- load the manual matcher from index.html without modifying it
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const areaStart = html.indexOf('// Neighborhood names must match the Telegram bot.');
const areaEnd = html.indexOf('const LIST_SEARCH_COLS=');
const mStart = html.indexOf('const MATCH_W=');
const fnStart = html.indexOf('function matchScore(client,prop){');
const fnEnd = html.indexOf('\n}\n', fnStart) + 3;
if (areaStart < 0 || areaEnd < 0 || mStart < 0 || fnStart < 0) throw new Error('manual matcher not found in index.html');
const manual = new Function(
  html.slice(areaStart, areaEnd) + html.slice(mStart, fnEnd) + '\nreturn { matchScore, MATCH_W: MATCH_W, MATCH_MIN_SCORE: MATCH_MIN_SCORE };',
)();

let pass = 0;
const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
};

// ---- 0) weights are the documented ones
check('weights equal documented MATCH_W', JSON.stringify(MATCH_W) === JSON.stringify(manual.MATCH_W) &&
  Object.values(MATCH_W).reduce((a, b) => a + b, 0) === 100, JSON.stringify(MATCH_W));
check('minimum score is 40', MATCH_MIN_SCORE === 40 && manual.MATCH_MIN_SCORE === 40);

// ---- 1) equivalence on the real snapshot
const fixturePath = process.env.MATCH_FIXTURE || '/tmp/claude-0/-home-claude/853ebe02-fc07-5f1d-a7ec-8b9dcf2f5c21/scratchpad/snapshot.json';
if (!fs.existsSync(fixturePath)) {
  check('real snapshot fixture present', false, fixturePath);
} else {
  const snap = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { clients, properties } = snap;
  check('snapshot loaded', clients.length > 0 && properties.length > 0, `(clients=${clients.length}, files=${properties.length})`);

  let pairs = 0, nullBoth = 0, mismatches = [];
  let criteriaSumOk = true;
  for (const c of clients) {
    for (const p of properties) {
      pairs++;
      const m = manual.matchScore(c, p);
      const e = engineScore(c, p);
      if (m === null || e === null) {
        if (m !== e) mismatches.push({ client: c.id, file: p.code, what: 'null-ness', manual: m, engine: e });
        else nullBoth++;
        continue;
      }
      const same =
        m.score === e.score &&
        m.eligible === e.eligible &&
        JSON.stringify(m.missing) === JSON.stringify(e.missing) &&
        JSON.stringify(m.reasons) === JSON.stringify(e.reasons);
      if (!same) mismatches.push({ client: c.id, file: p.code, manual: { s: m.score, el: m.eligible, r: m.reasons }, engine: { s: e.score, el: e.eligible, r: e.reasons } });
      // per-criterion points add up to the same total (earned) and reproduce the score
      const earned = e.criteria.reduce((a, x) => a + x.points, 0);
      const rebuilt = e.coverage > 0 ? Math.round((100 * earned) / e.coverage) : 0;
      if (rebuilt !== e.score) criteriaSumOk = false;
    }
  }
  check(`equivalence: score, eligibility, missing, reasons match for all ${pairs} pairs`, mismatches.length === 0,
    mismatches.length ? JSON.stringify(mismatches.slice(0, 3)) : `(identical; ${nullBoth} deal-type exclusions)`);
  check('per-criterion points reproduce the score for every pair', criteriaSumOk);

  // ---- 2) ranking on real data: top list should agree with the manual main list
  const viewer = { id: 1, role: 'مدیر' };     // manager sees everything, so the manual list is unfiltered too
  const active = new Set(['🟢 فعال', '🟡 در مذاکره', 'فعال', 'در مذاکره']);
  let rankOk = true, rankDetail = [];
  for (const c of clients) {
    const manualMain = properties
      .filter((p) => active.has(p.status))
      .map((p) => ({ p, m: manual.matchScore(c, p) }))
      .filter((x) => x.m && x.m.eligible && x.m.score >= MATCH_MIN_SCORE)
      .sort((a, b) => b.m.score - a.m.score);
    const out = rankTopFiles(c, properties, { viewer });
    const engineMain = out.top.filter((x) => x.tier === 'مناسب');
    const want = manualMain.slice(0, 5).map((x) => x.m.score);
    const got = engineMain.map((x) => x.result.score);
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      rankOk = false;
      rankDetail.push({ client: c.id, want, got });
    }
    if (out.top.length > 5 || out.top.some((x, i) => x.rank !== i + 1)) rankOk = false;
  }
  check('top files agree with manual main list (score order) for every client', rankOk, rankDetail.length ? JSON.stringify(rankDetail.slice(0, 2)) : '');

  // ---- 3) access control on real data: an advisor only gets own and public files
  const advisorId = 2;
  let accessOk = true;
  for (const c of clients) {
    const out = rankTopFiles(c, properties, { viewer: { id: advisorId, role: 'مشاور' } });
    for (const r of out.top) {
      const p = r.property;
      if (p.ownership_type === 'شخصی' && Number(p.owner_user_id) !== advisorId) accessOk = false;
    }
  }
  const privateFiles = properties.filter((p) => p.ownership_type === 'شخصی').map((p) => p.code);
  check('advisor never gets another advisor\'s personal file', accessOk && privateFiles.length > 0, `(personal files in snapshot: ${privateFiles.join(',')})`);
}

// ---- 4) edge, boundary and missing-data cases (synthetic)
const base = { deal_type: 'فروش', max_budget: 0, min_budget: 0, area: '', min_sqm: 0, max_sqm: 0, property_type: '', elevator_pref: 'مهم نیست', parking_pref: 'مهم نیست', storage_pref: 'مهم نیست', floor_pref: 'مهم نیست', floor_min: null, floor_max: null };
const file = { deal_type: 'فروش', price: 0, area: 'شهرک شریعتی', sqm: 0, property_type: 'آپارتمان', elevator: 'دارد', parking: 'دارد', storage: 'دارد', floor_label: '', unit_floor: 0, floors: 0, status: '🟢 فعال', ownership_type: 'عمومی', owner_user_id: 1, created_at: '2026-10-01', id: 1 };
const score = (c, p) => engineScore({ ...base, ...c }, { ...file, ...p });
const crit = (r, key) => r.criteria.find((x) => x.key === key);

// empty client: nothing specified → score 0, eligible, no coverage
{
  const r = score({}, {});
  check('no criteria specified: score 0, coverage 0, eligible', r.score === 0 && r.coverage === 0 && r.eligible === true);
  check('no criteria: every criterion not applicable', r.criteria.every((x) => !x.applicable && x.points === 0));
}

// deal type: missing deal defaults to فروش; mismatch → null
check('deal mismatch returns null (no score)', score({ deal_type: 'اجاره' }, { deal_type: 'فروش' }) === null);
check('missing deal on both sides matches as فروش', engineScore({ max_budget: 10 }, { price: 5 }) !== null);

// budget boundaries
check('budget: price exactly at max → full points', crit(score({ max_budget: 100 }, { price: 100 }), 'budget').points === 30);
check('budget: 10% above max → half points', crit(score({ max_budget: 100 }, { price: 110 }), 'budget').points === 15);
check('budget: just over 10% above max → 0', crit(score({ max_budget: 100 }, { price: 110.01 }), 'budget').points === 0);
check('budget: below min → 75% points with reason', (() => { const x = crit(score({ max_budget: 100, min_budget: 90 }, { price: 80 }), 'budget'); return x.points === 22.5 && x.status === 'partial'; })());
check('budget: only min set, no max → no limit', crit(score({ min_budget: 50 }, { price: 999 }), 'budget').points === 30);
check('budget: unspecified → not applicable', !crit(score({}, { price: 5 }), 'budget').applicable);
check('budget: missing file price treated as 0 (fits max)', crit(score({ max_budget: 100 }, { price: null }), 'budget').points === 30);

// area
check('area: همه مناطق is not applicable', !crit(score({ area: 'همه مناطق' }, { area: 'x' }), 'area').applicable);
check('area: legacy file spelling matches bot neighborhood', crit(score({ area: 'شهرک بستان جنوبی' }, { area: 'بوستان جنوبی' }), 'area').points === 20);
check('area: legacy client spelling matches bot file spelling', crit(score({ area: 'شریعتی' }, { area: 'شهرک شریعتی' }), 'area').points === 20);
check('area: different neighborhood → 0', crit(score({ area: 'شهرک شریعتی' }, { area: 'شهرک بستان شمالی' }), 'area').points === 0);
check('canonArea: unknown and null inputs are safe', canonArea(null) === '' && canonArea('x') === 'x' && canonArea(undefined) === '');

// sqm boundaries
check('sqm: inclusive lower bound', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: 100 }), 'sqm').points === 20);
check('sqm: inclusive upper bound', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: 120 }), 'sqm').points === 20);
check('sqm: 10% outside upper bound → half points', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: 132 }), 'sqm').points === 10);
check('sqm: just beyond 10% → 0', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: 132.1 }), 'sqm').points === 0);
check('sqm: 10% below lower bound → half points', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: 90 }), 'sqm').points === 10);
check('sqm: only upper bound set, file above → checked against upper', crit(score({ max_sqm: 100 }, { sqm: 105 }), 'sqm').points === 10);
check('sqm: both zero → not applicable', !crit(score({ min_sqm: 0, max_sqm: 0 }, { sqm: 80 }), 'sqm').applicable);
check('sqm: missing file size (null) → miss with bounds', crit(score({ min_sqm: 100, max_sqm: 120 }, { sqm: null }), 'sqm').points === 0);

// property type
check('type: سایر is not applicable', !crit(score({ property_type: 'سایر' }, { property_type: 'ویلا' }), 'type').applicable);
check('type: empty file type is a miss, not a crash', crit(score({ property_type: 'آپارتمان' }, { property_type: '' }), 'type').points === 0);

// yes/no features
{
  const r1 = score({ elevator_pref: 'الزامی' }, { elevator: 'ندارد' });
  check('required feature missing → not eligible and listed', r1.eligible === false && r1.missing.includes('آسانسور'));
  const r2 = score({ elevator_pref: 'ترجیحی' }, { elevator: 'ندارد' });
  check('preferred feature missing → still eligible, 0 points', r2.eligible === true && crit(r2, 'elevator').points === 0);
  check('feature value is trimmed before comparing (" دارد ")', crit(score({ parking_pref: 'ترجیحی' }, { parking: ' دارد ' }), 'parking').points === 7);
  check('feature "ندارد" does not count as having it', crit(score({ storage_pref: 'ترجیحی' }, { storage: 'ندارد' }), 'storage').points === 0);
  check('feature empty value does not count as having it', crit(score({ storage_pref: 'ترجیحی' }, { storage: null }), 'storage').points === 0);
  check('feature "مهم نیست" is not applicable', !crit(score({ elevator_pref: 'مهم نیست' }, {}), 'elevator').applicable);
  check('feature with unknown preference is treated as preferred', score({ elevator_pref: 'نامشخص' }, { elevator: 'ندارد' }).eligible === true);
}

// floor
{
  const f = (cl, pr) => crit(score(cl, pr), 'floor');
  check('floor: مهم نیست → not applicable', !f({ floor_pref: 'مهم نیست', floor_min: 2 }, { unit_floor: 2 }).applicable);
  check('floor: no bounds → not applicable', !f({ floor_pref: 'ترجیحی' }, { unit_floor: 2 }).applicable);
  check('floor: inside range', f({ floor_pref: 'ترجیحی', floor_min: 2, floor_max: 4 }, { unit_floor: 3 }).points === 3);
  check('floor: outside range → 0', f({ floor_pref: 'ترجیحی', floor_min: 2, floor_max: 4 }, { unit_floor: 5 }).points === 0);
  check('floor: only max set', f({ floor_pref: 'ترجیحی', floor_max: 2 }, { unit_floor: 1 }).points === 3);
  check('floor: ground floor label = 0', f({ floor_pref: 'ترجیحی', floor_min: 0, floor_max: 0 }, { floor_label: 'همکف', unit_floor: 9 }).points === 3);
  check('floor: basement label = -1', f({ floor_pref: 'ترجیحی', floor_min: -1, floor_max: -1 }, { floor_label: 'زیرزمین', unit_floor: 9 }).points === 3);
  check('floor: "آخرین طبقه" sentinel matches by label', f({ floor_pref: 'الزامی', floor_min: 9999 }, { floor_label: 'آخرین طبقه' }).points === 3);
  check('floor: "آخرین طبقه" sentinel matches by floor = floors', f({ floor_pref: 'الزامی', floor_min: 9999 }, { unit_floor: 6, floors: 6 }).points === 3);
  check('floor: "آخرین طبقه" sentinel with unknown floors → miss', f({ floor_pref: 'الزامی', floor_min: 9999 }, { unit_floor: 0, floors: 0 }).points === 0);
  check('floor: required and missing → not eligible', score({ floor_pref: 'الزامی', floor_min: 5, floor_max: 9 }, { unit_floor: 2 }).eligible === false);
}

// score rounding and totals
{
  const r = score({ max_budget: 100, area: 'شهرک شریعتی', min_sqm: 100, max_sqm: 120, property_type: 'آپارتمان' }, { price: 100, area: 'شهرک شریعتی', sqm: 110, property_type: 'آپارتمان' });
  check('all matching criteria → 100', r.score === 100 && r.coverage === 30 + 20 + 20 + 10);
  const half = score({ max_budget: 100, area: 'شهرک شریعتی' }, { price: 200, area: 'شهرک شریعتی' });
  check('partial coverage: score uses only applicable weights', half.coverage === 50 && half.score === Math.round(100 * 20 / 50));
}

// ---- 5) ranking rules with synthetic files
{
  const client = { ...base, max_budget: 100, area: 'شهرک شریعتی' };
  const files = [
    { id: 1, code: 'A', deal_type: 'فروش', price: 100, area: 'شهرک شریعتی', status: '🟢 فعال', created_at: '2026-01-01', ownership_type: 'عمومی' },
    { id: 2, code: 'B', deal_type: 'فروش', price: 100, area: 'شهرک شریعتی', status: '🟢 فعال', created_at: '2026-02-01', ownership_type: 'عمومی' },
    { id: 3, code: 'C', deal_type: 'فروش', price: 999, area: 'شهرک شریعتی', status: '🟢 فعال', created_at: '2026-03-01', ownership_type: 'عمومی' },
    { id: 4, code: 'D', deal_type: 'فروش', price: 100, area: 'شهرک بستان شمالی', status: '🟢 فعال', created_at: '2026-04-01', ownership_type: 'عمومی' },
    { id: 5, code: 'E', deal_type: 'فروش', price: 100, area: 'شهرک شریعتی', status: 'خرید کرده', created_at: '2026-05-01', ownership_type: 'عمومی' },
    { id: 6, code: 'F', deal_type: 'فروش', price: 100, area: 'شهرک شریعتی', status: '🟢 فعال', created_at: '2026-06-01', ownership_type: 'شخصی', owner_user_id: 9 },
    { id: 7, code: 'G', deal_type: 'اجاره', price: 100, area: 'شهرک شریعتی', status: '🟢 فعال', created_at: '2026-07-01', ownership_type: 'عمومی' },
    { id: 8, code: 'H', deal_type: 'فروش', price: 999, area: 'شهرک بستان شمالی', status: '🟢 فعال', created_at: '2026-08-01', ownership_type: 'عمومی' },
  ];
  const r = rankTopFiles(client, files, { viewer: { id: 1, role: 'مشاور' } });
  check('ranking: inactive, other-advisor personal and deal-mismatch files are excluded',
    r.excluded.notActive === 1 && r.excluded.notVisible === 1 && r.excluded.dealMismatch === 1, JSON.stringify(r.excluded));
  const order = r.top.map((x) => x.property.code).join(',');
  check('ranking: order is B,A (100, newest first), D (60), C (40), H (0, weak)', order === 'B,A,D,C,H', order);
  check('ranking: tiers: first four مناسب, score-0 file labelled weak', r.top.slice(0, 4).every((x) => x.tier === 'مناسب') && r.top[4].tier === 'تطبیق ضعیف' && r.top[4].result.score === 0);
  check('ranking: score exactly 40 and eligible is مناسب (threshold inclusive)', (() => { const x = rankTopFiles(client, [{ ...files[2], id: 50 }], { viewer: { id: 1, role: 'مشاور' } }).top[0]; return x.result.eligible && x.result.score === 40 && x.tier === 'مناسب'; })());
  check('ranking: ranks are 1..n', r.top.every((x, i) => x.rank === i + 1));

  const manager = rankTopFiles(client, files, { viewer: { id: 1, role: 'مدیر' } });
  check('manager sees personal files of other advisors', manager.top.some((x) => x.property.code === 'F'));

  const owner = rankTopFiles(client, files, { viewer: { id: 9, role: 'مشاور' } });
  check('owner sees own personal file', owner.top.some((x) => x.property.code === 'F'));

  const limited = rankTopFiles(client, files, { viewer: { id: 1, role: 'مشاور' }, limit: 2 });
  check('limit option caps the list', limited.top.length === 2);

  const defaultTop = rankTopFiles({ ...base }, Array.from({ length: 9 }, (_, i) => ({ ...file, id: i + 1, price: 1, created_at: `2026-0${(i % 9) + 1}-01` })), { viewer: { id: 1, role: 'مشاور' } });
  check('default limit is 5 when more files exist', defaultTop.top.length === 5 && defaultTop.considered === 9);

  const none = rankTopFiles(client, [], { viewer: { id: 1, role: 'مشاور' } });
  check('no files → empty top list, no error', none.top.length === 0 && none.considered === 0);

  const fewer = rankTopFiles(client, files.slice(0, 2), { viewer: { id: 1, role: 'مشاور' } });
  check('fewer than 5 matching files → all returned', fewer.top.length === 2);

  let threw = false;
  try { rankTopFiles(client, files, {}); } catch { threw = true; }
  check('missing viewer throws (access is never skipped)', threw);
  threw = false;
  try { rankTopFiles(client, files, { viewer: { id: 1 } }); } catch { threw = true; }
  check('viewer without role throws', threw);

  const withNullStatus = rankTopFiles(client, [{ ...files[0], status: null }], { viewer: { id: 1, role: 'مشاور' } });
  check('file with null status is excluded, not an error', withNullStatus.top.length === 0 && withNullStatus.excluded.notActive === 1);
}

console.log(fails.length ? `MATCH ENGINE CHECKS FAILED (${fails.length}); passed ${pass}` : `ALL MATCH ENGINE CHECKS PASSED (${pass})`);
process.exit(fails.length ? 1 : 0);
