<script setup>
import { onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import { touchSession } from './utils/analytics';
import { scheduleDisconnect, cancelScheduledDisconnect } from './utils/tiktokConnectionManager';
import FloatingAdBar from './components/FloatingAdBar.vue';

// تتحمّل بس بصفحات الشات روم، عشان مكتبة Supabase ما تثقّل باقي الموقع
const ChatRoomPanel = defineAsyncComponent(() => import('./components/ChatRoomPanel.vue'));

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

onMounted(() => {
  startHeartbeat();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pagehide', scheduleDisconnect);
});

onUnmounted(() => {
  stopHeartbeat();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('pagehide', scheduleDisconnect);
});
</script>

<template>
  <!-- key بالاسم: /wheel و /wheel2 نفس المكوّن، فلازم يتركّب من جديد عشان يربط المصدر الصح -->
  <router-view :key="route.name" />
  <ChatRoomPanel v-if="route.meta.chatRoom" />
  <FloatingAdBar />
</template>
