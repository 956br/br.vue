<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { demoFor, demoOpen } from '../data/gameDemos';

// الزر بس — نافذة العرض نفسها تتركّب مرة وحدة من App.vue
const route = useRoute();
const hasDemo = computed(() => !!demoFor(route.name));
</script>

<template>
  <button v-if="hasDemo" type="button" class="rules-btn demo-btn" @click="demoOpen = true">🎬 شرح سريع</button>
</template>

<style scoped>
.demo-btn {
  background: #8e44ad;
  box-shadow: 0 4px 15px rgba(142, 68, 173, 0.4);
}
</style>
