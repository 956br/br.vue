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

  const { password, action = 'stats' } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'باسورد غير صحيح' });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (action === 'reset') {
    const now = new Date().toISOString();
    const [d1, d2, d3, settingResult] = await Promise.all([
      supabase.from('page_visits').delete().not('id', 'is', null),
      supabase.from('connect_requests').delete().not('id', 'is', null),
      supabase.from('sessions').delete().not('session_id', 'is', null),
      supabase.from('admin_settings').upsert({ key: 'last_reset_at', value: now }),
    ]);
    if (d1.error || d2.error || d3.error || settingResult.error) {
      res.status(500).json({ error: 'فشل تصفير البيانات' });
      return;
    }
    res.status(200).json({ success: true, lastResetAt: now });
    return;
  }

  if (action === 'export') {
    const [visits, connects, sessions] = await Promise.all([
      supabase.from('page_visits').select('*'),
      supabase.from('connect_requests').select('*'),
      supabase.from('sessions').select('*'),
    ]);
    if (visits.error || connects.error || sessions.error) {
      res.status(500).json({ error: 'فشل تصدير البيانات' });
      return;
    }
    res.status(200).json({
      exportedAt: new Date().toISOString(),
      page_visits: visits.data,
      connect_requests: connects.data,
      sessions: sessions.data,
    });
    return;
  }

  const [visitsResult, connectsResult, sessionsResult, lastResetResult] = await Promise.all([
    supabase.from('page_visits').select('game_slug, visited_at'),
    supabase.from('connect_requests').select('tiktok_username, requested_at, game_slug, session_id'),
    supabase.from('sessions').select('session_id, first_seen, last_seen'),
    supabase.from('admin_settings').select('value').eq('key', 'last_reset_at').maybeSingle(),
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

  // جلسة تتجاوز هالمدة تعتبر بيانات قديمة/شاذة (من قبل إصلاح تدوير الجلسة بالمتصفح)
  // ولازم تُستبعد من المتوسط والوسيط حتى ما تفسدهم.
  const MAX_REASONABLE_SESSION_SECONDS = 4 * 60 * 60;

  const totalVisitors = sessionsResult.data.length;
  const sessionDurationById = new Map();
  const allDurations = [];
  for (const s of sessionsResult.data) {
    const d = (new Date(s.last_seen).getTime() - new Date(s.first_seen).getTime()) / 1000;
    if (!Number.isFinite(d) || d < 0) continue;
    sessionDurationById.set(s.session_id, d);
    if (d <= MAX_REASONABLE_SESSION_SECONDS) allDurations.push(d);
  }
  const excludedOutlierSessions = totalVisitors - allDurations.length;
  const avgSessionSeconds = allDurations.length
    ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
    : 0;
  const sortedDurations = [...allDurations].sort((a, b) => a - b);
  const medianSessionSeconds = sortedDurations.length
    ? Math.round(
        sortedDurations.length % 2 === 1
          ? sortedDurations[(sortedDurations.length - 1) / 2]
          : (sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2,
      )
    : 0;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sessionsToday = sessionsResult.data.filter(
    (s) => new Date(s.first_seen).getTime() >= startOfToday.getTime(),
  ).length;

  const totalPageViews = visitsResult.data.length;
  const avgGamesPerSession = totalVisitors ? Math.round((totalPageViews / totalVisitors) * 10) / 10 : 0;

  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const usernameStatsMap = {};
  for (const row of connectsResult.data) {
    const username = row.tiktok_username;
    if (!usernameStatsMap[username]) {
      usernameStatsMap[username] = {
        total: 0, last30d: 0, last24h: 0, last1h: 0, lastRequestAt: null,
        sessionIds: new Set(), gamesMap: new Map(),
      };
    }
    const stats = usernameStatsMap[username];
    stats.total += 1;
    const requestedAt = new Date(row.requested_at).getTime();
    if (requestedAt >= thirtyDaysAgo) stats.last30d += 1;
    if (requestedAt >= twentyFourHoursAgo) stats.last24h += 1;
    if (requestedAt >= oneHourAgo) stats.last1h += 1;
    if (!stats.lastRequestAt || requestedAt > new Date(stats.lastRequestAt).getTime()) {
      stats.lastRequestAt = row.requested_at;
    }
    if (row.session_id) stats.sessionIds.add(row.session_id);
    if (row.game_slug) stats.gamesMap.set(row.game_slug, (stats.gamesMap.get(row.game_slug) || 0) + 1);
  }

  const allUsernames = Object.entries(usernameStatsMap)
    .map(([username, stats]) => {
      let totalSeconds = 0;
      for (const sid of stats.sessionIds) {
        const d = sessionDurationById.get(sid);
        if (Number.isFinite(d)) totalSeconds += Math.min(d, MAX_REASONABLE_SESSION_SECONDS);
      }
      const games = [...stats.gamesMap.entries()]
        .map(([slug, count]) => ({ slug, title: GAME_TITLES[slug] || slug, count }))
        .sort((a, b) => b.count - a.count);
      return {
        username,
        total: stats.total,
        last30d: stats.last30d,
        last24h: stats.last24h,
        last1h: stats.last1h,
        lastRequestAt: stats.lastRequestAt,
        sessionsCount: stats.sessionIds.size,
        totalSeconds: Math.round(totalSeconds),
        games,
      };
    })
    .sort((a, b) => b.total - a.total);

  const topUsernames = allUsernames.slice(0, 50);

  const totalConnectRequests = connectsResult.data.length;
  const uniqueUsernames = allUsernames.length;

  res.status(200).json({
    gamesStats,
    totalConnectRequests,
    uniqueUsernames,
    topUsernames,
    allUsernames,
    totalVisitors,
    avgSessionSeconds,
    medianSessionSeconds,
    excludedOutlierSessions,
    sessionsToday,
    totalPageViews,
    avgGamesPerSession,
    totalParticipations: totalConnectRequests,
    uniqueParticipants: uniqueUsernames,
    lastResetAt: lastResetResult.data?.value || null,
  });
}
