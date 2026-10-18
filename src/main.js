import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { applyTrackingPreferenceFromUrl } from './utils/analytics';
import { loadGiftOptions } from './utils/tiktokBridge';
import GameDemoBtn from './components/GameDemoBtn.vue';
import LionTap from './components/LionTap.vue';
import './assets/emoji-font.css';
import './assets/shared.css';

// تحميل خط الإيموجي مبكراً عشان الرسم على الـ canvas (العجلة) يلقاه جاهز
document.fonts?.load('16px AppEmoji', '😀');

const hadTrackingParam = applyTrackingPreferenceFromUrl();
loadGiftOptions();

if (hadTrackingParam) {
  router.isReady().then(() => {
    const query = { ...router.currentRoute.value.query };
    delete query['no-track'];
    router.replace({ query });
  });
}

// زر "شرح سريع" والزر المخفي لكلمة الانضمام مسجّلين عام عشان ينحطون بأي لعبة بدون استيراد
createApp(App).use(router).component('GameDemoBtn', GameDemoBtn).component('LionTap', LionTap).mount('#app');
