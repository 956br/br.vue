// الحركة السرية: 5 ضغطات سريعة على الزر المخفي (LionTap) بزاوية نافذة "إدارة طريقة الانضمام" تبدّل كلمة الانضمام بين 1 و 🦁
// تشتغل بكل الألعاب: تعدّل حقل الكلمة بالنافذة وترسل input عشان v-model يتحدّث
const LION = '🦁';
const DEFAULT_WORD = '1';
const TAPS_NEEDED = 5;
const TAP_WINDOW_MS = 1500;

let taps = [];

export function registerLionTap(cardEl) {
  const now = Date.now();
  taps = taps.filter((t) => now - t < TAP_WINDOW_MS);
  taps.push(now);
  if (taps.length < TAPS_NEEDED) return;
  taps = [];
  const input = cardEl?.querySelector('.join-settings-row input[type="text"]');
  if (!input) return; // الانضمام بالهدية مفعّل، فما فيه حقل كلمة
  input.value = input.value.trim() === LION ? DEFAULT_WORD : LION;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
