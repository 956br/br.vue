// دوال مساعدة مشتركة بين كل ألعاب المنصة للتعامل مع أحداث جسر تيك توك (wss)
// كل لعبة تفتح اتصال WebSocket خاص بها داخل onMounted، وتستخدم هذه الدوال لتفسير البيانات

export const BRIDGE_URL = 'wss://bridge-vue.956br.fun';

// تحويل الأرقام العربية الشرقية والفارسية إلى أرقام لاتينية عادية
export function normalizeDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
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
