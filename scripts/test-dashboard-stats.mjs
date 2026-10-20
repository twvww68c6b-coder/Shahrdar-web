// Unit checks for computeDashboard (pure function extracted from index.html). Sample data is fake and local only.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('const DASH_NEGOTIATION');
const end = html.indexOf('async function loadAdminDashboard(){');
if (start < 0 || end < 0) throw new Error('dashboard functions not found');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + '\nthis.computeDashboard = computeDashboard;', ctx);
const { computeDashboard } = ctx;
const ACTIVE = ['🟢 فعال', '🟡 در مذاکره', 'فعال', 'در مذاکره'];
let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) fail = 1; };
const data = {
  users: [
    { id: 1, name: 'مدیر', role: 'مدیر', telegram_id: 111 },
    { id: 2, name: 'الف', role: 'مشاور', telegram_id: 222 },
    { id: 3, name: 'ب', role: 'مشاور', telegram_id: 333 },
    { id: 4, name: 'ج', role: 'مشاور', telegram_id: null },
  ],
  access: [{ crm_user_id: 2, enabled: true }, { crm_user_id: 3, enabled: false }],
  properties: [
    { id: 1, area: 'الف', status: '🟢 فعال', created_by: 222, created_at: '2026-10-01T10:00:00' },
    { id: 2, area: 'ب', status: '🟡 در مذاکره', created_by: 222, created_at: '2026-10-05T10:00:00' },
    { id: 3, area: 'الف', status: '🟣 معامله شد - توسط دیگری', created_by: 333, created_at: '2026-10-06T10:00:00' },
    { id: 4, area: 'ب', status: '🟢 فعال', created_by: 333, created_at: '2026-09-20T10:00:00' },
  ],
  clients: [
    { id: 1, area: 'الف', status: 'فعال', created_by: 222, created_at: '2026-10-02T09:00:00' },
    { id: 2, area: 'الف', status: 'غیرفعال', created_by: 333, created_at: '2026-10-03T09:00:00' },
  ],
  visits: [
    { id: 1, agent_id: 222, visited_at: '2026-10-04T12:00:00' },
    { id: 2, agent_id: 333, visited_at: '2026-10-07T12:00:00' },
  ],
  activities: [
    { user_id: 2, created_at: '2026-10-08T08:00:00' },
    { user_id: 2, created_at: '2026-10-09T08:00:00' },
  ],
};
const base = { from: '', to: '', consultantTg: '', area: '', propStatus: '', clientStatus: '', mode: 'day' };
const r = computeDashboard(data, base, ACTIVE);
ok('active consultants counts only enabled consultant access', r.cards.activeConsultants === 1, `got ${r.cards.activeConsultants}`);
ok('active files = active statuses', r.cards.activeFiles === 3, `got ${r.cards.activeFiles}`);
ok('active clients = status فعال', r.cards.activeClients === 1, `got ${r.cards.activeClients}`);
ok('visits total', r.cards.visits === 2);
ok('negotiations from status', r.cards.negotiations === 1, `got ${r.cards.negotiations}`);
ok('sold by others from status', r.cards.soldByOthers === 1, `got ${r.cards.soldByOthers}`);
ok('contracts marked not available (no data)', r.cards.contracts === 'داده موجود نیست');
ok('sold by us marked not available', r.cards.soldByUs === 'داده موجود نیست');
ok('no trend without range', r.trend === null);
const a = r.team.find(t => t.id === 2), b = r.team.find(t => t.id === 3);
ok('team: files of consultant A', a.files === 2, `got ${a.files}`);
ok('team: clients of consultant A', a.clients === 1);
ok('team: visits of consultant A', a.visits === 1);
ok('team: last activity from activities', a.lastActivity === '2026-10-09T08:00:00');
ok('team: consultant B no activity', b.lastActivity === '');
ok('user without telegram excluded from team', !r.team.some(t => t.id === 4));
const f = computeDashboard(data, { ...base, consultantTg: '222' }, ACTIVE);
ok('consultant filter limits files', f.cards.activeFiles === 2, `got ${f.cards.activeFiles}`);
ok('consultant filter limits visits', f.cards.visits === 1);
const d = computeDashboard(data, { ...base, from: '2026-10-01', to: '2026-10-07' }, ACTIVE);
ok('date range counts new files in range', d.trend.files.now === 3, `got ${d.trend.files.now}`);
ok('trend uses previous equal-length range (no files 24-30 Sep)', d.trend.files.prev === 0, `got ${d.trend.files.prev}`);
ok('trend clients now', d.trend.clients.now === 2);
const w = computeDashboard(data, { ...base, mode: 'week' }, ACTIVE);
ok('weekly buckets start on Monday', w.buckets.every(x => new Date(x.key + 'T00:00:00Z').getUTCDay() === 1), JSON.stringify(w.buckets.map(x => x.key)));
const m = computeDashboard(data, { ...base, mode: 'month' }, ACTIVE);
ok('monthly buckets keyed by YYYY-MM', m.buckets.every(x => /^\d{4}-\d{2}$/.test(x.key)));
const area = computeDashboard(data, { ...base, area: 'الف' }, ACTIVE);
ok('area filter applies to files and clients', area.cards.activeFiles === 1 && area.cards.activeClients === 1, `files ${area.cards.activeFiles}`);
const e = computeDashboard({ users: [], properties: [], clients: [], visits: [], activities: [], access: [] }, base, ACTIVE);
ok('empty data yields zeros and no buckets', e.cards.activeFiles === 0 && e.buckets.length === 0 && e.team.length === 0);
const bad = computeDashboard({ ...data, visits: [...data.visits, { id: 9, agent_id: 222, visited_at: null }] }, base, ACTIVE);
ok('rows with missing dates are not counted in range', bad.cards.visits === 2);
console.log(fail ? 'DASHBOARD CHECKS FAILED' : 'ALL DASHBOARD STAT CHECKS PASSED (fake local data)');
process.exit(fail);
