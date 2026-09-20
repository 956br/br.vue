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
const SCORES_KEY = 'hideoutRevealGame_scores';

const LEVELS = Array.from({ length: 7 }, (_, i) => {
  const size = i + 3;
  return { id: `l${size}`, label: `${size}×${size}\nالنقاط ${size}`, size };
});

function levelSize(id) { return (LEVELS.find((l) => l.id === id) || LEVELS[0]).size; }

const MAX_VISIBLE_GUESSERS = 4;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

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

// ===== قائمة اللاعبين المسبقة (يضيفها المستضيف قبل الجولة لتسهيل التسجيل اليدوي) =====
const PLAYERS_LIST_KEY = 'hideoutRevealGame_playersList';
function loadPlayersList() {
  try {
    const data = localStorage.getItem(PLAYERS_LIST_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string') : [];
  } catch (e) { return []; }
}
const registeredPlayers = reactive(loadPlayersList());
function savePlayersList() {
  try { localStorage.setItem(PLAYERS_LIST_KEY, JSON.stringify(registeredPlayers)); } catch (e) { /* noop */ }
}
function addPlayerName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || registeredPlayers.includes(trimmed)) return false;
  registeredPlayers.push(trimmed);
  savePlayersList();
  return true;
}
const newPlayerNameInput = ref('');
function addRegisteredPlayer() {
  addPlayerName(newPlayerNameInput.value);
  newPlayerNameInput.value = '';
}
function removeRegisteredPlayer(name) {
  const idx = registeredPlayers.indexOf(name);
  if (idx !== -1) registeredPlayers.splice(idx, 1);
  savePlayersList();
}
function addPlayerFromTikTok(name) {
  addPlayerName(name);
}
const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

// ===== حالة اللعبة =====
const hostNameInput = ref('');
const gridLevel = ref('l3');
const secretInput = ref('');
const hideError = ref('');

const gamePhase = ref('idle'); // idle | hiding | guessing | revealed
const secretNumber = ref(null);
const roundGridSize = ref(3);
const roundNumber = ref(0);
const winnersThisRound = reactive([]);
const eventLog = ref([]);

const manualNameInput = ref('');
const manualGuessInput = ref('');

// ===== نظام التسجيل (عداد التخمين) — نفس فكرة نظام تسجيل عجلة الحظ =====
const roundDurationInput = ref(25);
const extendSecondsInput = ref(10);
const roundTimeLeft = ref(0);
const guessesByUser = reactive(new Map()); // username -> رقم المربع المختار

const settingsDisabled = computed(() => gamePhase.value === 'hiding' || gamePhase.value === 'guessing');
const secretMax = computed(() => levelSize(gridLevel.value) ** 2);
const cellsArray = computed(() => Array.from({ length: roundGridSize.value ** 2 }, (_, i) => i + 1));
const displayHostName = computed(() => hostNameInput.value.trim() || 'المستضيف');
const cellNamesMap = computed(() => {
  const map = {};
  guessesByUser.forEach((cell, user) => {
    if (!map[cell]) map[cell] = [];
    map[cell].push(user);
  });
  return map;
});

function setLevel(id) {
  if (settingsDisabled.value) return;
  gridLevel.value = id;
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

let hidingTimeout = null;
let roundTimer = null;

function stopRoundTimer() {
  if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
}

function startRoundTimer() {
  stopRoundTimer();
  roundTimer = setInterval(() => {
    roundTimeLeft.value--;
    if (roundTimeLeft.value <= 0) {
      stopRoundTimer();
      revealNow();
    }
  }, 1000);
}

function extendRound() {
  if (gamePhase.value !== 'guessing') return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 10;
  roundTimeLeft.value += add;
}

function padSecretInput() {
  const raw = normalizeDigits(secretInput.value).replace(/\D/g, '');
  if (raw.length === 1) secretInput.value = `0${raw}`;
}

function startHiding() {
  if (settingsDisabled.value) return;
  padSecretInput();
  const raw = normalizeDigits(secretInput.value).replace(/\D/g, '');
  const num = parseInt(raw, 10);
  const max = secretMax.value;

  if (!raw || Number.isNaN(num) || num < 1 || num > max) {
    hideError.value = `أدخل رقم اختباء صحيح بين 1 و${max}`;
    return;
  }

  let dur = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 25;
  if (dur > 600) dur = 600;
  roundDurationInput.value = dur;

  hideError.value = '';
  roundNumber.value++;
  secretNumber.value = num;
  roundGridSize.value = levelSize(gridLevel.value);
  winnersThisRound.length = 0;
  guessesByUser.clear();
  secretInput.value = '';
  gamePhase.value = 'hiding';

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🌑 الجولة ${roundNumber.value}: اختبأ <b>${escapeHtml(displayHostName.value)}</b> داخل شبكة ${roundGridSize.value}×${roundGridSize.value}</div>`);

  if (hidingTimeout) clearTimeout(hidingTimeout);
  hidingTimeout = setTimeout(() => {
    if (gamePhase.value === 'hiding') {
      gamePhase.value = 'guessing';
      roundTimeLeft.value = dur;
      startRoundTimer();
    }
    hidingTimeout = null;
  }, 900);
}

function registerGuess(username, cellNum) {
  if (gamePhase.value !== 'guessing' || !username) return;
  if (!Number.isInteger(cellNum) || cellNum < 1 || cellNum > cellsArray.value.length) return;
  guessesByUser.set(username, cellNum);
}

function registerGuessFromComment(username, rawText) {
  if (gamePhase.value !== 'guessing' || !username || rawText === undefined || rawText === null) return;
  const normalized = normalizeDigits(String(rawText));
  const tokens = normalized.match(/\d+/g) || [];
  const total = cellsArray.value.length;
  const validToken = tokens.find((t) => { const n = parseInt(t, 10); return n >= 1 && n <= total; });
  if (validToken === undefined) return;
  registerGuess(username, parseInt(validToken, 10));
}

function manualGuess() {
  if (gamePhase.value !== 'guessing') return;
  const name = manualNameInput.value.trim();
  const guess = manualGuessInput.value.trim();
  if (name === '' || guess === '') return;
  registerGuessFromComment(name, guess);
  manualGuessInput.value = '';
}

function revealNow() {
  if (gamePhase.value !== 'guessing') return;
  stopRoundTimer();
  gamePhase.value = 'revealed';

  const pointsAwarded = roundGridSize.value;
  winnersThisRound.length = 0;
  guessesByUser.forEach((cell, user) => {
    if (cell === secretNumber.value) {
      winnersThisRound.push({ user });
      const player = getOrCreatePlayer(user);
      player.score += pointsAwarded;
    }
  });
  saveScores();

  if (winnersThisRound.length > 0) {
    const names = winnersThisRound.map((w) => escapeHtml(w.user)).join('، ');
    appendLog(`<div class="log-item" style="text-align:center; color:#f39c12;">💡 انكشف المخبأ في المربع رقم ${secretNumber.value}! الفائزون (${pointsAwarded} نقطة لكل واحد): ${names}</div>`);
  } else {
    appendLog(`<div class="log-item" style="text-align:center; color:#8b93a3;">💡 انكشف المخبأ في المربع رقم ${secretNumber.value} — ولم يخمّن أحد الرقم هذه الجولة</div>`);
  }
}

function nextRound() {
  gamePhase.value = 'idle';
  secretNumber.value = null;
  guessesByUser.clear();
  winnersThisRound.length = 0;
}

const statusText = computed(() => {
  if (gamePhase.value === 'idle') return 'أدخل رقم الاختباء واضغط "اختباء وبدء الجولة" لبدء الجولة';
  if (gamePhase.value === 'hiding') return `🌑 ${displayHostName.value} يختبئ في الظلام...`;
  if (gamePhase.value === 'guessing') return `💡 الشبكة مضاءة! اكتب رقم المربع الذي تعتقد أن المستضيف مختبئ فيه — النتيجة لن تُعرف إلا بعد انتهاء الوقت`;
  if (winnersThisRound.length > 0) return `🎉 انكشف المخبأ! فاز ${winnersThisRound.length} من الجمهور بـ ${roundGridSize.value} نقطة لكل واحد`;
  return '🔦 انكشف المخبأ ولم يخمّن أحد الرقم الصحيح هذه الجولة';
});

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() { showModal_.value = false; }

function endAndResetGame() {
  endGame();
  resetGame();
}

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
  if (hidingTimeout) { clearTimeout(hidingTimeout); hidingTimeout = null; }
  stopRoundTimer();
  playersScores.clear();
  saveScores();
  gamePhase.value = 'idle';
  secretNumber.value = null;
  secretInput.value = '';
  hideError.value = '';
  roundNumber.value = 0;
  roundTimeLeft.value = 0;
  winnersThisRound.length = 0;
  guessesByUser.clear();
  eventLog.value = [];
}

const showRulesOverlay = ref(false);
const barExpanded = ref(true);

const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

function goHome() { router.push('/'); }

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
const joinWordInput = ref('بلعب');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

function getJoinWord() { return joinWordInput.value.trim() || 'بلعب'; }
const joinModeHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية ينضم تلقائياً لقائمة اللاعبين.'
  : `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم لقائمة اللاعبين.`));
const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً لقائمة اللاعبين، ومن يكتب رقم المربع أثناء الجولة يشارك بالتخمين'
  : `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً لقائمة اللاعبين، ومن يكتب رقم المربع أثناء الجولة يشارك بالتخمين`));

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const regExtendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية. أي انضمام عبر الدردشة/الهدايا يُضاف الآن لقائمة اللاعبين.`
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
  let add = parseInt(regExtendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
}
function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
}

function handleTiktokMessage(data) {
  if (data.comment && data.user) {
    if (registrationOpen.value && !joinViaGift.value && normalizeDigits(data.comment).trim() === getJoinWord()) {
      addPlayerFromTikTok(data.user);
    }
    registerGuessFromComment(data.user, data.comment);
  }

  if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
    && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
    addPlayerFromTikTok(getGiftUser(data));
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'dark-room', onMessage: handleTiktokMessage });
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (showRulesOverlay.value || showModal_.value) return;
    if (gamePhase.value === 'idle') startHiding();
    else if (gamePhase.value === 'guessing') revealNow();
    else if (gamePhase.value === 'revealed') nextRound();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (hidingTimeout) clearTimeout(hidingTimeout);
  stopRoundTimer();
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🌑 كشف المخبأ</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" style="background:#8A1538;" @click="endAndResetGame">🏁 إنهاء اللعبة وعرض النتائج</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="top-names-section">
    <label for="hostNameInput">👤 اسم المستضيف (يظهر بالمنتصف قبل الاختباء):</label>
    <input id="hostNameInput" v-model="hostNameInput" type="text" placeholder="مثال: محمد" :disabled="settingsDisabled">
  </div>

  <div class="top-names-section">
    <label>🧩 مستوى الشبكة:</label>
    <div class="type-toggle-row">
      <button
        v-for="lv in LEVELS"
        :key="lv.id"
        class="type-btn"
        :class="{ active: gridLevel === lv.id }"
        :disabled="settingsDisabled"
        @click="setLevel(lv.id)"
      >{{ lv.label }}</button>
    </div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة تسجيل التخمينات بالثواني:</label>
    <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="5" max="600" :disabled="settingsDisabled">
    <div class="field-hint">لن تظهر نتيجة أي تخمين خلال هذه المدة — يظهر اسم كل شخص داخل المربع الذي اختاره فقط، وتُكشف أسماء الفائزين تلقائياً عند انتهاء الوقت</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 قائمة اللاعبين: <span>{{ registeredPlayers.length }}</span></button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ رمز الانضمام: ${getJoinWord()}` }}</button>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
    <div v-if="gamePhase === 'idle'" class="floating-secret-group">
      <input
        id="secretInput"
        v-model="secretInput"
        type="password"
        inputmode="numeric"
        maxlength="2"
        placeholder="🔒 رقم الاختباء"
        aria-label="رقم الاختباء"
        :disabled="settingsDisabled"
        @blur="padSecretInput"
        @keydown.enter.prevent="startHiding"
      >
      <div v-if="hideError" class="floating-error">{{ hideError }}</div>
    </div>
    <button v-if="gamePhase === 'idle'" class="master-btn side-panel-btn" @click="startHiding">🕶️ اختباء وبدء الجولة</button>
    <button v-if="gamePhase === 'guessing'" class="master-btn side-panel-btn" style="background:#3498db;" @click="revealNow">💡 كشف المخبأ الآن</button>
    <button v-if="gamePhase === 'revealed'" class="master-btn side-panel-btn" @click="nextRound">➡️ جولة جديدة</button>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 قائمة اللاعبين ({{ registeredPlayers.length }})</h3>
      <div class="players-modal-add-row">
        <input v-model="newPlayerNameInput" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="addRegisteredPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addRegisteredPlayer">➕ إضافة</button>
      </div>
      <div v-if="registeredPlayers.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون مسجّلون بعد — القائمة اختيارية وتُستخدم لتسهيل التسجيل اليدوي فقط.</div>
      <div v-else class="players-modal-list">
        <div v-for="name in registeredPlayers" :key="name" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="getUserAvatar(name)" :src="getUserAvatar(name)" class="player-avatar" alt="">{{ name }}</span>
          <button type="button" class="players-modal-remove-btn" @click="removeRegisteredPlayer(name)">🗑️ حذف</button>
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
        <input v-if="registrationOpen" v-model="regExtendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🎥 شاشة العرض للجمهور</h2>
      <div class="dark-stage">
        <Transition name="name-fade">
          <div v-if="gamePhase === 'idle'" class="host-name-display">
            <div class="host-avatar">🕵️</div>
            <div class="host-name-text">{{ displayHostName }}</div>
          </div>
        </Transition>

        <div v-if="gamePhase === 'hiding'" class="darkness-fill">🌑</div>

        <div v-if="gamePhase === 'guessing'" class="host-controls-bar">
          <div class="stage-timer" :class="{ urgent: roundTimeLeft <= 5 }">⏱️ {{ roundTimeLeft }} ثانية</div>
          <div class="extend-inline">
            <input v-model="extendSecondsInput" type="number" min="1" style="width:70px;">
            <button type="button" class="rules-btn" style="margin:0; padding:8px 14px; font-size:0.85rem;" @click="extendRound">⏱️ تمديد</button>
          </div>
        </div>

        <Transition name="grid-light">
          <div
            v-if="gamePhase === 'guessing' || gamePhase === 'revealed'"
            class="dark-grid"
            :style="{ gridTemplateColumns: `repeat(${roundGridSize}, 1fr)` }"
          >
            <div
              v-for="n in cellsArray"
              :key="n"
              class="grid-cell"
              :class="{ 'cell-lit': gamePhase === 'revealed' && n === secretNumber }"
            >
              <div class="cell-number">{{ n }}</div>
              <Transition name="cell-pop">
                <div v-if="gamePhase === 'revealed' && n === secretNumber" class="cell-host-name">🕵️ {{ displayHostName }}</div>
              </Transition>
              <div v-if="cellNamesMap[n] && cellNamesMap[n].length" class="cell-guessers">
                <span v-for="(name, gi) in cellNamesMap[n].slice(0, MAX_VISIBLE_GUESSERS)" :key="gi" class="guesser-chip">{{ name }}</span>
                <span v-if="cellNamesMap[n].length > MAX_VISIBLE_GUESSERS" class="guesser-chip guesser-more">+{{ cellNamesMap[n].length - MAX_VISIBLE_GUESSERS }}</span>
              </div>
            </div>
          </div>
        </Transition>

        <div class="stage-status-line">{{ statusText }}</div>

        <div v-if="winnersThisRound.length" class="winners-mini-list">
          <span v-for="(w, i) in winnersThisRound" :key="i" class="winner-mini-chip">✅ {{ w.user }}</span>
        </div>
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

    <div v-if="gamePhase === 'guessing'" class="panel">
      <h3>✍️ محاولة يدوية (اختبار بدون تيك توك)</h3>
      <div v-if="registeredPlayers.length" class="chips-row" style="margin-bottom:10px;">
        <span
          v-for="name in registeredPlayers"
          :key="name"
          class="player-chip player-chip-select"
          :class="{ 'chip-active': manualNameInput === name }"
          @click="manualNameInput = name"
        >{{ name }}</span>
      </div>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualGuessInput" type="text" placeholder="رقم المربع الذي يختاره" @keydown.enter.prevent="manualGuess">
        <button class="master-btn" @click="manualGuess">تسجيل الاختيار</button>
      </div>
      <div class="field-hint">يظهر اسم اللاعب داخل المربع مباشرة، بدون كشف إن كان صحيحاً أو خاطئاً حتى انتهاء الوقت — ويقدر يغيّر اختياره بإرسال رقم آخر قبل انتهاء الجولة</div>
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
      <h2>قوانين لعبة كشف المخبأ 🌑</h2>
      <ul class="rules-list">
        <li><b>الاختباء:</b> يختار المستضيف مستوى الشبكة (3×3 أو 4×4 أو 5×5) ويكتب رقم اختباء سري بين 1 وعدد مربعات الشبكة، ثم يضغط "اختباء وبدء الجولة"</li>
        <li>لا يظهر رقم الاختباء على الشاشة إطلاقاً — يبقى مخفياً مثل كلمة المرور، ويعرفه المستضيف فقط</li>
        <li>بمجرد بدء الجولة يختفي اسم المستضيف في الظلام، ثم يُضاء المشهد لتظهر الشبكة المرقمة للجمهور</li>
        <li><b>التسجيل:</b> بمجرد إضاءة الشبكة يبدأ عداد تسجيل التخمينات بالمدة التي يحددها المستضيف، ويمكن تمديدها أثناء الجولة</li>
        <li>يكتب كل مشاهد رقم المربع الذي يعتقد أن المستضيف مختبئ فيه بتعليق في الدردشة، بدون حاجة لتسجيل مسبق — ويظهر اسمه فوراً داخل المربع الذي اختاره فقط، دون كشف إن كان صحيحاً أو خاطئاً</li>
        <li>يقدر أي شخص يغيّر اختياره بكتابة رقم مربع آخر قبل انتهاء الوقت — وآخر رقم يكتبه هو المعتمد، وينتقل اسمه فوراً للمربع الجديد</li>
        <li>لا تظهر أي نتيجة (صح أو خطأ) لأي أحد قبل انتهاء وقت الجولة</li>
        <li><b>الكشف:</b> عند انتهاء العداد (أو عند ضغط المستضيف "كشف المخبأ الآن" لإنهائها مبكراً) يُضاء المربع الصحيح ويظهر اسم المستضيف بداخله، وتُعلن أسماء كل من اختار نفس المربع كفائزين</li>
        <li><b>النقاط:</b> كل فائز يأخذ نقاطاً تساوي حجم الشبكة (سهل = 3، متوسط = 4، صعب = 5) — كلما كانت الشبكة أصعب زادت مكافأة التخمين الصحيح</li>
        <li>بعدها يضغط المستضيف "جولة جديدة" لإدخال رقم اختباء آخر، أو "إنهاء اللعبة وعرض النتائج" لعرض لوحة الصدارة النهائية ثم تصفير كل شي استعداداً للعبة جديدة</li>
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

input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 1rem;
  outline: none;
}

input:disabled, button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
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
  border: 2px solid rgba(255, 255, 255, 0.15);
  color: #ecf0f1;
  padding: 10px;
  border-radius: 10px;
  font-weight: bold;
  cursor: pointer;
  font-size: 0.95rem;
  white-space: pre-line;
  line-height: 1.5;
}

.type-btn.active {
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

.floating-action-bar {
  position: fixed;
  bottom: 25px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 12px;
}

.floating-action-bar .master-btn {
  box-shadow: 0 6px 25px rgba(0, 0, 0, 0.5);
  margin: 0;
  white-space: nowrap;
}

.floating-secret-group {
  position: relative;
}

.floating-secret-group input {
  width: 130px;
  margin: 0;
  padding: 12px 10px;
  text-align: center;
  letter-spacing: 4px;
  box-shadow: 0 6px 25px rgba(0, 0, 0, 0.5);
}

.floating-error {
  position: absolute;
  top: -26px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 0.72rem;
  color: #ff6b6b;
  background: rgba(0, 0, 0, 0.7);
  padding: 3px 8px;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .floating-action-bar {
    bottom: 15px;
    gap: 8px;
  }
  .floating-action-bar .master-btn {
    font-size: 0.95rem;
    padding: 10px 16px;
  }
  .floating-secret-group input {
    width: 100px;
    padding: 10px 6px;
    font-size: 0.9rem;
  }
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

/* ===== شاشة العرض المظلمة ===== */
.dark-stage {
  position: relative;
  width: 100%;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, #14141f 0%, #050508 75%);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 20px 12px;
  gap: 14px;
}

.host-name-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.host-avatar {
  font-size: 3.2rem;
  filter: drop-shadow(0 0 18px var(--border-glow));
  animation: hostPulse 2.4s ease-in-out infinite;
}

@keyframes hostPulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}

.host-name-text {
  font-size: 1.8rem;
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 20px var(--border-glow);
}

.darkness-fill {
  width: 100%;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  opacity: 0.5;
  animation: darknessPulse 0.9s ease-in-out;
}

@keyframes darknessPulse {
  0% { opacity: 0; }
  50% { opacity: 0.6; }
  100% { opacity: 0.3; }
}

.host-controls-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.stage-timer {
  font-size: 1.3rem;
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 12px var(--border-glow);
}

.stage-timer.urgent { color: #ff4757; }

.extend-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.extend-inline input {
  padding: 8px;
  font-size: 0.9rem;
  text-align: center;
}

.dark-grid {
  display: grid;
  gap: 10px;
  width: 100%;
  max-width: 420px;
}

.grid-cell {
  position: relative;
  min-height: 66px;
  max-height: 140px;
  background: #1a1a28;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 3px;
  padding: 8px 4px;
  font-weight: bold;
  font-size: 1.1rem;
  color: #7d8496;
  overflow: hidden;
  transition: border-color 0.3s, box-shadow 0.3s, background 0.3s;
}

.grid-cell.cell-lit {
  background: radial-gradient(circle, #4a3a10, #1a1a28);
  border-color: var(--primary-color);
  box-shadow: 0 0 25px var(--border-glow), inset 0 0 15px rgba(243, 156, 18, 0.4);
}

.cell-number { position: relative; z-index: 1; }

.cell-host-name {
  text-align: center;
  font-size: 0.78rem;
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 10px var(--border-glow);
}

.cell-guessers {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
}

.guesser-chip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 1px 6px;
  font-size: 0.62rem;
  font-weight: normal;
  color: #ccd6e0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guesser-chip.guesser-more {
  background: rgba(243, 156, 18, 0.18);
  border-color: var(--border-glow);
  color: var(--primary-color);
  font-weight: bold;
}

.stage-status-line {
  text-align: center;
  font-size: 0.98rem;
  color: #ccd6e0;
  min-height: 1.3em;
}

.winners-mini-list { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.winner-mini-chip {
  background: rgba(39, 174, 96, 0.2);
  border: 1px solid var(--success-color);
  color: #fff;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85rem;
}

.scoreboard-title {
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
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

.chips-row { display: flex; flex-wrap: wrap; gap: 6px; }

.player-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #1e1e2f;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 0.82rem;
  color: #ecf0f1;
}

.player-chip-select {
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.player-chip-select:hover {
  border-color: var(--primary-color);
}

.player-chip-select.chip-active {
  background: var(--primary-color);
  color: #1e1e2f;
  border-color: #fff;
  font-weight: bold;
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
  background: rgba(0, 0, 0, 0.8);
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
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.15rem; }
.modal-logs { text-align: right; margin: 15px 0; font-size: 0.88rem; line-height: 1.5; display: flex; flex-direction: column; gap: 6px; }
.modal-logs :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; }

/* ===== انتقالات ديناميكية ===== */
.name-fade-enter-active, .name-fade-leave-active {
  transition: opacity 0.6s ease, filter 0.6s ease, transform 0.6s ease;
}
.name-fade-enter-from, .name-fade-leave-to {
  opacity: 0;
  filter: blur(8px);
  transform: scale(0.85);
}

.grid-light-enter-active { transition: opacity 0.7s ease, transform 0.7s ease; }
.grid-light-enter-from { opacity: 0; transform: scale(0.9); }

.cell-pop-enter-active { transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.cell-pop-enter-from { opacity: 0; transform: scale(0.4) rotate(-8deg); }
</style>
