// شاشة الفوز الموحّدة لكل الألعاب: احتفال كامل الشاشة (كأس + صورة + اسم + قصاصات + صوت)
// المكوّن: components/WinnerCelebration.vue (مركّب مرة وحدة في App.vue)
//
// الاستخدام (بعد ما اللعبة تحدد الفائز النهائي):
//   celebrateWin(['أحمد'])
//   celebrateWin([{ name: 'أحمد', avatar: url }], { subtitle: 'وصل لـ 50 نقطة' })
//   celebrateWin([{ name: 'الفريق الأزرق', color: '#3498db' }], { title: 'الفريق الفائز' })
// تنقفل بالضغط أو زر المسافة، أو تلقائياً بعد AUTO_CLOSE_MS.
import { reactive } from 'vue';
import { sfx } from './sound';
import { getUserAvatar } from './liveConnection';

const AUTO_CLOSE_MS = 7000;

export const celebration = reactive({
  open: false,
  title: '',
  subtitle: '',
  winners: [], // [{ name, avatar, color }]
  key: 0,
});

let closeTimer = null;

// sound: false للألعاب اللي عندها صوت فوز خاص فيها
export function celebrateWin(winners, { title, subtitle = '', autoCloseMs = AUTO_CLOSE_MS, sound = true } = {}) {
  const list = (Array.isArray(winners) ? winners : [winners])
    .filter(Boolean)
    .map((w) => (typeof w === 'string' ? { name: w } : w))
    .filter((w) => w && w.name)
    // صورة اللاعب من البث لو اللعبة ما مرّرتها (الفرق لها color بدل الصورة)
    .map((w) => (w.avatar || w.color ? w : { ...w, avatar: getUserAvatar(w.name) }));
  if (!list.length) return;
  clearTimeout(closeTimer);
  Object.assign(celebration, {
    open: true,
    title: title || (list.length > 1 ? '🏆 الفائزين 🏆' : '🏆 الفائز 🏆'),
    subtitle,
    winners: list.slice(0, 6),
    key: celebration.key + 1,
  });
  if (sound) sfx('win');
  if (autoCloseMs > 0) closeTimer = setTimeout(closeCelebration, autoCloseMs);
}

export function closeCelebration() {
  clearTimeout(closeTimer);
  celebration.open = false;
}
