<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const STORAGE_KEY = 'islandsGame_players';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((p) => ({ id: p.id, name: p.name, alive: true }));
  } catch (e) { return null; }
}

const players = reactive(loadFromStorage() || [
  { id: 1, name: 'أحمد', alive: true },
  { id: 2, name: 'محمد', alive: true },
  { id: 3, name: 'علي', alive: true },
  { id: 4, name: 'جاسم', alive: true },
]);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id)) + 1;
const tiktokJoinedUsers = new Set();

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(players)); } catch (e) { /* noop */ }
}

const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');

const gameStarted = ref(false);
const selectionActive = ref(false);
const sinkReady = ref(false);
const sinking = ref(false);
const gameEnded = ref(false);
let pendingNextRound = false;
const currentRound = ref(0);
let roundToken = 0;
const islands = reactive([]); // { number, playerId }
let selectionCountdown = null;

const phaseLabel = ref('اضغط "بدء اللعبة" لفتح الخريطة');
const timerVisible = ref(false);
const timerValue = ref(15);
const timerUrgent = ref(false);

const actionBtnVisible = ref(false);
const actionBtnText = ref('🌊 بدء الغرق!');

const manualAssignVisible = ref(false);
const manualAssignSelected = ref(null);

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتائج الجولة');
const modalLogs = ref([]);

const namesHint = computed(() => (gameStarted.value
  ? '🔒 مقفول بعد بدء اللعبة — سيُفتح تلقائياً بعد الضغط على إعادة اللعبة.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل بعد بدء اللعبة.'));
const controlsDisabled = computed(() => gameStarted.value);
const showIslandsPlaceholder = computed(() => islands.length === 0);

const pendingPlayers = computed(() => {
  if (islands.length === 0) return [];
  return players.filter((p) => p.alive && !islands.some((isl) => isl.playerId === p.id));
});

const unassignedForSelect = computed(() => players.filter((p) => p.alive && !islands.some((isl) => isl.playerId === p.id)));

function playerBadgeText(p) {
  return gameStarted.value ? (p.alive ? '🏝️ صامد' : '💀 غرق') : '🟢 جاهز';
}

function updateTextareaFromPlayers() {
  namesInput.value = players.map((p) => p.name).join('\n');
}

function syncTextareaToPlayers() {
  if (gameStarted.value) return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];
  if (names.length === 0) { updateTextareaFromPlayers(); return; }
  const newList = names.map((name) => {
    const existing = players.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name, alive: true };
  });
  players.splice(0, players.length, ...newList);
  saveToStorage();
}

function addPlayer() {
  if (gameStarted.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً في القائمة!`]);
    return;
  }
  players.push({ id: playerIdCounter++, name, alive: true });
  newPlayerName.value = '';
  updateTextareaFromPlayers();
  saveToStorage();
}

function removePlayer(id) {
  if (gameStarted.value) return;
  const idx = players.findIndex((p) => p.id === id);
  if (idx !== -1) players.splice(idx, 1);
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name) {
  if (gameStarted.value || !name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);
  if (players.some((p) => p.name === name)) return;
  players.push({ id: playerIdCounter++, name, alive: true });
  updateTextareaFromPlayers();
  saveToStorage();
}

function parseIslandNumber(text) {
  const clean = normalizeDigits(text);
  const match = clean.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function registerIslandChoice(username, rawText) {
  if (!selectionActive.value || !username || !rawText) return;
  const player = players.find((p) => p.name === username && p.alive);
  if (!player) return;
  if (islands.some((isl) => isl.playerId === player.id)) return;

  const num = parseIslandNumber(rawText);
  if (num === null) return;

  const tile = islands.find((isl) => isl.number === num);
  if (!tile || tile.playerId !== null) return;

  assignIsland(tile, player);
}

function buildIslandsGrid(count) {
  islands.splice(0, islands.length);
  for (let i = 1; i <= count; i++) islands.push({ number: i, playerId: null });
}

// حركة انتقالية بصرية بحتة (تحاكي طيران الاسم للجزيرة) — تُنفَّذ مباشرة على الـ DOM كمؤثر مؤقت،
// تماماً كرسم الكانفاس في لعبة العجلة، دون أن تمس حالة التطبيق التفاعلية.
// عناصر البداية/النهاية تُلتقط في captureFlightRects() قبل أي تحديث تفاعلي يُخفي شريحة اللاعب المنتظر
function captureFlightRects(player, tile) {
  const pendingEl = document.querySelector(`.pending-chip[data-player-id="${player.id}"]`);
  const tileEl = document.querySelector(`.island-tile[data-number="${tile.number}"]`);
  if (!pendingEl || !tileEl) return null;
  return { pendingEl, startRect: pendingEl.getBoundingClientRect(), endRect: tileEl.getBoundingClientRect() };
}

function animateNameToIsland(player, rects, callback) {
  if (!rects) { callback(); return; }
  const { pendingEl, startRect, endRect } = rects;

  const flyer = document.createElement('div');
  flyer.className = 'flying-name';
  flyer.textContent = player.name;
  flyer.style.left = `${startRect.left}px`;
  flyer.style.top = `${startRect.top}px`;
  flyer.style.width = `${startRect.width}px`;
  flyer.style.height = `${startRect.height}px`;
  document.body.appendChild(flyer);

  pendingEl.style.opacity = '0';

  void flyer.offsetWidth;

  requestAnimationFrame(() => {
    flyer.style.left = `${endRect.left + endRect.width / 2 - startRect.width / 2}px`;
    flyer.style.top = `${endRect.top + endRect.height / 2 - startRect.height / 2}px`;
    flyer.style.transform = 'scale(0.55)';
    flyer.style.opacity = '0.9';
  });

  setTimeout(() => {
    flyer.remove();
    callback();
  }, 620);
}

const justLanded = reactive(new Set());

function manualAssignTile(tile) {
  if (!selectionActive.value || tile.playerId !== null) return;
  const chosenId = manualAssignSelected.value;
  if (!chosenId) return;
  const player = players.find((p) => p.id === chosenId && p.alive);
  if (!player) return;
  if (islands.some((isl) => isl.playerId === player.id)) return;

  assignIsland(tile, player);
}

function assignIsland(tile, player) {
  const rects = captureFlightRects(player, tile);
  tile.playerId = player.id;
  refreshManualAssignSelect();

  animateNameToIsland(player, rects, () => {
    justLanded.add(tile.number);
    setTimeout(() => justLanded.delete(tile.number), 400);

    if (islands.every((isl) => isl.playerId !== null)) {
      closeSelection();
    }
  });
}

function refreshManualAssignSelect() {
  const unassigned = unassignedForSelect.value;
  if (!selectionActive.value || unassigned.length === 0) {
    manualAssignVisible.value = false;
    return;
  }
  manualAssignVisible.value = true;
  if (!unassigned.some((p) => p.id === manualAssignSelected.value)) {
    manualAssignSelected.value = unassigned[0].id;
  }
}

function startGame() {
  if (gameStarted.value) return;

  if (players.length < 2) {
    openModal('تنبيه', ['تحتاج إلى لاعبين اثنين على الأقل للبدء!']);
    return;
  }

  roundToken++;
  gameStarted.value = true;
  gameEnded.value = false;
  currentRound.value = 1;

  players.forEach((p) => { p.alive = true; });
  openIslandSelection(players.length);
}

function openIslandSelection(count) {
  buildIslandsGrid(count);
  startSelectionPhase();
}

function startSelectionPhase() {
  selectionActive.value = true;
  sinkReady.value = false;

  phaseLabel.value = '🏝️ باب الاختيار مفتوح — اكتب رقم جزيرتك بالدردشة!';
  actionBtnVisible.value = false;
  refreshManualAssignSelect();

  const duration = Math.floor(Math.random() * 6) + 10;
  startTimer(duration, () => closeSelection());
}

function startTimer(seconds, onDone) {
  let timeLeft = seconds;
  timerVisible.value = true;
  timerValue.value = timeLeft;
  timerUrgent.value = false;

  if (selectionCountdown) clearInterval(selectionCountdown);
  selectionCountdown = setInterval(() => {
    timeLeft--;
    timerValue.value = Math.max(timeLeft, 0);
    if (timeLeft <= 5) timerUrgent.value = true;

    if (timeLeft <= 0) {
      clearInterval(selectionCountdown);
      selectionCountdown = null;
      onDone();
    }
  }, 1000);
}

function closeSelection() {
  if (!selectionActive.value) return;
  if (selectionCountdown) { clearInterval(selectionCountdown); selectionCountdown = null; }

  timerVisible.value = false;
  manualAssignVisible.value = false;
  phaseLabel.value = '🔒 تم إقفال باب الاختيار — نوزّع الباقين على جزرهم...';

  const unclaimedTiles = islands.filter((isl) => isl.playerId === null);
  const unassignedPlayers = players.filter((p) => p.alive && !islands.some((isl) => isl.playerId === p.id));

  for (let i = unclaimedTiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unclaimedTiles[i], unclaimedTiles[j]] = [unclaimedTiles[j], unclaimedTiles[i]];
  }

  const pairs = [];
  unclaimedTiles.forEach((tile, idx) => {
    if (unassignedPlayers[idx]) pairs.push({ tile, player: unassignedPlayers[idx] });
  });

  // نلتقط مواضع كل الشرائح المنتظرة قبل تثبيت الحجوزات دفعة واحدة (حتى لا تختفي من الشاشة تفاعلياً قبل قراءتها)
  pairs.forEach((pair) => { pair.rects = captureFlightRects(pair.player, pair.tile); });
  pairs.forEach((pair) => { pair.tile.playerId = pair.player.id; });

  if (pairs.length === 0) {
    finalizeSelectionClose();
    return;
  }

  let remaining = pairs.length;
  pairs.forEach((pair, idx) => {
    setTimeout(() => {
      animateNameToIsland(pair.player, pair.rects, () => {
        justLanded.add(pair.tile.number);
        setTimeout(() => justLanded.delete(pair.tile.number), 400);

        remaining--;
        if (remaining === 0) finalizeSelectionClose();
      });
    }, idx * 150);
  });
}

function finalizeSelectionClose() {
  selectionActive.value = false;
  phaseLabel.value = '🔒 تم إقفال باب الاختيار — كل لاعب على جزيرته';
  sinkReady.value = true;
  actionBtnText.value = '🌊 بدء الغرق!';
  actionBtnVisible.value = true;
}

function onActionClick() {
  if (sinkReady.value && !sinking.value) startSinking();
}

const sinkingTiles = reactive(new Set());
const sunkDoneTiles = reactive(new Set());

function startSinking() {
  if (sinking.value) return;
  sinking.value = true;
  sinkReady.value = false;
  actionBtnVisible.value = false;
  phaseLabel.value = '🌪️ العاصفة قادمة... الجزر تبدأ بالغرق!';

  const aliveTiles = islands.filter((isl) => isl.playerId !== null);
  const sinkPercent = Math.random() * 0.15 + 0.10;
  let sinkCount = Math.round(aliveTiles.length * sinkPercent);
  sinkCount = Math.max(1, Math.min(aliveTiles.length - 1, sinkCount));

  const shuffled = [...aliveTiles];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sunkTiles = shuffled.slice(0, sinkCount);

  sunkTiles.forEach((tile) => sinkingTiles.add(tile.number));

  setTimeout(() => finishSinking(sunkTiles), 1300);
}

function finishSinking(sunkTiles) {
  const logs = [];

  sunkTiles.forEach((tile) => {
    sinkingTiles.delete(tile.number);
    sunkDoneTiles.add(tile.number);

    const player = players.find((p) => p.id === tile.playerId);
    if (player) {
      player.alive = false;
      logs.push(`<div class="log-item log-sunk">💀 جزيرة <b>#${tile.number}</b> غرقت — ودّع المنافسة <b>${escapeHtml(player.name)}</b>!</div>`);
    }
  });

  const safePlayers = players.filter((p) => p.alive);
  const safeNames = safePlayers.map((p) => p.name);
  if (safeNames.length > 0) {
    logs.unshift(`<div class="log-item log-safe">🏝️ صمدوا هذه الجولة: ${safeNames.map((n) => escapeHtml(n)).join('، ')}</div>`);
  }

  sinking.value = false;
  phaseLabel.value = '🌊 انتهت العاصفة لهذه الجولة';

  if (safePlayers.length <= 1) {
    gameEnded.value = true;
    gameStarted.value = false;

    if (safePlayers.length === 1) {
      logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🏆 الفائز بالمركز الأول: ${escapeHtml(safePlayers[0].name)} 🏆</div>`);
    } else {
      logs.push('<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🤝 غرقت آخر الجزر معاً — لا يوجد ناجٍ وحيد!</div>');
    }
    phaseLabel.value = '🏆 انتهت اللعبة';
    saveToStorage();
    openModal('نتائج الجولة النهائية', logs);
    return;
  }

  saveToStorage();
  pendingNextRound = true;
  openModal(`نتائج الجولة ${currentRound.value}`, logs);
}

function prepareNextRound() {
  currentRound.value++;
  const survivors = players.filter((p) => p.alive);
  sunkDoneTiles.clear();
  openIslandSelection(survivors.length);
}

function openModal(title, messagesArray) {
  modalTitle.value = title;
  modalLogs.value = messagesArray;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  if (pendingNextRound) {
    pendingNextRound = false;
    prepareNextRound();
  }
}

function resetGame() {
  roundToken++;
  if (selectionCountdown) { clearInterval(selectionCountdown); selectionCountdown = null; }
  gameStarted.value = false;
  selectionActive.value = false;
  sinkReady.value = false;
  sinking.value = false;
  gameEnded.value = false;
  pendingNextRound = false;
  tiktokJoinedUsers.clear();
  stopRegistration();
  islands.splice(0, islands.length);
  sinkingTiles.clear();
  sunkDoneTiles.clear();
  justLanded.clear();
  document.querySelectorAll('.flying-name').forEach((el) => el.remove());

  players.forEach((p) => { p.alive = true; });
  currentRound.value = 0;
  phaseLabel.value = 'اضغط "بدء اللعبة" لفتح الخريطة';
  timerVisible.value = false;
  actionBtnVisible.value = false;
  manualAssignVisible.value = false;
  saveToStorage();
}

function goHome() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (!gameStarted.value) startGame();
    else if (actionBtnVisible.value) onActionClick();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

function getJoinWord() {
  return joinWordInput.value.trim() || '1';
}

const joinModeHint = computed(() => (joinViaGift.value
  ? '🎁 الانضمام مفعّل عبر الهدايا: قبل الضغط على "بدء اللعبة"، أي مشاهد يرسل هدية ينضم تلقائياً. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.<br>🏝️ اختيار الجزيرة: في <b>كل جولة</b> يكتب كل ناجٍ رقم الجزيرة اللي يبيها (مثلاً "7") — مرة واحدة فقط، ولا يقدر يختار جزيرة محجوزة.'
  : `🎯 الانضمام: قبل الضغط على "بدء اللعبة"، يكتب المشاهد <b>"${getJoinWord()}"</b> بالدردشة لينضم (مرة واحدة لكل شخص).<br>🏝️ اختيار الجزيرة: في <b>كل جولة</b> يكتب كل ناجٍ رقم الجزيرة اللي يبيها (مثلاً "7") — مرة واحدة فقط، ولا يقدر يختار جزيرة محجوزة.`));

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
  trackConnectRequest('islands', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment) {
      const text = data.comment.trim();
      if (registrationOpen.value && !joinViaGift.value && !gameStarted.value && normalizeDigits(text) === normalizeDigits(getJoinWord())) {
        addPlayerFromTikTok(data.user);
      } else if (selectionActive.value) {
        registerIslandChoice(data.user, text);
      }
    }
    if (registrationOpen.value && joinViaGift.value && !gameStarted.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (selectionCountdown) clearInterval(selectionCountdown);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
  document.querySelectorAll('.flying-name').forEach((el) => el.remove());
});
</script>

<template>
  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="controlsDisabled" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف (اختياري)</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" :disabled="joinViaGift">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox">
        🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
      </label>
    </div>
    <div v-if="joinViaGift" class="gift-filter-row">
      <select v-model="giftNameFilter">
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
      <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <div class="field-hint" v-html="joinModeHint"></div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
  </div>

  <h1>جزر البقاء 🏝️</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button v-if="!gameStarted" class="master-btn" @click="startGame">🚀 بدء اللعبة</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>خريطة الجزر 🗺️</h2>
      <div class="game-arena">
        <div class="phase-label">{{ phaseLabel }}</div>
        <div v-if="timerVisible" class="timer-display" style="display:block;" :class="{ urgent: timerUrgent }">{{ timerValue }}</div>

        <div v-if="pendingPlayers.length" class="pending-players-row" style="display:flex;">
          <div class="field-hint pending-hint">⏳ بانتظار اختيارهم:</div>
          <div v-for="p in pendingPlayers" :key="p.id" class="pending-chip" :data-player-id="p.id">{{ p.name }}</div>
        </div>

        <div v-if="showIslandsPlaceholder" class="islands-grid">
          <div class="field-hint" style="grid-column:1/-1; text-align:center;">🏝️ الخريطة راح تظهر هنا بعد الضغط على "بدء اللعبة"</div>
        </div>
        <div v-else class="islands-grid">
          <div
            v-for="isl in islands"
            :key="isl.number"
            class="island-tile"
            :data-number="isl.number"
            :class="{
              claimed: isl.playerId !== null,
              unclaimed: isl.playerId === null,
              sinking: sinkingTiles.has(isl.number),
              'sunk-done': sunkDoneTiles.has(isl.number),
              'just-landed': justLanded.has(isl.number),
            }"
            @click="isl.playerId === null && manualAssignTile(isl)"
          >
            <div class="isl-emoji">🏝️</div>
            <div class="isl-num">#{{ isl.number }}</div>
            <div v-if="isl.playerId !== null" class="isl-name">{{ (players.find(p => p.id === isl.playerId) || {}).name }}</div>
          </div>
        </div>

        <div v-if="manualAssignVisible" class="manual-assign-panel" style="display:block;">
          <div class="field-hint">🖱️ تعيين يدوي (بدون دردشة): اختر لاعباً ثم اضغط على جزيرة فارغة لتعيينها له</div>
          <select v-model="manualAssignSelected" style="margin-top:8px;">
            <option v-for="p in unassignedForSelect" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون 🏝️</h3>
      <div style="display: flex; gap: 5px; width: 100%; margin-bottom: 10px;">
        <input v-model="newPlayerName" type="text" placeholder="اسم اللاعب الجديد (Enter للإضافة)" style="flex:1;" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" @click="addPlayer">إضافة</button>
      </div>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span>{{ p.name }} <span style="color:#ffa502; margin-right:5px;">{{ playerBadgeText(p) }}</span></span>
          <button class="reset-btn" style="padding:4px 8px; font-size:0.8rem;" :disabled="gameStarted" @click="removePlayer(p.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>

  <button v-if="actionBtnVisible" class="master-btn action-float-btn" style="display:block;" @click="onActionClick">{{ actionBtnText }}</button>

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
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين جزر البقاء 🏝️🌊</h2>
      <ul class="rules-list">
        <li>قبل بدء اللعبة، يكتب كل لاعب <b>"1"</b> بالدردشة للانضمام (مرة واحدة لكل شخص)</li>
        <li>في بداية كل جولة تظهر جزر مرقّمة يساوي عددها عدد اللاعبين الناجين تماماً</li>
        <li>يكتب كل ناجٍ رقم الجزيرة التي يريدها بالدردشة (مرة واحدة كل جولة)، ولا يحق لأحد اختيار جزيرة محجوزة مسبقاً</li>
        <li>ينتهي وقت الاختيار بعد عد تنازلي (10-15 ثانية)؛ أي لاعب ما اختار تُوزَّع عليه جزيرة متبقية عشوائياً</li>
        <li>تبدأ العاصفة 🌪️: نسبة عشوائية بين <b>10% و25%</b> من الجزر تغرق فجأة كل جولة</li>
        <li>اللاعبون اللي جزرهم غرقت يودّعون المنافسة فوراً 💀</li>
        <li>الناجون يرجعون يختارون جزراً جديدة من الصفر في كل جولة، وتتكرر عملية الاختيار والغرق جولة بعد جولة</li>
        <li>آخر جزيرة صامدة = الفائز بالمركز الأول 🏆</li>
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

.action-float-btn {
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
  background: rgba(0, 40, 80, 0.25);
  border-radius: 15px;
  padding: 15px 10px;
}

.phase-label {
  font-size: 1rem;
  font-weight: bold;
  color: var(--primary-color);
  margin-bottom: 10px;
  text-align: center;
}

.timer-display {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 12px;
  text-shadow: 0 0 15px rgba(255, 165, 2, 0.5);
}

.timer-display.urgent { color: #ff4757; }

.pending-players-row {
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-bottom: 14px;
  width: 100%;
  max-width: 560px;
}

.pending-hint {
  width: 100%;
  text-align: center;
  margin-top: 0;
  margin-bottom: 2px;
}

.pending-chip {
  background: rgba(243, 156, 18, 0.15);
  border: 1px solid var(--primary-color);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.8rem;
  font-weight: bold;
  color: #ffd27a;
  white-space: nowrap;
  transition: opacity 0.15s ease;
}

:global(.flying-name) {
  position: fixed;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color);
  color: #1a1e2f;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: bold;
  box-shadow: 0 4px 14px rgba(243, 156, 18, 0.6);
  pointer-events: none;
  transition: left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s ease, opacity 0.6s ease;
}

.islands-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 10px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}

.island-tile {
  position: relative;
  aspect-ratio: 1;
  background: rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  font-size: 0.7rem;
  text-align: center;
  padding: 4px;
  overflow: hidden;
}

.island-tile .isl-emoji { font-size: 1.5rem; line-height: 1; }
.island-tile .isl-num { font-size: 0.75rem; color: #8b93a3; font-weight: bold; margin-top: 2px; }
.island-tile .isl-name {
  font-size: 0.68rem;
  font-weight: bold;
  color: #2ecc71;
  margin-top: 2px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-tile.unclaimed {
  cursor: pointer;
  animation: pulseGlow 1.6s ease-in-out infinite;
}

.island-tile.claimed {
  border-color: var(--success-color);
  background: rgba(39, 174, 96, 0.15);
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 0 rgba(243, 156, 18, 0.15); border-color: rgba(255, 255, 255, 0.15); }
  50% { box-shadow: 0 0 12px rgba(243, 156, 18, 0.55); border-color: var(--primary-color); }
}

.island-tile.sinking {
  animation: sinkDown 1.1s ease-in forwards;
}

@keyframes sinkDown {
  0% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
  60% { transform: translateY(10px) scale(0.9) rotate(-4deg); opacity: 0.75; }
  100% { transform: translateY(26px) scale(0.55) rotate(-8deg); opacity: 0.25; }
}

.island-tile.sunk-done {
  border-color: var(--danger-color);
  background: rgba(138, 21, 56, 0.25);
  opacity: 0.4;
}

.island-tile.sunk-done .isl-name { color: #ff6b6b; text-decoration: line-through; }

.island-tile.just-landed { animation: landPop 0.4s ease-out; }

@keyframes landPop {
  0% { transform: scale(0.55); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

.manual-assign-panel {
  width: 100%;
  max-width: 420px;
  margin-top: 15px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  padding: 10px;
}

.manual-assign-panel .field-hint { margin-top: 6px; text-align: center; }

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
  max-width: 350px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.2rem; }
.log-list { text-align: right; margin: 15px 0; font-size: 0.9rem; line-height: 1.5; }
.log-list :deep(.log-item) { margin-bottom: 8px; padding: 8px; border-radius: 6px; background: #1e1e2f; }
.log-list :deep(.log-safe) { border-right: 4px solid var(--success-color); }
.log-list :deep(.log-sunk) { border-right: 4px solid var(--danger-color); }

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

.footer-note { padding: 15px; font-size: 0.85rem; }
</style>
