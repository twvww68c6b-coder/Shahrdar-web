// "شهردار ایران‌زمین" for the web panel. Mirrors the Telegram bot's mayor features:
// chat (grounded in the caller's own data), per-file sale strategy, and ad text.
// Deployed with verify_jwt=true. The caller is resolved from their session JWT and
// web_user_access -> users; the Gemini key lives in function secrets only.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const ACTIVE_PROPERTY = ['🟢 فعال', '🟡 در مذاکره', 'فعال', 'در مذاکره'];
const ACTIVE_CLIENT = ['فعال'];
const SALE = 'فروش';
const MAYOR_NAME = 'شهردار ایران‌زمین';
const AI_UNAVAILABLE = '🤖 سرویس هوش مصنوعی فعلاً در دسترس نیست.';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAYOR_SYSTEM = `تو «${MAYOR_NAME}» هستی؛ دستیار هوشمند تیم املاک ایران‌زمین. حرفه‌ای، دقیق، نتیجه‌محور و دوستانه-کاری هستی و فارسی روان می‌نویسی. تمرکزت بر جذب مشتری، فایل‌یابی، آگهی‌گذاری، بازدید، مذاکره و قرارداد است.
قوانین سخت:
۱) هرگز اطلاعات ملک، مشتری، قیمت، فعالیت یا آمار نساز. فقط از داده‌ی داده‌شده در همین گفتگو استفاده کن.
۲) اگر اطلاعات ناقص است، سؤال بپرس یا بگو داده‌ی کافی نیست.
۳) تو در این گفتگو هیچ اقدامی (ثبت، ویرایش، حذف، ارسال پیام، انتشار آگهی) انجام نمی‌دهی و نباید ادعا کنی انجام داده‌ای؛ مشاور باید از منوهای ربات یا پنل استفاده کند.
۴) درباره‌ی احتمال فروش یا میزان تقاضا بدون داده‌ی معتبر قطعی حرف نزن.
۵) پاسخ‌ها کوتاه و کاربردی باشند.`;

const AD_PROMPT = `برای فایل ملکی زیر یک آگهی حرفه‌ای و روان فارسی بنویس.
قوانین سخت: فقط از اطلاعات داده‌شده استفاده کن. هیچ امکانات، قیمت، موقعیت، شرایط پرداخت، مدت یا ویژگی‌ای که در اطلاعات نیست اضافه نکن. هیچ عدد جدیدی اضافه نکن. شماره تلفن یا لینک ننویس. قیمت را دقیقاً با همان قالب داده‌شده بنویس.
خروجی فقط JSON: {"title": "عنوان کوتاه", "short": "نسخه کوتاه (حداکثر ۳ خط)", "full": "نسخه کامل"}

اطلاعات فایل:
`;

const SALE_PLAN_PROMPT = (facts: string) =>
  'مشاور این فایل را برای تحلیل فروش انتخاب کرده است. فقط بر اساس اطلاعات ' +
  'واقعی زیر تحلیل کن و اگر اطلاعاتی ناقص است، صریح بگو. قیمت بازار یا ' +
  'قیمت پیشنهادی را بدون داده مقایسه‌ای قطعی اعلام نکن.\n\n' +
  `اطلاعات ثبت‌شده فایل:\n${facts}\n\n` +
  'خروجی را عملی و فارسی ارائه کن: ' +
  '۱) مزیت‌های قابل‌استفاده در فروش، ۲) مشتری هدف احتمالی، ' +
  '۳) متن معرفی و تماس اولیه، ۴) اعتراض‌های محتمل و پاسخ پیشنهادی، ' +
  '۵) سناریوی بازدید و مذاکره، ۶) برنامه پیگیری تا قرارداد، ' +
  '۷) اطلاعاتی که مشاور باید قبل از تبلیغ یا مذاکره تکمیل کند. ' +
  'هیچ ویژگی، قیمت مقایسه‌ای یا اطلاعاتی درباره ملک را جعل نکن.';

class AIErr extends Error {}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v) || 0;

// ---------- database (service role; rules mirror the bot) ----------
async function sbGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}

async function currentUser(req: Request) {
  const authz = req.headers.get('Authorization') || '';
  if (!authz) return null;
  const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: authz } });
  if (!ur.ok) return null;
  const au = await ur.json();
  const wa = await sbGet<any[]>(`web_user_access?select=crm_user_id,enabled&auth_user_id=eq.${au.id}&limit=1`);
  if (!wa.length || !wa[0].enabled) return null;
  const us = await sbGet<any[]>(`users?select=id,telegram_id,name,role&id=eq.${wa[0].crm_user_id}&limit=1`);
  if (!us.length) return null;
  return { id: Number(us[0].id), tg: Number(us[0].telegram_id), role: us[0].role as string };
}

// PostgREST caps responses at the project's max rows; the bot's dataset is well under that.
async function loadData() {
  const isSale = (r: any) => !r.deal_type || r.deal_type === SALE;
  const [props, clients, visits, acts] = await Promise.all([
    sbGet<any[]>('properties?select=id,code,area,sqm,price,property_type,bedrooms,floors,unit_floor,floor_label,building_age,elevator,parking,storage,document_type,description,status,deal_type,created_by,ownership_type,owner_user_id&limit=5000'),
    sbGet<any[]>('clients?select=id,status,created_by,deal_type&limit=5000'),
    sbGet<any[]>('visits?select=property_id,client_id,agent_id,visited_at,followup_date,next_action&limit=5000'),
    sbGet<any[]>('activities?select=client_id,created_at&client_id=gt.0&limit=5000'),
  ]);
  return { props: props.filter(isSale), clients: clients.filter(isSale), visits, acts };
}

function visibleTo(p: any, me: { id: number; role: string }) {
  return me.role === 'مدیر' || !p.ownership_type || p.ownership_type !== 'شخصی' || Number(p.owner_user_id) === me.id;
}

// ---------- follow-ups (same rules as the bot's dash_followups) ----------
function parseDue(text: unknown): string | null {
  const m = norm(text).match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  let [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  try {
    if (y < 1700) {
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
      [y, mo, d] = jalaliToGregorian(y, mo, d);
    }
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const months = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > months[gm]) {
    gd -= months[gm];
    gm += 1;
  }
  return [gy, gm, gd];
}

const vtime = (v: any) => (v.visited_at ? Date.parse(v.visited_at + 'Z') : 0);

function mineSummary(d: any, me: { tg: number }) {
  const today = new Date(Date.now() + (3 * 60 + 30) * 60000).toISOString().slice(0, 10);
  const props = new Map(d.props.map((p: any) => [p.id, p]));
  const clients = new Map(d.clients.map((c: any) => [c.id, c]));
  const lastAct = new Map<number, number>();
  for (const a of d.acts) {
    const t = Date.parse(a.created_at + 'Z');
    if (!lastAct.has(a.client_id) || t > (lastAct.get(a.client_id) as number)) lastAct.set(a.client_id, t);
  }
  const latest = new Map<number, any>();
  for (const v of d.visits) {
    if (!clients.has(v.client_id)) continue;
    const cur = latest.get(v.client_id);
    if (!cur || vtime(v) > vtime(cur)) latest.set(v.client_id, v);
  }
  let overdue = 0;
  let dueToday = 0;
  for (const [cid, v] of latest) {
    const c: any = clients.get(cid);
    const p: any = props.get(v.property_id);
    if (!ACTIVE_CLIENT.includes(c.status)) continue;
    if (!p || !ACTIVE_PROPERTY.includes(p.status)) continue;
    const t0 = vtime(v);
    const handled = lastAct.has(cid) && t0 > 0 && (lastAct.get(cid) as number) > t0 + 600000;
    const due = parseDue(v.followup_date);
    if (!due || handled || Number(v.agent_id) !== me.tg) continue;
    if (due < today) overdue += 1;
    else if (due === today) dueToday += 1;
  }
  const files = d.props.filter((p: any) => Number(p.created_by) === me.tg && ACTIVE_PROPERTY.includes(p.status)).length;
  const cls = d.clients.filter((c: any) => Number(c.created_by) === me.tg && ACTIVE_CLIENT.includes(c.status)).length;
  return `فایل‌های فعال این مشاور: ${files}\nمشتریان فعال این مشاور: ${cls}\nپیگیری عقب‌افتاده: ${overdue}\nپیگیری سررسید امروز: ${dueToday}`;
}

// ---------- property facts ----------
const PHONE_RE = /(?<!\d)(?:\+?98|0)?9\d{9}(?!\d)|(?<!\d)0\d{10}(?!\d)/;
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const URL_TEST = /https?:\/\/\S+|www\.\S+/i;
function sanitize(text: unknown) {
  let t = norm(text).replace(URL_RE, '').replace(/🔗/g, '');
  t = t.replace(new RegExp(PHONE_RE.source, 'g'), '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 400);
}
function fmtNum(v: unknown) {
  const n = Number(v);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function priceShort(v: unknown) {
  const n = Number(v);
  if (!(n > 0)) return '0';
  const m = Math.round(n / 1e6);
  return `${Math.floor(m / 1000)}/${String(m % 1000).padStart(3, '0')}`;
}
const priceLabel = (v: unknown) => `${priceShort(v)} (میلیارد تومان)`;

function propertyFacts(p: any) {
  const or = (v: unknown) => (str(v) ? str(v) : 'ثبت نشده');
  return [
    `کد فایل: ${p.code}`,
    `وضعیت: ${p.status}`,
    `نوع معامله: ${p.deal_type || SALE}`,
    `منطقه: ${or(p.area)}`,
    `نوع ملک: ${or(p.property_type)}`,
    `متراژ: ${p.sqm ? p.sqm : 'ثبت نشده'} متر`,
    `قیمت ثبت‌شده: ${num(p.price) > 0 ? priceLabel(p.price) : 'ثبت نشده'}`,
    `تعداد اتاق: ${num(p.bedrooms) || 'ثبت نشده'}`,
    `سن بنا: ${p.building_age ?? 'ثبت نشده'}`,
    `طبقه: ${or(p.floor_label) !== 'ثبت نشده' ? p.floor_label : (num(p.unit_floor) ? `طبقه ${p.unit_floor}` : 'ثبت نشده')}`,
    `آسانسور: ${or(p.elevator)}`,
    `پارکینگ: ${or(p.parking)}`,
    `انباری: ${or(p.storage)}`,
    `نوع سند: ${or(p.document_type)}`,
    `توضیحات فایل: ${sanitize(p.description) || 'ثبت نشده'}`,
    'توجه: مواردی که «ثبت نشده» هستند، نباید حدس زده شوند.',
  ].join('\n');
}

function adFacts(p: any): string[] {
  const f: string[] = [];
  if (str(p.property_type)) f.push(`نوع ملک: ${p.property_type}`);
  if (str(p.area)) f.push(`منطقه: ${p.area}`);
  if (num(p.sqm) > 0) f.push(`متراژ: ${fmtNum(p.sqm)} متر`);
  if (num(p.bedrooms) > 0) f.push(`تعداد خواب: ${p.bedrooms}`);
  let floor = str(p.floor_label);
  if (!floor && num(p.unit_floor) !== 0) {
    floor = `طبقه ${p.unit_floor}`;
    if (num(p.floors) > 0) floor += ` از ${p.floors}`;
  }
  if (floor) f.push(`طبقه: ${floor}`);
  if (p.building_age !== null && p.building_age !== undefined) f.push(`سن بنا: ${p.building_age} سال`);
  for (const [label, value] of [['آسانسور', p.elevator], ['پارکینگ', p.parking], ['انباری', p.storage]] as const) {
    if (str(value)) f.push(`${label}: ${value}`);
  }
  if (str(p.document_type)) f.push(`سند: ${p.document_type}`);
  if (num(p.price) > 0) f.push(`قیمت: ${priceLabel(p.price)}`);
  const d = sanitize(p.description);
  if (d) f.push(`توضیحات مالک: ${d}`);
  return f;
}

function adTemplate(p: any) {
  const bits = [str(p.property_type) || 'ملک'];
  if (num(p.sqm) > 0) bits.push(`${fmtNum(p.sqm)} متری`);
  if (num(p.bedrooms) > 0) bits.push(`${p.bedrooms} خوابه`);
  let title = bits.join(' ');
  if (str(p.area)) title += ` در ${p.area}`;
  const facts = adFacts(p);
  let short = title;
  if (num(p.price) > 0) short += ` | قیمت: ${priceLabel(p.price)}`;
  const full = `${title}\n\n${facts.map((x) => `• ${x}`).join('\n')}`;
  return { title, short, full, source: 'template' as const };
}

const numbersIn = (text: string) => new Set(norm(text).match(/\d+/g) || []);

function parseJsonLoose(text: string): any {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* ignore */ }
  }
  return null;
}

// ---------- Gemini ----------
async function gemini(parts: unknown[], opts: { temperature?: number; json?: boolean; timeoutMs?: number; system?: string } = {}) {
  if (!GEMINI_KEY) throw new AIErr(AI_UNAVAILABLE);
  const body: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: opts.temperature ?? 0.2 },
    systemInstruction: { parts: [{ text: opts.system ?? MAYOR_SYSTEM }] },
  };
  if (opts.json) body.generationConfig.responseMimeType = 'application/json';
  const delays = [1500, 4000];
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
      });
    } catch {
      if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
      throw new AIErr('⏱ پاسخ سرویس هوش مصنوعی دیر شد؛ کمی بعد دوباره تلاش کن.');
    }
    if ([500, 502, 503, 504].includes(r.status) && attempt < delays.length) { await sleep(delays[attempt]); continue; }
    if (r.status === 429 && attempt < 1) { await sleep(3000); continue; }
    if (!r.ok) {
      console.error('gemini status', r.status);
      throw new AIErr(AI_UNAVAILABLE);
    }
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    if (!text) throw new AIErr('پاسخی از سرویس دریافت نشد؛ دوباره تلاش کن.');
    return text;
  }
}

async function generateAd(p: any) {
  const facts = adFacts(p);
  try {
    const text = await gemini([{ text: AD_PROMPT + facts.join('\n') }], { json: true, temperature: 0.4, timeoutMs: 60000 });
    const obj = parseJsonLoose(text);
    if (obj && typeof obj === 'object') {
      const title = str(obj.title);
      const short = str(obj.short);
      const full = str(obj.full);
      const combined = [title, short, full].join(' ');
      const allowed = numbersIn(facts.join('\n'));
      const grounded = [...numbersIn(combined)].every((n) => allowed.has(n));
      if (title && full && grounded && !URL_TEST.test(combined) && !PHONE_RE.test(norm(combined))) {
        return { title, short: short || title, full, source: 'ai' as const };
      }
      console.log('AD AI OUTPUT REJECTED');
    }
  } catch (e) {
    console.log('AD AI ERROR', e instanceof AIErr ? 'unavailable' : 'error');
  }
  return adTemplate(p);
}

// ---------- visible property lookup for sale plan and ad ----------
async function findVisibleProperty(code: string, me: { id: number; role: string }) {
  const rows = await sbGet<any[]>(`properties?select=*&code=eq.${encodeURIComponent(code)}&limit=1`);
  const p = rows[0];
  if (!p) return null;
  if ((p.deal_type && p.deal_type !== SALE) || !ACTIVE_PROPERTY.includes(p.status)) return null;
  if (!visibleTo(p, me)) return null;
  return p;
}

// ---------- handler ----------
type Me = { id: number; tg: number; role: string };

async function handleChat(message: string, history: { role: string; text: string }[], d: any, me: Me) {
  const trimmed = message.trim();
  const byCode = d.props.find((p: any) => ACTIVE_PROPERTY.includes(p.status) && visibleTo(p, me) && str(p.code).toLowerCase() === trimmed.toLowerCase());
  if (byCode) {
    const text = await gemini([{ text: SALE_PLAN_PROMPT(propertyFacts(byCode)) }], { temperature: 0.35, timeoutMs: 60000 });
    return { kind: 'sale_plan', text: `🎯 استراتژی فروش فایل ${byCode.code}\n\n${text.slice(0, 3500)}` };
  }
  const convo = history.slice(-8).map((h) => `${h.role}: ${h.text}`).join('\n');
  const prompt =
    'داده‌ی واقعی این مشاور (تنها منبع مجاز اعداد):\n' +
    `${mineSummary(d, me)}\n\n` +
    (convo ? `گفتگوی قبلی:\n${convo}\n\n` : '') +
    `پیام مشاور: ${message.slice(0, 1500)}` +
    '\nاگر مشاور می‌خواهد فایل مشخصی را تحلیل کند، از او بخواه «فایل» را بفرستد تا فهرست فایل‌های قابل‌دسترسی را ببیند، یا کد دقیق فایل را وارد کند.';
  const text = await gemini([{ text: prompt }], { temperature: 0.4, timeoutMs: 45000 });
  return { kind: 'chat', text: text.slice(0, 3500) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  try {
    const me = await currentUser(req);
    if (!me) return json({ ok: false, error: 'unauthorized' }, 401);
    const body = await req.json().catch(() => ({} as any));
    const d = await loadData();
    const meCtx = { ...me, tg: me.tg };

    if (body.action === 'chat') {
      const message = str(body.message);
      if (!message) return json({ ok: false, error: 'پیام خالی است.' }, 400);
      const history = Array.isArray(body.history)
        ? body.history.slice(-8).map((h: any) => ({ role: str(h.role), text: str(h.text).slice(0, 500) }))
        : [];
      return json({ ok: true, ...(await handleChat(message, history, d, meCtx)) });
    }

    if (body.action === 'sale_plan' || body.action === 'ad') {
      const code = str(body.code);
      if (!code) return json({ ok: false, error: 'کد فایل را وارد کن.' }, 400);
      const p = await findVisibleProperty(code, meCtx);
      if (!p) return json({ ok: false, error: 'این فایل برای تو قابل‌دسترسی نیست یا فعال نیست.' }, 404);
      if (body.action === 'sale_plan') {
        const text = await gemini([{ text: SALE_PLAN_PROMPT(propertyFacts(p)) }], { temperature: 0.35, timeoutMs: 60000 });
        return json({ ok: true, kind: 'sale_plan', text: `🎯 استراتژی فروش فایل ${p.code}\n\n${text.slice(0, 3500)}` });
      }
      const ad = await generateAd(p);
      return json({ ok: true, kind: 'ad', code: p.code, ...ad });
    }

    return json({ ok: false, error: 'عملیات نامعتبر است.' }, 400);
  } catch (e) {
    if (e instanceof AIErr) return json({ ok: false, error: e.message });
    console.error('mayor error', (e as Error)?.message);
    return json({ ok: false, error: 'خطای داخلی؛ دوباره تلاش کن.' }, 500);
  }
});
