<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { BRIDGE_URL, normalizeDigits } from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const SCORES_KEY = 'vaultGame_scores';

const PALETTE = [
  {
    id: 'red', name: 'أحمر', color: '#e74c3c', synonyms: ['احمر'],
  },
  {
    id: 'blue', name: 'أزرق', color: '#3498db', synonyms: ['ازرق'],
  },
  {
    id: 'green', name: 'أخضر', color: '#2ecc71', synonyms: ['اخضر'],
  },
  {
    id: 'yellow', name: 'أصفر', color: '#f1c40f', synonyms: ['اصفر'],
  },
  {
    id: 'orange', name: 'برتقالي', color: '#e67e22', synonyms: ['برتقالي', 'برتقالى'],
  },
  {
    id: 'purple', name: 'بنفسجي', color: '#9b59b6', synonyms: ['بنفسجي', 'بنفسجى'],
  },
];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function normalizeToken(tok) {
  let s = String(tok).trim().replace(/\s+/g, '');
  s = s.replace(/[أإآ]/g, 'ا');
  return s;
}
const colorSynonymMap = new Map();
PALETTE.forEach((c) => {
  colorSynonymMap.set(normalizeToken(c.name), c.id);
  c.synonyms.forEach((s) => colorSynonymMap.set(normalizeToken(s), c.id));
});
function colorById(id) { return PALETTE.find((c) => c.id === id); }

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
  if (!playersScores.has(name)) playersScores.set(name, reactive({ name, score: 0 }));
  return playersScores.get(name);
}

const gamePhase = ref('idle'); // idle | memorizing | guessing | revealed-win | revealed-nowin
const sequenceType = ref('colors'); // colors | numbers
const sequenceLength = ref(4);
let memorizeDuration = 5;
const timeLeft = ref(0);
let memorizeCountdown = null;
const currentSequence = ref([]); // array of ids
const roundNumber = ref(0);
const eventLog = ref([]);
const lockIconOpened = ref(false);
const confettiPieces = ref([]);

const memorizeDurationInput = ref(5);
const manualNameInput = ref('');
const manualGuessInput = ref('');

const settingsDisabled = computed(() => gamePhase.value === 'memorizing' || gamePhase.value === 'guessing');

function setSequenceType(type) {
  if (settingsDisabled.value) return;
  sequenceType.value = type;
}
function setSequenceLength(len) {
  if (settingsDisabled.value) return;
  sequenceLength.value = len;
}

function getMemorizeDuration() {
  let val = parseInt(memorizeDurationInput.value, 10);
  if (Number.isNaN(val) || val < 2) val = 2;
  if (val > 20) val = 20;
  memorizeDurationInput.value = val;
  return val;
}

function generateSequence(type, length) {
  const seq = [];
  for (let i = 0; i < length; i++) {
    if (type === 'colors') {
      seq.push(PALETTE[Math.floor(Math.random() * PALETTE.length)].id);
    } else {
      seq.push(String(1 + Math.floor(Math.random() * 9)));
    }
  }
  return seq;
}

const winnerBannerVisible = ref(false);
const winnerBannerHtml = ref('');
const winnerBannerColor = ref('#f39c12');

function startNewVault() {
  if (settingsDisabled.value) return;

  roundNumber.value++;
  currentSequence.value = generateSequence(sequenceType.value, sequenceLength.value);
  memorizeDuration = getMemorizeDuration();
  timeLeft.value = memorizeDuration;
  gamePhase.value = 'memorizing';
  lockIconOpened.value = false;

  winnerBannerVisible.value = false;
  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🔒 الخزنة ${roundNumber.value}: تسلسل ${sequenceType.value === 'colors' ? 'ألوان' : 'أرقام'} بطول ${sequenceLength.value} (${sequenceLength.value} نقاط)</div>`);

  startMemorizeTimer();
}

function startMemorizeTimer() {
  if (memorizeCountdown) clearInterval(memorizeCountdown);
  memorizeCountdown = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(memorizeCountdown);
      memorizeCountdown = null;
      hideSequenceAndOpenGuessing();
    }
  }, 1000);
}

function hideSequenceAndOpenGuessing() {
  gamePhase.value = 'guessing';
  appendLog('<div class="log-item" style="text-align:center; color:#f1c40f;">🙈 اختفى التسلسل! أول تعليق صحيح بالترتيب يفتح الخزنة</div>');
}

function parseGuessTokens(rawText) {
  const cleaned = String(rawText).trim();
  let tokens = cleaned.split(/[\s,،\-_/]+/).filter((t) => t.length > 0);

  if (sequenceType.value === 'numbers') {
    const normalizedWhole = normalizeDigits(cleaned).replace(/\D/g, '');
    if (tokens.length !== currentSequence.value.length && normalizedWhole.length === currentSequence.value.length) {
      tokens = normalizedWhole.split('');
    }
  }
  return tokens;
}

function tokenToId(tok) {
  if (sequenceType.value === 'numbers') {
    const normalized = normalizeDigits(tok).replace(/\D/g, '');
    return normalized === '' ? null : normalized;
  }
  return colorSynonymMap.get(normalizeToken(tok)) || null;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function checkGuess(rawText) {
  if (currentSequence.value.length === 0) return false;
  const tokens = parseGuessTokens(rawText);
  if (tokens.length !== currentSequence.value.length) return false;
  const ids = tokens.map((t) => tokenToId(t));
  if (ids.some((id) => id === null)) return false;
  return arraysEqual(ids, currentSequence.value);
}

function registerGuessFromComment(username, rawText) {
  if (gamePhase.value !== 'guessing' || !username || !rawText) return;
  if (checkGuess(rawText)) resolveWin(username);
}

function manualGuess() {
  if (gamePhase.value !== 'guessing') return;
  const name = manualNameInput.value.trim();
  const guess = manualGuessInput.value.trim();
  if (name === '' || guess === '') return;
  if (checkGuess(guess)) {
    resolveWin(name);
  } else {
    appendLog(`<div class="log-item log-miss">❌ محاولة خاطئة من <b>${escapeHtml(name)}</b>: ${escapeHtml(guess)}</div>`);
  }
  manualGuessInput.value = '';
}

function sequenceDisplayText() {
  if (sequenceType.value === 'numbers') return currentSequence.value.join(' - ');
  return currentSequence.value.map((id) => colorById(id).name).join(' - ');
}

function resolveWin(username) {
  const points = currentSequence.value.length;
  const player = getOrCreatePlayer(username);
  player.score += points;
  saveScores();

  gamePhase.value = 'revealed-win';
  appendLog(`<div class="log-item log-hit">🎉 <b>${escapeHtml(username)}</b> فتح الخزنة وكسب <b>${points}</b> نقطة! التسلسل: ${sequenceDisplayText()}</div>`);

  spawnConfetti();
  lockIconOpened.value = true;

  winnerBannerVisible.value = true;
  winnerBannerColor.value = '#f39c12';
  winnerBannerHtml.value = `🎉 <b>${escapeHtml(username)}</b> فتح الخزنة وكسب ${points} نقطة! 💰`;
}

function revealNoWinner() {
  if (gamePhase.value !== 'guessing') return;
  gamePhase.value = 'revealed-nowin';
  appendLog(`<div class="log-item" style="text-align:center; color:#8b93a3;">🔓 كشف المستضيف الحل — ما حد فتح الخزنة. التسلسل كان: ${sequenceDisplayText()}</div>`);

  winnerBannerVisible.value = true;
  winnerBannerColor.value = '#bdc3c7';
  winnerBannerHtml.value = `🔓 ما حد فتح الخزنة هالمرة! التسلسل كان: ${sequenceDisplayText()}`;
}

let confettiIdCounter = 0;
function spawnConfetti() {
  const emojis = ['💰', '✨', '🎉', '🪙'];
  const pieces = [];
  for (let i = 0; i < 26; i++) {
    pieces.push({
      id: confettiIdCounter++,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 100,
      duration: 1.2 + Math.random() * 1,
      delay: Math.random() * 0.4,
    });
  }
  confettiPieces.value = pieces;
  setTimeout(() => { confettiPieces.value = []; }, 2600);
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

function endGame() {
  const sorted = Array.from(playersScores.values()).sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  const logs = sorted.length === 0
    ? ['<div class="log-item" style="color:#8b93a3;">ما فيه أي لاعب سجّل نقاطاً بعد.</div>']
    : sorted.map((p, i) => `<div class="log-item">${medals[i] || `${i + 1}.`} <b>${escapeHtml(p.name)}</b> — ${p.score} نقطة</div>`);

  if (sorted.length > 0) {
    logs.unshift(`<div style="text-align:center; font-size:16px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 بطل اللعبة: <b>${escapeHtml(sorted[0].name)}</b> 🏆</div>`);
  }

  appendLog('<div class="log-item" style="text-align:center; color:#f39c12; font-weight:bold;">🏁 أنهى المستضيف اللعبة وعرض النتيجة النهائية</div>');
  openModal('🏁 نتيجة اللعبة النهائية', logs);
}

function resetGame() {
  if (memorizeCountdown) { clearInterval(memorizeCountdown); memorizeCountdown = null; }
  playersScores.clear();
  saveScores();
  gamePhase.value = 'idle';
  currentSequence.value = [];
  roundNumber.value = 0;
  eventLog.value = [];
  winnerBannerVisible.value = false;
  lockIconOpened.value = false;
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const timerVisible = computed(() => gamePhase.value === 'memorizing');
const timerUrgent = computed(() => timeLeft.value <= 2);
const tilesVisible = computed(() => ['memorizing', 'revealed-win', 'revealed-nowin'].includes(gamePhase.value));
const lockVisible = computed(() => gamePhase.value !== 'memorizing');
const lockIconText = computed(() => {
  if (gamePhase.value === 'idle') return '🔐';
  if (gamePhase.value === 'guessing' || gamePhase.value === 'revealed-nowin') return '🔒';
  if (gamePhase.value === 'revealed-win') return '🔓';
  return '🔐';
});
const statusText = computed(() => {
  if (gamePhase.value === 'idle') return 'اضغط "توليد خزنة جديدة" لبدء أول جولة';
  if (gamePhase.value === 'memorizing') return 'احفظ الترتيب! التسلسل يختفي بعد قليل...';
  if (gamePhase.value === 'guessing') return `🔒 الخزنة مقفلة — اكتب التسلسل بالترتيب بالدردشة (${currentSequence.value.length} عناصر)`;
  if (gamePhase.value === 'revealed-win') return 'انفتحت الخزنة! اضغط "توليد خزنة جديدة" للمتابعة';
  return 'ما حد فتح الخزنة. اضغط "توليد خزنة جديدة" لجولة أخرى';
});

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const manualPanelVisible = computed(() => gamePhase.value === 'guessing');
const newVaultBtnVisible = computed(() => !settingsDisabled.value);
const revealBtnVisible = computed(() => gamePhase.value === 'guessing');

function tileStyle(id) {
  if (sequenceType.value === 'numbers') return { background: '#2a2a40' };
  return { background: colorById(id).color };
}
function tileText(id) {
  if (sequenceType.value === 'numbers') return id;
  return colorById(id).name;
}

const showRulesOverlay = ref(false);
function goHome() { router.push('/'); }

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
let tiktokSocket = null;

function connectTikTok() {
  const username = tiktokUsername.value.trim();
  if (!username) {
    tiktokStatus.value = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokStatusColor.value = 'orange';
    return;
  }
  if (tiktokSocket) tiktokSocket.close();
  trackConnectRequest('vault', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) registerGuessFromComment(data.user, data.comment);
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {});
onUnmounted(() => {
  if (memorizeCountdown) clearInterval(memorizeCountdown);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: أي مشاهد يقدر يحاول يفتح الخزنة بكتابة التسلسل بالدردشة، بدون تسجيل مسبق</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label>🎨 نوع تسلسل الخزنة:</label>
    <div class="type-toggle-row">
      <button class="type-btn" :class="{ active: sequenceType === 'colors' }" :disabled="settingsDisabled" @click="setSequenceType('colors')">🎨 ألوان</button>
      <button class="type-btn" :class="{ active: sequenceType === 'numbers' }" :disabled="settingsDisabled" @click="setSequenceType('numbers')">🔢 أرقام</button>
    </div>
    <div class="field-hint">الألوان المتاحة: أحمر، أزرق، أخضر، أصفر، برتقالي، بنفسجي — والأرقام من 1 إلى 9 (يمكن التكرار داخل نفس التسلسل)</div>
  </div>

  <div class="top-names-section">
    <label>🔢 طول التسلسل (يحدد نقاط الخزنة أيضاً):</label>
    <div class="length-toggle-row">
      <button v-for="len in [3,4,5,6]" :key="len" class="length-btn" :class="{ active: sequenceLength === len }" :disabled="settingsDisabled" @click="setSequenceLength(len)">{{ len }} = {{ len }} نقاط</button>
    </div>
  </div>

  <div class="top-names-section">
    <label for="memorizeDurationInput">⏱️ مدة عرض التسلسل بالثواني قبل الاختفاء:</label>
    <div class="round-time-row">
      <input v-model="memorizeDurationInput" type="number" min="2" max="20" :disabled="settingsDisabled">
      <div class="field-hint" style="margin-top:0;">بعدها يختفي التسلسل وتظهر الخزنة المقفلة — أول تعليق صحيح بالترتيب يفتحها</div>
    </div>
  </div>

  <h1>🔐 الخزنة</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button v-if="newVaultBtnVisible" class="master-btn" @click="startNewVault">🔒 توليد خزنة جديدة</button>
    <button v-if="revealBtnVisible" class="master-btn" style="background:#3498db;" @click="revealNoWinner">🔓 كشف الحل الآن</button>
    <button class="master-btn" style="background:#8A1538;" @click="endGame">🏁 إنهاء اللعبة</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الخزنة: {{ roundNumber }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🎥 شاشة العرض للجمهور</h2>
      <div class="vault-stage">
        <div class="confetti-layer">
          <span
            v-for="piece in confettiPieces"
            :key="piece.id"
            class="confetti-piece"
            :style="{ left: piece.left + '%', animationDuration: piece.duration + 's', animationDelay: piece.delay + 's' }"
          >{{ piece.emoji }}</span>
        </div>
        <div v-if="timerVisible" class="vault-timer" style="display:block;" :class="{ urgent: timerUrgent }">{{ timeLeft }}</div>
        <div v-if="tilesVisible" class="vault-tiles" style="display:flex;" :class="{ 'is-numbers-mode': sequenceType === 'numbers' }">
          <div
            v-for="(id, i) in currentSequence"
            :key="i"
            class="vault-tile"
            :class="{ 'is-number': sequenceType === 'numbers' }"
            :style="tileStyle(id)"
          >{{ tileText(id) }}</div>
        </div>
        <div v-if="lockVisible" class="vault-lock-icon" style="display:block;" :class="{ opened: lockIconOpened }">{{ lockIconText }}</div>
        <div class="vault-status-line">{{ statusText }}</div>
        <div v-if="winnerBannerVisible" class="vault-winner-banner" style="display:block;" :style="{ color: winnerBannerColor }" v-html="winnerBannerHtml"></div>
      </div>
      <div class="scoreboard-title">🏆 لوحة الصدارة</div>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item">
          <span><span class="lb-rank">{{ rankFor(i) }}</span>{{ p.name }}</span>
          <span>{{ p.score }} نقطة</span>
        </div>
      </div>
    </div>

    <div v-if="manualPanelVisible" class="panel" style="display:flex;">
      <h3>✍️ محاولة يدوية (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualGuessInput" type="text" placeholder="التسلسل مثل: أحمر أزرق أخضر" @keydown.enter.prevent="manualGuess">
        <button class="master-btn" @click="manualGuess">إرسال</button>
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
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة الخزنة 🔐</h2>
      <ul class="rules-list">
        <li><b>العرض:</b> يظهر تسلسل من الألوان أو الأرقام (يحدده المستضيف) لمدة محددة بالثواني ثم يختفي وتظهر خزنة مقفلة</li>
        <li><b>المحاولة:</b> يكتب المتابع التسلسل بالترتيب الصحيح في تعليق واحد مفصول بمسافات، مثل "أحمر أزرق أخضر" أو "1 4 7" — لا حاجة للانضمام المسبق، أي شخص يقدر يحاول</li>
        <li><b>نقاط الخزنة:</b> تسلسل من 3 = 3 نقاط، 4 = 4 نقاط، 5 = 5 نقاط، 6 = 6 نقاط</li>
        <li><b>الفوز:</b> أول شخص يكتب التسلسل الصحيح بالكامل وبنفس الترتيب يكسر القفل ويأخذ رصيد الخزنة كاملاً، مع مؤثر فتح واحتفال باسمه</li>
        <li>لو ما حد فتح الخزنة، يقدر المستضيف يضغط "كشف الحل الآن" لإنهاء الجولة بدون فائز وعرض التسلسل الصحيح من جديد</li>
        <li>بعد كل جولة يضغط المستضيف "توليد خزنة جديدة" لجولة أخرى، أو "إنهاء اللعبة" لعرض لوحة الصدارة النهائية</li>
        <li>النظام يتقبل اختلاف بسيط بكتابة الألوان (مثل أحمر/احمر) بسبب توحيد الهمزات تلقائياً</li>
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

textarea:disabled, input:disabled, button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input:focus, select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.round-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.round-time-row input[type="number"] {
  width: 90px;
  text-align: center;
  flex: none;
}

.type-toggle-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.type-btn {
  flex: 1;
  min-width: 120px;
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  color: #ecf0f1;
  padding: 10px;
  border-radius: 10px;
  font-weight: bold;
  cursor: pointer;
  font-size: 0.95rem;
}

.type-btn.active {
  border-color: var(--primary-color);
  background: #3a2f14;
  box-shadow: 0 0 10px var(--border-glow);
}

.length-toggle-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.length-btn {
  flex: 1;
  min-width: 60px;
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  color: #ecf0f1;
  padding: 10px;
  border-radius: 10px;
  font-weight: bold;
  cursor: pointer;
  text-align: center;
}

.length-btn.active {
  border-color: var(--primary-color);
  background: #3a2f14;
  box-shadow: 0 0 10px var(--border-glow);
}

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

#newVaultBtn {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 150;
  width: calc(100% - 40px);
  max-width: 380px;
  padding: 16px 20px;
  font-size: 1.15rem;
  border-radius: 50px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: floatPulse 2.4s ease-in-out infinite;
}

@keyframes floatPulse {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(-4px); }
}

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

.rules-box h2 {
  color: var(--primary-color);
  text-align: center;
  margin-bottom: 15px;
  font-size: 1.4rem;
}

.rules-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

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

.layout-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

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

.vault-stage {
  position: relative;
  width: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.vault-tiles {
  display: flex;
  direction: rtl;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 14px;
}

.vault-tiles.is-numbers-mode { direction: ltr; }

.vault-tile {
  width: 62px;
  height: 62px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.5rem;
  color: #fff;
  box-shadow: 0 4px 10px rgba(0,0,0,0.4);
  border: 2px solid rgba(255,255,255,0.25);
}

.vault-tile.is-number { font-size: 1.8rem; background: #2a2a40; }

.vault-timer {
  font-size: 40px;
  font-weight: bold;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 8px;
}

.vault-timer.urgent { color: #ff4757; }

.vault-lock-icon {
  font-size: 70px;
  margin-bottom: 10px;
  filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
  transition: transform 0.4s;
}

.vault-lock-icon.opened {
  animation: vaultPop 0.6s ease;
}

@keyframes vaultPop {
  0% { transform: scale(0.6) rotate(-10deg); }
  50% { transform: scale(1.25) rotate(6deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.vault-status-line {
  text-align: center;
  font-size: 0.98rem;
  color: #ccd6e0;
  min-height: 1.3em;
  margin-bottom: 6px;
}

.vault-winner-banner {
  text-align: center;
  font-size: 1.2rem;
  font-weight: bold;
  color: #f39c12;
  background: rgba(243,156,18,0.12);
  border: 1px solid var(--border-glow);
  border-radius: 10px;
  padding: 12px;
  margin-top: 8px;
  width: 100%;
}

.confetti-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.confetti-piece {
  position: absolute;
  top: -20px;
  font-size: 1.4rem;
  animation-name: confettiFall;
  animation-timing-function: ease-in;
  animation-fill-mode: forwards;
}

@keyframes confettiFall {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(220px) rotate(360deg); opacity: 0; }
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

.manual-add-row { display: flex; gap: 5px; width: 100%; flex-wrap: wrap; }
.manual-add-row input { flex: 1; min-width: 120px; }
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
.event-log-panel :deep(.log-miss) { border-right: 4px solid #8b93a3; }

.footer-note { padding: 15px; font-size: 0.85rem; }

.modal-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.8);
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 15px;
}

.modal-content {
  background: #2a2a40;
  padding: 20px;
  border-radius: 15px;
  width: 100%;
  max-width: 380px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.15rem; }
.modal-logs { text-align: right; margin: 15px 0; font-size: 0.88rem; line-height: 1.5; display: flex; flex-direction: column; gap: 6px; }
.modal-logs :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; }
</style>
