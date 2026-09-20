<script setup>
import { onMounted, onUnmounted } from 'vue';
import { touchSession } from './utils/analytics';
import { scheduleDisconnect, cancelScheduledDisconnect } from './utils/tiktokConnectionManager';
import FloatingAdBar from './components/FloatingAdBar.vue';

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
  <router-view />
  <FloatingAdBar />
</template>
