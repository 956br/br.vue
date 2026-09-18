<script setup>
import { onMounted, onUnmounted } from 'vue';
import { touchSession } from './utils/analytics';

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
  } else {
    stopHeartbeat();
  }
}

onMounted(() => {
  startHeartbeat();
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  stopHeartbeat();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<template>
  <router-view />
</template>
