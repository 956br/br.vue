// لو أكثر من لاعب تجاوز نقاط الفوز بنفس اللحظة: الأعلى نقاطاً هو الفائز، وعند التعادل يتشاركون المركز
// players: [{ name, score }] — يرجّع أسماء أصحاب أعلى نقاط
export function topScorerNames(players) {
  if (!players.length) return [];
  const top = Math.max(...players.map((p) => p.score));
  return players.filter((p) => p.score === top).map((p) => p.name);
}
