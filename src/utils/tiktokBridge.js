// دوال مساعدة مشتركة بين كل ألعاب المنصة للتعامل مع أحداث جسر تيك توك (wss)
// كل لعبة تفتح اتصال WebSocket خاص بها داخل onMounted، وتستخدم هذه الدوال لتفسير البيانات

export const BRIDGE_URL = 'wss://bridge-vue.956br.fun';

// قائمة الهدايا المستخدمة في فلتر "الانضمام عبر هدية" في كل الألعاب
export const GIFT_OPTIONS = [
  { value: '', label: '🎁 أي هدية' },
  { value: 'Rose', label: '🌹 وردة' },
  { value: 'TikTok', label: '🎵 تيك توك' },
  { value: 'Ice Cream Cone', label: '🍦 مثلجات' },
  { value: 'Finger Heart', label: '🤏 قلب الأصابع' },
  { value: 'Panda', label: '🐼 باندا' },
  { value: 'Perfume', label: '🌸 عطر' },
  { value: 'Doughnut', label: '🍩 دونات' },
  { value: 'Hand Hearts', label: '💗 قلوب الأيدي' },
  { value: 'Starlight Sceptre', label: '👑 الصولجان' },
  { value: 'Corgi', label: '🐶 كورجي' },
  { value: 'Money Gun', label: '💵 مسدس المال' },
  { value: 'Galaxy', label: '🌌 المجرة' },
];

// تحويل الأرقام العربية الشرقية والفارسية إلى أرقام لاتينية عادية
export function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// توزيع ألوان عجلة الصامل على n قطعة بحيث لا يتكرر نفس اللون بين قطعتين متجاورتين
// (بما في ذلك القطعة الأولى والأخيرة، لأن العجلة دائرية). يحدث التكرار افتراضياً
// عند التوزيع الدوري i % colors.length إذا كان عدد اللاعبين أكبر من عدد الألوان
// بمقدار يجعل آخر قطعة تطابق أول قطعة (مثلاً 9 أو 17 لاعب مع 8 ألوان).
export function assignWheelColors(n, palette) {
  const colors = [];
  for (let i = 0; i < n; i++) colors.push(palette[i % palette.length]);
  if (n > 2 && colors[n - 1] === colors[0]) {
    const prevColor = colors[n - 2];
    const nextColor = colors[0];
    const replacement = palette.find((c) => c !== prevColor && c !== nextColor);
    if (replacement) colors[n - 1] = replacement;
  }
  return colors;
}

// وسم <img> جاهز لصورة أفاتار لاعب، يُستخدم داخل نصوص v-html (سجل الأحداث، بانرات الفائز).
// يرجع نص فاضي لو ما فيه صورة، عشان ما يضيف عنصر مكسور.
export function avatarImgTag(avatarUrl, sizePx = 24) {
  if (!avatarUrl) return '';
  return `<img src="${avatarUrl}" class="player-avatar" style="width:${sizePx}px; height:${sizePx}px;" alt="">`;
}

export function getGiftName(data) {
  const raw = data.giftName || (data.gift && (data.gift.name || data.gift.giftName)) || data.name || data.gift || '';
  return String(raw);
}

export function getGiftValue(data) {
  const raw = data.diamondCount ?? data.value ?? data.coins ?? data.repeatCount
    ?? (data.gift && (data.gift.diamondCount ?? data.gift.value ?? data.gift.coins));
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

export function isGiftEvent(data) {
  return !!(data.gift || data.giftName || data.giftId || data.type === 'gift');
}

export function giftPassesFilter(data, { nameFilter = '', minValue = 0 } = {}) {
  const nf = nameFilter.trim().toLowerCase();
  if (nf && !getGiftName(data).toLowerCase().includes(nf)) return false;
  const mv = Number(minValue) || 0;
  if (mv > 0 && getGiftValue(data) < mv) return false;
  return true;
}

export function getGiftUser(data) {
  return data.user || data.uniqueId || data.username || '';
}
