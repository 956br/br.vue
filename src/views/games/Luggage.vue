<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { normalizeDigits, isLeaveComment } from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();
const SCORES_KEY = 'luggageGame_scores';

// كل غرض له وزن خفي ثابت (كجم، مضاعفات 0.5) — وزن الشنطة = مجموع أوزان الأغراض اللي طاحت فيها
const COMMON_POOL = [
  { emoji: '👕', label: 'قميص', weight: 1 }, { emoji: '👖', label: 'بنطال', weight: 2 }, { emoji: '🧦', label: 'جوارب', weight: 0.5 },
  { emoji: '👟', label: 'حذاء رياضي', weight: 2.5 }, { emoji: '👞', label: 'حذاء رسمي', weight: 3 }, { emoji: '📚', label: 'كتاب', weight: 2 },
  { emoji: '🧴', label: 'عناية شخصية', weight: 1.5 }, { emoji: '🪥', label: 'فرشاة أسنان', weight: 0.5 }, { emoji: '📱', label: 'جهاز إلكتروني', weight: 3 },
  { emoji: '🔌', label: 'شاحن', weight: 1 }, { emoji: '🧥', label: 'جاكيت', weight: 4 }, { emoji: '👗', label: 'فستان', weight: 2 },
  { emoji: '🧢', label: 'قبعة', weight: 1 }, { emoji: '🕶️', label: 'نظارة شمسية', weight: 0.5 }, { emoji: '🧸', label: 'لعبة', weight: 3 },
];
const HEAVY_POOL = COMMON_POOL.concat([
  { emoji: '🧳', label: 'حقيبة إضافية', weight: 12 }, { emoji: '💻', label: 'لابتوب', weight: 3 }, { emoji: '📷', label: 'كاميرا', weight: 2.5 },
  { emoji: '🥾', label: 'حذاء جبلي', weight: 4 }, { emoji: '🏋️', label: 'معدات رياضية', weight: 15 },
]);
const CARGO_POOL = [
  { emoji: '📦', label: 'صندوق كبير', weight: 30 }, { emoji: '🛠️', label: 'صندوق أدوات', weight: 20 }, { emoji: '🖥️', label: 'جهاز ضخم', weight: 45 },
  { emoji: '🪑', label: 'قطعة أثاث', weight: 60 }, { emoji: '🏗️', label: 'معدات ثقيلة', weight: 80 }, { emoji: '🔧', label: 'عدة أدوات', weight: 15 },
];
// maxWeight: أقصى حمولة للحقيبة — الأغراض تنزل عشوائياً لين توصل حمولة عشوائية من 0.5 لهالحد
const MAX_ITEMS = 25;
const LEVELS = {
  cabin: {
    label: 'شنطة كابينة (سهل)', maxWeight: 10, pool: COMMON_POOL.slice(0, 10),
  },
  checked: {
    label: 'شنطة شحن (متوسط)', maxWeight: 32, pool: COMMON_POOL,
  },
  oversized: {
    label: 'أمتعة إضافية (صعب)', maxWeight: 50, pool: HEAVY_POOL,
  },
  cargo: {
    label: 'شحن جوي (خارق)', maxWeight: 400, pool: CARGO_POOL,
  },
};

// يختار حمولة عشوائية من 0.5 للحد الأقصى ثم يعبّي الحقيبة بأغراض عشوائية ما تتعدى الحمولة
// (لو أخف غرض بالمستوى أثقل من 0.5 تبدأ الحمولة من وزنه عشان ما تطلع الشنطة فاضية)
function packBag(level) {
  const minWeight = Math.max(0.5, Math.min(...level.pool.map((it) => it.weight)));
  const target = randInt(minWeight * 2, level.maxWeight * 2) / 2;
  const items = [];
  let sum = 0;
  while (items.length < MAX_ITEMS) {
    const fitting = level.pool.filter((it) => sum + it.weight <= target);
    if (fitting.length === 0) break;
    const item = fitting[Math.floor(Math.random() * fitting.length)];
    items.push(item);
    sum += item.weight;
  }
  return items;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function loadScores() {
  try {
    const data = localStorage.getItem(SCORES_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const playersScores = reactive(new Map((loadScores() || []).map((p) => [p.name, p])));
function saveScores() {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(Array.from(playersScores.values()))); } catch (e) { /* noop */ }
}
function getOrCreatePlayer(name) {
  if (!playersScores.has(name)) playersScores.set(name, reactive({ name, score: 0, avatar: getUserAvatar(name) }));
  const player = playersScores.get(name);
  if (!player.avatar) player.avatar = getUserAvatar(name);
  return player;
}

// ===== نقاط الفوز (اختيارية — الخانة الفاضية = لعب مفتوح بدون حد) =====
const winScoreInput = ref('');
function getWinScore() {
  const val = parseInt(winScoreInput.value, 10);
  return Number.isNaN(val) || val < 1 ? null : val;
}
// يضيف النقاط للاعب ويرجّع true لو وصل لنقاط الفوز بهذي الإضافة
function addPoints(player, points) {
  const winScore = getWinScore();
  const wasBelow = winScore !== null && player.score < winScore;
  player.score += points;
  return wasBelow && player.score >= winScore;
}
function gameWinHtml(names) {
  return `<div style="text-align:center; font-size:16px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px; margin-top:6px;">🏆 وصل لنقاط الفوز (${getWinScore()}) وفاز باللعبة: <b>${names.map((n) => escapeHtml(n)).join('، ')}</b> 🏆</div>`;
}

const gamePhase = ref('idle'); // idle | filling | guessing | time-up
const roundNumber = ref(0);
const currentLevelKey = ref('cabin');
let realWeight = 0;
const guesses = new Map(); // name -> {name, value}
const guessCount = ref(0);
let fillTimers = [];
const guessDurationInput = ref(30);
const timeLeft = ref(0);
let countdownInterval = null;
const lastResult = ref(null);
const eventLog = ref([]);
const fallingItems = ref([]); // { id, emoji, left, restTop, rot }
let fallingIdCounter = 0;

const levelSelect = ref('cabin');
const levelSelectOptions = [
  { value: 'cabin', label: '🧳 كابينة — سهل (10 كجم)' },
  { value: 'checked', label: '🧳 شحن — متوسط (32 كجم)' },
  { value: 'oversized', label: '🧳 إضافية — صعب (50 كجم)' },
  { value: 'cargo', label: '📦 جوي — خارق (400 كجم)' },
];
const manualNameInput = ref('');
const manualGuessInput = ref('');

const levelHint = computed(() => {
  const level = LEVELS[levelSelect.value];
  return `عدد الأغراض عشوائي — حمولة الحقيبة: حتى ${level.maxWeight} كجم`;
});

const setupDisabled = computed(() => gamePhase.value !== 'idle');

function getGuessDuration() {
  let val = parseInt(guessDurationInput.value, 10);
  if (Number.isNaN(val) || val < 10) val = 10;
  if (val > 180) val = 180;
  guessDurationInput.value = val;
  return val;
}

function startFilling() {
  if (gamePhase.value !== 'idle') return;

  currentLevelKey.value = levelSelect.value;
  const level = LEVELS[currentLevelKey.value];
  const items = packBag(level);
  realWeight = 0;

  roundNumber.value++;
  gamePhase.value = 'filling';
  guesses.clear();
  guessCount.value = 0;
  lastResult.value = null;
  fallingItems.value = [];

  appendLog(`<div class="log-item log-info" style="text-align:center;">🎒 الجولة ${roundNumber.value}: بدأت التعبئة — المستوى: ${level.label}</div>`);
  scheduleFalling(items);
}

function scheduleFalling(items) {
  fillTimers.forEach((t) => clearTimeout(t));
  fillTimers = [];
  let delay = 0;
  items.forEach((item) => {
    const t = setTimeout(() => dropOneItem(item), delay);
    fillTimers.push(t);
    delay += 250 + Math.random() * 250;
  });
  const doneTimer = setTimeout(() => {
    if (gamePhase.value === 'filling') {
      bagCaption.value = '🎒 التعبئة اكتملت — اضغط "إغلاق الشنطة" لبدء العداد';
    }
  }, delay + 200);
  fillTimers.push(doneTimer);
}

function dropOneItem(item) {
  if (gamePhase.value !== 'filling') return;
  realWeight += item.weight;
  const leftPct = 8 + Math.random() * 78;
  const topPct = 20 + Math.random() * 62;
  const rot = Math.round(Math.random() * 50 - 25);
  fallingItems.value.push({
    id: fallingIdCounter++, emoji: item.emoji, left: leftPct, restTop: topPct, rot,
  });
}

function closeBag() {
  if (gamePhase.value !== 'filling') return;
  fillTimers.forEach((t) => clearTimeout(t));
  fillTimers = [];

  gamePhase.value = 'guessing';
  guesses.clear();
  guessCount.value = 0;
  timeLeft.value = getGuessDuration();

  appendLog(`<div class="log-item log-info" style="text-align:center;">🔒 أُغلقت الشنطة — باب التوقعات مفتوح (${timeLeft.value} ثانية)</div>`);
  startCountdown();
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      gamePhase.value = 'time-up';
      appendLog('<div class="log-item" style="text-align:center; color:#f1c40f;">⏰ انتهى وقت التوقعات — اضغط "إعلان الفائز" للكشف</div>');
    }
  }, 1000);
}

function registerGuessValue(name, value) {
  if (!name) return false;
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0 || num > 999) return false;
  guesses.set(name, { name, value: Math.round(num * 10) / 10 });
  guessCount.value = guesses.size;
  return true;
}

function parseGuessNumber(text) {
  const normalized = normalizeDigits(text).replace(',', '.');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  return parseFloat(match[0]);
}

function registerGuessFromComment(username, rawComment) {
  if (gamePhase.value !== 'guessing' || !username || !rawComment) return;
  const num = parseGuessNumber(rawComment);
  if (num === null) return;
  registerGuessValue(username, num);
}

function manualAddGuess() {
  if (gamePhase.value !== 'guessing' && gamePhase.value !== 'time-up') return;
  const name = manualNameInput.value.trim();
  const val = parseFloat(manualGuessInput.value);
  if (name === '' || Number.isNaN(val)) return;
  registerGuessValue(name, val);
  manualGuessInput.value = '';
}

const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() { showModal_.value = false; }

function announceWinner() {
  if (gamePhase.value !== 'guessing' && gamePhase.value !== 'time-up') return;
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  const allGuesses = Array.from(guesses.values()).map((g) => ({ ...g, diff: Math.abs(g.value - realWeight) }));
  allGuesses.sort((a, b) => a.diff - b.diff);

  const logs = [];
  logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">⚖️ الوزن الحقيقي للشنطة: <b>${realWeight} كجم</b></div>`);

  let winners = [];
  if (allGuesses.length === 0) {
    logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي توقعات هالجولة — بدون فائز.</div>');
  } else {
    const minDiff = allGuesses[0].diff;
    winners = allGuesses.filter((g) => g.diff === minDiff);
    const isExactMatch = minDiff === 0;
    const points = isExactMatch ? Math.round(realWeight * 1.5 * 10) / 10 : realWeight;
    const gameWinners = [];
    winners.forEach((w) => {
      const player = getOrCreatePlayer(w.name);
      if (addPoints(player, points)) gameWinners.push(w.name);
    });
    const bonusBadge = isExactMatch ? ' 🎯 مطابقة تامة! بونص +50%' : '';
    logs.push(`<div style="text-align:center; font-size:16px; color:#2ecc71;">🏆 الفائز${winners.length > 1 ? 'ون' : ''}: <b>${winners.map((w) => escapeHtml(w.name)).join('، ')}</b> (توقع ${winners[0].value} كجم) — +${points} نقطة لكل فائز${bonusBadge}</div>`);
    if (gameWinners.length > 0) logs.push(gameWinHtml(gameWinners));

    const topList = allGuesses.slice(0, 8).map((g) => `<div class="log-item">${escapeHtml(g.name)}: ${g.value} كجم (فرق ${g.diff.toFixed(1)})</div>`).join('');
    logs.push(`<div class="scoreboard-title" style="border-top:none;">أقرب التوقعات</div>${topList}`);
  }

  logs.forEach((l) => appendLog(l));
  saveScores();

  lastResult.value = { weight: realWeight, winners: winners.map((w) => ({ name: w.name, avatar: getUserAvatar(w.name) })) };
  gamePhase.value = 'idle';
  guesses.clear();
  guessCount.value = 0;

  openModal(`نتيجة الجولة ${roundNumber.value}`, logs);
}

function resetGame() {
  fillTimers.forEach((t) => clearTimeout(t));
  fillTimers = [];
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  playersScores.clear();
  saveScores();
  gamePhase.value = 'idle';
  roundNumber.value = 0;
  realWeight = 0;
  guesses.clear();
  guessCount.value = 0;
  lastResult.value = null;
  eventLog.value = [];
  fallingItems.value = [];
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const bagCaption = ref('اختر المستوى واضغط "بدء التعبئة" لبدء الجولة');
const bagTimerText = computed(() => {
  if (gamePhase.value === 'filling') return '🎒';
  if (gamePhase.value === 'guessing') return String(timeLeft.value);
  if (gamePhase.value === 'time-up') return '⏰';
  return '';
});
const bagTimerUrgent = computed(() => gamePhase.value === 'guessing' && timeLeft.value <= 5);

const bagInteriorVisible = computed(() => gamePhase.value === 'filling');
const bagClosedVisible = computed(() => gamePhase.value === 'guessing' || gamePhase.value === 'time-up');
const bagResultVisible = computed(() => gamePhase.value === 'idle' && !!lastResult.value);

const guessCountLine = computed(() => ((gamePhase.value === 'guessing' || gamePhase.value === 'time-up') ? `📝 عدد التوقعات المستلمة حتى الآن: ${guessCount.value}` : ''));
const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const manualPanelVisible = computed(() => gamePhase.value === 'guessing' || gamePhase.value === 'time-up');
const startFillVisible = computed(() => gamePhase.value === 'idle');
const closeBagVisible = computed(() => gamePhase.value === 'filling');
const inGuessPhase = computed(() => gamePhase.value === 'guessing' || gamePhase.value === 'time-up');

// تحديث النص الوصفي تلقائياً حسب المرحلة (باستثناء "التعبئة اكتملت" المؤقت أعلاه)
function syncCaption() {
  if (gamePhase.value === 'idle') {
    bagCaption.value = lastResult.value ? 'اختر المستوى واضغط "بدء التعبئة" لجولة جديدة' : 'اختر المستوى واضغط "بدء التعبئة" لبدء الجولة';
  } else if (gamePhase.value === 'filling') {
    bagCaption.value = 'الأغراض تتساقط داخل الشنطة...';
  } else if (gamePhase.value === 'guessing') {
    bagCaption.value = '✍️ باب التوقعات مفتوح — اكتب وزنك المتوقع بالكيلو بالدردشة';
  } else if (gamePhase.value === 'time-up') {
    bagCaption.value = 'انتهى الوقت — اضغط "إعلان الفائز" للكشف عن الوزن الحقيقي';
  }
}

const showRulesOverlay = ref(false);
const barExpanded = ref(true);
function goHome() { router.push('/'); }

// نراقب تغيّر المرحلة يدوياً عبر أغلفة الدوال بدل watch لتفادي حلقة تحديث إضافية
function wrapPhaseChange(fn) {
  return (...args) => { fn(...args); syncCaption(); };
}
const startFillingWrapped = wrapPhaseChange(startFilling);
const closeBagWrapped = wrapPhaseChange(closeBag);
const announceWinnerWrapped = wrapPhaseChange(announceWinner);

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function handleTiktokMessage(data) {
  // اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة (توقعه ونقاطه) بأي وقت
  if (data.user && isLeaveComment(data.comment)) {
    if (guesses.delete(data.user)) guessCount.value = guesses.size;
    if (playersScores.delete(data.user)) saveScores();
    return;
  }
  if (data.comment && data.user) registerGuessFromComment(data.user, data.comment);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'luggage', onMessage: handleTiktokMessage });
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (showRulesOverlay.value || showModal_.value) return;
    if (startFillVisible.value) startFillingWrapped();
    else if (closeBagVisible.value) closeBagWrapped();
    else if (inGuessPhase.value) announceWinnerWrapped();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  fillTimers.forEach((t) => clearTimeout(t));
  if (countdownInterval) clearInterval(countdownInterval);
  clearMessageHandler();
});
</script>

<template>
  <h1>🧳 وزن الشنطة</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="top-names-section settings-row" style="grid-template-columns: 2fr 1fr 1fr;">
    <div class="setting-cell" style="align-items:stretch;" :title="`يحدده المستضيف قبل بدء كل جولة — ${levelHint}`">
      <span>🎚️ المستوى</span>
      <CustomSelect v-model="levelSelect" :options="levelSelectOptions" :disabled="setupDisabled" />
    </div>
    <label class="setting-cell" title="مدة استقبال التوقعات بالثواني — بعدها تُقفل التوقعات ويضغط المستضيف &quot;إعلان الفائز&quot; للكشف">
      <span>⏱️ مدة الجولة (ث)</span>
      <input v-model="guessDurationInput" type="number" min="10" max="180" :disabled="setupDisabled">
    </label>
    <label class="setting-cell" title="اختياري — أول لاعب يوصل لهذي النقاط يفوز باللعبة، واتركها فاضية للعب مفتوح بدون حد">
      <span>🏆 نقاط الفوز</span>
      <input v-model="winScoreInput" type="number" min="1" placeholder="مفتوح">
    </label>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startFillVisible" class="master-btn side-panel-btn" id="startFillBtn" @click="startFillingWrapped">🎒 بدء التعبئة</button>
    <button v-if="closeBagVisible" class="master-btn side-panel-btn" id="closeBagBtn" style="background:#8A1538;" @click="closeBagWrapped">🔒 إغلاق الشنطة يدوياً وبدء العداد</button>
    <button v-if="inGuessPhase" class="master-btn side-panel-btn" id="announceWinnerBtn" @click="announceWinnerWrapped">🏆 إعلان الفائز</button>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🎥 شاشة العرض للجمهور</h2>
      <div class="bag-timer" :class="{ urgent: bagTimerUrgent }">{{ bagTimerText }}</div>
      <div class="bag-caption">{{ bagCaption }}</div>
      <div class="bag-stage">
        <div v-if="bagInteriorVisible" class="bag-interior">
          <div v-for="item in fallingItems" :key="item.id" class="falling-item" :style="{ left: item.left + '%', '--rest-top': item.restTop + '%', '--rot': item.rot + 'deg' }">{{ item.emoji }}</div>
        </div>
        <div v-if="bagClosedVisible" class="bag-closed-view" style="display:flex;">
          <div class="bag-closed-icon">🧳</div>
          <div class="bag-lock">🔒</div>
        </div>
        <div v-if="bagResultVisible" class="bag-result-view" style="display:flex;">
          <div class="bag-result-weight">{{ lastResult.weight }} كجم</div>
          <div class="bag-result-winner">
            <template v-if="lastResult.winners.length > 0">
              🏆 الفائز:
              <span v-for="(w, wi) in lastResult.winners" :key="w.name" class="bag-winner-chip">
                <img v-if="w.avatar" :src="w.avatar" class="player-avatar" alt="">{{ w.name }}<template v-if="wi < lastResult.winners.length - 1">، </template>
              </span>
            </template>
            <template v-else>بدون فائز هذه الجولة</template>
          </div>
        </div>
      </div>
      <div class="guess-count-line">{{ guessCountLine }}</div>
      <div class="scoreboard-title">🏆 لوحة الصدارة</div>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-winner': i === 0 }">
          <span><span class="lb-rank">{{ rankFor(i) }}</span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
          <span>{{ p.score.toFixed(1) }} نقطة</span>
        </div>
      </div>
    </div>

    <div v-if="manualPanelVisible" class="panel" style="display:flex;">
      <h3>✍️ إضافة توقع يدوياً (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualGuessInput" type="number" step="0.1" placeholder="الوزن المتوقع (كجم)" @keydown.enter.prevent="manualAddGuess">
        <button class="master-btn" @click="manualAddGuess">إضافة</button>
      </div>
    </div>

    <div class="panel">
      <h3>📜 سجل الأحداث</h3>
      <div class="event-log-panel">
        <div v-if="eventLogReversed.length === 0" class="field-hint">لا توجد أحداث بعد</div>
        <div v-for="(log, i) in eventLogReversed" :key="i" v-html="log"></div>
      </div>
    </div>
  </div>

  <div v-if="showModal_" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <h2>{{ modalTitle }}</h2>
      <div class="modal-logs">
        <div v-for="(log, i) in modalLogs" :key="i" v-html="log"></div>
      </div>
      <button class="master-btn" style="width:100%; padding:10px;" @click="closeModal">موافق</button>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة وزن الشنطة 🧳</h2>
      <ul class="rules-list">
        <li><b>المستوى:</b> يختار المستضيف مستوى الجولة قبل البدء — كابينة (حتى 10 كجم)، شحن (حتى 32 كجم)، أمتعة إضافية (حتى 50 كجم)، أو شحن جوي (حتى 400 كجم) — عدد الأغراض عشوائي كل جولة لكن ما تتعدى حمولة الحقيبة</li>
        <li><b>التعبئة:</b> بالضغط على "بدء التعبئة" تبدأ أغراض عشوائية (ملابس، أحذية، كتب، أدوات عناية، أجهزة) بالسقوط داخل الشنطة بحركة حية، ولكل نوع غرض وزن مخفي ثابت ما يتغير — وزن الشنطة هو مجموع أوزان الأغراض اللي دخلتها، فركّز على الأغراض!</li>
        <li><b>الإغلاق:</b> يضغط المستضيف "إغلاق الشنطة" وقتما يشاء (ولو قبل اكتمال التعبئة) ليبدأ عداد استقبال التوقعات</li>
        <li><b>التوقع:</b> يكتب المشاهد رقماً فقط بالدردشة (مثل 23.5) خلال مدة العداد — آخر رقم يكتبه كل مشاهد هو المعتمد له</li>
        <li><b>الفوز:</b> بعد انتهاء الوقت يضغط المستضيف "إعلان الفائز" — يكشف الوزن الحقيقي، ويفوز صاحب أقرب توقع (أو كل المتعادلين لو تساووا في القرب)</li>
        <li><b>الوزن:</b> الوزن الحقيقي دائماً رقم صحيح أو نصف (مثل 23 أو 23.5)، ما يطلع بكسور غريبة</li>
        <li><b>النقاط:</b> الفائز يكسب نقاطاً تساوي الوزن الحقيقي للشنطة بالضبط (مثال: وزن 23.5 كجم = 23.5 نقطة)</li>
        <li><b>بونص المطابقة التامة:</b> لو توقع الفائز طابق الوزن الحقيقي رقماً برقم، يكسب 50% نقاط إضافية فوق نقاط الوزن العادية</li>
        <li><b>نقاط الفوز (اختياري):</b> لو حدد المستضيف نقاط فوز، أول لاعب يوصلها يُعلَن فائزاً باللعبة 🏆 — ولو ترك الخانة فاضية يبقى اللعب مفتوح</li>
        <li>لوحة الصدارة تتحدث تلقائياً بعد كل جولة، وتقدر تكمل جولات أكثر أو تضغط "إعادة اللعبة بالكامل" لتصفير كل النقاط والبدء من جديد</li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="showRulesOverlay = false">🔙 رجوع للعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 110px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 15px; text-align: center; }

.top-names-section {
  width: 100%;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 15px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.top-names-section label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.95rem;
  color: #ecf0f1;
  font-weight: bold;
}

.field-hint {
  font-size: 0.75rem;
  color: #8b93a3;
  margin-top: 4px;
}

textarea, input, select {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 1rem;
  outline: none;
}

textarea:disabled, input:disabled, select:disabled, button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input:focus, select:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

.round-time-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.round-time-row input[type="number"] { width: 100px; text-align: center; flex: none; }

.settings-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  padding: 10px 12px;
}

.settings-row .setting-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.85rem;
  font-weight: bold;
  color: #ecf0f1;
  text-align: center;
}

/* السطر السفلي موزون: الحقول تلصق بأسفل الخانة وبنفس الارتفاع حتى لو العنوان نزل لسطرين */
.settings-row .setting-cell { justify-content: flex-end; }
.settings-row .setting-cell input,
.settings-row .setting-cell .setting-btn,
.settings-row .setting-cell :deep(.custom-select-trigger) { height: 40px; }
.settings-row .setting-cell input { text-align: center; padding: 8px; }
.settings-row .setting-cell :deep(.custom-select) { width: 100%; flex: none; min-width: 0; }

.master-controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 15px;
  width: 100%;
}

.master-btn { font-size: 1.05rem; padding: 12px 22px; }

.rules-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: var(--bg-gradient);
  flex-direction: column;
  align-items: center;
  z-index: 200;
  padding: 20px 15px;
  overflow-y: auto;
}

.rules-box {
  width: 100%;
  max-width: 460px;
  background: var(--panel-bg);
  border: 1px solid var(--border-glow);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(10px);
}

.rules-box h2 { color: var(--primary-color); text-align: center; margin-bottom: 15px; font-size: 1.4rem; }
.rules-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.rules-list li {
  background: #1e1e2f;
  padding: 10px 12px;
  border-radius: 8px;
  border-right: 4px solid var(--primary-color);
  font-size: 0.92rem;
  line-height: 1.6;
}

.back-to-game-btn {
  display: block;
  width: 100%;
  max-width: 460px;
  margin-top: 18px;
  background: var(--success-color);
  box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
  font-size: 1.05rem;
  padding: 12px;
}

.rounds-badge { font-size: 0.95rem; padding: 8px 15px; }

.layout-wrapper { display: flex; flex-direction: column; gap: 20px; width: 100%; }

.panel {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 15px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.panel h2, .panel h3 {
  font-size: 1.3rem;
  margin-bottom: 12px;
  color: #ecf0f1;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px;
  width: 100%;
  text-align: center;
}

.bag-caption {
  text-align: center;
  font-size: 0.95rem;
  color: #ccd6e0;
  margin-bottom: 14px;
  min-height: 1.3em;
}

.bag-timer {
  font-size: 38px;
  font-weight: bold;
  text-align: center;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 10px;
  min-height: 1.1em;
}

.bag-timer.urgent { color: #ff4757; }

.bag-stage { width: 100%; display: flex; justify-content: center; }

.bag-interior {
  position: relative;
  width: 100%;
  max-width: 280px;
  height: 170px;
  margin: 0 auto;
  background: linear-gradient(160deg, #caa06a, #a97c50);
  border-radius: 14px;
  border: 3px solid #6b4a2b;
  overflow: hidden;
  box-shadow: inset 0 6px 16px rgba(0,0,0,0.4);
}

.bag-interior::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 14px;
  background: repeating-linear-gradient(90deg, #6b4a2b 0 6px, transparent 6px 12px);
  opacity: 0.5;
}

.falling-item {
  position: absolute;
  top: -15%;
  font-size: 1.7rem;
  animation: bagFall 0.7s cubic-bezier(.34, 1.56, .64, 1) forwards;
  filter: drop-shadow(0 3px 3px rgba(0,0,0,0.4));
}

@keyframes bagFall {
  0% { top: -15%; opacity: 0; transform: rotate(0deg) scale(0.5); }
  70% { opacity: 1; }
  100% { top: var(--rest-top); opacity: 1; transform: rotate(var(--rot)) scale(1); }
}

.bag-closed-view, .bag-result-view {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 170px;
  width: 100%;
  max-width: 280px;
  margin: 0 auto;
  gap: 6px;
}

.bag-closed-icon {
  font-size: 5rem;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,0.4));
  animation: bagPulse 1.6s ease-in-out infinite;
}

@keyframes bagPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.bag-lock { font-size: 1.6rem; margin-top: -8px; }

.bag-result-weight {
  font-size: 2.3rem;
  font-weight: 900;
  color: var(--primary-color);
  text-shadow: 0 0 15px var(--border-glow);
  animation: resultPop 0.5s ease;
}

.bag-result-winner {
  font-size: 1.05rem;
  font-weight: bold;
  color: #2ecc71;
  text-align: center;
}

@keyframes resultPop {
  from { transform: scale(0.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.guess-count-line {
  text-align: center;
  font-size: 0.9rem;
  color: #f1c40f;
  margin-top: 10px;
  min-height: 1.2em;
}

.scoreboard-title {
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 10px;
  width: 100%;
}

.leaderboard-list { display: flex; flex-direction: column; gap: 6px; width: 100%; }

.leaderboard-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #1e1e2f;
  border-radius: 8px;
  font-size: 0.95rem;
}

.leaderboard-item .lb-rank { font-weight: bold; color: var(--primary-color); margin-left: 8px; }
.leaderboard-item.is-winner { background: #f39c12; color: #1e1e2f; font-weight: bold; }

.manual-add-row { display: flex; gap: 5px; width: 100%; flex-wrap: wrap; }
.manual-add-row input { flex: 1; min-width: 100px; }
.manual-add-row button { flex: none; padding: 8px 15px; font-size: 0.9rem; }

.event-log-panel {
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--primary-color); }
.event-log-panel :deep(.log-info) { border-right: 4px solid #3498db; }

.footer-note { padding: 15px; font-size: 0.85rem; }

.modal-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.8);
  align-items: center;
  justify-content: center;
  z-index: 160;
  padding: 15px;
}

.modal-content {
  background: #2a2a40;
  padding: 20px;
  border-radius: 15px;
  width: 100%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.15rem; }
.modal-logs { text-align: right; margin: 15px 0; font-size: 0.88rem; line-height: 1.5; display: flex; flex-direction: column; gap: 6px; }
.modal-logs :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; }
.modal-logs :deep(.scoreboard-title) {
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 10px;
  width: 100%;
}
</style>
