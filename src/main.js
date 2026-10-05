import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { applyTrackingPreferenceFromUrl } from './utils/analytics';
import { loadGiftOptions } from './utils/tiktokBridge';
import GameDemoBtn from './components/GameDemoBtn.vue';
import './assets/shared.css';

const hadTrackingParam = applyTrackingPreferenceFromUrl();
loadGiftOptions();

if (hadTrackingParam) {
  router.isReady().then(() => {
    const query = { ...router.currentRoute.value.query };
    delete query['no-track'];
    router.replace({ query });
  });
}

// زر "شرح سريع" مسجّل عام عشان ينحط بأي لعبة بدون استيراد
createApp(App).use(router).component('GameDemoBtn', GameDemoBtn).mount('#app');
