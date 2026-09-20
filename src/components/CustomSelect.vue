<script setup>
import {
  ref, computed, onMounted, onUnmounted, nextTick,
} from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const rootRef = ref(null);
const triggerRef = ref(null);
const dropdownRef = ref(null);
const dropdownStyle = ref({});

const selectedLabel = computed(() => {
  const found = props.options.find((o) => o.value === props.modelValue);
  return found ? found.label : (props.placeholder || '');
});

function updatePosition() {
  const el = triggerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  dropdownStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  };
}

function closeDropdown() {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener('scroll', updatePosition, true);
  window.removeEventListener('resize', updatePosition);
}

function toggleOpen() {
  if (props.disabled) return;
  if (open.value) { closeDropdown(); return; }
  open.value = true;
  nextTick(updatePosition);
  window.addEventListener('scroll', updatePosition, true);
  window.addEventListener('resize', updatePosition);
}

function selectOption(opt) {
  emit('update:modelValue', opt.value);
  closeDropdown();
}

function handleClickOutside(event) {
  if (rootRef.value && rootRef.value.contains(event.target)) return;
  if (dropdownRef.value && dropdownRef.value.contains(event.target)) return;
  closeDropdown();
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('scroll', updatePosition, true);
  window.removeEventListener('resize', updatePosition);
});
</script>

<template>
  <div ref="rootRef" class="custom-select" :class="{ open, disabled }">
    <button ref="triggerRef" type="button" class="custom-select-trigger" :disabled="disabled" @click="toggleOpen">
      <span>{{ selectedLabel }}</span>
      <span class="custom-select-arrow">▾</span>
    </button>
    <Teleport to="body">
      <div v-if="open && !disabled" ref="dropdownRef" class="custom-select-options" :style="dropdownStyle">
        <div
          v-for="opt in options"
          :key="opt.value"
          class="custom-select-option"
          :class="{ selected: opt.value === modelValue }"
          @click="selectOption(opt)"
        >
          {{ opt.label }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  flex: 1;
  min-width: 140px;
}

.custom-select-trigger {
  width: 100%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  text-align: right;
}

.custom-select-arrow {
  font-size: 0.75rem;
  opacity: 0.8;
  transition: transform 0.2s ease;
}

.custom-select.open .custom-select-arrow {
  transform: rotate(180deg);
}

.custom-select-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

<style>
/* غير scoped عمداً: هذا العنصر يُنقل عبر Teleport إلى body خارج نطاق الأنماط المحصورة بالمكوّن */
.custom-select-options {
  position: fixed;
  background: #1c2331;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  max-height: 220px;
  overflow-y: auto;
  z-index: 9999;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.custom-select-options .custom-select-option {
  padding: 8px 12px;
  font-size: 0.9rem;
  color: #ecf0f1;
  cursor: pointer;
  text-align: right;
}

.custom-select-options .custom-select-option:hover,
.custom-select-options .custom-select-option.selected {
  background: var(--primary-color);
  color: #fff;
}
</style>
