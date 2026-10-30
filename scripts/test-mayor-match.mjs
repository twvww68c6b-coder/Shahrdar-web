// Tests for supabase/functions/_shared/mayor-match-core.ts and the mayor-match adapter (static checks).
//  - access: advisor, manager, other advisor's personal file, unauthorised client, missing client
//  - equivalence: scores equal the manual matchScore() in index.html on the real snapshot
//  - security: no contact/owner fields in output; no service role in the adapter
// Run: node --experimental-strip-types scripts/test-mayor-match.mjs
// Fixture (optional, not committed): MATCH_FIXTURE=/path/snapshot.json (clients + properties, no contact fields)
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const core = await import(path.join(root, 'supabase/functions/_shared/mayor-match-core.ts'));
const engine = await import(path.join(root, 'supabase/functions/_shared/match-engine.ts'));
const { runMatch, parseClientId, templateExplanation, canSeeClient } = core;
const { rankTopFiles } = engine;

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const areaStart = html.indexOf('// Neighborhood names must match the Telegram bot.');
const areaEnd = html.indexOf('const LIST_SEARCH_COLS=');
const mStart = html.indexOf('const MATCH_W=');
const fnStart = html.indexOf('function matchScore(client,prop){');
const fnEnd = html.indexOf('\n}\n', fnStart) + 3;
const manual = new Function(
  html.slice(areaStart, areaEnd) + html.slice(mStart, fnEnd) + '\nreturn { matchScore };',
)();

let pass = 0;
const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
};

// ---- fake data (no contact fields, mirrors the real column set)
const advisor = { id: 2, role: 'مشاور' };
const otherAdvisor = { id: 4, role: 'مشاور' };
const manager = { id: 1, role: 'مدیر' };

const clients = [
  { id: 10, deal_type: 'فروش', max_budget: 20, min_budget: 0, area: 'شهرک شریعتی', min_sqm: 80, max_sqm: 100, property_type: 'آپارتمان', ownership_type: 'عمومی', owner_user_id: 2 },
  { id: 11, deal_type: 'فروش', max_budget: 20, area: 'همه مناطق', ownership_type: 'عمومی', owner_user_id: 4 },
  { id: 12, deal_type: 'فروش', max_budget: 20, ownership_type: 'شخصی', owner_user_id: 4 },
  { id: 13, deal_type: 'فروش', max_budget: 20, ownership_type: null, owner_user_id: 9 },
];
const files = [
  { id: 100, code: 'A1', deal_type: 'فروش', price: 15, area: 'شهرک شریعتی', sqm: 90, property_type: 'آپارتمان', status: '🟢 فعال', ownership_type: 'عمومی', owner_user_id: 2, created_at: '2026-10-01' },
  { id: 101, code: 'A2', deal_type: 'فروش', price: 18, area: 'بوستان جنوبی', sqm: 85, property_type: 'آپارتمان', status: '🟢 فعال', ownership_type: 'عمومی', owner_user_id: 4, created_at: '2026-10-02' },
  { id: 102, code: 'P-OTHER', deal_type: 'فروش', price: 10, area: 'شهرک شریعتی', sqm: 90, property_type: 'آپارتمان', status: '🟢 فعال', ownership_type: 'شخصی', owner_user_id: 4, created_at: '2026-10-03' },
  { id: 103, code: 'OLD', deal_type: 'فروش', price: 10, area: 'شهرک شریعتی', sqm: 90, property_type: 'آپارتمان', status: 'معامله شد', ownership_type: 'عمومی', owner_user_id: 2, created_at: '2026-10-04' },
];

const depsFor = (viewer, rows = clients, fileRows = files) => ({
  fetchViewer: async () => viewer,
  fetchClient: async (id) => rows.find((c) => c.id === id) ?? null,
  fetchActiveFiles: async () => ({ rows: fileRows, complete: true }),
});

// ---- 1) actions and client ids
{
  const r = await runMatch('chat', 10, depsFor(advisor));
  check('only action "match" is accepted (400 otherwise)', r.status === 400 && r.body.code === 'bad_action');
  for (const bad of [0, -1, 1.5, 'abc', null, undefined, '', '1e3x', {}]) {
    const x = await runMatch('match', bad, depsFor(advisor));
    if (x.status !== 400) { check(`invalid client id rejected: ${JSON.stringify(bad)}`, false, String(x.status)); }
  }
  check('invalid client ids are rejected with 400', parseClientId('abc') === null && parseClientId(0) === null && parseClientId(1.5) === null);
  check('numeric string id is accepted', parseClientId('10') === 10 && parseClientId(10) === 10);
}

// ---- 2) authentication
{
  const r = await runMatch('match', 10, depsFor(null));
  check('no CRM profile for the caller → 401', r.status === 401 && r.body.code === 'unauthorized');
}

// ---- 3) client access
{
  const own = await runMatch('match', 10, depsFor(advisor));
  check('advisor gets own client → 200', own.status === 200 && own.body.ok === true);

  const sharedOther = await runMatch('match', 11, depsFor(advisor));
  check('advisor gets other advisor\'s non-personal client → 200', sharedOther.status === 200);

  const personalOther = await runMatch('match', 12, depsFor(advisor));
  check('advisor is refused other advisor\'s personal client → 404', personalOther.status === 404 && personalOther.body.code === 'not_found');

  const missing = await runMatch('match', 999, depsFor(advisor));
  check('missing client → 404', missing.status === 404 && missing.body.code === 'not_found');

  check('forbidden and missing client give identical bodies (no id probing)',
    JSON.stringify(personalOther.body) === JSON.stringify(missing.body));

  const mgrPersonal = await runMatch('match', 12, depsFor(manager));
  check('manager may read another advisor\'s personal client → 200', mgrPersonal.status === 200);

  const nullOwnership = await runMatch('match', 13, depsFor(advisor));
  check('null ownership_type client is visible (not personal)', nullOwnership.status === 200);
}

// ---- 4) file access (second control in the engine)
{
  const adv = await runMatch('match', 10, depsFor(advisor));
  const codes = adv.body.files.map((f) => f.code);
  check('advisor sees only own and non-personal files', codes.includes('A1') && codes.includes('A2') && !codes.includes('P-OTHER'), codes.join(','));
  check('inactive files are excluded and counted', adv.body.summary.excluded.notActive === 1 && !codes.includes('OLD'));
  const mgrCount = await runMatch('match', 10, depsFor(manager));
  check('manager sees all files, so notVisible is 0 and the key is present', mgrCount.body.summary.excluded.notVisible === 0 && 'notVisible' in mgrCount.body.summary.excluded);

  const mgr = await runMatch('match', 10, depsFor(manager, clients, files));
  check('manager sees the personal file too', mgr.body.files.some((f) => f.code === 'P-OTHER'));
}

// ---- 5) equivalence with the engine and the manual matcher
{
  const r = await runMatch('match', 10, depsFor(advisor));
  const direct = rankTopFiles(clients[0], files, { viewer: advisor });
  check('response order and scores equal direct rankTopFiles() output',
    JSON.stringify(r.body.files.map((f) => [f.property_id, f.score, f.tier])) ===
    JSON.stringify(direct.top.map((f) => [f.property.id, f.result.score, f.tier])));
  const manualOk = r.body.files.every((f) => {
    const p = files.find((x) => x.id === f.property_id);
    const m = manual.matchScore(clients[0], p);
    return m && m.score === f.score;
  });
  check('each response score equals the manual matchScore() score', manualOk);
}

const fixturePath = process.env.MATCH_FIXTURE || '/tmp/claude-0/-home-claude/853ebe02-fc07-5f1d-a7ec-8b9dcf2f5c21/scratchpad/snapshot.json';
if (fs.existsSync(fixturePath)) {
  const snap = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  let mismatches = 0, checked = 0;
  for (const c of snap.clients) {
    const r = await runMatch('match', c.id, depsFor(manager, snap.clients, snap.properties));
    if (r.status !== 200) { mismatches++; continue; }
    for (const f of r.body.files) {
      const p = snap.properties.find((x) => x.id === f.property_id);
      const m = manual.matchScore(c, p);
      checked++;
      if (!m || m.score !== f.score || m.eligible !== f.eligible) mismatches++;
    }
  }
  check(`real snapshot: ${checked} response files match manual scores and eligibility`, mismatches === 0 && checked > 0, `(mismatches=${mismatches})`);
} else {
  check('real snapshot fixture present', false, fixturePath);
}

// ---- 6) output security: no contact or owner fields, even if the row had them
{
  const leaky = clients.map((c) => ({ ...c, name: 'مشتری', phone: '09120000000', description: 'یادداشت' }));
  const leakyFiles = files.map((f) => ({ ...f, owner_name: 'مالک', owner_phone: '09121111111', description: 'توضیح' }));
  const r = await runMatch('match', 10, depsFor(advisor, leaky, leakyFiles));
  const s = JSON.stringify(r.body);
  check('output has no phone, name, owner or description fields', !/phone|owner_name|owner_phone|description|"name"/.test(s), s.match(/phone|owner_name|owner_phone|description|"name"/)?.[0] ?? '');
  check('output has no phone-number pattern', !/09\d{9}/.test(s));
}

// ---- 7) template explanation
{
  const r = await runMatch('match', 10, depsFor(advisor));
  check('explanation source is template and provider is null', r.body.explanation.source === 'template' && r.body.provider === null);
  const again = await runMatch('match', 10, depsFor(advisor));
  check('explanation is deterministic', r.body.explanation.text === again.body.explanation.text);
  check('explanation names the files it describes', r.body.files.every((f) => r.body.explanation.text.includes(`فایل ${f.code}`)));
  check('explanation without candidates says so (no invented result)', templateExplanation(10, 0, []).includes('پیدا نشد'));
  check('data sufficiency is ناکافی when no candidates', (await runMatch('match', 10, depsFor(advisor, clients, []))).body.data_sufficiency === 'ناکافی');
}

// ---- 8) access helper
{
  check('canSeeClient: manager sees personal', canSeeClient(clients[2], manager) === true);
  check('canSeeClient: advisor does not see other personal', canSeeClient(clients[2], advisor) === false);
  check('canSeeClient: owner sees own personal', canSeeClient({ ...clients[2], owner_user_id: 2 }, advisor) === true);
}

// ---- 8b) partial data is never ranked; error bodies never leak rows; counts hidden from advisors
{
  const partial = await runMatch('match', 10, { ...depsFor(advisor), fetchActiveFiles: async () => ({ rows: files.slice(0, 1), complete: false }) });
  check('partial file list → 503 incomplete_data, no files ranked', partial.status === 503 && partial.body.code === 'incomplete_data' && !('files' in partial.body));

  const adv = await runMatch('match', 10, depsFor(advisor));
  check('advisor response does not reveal hidden-file count', !('notVisible' in adv.body.summary.excluded));
  const mgr = await runMatch('match', 10, depsFor(manager));
  check('manager response keeps notVisible count', 'notVisible' in mgr.body.summary.excluded);

  const errBodies = [
    await runMatch('chat', 10, depsFor(advisor)),
    await runMatch('match', 'x', depsFor(advisor)),
    await runMatch('match', 10, depsFor(null)),
    await runMatch('match', 12, depsFor(advisor)),
    await runMatch('match', 999, depsFor(advisor)),
    await runMatch('match', 10, { ...depsFor(advisor), fetchActiveFiles: async () => ({ rows: files, complete: false }) }),
  ];
  const leakPattern = /P-OTHER|A1|A2|OLD|شریعتی|\b4\b/;
  check('no error body contains file codes or personal data', errBodies.every((r) => !leakPattern.test(JSON.stringify(r.body)) && r.status >= 400));

  let propagated = false;
  try {
    await runMatch('match', 10, { ...depsFor(advisor), fetchActiveFiles: async () => { throw new Error('rest 403 for properties'); } });
  } catch (e) { propagated = /rest 403/.test(e.message); }
  check('reader failure propagates (adapter turns it into a generic 500, no partial data)', propagated);
}

// ---- 9) adapter (static): caller JWT only, no service role, no contact columns selected
{
  const src = fs.readFileSync(path.join(root, 'supabase/functions/mayor-match/index.ts'), 'utf8');
  check('adapter does not read the service role key', !/SERVICE_ROLE/.test(src));
  check('adapter forwards the caller Authorization header', /Authorization: authz/.test(src));
  check('adapter pages in stable id order with a cap that reports incomplete data', /order=id\.asc/.test(src) && /MAX_PAGES/.test(src) && /complete: false/.test(src));
  check('adapter does not import or call the mayor function or any model', !/mayor\/index|generativelanguage|gemini/i.test(src));
  const cols = src.match(/CLIENT_COLUMNS = \[[\s\S]*?\];/)?.[0] + src.match(/PROPERTY_COLUMNS = \[[\s\S]*?\];/)?.[0];
  check('adapter selects no phone, name, owner name or description', cols && !/phone|name|owner_name|owner_phone|description/.test(cols.replace(/owner_user_id/g, '')));
  const core_src = fs.readFileSync(path.join(root, 'supabase/functions/_shared/mayor-match-core.ts'), 'utf8');
  check('core does not touch the database or network', !/fetch\(|Deno\./.test(core_src));
}

console.log(fails.length ? `MAYOR-MATCH CHECKS FAILED (${fails.length}); passed ${pass}` : `ALL MAYOR-MATCH CHECKS PASSED (${pass})`);
process.exit(fails.length ? 1 : 0);
