// تفضيلات العرض داخل الألعاب (محفوظة بمتصفح الستريمر):
// - العرض النظيف: يخفي أزرار التحكم عن شاشة البث (H أو زر 🙈)
// - تكبير النص للبث: يكبّر كل نص مقاسه بـ rem (زر 🔠)
import { ref, watch } from 'vue';

const KEY = '956br-view';
export const TEXT_SCALES = [1, 1.15, 1.3];

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

const saved = read();
export const cleanView = ref(false); // ما ينحفظ: كل دخول للعبة يبدأ والأزرار ظاهرة
export const textScale = ref(TEXT_SCALES.includes(saved.textScale) ? saved.textScale : 1);
export const helpOpen = ref(false);

watch(cleanView, (on) => document.body.classList.toggle('clean-view', on));
watch(textScale, (v) => {
  try { localStorage.setItem(KEY, JSON.stringify({ textScale: v })); } catch { /* تخزين مقفل */ }
});

export function nextTextScale() {
  const i = TEXT_SCALES.indexOf(textScale.value);
  textScale.value = TEXT_SCALES[(i + 1) % TEXT_SCALES.length];
}

// يطبّق التكبير على الصفحة (ينادى من App.vue: بالألعاب بس)
export function applyTextScale(active) {
  document.documentElement.style.fontSize = active && textScale.value !== 1 ? `${textScale.value * 100}%` : '';
}
