<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, getGiftName, getGiftValue, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();

const WIN_SCORE = 5;
const LOSE_SCORE = -5;
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const STORAGE_KEY = 'diceGame_players';

// ===== حالة اللاعبين =====
function loadFromStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  return null;
}

const players = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id), 0) + 1;
const tiktokJoinedUsers = new Set();

function saveToStorage() {
  // أسماء اللاعبين لا تُحفظ بين الجلسات
}

// ===== حالة اللعبة =====
const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const roundDurationInput = ref(15);
const roundDuration = ref(15);

const isRoundActive = ref(false);
const gameFinished = ref(false);
const winners = ref([]);
const currentRound = ref(0);
let roundToken = 0;

const diceFace = ref('🎲');
const diceRolling = ref(false);
const diceCaption = ref('اضغط "بدء الجولة" لفتح باب التوقعات');
const diceResultLabel = ref('');
const rolledValue = ref(null);

const timerDisplay = ref('--');
const timerUrgent = ref(false);
let countdownTimer = null;
let rollAnimTimer = null;

const roundInputsVisible = ref(false);
const roundCards = reactive([]); // { playerId, name, selected: [] }

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتائج الجولة');
const modalLogs = ref([]);

const namesHint = computed(() => (isRoundActive.value
  ? '🔒 مقفول أثناء الجولة النشطة — سيُفتح تلقائياً بعد انتهاء الجولة.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل أثناء الجولة النشطة.'));

const controlsDisabled = computed(() => isRoundActive.value);

function playerBadgeText(p) {
  if (gameFinished.value && winners.value.some((w) => w.id === p.id)) return '🏆 فائز!';
  if (p.score <= LOSE_SCORE) return '💀';
  return `${p.score} نقطة`;
}

function updateTextareaFromPlayers() {
  namesInput.value = players.map((p) => p.name).join('\n');
}

function syncTextareaToPlayers() {
  if (isRoundActive.value) return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];

  if (names.length === 0) {
    players.splice(0, players.length);
    saveToStorage();
    return;
  }

  const newList = names.map((name) => {
    const existing = players.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name, score: 0 };
  });
  players.splice(0, players.length, ...newList);
  saveToStorage();
}

function addPlayer() {
  if (isRoundActive.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;

  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً في القائمة!`]);
    return;
  }

  players.push({ id: playerIdCounter++, name, score: 0 });
  newPlayerName.value = '';
  updateTextareaFromPlayers();
  saveToStorage();
}

function removePlayer(id) {
  if (isRoundActive.value) return;
  const idx = players.findIndex((p) => p.id === id);
  if (idx !== -1) players.splice(idx, 1);
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name) {
  if (isRoundActive.value) return;
  if (gameFinished.value) return;
  if (!name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);

  if (players.some((p) => p.name === name)) return;

  players.push({ id: playerIdCounter++, name, score: 0 });
  updateTextareaFromPlayers();
  saveToStorage();
}

// يستخرج أول رقمين مختلفين بين 1 و 6 من نص الكومنت (يقبل الأرقام بالعربي الغربي والشرقي)
function parseTwoNumbers(text) {
  const tokens = normalizeDigits(text).split(/[^1-6]+/).filter((t) => t.length > 0);
  const nums = [];
  for (const t of tokens) {
    for (const ch of t) {
      const n = Number(ch);
      if (n >= 1 && n <= 6 && !nums.includes(n)) nums.push(n);
      if (nums.length >= 2) break;
    }
    if (nums.length >= 2) break;
  }
  return nums.length === 2 ? nums : [];
}

function registerGuessFromComment(username, rawText) {
  if (!isRoundActive.value) return;
  if (!username || !rawText) return;

  const player = players.find((p) => p.name === username && p.score > LOSE_SCORE);
  if (!player) return;

  const nums = parseTwoNumbers(rawText);
  if (nums.length !== 2) return;

  const card = roundCards.find((c) => c.playerId === player.id);
  if (!card) return;

  card.selected = nums;
  card.statusText = `✅ استلمنا توقعك من الدردشة: ${nums.join(' و ')}`;
  card.statusFilled = true;
}

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 5) val = 5;
  if (val > 120) val = 120;
  roundDurationInput.value = val;
  return val;
}

async function startRound() {
  if (isRoundActive.value || gameFinished.value) return;

  const activePlayers = players.filter((p) => p.score > LOSE_SCORE);
  if (activePlayers.length < 1) {
    const joinHint = joinViaGift.value ? 'يرسلون هدية' : `يكتبون "${getJoinWord()}"`;
    openModal('تنبيه', [`تحتاج إلى لاعب واحد على الأقل نشط للبدء! أضف لاعبين أو خل المشاهدين ${joinHint}.`]);
    return;
  }

  roundDuration.value = getRoundDuration();
  roundToken++;
  currentRound.value++;

  resetDiceDisplay();
  diceCaption.value = `⏳ باب التوقعات مفتوح (${roundDuration.value} ثانية)... اكتب رقمين بالدردشة مثل "1 3"`;
  isRoundActive.value = true;

  prepareRoundInputs();
  startTimer();
}

function prepareRoundInputs() {
  roundCards.splice(0, roundCards.length);
  const activePlayers = players.filter((p) => p.score > LOSE_SCORE);
  activePlayers.forEach((p) => {
    roundCards.push({
      playerId: p.id,
      name: p.name,
      selected: [],
      statusText: '🕓 بانتظار التوقع (اكتب رقمين بالدردشة أو اختر يدوياً)',
      statusFilled: false,
    });
  });
  roundInputsVisible.value = true;
}

function toggleNumber(card, num) {
  const idx = card.selected.indexOf(num);
  if (idx !== -1) {
    card.selected.splice(idx, 1);
  } else {
    if (card.selected.length >= 2) card.selected.shift();
    card.selected.push(num);
  }

  if (card.selected.length === 2) {
    card.statusText = `✅ التوقع جاهز (يدوي): ${card.selected.join(' و ')}`;
    card.statusFilled = true;
  } else {
    card.statusText = card.selected.length === 1
      ? '🕓 اختر رقماً ثانياً...'
      : '🕓 بانتظار التوقع (اكتب رقمين بالدردشة أو اختر يدوياً)';
    card.statusFilled = false;
  }
}

function resetDiceDisplay() {
  diceFace.value = '🎲';
  diceRolling.value = false;
  timerDisplay.value = '--';
  timerUrgent.value = false;
  diceCaption.value = 'اضغط "بدء الجولة" لفتح باب التوقعات';
  diceResultLabel.value = '';
}

function startTimer() {
  let timeLeft = roundDuration.value;
  timerDisplay.value = String(timeLeft);
  timerUrgent.value = false;

  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    timeLeft--;
    timerDisplay.value = String(Math.max(timeLeft, 0));
    if (timeLeft <= 5) timerUrgent.value = true;

    if (timeLeft <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      rollDiceAndEvaluate();
    }
  }, 1000);
}

async function rollDiceAndEvaluate() {
  if (!isRoundActive.value) return;

  isRoundActive.value = false;
  const myToken = roundToken;
  diceRolling.value = true;
  diceCaption.value = '🎲 جاري رمي النرد تلقائياً...';
  diceResultLabel.value = '';

  await new Promise((resolve) => {
    let ticks = 0;
    rollAnimTimer = setInterval(() => {
      diceFace.value = DICE_FACES[Math.floor(Math.random() * 6)];
      ticks++;
      if (ticks >= 12) {
        clearInterval(rollAnimTimer);
        rollAnimTimer = null;
        resolve();
      }
    }, 100);
  });

  if (myToken !== roundToken) return;

  rolledValue.value = Math.floor(Math.random() * 6) + 1;
  diceRolling.value = false;
  diceFace.value = DICE_FACES[rolledValue.value - 1];
  diceResultLabel.value = `الرقم الفائز هو: ${rolledValue.value}`;
  diceCaption.value = 'نتيجة هذه الجولة:';

  // مهلة قصيرة عشان الرقم الفائز يبين واضح فوق النرد قبل ما تغطيه نافذة النتيجة
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (myToken !== roundToken) return;

  evaluateRound();
}

function buildScoreboardHtml() {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const items = sorted.map((p) => {
    const isWinner = gameFinished.value && winners.value.some((w) => w.id === p.id);
    const isEliminated = p.score <= LOSE_SCORE;
    const cls = `scoreboard-item${isWinner ? ' is-winner' : ''}${isEliminated ? ' is-eliminated' : ''}`;
    const badge = isWinner ? '🏆 فائز' : (isEliminated ? '💀 خرج' : `${p.score} نقطة`);
    return `<div class="${cls}"><span>${escapeHtml(p.name)}</span><span>${badge}</span></div>`;
  }).join('');
  return `<div class="scoreboard-title">📊 لوحة نقاط كل المتسابقين</div><div class="scoreboard-list">${items || '<div class="scoreboard-item">لا يوجد لاعبون بعد</div>'}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function evaluateRound() {
  const logs = [];
  logs.push(`<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:8px;">🎲 الرقم الفائز هو: ${rolledValue.value}</div>`);

  let allCorrect = true;
  let participatingCount = 0;
  const roundResults = [];

  roundCards.forEach((card) => {
    const player = players.find((p) => p.id === card.playerId);
    if (!player) return;

    if (card.selected.length !== 2) {
      logs.push(`<div class="log-item" style="color:#8b93a3;">⏳ <b>${escapeHtml(player.name)}</b> ما شارك بتوقع كامل هذه الجولة.</div>`);
      return;
    }

    participatingCount++;
    const isCorrect = card.selected.includes(rolledValue.value);
    roundResults.push({ player, isCorrect });
    if (!isCorrect) allCorrect = false;
  });

  roundResults.forEach((res) => {
    if (res.isCorrect) {
      res.player.score += 1;
      logs.push(`<div class="log-item log-hit">🎯 <b>${escapeHtml(res.player.name)}</b> جاوب صح وكسب نقطة (+1). الرصيد الآن: ${res.player.score}</div>`);
    } else {
      res.player.score -= 1;
      logs.push(`<div class="log-item log-miss">❌ <b>${escapeHtml(res.player.name)}</b> جاوب غلط وخسر نقطة (-1). الرصيد الآن: ${res.player.score}</div>`);
    }
  });

  if (allCorrect && participatingCount > 0) {
    logs.push('<div class="log-item" style="background:#27ae60; color:white; font-weight:bold; text-align:center; font-size:1rem; padding:10px;">🔥 ما شاء الله كل اللاعبين المشاركين جاوبوا صح! كل واحد منهم يكسب نقطة إضافية (+1)!</div>');
    roundResults.forEach((res) => { res.player.score += 1; });
  }

  const newlyEliminated = players.filter((p) => p.score <= LOSE_SCORE);
  newlyEliminated.forEach((p) => {
    logs.push(`<div class="log-item" style="background:#8A1538; color:white; font-weight:bold;">💀 ${escapeHtml(p.name)} وصل لـ ${LOSE_SCORE} وخرج من اللعبة!</div>`);
  });

  const newWinners = players.filter((p) => p.score >= WIN_SCORE);
  if (newWinners.length > 0) {
    gameFinished.value = true;
    winners.value = newWinners;
    const names = newWinners.map((w) => escapeHtml(w.name)).join('، ');
    logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 وصل لـ ${WIN_SCORE} نقاط وفاز باللعبة: <b>${names}</b> 🏆<br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "إعادة اللعبة" للبدء من جديد</span></div>`);
  } else {
    const remainingActive = players.filter((p) => p.score > LOSE_SCORE);
    if (players.length > 0 && remainingActive.length === 0) {
      gameFinished.value = true;
      logs.push('<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🤝 كل اللاعبين خرجوا — لا يوجد فائز! اضغط "إعادة اللعبة" لمحاولة جديدة.</div>');
    }
  }

  logs.push(buildScoreboardHtml());

  saveToStorage();
  roundInputsVisible.value = false;
  timerUrgent.value = false;
  diceCaption.value = gameFinished.value
    ? 'انتهت اللعبة — اضغط "إعادة اللعبة" للبدء من جديد'
    : 'اضغط "بدء الجولة" لفتح باب التوقعات';

  openModal('نتائج الجولة', logs);
}

function openModal(title, messagesArray) {
  modalTitle.value = title;
  modalLogs.value = messagesArray;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

function resetGame() {
  roundToken++;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (rollAnimTimer) { clearInterval(rollAnimTimer); rollAnimTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = false;
  winners.value = [];
  tiktokJoinedUsers.clear();
  stopRegistration();

  players.forEach((p) => { p.score = 0; });
  currentRound.value = 0;
  roundInputsVisible.value = false;
  saveToStorage();
  resetDiceDisplay();
}

function goHome() {
  router.push('/');
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const activeElement = document.activeElement;
    if (activeElement && ['TEXTAREA', 'SELECT', 'INPUT'].includes(activeElement.tagName)) return;
    e.preventDefault();
    if (!isRoundActive.value && !gameFinished.value) startRound();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordInput = ref('بلعب');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

let tiktokSocket = null;

function getJoinWord() {
  return joinWordInput.value.trim() || 'بلعب';
}

const joinModeHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء البث ينضم تلقائياً كلاعب. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.'
  : `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم كلاعب. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال أي هدية بدل الكتابة.`));

const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً كلاعب، وأثناء الجولة يكتب توقعه كرقمين مثل "1 3"'
  : `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب، وأثناء الجولة يكتب توقعه كرقمين مثل "1 3"`));

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
  : '🔒 التسجيل مغلق — حدد المدة واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.'));

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

function connectTikTok() {
  const username = tiktokUsername.value.trim();

  if (!username) {
    tiktokStatus.value = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokStatusColor.value = 'orange';
    return;
  }

  if (tiktokSocket) tiktokSocket.close();
  trackConnectRequest('dice', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status) {
      tiktokStatus.value = data.status;
      tiktokStatusColor.value = '#2ecc71';
    }
    if (data.error) {
      tiktokStatus.value = data.error;
      tiktokStatusColor.value = '#e74c3c';
    }
    if (data.comment) {
      const text = data.comment.trim();
      if (registrationOpen.value && !joinViaGift.value && text === getJoinWord()) {
        addPlayerFromTikTok(data.user);
      } else {
        registerGuessFromComment(data.user, text);
      }
    }
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => {
    tiktokStatus.value = '❌ صار خطأ بالاتصال';
    tiktokStatusColor.value = '#e74c3c';
  };

  tiktokSocket.onclose = () => {
    tiktokStatus.value = '🔌 تم قطع الاتصال';
    tiktokStatusColor.value = '#95a5a6';
  };
}

const barExpanded = ref(true);

const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

onMounted(() => {
  nextTick(() => resetDiceDisplay());
  document.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (rollAnimTimer) clearInterval(rollAnimTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) {
    tiktokSocket.close();
    tiktokSocket = null;
  }
});
</script>

<template>
  <h1>🎲 خمن النرد</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة كل جولة بالثواني (يحددها المستضيف):</label>
    <div class="round-time-row">
      <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="5" max="120">
      <div class="field-hint" style="margin-top:0;">بعد انتهاء هذا الوقت يُرمى النرد تلقائياً وتُحتسب النتائج.</div>
    </div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="!isRoundActive" class="master-btn side-panel-btn" id="startBtn" :disabled="gameFinished" @click="startRound">🎲 بدء الجولة (فتح التوقعات)</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ players.length }}</span></button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ رمز الانضمام: ${getJoinWord()}` }}</button>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ players.length }})</h3>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayer">➕ إضافة</button>
      </div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in players" :key="p.id" class="players-modal-item">
          <span class="players-modal-item-name">{{ p.name }}</span>
          <button type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️ حذف</button>
        </div>
      </div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
    </div>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ tiktokSectionLabel }}</label>
      <div class="join-settings-row" style="margin-top:0;">
        <label class="join-gift-toggle" for="joinViaGiftCheckboxModal">
          <input id="joinViaGiftCheckboxModal" v-model="joinViaGift" type="checkbox">
          🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
        </label>
      </div>
      <div v-if="!joinViaGift" class="join-settings-row">
        <input v-model="joinWordInput" type="text" placeholder="كلمة الانضمام (افتراضياً: بلعب)">
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div class="field-hint">{{ joinModeHint }}</div>
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

  <div class="layout-wrapper">
    <div class="panel">
      <h2>ساحة النرد</h2>
      <div class="game-arena">
        <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
        <div class="dice-wrap">
          <div class="dice-face" :class="{ rolling: diceRolling }">{{ diceFace }}</div>
        </div>
        <div class="dice-caption">{{ diceCaption }}</div>
        <div class="dice-result-label">{{ diceResultLabel }}</div>
      </div>
    </div>

    <div v-if="roundInputsVisible" class="panel">
      <h3>توقعات اللاعبين (رقمين لكل لاعب)</h3>
      <div>
        <div v-for="card in roundCards" :key="card.playerId" class="player-input-card">
          <div class="p-name">{{ card.name }}</div>
          <div class="number-boxes">
            <div
              v-for="n in 6"
              :key="n"
              class="num-box"
              :class="{ selected: card.selected.includes(n) }"
              @click="toggleNumber(card, n)"
            >{{ n }}</div>
          </div>
          <div class="guess-status" :class="{ filled: card.statusFilled }">{{ card.statusText }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون والنقاط</h3>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span>{{ p.name }} <span style="color:#ff4757; margin-right:5px;">{{ playerBadgeText(p) }}</span></span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showModal" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <h2>{{ modalTitle }}</h2>
      <div class="log-list">
        <div v-for="(log, i) in modalLogs" :key="i" v-html="log"></div>
      </div>
      <button class="master-btn" style="width:100%; padding:8px;" @click="closeModal">موافق</button>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة خمن النرد 🎲</h2>
      <ul class="rules-list">
        <li>كل لاعب يبدأ من <b>0 نقطة</b> بالضبط</li>
        <li>للانضمام من بث التيك توك: يكتب المشاهد كلمة <b>"بلعب"</b> بالدردشة فيُضاف تلقائياً كلاعب</li>
        <li>المستضيف يحدد <b>مدة كل جولة بالثواني</b> قبل الضغط على "بدء الجولة"</li>
        <li>أثناء الوقت المحدد، كل لاعب يكتب توقعه بالدردشة على شكل <b>رقمين من 1 إلى 6</b> مثل "1 3" (ويمكن أيضاً الاختيار يدوياً من الشاشة)</li>
        <li>بمجرد انتهاء الوقت، يُرمى النرد <b>تلقائياً</b> وتُحتسب النتائج بدون أي تدخل من المستضيف</li>
        <li>لا يوجد هجمات بين اللاعبين:
          <br>- الرقم ضمن توقعك → +1 نقطة
          <br>- الرقم مو ضمن توقعك → -1 نقطة
          <br>- لو الكل جاوب صح بنفس الجولة → نقطة إضافية للجميع
        </li>
        <li>أول لاعب يوصل لـ <b>5 نقاط</b> يفوز فوراً باللعبة 🏆</li>
        <li>أي لاعب يوصل لـ <b>-5 نقاط</b> يخرج من اللعبة 💀</li>
        <li>بعد كل جولة تظهر نافذة فيها نتيجة الجولة + لوحة نقاط جميع المتسابقين</li>
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

textarea { height: 70px; resize: vertical; }
textarea:focus, input:focus, select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.round-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.round-time-row input {
  width: 90px;
  text-align: center;
  flex: none;
}

.join-settings-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
}

.join-settings-row input[type="text"] {
  flex: 1;
  min-width: 140px;
}

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
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
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input,
.gift-filter-row select {
  flex: 1;
  min-width: 140px;
}

.gift-filter-row input[type="number"] {
  flex: none;
  width: 170px;
}

.registration-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row input[type="number"] {
  width: 90px;
  flex: none;
}

.registration-status { font-weight: bold; color: #f1c40f; }

.master-controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 15px;
  width: 100%;
}

.master-btn { font-size: 1.1rem; padding: 12px 25px; }

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
  max-width: 420px;
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
  font-size: 0.95rem;
  line-height: 1.6;
}

.back-to-game-btn {
  display: block;
  width: 100%;
  max-width: 420px;
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

.game-arena {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  background: rgba(0,0,0,0.2);
  border-radius: 15px;
  padding: 20px 5px;
}

.timer-display {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 15px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}

.timer-display.urgent { color: #ff4757; }

.dice-wrap {
  width: 140px;
  height: 140px;
  margin: 5px auto 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  border-radius: 22px;
  border: 2px solid rgba(255,255,255,0.15);
  box-shadow: 0 6px 18px rgba(0,0,0,0.4);
}

.dice-face {
  font-size: 90px;
  line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));
}

.dice-face.rolling {
  animation: diceShake 0.15s infinite;
}

@keyframes diceShake {
  0% { transform: rotate(-10deg) scale(1); }
  50% { transform: rotate(10deg) scale(1.08); }
  100% { transform: rotate(-10deg) scale(1); }
}

.dice-caption {
  text-align: center;
  font-size: 0.9rem;
  color: #ccd6e0;
}

.dice-result-label {
  text-align: center;
  font-size: 1.05rem;
  font-weight: bold;
  color: var(--primary-color);
  margin-top: 6px;
  min-height: 1.4em;
}

.number-boxes {
  display: flex;
  gap: 5px;
  margin-bottom: 8px;
  justify-content: center;
}

.num-box {
  width: 35px;
  height: 35px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  cursor: pointer;
  transition: 0.2s;
  user-select: none;
}

.num-box.selected {
  background: var(--primary-color);
  color: #000;
  border-color: #fff;
  box-shadow: 0 0 8px var(--primary-color);
}

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
  max-width: 350px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.2rem; }
.log-list { text-align: right; margin: 15px 0; font-size: 0.9rem; line-height: 1.5; }
.log-list :deep(.log-item) { margin-bottom: 8px; padding: 8px; border-radius: 6px; background: #1e1e2f; }
.log-list :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.log-list :deep(.log-miss) { border-right: 4px solid var(--danger-color); }

.log-list :deep(.scoreboard-title) {
  margin-top: 18px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 12px;
}

.log-list :deep(.scoreboard-list) { display: flex; flex-direction: column; gap: 6px; }

.log-list :deep(.scoreboard-item) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #1e1e2f;
  border-radius: 6px;
  font-size: 0.88rem;
}

.log-list :deep(.scoreboard-item.is-winner) { background: #f39c12; color: #1e1e2f; font-weight: bold; }
.log-list :deep(.scoreboard-item.is-eliminated) { opacity: 0.6; }

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: #1e1e2f;
  border-radius: 6px;
  margin-bottom: 5px;
  font-size: 0.95rem;
}

.player-input-card {
  background: #1e1e2f;
  padding: 10px;
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
  margin-bottom: 10px;
  width: 100%;
}

.player-input-card .p-name { font-weight: bold; margin-bottom: 5px; color: #ffa502; font-size: 0.95rem; }

.guess-status {
  font-size: 0.78rem;
  color: #8b93a3;
  margin-top: 4px;
}

.guess-status.filled { color: #2ecc71; }

.footer-note { padding: 15px; font-size: 0.85rem; }
</style>
