<script setup>
// شريط التحكم السريع داخل الألعاب (بديل اللمس لاختصارات الكيبورد — يشتغل بالجوال):
// 🔊 كتم (M) · 🙈 عرض نظيف (H) · 🔠 تكبير النص للبث (T) · ❓ الاختصارات (?)
// بالعرض النظيف يتحوّل لزر 👁 شبه مخفي، اللمس عليه يرجّع الأزرار.
import { computed } from 'vue';
import { soundMuted, toggleMute } from '../utils/sound';
import { cleanView, textScale, nextTextScale, helpOpen } from '../utils/viewPrefs';
import { toast } from '../utils/dialog';

const scaleLabel = computed(() => `${Math.round(textScale.value * 100)}%`);

function toggleClean() {
  cleanView.value = !cleanView.value;
  if (cleanView.value) toast('🙈 عرض نظيف — المس 👁 أو اضغط H لإظهار الأزرار');
}

function cycleScale() {
  nextTextScale();
  toast(`🔠 حجم النص: ${scaleLabel.value}`);
}

const SHORTCUTS = [
  { key: 'Space', touch: 'الزر الأخضر', desc: 'الخطوة الجاية (بدء / جولة جديدة / تأكيد)' },
  { key: 'H', touch: '🙈 / 👁', desc: 'عرض نظيف: إخفاء/إظهار أزرار التحكم عن البث' },
  { key: 'M', touch: '🔊 / 🔇', desc: 'كتم/تشغيل كل أصوات اللعبة' },
  { key: 'T', touch: '🔠', desc: 'تكبير النص للبث (100% ← 115% ← 130%)' },
  { key: 'Enter', touch: '—', desc: 'تأكيد بنوافذ التأكيد' },
  { key: 'Esc', touch: 'المس خارج النافذة', desc: 'إلغاء/إغلاق النافذة' },
  { key: '?', touch: '❓', desc: 'هالقائمة' },
];
</script>

<template>
  <div class="quick-controls" :class="{ collapsed: cleanView }">
    <template v-if="!cleanView">
      <button
        type="button"
        class="qc-btn"
        :title="soundMuted ? 'تشغيل الصوت (M)' : 'كتم الصوت (M)'"
        :aria-label="soundMuted ? 'تشغيل الصوت' : 'كتم الصوت'"
        @click="toggleMute"
      >{{ soundMuted ? '🔇' : '🔊' }}</button>
      <button type="button" class="qc-btn" title="عرض نظيف للبث (H)" aria-label="إخفاء أزرار التحكم" @click="toggleClean">🙈</button>
      <button type="button" class="qc-btn qc-scale" :title="`تكبير النص للبث (T) — ${scaleLabel}`" aria-label="تكبير النص" @click="cycleScale">
        🔠<small v-if="textScale !== 1">{{ scaleLabel }}</small>
      </button>
      <button type="button" class="qc-btn" title="الاختصارات (?)" aria-label="الاختصارات" @click="helpOpen = true">❓</button>
    </template>
    <button v-else type="button" class="qc-btn qc-reveal" title="إظهار الأزرار (H)" aria-label="إظهار أزرار التحكم" @click="toggleClean">👁</button>
  </div>

  <div v-if="helpOpen" class="rules-overlay qc-help-overlay" @click.self="helpOpen = false">
    <div class="qc-help-card">
      <h3>⌨️ الاختصارات</h3>
      <table class="qc-help-table">
        <thead>
          <tr><th>كيبورد</th><th>جوال</th><th>وش يسوي</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in SHORTCUTS" :key="s.key">
            <td><kbd>{{ s.key }}</kbd></td>
            <td>{{ s.touch }}</td>
            <td>{{ s.desc }}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" class="master-btn" @click="helpOpen = false">فهمت 👍</button>
    </div>
  </div>
</template>

<style scoped>
.quick-controls {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 1300;
  display: flex;
  gap: 6px;
  padding: 5px;
  border-radius: var(--radius-pill);
  background: rgba(15, 17, 26, 0.85);
  border: 1px solid var(--border-glow);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(6px);
}

.qc-btn {
  position: relative;
  width: 40px;
  height: 40px;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  font-size: 1.1rem;
  line-height: 1;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid transparent;
  box-shadow: none;
}

.qc-btn:hover { border-color: var(--primary-color); background: rgba(255, 255, 255, 0.14); }

.qc-scale small {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.55rem;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--primary-color);
  color: var(--ink-color);
  white-space: nowrap;
}

/* بالعرض النظيف: زر واحد شبه مخفي — يوضح لما الماوس يمر عليه أو باللمس */
.quick-controls.collapsed {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  opacity: 0.18;
  transition: opacity 0.2s ease;
}

.quick-controls.collapsed:hover,
.quick-controls.collapsed:focus-within { opacity: 1; }

.qc-help-overlay {
  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
}

.qc-help-card {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--surface-color);
  border: 1px solid var(--primary-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-5);
  text-align: center;
}

.qc-help-card h3 { color: var(--primary-color); font-size: 1.4rem; margin-bottom: var(--space-4); }

.qc-help-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--space-5);
  font-size: 0.95rem;
  text-align: right;
}

.qc-help-table th { color: var(--text-faint); font-weight: 700; padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); }
.qc-help-table td { padding: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); color: var(--text-color); vertical-align: middle; }
.qc-help-table td:first-child, .qc-help-table td:nth-child(2) { white-space: nowrap; }

kbd {
  display: inline-block;
  min-width: 28px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-bottom-width: 3px;
  font-family: inherit;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 480px) {
  .qc-btn { width: 36px; height: 36px; font-size: 1rem; }
  .qc-help-table { font-size: 0.85rem; }
  /* بالجوال ما فيه كيبورد: نخفي عمود المفاتيح ونخلي عمود اللمس */
  .qc-help-table td:first-child, .qc-help-table th:first-child { display: none; }
}
</style>
