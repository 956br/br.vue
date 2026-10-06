<script setup>
// نافذة اختيار المستوى — تظهر أول ما تنفتح اللعبة، وتنفتح من جديد من زر المستوى لتغييره.
// نفس تصميم نافذة أحكام عجلة الصامل. options: [{ value, label, desc? }]
defineProps({
  title: { type: String, default: '🎚️ اختر المستوى' },
  hint: { type: String, default: '' },
  options: { type: Array, required: true },
  current: { type: [String, Number], default: null },
});
defineEmits(['choose', 'close']);
</script>

<template>
  <div class="level-overlay">
    <div class="level-overlay-card">
      <h3>{{ title }}</h3>
      <p v-if="hint" class="field-hint level-overlay-hint">{{ hint }}</p>
      <div class="level-group">
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          class="level-item"
          :class="{ checked: opt.value === current }"
          @click="$emit('choose', opt.value)"
        >
          <span><b>{{ opt.label }}</b><template v-if="opt.desc"> — {{ opt.desc }}</template></span>
          <span v-if="opt.value === current" class="level-item-mark">✔</span>
        </button>
      </div>
      <p class="level-overlay-hint level-change-tip">💡 تقدر تغيّر المستوى لاحقاً من زر "المستوى" بإعدادات اللعبة.</p>
      <button class="reset-btn" style="width:100%;" @click="$emit('close')">✖️ إغلاق</button>
    </div>
  </div>
</template>

<style scoped>
.level-overlay {
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

.level-overlay-card {
  background: #2a2a40;
  border: 1px solid var(--primary-color);
  border-radius: 16px;
  padding: 20px;
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.level-overlay-card h3 {
  margin: 0;
  color: var(--primary-color);
  text-align: center;
  font-size: 1.4rem;
}

.level-overlay-hint {
  text-align: center;
  margin: 0;
  font-size: 0.9rem;
}

.level-change-tip { color: #f1c40f; font-weight: bold; }

.level-group {
  direction: rtl;
  text-align: right;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(241, 196, 15, 0.6);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.level-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 12px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 0.95rem;
  color: #bdc3c7;
  line-height: 1.5;
  text-align: right;
  cursor: pointer;
  transition: all 0.15s ease;
}

.level-item b { color: #ecf0f1; }

.level-item.checked {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.25);
}

.level-item:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: var(--primary-color);
}

.level-item-mark { color: var(--primary-color); font-weight: bold; flex-shrink: 0; }
</style>

<!-- زر "المستوى" اللي يفتح النافذة من إعدادات كل لعبة -->
<style>
.level-pick-btn {
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s ease;
}
.level-pick-btn:hover:not(:disabled) { border-color: var(--primary-color); color: var(--primary-color); }
.level-pick-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
