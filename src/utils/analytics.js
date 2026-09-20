// تتبّع بسيط للزيارات وطلبات الاتصال وجلسات الزوار، يُرسل مباشرة إلى Supabase (مفتاح anon، صلاحية إضافة فقط)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SESSION_KEY = 'site_session_id';
const EXCLUDE_KEY = 'analytics_excluded';
// لو الزائر انقطع (تبويب مسكّر/جهاز نايم) أكثر من هالمدة، نعتبرها جلسة جديدة
// بدل ما نمدد جلسته القديمة إلى ما لا نهاية ونفسد متوسط مدة البقاء بالأدمن.
const SESSION_IDLE_MS = 30 * 60 * 1000;

// true يعني "جربنا نسوي صف بجدول sessions لهالجلسة الحالية"، تتصفّر تلقائياً
// كل ما تدور جلسة جديدة (شوف getSessionId) عشان touchSession يعرف يسوي صف جديد.
let sessionRowInsertAttempted = false;

function getSessionId() {
  const raw = localStorage.getItem(SESSION_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const now = Date.now();
  if (!parsed?.id || now - parsed.ts > SESSION_IDLE_MS) {
    parsed = { id: crypto.randomUUID(), ts: now };
    sessionRowInsertAttempted = false;
  } else {
    parsed.ts = now;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  return parsed.id;
}

function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// افتح الموقع مرة وحدة بـ ?no-track=1 من أي جهاز (كمبيوتر/جوال) عشان يستثني هذا المتصفح من الإحصائيات نهائياً.
// ?no-track=0 يرجّع التتبّع لنفس الجهاز. يرجّع true لو لازم تنضّف الرابط من الباراميتر بعدين (بعد ما الراوتر يجهز).
export function applyTrackingPreferenceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('no-track')) return false;
  const disable = params.get('no-track') !== '0';
  if (disable) localStorage.setItem(EXCLUDE_KEY, '1');
  else localStorage.removeItem(EXCLUDE_KEY);
  return true;
}

function isExcluded() {
  try {
    return localStorage.getItem(EXCLUDE_KEY) === '1';
  } catch {
    return false;
  }
}

async function supabaseRequest(table, { method = 'POST', body, query = '', prefer = '' } = {}) {
  if (!isConfigured() || isExcluded()) return;
  try {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // تتبّع اختياري: أي فشل بالشبكة لا يجب أن يكسر تجربة اللاعب
  }
}

export function trackVisit(gameSlug) {
  if (!gameSlug) return;
  supabaseRequest('page_visits', {
    body: { game_slug: gameSlug, session_id: getSessionId() },
  });
}

export function trackConnectRequest(gameSlug, tiktokUsername) {
  if (!gameSlug || !tiktokUsername) return;
  supabaseRequest('connect_requests', {
    body: { game_slug: gameSlug, tiktok_username: tiktokUsername, session_id: getSessionId() },
  });
}

export function touchSession() {
  const sessionId = getSessionId();
  const now = new Date().toISOString();

  // نحاول إنشاء صف الجلسة مرة وحدة بس بأول تحميل؛ لو موجود مسبقاً بتفشل الإضافة بصمت (مفتاح session_id مكرر) وهذا متوقّع.
  // تعمّدنا نتجنب Prefer: resolution=ignore-duplicates لأن upsert بهذا الشكل يحتاج صلاحية SELECT على الجدول،
  // وما نبي نمنح anon قراءة الجلسات (حماية خصوصية الزوار).
  if (!sessionRowInsertAttempted) {
    sessionRowInsertAttempted = true;
    supabaseRequest('sessions', {
      body: { session_id: sessionId, first_seen: now, last_seen: now },
    });
  }

  supabaseRequest('sessions', {
    method: 'PATCH',
    query: `?session_id=eq.${sessionId}`,
    body: { last_seen: now },
  });
}
