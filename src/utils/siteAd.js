import { ref } from 'vue';

// أي لعبة تعرض إعلانها العائم بمكان إعلان الموقع ترفع هذا العلم عشان يختفي إعلان الموقع مؤقتاً
export const siteAdPaused = ref(false);
