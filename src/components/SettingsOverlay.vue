<script setup>
// نافذة إعدادات اللعبة — نفس تصميم نافذة إعدادات رمعة نرد (مجموعات + شرح بسيط لكل خيار).
// المحتوى داخل الـ slot يستخدم: adv-group / adv-group-title / adv-columns / adv-item / adv-item-label / adv-item-extra / adv-seg
defineProps({
  forStart: { type: Boolean, default: false },
  hint: { type: String, default: 'تحت كل خيار شرح بسيط لطريقته.' },
  startLabel: { type: String, default: '▶️ ابدأ اللعبة' },
  startDisabled: { type: Boolean, default: false },
});
defineEmits(['start', 'close']);
</script>

<template>
  <div class="adv-overlay gs-overlay" @click.self="$emit('close')">
    <div class="gs-card">
      <h3>{{ forStart ? '⚙️ اختر إعدادات اللعبة' : '⚙️ إعدادات اللعبة' }}</h3>
      <p v-if="hint" class="gs-hint">{{ hint }}</p>
      <slot />
      <template v-if="forStart">
        <button class="master-btn" style="width:100%; margin:0;" :disabled="startDisabled" @click="$emit('start')">{{ startLabel }}</button>
        <button class="reset-btn" style="width:100%; margin:0;" @click="$emit('close')">✖️ إلغاء</button>
      </template>
      <button v-else class="master-btn" style="width:100%; margin:0;" @click="$emit('close')">✔️ تم</button>
    </div>
  </div>
</template>

<!-- بدون scoped عشان التنسيق يوصل لمحتوى الـ slot، وكله محصور داخل gs-card عشان ما يأثر على نوافذ ثانية -->
<style>
.gs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15px;
}

.gs-card {
  background: #2a2a40;
  border: 1px solid var(--primary-color);
  border-radius: 16px;
  padding: 20px;
  width: 100%;
  max-width: 820px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gs-card > h3 {
  margin: 0;
  padding: 0;
  border: none;
  color: var(--primary-color);
  text-align: center;
  font-size: 1.4rem;
}

.gs-hint {
  text-align: center;
  margin: 0;
  font-size: 0.9rem;
  color: #8b93a3;
}

.gs-card .adv-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  direction: rtl;
}

.gs-card .adv-group {
  direction: rtl;
  text-align: right;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gs-card .adv-group-title { font-weight: bold; font-size: 1.1rem; }
.gs-card .adv-group-note { font-size: 0.8rem; color: #bdc3c7; font-weight: normal; margin-inline-start: 6px; }

.gs-card .adv-group.basics { border-color: rgba(46, 204, 113, 0.6); }
.gs-card .adv-group.basics .adv-group-title { color: #2ecc71; }
.gs-card .adv-group.modes { border-color: rgba(155, 89, 182, 0.6); }
.gs-card .adv-group.modes .adv-group-title { color: #bb8fce; }
.gs-card .adv-group.guess { border-color: rgba(52, 152, 219, 0.6); }
.gs-card .adv-group.guess .adv-group-title { color: #5dade2; }
.gs-card .adv-group.gifts { border-color: rgba(241, 196, 15, 0.6); }
.gs-card .adv-group.gifts .adv-group-title { color: #f1c40f; }

.gs-card .adv-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.92rem;
  font-weight: normal;
  color: #bdc3c7;
  line-height: 1.5;
  text-align: right;
  transition: all 0.15s ease;
}

.gs-card .adv-item.checked { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.12); }
.gs-card .adv-item.disabled { opacity: 0.45; }
.gs-card .adv-item.adv-team { border-inline-start-width: 5px; }
.gs-card .adv-item b { color: #fff; }
/* لو عدد الخيارات فردي، الأخير ياخذ العرض كامل */
.gs-card .adv-columns > .adv-item:last-child:nth-child(odd) { grid-column: 1 / -1; }
/* الحقول بنفس المستوى حتى لو شرح واحد منهم أطول */
.gs-card .adv-columns > .adv-item > :last-child { margin-top: auto; }

.gs-card .adv-item input[type="text"],
.gs-card .adv-item input[type="number"],
.gs-card .adv-item input[type="password"] {
  width: 100%;
  min-width: 0;
  height: 40px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  font-size: 1rem;
  outline: none;
  text-align: center;
  padding: 8px;
}
.gs-card .adv-item input:focus { border-color: var(--primary-color); }
.gs-card .adv-item input:disabled { opacity: 0.5; cursor: not-allowed; }
.gs-card .adv-item .custom-select { width: 100%; flex: none; min-width: 0; }

.gs-card .adv-item-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  cursor: pointer;
}

.gs-card .adv-item-label input[type="checkbox"],
.gs-card .adv-item-label input[type="radio"] {
  width: auto;
  margin: 4px 0 0;
  accent-color: var(--primary-color);
  cursor: pointer;
  flex-shrink: 0;
}

.gs-card .adv-item-extra {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
}

.gs-card .adv-item-extra .field-hint { margin: 0; font-size: 0.8rem; }
.gs-card .adv-gift-row { display: grid; grid-template-columns: 1fr; gap: 8px; }

.gs-card .adv-seg { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.gs-card .adv-seg-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.3);
  color: #bdc3c7;
  font-family: inherit;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  box-shadow: none;
  transition: all 0.15s ease;
}
.gs-card .adv-seg-btn small { font-size: 0.75rem; font-weight: normal; }
.gs-card .adv-seg-btn.active { background: var(--primary-color); border-color: var(--primary-color); color: #1e1e2f; }
.gs-card .adv-seg-btn:disabled { cursor: not-allowed; opacity: 0.6; }

@media (max-width: 600px) {
  .gs-card .adv-columns,
  .gs-card .adv-gift-row { grid-template-columns: 1fr; }
}
</style>
