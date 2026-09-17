import { createRouter, createWebHistory } from 'vue-router';

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
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
