// Checks the list status filter definitions (pure logic extracted from index.html) and the toolbar markup.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pa = html.indexOf("const PROPERTY_ACTIVE_STATUSES="), a = html.indexOf("const LIST_STATUS_VALUES={"), b = html.indexOf("function setListStatus");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(pa, html.indexOf('\n', pa)) + '\n' + html.slice(a, b) + '\nthis.listStatusValues = listStatusValues;', ctx);
let fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!c) fail = 1; };
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
ok('clients default-active = فعال only', eq(ctx.listStatusValues('clients', 'active'), ['فعال']));
ok('clients bought includes all three purchase statuses', eq(ctx.listStatusValues('clients', 'bought'), ['خرید کرده', 'خرید کرده توسط ما', 'خرید کرده توسط دیگری']));
ok('clients cancelled = منصرف شده', eq(ctx.listStatusValues('clients', 'cancelled'), ['منصرف شده']));
ok('clients all = no status filter', ctx.listStatusValues('clients', 'all') === null);
ok('properties default-active = active statuses', eq(ctx.listStatusValues('properties', 'active'), ['🟢 فعال', '🟡 در مذاکره', 'فعال', 'در مذاکره']));
ok('properties sold = two sold statuses', ctx.listStatusValues('properties', 'sold').length === 2);
ok('properties all = no status filter', ctx.listStatusValues('properties', 'all') === null);
ok('state default is active', /clients:\{page:0,sort:'created_desc',q:'',status:'active',area:''\}/.test(html) && /properties:\{page:0,sort:'created_desc',q:'',status:'active',area:''\}/.test(html));
ok('client form has the three requested statuses', ['منصرف شده', 'خرید کرده توسط ما', 'خرید کرده توسط دیگری'].every(v => html.includes(`<option>${v}</option>`)));
ok('client form keeps legacy خرید کرده (no silent reset on edit)', html.includes('<option>خرید کرده</option></select>'));
console.log(fail ? 'LIST FILTER CHECKS FAILED' : 'ALL LIST FILTER CHECKS PASSED (logic + markup)');
// Active clients view must also include clients with an empty status.
{
  const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ok2 = src.includes("q.or('status.eq.فعال,status.is.null')");
  console.log((ok2 ? 'PASS' : 'FAIL') + ' clients active view includes empty-status clients');
  if (!ok2) process.exit(1);
}
// Neighborhood (محله) is a filter chosen from a list, not an alphabetical sort.
{
  const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const noAreaSort = !/area_(asc|desc)/.test(src);
  const hasFilter = src.includes("if(st.area) q=q.eq('area',st.area);") && src.includes('function openAreaMenu(kind,btn)') && src.includes('function loadAreaOptions(kind)');
  const ok4 = noAreaSort && hasFilter && /area:''\}/.test(src);
  console.log((ok4 ? 'PASS' : 'FAIL') + ' neighborhood filter from a list (no alphabetical area sort)');
  if (!ok4) process.exit(1);
}
