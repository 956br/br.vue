import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { applyTrackingPreferenceFromUrl } from './utils/analytics';
import './assets/shared.css';

const hadTrackingParam = applyTrackingPreferenceFromUrl();

if (hadTrackingParam) {
  router.isReady().then(() => {
    const query = { ...router.currentRoute.value.query };
    delete query['no-track'];
    router.replace({ query });
  });
}

createApp(App).use(router).mount('#app');
