import { ref } from 'vue';

// حالة نافذة الشرح السريع — منفصلة عن data/gameDemos.js (ملف كبير) عشان ما يتحمّل إلا لما تنفتح النافذة
export const demoOpen = ref(false);

// الألعاب اللي لها شرح بـ data/gameDemos.js — لو أضفت شرح لعبة جديدة أضف اسم مسارها هنا
const DEMO_ROUTES = new Set([
  'wheel', 'dice', 'card', 'notebook', 'hex-letters', 'ships-mines', 'capitals', 'islands',
  'memory-live', 'word-game', 'apple', 'apple-solo', 'glass-bridge', 'glass-bridge-solo', 'dish',
  'chef', 'drawing', 'load', 'luggage', 'maze', 'radar', 'tug', 'unique', 'vault', 'mahdi',
  'dark-room', 'fishing', 'harvest', 'egg', 'pipe-race', 'time-bomb', 'name-ten', 'word-builder',
]);

// نسخ الموقع الثاني (/wheel2 ...) لها نفس شرح اللعبة الأصلية
export function hasDemo(routeName) {
  const name = String(routeName || '');
  return DEMO_ROUTES.has(name) || DEMO_ROUTES.has(name.replace(/2$/, ''));
}
