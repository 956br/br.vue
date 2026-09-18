import { createClient } from '@supabase/supabase-js';

const GAME_TITLES = {
  home: 'الصفحة الرئيسية',
  wheel: 'عجلة الحظ',
  'wheel-rules': 'قوانين العجلة',
  dice: 'توقع النرد',
  card: 'لعبة خمن الرقم',
  'ships-mines': 'المراكب وقنابل',
  capitals: 'دول وعواصم',
  questions: 'سؤال وجواب',
  islands: 'جزر البقاء',
  'memory-game': 'تحدي الذاكرة',
  'word-game': 'الكلمة المخفية',
  apple: 'التقط التفاح',
  'apple-solo': 'التقط التفاح — فردي',
  dish: 'شنو الطبق؟',
  luggage: 'تحدي وزن الشنطة',
  maze: 'تحدي المتاهة',
  radar: 'رادار الإقصاء',
  tug: 'شد الحبل',
  unique: 'الكلمة الفريدة',
  vault: 'لعبة الخزنة',
  wb: 'عجلة والمربعات',
  'dark-room': 'كشف المخبأ',
  'identity-reveal': 'كشف الهوية',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'باسورد غير صحيح' });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [visitsResult, connectsResult, sessionsResult] = await Promise.all([
    supabase.from('page_visits').select('game_slug, visited_at'),
    supabase.from('connect_requests').select('tiktok_username'),
    supabase.from('sessions').select('first_seen, last_seen'),
  ]);

  if (visitsResult.error || connectsResult.error || sessionsResult.error) {
    res.status(500).json({ error: 'فشل جلب البيانات من قاعدة البيانات' });
    return;
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const visitsByGame = {};
  for (const row of visitsResult.data) {
    const slug = row.game_slug;
    if (!visitsByGame[slug]) visitsByGame[slug] = { total: 0, last30d: 0 };
    visitsByGame[slug].total += 1;
    if (new Date(row.visited_at).getTime() >= thirtyDaysAgo) visitsByGame[slug].last30d += 1;
  }
  const gamesStats = Object.entries(visitsByGame)
    .map(([slug, counts]) => ({ slug, title: GAME_TITLES[slug] || slug, ...counts }))
    .sort((a, b) => b.total - a.total);

  const usernameCounts = {};
  for (const row of connectsResult.data) {
    usernameCounts[row.tiktok_username] = (usernameCounts[row.tiktok_username] || 0) + 1;
  }
  const topUsernames = Object.entries(usernameCounts)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const totalConnectRequests = connectsResult.data.length;
  const uniqueUsernames = Object.keys(usernameCounts).length;

  const totalVisitors = sessionsResult.data.length;
  const durations = sessionsResult.data
    .map((s) => (new Date(s.last_seen).getTime() - new Date(s.first_seen).getTime()) / 1000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  const avgSessionSeconds = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  res.status(200).json({
    gamesStats,
    totalConnectRequests,
    uniqueUsernames,
    topUsernames,
    totalVisitors,
    avgSessionSeconds,
    totalParticipations: totalConnectRequests,
    uniqueParticipants: uniqueUsernames,
  });
}
