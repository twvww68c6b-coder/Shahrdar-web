// Renders the REAL index.html login screen (logged-out state) at several sizes in headless Chromium.
// No network: Supabase/CDN scripts are blocked, so only the static login screen is evaluated.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const file = path.resolve('index.html');
const sizes = [
  ['iPhone SE 320', 320, 568], ['375', 375, 667], ['390', 390, 844], ['430', 430, 932],
  ['tablet portrait 768', 768, 1024], ['tablet landscape 1024', 1024, 768],
  ['landscape phone 844x390', 844, 390], ['laptop 1440', 1440, 900], ['wide 1920', 1920, 1080],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const STUB = () => { window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: {} }), onAuthStateChange: () => ({}) }, from: () => ({}), functions: {}, rpc: () => ({}) }) }; };
let fail = 0; const report = [];
for (const [label, w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(STUB);
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1900); // let entrance animations finish
  const m = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const form = document.getElementById('usernameLoginForm'), btn = document.getElementById('loginSubmit');
    const hero = document.querySelector('.tg-hero');
    return {
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      screenVisible: getComputedStyle(document.getElementById('telegramLoginScreen')).display !== 'none',
      shellHidden: getComputedStyle(document.querySelector('.shell')).display === 'none',
      form: r(form), btn: r(btn), hero: hero ? r(hero) : null,
      btnText: btn.textContent.trim(), formOpacity: getComputedStyle(form).opacity,
      heroTitle: document.querySelector('.tg-hero h1').textContent.trim(),
      welcome: document.querySelector('.tg-welcome').textContent.trim(),
      bgImage: getComputedStyle(document.querySelector('.tg-scene')).backgroundImage,
    };
  });
  const problems = [];
  if (m.scrollW > m.innerW + 1) problems.push(`horizontal overflow ${m.scrollW}>${m.innerW}`);
  if (m.form.l < -1 || m.form.r > m.innerW + 1) problems.push('form outside horizontal viewport');
  if (!m.screenVisible) problems.push('login screen not visible');
  if (!m.shellHidden) problems.push('app shell visible while logged out');
  if (m.formOpacity !== '1') problems.push('form not fully visible after animation: ' + m.formOpacity);
  if (!m.btnText.includes('ورود')) problems.push('submit button text changed');
  if (m.heroTitle !== 'شهردار ایران‌زمین' || m.welcome !== 'به شهردار ایران‌زمین خوش آمدید') problems.push('welcome text mismatch');
  if (m.btn.h < 40) problems.push('button too small: ' + m.btn.h);
  if (!m.bgImage.includes('tehran-night.svg')) problems.push('background not applied');
  if (errs.length) problems.push('page errors: ' + errs.join(' | '));
  if (problems.length) fail = 1;
  report.push({ label, ok: problems.length === 0, problems, layout: m.hero && m.hero.w ? (m.hero.b < m.form.t ? 'stacked' : 'side-by-side') : 'n/a' });
  await page.screenshot({ path: `/tmp/welcome_${label.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
  await page.close();
}
// reduced-motion: content must still be visible without animation
const rm = await browser.newPage({ viewport: { width: 390, height: 844 } });
await rm.addInitScript(STUB);
await rm.emulateMedia({ reducedMotion: 'reduce' });
await rm.route(/^https?:/, r => r.abort());
await rm.goto('file://' + file, { waitUntil: 'domcontentloaded' });
const rmOk = await rm.evaluate(() => ['.tg-hero', '#usernameLoginForm', '.tg-scene'].every(s => getComputedStyle(document.querySelector(s)).opacity === '1' && getComputedStyle(document.querySelector(s)).animationName === 'none'));
report.push({ label: 'reduced motion', ok: rmOk, problems: rmOk ? [] : ['content not visible or still animating'] });
if (!rmOk) fail = 1;
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.log(fail ? 'WELCOME RENDER CHECKS FAILED' : 'ALL WELCOME RENDER CHECKS PASSED (local render, no live login)');
process.exit(fail);
