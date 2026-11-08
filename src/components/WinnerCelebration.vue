<script setup>
// شاشة الفوز الموحّدة — الحالة في utils/celebrate.js
// زر "متابعة" master-btn، فزر المسافة يقفلها عن طريق معالج الطبقات في App.vue
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { celebration, closeCelebration } from '../utils/celebrate';
import { nameText } from '../utils/nameHtml';
import { avatarOrLogo, onAvatarError } from '../utils/gameLogo';

const route = useRoute();
// لو الستريمر طلع من اللعبة، الاحتفال يختفي
watch(() => route.name, closeCelebration);

const COLORS = ['var(--primary-color)', 'var(--gold-color)', 'var(--success-light)', 'var(--info-color)', 'var(--red-bright)', 'var(--purple-color)'];
// قصاصات ثابتة التوزيع لكل احتفال (key يتغيّر فتعيد الحركة)
const confetti = computed(() => {
  const seed = celebration.key;
  return Array.from({ length: 48 }, (_, i) => {
    const r = (n) => {
      const x = Math.sin(seed * 97 + i * 13 + n * 7) * 10000;
      return x - Math.floor(x);
    };
    return {
      left: `${r(1) * 100}%`,
      delay: `${r(2) * 1.2}s`,
      duration: `${2.6 + r(3) * 2}s`,
      color: COLORS[i % COLORS.length],
      size: `${6 + r(4) * 8}px`,
      rotate: `${r(5) * 360}deg`,
    };
  });
});

const many = computed(() => celebration.winners.length > 1);
</script>

<template>
  <div
    v-if="celebration.open"
    :key="celebration.key"
    class="winner-celebration-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="celebration.title"
    @click.self="closeCelebration"
  >
    <div class="wc-confetti" aria-hidden="true">
      <span
        v-for="(c, i) in confetti"
        :key="i"
        :style="{ left: c.left, animationDelay: c.delay, animationDuration: c.duration, background: c.color, width: c.size, height: c.size, '--r': c.rotate }"
      ></span>
    </div>

    <div class="wc-card">
      <div class="wc-rays" aria-hidden="true"></div>
      <div class="wc-trophy" aria-hidden="true">🏆</div>
      <h2 class="wc-title">{{ celebration.title }}</h2>

      <div class="wc-winners" :class="{ many }">
        <div v-for="(w, i) in celebration.winners" :key="i" class="wc-winner" :style="w.color ? { '--wc-accent': w.color } : null">
          <img v-if="!w.color" :src="avatarOrLogo(w.avatar)" class="wc-avatar" alt="" @error="onAvatarError">
          <div v-else class="wc-avatar wc-avatar-team">🚩</div>
          <div class="wc-name">{{ nameText(w.name) }}</div>
        </div>
      </div>

      <p v-if="celebration.subtitle" class="wc-subtitle">{{ celebration.subtitle }}</p>

      <button type="button" class="master-btn wc-close" @click="closeCelebration">متابعة ⏎</button>
    </div>
  </div>
</template>

<style scoped>
.winner-celebration-overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: radial-gradient(circle at center, rgba(243, 156, 18, 0.25), rgba(0, 0, 0, 0.88) 65%);
  backdrop-filter: blur(4px);
  animation: wc-fade 0.3s ease-out;
  overflow: hidden;
}

.wc-confetti { position: absolute; inset: 0; pointer-events: none; }

.wc-confetti span {
  position: absolute;
  top: -20px;
  border-radius: 2px;
  opacity: 0.9;
  animation-name: wc-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.wc-card {
  position: relative;
  width: 100%;
  max-width: 560px;
  padding: 30px 24px 24px;
  text-align: center;
  background: linear-gradient(160deg, #34344f, var(--surface-color));
  border: 2px solid var(--gold-color);
  border-radius: 24px;
  box-shadow: 0 0 60px rgba(241, 196, 15, 0.35), var(--shadow-lg);
  animation: wc-pop 0.55s cubic-bezier(0.2, 1.5, 0.4, 1);
  overflow: hidden;
}

.wc-rays {
  position: absolute;
  inset: -50%;
  background: repeating-conic-gradient(from 0deg, rgba(241, 196, 15, 0.08) 0deg 10deg, transparent 10deg 20deg);
  animation: wc-spin 18s linear infinite;
  pointer-events: none;
}

.wc-trophy {
  position: relative;
  font-size: 4.5rem;
  line-height: 1;
  filter: drop-shadow(0 0 18px rgba(241, 196, 15, 0.7));
  animation: wc-bounce 1.6s ease-in-out infinite;
}

.wc-title {
  position: relative;
  margin: 8px 0 18px;
  font-size: 2rem;
  font-weight: 800;
  color: var(--gold-color);
  text-shadow: 0 0 18px rgba(241, 196, 15, 0.5);
}

.wc-winners {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 18px;
  margin-bottom: 14px;
}

.wc-winner {
  --wc-accent: var(--gold-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}

.wc-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  border: 4px solid var(--wc-accent);
  box-shadow: 0 0 24px var(--wc-accent);
  background: rgba(255, 255, 255, 0.08);
}

.wc-avatar-team { display: flex; align-items: center; justify-content: center; font-size: 3rem; background: var(--wc-accent); }

.wc-name {
  max-width: 260px;
  font-size: 2rem;
  font-weight: 800;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.many .wc-avatar { width: 80px; height: 80px; }
.many .wc-name { font-size: 1.3rem; max-width: 160px; }

.wc-subtitle {
  position: relative;
  color: var(--text-soft);
  font-size: 1.1rem;
  margin-bottom: 16px;
}

.wc-close { position: relative; min-width: 160px; }

@keyframes wc-fade { from { opacity: 0; } }
@keyframes wc-pop { from { opacity: 0; transform: scale(0.6) translateY(30px); } }
@keyframes wc-spin { to { transform: rotate(360deg); } }
@keyframes wc-bounce { 0%, 100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-10px) rotate(4deg); } }
@keyframes wc-fall {
  0% { transform: translateY(0) rotate(0); }
  100% { transform: translateY(110vh) rotate(var(--r)); }
}

@media (max-width: 480px) {
  .wc-avatar { width: 90px; height: 90px; }
  .wc-name { font-size: 1.5rem; }
  .wc-title { font-size: 1.6rem; }
}

@media (prefers-reduced-motion: reduce) {
  .wc-confetti, .wc-rays { display: none; }
  .wc-card, .wc-trophy, .winner-celebration-overlay { animation: none; }
}
</style>
