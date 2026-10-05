<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { demoFor, demoOpen } from '../data/gameDemos';

const WHO = {
  host: { label: '🎙️ المستضيف', cls: 'host' },
  viewer: { label: '💬 المشاهدين', cls: 'viewer' },
  game: { label: '⚡ اللعبة', cls: 'game' },
};

const route = useRoute();
const demo = computed(() => demoFor(route.name));

// اللعبة اللي لها أكثر من حالة (مثل رمعة نرد) تنقسم لفصول، كل فصل له مشاهده
const chapters = computed(() => (demo.value && demo.value.chapters) || null);
const chapter = ref(0);
const scenes = computed(() => {
  if (!demo.value) return [];
  return chapters.value ? chapters.value[chapter.value].scenes : demo.value.scenes;
});
const hasNextChapter = computed(() => !!chapters.value && chapter.value < chapters.value.length - 1);

const index = ref(0);
const paused = ref(false);
const finished = ref(false);
const fillKey = ref(0);
let timer = null;

const scene = computed(() => scenes.value[index.value] || {});
const who = computed(() => WHO[scene.value.who] || WHO.game);
const sceneMs = computed(() => 3200 + (scene.value.chat ? scene.value.chat.length : 0) * 700);

// المشهد اللي ما له رسمة يكمل على رسمة آخر مشهد قبله
function stageIndexAt(i) {
  for (let k = i; k >= 0; k--) if (scenes.value[k] && scenes.value[k].stage) return k;
  return -1;
}
const stageKey = computed(() => stageIndexAt(index.value));
const stage = computed(() => (stageKey.value >= 0 ? scenes.value[stageKey.value].stage : null));

// الحبل يتحرك من مكانه بالمشهد السابق لمكانه الجديد
const barFrom = computed(() => {
  const prev = stageIndexAt(stageKey.value - 1);
  const s = prev >= 0 ? scenes.value[prev].stage : null;
  return s && s.bar != null ? s.bar : 50;
});

const gridStyle = computed(() => {
  const s = stage.value;
  if (!s || !s.grid) return {};
  return {
    gridTemplateColumns: `repeat(${s.cols}, 1fr)`,
    maxWidth: s.cols <= 2 ? '100%' : `${s.cols * 60}px`,
    direction: s.rtl ? 'rtl' : 'ltr',
  };
});

function cellClass(cell, i) {
  const s = stage.value;
  return {
    hot: s.hot && s.hot.includes(i),
    dead: s.dead && s.dead.includes(i),
    empty: cell === '',
    txt: [...cell].length > 3,
  };
}

function schedule() {
  clearTimeout(timer);
  fillKey.value++;
  if (paused.value || finished.value) return;
  timer = setTimeout(() => {
    if (index.value < scenes.value.length - 1) index.value++;
    else if (hasNextChapter.value) selectChapter(chapter.value + 1);
    else finished.value = true;
  }, sceneMs.value);
}

function selectChapter(i) {
  chapter.value = i;
  go(0);
}

function go(i) {
  index.value = Math.max(0, Math.min(scenes.value.length - 1, i));
  finished.value = false;
  schedule();
}

function togglePause() {
  if (finished.value) { paused.value = false; selectChapter(0); return; }
  paused.value = !paused.value;
  schedule();
}

function close() { demoOpen.value = false; }

function onKey(e) {
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') go(index.value + 1);
  else if (e.key === 'ArrowRight') go(index.value - 1);
}

watch(index, schedule);
watch(() => route.name, close);

onMounted(() => {
  schedule();
  window.addEventListener('keydown', onKey);
});

onUnmounted(() => {
  clearTimeout(timer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="demo" class="demo-overlay" @click.self="close">
    <div class="demo-card" role="dialog" aria-modal="true">
      <div class="demo-head">
        <span class="demo-title">🎬 شرح سريع — {{ demo.title }}</span>
        <button type="button" class="demo-x" aria-label="إغلاق" @click="close">✕</button>
      </div>

      <div v-if="chapters" class="demo-chapters">
        <button
          v-for="(c, i) in chapters"
          :key="i"
          type="button"
          class="chap"
          :class="{ active: i === chapter }"
          @click="selectChapter(i)"
        >{{ c.name }}</button>
      </div>

      <div class="demo-progress">
        <button
          v-for="(s, i) in scenes"
          :key="i"
          type="button"
          class="seg"
          :class="{ done: i < index || finished }"
          :aria-label="`المشهد ${i + 1}`"
          @click="go(i)"
        >
          <span
            v-if="i === index && !finished"
            :key="fillKey"
            class="seg-fill"
            :style="{ animationDuration: `${sceneMs}ms`, animationPlayState: paused ? 'paused' : 'running' }"
          ></span>
        </button>
      </div>

      <div class="demo-stage">
        <div v-if="stage" :key="`${chapter}-${stageKey}`" class="stage-inner">
          <div v-if="stage.big" class="stage-big" :class="stage.fx">{{ stage.big }}</div>

          <div v-if="stage.grid" class="stage-grid" :style="gridStyle">
            <div v-for="(cell, i) in stage.grid" :key="i" class="cell" :class="cellClass(cell, i)">{{ cell }}</div>
          </div>

          <div v-if="stage.bar != null" class="stage-bar">
            <span class="bar-end">{{ stage.ends[0] }}</span>
            <div class="bar-track">
              <div class="bar-mid"></div>
              <div class="bar-knot" :style="{ '--from': `${barFrom}%`, '--to': `${stage.bar}%` }">🪢</div>
            </div>
            <span class="bar-end">{{ stage.ends[1] }}</span>
          </div>

          <div v-if="stage.label" class="stage-label">{{ stage.label }}</div>
        </div>
      </div>

      <div class="demo-chat">
        <div
          v-for="(c, i) in scene.chat || []"
          :key="`${chapter}-${index}-${i}`"
          class="bubble"
          :style="{ animationDelay: `${400 + i * 550}ms` }"
        >
          <span class="bubble-name">{{ c[0] }}</span>
          <span class="bubble-msg">{{ c[1] }}</span>
        </div>
      </div>

      <div :key="`${chapter}-${index}`" class="demo-caption">
        <div class="caption-top">
          <span class="who" :class="who.cls">{{ who.label }}</span>
          <span v-if="scene.btn" class="fake-btn">{{ scene.btn }}<span class="tap">👆</span></span>
        </div>
        <p class="caption-text">{{ scene.text }}</p>
      </div>

      <div class="demo-controls">
        <button type="button" class="ctl" :disabled="index === 0" @click="go(index - 1)">السابق</button>
        <button type="button" class="ctl main" @click="togglePause">{{ finished ? '🔁 إعادة' : (paused ? '▶️ كمّل' : '⏸️ وقّف') }}</button>
        <button v-if="index < scenes.length - 1" type="button" class="ctl" @click="go(index + 1)">التالي</button>
        <button v-else-if="hasNextChapter" type="button" class="ctl" @click="selectChapter(chapter + 1)">الحالة التالية</button>
        <button v-else type="button" class="ctl done" @click="close">فهمت ✅</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(5, 7, 14, 0.85);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15px;
  overflow-y: auto;
}

.demo-card {
  width: 100%;
  max-width: 440px;
  background: #1a1e2f;
  border: 1px solid var(--border-glow);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 15px 50px rgba(0, 0, 0, 0.6);
  direction: rtl;
  animation: cardIn 0.25s ease;
}

.demo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.demo-title {
  color: var(--primary-color);
  font-weight: bold;
  font-size: 1.1rem;
}

.demo-x {
  background: rgba(255, 255, 255, 0.08);
  padding: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 1rem;
  flex-shrink: 0;
}

.demo-x:hover { background: var(--danger-color); }

.demo-chapters {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.chap {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 0.82rem;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  color: #bdc3c7;
  white-space: nowrap;
}

.chap:hover { background: rgba(255, 255, 255, 0.16); }

.chap.active {
  background: var(--primary-color);
  color: #1a1e2f;
}

.demo-progress {
  display: flex;
  gap: 5px;
  margin-bottom: 12px;
}

.seg {
  flex: 1;
  height: 6px;
  padding: 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  position: relative;
  overflow: hidden;
}

.seg.done { background: var(--primary-color); }

.seg-fill {
  position: absolute;
  inset: 0;
  background: var(--primary-color);
  transform-origin: right center;
  animation: segFill linear forwards;
}

.demo-stage {
  height: 250px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  overflow: hidden;
}

.stage-inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  animation: stageIn 0.35s ease;
}

.stage-big {
  font-size: 5rem;
  line-height: 1.1;
}

.stage-big.spin { animation: fxSpin 1.1s linear infinite; }
.stage-big.shake { animation: fxShake 0.5s ease-in-out infinite; }
.stage-big.pop { animation: fxPop 0.5s ease; }
.stage-big.bounce { animation: fxBounce 0.9s ease-in-out infinite; }

.stage-grid {
  display: grid;
  gap: 5px;
  width: 100%;
}

.cell {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2a2f45;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  font-size: 1.15rem;
  font-weight: bold;
  color: #ecf0f1;
  padding: 2px 4px;
  text-align: center;
}

.cell.txt { font-size: 0.85rem; }
.cell.empty { background: rgba(255, 255, 255, 0.04); }

.cell.hot {
  background: rgba(243, 156, 18, 0.25);
  border-color: var(--primary-color);
  box-shadow: 0 0 12px rgba(243, 156, 18, 0.6);
  animation: fxPop 0.5s ease;
}

.cell.dead {
  background: rgba(138, 21, 56, 0.35);
  border-color: #c0392b;
  animation: fxShake 0.4s ease-in-out 2;
}

.stage-bar {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  direction: ltr;
}

.bar-end { font-size: 2rem; }

.bar-track {
  flex: 1;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #e74c3c, #7f8c8d 50%, #3498db);
  position: relative;
}

.bar-mid {
  position: absolute;
  left: 50%;
  top: -8px;
  bottom: -8px;
  width: 2px;
  background: rgba(255, 255, 255, 0.6);
}

.bar-knot {
  position: absolute;
  top: 50%;
  left: var(--to);
  font-size: 1.8rem;
  transform: translate(-50%, -50%);
  animation: knotMove 1.2s ease;
}

.stage-label {
  color: #f1c40f;
  font-weight: bold;
  font-size: 0.95rem;
  text-align: center;
  line-height: 1.5;
}

.demo-chat {
  height: 108px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 5px;
  padding: 8px 2px;
  overflow: hidden;
}

.bubble {
  align-self: flex-start;
  max-width: 100%;
  background: rgba(52, 152, 219, 0.18);
  border: 1px solid rgba(52, 152, 219, 0.5);
  border-radius: 14px 14px 14px 4px;
  padding: 4px 12px;
  font-size: 0.9rem;
  opacity: 0;
  animation: bubbleIn 0.35s ease forwards;
}

.bubble-name {
  color: #5dade2;
  font-weight: bold;
  margin-left: 8px;
}

.bubble-msg { color: #fff; font-weight: bold; }

.demo-caption {
  min-height: 92px;
  animation: stageIn 0.3s ease;
}

.caption-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.who {
  font-size: 0.8rem;
  font-weight: bold;
  padding: 3px 10px;
  border-radius: 12px;
}

.who.host { background: rgba(243, 156, 18, 0.2); color: var(--primary-color); }
.who.viewer { background: rgba(52, 152, 219, 0.2); color: #5dade2; }
.who.game { background: rgba(155, 89, 182, 0.25); color: #c39bd3; }

.fake-btn {
  position: relative;
  background: var(--success-color);
  color: #fff;
  font-size: 0.85rem;
  font-weight: bold;
  padding: 4px 14px;
  border-radius: 20px;
  animation: btnPress 1.4s ease-in-out infinite;
}

.tap {
  position: absolute;
  left: -6px;
  bottom: -14px;
  font-size: 1.1rem;
  animation: tapMove 1.4s ease-in-out infinite;
}

.caption-text {
  color: #ecf0f1;
  font-size: 1rem;
  line-height: 1.7;
}

.demo-controls {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.ctl {
  flex: 1;
  padding: 9px 6px;
  font-size: 0.95rem;
  background: rgba(255, 255, 255, 0.1);
}

.ctl:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
.ctl.main { background: #3498db; }
.ctl.done { background: var(--success-color); }

@keyframes cardIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
@keyframes stageIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes segFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes bubbleIn { from { opacity: 0; transform: translateY(10px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes fxSpin { to { transform: rotate(360deg); } }
@keyframes fxShake { 0%, 100% { transform: translateX(0) rotate(0); } 25% { transform: translateX(-5px) rotate(-6deg); } 75% { transform: translateX(5px) rotate(6deg); } }
@keyframes fxPop { 0% { transform: scale(0.5); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
@keyframes fxBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
@keyframes knotMove { from { left: var(--from); } to { left: var(--to); } }
@keyframes btnPress { 0%, 60%, 100% { transform: scale(1); } 75% { transform: scale(0.9); } }
@keyframes tapMove { 0%, 100% { transform: translate(-10px, 8px); } 70%, 80% { transform: translate(0, 0); } }

@media (max-height: 640px) {
  .demo-stage { height: 190px; }
  .stage-big { font-size: 3.5rem; }
}

@media (prefers-reduced-motion: reduce) {
  .stage-big, .cell, .bar-knot, .fake-btn, .tap, .stage-inner, .demo-caption, .demo-card { animation: none !important; }
  .bubble { animation: none !important; opacity: 1; }
}
</style>
