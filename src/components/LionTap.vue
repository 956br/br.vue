<script setup>
import { registerLionTap } from '../utils/lionMode';

function onTap(e) {
  registerLionTap(e.currentTarget.closest('.players-modal-card'));
}
</script>

<template>
  <!-- زر مخفي بالزاوية اليمنى للنافذة: 5 ضغطات سريعة تبدّل كلمة الانضمام بين 1 و 🦁 -->
  <button type="button" class="lion-tap" tabindex="-1" aria-hidden="true" @click="onTap"></button>
</template>

<style scoped>
.lion-tap {
  position: absolute;
  top: 0;
  right: 0;
  width: 44px;
  height: 44px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  opacity: 0;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  z-index: 2;
}
</style>
