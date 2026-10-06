<script setup>
import { onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import { touchSession } from './utils/analytics';
import { scheduleDisconnect, cancelScheduledDisconnect } from './utils/tiktokConnectionManager';
import FloatingAdBar from './components/FloatingAdBar.vue';
import { demoOpen } from './data/gameDemos';

// تتحمّل بس بصفحات الشات روم، عشان مكتبة Supabase ما تثقّل باقي الموقع
const ChatRoomPanel = defineAsyncComponent(() => import('./components/ChatRoomPanel.vue'));
// نافذة الشرح العملي السريع، تتحمّل أول ما ينضغط زر "شرح سريع" داخل اللعبة
const GameDemo = defineAsyncComponent(() => import('./components/GameDemo.vue'));

const route = useRoute();
let heartbeatInterval = null;

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(touchSession, 20000);
}

function stopHeartbeat() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    touchSession();
    startHeartbeat();
    cancelScheduledDisconnect();
  } else {
    stopHeartbeat();
    scheduleDisconnect();
  }
}

// الطبقات اللي لو وحدة منها مفتوحة ما يبدأ زر المسافة جولة، ويضغط زرها الرئيسي بدالها.
// (.screen مستثناة: شاشات نهاية الجولة اللي اللعبة نفسها تتحكم بمسافتها)
const OVERLAY_SELECTOR = '.rules-overlay, .modal-overlay, .players-modal-overlay, .mode-overlay, .adv-overlay, .settings-overlay, .game-overlay, .winner-overlay, .hunt-alert-overlay, .level-overlay, .demo-overlay, .modal:not(.screen)';

function findTopOverlay() {
  let top = null;
  let topZ = -Infinity;
  document.querySelectorAll(OVERLAY_SELECTOR).forEach((el) => {
    if (!el.getClientRects().length) return;
    const z = Number(getComputedStyle(el).zIndex) || 0;
    if (z >= topZ) { top = el; topZ = z; }
  });
  return top;
}

// يشتغل بمرحلة الالتقاط (capture) قبل معالجات الألعاب، فيوقف الحدث عنها لو فيه طبقة مفتوحة
function handleOverlaySpace(e) {
  if (e.code !== 'Space' && e.key !== ' ') return;
  const active = document.activeElement;
  if (active && (['TEXTAREA', 'SELECT', 'INPUT'].includes(active.tagName) || active.isContentEditable)) return;
  const overlay = findTopOverlay();
  if (!overlay) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  // لو الزر المركّز عليه غير الرئيسي، نشيل التركيز عشان المتصفح ما يضغطه هو بعد
  if (active && active.tagName === 'BUTTON') active.blur();
  const mainBtns = [...overlay.querySelectorAll('button.master-btn:not(:disabled)')].filter((btn) => btn.getClientRects().length);
  if (mainBtns.length) mainBtns[mainBtns.length - 1].click();
}

onMounted(() => {
  startHeartbeat();
  window.addEventListener('keydown', handleOverlaySpace, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pagehide', scheduleDisconnect);
});

onUnmounted(() => {
  stopHeartbeat();
  window.removeEventListener('keydown', handleOverlaySpace, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('pagehide', scheduleDisconnect);
});
</script>

<template>
  <!-- key بالاسم: /wheel و /wheel2 نفس المكوّن، فلازم يتركّب من جديد عشان يربط المصدر الصح -->
  <router-view :key="route.name" />
  <ChatRoomPanel v-if="route.meta.chatRoom" />
  <FloatingAdBar />
  <GameDemo v-if="demoOpen" />
</template>
