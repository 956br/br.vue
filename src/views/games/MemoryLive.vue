<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
} from '../../utils/tiktokConnectionManager';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();

const RAW_SYMBOLS = [
  '🏆', '🎯', '🚀', '⚡', '🔥', '🌟', '🧩', '🎲', '💎', '💡', '🕹️', '🛡️', '🎵', '🍀', '🐼', '🌈', '⭐', '🍉',
  '✌🏼', '❌', '✈️', '🕹️', '🦁', '😎', '👻', '👽', '🤖', '👀', '🪡', '🧵', '🧶', '🧢', '👑', '🧳', '🌂', '🕶️',
  '🐱', '🦊', '🐰', '🐻', '🐶', '🐍', '🕷️', '🐳', '🐬', '🐊', '🐪', '🦘', '🦒', '🐏', '🦌', '🦚', '🦔', '🕊️',
  '🌳', '🍄', '🐚', '🌹', '🌕', '🌍', '🌙', '🔥', '☀️', '☁️', '🍎', '🍋', '🍌', '🍊', '🍓', '🍇', '🍒', '🥭',
  '🥝', '🥥', '🥐', '🧀', '🥖', '🍔', '🍟', '🍕', '🍩', '🍭', '🧁', '🍰', '🍿', '🥜', '🍯', '🍫', '🍦', '⚽️',
  '🏀', '🎾', '🎱', '🏓', '🪁', '🛝', '🛹', '🏹', '🪂', '🏅', '🎨', '🎤', '🎧', '🎹', '🎳', '♟️', '🚗', '🚑',
  '🚒', '🚲', '🚅', '⛵️', '🚁', '🚦', '🎡', '⛺️', '☎️', '📻', '🪎', '🧲', '🔭', '🛒', '🧸', '🪑', '🗝️', '🎀',
  '✉️', '📦', '📍', '📚', '✏️', '🔒', '💯', '🔔', '🃏', '🕚', '🚩',
];
const SYMBOLS = [...new Set(RAW_SYMBOLS)];
const PLAYER_COLORS = ['#3498db', '#e74c3c', '#27ae60', '#9b59b6', '#f1c40f', '#e67e22', '#1abc9c', '#fd79a8', '#00b894', '#6c5ce7', '#d35400', '#2ecc71'];
const MAX_POINTS = SYMBOLS.length;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== صوت =====
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq = 440, duration = 0.15, type = 'sine', vol = 0.3, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const startTime = ctx.currentTime + delay;
    osc.start(startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.stop(startTime + duration);
  } catch (e) { /* noop */ }
}
const playMatchSound = () => { beep(880, 0.15, 'triangle', 0.3); beep(1200, 0.15, 'triangle', 0.3, 0.12); };
const playMissSound = () => beep(180, 0.25, 'sawtooth', 0.3);
const playWinSound = () => { beep(660, 0.15); beep(880, 0.15, 'sine', 0.3, 0.15); beep(1100, 0.25, 'sine', 0.3, 0.3); };

// ===== قائمة المسجلين =====
const registeredPlayers = reactive([]); // [username]
const registeredSet = new Set();

function registerViewer(username) {
  if (!username || registeredSet.has(username)) return;
  registeredSet.add(username);
  registeredPlayers.push(username);
}

const manualPlayerName = ref('');
function addManualPlayer() {
  const name = manualPlayerName.value.trim();
  if (!name) return;
  if (registeredSet.has(name)) {
    manualPlayerName.value = '';
    return;
  }
  registerViewer(name);
  manualPlayerName.value = '';
}

function unregisterViewer(username) {
  registeredSet.delete(username);
  const idx = registeredPlayers.indexOf(username);
  if (idx !== -1) registeredPlayers.splice(idx, 1);
  const selIdx = selectedUsernames.indexOf(username);
  if (selIdx !== -1) selectedUsernames.splice(selIdx, 1);
}

// ===== إعدادات الجولة واختيار اللاعبين =====
const desiredPlayerCount = ref(2);
const pointsInput = ref(6);
const turnTimerEnabled = ref(false);
const turnDurationInput = ref(20);
const randomOrder = ref(false);
const selectedUsernames = reactive([]);

function toggleSelected(username) {
  if (roundActive.value) return;
  const idx = selectedUsernames.indexOf(username);
  if (idx !== -1) selectedUsernames.splice(idx, 1);
  else selectedUsernames.push(username);
}

function pickRandomPlayers() {
  if (roundActive.value) return;
  let count = parseInt(desiredPlayerCount.value, 10);
  if (Number.isNaN(count) || count < 2) count = 2;
  count = Math.min(count, registeredPlayers.length);
  selectedUsernames.splice(0, selectedUsernames.length, ...shuffle(registeredPlayers).slice(0, count));
}

function clearSelection() {
  if (roundActive.value) return;
  selectedUsernames.splice(0, selectedUsernames.length);
}

function onDesiredPlayerCountChange() {
  let v = parseInt(desiredPlayerCount.value, 10);
  if (Number.isNaN(v) || v < 2) v = 2;
  if (v > 30) v = 30;
  desiredPlayerCount.value = v;
}

function onPointsChange() {
  let v = parseInt(pointsInput.value, 10);
  if (Number.isNaN(v) || v < 2) v = 2;
  if (v > MAX_POINTS) v = MAX_POINTS;
  pointsInput.value = v;
}

function onTurnDurationChange() {
  let v = parseInt(turnDurationInput.value, 10);
  if (Number.isNaN(v) || v < 5) v = 5;
  if (v > 120) v = 120;
  turnDurationInput.value = v;
}

const canStartRound = computed(() => !roundActive.value
  && selectedUsernames.length >= 2
  && selectedUsernames.length === Number(desiredPlayerCount.value)
  && Number(pointsInput.value) >= 2);

const startRoundHint = computed(() => {
  if (selectedUsernames.length === 0) return 'اختر اللاعبين المشاركين من القائمة المسجلة، أو استخدم "اختيار عشوائي".';
  if (selectedUsernames.length !== Number(desiredPlayerCount.value)) {
    return `⚠️ حددت ${selectedUsernames.length} لاعب، بينما عدد اللاعبين المطلوب ${desiredPlayerCount.value}. عدّل التحديد أو غيّر العدد المطلوب.`;
  }
  return '✅ جاهز لبدء الجولة!';
});

// ===== حالة اللعبة =====
const board = reactive([]); // { symbol, index, flipped, claimedBy, backText }
const roundPlayers = reactive([]); // { username, name, color, score }
const currentPlayerIndex = ref(0);
const roundActive = ref(false);
const resolving = ref(false);
const roundNumber = ref(0);
let matchesFound = 0;
let totalPairsThisRound = 0;
const clickBuffer = [];

const currentPlayer = computed(() => roundPlayers[currentPlayerIndex.value] || null);

function getPlayerByUsername(username) {
  return roundPlayers.find((p) => p.username === username);
}

const logItems = ref([]);
function addLog(cls, text) {
  logItems.value.unshift({ cls, text });
  if (logItems.value.length > 60) logItems.value.pop();
}

const boardColumns = computed(() => {
  const n = board.length;
  if (n <= 12) return 4;
  if (n <= 20) return 5;
  if (n <= 30) return 6;
  return 7;
});

let turnTimer = null;
const turnTimeLeft = ref(0);
const turnTimerVisible = ref(false);
const turnTimerUrgent = computed(() => turnTimeLeft.value <= 5);

function clearTurnTimer() {
  if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
  turnTimerVisible.value = false;
}

function startTurnTimer() {
  clearTurnTimer();
  if (!turnTimerEnabled.value) return;
  const secs = parseInt(turnDurationInput.value, 10);
  if (!secs || secs <= 0) return;
  turnTimeLeft.value = secs;
  turnTimerVisible.value = true;
  turnTimer = setInterval(() => {
    turnTimeLeft.value--;
    if (turnTimeLeft.value <= 0) {
      clearTurnTimer();
      if (roundActive.value && !resolving.value && currentPlayer.value) {
        addLog('system', `⌛ انتهى وقت ${currentPlayer.value.name} بدون محاولة صحيحة، الدور ينتقل.`);
        nextTurn();
      }
    }
  }, 1000);
}

const winnerModalVisible = ref(false);
const winnerListSorted = ref([]);
const rulesVisible = ref(false);
const barExpanded = ref(true);
const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }
const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

function buildBoard(points) {
  const pool = shuffle(SYMBOLS).slice(0, points);
  const doubled = shuffle([...pool, ...pool]);
  return doubled.map((symbol, i) => ({
    symbol, index: i + 1, flipped: false, claimedBy: null, backText: symbol,
  }));
}

function startRound() {
  if (!canStartRound.value) return;

  let order = [...selectedUsernames];
  if (randomOrder.value) order = shuffle(order);

  roundPlayers.splice(0, roundPlayers.length, ...order.map((username, i) => ({
    username,
    name: username,
    avatar: getUserAvatar(username),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    score: 0,
  })));

  totalPairsThisRound = Number(pointsInput.value);
  board.splice(0, board.length, ...buildBoard(totalPairsThisRound));
  matchesFound = 0;
  currentPlayerIndex.value = 0;
  roundActive.value = true;
  resolving.value = false;
  roundNumber.value++;
  logItems.value = [];

  addLog('system', `🎮 بدأت الجولة ${roundNumber.value}! اللاعبون: ${roundPlayers.map((p) => p.name).join('، ')} — عدد النقاط: ${totalPairsThisRound} (${board.length} بطاقة).`);
  addLog('system', `🎯 دور: ${currentPlayer.value.name} — يرسل رقمين بالدردشة لفتح بطاقتين، مثل "3 19".`);

  startTurnTimer();
}

function nextTurn() {
  clearTurnTimer();
  currentPlayerIndex.value = (currentPlayerIndex.value + 1) % roundPlayers.length;
  addLog('system', `🎯 دور: ${currentPlayer.value.name}`);
  startTurnTimer();
}

function endRound() {
  roundActive.value = false;
  clearTurnTimer();

  const maxScore = Math.max(...roundPlayers.map((p) => p.score));
  winnerListSorted.value = [...roundPlayers]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ ...p, isWinner: p.score === maxScore }));

  const winners = winnerListSorted.value.filter((p) => p.isWinner).map((p) => p.name);
  const title = winners.length > 1 ? `🤝 تعادل بين: ${winners.join('، ')}!` : `🏆 الفائز: ${winners[0]}!`;

  addLog('system', `🏁 انتهت الجولة! ${title}`);
  playWinSound();
  winnerModalVisible.value = true;
}

function attemptOpenPair(i1, i2) {
  if (!roundActive.value || resolving.value) return false;
  if (i1 === i2) return false;
  if (i1 < 0 || i1 >= board.length || i2 < 0 || i2 >= board.length) return false;
  const c1 = board[i1];
  const c2 = board[i2];
  if (!c1 || !c2 || c1.claimedBy || c2.claimedBy) return false;

  resolving.value = true;
  clearTurnTimer();
  c1.flipped = true;
  c2.flipped = true;

  setTimeout(() => {
    const player = currentPlayer.value;
    if (!player) { resolving.value = false; return; }

    if (c1.symbol === c2.symbol) {
      c1.claimedBy = player.username; c2.claimedBy = player.username;
      c1.backText = player.name; c2.backText = player.name;
      player.score++;
      matchesFound++;
      playMatchSound();
      addLog('match', `🎉 ${player.name} طابق بين البطاقتين ${i1 + 1} و${i2 + 1} (+1 نقطة) — دوره يستمر!`);
      resolving.value = false;

      if (matchesFound >= totalPairsThisRound) {
        setTimeout(endRound, 700);
      } else {
        startTurnTimer();
      }
    } else {
      playMissSound();
      addLog('miss', `❌ ${player.name} حاول ${i1 + 1} و${i2 + 1} لكنهما غير متطابقتين.`);
      setTimeout(() => {
        c1.flipped = false;
        c2.flipped = false;
        resolving.value = false;
        nextTurn();
      }, 900);
    }
  }, 700);

  return true;
}

function onCardClick(i) {
  if (!roundActive.value || resolving.value) return;
  const card = board[i];
  if (!card || card.claimedBy) return;
  if (clickBuffer.includes(i)) return;
  clickBuffer.push(i);
  if (clickBuffer.length === 2) {
    const [a, b] = clickBuffer;
    clickBuffer.length = 0;
    attemptOpenPair(a, b);
  }
}

const manualNum1 = ref('');
const manualNum2 = ref('');
function manualOpen() {
  const n1 = parseInt(normalizeDigits(manualNum1.value), 10);
  const n2 = parseInt(normalizeDigits(manualNum2.value), 10);
  if (Number.isNaN(n1) || Number.isNaN(n2)) return;
  if (attemptOpenPair(n1 - 1, n2 - 1)) {
    manualNum1.value = '';
    manualNum2.value = '';
  }
}

function skipTurnManually() {
  if (!roundActive.value || resolving.value || !currentPlayer.value) return;
  addLog('system', `⏭️ المستضيف تخطى دور ${currentPlayer.value.name} يدوياً.`);
  nextTurn();
}

function forceEndRound() {
  if (!roundActive.value) return;
  endRound();
}

function startNewRound() {
  winnerModalVisible.value = false;
  roundActive.value = false;
  resolving.value = false;
  clearTurnTimer();
  board.splice(0, board.length);
  roundPlayers.splice(0, roundPlayers.length);
  clickBuffer.length = 0;
}

function resetEverything() {
  startNewRound();
  registeredPlayers.splice(0, registeredPlayers.length);
  registeredSet.clear();
  selectedUsernames.splice(0, selectedUsernames.length);
  stopRegistration();
  logItems.value = [];
  roundNumber.value = 0;
}

function toggleRules(show) {
  rulesVisible.value = show;
}

function goHome() {
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
const joinWordInput = ref('انضم');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

function getJoinWord() { return joinWordInput.value.trim() || 'انضم'; }

const joinModeHint = computed(() => (joinViaGift.value
  ? '🎁 الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية مطابقة (أو أي هدية إذا تُرك الحقل فارغاً) يُضاف لقائمة المرشحين تلقائياً (مرة واحدة لكل شخص).'
  : `🎯 الانضمام: يكتب المشاهد <b>"${getJoinWord()}"</b> بالدردشة لينضم لقائمة المرشحين (مرة واحدة لكل شخص).<br>⌨️ أثناء الجولة: صاحب الدور فقط يكتب رقمين مثل <b>"3 19"</b> ليفتح تلك البطاقتين.`));

function handleTikTokMessage(user, commentRaw) {
  if (!user || !commentRaw) return;
  const text = normalizeDigits(commentRaw).trim();

  if (registrationOpen.value && !joinViaGift.value && text === normalizeDigits(getJoinWord())) {
    registerViewer(user);
    return;
  }

  if (!roundActive.value || resolving.value) return;
  const player = currentPlayer.value;
  if (!player || user !== player.username) return;

  const matches = text.match(/\d+/g);
  if (!matches) return;
  const uniqueNums = [...new Set(matches.map((m) => parseInt(m, 10)))]
    .filter((n) => n >= 1 && n <= board.length);
  if (uniqueNums.length < 2) return;

  attemptOpenPair(uniqueNums[0] - 1, uniqueNums[1] - 1);
}

function handleTiktokMessage(data) {
  if (data.comment) {
    handleTikTokMessage(data.user, data.comment);
  }
  if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
    && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
    const giftUser = getGiftUser(data);
    if (giftUser) registerViewer(giftUser);
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'memory-live', onMessage: handleTiktokMessage });
}

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية.`
  : '🔒 التسجيل مغلق — حدد المدة واضغط "بدء التسجيل" لفتح باب الانضمام.'));

function startRegistration() {
  if (registrationOpen.value) return;
  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 5;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;
  if (registrationTimer) clearInterval(registrationTimer);
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
  }, 1000);
}
function extendRegistration() {
  if (!registrationOpen.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
}
function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (!roundActive.value && canStartRound.value) startRound();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  clearTurnTimer();
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🧠 الذاكرة</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
    <button v-if="roundActive" class="rules-btn" @click="skipTurnManually">⏭️ تخطي الدور الحالي</button>
    <button v-if="roundActive" class="reset-btn" @click="forceEndRound">🏁 إنهاء الجولة الآن</button>
    <div class="timer-chip" :class="{ urgent: turnTimerVisible && turnTimerUrgent }">⏱️ {{ turnTimerVisible ? `${turnTimeLeft}s` : '--' }}</div>
    <button class="rules-btn" @click="toggleRules(true)">📖 دليل اللعبة</button>
    <button class="reset-btn" @click="resetEverything">🔄 إعادة كل شيء</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
  </div>

  <div class="top-names-section">
    <label>⚙️ إعدادات الجولة</label>
    <div class="setup-grid">
      <div class="setup-field">
        <label for="desiredPlayerCount">👥 عدد اللاعبين</label>
        <input id="desiredPlayerCount" v-model="desiredPlayerCount" type="number" min="2" max="30" :disabled="roundActive" @change="onDesiredPlayerCountChange">
      </div>
      <div class="setup-field">
        <label for="pointsInput">⭐ عدد النقاط (الأزواج)</label>
        <input id="pointsInput" v-model="pointsInput" type="number" min="2" :max="MAX_POINTS" :disabled="roundActive" @change="onPointsChange">
      </div>
      <div class="setup-field setup-field-checkbox">
        <label class="join-gift-toggle" for="turnTimerEnabledCheckbox">
          <input id="turnTimerEnabledCheckbox" v-model="turnTimerEnabled" type="checkbox" :disabled="roundActive">
          ⏱️ مؤقت للدور
        </label>
        <input
          v-if="turnTimerEnabled"
          id="turnDurationInput"
          v-model="turnDurationInput"
          type="number"
          min="5"
          max="120"
          class="inline-number"
          placeholder="المدة (ثانية)"
          :disabled="roundActive"
          @change="onTurnDurationChange"
        >
      </div>
      <div class="setup-field setup-field-checkbox">
        <label class="join-gift-toggle" for="randomOrderCheckbox">
          <input id="randomOrderCheckbox" v-model="randomOrder" type="checkbox" :disabled="roundActive">
          🔀 ترتيب دور عشوائي
        </label>
      </div>
    </div>
    <div class="field-hint">عدد النقاط = نصف عدد الصور المستخدمة (عدد البطاقات = النقاط × 2). الحد الأقصى للنقاط: {{ MAX_POINTS }}.</div>

    <div v-if="!roundActive" class="player-picker">
      <div class="field-hint" style="margin-bottom:6px;">✅ اختر اللاعبين المشاركين هذه الجولة من قائمة المسجلين:</div>
      <div v-if="registeredPlayers.length === 0" class="field-hint">افتح باب التسجيل أول وخلي المشاهدين ينضمون.</div>
      <div class="chips-row">
        <label v-for="u in registeredPlayers" :key="u" class="pick-chip" :class="{ picked: selectedUsernames.includes(u) }">
          <input type="checkbox" :checked="selectedUsernames.includes(u)" @change="toggleSelected(u)">
          <img v-if="getUserAvatar(u)" :src="getUserAvatar(u)" class="player-avatar" alt="">
          {{ u }}
        </label>
      </div>
      <div class="master-controls" style="margin-top:10px; margin-bottom:0;">
        <button class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="pickRandomPlayers">🎲 اختيار عشوائي</button>
        <button class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="clearSelection">🧹 مسح التحديد</button>
      </div>
      <div class="field-hint registration-status">{{ startRoundHint }}</div>
    </div>
    <div v-else class="field-hint registration-status">🎮 الجولة جارية الآن — إعدادات الجولة القادمة ستُفتح بعد انتهائها.</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button class="master-btn side-panel-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" :disabled="!canStartRound" @click="startRound">▶️ بدء الجولة</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 المسجلون: <span>{{ registeredPlayers.length }}</span></button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ كلمة الانضمام: ${getJoinWord()}` }}</button>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">🔴 ربط بث تيك توك لايف</label>
      <div class="join-settings-row" style="margin-top:0;">
        <input v-model="joinWordInput" type="text" placeholder="كلمة الانضمام (افتراضياً: انضم)" :disabled="joinViaGift">
        <label class="join-gift-toggle" for="joinViaGiftCheckboxModal">
          <input id="joinViaGiftCheckboxModal" v-model="joinViaGift" type="checkbox">
          🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
        </label>
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div class="field-hint" v-html="joinModeHint"></div>
      <div class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
        <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ registeredPlayers.length }})</h3>
      <div class="players-modal-add-row">
        <input
          v-model="manualPlayerName"
          type="text"
          placeholder="أضف لاعباً يدوياً بالاسم"
          maxlength="30"
          @keydown.enter.prevent="addManualPlayer"
        >
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addManualPlayer">➕ إضافة</button>
      </div>
      <div v-if="registeredPlayers.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="u in registeredPlayers" :key="u" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="getUserAvatar(u)" :src="getUserAvatar(u)" class="player-avatar" alt="">{{ u }}</span>
          <button type="button" class="players-modal-remove-btn" @click="unregisterViewer(u)">🗑️ حذف</button>
        </div>
      </div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
    </div>
  </div>

  <div v-if="roundActive && currentPlayer" class="announcement-banner" :style="{ background: currentPlayer.color }">
    🎯 دور: {{ currentPlayer.name }} — أرسل رقمين بالدردشة مثل "3 19" لفتح تلك البطاقتين
  </div>
  <div v-else-if="!roundActive && board.length === 0" class="announcement-banner neutral">
    في انتظار بدء الجولة القادمة...
  </div>

  <div v-if="roundPlayers.length" class="leaderboard-row">
    <div
      v-for="(p, i) in roundPlayers"
      :key="p.username"
      class="leaderboard-chip"
      :class="{ active: i === currentPlayerIndex }"
      :style="{ borderColor: p.color, boxShadow: i === currentPlayerIndex ? `0 0 15px ${p.color}` : 'none' }"
    >
      <span class="lb-name" :style="{ color: p.color }"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
      <span class="lb-score">{{ p.score }}</span>
    </div>
  </div>

  <div v-if="board.length" class="game-panel">
    <div class="board" :style="{ gridTemplateColumns: `repeat(${boardColumns}, 1fr)` }">
      <div
        v-for="(card, i) in board"
        :key="i"
        class="memory-card"
        :class="{ flipped: card.flipped || card.claimedBy }"
        @click="onCardClick(i)"
      >
        <div class="card-face card-front">{{ card.index }}</div>
        <div
          class="card-face card-back"
          :class="{ claimed: !!card.claimedBy }"
          :style="card.claimedBy ? { background: getPlayerByUsername(card.claimedBy)?.color, borderColor: getPlayerByUsername(card.claimedBy)?.color } : {}"
        >{{ card.backText }}</div>
      </div>
    </div>

    <div class="manual-open-row">
      <span class="field-hint" style="margin:0;">فتح يدوي (اختباري):</span>
      <input v-model="manualNum1" type="number" min="1" :max="board.length" placeholder="رقم 1" style="width:80px;">
      <input v-model="manualNum2" type="number" min="1" :max="board.length" placeholder="رقم 2" style="width:80px;">
      <button class="master-btn" style="padding:6px 14px; font-size:0.85rem; margin:0;" @click="manualOpen">فتح</button>
    </div>
  </div>

  <div v-if="logItems.length" class="log-panel">
    <h3>📜 سجل الأحداث</h3>
    <div>
      <div v-for="(item, i) in logItems" :key="i" class="log-item" :class="item.cls">{{ item.text }}</div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: var(--primary-color);">956br@</strong></span>
  </div>

  <div v-if="winnerModalVisible" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <div class="trophy">🏆</div>
      <h2>انتهت الجولة!</h2>
      <div class="final-scores">
        <div v-for="p in winnerListSorted" :key="p.username" class="final-score-row" :class="{ winner: p.isWinner }">
          <span :style="{ color: p.color }"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.isWinner ? '👑 ' : '' }}{{ p.name }}</span>
          <span>{{ p.score }} نقطة</span>
        </div>
      </div>
      <button class="master-btn" style="width:100%;" @click="startNewRound">🔄 جولة جديدة</button>
    </div>
  </div>

  <div v-if="rulesVisible" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>📖 دليل الذاكرة</h2>
      <ul class="rules-list">
        <li>🎯 <b>التسجيل:</b> يفتح المستضيف باب التسجيل، ويكتب المشاهدون كلمة الانضمام (أو يرسلون هدية) لينضموا لقائمة المرشحين.</li>
        <li>⚙️ <b>الإعداد:</b> يحدد المستضيف عدد اللاعبين وعدد النقاط (الأزواج) — عدد البطاقات = النقاط × 2 — ثم يختار اللاعبين المشاركين من المسجلين.</li>
        <li>🔁 <b>الأدوار:</b> دور واحد نشط في كل مرة. صاحب الدور فقط يرسل بالدردشة رقمين مثل <b>"3 19"</b> لفتح البطاقتين رقم 3 و19.</li>
        <li>✅ <b>عند التطابق:</b> يكسب اللاعب نقطة ويستمر دوره ليحاول مرة أخرى.</li>
        <li>❌ <b>عند عدم التطابق:</b> تُغلق البطاقتان وينتقل الدور للاعب التالي.</li>
        <li>⏱️ <b>وقت الدور:</b> إذا حدده المستضيف، ينتقل الدور تلقائياً إذا لم يصل رقمان صحيحان في الوقت المحدد.</li>
        <li>🏁 <b>النهاية:</b> تنتهي الجولة عند اكتشاف كل الأزواج، ويفوز صاحب أعلى نقاط (أو يتعادل عدة لاعبين).</li>
      </ul>
      <button class="back-to-game-btn master-btn" @click="toggleRules(false)">↩️ العودة إلى اللعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 20px; }
h1 { font-size: 2.3rem; text-align: center; }
.subtitle { font-size: 1.1rem; margin-bottom: 20px; text-align: center; }

.top-names-section {
  width: 100%;
  max-width: 800px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 15px 20px;
  margin-bottom: 20px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.top-names-section > label {
  display: block;
  margin-bottom: 12px;
  font-size: 1.05rem;
  color: #ecf0f1;
  font-weight: bold;
}

.setup-grid {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.setup-field { flex: 1; min-width: 160px; }
.setup-field label { display: block; font-size: 0.85rem; color: #bdc3c7; margin-bottom: 5px; }

.setup-field-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.setup-field-checkbox .join-gift-toggle { margin: 0; white-space: nowrap; }
.setup-field-checkbox .inline-number { width: 110px; flex: none; }

.setup-field select,
.setup-field input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 9px 10px;
  font-size: 0.95rem;
  outline: none;
}

input, select {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
  outline: none;
}

input:focus, select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

input:disabled, button:disabled { opacity: 0.5; cursor: not-allowed; }

.field-hint { font-size: 0.8rem; color: #8b93a3; margin-top: 6px; }

.join-settings-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}

.join-settings-row input[type="text"] { flex: 1; min-width: 140px; }

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  color: #ecf0f1;
  font-weight: normal;
  cursor: pointer;
}

.join-gift-toggle input[type="checkbox"] {
  width: auto;
  accent-color: var(--primary-color);
  cursor: pointer;
}

.gift-filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input,
.gift-filter-row select { flex: 1; min-width: 140px; }
.gift-filter-row input[type="number"] { flex: none; width: 170px; }

.registration-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row input[type="number"] { width: 90px; flex: none; }
.registration-status { font-weight: bold; color: #f1c40f; }

.chips-row { display: flex; flex-wrap: wrap; gap: 8px; }

.player-picker {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.pick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pick-chip input { width: auto; margin: 0; }
.pick-chip.picked { background: rgba(39, 174, 96, 0.25); border-color: var(--success-color); color: #fff; }

.master-controls {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 15px;
  width: 100%;
}

.announcement-banner {
  width: 100%;
  max-width: 700px;
  padding: 14px 20px;
  border-radius: 12px;
  text-align: center;
  font-weight: bold;
  font-size: 1.15rem;
  margin: 0 auto 20px auto;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.4);
  transition: background 0.3s ease;
  color: #fff;
}
.announcement-banner.neutral {
  background: rgba(255, 255, 255, 0.06);
  border: 1px dashed var(--border-glow);
  color: #bdc3c7;
  font-size: 1.05rem;
}

.timer-chip {
  font-size: 1rem;
  color: #f1c40f;
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(241, 196, 15, 0.4);
  font-weight: bold;
}
.timer-chip.urgent { color: #ff4757; border-color: #ff4757; }

.leaderboard-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
  max-width: 800px;
  margin-bottom: 20px;
}

.leaderboard-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--panel-bg);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 8px 16px;
  min-width: 90px;
  transition: all 0.3s ease;
}
.leaderboard-chip.active { transform: translateY(-4px) scale(1.06); }
.lb-name { font-weight: bold; font-size: 0.9rem; }
.lb-score { font-size: 1.4rem; font-weight: bold; color: #ecf0f1; }

.game-panel {
  width: 100%;
  max-width: 800px;
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.board {
  display: grid;
  gap: 10px;
  width: 100%;
  perspective: 1000px;
  margin: 5px 0 15px 0;
}

.memory-card {
  position: relative;
  aspect-ratio: 1 / 1;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.4, 0.2, 0.2, 1);
  cursor: pointer;
}
.memory-card.flipped { transform: rotateY(180deg); cursor: default; }

.card-face {
  width: 100%;
  height: 100%;
  position: absolute;
  backface-visibility: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 10px;
  font-weight: bold;
  overflow: hidden;
  text-align: center;
  padding: 2px;
}

.card-front {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  font-size: 1.3rem;
}

.memory-card:not(.flipped):hover .card-front {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.1);
}

.card-back {
  background: linear-gradient(135deg, #2c3e50, #34495e);
  transform: rotateY(180deg);
  border: 2px solid var(--border-glow);
  font-size: 1.6rem;
}

.card-back.claimed {
  font-size: 0.72rem;
  font-weight: bold;
  line-height: 1.15;
  word-wrap: break-word;
  color: #fff;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.5);
}

.manual-open-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 15px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  width: 100%;
  justify-content: center;
}
.manual-open-row input { width: auto; }

.log-panel {
  width: 100%;
  max-width: 800px;
  margin-top: 15px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 12px;
  padding: 12px 15px;
  max-height: 180px;
  overflow-y: auto;
}
.log-panel h3 { font-size: 0.95rem; color: var(--primary-color); margin-bottom: 8px; }
.log-item { font-size: 0.85rem; padding: 6px 10px; border-radius: 6px; background: #1e1e2f; margin-bottom: 6px; line-height: 1.5; }
.log-item.match { border-right: 4px solid var(--success-color); }
.log-item.miss { border-right: 4px solid var(--danger-color); }
.log-item.system { border-right: 4px solid var(--primary-color); color: #f1c40f; }

.modal-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.82);
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 15px;
}
.modal-content {
  background: #2a2a40;
  padding: 28px 22px;
  border-radius: 16px;
  width: 100%;
  max-width: 400px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
  border: 1px solid var(--primary-color);
  max-height: 85vh;
  overflow-y: auto;
}
.modal-content .trophy { font-size: 3rem; margin-bottom: 10px; }
.modal-content h2 { color: var(--primary-color); font-size: 1.5rem; margin-bottom: 15px; }

.final-scores { margin: 15px 0; display: flex; flex-direction: column; gap: 8px; }
.final-score-row {
  display: flex;
  justify-content: space-between;
  background: #1e1e2f;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.95rem;
}
.final-score-row.winner {
  border: 1px solid var(--primary-color);
  background: rgba(243, 156, 18, 0.15);
  font-weight: bold;
}

.rules-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: var(--bg-gradient);
  flex-direction: column;
  align-items: center;
  z-index: 250;
  padding: 20px 15px;
  overflow-y: auto;
}
.rules-box {
  width: 100%;
  max-width: 500px;
  background: var(--panel-bg);
  border: 1px solid var(--border-glow);
  border-radius: 16px;
  padding: 22px;
  backdrop-filter: blur(10px);
}
.rules-box h2 { color: var(--primary-color); text-align: center; margin-bottom: 15px; font-size: 1.4rem; }
.rules-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.rules-list li {
  background: #1e1e2f;
  padding: 10px 12px;
  border-radius: 8px;
  border-right: 4px solid var(--primary-color);
  font-size: 0.92rem;
  line-height: 1.6;
}
.back-to-game-btn { display: block; width: 100%; max-width: 500px; margin: 18px auto 0; text-align: center; }

@media (max-width: 768px) {
  h1 { font-size: 1.9rem; }
  .card-back { font-size: 1.2rem; }
  .card-front { font-size: 1rem; }
}

@media (max-width: 420px) {
  .card-back.claimed { font-size: 0.6rem; }
}
</style>
