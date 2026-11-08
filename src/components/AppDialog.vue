<script setup>
// نافذة التأكيد/التنبيه + الإشعارات الصغيرة (toast) — الحالة في utils/dialog.js
// زر المسافة يضغط "تأكيد" (عن طريق معالج الطبقات في App.vue لأنه master-btn)، و Esc يلغي
import { watch, nextTick, ref, onMounted, onUnmounted } from 'vue';
import { dialogState, toasts, closeDialog } from '../utils/dialog';

const okBtn = ref(null);

watch(() => dialogState.open, async (open) => {
  if (!open) return;
  await nextTick();
  okBtn.value?.focus();
});

function onKey(e) {
  if (!dialogState.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDialog(false);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeDialog(true);
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true));
onUnmounted(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <div v-if="dialogState.open" class="app-dialog-overlay" @click.self="closeDialog(false)">
    <div class="app-dialog-card" role="alertdialog" aria-modal="true">
      <div class="app-dialog-icon">{{ dialogState.danger ? '⚠️' : dialogState.kind === 'confirm' ? '❓' : 'ℹ️' }}</div>
      <p class="app-dialog-msg">{{ dialogState.message }}</p>
      <div class="app-dialog-actions">
        <button
          v-if="dialogState.kind === 'confirm'"
          type="button"
          class="home-btn app-dialog-cancel"
          @click="closeDialog(false)"
        >{{ dialogState.cancelText }}</button>
        <button
          ref="okBtn"
          type="button"
          class="master-btn"
          :class="{ 'app-dialog-danger': dialogState.danger }"
          @click="closeDialog(true)"
        >{{ dialogState.okText }}</button>
      </div>
    </div>
  </div>

  <div class="app-toast-stack" aria-live="polite">
    <TransitionGroup name="app-toast">
      <div v-for="t in toasts" :key="t.id" class="app-toast" :class="`app-toast-${t.type}`">{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}

.app-dialog-card {
  width: 100%;
  max-width: 440px;
  background: var(--surface-color);
  border: 1px solid var(--primary-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-5) var(--space-5) var(--space-4);
  text-align: center;
  animation: app-dialog-in 0.18s ease-out;
}

.app-dialog-icon { font-size: 2.2rem; margin-bottom: var(--space-2); }

.app-dialog-msg {
  color: var(--text-color);
  font-size: 1.05rem;
  line-height: 1.8;
  white-space: pre-line;
  margin-bottom: var(--space-5);
}

.app-dialog-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: center;
  flex-wrap: wrap;
}

.app-dialog-actions button { min-width: 120px; }

.app-dialog-danger { background: var(--danger-color); box-shadow: 0 4px 15px rgba(138, 21, 56, 0.4); }
.app-dialog-danger:hover:not(:disabled) { background: #6e102c; }

@keyframes app-dialog-in {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: none; }
}

.app-toast-stack {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3100;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.app-toast {
  background: rgba(15, 17, 26, 0.95);
  border: 1px solid var(--border-glow);
  border-right: 4px solid var(--primary-color);
  color: var(--text-color);
  font-weight: 700;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  max-width: min(90vw, 480px);
  text-align: center;
}

.app-toast-success { border-right-color: var(--success-light); }
.app-toast-error { border-right-color: var(--red-bright); }

.app-toast-enter-active, .app-toast-leave-active { transition: all 0.25s ease; }
.app-toast-enter-from, .app-toast-leave-to { opacity: 0; transform: translateY(-12px); }

@media (prefers-reduced-motion: reduce) {
  .app-dialog-card { animation: none; }
  .app-toast-enter-active, .app-toast-leave-active { transition: none; }
}
</style>
