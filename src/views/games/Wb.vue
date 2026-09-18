<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted, nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const STORAGE_KEY = 'wheelBoxGame_players';
const WHEEL_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const masterPlayersList = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...masterPlayersList.map((p) => p.id), 0) + 1;
const joinedUsers = new Set();

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(masterPlayersList)); } catch (e) { /* noop */ }
}

const gamePhase = ref('registration'); // registration | ready | spinning | awaiting-pick | ended
const players = reactive(new Map()); // name -> { name, alive }
const boxes = reactive([]); // { index, occupantName, revealed }
const roundNumber = ref(0);
let wheelRotation = 0;
const wheelRotationDisplay = ref(0);
const wheelTransitionEnabled = ref(true);
const chosenPlayerName = ref(null);
const eventLog = ref([]);
const wheelDialBackground = ref('#333');
const wheelLabels = ref([]); // { name, style }

const namesInput = ref(masterPlayersList.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const joinKeyInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const manualOpenInput = ref('');

const registrationLocked = computed(() => gamePhase.value !== 'registration');
const namesHint = computed(() => (registrationLocked.value
  ? '🔒 مقفول بعد إغلاق التسجيل — اضغط "إعادة اللعبة بالكامل" لتعديل القائمة من جديد.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل بعد إغلاق التسجيل.'));
const joinKeyDisabled = computed(() => joinViaGift.value || registrationLocked.value);

function getJoinKey() { return joinKeyInput.value.trim() || '1'; }
const joinKeyHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء فتح نافذة التسجيل ينضم تلقائياً كلاعب. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.'
  : `المشاهد يكتب "${getJoinKey()}" بالدردشة عشان ينضم كلاعب أثناء فتح نافذة التسجيل`));
const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف: من يرسل هدية ينضم تلقائياً كلاعب'
  : `🔴 ربط بث تيك توك لايف: من يكتب "${getJoinKey()}" بالدردشة ينضم تلقائياً كلاعب`));

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = ref('');
function updateRegistrationHint() {
  registrationStatusHint.value = registrationOpen.value
    ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
    : '🔒 التسجيل مغلق — حدد المدة واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.';
}

function startRegistration() {
  if (registrationLocked.value || registrationOpen.value) return;
  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 5;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;
  updateRegistrationHint();
  if (registrationTimer) clearInterval(registrationTimer);
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
    else updateRegistrationHint();
  }, 1000);
}

function extendRegistration() {
  if (!registrationOpen.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
  updateRegistrationHint();
}

function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
  updateRegistrationHint();
}

function getAlivePlayers() {
  return Array.from(players.values()).filter((p) => p.alive);
}

function updateTextareaFromPlayers() {
  namesInput.value = masterPlayersList.map((p) => p.name).join('\n');
}
function syncTextareaToPlayers() {
  if (gamePhase.value !== 'registration') return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];
  if (names.length === 0) {
    masterPlayersList.splice(0, masterPlayersList.length);
    saveToStorage();
    return;
  }
  const newList = names.map((name) => {
    const existing = masterPlayersList.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name };
  });
  masterPlayersList.splice(0, masterPlayersList.length, ...newList);
  saveToStorage();
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

function addPlayer() {
  if (gamePhase.value !== 'registration') return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (masterPlayersList.some((p) => p.name === name)) {
    openModal('تنبيه', [`<div class="log-item">الاسم "${escapeHtml(name)}" موجود مسبقاً في القائمة!</div>`]);
    return;
  }
  masterPlayersList.push({ id: playerIdCounter++, name });
  newPlayerName.value = '';
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name) {
  if (gamePhase.value !== 'registration' || !registrationOpen.value || !name) return;
  if (joinedUsers.has(name)) return;
  joinedUsers.add(name);
  if (masterPlayersList.some((p) => p.name === name)) return;
  masterPlayersList.push({ id: playerIdCounter++, name });
  updateTextareaFromPlayers();
  saveToStorage();
}

function computeBoxCount(playerCount) {
  return Math.ceil(playerCount * 1.25);
}

function buildBoard() {
  if (gamePhase.value !== 'registration') return;
  if (masterPlayersList.length < 2) {
    openModal('تنبيه', ['<div class="log-item">تحتاج لاعبَين على الأقل قبل إغلاق التسجيل وبناء اللوحة!</div>']);
    return;
  }

  const totalBoxes = computeBoxCount(masterPlayersList.length);
  const assignments = masterPlayersList.map((p) => p.name);
  while (assignments.length < totalBoxes) assignments.push(null);
  shuffleArray(assignments);

  boxes.splice(0, boxes.length, ...assignments.map((occupantName, i) => ({ index: i, occupantName, revealed: false })));
  players.clear();
  masterPlayersList.forEach((p) => players.set(p.name, reactive({ name: p.name, alive: true })));
  roundNumber.value = 0;
  chosenPlayerName.value = null;
  eventLog.value = [];
  gamePhase.value = 'ready';
  stopRegistration();

  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُغلق التسجيل — ${players.size} لاعب، ${totalBoxes} مربع (${totalBoxes - players.size} فارغ)</div>`);
}

function buildWheelDial(aliveList) {
  const n = aliveList.length;
  const sliceAngle = 360 / n;

  const gradientParts = [];
  for (let i = 0; i < n; i++) {
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    gradientParts.push(`${color} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`);
  }
  wheelDialBackground.value = `conic-gradient(from 0deg, ${gradientParts.join(', ')})`;

  const radius = 95;
  wheelLabels.value = aliveList.map((p, i) => {
    const center = i * sliceAngle + sliceAngle / 2;
    return {
      name: p.name,
      style: `transform: rotate(${center}deg) translate(0, -${radius}px) rotate(90deg); transform-origin: 0 0;`,
    };
  });
}

const pickerBannerText = ref('سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"');
const pickerBannerHtml = ref('');

function spinWheel() {
  if (gamePhase.value !== 'ready') return;
  const alive = getAlivePlayers();
  if (alive.length <= 1) { checkWinner(); return; }

  gamePhase.value = 'spinning';
  pickerBannerText.value = '🎡 العجلة تدور...';

  buildWheelDial(alive);

  const pickIndex = Math.floor(Math.random() * alive.length);
  const chosen = alive[pickIndex];
  const sliceAngle = 360 / alive.length;
  const jitter = (Math.random() * sliceAngle * 0.6) - (sliceAngle * 0.3);
  const targetCenter = pickIndex * sliceAngle + sliceAngle / 2 + jitter;

  const currentMod = ((wheelRotation % 360) + 360) % 360;
  const targetMod = (((-targetCenter) % 360) + 360) % 360;
  const delta = ((targetMod - currentMod) + 360) % 360;
  const extraFullTurns = 5;
  wheelRotation += delta + extraFullTurns * 360;
  wheelRotationDisplay.value = wheelRotation;

  setTimeout(() => {
    if (!chosen.alive) {
      gamePhase.value = 'ready';
      appendLog(`<div class="log-item" style="text-align:center; color:#e67e22;">⚠️ تم حذف <b>${escapeHtml(chosen.name)}</b> أثناء دوران العجلة — أعد التدوير</div>`);
      checkWinner();
      return;
    }
    chosenPlayerName.value = chosen.name;
    gamePhase.value = 'awaiting-pick';
    roundNumber.value++;
    appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🎡 الجولة ${roundNumber.value}: العجلة اختارت <b>${escapeHtml(chosen.name)}</b> ليفتح مربعاً</div>`);
  }, 4600);
}

function parseBoxNumber(text) {
  const normalized = normalizeDigits(text);
  const matches = normalized.match(/\d+/g);
  if (!matches) return null;
  const maxN = boxes.length;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n >= 1 && n <= maxN) return n;
  }
  return null;
}

function registerBoxPickFromComment(username, rawText) {
  if (gamePhase.value !== 'awaiting-pick' || !username || !rawText) return;
  if (username !== chosenPlayerName.value) return;
  const num = parseBoxNumber(rawText);
  if (num === null) return;
  resolvePick(num - 1);
}

function manualOpenBox() {
  if (gamePhase.value !== 'awaiting-pick') return;
  const num = parseBoxNumber(manualOpenInput.value);
  if (num === null) return;
  manualOpenInput.value = '';
  resolvePick(num - 1);
}

function handleBoxClick(index) {
  if (gamePhase.value !== 'awaiting-pick') return;
  resolvePick(index);
}

function resolvePick(boxIndex) {
  const box = boxes[boxIndex];
  if (!box || box.revealed) return;

  box.revealed = true;
  if (box.occupantName) {
    const player = players.get(box.occupantName);
    if (player) player.alive = false;
    appendLog(`<div class="log-item log-hit">💥 المربع رقم ${boxIndex + 1} كشف اللاعب <b>${escapeHtml(box.occupantName)}</b> — إقصاء فوري!</div>`);
  } else {
    appendLog(`<div class="log-item log-safe">🛡️ المربع رقم ${boxIndex + 1} فارغ — نجاة، ما أحد يُقصى هالجولة</div>`);
  }

  gamePhase.value = 'ready';
  chosenPlayerName.value = null;
  checkWinner();
}

function canDeletePlayer(p) {
  return gamePhase.value !== 'ended' && gamePhase.value !== 'spinning' && p.alive;
}

function deletePlayer(name) {
  if (gamePhase.value === 'registration') {
    const idx = masterPlayersList.findIndex((p) => p.name === name);
    if (idx === -1) return;
    masterPlayersList.splice(idx, 1);
    updateTextareaFromPlayers();
    saveToStorage();
    return;
  }
  if (gamePhase.value === 'ended') return;

  const player = players.get(name);
  if (!player || !player.alive) return;
  player.alive = false;

  const box = boxes.find((b) => b.occupantName === name && !b.revealed);
  if (box) {
    box.revealed = true;
    appendLog(`<div class="log-item log-hit">🗑️ تم حذف اللاعب <b>${escapeHtml(name)}</b> يدوياً — انكشف مربعه رقم ${box.index + 1}</div>`);
  } else {
    appendLog(`<div class="log-item log-hit">🗑️ تم حذف اللاعب <b>${escapeHtml(name)}</b> يدوياً</div>`);
  }

  if (chosenPlayerName.value === name) {
    chosenPlayerName.value = null;
    gamePhase.value = 'ready';
  }
  checkWinner();
}

function checkWinner() {
  const alive = getAlivePlayers();
  if (alive.length > 1) return;

  gamePhase.value = 'ended';
  const logs = [];
  if (alive.length === 1) {
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 الفائز بلعبة عجلة والمربعات: <b>${escapeHtml(alive[0].name)}</b> 🏆</div>`);
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ff4757;">انتهت اللعبة بدون فائز!</div>');
  }
  appendLog(logs[0]);
  openModal('🏁 نتيجة اللعبة', logs);
}

function resetGame() {
  stopRegistration();
  gamePhase.value = 'registration';
  players.clear();
  boxes.splice(0, boxes.length);
  roundNumber.value = 0;
  wheelRotation = 0;
  wheelTransitionEnabled.value = false;
  wheelRotationDisplay.value = 0;
  chosenPlayerName.value = null;
  eventLog.value = [];
  joinedUsers.clear();
  nextTick(() => { wheelTransitionEnabled.value = true; });
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const boardInfoText = computed(() => {
  if (gamePhase.value === 'registration') return `عدد اللاعبين المسجلين حالياً: ${masterPlayersList.length}`;
  if (boxes.length) {
    const aliveCount = getAlivePlayers().length;
    return `عدد المربعات: ${boxes.length} | لاعبون أحياء: ${aliveCount} | الجولة: ${roundNumber.value}`;
  }
  return '';
});

// حدّث نص لافتة الاختيار تفاعلياً حسب المرحلة (باستثناء نص "العجلة تدور" المؤقت الذي يُضبط مباشرة عند بدء الدوران)
const pickerBannerComputed = computed(() => {
  if (gamePhase.value === 'registration') return { text: 'سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"', html: null };
  if (gamePhase.value === 'ready') return { text: '🎡 اضغط "تدوير العجلة" لاختيار من يفتح المربع القادم', html: null };
  if (gamePhase.value === 'spinning') return { text: '🎡 العجلة تدور...', html: null };
  if (gamePhase.value === 'awaiting-pick') return { text: null, html: `🎯 دور <b>${escapeHtml(chosenPlayerName.value)}</b>! يكتب رقم المربع بالدردشة` };
  return { text: '🏁 انتهت اللعبة — اضغط "إعادة اللعبة بالكامل" للبدء من جديد', html: null };
});
const manualOpenRowVisible = computed(() => gamePhase.value === 'awaiting-pick');

const gridClickable = computed(() => gamePhase.value === 'awaiting-pick');
function boxFrontStyle(box) {
  const hue = Math.round((box.index * 360) / boxes.length);
  return `background: hsl(${hue}, 70%, 50%);`;
}

const wheelPanelVisible = computed(() => gamePhase.value !== 'registration');
const gridPanelVisible = computed(() => gamePhase.value !== 'registration');
const buildBoardBtnVisible = computed(() => gamePhase.value === 'registration');
const spinBtnVisible = computed(() => gamePhase.value === 'ready');

const playersDisplay = computed(() => {
  if (players.size === 0) {
    return masterPlayersList.map((p) => ({ name: p.name, status: '⏳ مسجل', alive: true }));
  }
  return Array.from(players.values()).map((p) => ({ name: p.name, status: p.alive ? '🙂 في اللعبة' : '💀 مُقصى', alive: p.alive }));
});

const showRulesOverlay = ref(false);
function goHome() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

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
  trackConnectRequest('wb', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }

    const phase = gamePhase.value;

    if (data.comment && data.user) {
      const text = data.comment.trim();
      if (phase === 'registration' && !joinViaGift.value && text === getJoinKey()) {
        addPlayerFromTikTok(data.user);
      } else if (phase === 'awaiting-pick') {
        registerBoxPickFromComment(data.user, text);
      }
    }

    if (phase === 'registration' && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {
  updateRegistrationHint();
});
onUnmounted(() => {
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">{{ tiktokSectionLabel }}</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinKeyInput" type="text" maxlength="10" :disabled="joinKeyDisabled">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox" :disabled="registrationLocked">
        🎁 الانضمام بإرسال هدية بدل كتابة المفتاح
      </label>
    </div>
    <div v-if="joinViaGift" class="gift-filter-row">
      <select v-model="giftNameFilter" :disabled="registrationLocked">
        <option value="">🎁 أي هدية</option>
        <option value="Rose">🌹 وردة</option>
        <option value="TikTok">🎵 تيك توك</option>
        <option value="Ice Cream Cone">🍦 مثلجات</option>
        <option value="Finger Heart">🤏 قلب الأصابع</option>
        <option value="Panda">🐼 باندا</option>
        <option value="Perfume">🌸 عطر</option>
        <option value="Doughnut">🍩 دونات</option>
        <option value="Hand Hearts">💗 قلوب الأيدي</option>
        <option value="Starlight Sceptre">👑 الصولجان</option>
        <option value="Corgi">🐶 كورجي</option>
        <option value="Money Gun">💵 مسدس المال</option>
        <option value="Galaxy">🌌 المجرة</option>
      </select>
      <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)" :disabled="registrationLocked">
    </div>
    <div class="field-hint" style="margin-top:8px;">{{ joinKeyHint }}</div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationLocked">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" :disabled="registrationLocked" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="registrationLocked" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
    <div style="display: flex; gap: 5px; width: 100%; margin-top: 10px;">
      <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد (Enter للإضافة)" style="flex:1;" :disabled="registrationLocked" @keydown.enter.prevent="addPlayer">
      <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" :disabled="registrationLocked" @click="addPlayer">إضافة</button>
    </div>
  </div>

  <h1>🎡 عجلة والمربعات</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>
  <div class="wb-status-line">{{ boardInfoText }}</div>

  <div class="master-controls">
    <button v-if="buildBoardBtnVisible" class="master-btn" id="buildBoardBtn" @click="buildBoard">🔒 إغلاق التسجيل وبناء اللوحة</button>
    <button v-if="spinBtnVisible" class="master-btn" id="spinBtn" @click="spinWheel">🎡 تدوير العجلة</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="layout-wrapper">
    <div v-if="wheelPanelVisible" class="panel" style="display:flex;">
      <h2>🎡 عجلة الحظ (يحدد من يختار المربع)</h2>
      <div class="wb-wheel-wrap">
        <div class="wb-wheel-pointer"></div>
        <div
          class="wb-wheel-dial"
          :style="{ background: wheelDialBackground, transform: `rotate(${wheelRotationDisplay}deg)`, transition: wheelTransitionEnabled ? 'transform 4.5s cubic-bezier(0.12, 0.67, 0.1, 0.99)' : 'none' }"
        >
          <div class="wb-wheel-label">
            <span v-for="label in wheelLabels" :key="label.name" :style="label.style">{{ label.name }}</span>
          </div>
        </div>
        <div class="wb-wheel-center"></div>
      </div>
      <div class="wb-picker-banner">
        <span v-if="pickerBannerComputed.html" v-html="pickerBannerComputed.html"></span>
        <template v-else>{{ pickerBannerComputed.text }}</template>
      </div>
      <div v-if="manualOpenRowVisible" class="wb-open-row" style="display:flex;">
        <input v-model="manualOpenInput" type="number" min="1" placeholder="رقم المربع (بديل يدوي عن كتابة اللاعب بالدردشة)" @keydown.enter.prevent="manualOpenBox">
        <button class="master-btn" @click="manualOpenBox">فتح</button>
      </div>
    </div>

    <div v-if="gridPanelVisible" class="panel" style="display:flex;">
      <h2>🔢 شبكة المربعات</h2>
      <div class="wb-grid">
        <div
          v-for="box in boxes"
          :key="box.index"
          class="wb-box"
          :class="{ 'wb-revealed': box.revealed, 'wb-locked': !gridClickable || box.revealed }"
          @click="handleBoxClick(box.index)"
        >
          <div class="wb-box-inner">
            <div class="wb-box-face wb-box-front" :style="boxFrontStyle(box)">{{ box.index + 1 }}</div>
            <div class="wb-box-face wb-box-back" :class="box.occupantName ? 'is-player' : 'is-empty'">
              <template v-if="box.occupantName">💀<br>{{ box.occupantName }}</template>
              <template v-else>🛡️<br>فارغ</template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>📜 سجل الأحداث</h3>
      <div class="event-log-panel">
        <div v-if="eventLogReversed.length === 0" class="field-hint">لا توجد أحداث بعد</div>
        <div v-for="(log, i) in eventLogReversed" :key="i" v-html="log"></div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون</h3>
      <div class="players-list">
        <div v-if="playersDisplay.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
        <div v-for="p in playersDisplay" :key="p.name" class="player-item" :style="p.alive ? '' : 'opacity:0.6;'">
          <span>{{ p.name }}</span>
          <span class="player-item-right">
            <span>{{ p.status }}</span>
            <button v-if="canDeletePlayer(p)" class="player-delete-btn" title="حذف اللاعب وكشف مربعه" @click="deletePlayer(p.name)">🗑️</button>
          </span>
        </div>
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
      <h2>قوانين لعبة عجلة والمربعات 🎡</h2>
      <ul class="rules-list">
        <li><b>الانضمام:</b> يكتب المشاهد مفتاح الانضمام بالدردشة (افتراضياً "1") لينضم كلاعب قبل إغلاق التسجيل — أو يفعّل المستضيف خيار "الانضمام بإرسال هدية" ليصير أي مشاهد يرسل هدية ينضم تلقائياً بدل الكتابة</li>
        <li><b>بناء اللوحة:</b> عند الضغط على "إغلاق التسجيل" يُحسب عدد المربعات = عدد اللاعبين + زيادة 25%، والمربعات الزائدة تكون فارغة</li>
        <li><b>التوزيع السري:</b> تُخلط المصفوفة ويُوضع كل لاعب خلف مربع واحد عشوائياً بسرية تامة — ما أحد يعرف مكان أي لاعب</li>
        <li><b>العجلة:</b> تحتوي أسماء كل اللاعبين الأحياء، وتدويرها يختار عشوائياً لاعباً "يمسك الدور" هالجولة عشان يفتح مربع</li>
        <li><b>الفتح:</b> اللاعب المختار يكتب رقم المربع بالدردشة (أو يفتحه المستضيف يدوياً)، وينقلب المربع ليكشف محتواه</li>
        <li><b>الإقصاء:</b> لو طلع خلف المربع اسم لاعب (أي لاعب، حتى لو نفس من فتح) يُقصى فوراً ويُحذف من العجلة</li>
        <li><b>النجاة:</b> لو طلع المربع فارغاً، ما أحد يُقصى هالجولة، وتستمر اللعبة</li>
        <li><b>الفوز:</b> تستمر الجولات وتتقلص العجلة والمربعات حتى يبقى لاعب واحد فقط — يُعلَن فائزاً باللعبة 🏆</li>
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

.round-time-row input[type="text"], .round-time-row input[type="number"] {
  width: 110px;
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
  width: auto;
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

.gift-filter-row input {
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

.master-btn { font-size: 1.05rem; padding: 12px 22px; }

#buildBoardBtn, #spinBtn {
  position: fixed;
  bottom: 18px;
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

.wb-status-line {
  text-align: center;
  font-size: 0.95rem;
  color: #ccd6e0;
  margin-bottom: 14px;
  min-height: 1.3em;
}

.wb-wheel-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  margin: 0 auto 16px;
}

.wb-wheel-pointer {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 14px solid transparent;
  border-right: 14px solid transparent;
  border-top: 24px solid var(--primary-color);
  z-index: 5;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
}

.wb-wheel-dial {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 6px solid #2a2a40;
  box-shadow: 0 0 25px rgba(0,0,0,0.5);
  background: #333;
}

.wb-wheel-label {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
}

.wb-wheel-label span {
  position: absolute;
  display: inline-block;
  font-size: 0.68rem;
  font-weight: bold;
  color: #fff;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
}

.wb-wheel-center {
  position: absolute;
  top: 50%; left: 50%;
  width: 38px; height: 38px;
  margin: -19px 0 0 -19px;
  background: #2a2a40;
  border-radius: 50%;
  border: 3px solid var(--primary-color);
  z-index: 4;
}

.wb-picker-banner {
  text-align: center;
  font-size: 1.1rem;
  font-weight: bold;
  color: var(--primary-color);
  background: rgba(243,156,18,0.12);
  border: 1px solid var(--border-glow);
  border-radius: 10px;
  padding: 10px;
  margin-top: 10px;
  width: 100%;
  min-height: 1.5em;
}

.wb-open-row { display: flex; gap: 6px; width: 100%; margin-top: 10px; }
.wb-open-row input { flex: 1; }
.wb-open-row button { flex: none; padding: 8px 15px; font-size: 0.9rem; }

.wb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
  width: 100%;
}

.wb-box {
  perspective: 700px;
  aspect-ratio: 1;
  cursor: pointer;
}

.wb-box.wb-locked { cursor: not-allowed; }

.wb-box-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s;
  transform-style: preserve-3d;
  border-radius: 10px;
}

.wb-box.wb-revealed .wb-box-inner { transform: rotateY(180deg); }

.wb-box-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  text-align: center;
  padding: 4px;
}

.wb-box-front {
  color: #fff;
  font-size: 1.3rem;
  box-shadow: 0 4px 10px rgba(0,0,0,0.4);
}

.wb-box-back {
  transform: rotateY(180deg);
  border: 2px solid rgba(255,255,255,0.15);
  font-size: 0.72rem;
  word-break: break-word;
}

.wb-box-back.is-player { background: #8A1538; color: #fff; }
.wb-box-back.is-empty { background: #1e1e2f; color: #2ecc71; }

.event-log-panel {
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--danger-color); }
.event-log-panel :deep(.log-safe) { border-right: 4px solid var(--success-color); }

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: #1e1e2f;
  border-radius: 6px;
  margin-bottom: 5px;
  font-size: 0.9rem;
  width: 100%;
}

.player-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-delete-btn {
  background: transparent;
  border: none;
  color: var(--danger-color, #e74c3c);
  font-size: 1rem;
  padding: 2px 4px;
  cursor: pointer;
  line-height: 1;
}

.player-delete-btn:hover { transform: scale(1.15); }

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
</style>
