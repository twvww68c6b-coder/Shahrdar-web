// Renders the real dashboard renderer (copied from index.html) in headless Chromium with FAKE data.
// Local only: no network, no Supabase, no Telegram.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('const DASH_NEGOTIATION');
const end = html.indexOf('async function fetchBackupPayload(){');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const harness = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body style="background:#090d15;color:#f4f5f7"><section id="page-admin"><div class="panel"><div id="adminDash"></div></div></section>
<script>
const PROPERTY_ACTIVE_STATUSES=['🟢 فعال','🟡 در مذاکره','فعال','در مذاکره'];
function downloadBackup(){} function downloadBackupExcel(){}
${html.slice(start, end)}
</script></body></html>`;
fs.writeFileSync('/tmp/dash_harness.html', harness);
const data = {
  users: [{ id: 1, name: 'مدیر', role: 'مدیر', telegram_id: 111 }, { id: 2, name: 'مشاور الف', role: 'مشاور', telegram_id: 222 }, { id: 3, name: 'مشاور ب', role: 'مشاور', telegram_id: 333 }],
  access: [{ crm_user_id: 2, enabled: true }, { crm_user_id: 3, enabled: true }],
  properties: [
    { id: 1, area: 'خانی‌آباد نو جنوبی', status: '🟢 فعال', created_by: 222, created_at: '2026-10-01T10:00:00' },
    { id: 2, area: 'خانی‌آباد نو شمالی', status: '🟡 در مذاکره', created_by: 222, created_at: '2026-10-05T10:00:00' },
    { id: 3, area: 'خانی‌آباد نو جنوبی', status: '🟣 معامله شد - توسط دیگری', created_by: 333, created_at: '2026-10-06T10:00:00' }],
  clients: [{ id: 1, area: 'خانی‌آباد نو جنوبی', status: 'فعال', created_by: 222, created_at: '2026-10-02T09:00:00' }],
  visits: [{ id: 1, agent_id: 222, visited_at: '2026-10-04T12:00:00' }],
  activities: [{ user_id: 2, created_at: '2026-10-09T08:00:00' }],
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const results = [];
const pageErrors = [];
for (const [label, vw] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vw });
  page.on('pageerror', e => pageErrors.push(label + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(label + ' console: ' + m.text()); });
  await page.goto('file:///tmp/dash_harness.html');
  await page.evaluate(d => { dashData = d; renderAdminDashboard(document.getElementById('adminDash')); }, data);
  const cards = await page.$$eval('#adminDash .stat strong', els => els.map(e => e.textContent));
  const rows = await page.$$eval('#adminDash tbody tr', els => els.length);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  results.push({ label, cards: cards.length, cardValues: cards, teamRows: rows, horizontalOverflow: overflow });
  // change a filter like a user would: consultant = 222
  await page.selectOption('#adminDash .dash-field:nth-of-type(3) select', '222').catch(() => {});
  const afterFilter = await page.$$eval('#adminDash .stat strong', els => els.map(e => e.textContent));
  results.push({ label: label + ' after consultant filter', cardValues: afterFilter });
  await page.screenshot({ path: `/tmp/dash_${label}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log('page errors:', pageErrors.length ? pageErrors : 'none');
