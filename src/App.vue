<script setup>
import { onMounted, onUnmounted, defineAsyncComponent, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { touchSession } from './utils/analytics';
import { scheduleDisconnect, cancelScheduledDisconnect } from './utils/tiktokConnectionManager';
import FloatingAdBar from './components/FloatingAdBar.vue';
import AppDialog from './components/AppDialog.vue';
import QuickControls from './components/QuickControls.vue';
import WinnerCelebration from './components/WinnerCelebration.vue';
import { demoOpen } from './utils/demoState';
import { soundMuted, toggleMute } from './utils/sound';
import { toast } from './utils/dialog';
import { cleanView, textScale, nextTextScale, helpOpen, applyTextScale } from './utils/viewPrefs';

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
const OVERLAY_SELECTOR = '.app-dialog-overlay, .winner-celebration-overlay, .rules-overlay, .modal-overlay, .players-modal-overlay, .mode-overlay, .adv-overlay, .settings-overlay, .game-overlay, .winner-overlay, .hunt-alert-overlay, .level-overlay, .demo-overlay, .modal:not(.screen)';

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

// صفحات الألعاب فقط (مو الرئيسية ولا لوحة الإدارة ولا الشات روم): يطلع فيها زر الصوت ووضع العرض النظيف
const NON_GAME = /^(home|admin|room)/;
const isGameRoute = computed(() => !!route.name && !NON_GAME.test(String(route.name)));

// العرض النظيف وتكبير النص بالألعاب بس (راجع utils/viewPrefs.js)، والطلعة من اللعبة ترجّعهم للطبيعي
watch(isGameRoute, (game) => {
  if (!game) { cleanView.value = false; helpOpen.value = false; }
  applyTextScale(game);
}, { immediate: true });
watch(textScale, () => applyTextScale(isGameRoute.value));

// اختصارات الكيبورد (ولها أزرار لمس بشريط QuickControls للجوال)
function handleShortcuts(e) {
  if (!isGameRoute.value || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const active = document.activeElement;
  if (active && (['TEXTAREA', 'SELECT', 'INPUT'].includes(active.tagName) || active.isContentEditable)) return;
  if (e.code === 'KeyH') {
    cleanView.value = !cleanView.value;
    toast(cleanView.value ? '🙈 عرض نظيف — اضغط H أو المس 👁 لإظهار الأزرار' : '👀 الأزرار ظاهرة');
  } else if (e.code === 'KeyM') {
    toggleMute();
    toast(soundMuted.value ? '🔇 الصوت مكتوم — اضغط M للتشغيل' : '🔊 الصوت شغّال');
  } else if (e.code === 'KeyT') {
    nextTextScale();
    toast(`🔠 حجم النص: ${Math.round(textScale.value * 100)}%`);
  } else if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
    helpOpen.value = !helpOpen.value;
  } else if (e.key === 'Escape' && helpOpen.value) {
    helpOpen.value = false;
  }
}

onMounted(() => {
  startHeartbeat();
  window.addEventListener('keydown', handleOverlaySpace, true);
  window.addEventListener('keydown', handleShortcuts);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pagehide', scheduleDisconnect);
});

onUnmounted(() => {
  stopHeartbeat();
  window.removeEventListener('keydown', handleOverlaySpace, true);
  window.removeEventListener('keydown', handleShortcuts);
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
  <QuickControls v-if="isGameRoute" />
  <WinnerCelebration />
  <AppDialog />
</template>
