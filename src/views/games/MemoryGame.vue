<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const SYMBOLS = ['🏆', '🎯', '🚀', '⚡', '🔥', '🌟', '🧩', '🎲', '💎', '💡', '🕹️', '🛡️'];

const p1Name = ref('اللاعب الأول');
const p2Name = ref('اللاعب الثاني');
const p1Color = ref('#27ae60');
const p2Color = ref('#8A1538');

const cards = reactive([]); // { symbol, flipped, claimedBy: null|1|2, backText }
let flippedIndices = [];
const currentPlayer = ref(1);
const score1 = ref(0);
const score2 = ref(0);
let matchesFound = 0;
let lockBoard = false;

function getPlayerName(player) {
  const fallback = player === 1 ? 'اللاعب الأول' : 'اللاعب الثاني';
  const val = player === 1 ? p1Name.value : p2Name.value;
  return val.trim() || fallback;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function initGame() {
  const symbols = shuffle([...SYMBOLS, ...SYMBOLS]);
  cards.splice(0, cards.length, ...symbols.map((symbol, i) => ({
    symbol, index: i + 1, flipped: false, claimedBy: null, backText: symbol,
  })));

  flippedIndices = [];
  currentPlayer.value = 1;
  score1.value = 0;
  score2.value = 0;
  matchesFound = 0;
  lockBoard = false;
}

function flipCard(i) {
  if (lockBoard) return;
  const card = cards[i];
  if (card.flipped) return;

  card.flipped = true;
  flippedIndices.push(i);

  if (flippedIndices.length === 2) checkForMatch();
}

function checkForMatch() {
  lockBoard = true;
  const [i1, i2] = flippedIndices;
  const card1 = cards[i1];
  const card2 = cards[i2];

  if (card1.symbol === card2.symbol) {
    matchesFound++;
    const currentName = getPlayerName(currentPlayer.value);

    if (currentPlayer.value === 1) score1.value++;
    else score2.value++;

    setTimeout(() => {
      card1.claimedBy = currentPlayer.value;
      card2.claimedBy = currentPlayer.value;
      card1.backText = currentName;
      card2.backText = currentName;

      resetTurn();

      if (matchesFound === SYMBOLS.length) {
        setTimeout(declareWinner, 600);
      }
    }, 600);
  } else {
    setTimeout(() => {
      card1.flipped = false;
      card2.flipped = false;
      switchPlayer();
      resetTurn();
    }, 1200);
  }
}

function switchPlayer() {
  currentPlayer.value = currentPlayer.value === 1 ? 2 : 1;
}

function resetTurn() {
  flippedIndices = [];
  lockBoard = false;
}

function declareWinner() {
  const n1 = getPlayerName(1);
  const n2 = getPlayerName(2);

  let message;
  if (score1.value > score2.value) message = `مبروك يا ${n1}! أنت الفائز 🏆`;
  else if (score2.value > score1.value) message = `مبروك يا ${n2}! أنت الفائز 🏆`;
  else message = 'تعادل بين البطلين! 🤝';

  window.alert(`انتهت اللعبة!\nالنتيجة:\n${n1}: ${score1.value}\n${n2}: ${score2.value}\n\n${message}`);
}

function goHome() {
  router.push('/');
}

initGame();
</script>

<template>
  <div class="header-section" :style="{ '--p1-color': p1Color, '--p2-color': p2Color }">
    <div class="title-area">
      <h1>تحدي الذاكرة</h1>
      <div class="subtitle">تطابق الصور واحتلال المربعات</div>
    </div>
    <div class="header-controls">
      <button class="reset-btn" @click="initGame">🔄 إعادة ترتيب اللعب</button>
      <button class="home-btn" @click="goHome">🏠 الخروج</button>
    </div>
  </div>

  <div class="infographic-container" :style="{ '--p1-color': p1Color, '--p2-color': p2Color }">
    <div class="info-card" :class="{ 'active-player': currentPlayer === 1 }">
      <div class="player-header">
        <input v-model="p1Name" type="text" class="player-name-input" maxlength="16">
        <input v-model="p1Color" type="color" class="color-picker" title="اختر لونك">
      </div>
      <div class="score-value" :style="{ color: p1Color }">{{ score1 }}</div>
    </div>

    <div class="info-card" :class="{ 'active-player': currentPlayer === 2 }">
      <div class="player-header">
        <input v-model="p2Name" type="text" class="player-name-input" maxlength="16">
        <input v-model="p2Color" type="color" class="color-picker" title="اختر لونك">
      </div>
      <div class="score-value" :style="{ color: p2Color }">{{ score2 }}</div>
    </div>
  </div>

  <div class="turn-banner">🎯 دور: {{ getPlayerName(currentPlayer) }}</div>

  <div class="board">
    <div
      v-for="(card, i) in cards"
      :key="i"
      class="memory-card"
      :class="{ flipped: card.flipped }"
      @click="flipCard(i)"
    >
      <div class="card-face card-front">{{ card.index }}</div>
      <div
        class="card-face card-back"
        :class="{ 'claimed-p1': card.claimedBy === 1, 'claimed-p2': card.claimedBy === 2 }"
        :style="card.claimedBy ? { background: card.claimedBy === 1 ? p1Color : p2Color, borderColor: card.claimedBy === 1 ? p1Color : p2Color, boxShadow: `0 0 15px ${card.claimedBy === 1 ? p1Color : p2Color}` } : {}"
      >{{ card.backText }}</div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>
</template>

<style scoped>
:root {
  --p1-color: #27ae60;
  --p2-color: #8A1538;
}

:global(body) { padding: 30px 20px; }

.header-section {
  text-align: center;
  margin-bottom: 30px;
  width: 100%;
  max-width: 1400px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}

.title-area { text-align: right; }
h1 { font-size: 2.5rem; }
.subtitle { font-size: 1.1rem; }

.header-controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.infographic-container {
  width: 100%;
  max-width: 800px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 25px;
  margin-bottom: 30px;
}

.info-card {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  position: relative;
  overflow: hidden;
  transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
  text-align: center;
}

.info-card:first-child::before {
  content: ''; position: absolute; top: 0; right: 0; width: 5px; height: 100%;
  background: var(--p1-color);
  transition: background 0.3s;
}
.info-card:last-child::before {
  content: ''; position: absolute; top: 0; right: 0; width: 5px; height: 100%;
  background: var(--p2-color);
  transition: background 0.3s;
}

.info-card:first-child.active-player {
  transform: translateY(-5px) scale(1.03);
  border-color: var(--p1-color);
  box-shadow: 0 0 25px var(--p1-color);
}
.info-card:last-child.active-player {
  transform: translateY(-5px) scale(1.03);
  border-color: var(--p2-color);
  box-shadow: 0 0 25px var(--p2-color);
}

.player-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 10px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.2);
  padding-bottom: 8px;
}

.player-name-input {
  background: transparent;
  border: none;
  color: #ecf0f1;
  font-size: 1.3rem;
  text-align: center;
  font-weight: bold;
  outline: none;
  width: 70%;
}

.color-picker {
  -webkit-appearance: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
  outline: none;
}
.color-picker::-webkit-color-swatch-wrapper { padding: 0; }
.color-picker::-webkit-color-swatch {
  border: 2px solid rgba(255,255,255,0.4);
  border-radius: 50%;
  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
}

.score-value {
  font-size: 3rem;
  font-weight: bold;
  text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  transition: color 0.3s;
}

.turn-banner {
  margin-bottom: 20px;
  font-size: 1.15rem;
  font-weight: bold;
  color: var(--primary-color);
  min-height: 1.6rem;
  text-align: center;
}

.board {
  display: grid;
  grid-template-columns: repeat(6, 80px);
  grid-template-rows: repeat(4, 80px);
  gap: 15px;
  perspective: 1000px;
  margin-bottom: 20px;
}

.memory-card {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
  cursor: pointer;
}

.memory-card.flipped {
  transform: rotateY(180deg);
  cursor: default;
}

.card-face {
  width: 100%;
  height: 100%;
  position: absolute;
  backface-visibility: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0,0,0,0.3);
  transition: background 0.4s ease, border-color 0.4s ease, font-size 0.4s ease;
  overflow: hidden;
  text-align: center;
  padding: 2px;
}

.card-front {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255,255,255,0.5);
  font-size: 1.8rem;
  font-weight: bold;
  backdrop-filter: blur(8px);
}

.memory-card:not(.flipped):hover .card-front {
  border-color: rgba(255,255,255,0.5);
  background: rgba(255, 255, 255, 0.1);
}

.card-back {
  background: linear-gradient(135deg, #2c3e50, #34495e);
  transform: rotateY(180deg);
  border: 2px solid var(--border-glow);
  font-size: 2.5rem;
}

.claimed-p1 .card-back,
.claimed-p2 .card-back,
.card-back.claimed-p1,
.card-back.claimed-p2 {
  font-size: 1rem;
  font-weight: bold;
  line-height: 1.2;
  word-wrap: break-word;
  color: #fff;
  text-shadow: 1px 1px 3px rgba(0,0,0,0.5);
}

@media (max-width: 768px) {
  .header-section { flex-direction: column; text-align: center; }
  .title-area { text-align: center; }
  h1 { font-size: 2rem; }
  .board {
    grid-template-columns: repeat(4, 75px);
    grid-template-rows: repeat(6, 75px);
    gap: 12px;
  }
}

@media (max-width: 400px) {
  .board {
    grid-template-columns: repeat(4, 65px);
    grid-template-rows: repeat(6, 65px);
    gap: 8px;
  }
  .card-back.claimed-p1, .card-back.claimed-p2 {
    font-size: 0.85rem;
  }
}
</style>
