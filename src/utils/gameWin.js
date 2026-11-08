import { celebrateWin } from './celebrate';

// لو أكثر من لاعب تجاوز نقاط الفوز بنفس اللحظة: الأعلى نقاطاً هو الفائز، وعند التعادل يتشاركون المركز
// players: [{ name, score }] — يرجّع أسماء أصحاب أعلى نقاط
export function topScorerNames(players) {
  if (!players.length) return [];
  const top = Math.max(...players.map((p) => p.score));
  return players.filter((p) => p.score === top).map((p) => p.name);
}

// شاشة الفوز الموحّدة لنهاية اللعبة — نادها مرة وحدة لحظة ما يتحدد الفائز النهائي.
// winners: أسماء أو [{ name, avatar }] ، winScore: نقاط الفوز (اختياري) ، subtitle يغلب على النص الافتراضي
export function celebrateGameWin(winners, { winScore, subtitle, title, sound } = {}) {
  celebrateWin(winners, {
    title,
    sound,
    subtitle: subtitle ?? (winScore != null ? `🎯 وصل لنقاط الفوز (${winScore})` : ''),
  });
}
