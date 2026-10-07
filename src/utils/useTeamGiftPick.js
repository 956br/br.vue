import { computed, ref, watch } from 'vue';
import { GIFT_OPTIONS } from './tiktokBridge';

// قيم احتياطية للهدايا اللي ما وصلت قيمتها من القائمة المنشورة
const FALLBACK_COSTS = {
  Rose: 1, TikTok: 1, 'Ice Cream Cone': 1, 'Finger Heart': 5, Panda: 5, Perfume: 20, Doughnut: 30,
  'Hand Hearts': 100, Corgi: 299, 'Money Gun': 500, Galaxy: 1000, 'Starlight Sceptre': 1200,
};

// هدايا انضمام الفريقين (نفس طريقة شد الحبل): المستضيف يحدد القيمة، وكل فريق ياخذ هدية مختلفة بنفس القيمة.
// giftA / giftB = refs فيها اسم هدية كل فريق (اللعبة تطابق عليها الهدايا الواصلة).
export function useTeamGiftPick(giftA, giftB) {
  // الهدايا المسجلة مجمّعة حسب قيمتها — بس القيم اللي فيها هديتين أو أكثر عشان الفريقين يتساوون بالقيمة
  const giftsByCost = computed(() => {
    const groups = new Map();
    GIFT_OPTIONS.slice(1).forEach((g) => {
      const cost = Number(g.diamonds) || FALLBACK_COSTS[g.value] || 0;
      if (cost <= 0) return;
      if (!groups.has(cost)) groups.set(cost, []);
      groups.get(cost).push(g);
    });
    return new Map([...groups].filter(([, gifts]) => gifts.length >= 2).sort((x, y) => x[0] - y[0]));
  });

  const giftCost = ref('');
  const giftCostOptions = computed(() => [...giftsByCost.value].map(([cost, gifts]) => ({
    value: String(cost), label: `💎 ${cost}`, hint: `${gifts.length} هدايا`,
  })));
  const optionsExcluding = (other) => (giftsByCost.value.get(Number(giftCost.value)) || [])
    .filter((g) => g.value !== other.value)
    .map(({ value, label }) => ({ value, label }));
  const giftOptionsA = computed(() => optionsExcluding(giftB));
  const giftOptionsB = computed(() => optionsExcluding(giftA));

  function setGiftCost(cost) {
    giftCost.value = String(cost || '');
    const gifts = giftsByCost.value.get(Number(cost)) || [];
    giftA.value = gifts[0]?.value || '';
    giftB.value = gifts[1]?.value || '';
  }

  // القائمة المنشورة ممكن توصل بعد فتح اللعبة: نثبّت الاختيار الحالي لو لسا صالح، وإلا ناخذ أقل قيمة متاحة
  watch(giftsByCost, (groups) => {
    const current = [...groups].find(([, gifts]) => {
      const values = gifts.map((g) => g.value);
      return giftA.value !== giftB.value && values.includes(giftA.value) && values.includes(giftB.value);
    });
    if (current) giftCost.value = String(current[0]);
    else setGiftCost([...groups.keys()][0] || '');
  }, { immediate: true });

  return {
    giftCost, giftCostOptions, giftOptionsA, giftOptionsB, setGiftCost,
  };
}
