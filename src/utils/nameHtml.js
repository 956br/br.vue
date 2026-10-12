// عزل اتجاه أسماء اللاعبين: الاسم الإنجليزي داخل جملة عربية يلخبط ترتيب الأرقام والأقواس اللي حوله،
// فنعزله كقطعة مستقلة (الاسم نفسه ما يتغير، والأسماء العربية ما تتأثر).

import { displayName } from './tiktokConnectionManager';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// الدالتين تمررون الاسم على displayName: يخفي يوزر تيك توك من الاسم إلا وقت تكرار النك نيم.

// للنصوص اللي تنعرض كـ HTML (v-html): يهرّب الاسم ويحطه داخل <bdi>
export function nameHtml(str) {
  return `<bdi>${escapeHtml(displayName(str))}</bdi>`;
}

// للنصوص العادية (بدون HTML): يحوّط الاسم برمزي العزل FSI/PDI المخفيين — للعرض فقط، مو للمقارنة
export function nameText(str) {
  return `⁨${displayName(str)}⁩`;
}
