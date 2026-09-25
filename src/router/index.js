import { createRouter, createWebHistory } from 'vue-router';
import { trackVisit, touchSession } from '../utils/analytics';

const routes = [
  { path: '/', name: 'home', component: () => import('../views/Home.vue') },
  { path: '/wheel', name: 'wheel', component: () => import('../views/games/Wheel.vue') },
  { path: '/wheel-rules', name: 'wheel-rules', component: () => import('../views/WheelRules.vue') },
  { path: '/dice', name: 'dice', component: () => import('../views/games/Dice.vue') },
  { path: '/card', name: 'card', component: () => import('../views/games/Card.vue') },
  { path: '/ships-mines', name: 'ships-mines', component: () => import('../views/games/ShipsMines.vue') },
  { path: '/capitals', name: 'capitals', component: () => import('../views/games/Capitals.vue') },
  { path: '/questions', name: 'questions', component: () => import('../views/games/Questions.vue') },
  { path: '/islands', name: 'islands', component: () => import('../views/games/Islands.vue') },
  { path: '/memory-game', name: 'memory-game', component: () => import('../views/games/MemoryGame.vue') },
  { path: '/memory-live', name: 'memory-live', component: () => import('../views/games/MemoryLive.vue') },
  { path: '/word-game', name: 'word-game', component: () => import('../views/games/WordGame.vue') },
  { path: '/apple', name: 'apple', component: () => import('../views/games/Apple.vue') },
  { path: '/apple-solo', name: 'apple-solo', component: () => import('../views/games/AppleSolo.vue') },
  { path: '/dish', name: 'dish', component: () => import('../views/games/Dish.vue') },
  { path: '/luggage', name: 'luggage', component: () => import('../views/games/Luggage.vue') },
  { path: '/maze', name: 'maze', component: () => import('../views/games/Maze.vue') },
  { path: '/radar', name: 'radar', component: () => import('../views/games/Radar.vue') },
  { path: '/tug', name: 'tug', component: () => import('../views/games/Tug.vue') },
  { path: '/unique', name: 'unique', component: () => import('../views/games/Unique.vue') },
  { path: '/vault', name: 'vault', component: () => import('../views/games/Vault.vue') },
  { path: '/wb', name: 'wb', component: () => import('../views/games/Wb.vue') },
  { path: '/identity-reveal', name: 'identity-reveal', component: () => import('../views/games/IdentityReveal.vue') },
  { path: '/dark-room', name: 'dark-room', component: () => import('../views/games/HideoutReveal.vue') },
  { path: '/pipe-race', name: 'pipe-race', component: () => import('../views/games/PipeRace.vue') },
  { path: '/admin', name: 'admin', component: () => import('../views/Admin.vue') },
];

// ===== الموقع الثاني (السري): كل صفحة لها نسخة برقم 2 — الرئيسية /2، والألعاب /wheel2، /dice2 ... =====
// نفس ملفات الصفحات، لكن الألعاب المربوطة بتيك توك تاخذ رسائلها من الشات روم الداخلي (راجع utils/liveConnection.js).
// site2 = الصفحة تابعة للموقع الثاني، chatRoom = لعبة تستخدم الشات روم.
const NOT_IN_SITE2 = new Set(['admin']);
const NON_LIVE_ROUTES = new Set(['home', 'wheel-rules', 'memory-game']);
const site2Routes = routes
  .filter((r) => !NOT_IN_SITE2.has(r.name))
  .map((r) => ({
    ...r,
    path: `${r.path}2`,
    name: `${r.name}2`,
    meta: { site2: true, chatRoom: !NON_LIVE_ROUTES.has(r.name) },
  }));
routes.push(...site2Routes);
routes.push({ path: '/room/:code?', name: 'room', component: () => import('../views/ChatRoom.vue') });

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// أي تنقّل داخلي من صفحة بالموقع الثاني يبقى فيه: مثلاً زر "الخروج" باللعبة (router.push('/'))
// يروح /2 بدل الرئيسية العادية، وبطاقات الرئيسية تفتح نسخ الألعاب برقم 2 — بدون تعديل كل لعبة.
router.beforeEach((to, from) => {
  if (!from.meta.site2 || to.meta.site2 || !to.name) return true;
  const twin = `${String(to.name)}2`;
  if (!router.hasRoute(twin)) return true;
  return { name: twin, params: to.params, query: to.query, hash: to.hash };
});

router.afterEach((to) => {
  if (to.name === 'admin') return;
  trackVisit(to.name);
  touchSession();
});

export default router;
