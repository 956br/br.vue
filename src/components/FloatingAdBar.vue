<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';

const SHOW_INTERVAL = 3 * 60 * 1000; // كل 3 دقائق
const VISIBLE_DURATION = 30 * 1000;  // تظهر لمدة 30 ثانية

const route = useRoute();
const visible = ref(false);

let showTimer = null;
let hideTimer = null;

function showAd() {
  visible.value = true;
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, VISIBLE_DURATION);
}

function scheduleShow() {
  showAd();
  showTimer = setInterval(showAd, SHOW_INTERVAL);
}

function clearTimers() {
  clearInterval(showTimer);
  clearTimeout(hideTimer);
}

function closeAd() {
  visible.value = false;
  clearTimeout(hideTimer);
}

onMounted(scheduleShow);
onUnmounted(clearTimers);
</script>

<template>
  <div v-if="visible && route.name !== 'admin'" class="floating-ad-bar">
    <button class="ad-close-btn" @click="closeAd" aria-label="إغلاق الإعلان">✕</button>
    <div class="ad-content">
      <img src="/ad-banner.png" alt="مساحة إعلانية" />
    </div>
  </div>
</template>

<style scoped>
.floating-ad-bar {
  position: fixed;
  left: 50%;
  bottom: env(safe-area-inset-bottom);
  transform: translateX(-50%);
  z-index: 120;
  width: calc(100% - 32px);
  max-width: 728px;
  aspect-ratio: 8 / 1;
  background: var(--panel-bg, rgba(255, 255, 255, 0.04));
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  box-shadow: 0 -6px 25px rgba(0, 0, 0, 0.4);
}

.ad-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ad-content img,
.ad-content video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ad-close-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

</style>
