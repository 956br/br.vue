import { ref, watch } from 'vue';
import { tiktokState } from './tiktokConnectionManager';

// حالة طيّ الشريط العائم في صفحات الألعاب.
// ينطوي تلقائياً أول ما يتأكد الاتصال بالبث، ويبدأ مطوي لو الاتصال قائم من قبل.
// المستضيف يقدر يفتحه يدوياً بعدها بزر ➕.
export function useFloatingBar() {
  const barExpanded = ref(!tiktokState.live);
  watch(() => tiktokState.live, (live) => {
    if (live) barExpanded.value = false;
  });
  return barExpanded;
}
