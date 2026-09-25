<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted, nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, assignWheelColors,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

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
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  return null;
}

const masterPlayersList = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...masterPlayersList.map((p) => p.id), 0) + 1;
const joinedUsers = new Set();

function saveToStorage() {
  // أسماء اللاعبين لا تُحفظ بين الجلسات
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

const pickerStyle = ref('wheel'); // wheel | grid | avatars
const squarePickerCells = ref([]); // { name }
const squarePickerActiveIndex = ref(-1);
const squarePickerChosenIndex = ref(-1);
const avatarRingCells = ref([]); // { name, avatar, initial, style, size }
const avatarRingActiveIndex = ref(-1);
const avatarRingChosenIndex = ref(-1);
const avatarRingWinnerAvatar = ref(null);
const avatarRingWinnerInitial = ref('');
let chaseTimerId = null;

const namesInput = ref(masterPlayersList.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const joinKeyInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

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

function removePlayer(id) {
  if (gamePhase.value !== 'registration') return;
  const idx = masterPlayersList.findIndex((p) => p.id === id);
  if (idx !== -1) masterPlayersList.splice(idx, 1);
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name, avatar) {
  if (gamePhase.value !== 'registration' || (!registrationOpen.value && !isChatMode()) || !name) return;
  if (joinedUsers.has(name)) return;
  joinedUsers.add(name);
  if (masterPlayersList.some((p) => p.name === name)) return;
  masterPlayersList.push({ id: playerIdCounter++, name, avatar: avatar || getUserAvatar(name) });
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
  masterPlayersList.forEach((p) => players.set(p.name, reactive({ name: p.name, avatar: p.avatar, alive: true })));
  roundNumber.value = 0;
  chosenPlayerName.value = null;
  eventLog.value = [];
  gamePhase.value = 'ready';
  stopRegistration();

  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُغلق التسجيل — ${players.size} لاعب، ${totalBoxes} مربع (${totalBoxes - players.size} فارغ)</div>`);
}

function wheelLabelMaxChars(n) {
  if (n <= 6) return 10;
  if (n <= 10) return 8;
  if (n <= 16) return 6;
  if (n <= 24) return 5;
  return 4;
}

function wheelLabelFontSize(n) {
  if (n <= 6) return 0.72;
  if (n <= 10) return 0.64;
  if (n <= 16) return 0.56;
  if (n <= 24) return 0.5;
  return 0.44;
}

function truncateWheelName(rawName, maxChars) {
  const clean = String(rawName || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

function buildWheelDial(aliveList) {
  const n = aliveList.length;
  const sliceAngle = 360 / n;

  const sliceColors = assignWheelColors(n, WHEEL_COLORS);
  const gradientParts = [];
  for (let i = 0; i < n; i++) {
    gradientParts.push(`${sliceColors[i]} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`);
  }
  wheelDialBackground.value = `conic-gradient(from 0deg, ${gradientParts.join(', ')})`;

  const radius = 95;
  const maxChars = wheelLabelMaxChars(n);
  const fontSize = wheelLabelFontSize(n);
  const maxWidthPx = Math.max(16, Math.round(radius * (sliceAngle * Math.PI / 180) * 0.92));

  wheelLabels.value = aliveList.map((p, i) => {
    const centerDeg = i * sliceAngle + sliceAngle / 2;
    const centerRad = (centerDeg * Math.PI) / 180;
    const x = radius * Math.sin(centerRad);
    const y = -radius * Math.cos(centerRad);
    return {
      name: truncateWheelName(p.name, maxChars),
      style: `left: ${x}px; top: ${y}px; transform: translate(-50%, -50%); font-size: ${fontSize}rem; max-width: ${maxWidthPx}px;`,
    };
  });
}

function buildSquarePicker(aliveList) {
  const n = aliveList.length;
  const maxChars = wheelLabelMaxChars(n);
  squarePickerCells.value = aliveList.map((p) => ({
    name: truncateWheelName(p.name, maxChars),
    avatar: p.avatar || null,
  }));
  squarePickerActiveIndex.value = -1;
  squarePickerChosenIndex.value = -1;
}

function avatarRingSize(n) {
  if (n <= 6) return 60;
  if (n <= 10) return 52;
  if (n <= 16) return 44;
  if (n <= 24) return 36;
  return 28;
}

function buildAvatarRing(aliveList) {
  const n = aliveList.length;
  const sliceAngle = 360 / n;
  const radius = 95;
  const size = avatarRingSize(n);

  avatarRingCells.value = aliveList.map((p, i) => {
    const centerDeg = i * sliceAngle + sliceAngle / 2;
    const centerRad = (centerDeg * Math.PI) / 180;
    const x = radius * Math.sin(centerRad);
    const y = -radius * Math.cos(centerRad);
    const cleanName = String(p.name || '').trim();
    return {
      name: cleanName,
      avatar: p.avatar || null,
      initial: cleanName.charAt(0).toUpperCase() || '?',
      size,
      style: `left: calc(50% + ${x}px); top: calc(50% + ${y}px); transform: translate(-50%, -50%);`,
    };
  });
  avatarRingActiveIndex.value = -1;
  avatarRingChosenIndex.value = -1;
  avatarRingWinnerAvatar.value = null;
  avatarRingWinnerInitial.value = '';
}

function stopChaseAnimation() {
  if (chaseTimerId !== null) {
    clearTimeout(chaseTimerId);
    chaseTimerId = null;
  }
}

function runChaseAnimation(n, pickIndex, durationMs, setActive, onDone) {
  stopChaseAnimation();
  const totalLoops = 4;
  const totalDistance = n * totalLoops + pickIndex;
  const startTime = Date.now();
  const stepMs = 40;

  function tick() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - (1 - t) ** 3;
    const currentDistance = Math.floor(eased * totalDistance);
    setActive(currentDistance % n);
    if (t < 1) {
      chaseTimerId = setTimeout(tick, stepMs);
    } else {
      chaseTimerId = null;
      setActive(pickIndex);
      if (onDone) onDone(pickIndex);
    }
  }
  tick();
}

function runSquareChase(n, pickIndex, durationMs) {
  squarePickerChosenIndex.value = -1;
  runChaseAnimation(
    n,
    pickIndex,
    durationMs,
    (idx) => { squarePickerActiveIndex.value = idx; },
    (idx) => { squarePickerChosenIndex.value = idx; },
  );
}

function runAvatarRingChase(n, pickIndex, durationMs) {
  avatarRingChosenIndex.value = -1;
  runChaseAnimation(
    n,
    pickIndex,
    durationMs,
    (idx) => { avatarRingActiveIndex.value = idx; },
    (idx) => {
      avatarRingChosenIndex.value = idx;
      const cell = avatarRingCells.value[idx];
      if (cell) {
        avatarRingWinnerAvatar.value = cell.avatar;
        avatarRingWinnerInitial.value = cell.initial;
      }
    },
  );
}

const pickerBannerText = ref('سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"');
const pickerBannerHtml = ref('');

function spinWheel() {
  if (gamePhase.value !== 'ready') return;
  const alive = getAlivePlayers();
  if (alive.length <= 1) { checkWinner(); return; }

  gamePhase.value = 'spinning';

  const pickIndex = Math.floor(Math.random() * alive.length);
  const chosen = alive[pickIndex];

  if (pickerStyle.value === 'grid') {
    pickerBannerText.value = '🔲 يتم اختيار اللاعب...';
    buildSquarePicker(alive);
    runSquareChase(alive.length, pickIndex, 4300);
  } else if (pickerStyle.value === 'avatars') {
    pickerBannerText.value = '🖼️ يتم اختيار اللاعب...';
    buildAvatarRing(alive);
    runAvatarRingChase(alive.length, pickIndex, 4300);
  } else {
    pickerBannerText.value = '🎡 العجلة تدور...';
    buildWheelDial(alive);

    const sliceAngle = 360 / alive.length;
    const jitter = (Math.random() * sliceAngle * 0.6) - (sliceAngle * 0.3);
    const targetCenter = pickIndex * sliceAngle + sliceAngle / 2 + jitter;

    const currentMod = ((wheelRotation % 360) + 360) % 360;
    const targetMod = (((-targetCenter) % 360) + 360) % 360;
    const delta = ((targetMod - currentMod) + 360) % 360;
    const extraFullTurns = 5;
    wheelRotation += delta + extraFullTurns * 360;
    wheelRotationDisplay.value = wheelRotation;
  }

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
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 الفائز بلعبة عجلة المربعات: <b>${escapeHtml(alive[0].name)}</b> 🏆</div>`);
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ff4757;">انتهت اللعبة بدون فائز!</div>');
  }
  appendLog(logs[0]);
  openModal('🏁 نتيجة اللعبة', logs);
}

function resetGame() {
  stopRegistration();
  stopChaseAnimation();
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
  squarePickerCells.value = [];
  squarePickerActiveIndex.value = -1;
  squarePickerChosenIndex.value = -1;
  avatarRingCells.value = [];
  avatarRingActiveIndex.value = -1;
  avatarRingChosenIndex.value = -1;
  nextTick(() => { wheelTransitionEnabled.value = true; });
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const boardInfoText = computed(() => {
  if (gamePhase.value === 'registration') return '';
  if (boxes.length) {
    const aliveCount = getAlivePlayers().length;
    return `عدد المربعات: ${boxes.length} | لاعبون أحياء: ${aliveCount} | الجولة: ${roundNumber.value}`;
  }
  return '';
});

// حدّث نص لافتة الاختيار تفاعلياً حسب المرحلة (باستثناء نص "العجلة تدور" المؤقت الذي يُضبط مباشرة عند بدء الدوران)
const spinBtnLabel = computed(() => {
  if (pickerStyle.value === 'grid') return '🔲 اختيار اللاعب';
  if (pickerStyle.value === 'avatars') return '🖼️ اختيار اللاعب';
  return '🎡 تدوير العجلة';
});

const spinningBannerText = computed(() => {
  if (pickerStyle.value === 'grid') return '🔲 يتم اختيار اللاعب...';
  if (pickerStyle.value === 'avatars') return '🖼️ يتم اختيار اللاعب...';
  return '🎡 العجلة تدور...';
});

const pickerBannerComputed = computed(() => {
  if (gamePhase.value === 'registration') return { text: 'سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"', html: null };
  if (gamePhase.value === 'ready') return { text: `اضغط "${spinBtnLabel.value}" لاختيار من يفتح المربع القادم`, html: null };
  if (gamePhase.value === 'spinning') return { text: spinningBannerText.value, html: null };
  if (gamePhase.value === 'awaiting-pick') return { text: null, html: `🎯 دور <b>${escapeHtml(chosenPlayerName.value)}</b>! يكتب رقم المربع بالدردشة` };
  return { text: '🏁 انتهت اللعبة — اضغط "إعادة اللعبة بالكامل" للبدء من جديد', html: null };
});
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
    return masterPlayersList.map((p) => ({
      name: p.name, avatar: p.avatar, status: '⏳ مسجل', alive: true,
    }));
  }
  return Array.from(players.values()).map((p) => ({
    name: p.name, avatar: p.avatar, status: p.alive ? '🙂 في اللعبة' : '💀 مُقصى', alive: p.alive,
  }));
});

const showRulesOverlay = ref(false);
const barExpanded = ref(true);

const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

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

function handleTiktokMessage(data) {
  const phase = gamePhase.value;

  if (data.comment && data.user) {
    const text = data.comment.trim();
    if (phase === 'registration' && !joinViaGift.value && normalizeDigits(text) === normalizeDigits(getJoinKey())) {
      addPlayerFromTikTok(data.user, data.avatar);
    } else if (phase === 'awaiting-pick') {
      registerBoxPickFromComment(data.user, text);
    }
  }

  if (phase === 'registration' && joinViaGift.value && isGiftEvent(data)
    && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
    addPlayerFromTikTok(getGiftUser(data), data.avatar);
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'wb', onMessage: handleTiktokMessage });
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (showRulesOverlay.value || showModal_.value) return;
    if (buildBoardBtnVisible.value) buildBoard();
    else if (spinBtnVisible.value) spinWheel();
  }
}

onMounted(() => {
  updateRegistrationHint();
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromTikTok(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  stopChaseAnimation();
  clearMessageHandler();
});
</script>

<template>
  <h1>🎡 عجلة المربعات</h1>
  <div class="subtitle">منصة تحديات 956BR</div>
  <div class="wb-status-line">{{ boardInfoText }}</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="buildBoardBtnVisible" class="master-btn side-panel-btn" id="buildBoardBtn" @click="buildBoard">🔒 إغلاق التسجيل وبناء اللوحة</button>
    <button v-if="spinBtnVisible" class="master-btn side-panel-btn" id="spinBtn" @click="spinWheel">{{ spinBtnLabel }}</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ playersDisplay.length }}</span></button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ مفتاح الانضمام: ${getJoinKey()}` }}</button>
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        :disabled="!registrationOpen && registrationLocked"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ tiktokSectionLabel }}</label>
      <div class="join-settings-row" style="margin-top:0;">
        <input v-model="joinKeyInput" type="text" maxlength="10" :disabled="joinKeyDisabled">
        <label v-if="!isChatMode()" class="join-gift-toggle" for="joinViaGiftCheckboxModal">
          <input id="joinViaGiftCheckboxModal" v-model="joinViaGift" type="checkbox" :disabled="registrationLocked">
          🎁 الانضمام بإرسال هدية بدل كتابة المفتاح
        </label>
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" :disabled="registrationLocked" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)" :disabled="registrationLocked">
      </div>
      <div class="field-hint">{{ joinKeyHint }}</div>
      <div class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationLocked">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div v-if="wheelPanelVisible" class="panel" style="display:flex;">
      <h2>🎯 يحدد من يختار المربع</h2>
      <div class="wb-picker-style-toggle">
        <button
          type="button"
          class="wb-style-btn"
          :class="{ active: pickerStyle === 'wheel' }"
          :disabled="gamePhase === 'spinning'"
          @click="pickerStyle = 'wheel'"
        >🎡 العجلة</button>
        <button
          type="button"
          class="wb-style-btn"
          :class="{ active: pickerStyle === 'grid' }"
          :disabled="gamePhase === 'spinning'"
          @click="pickerStyle = 'grid'"
        >🔲 المربعات</button>
        <button
          type="button"
          class="wb-style-btn"
          :class="{ active: pickerStyle === 'avatars' }"
          :disabled="gamePhase === 'spinning'"
          @click="pickerStyle = 'avatars'"
        >🖼️ دوائر</button>
      </div>

      <div v-if="pickerStyle === 'wheel'" class="wb-wheel-wrap">
        <div class="wb-wheel-pointer"></div>
        <div
          class="wb-wheel-dial"
          :style="{ background: wheelDialBackground, transform: `rotate(${wheelRotationDisplay}deg)`, transition: wheelTransitionEnabled ? 'transform 4.5s cubic-bezier(0.12, 0.67, 0.1, 0.99)' : 'none' }"
        >
          <div class="wb-wheel-label">
            <span v-for="(label, labelIndex) in wheelLabels" :key="labelIndex" :style="label.style">{{ label.name }}</span>
          </div>
        </div>
        <div class="wb-wheel-center"></div>
      </div>

      <div v-else-if="pickerStyle === 'grid'" class="wb-square-picker">
        <div
          v-for="(cell, cellIndex) in squarePickerCells"
          :key="cellIndex"
          class="wb-square-cell"
          :class="{ 'wb-square-active': cellIndex === squarePickerActiveIndex, 'wb-square-chosen': cellIndex === squarePickerChosenIndex }"
        >
          <img v-if="cell.avatar" :src="cell.avatar" class="wb-square-avatar" alt="">
          <span class="wb-square-name">{{ cell.name }}</span>
        </div>
      </div>

      <div v-else class="wb-avatar-ring-wrap">
        <div class="wb-wheel-pointer"></div>
        <div class="wb-avatar-ring-track"></div>
        <div
          v-for="(cell, cellIndex) in avatarRingCells"
          :key="cellIndex"
          class="wb-avatar-ring-item"
          :style="cell.style"
        >
          <div
            class="wb-avatar-ring-circle"
            :class="{ 'wb-avatar-active': cellIndex === avatarRingActiveIndex, 'wb-avatar-chosen': cellIndex === avatarRingChosenIndex }"
            :style="{ width: cell.size + 'px', height: cell.size + 'px' }"
            :title="cell.name"
          >
            <img v-if="cell.avatar" :src="cell.avatar" alt="">
            <span v-else class="wb-avatar-fallback">{{ cell.initial }}</span>
          </div>
        </div>
        <div class="wb-wheel-center wb-avatar-ring-winner" :class="{ 'wb-avatar-ring-winner-set': avatarRingWinnerAvatar || avatarRingWinnerInitial }">
          <img v-if="avatarRingWinnerAvatar" :src="avatarRingWinnerAvatar" alt="">
          <span v-else-if="avatarRingWinnerInitial" class="wb-avatar-fallback">{{ avatarRingWinnerInitial }}</span>
        </div>
      </div>

      <div class="wb-picker-banner">
        <span v-if="pickerBannerComputed.html" v-html="pickerBannerComputed.html"></span>
        <template v-else>{{ pickerBannerComputed.text }}</template>
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
          <span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
          <span class="player-item-right">
            <span>{{ p.status }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ playersDisplay.length }})</h3>
      <label for="namesInput" class="field-hint" style="display:block; margin-top:0;">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
      <textarea id="namesInput" v-model="namesInput" :disabled="registrationLocked" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
      <div class="field-hint">{{ namesHint }}</div>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" :disabled="registrationLocked" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" :disabled="registrationLocked" @click="addPlayer">➕ إضافة</button>
      </div>
      <div v-if="playersDisplay.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in playersDisplay" :key="p.name" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }} <span style="opacity:0.7;">{{ p.status }}</span></span>
          <button v-if="canDeletePlayer(p)" type="button" class="players-modal-remove-btn" title="حذف اللاعب وكشف مربعه" @click="deletePlayer(p.name)">🗑️ حذف</button>
        </div>
      </div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
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
      <h2>قوانين لعبة عجلة المربعات 🎡</h2>
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

.wb-picker-style-toggle {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 14px;
}

.wb-style-btn {
  background: #2a2a40;
  color: #ccd6e0;
  border: 2px solid #3a3a55;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.wb-style-btn.active {
  background: var(--primary-color);
  color: #1e1e2f;
  border-color: var(--primary-color);
}

.wb-style-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wb-wheel-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  margin: 0 auto 16px;
}

.wb-square-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 8px;
  width: 100%;
  max-width: 340px;
  margin: 0 auto 16px;
}

.wb-square-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: #2a2a40;
  border: 2px solid #3a3a55;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
  font-size: 0.68rem;
  padding: 4px;
  text-align: center;
  overflow: hidden;
  transition: transform 0.08s, background 0.08s, border-color 0.08s;
}

.wb-square-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.6);
}

.wb-square-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.wb-square-active {
  background: var(--primary-color);
  border-color: #fff;
  color: #1e1e2f;
  transform: scale(1.08);
  box-shadow: 0 0 14px var(--primary-color);
}

.wb-square-chosen {
  background: #f39c12;
  border-color: #fff;
  color: #1e1e2f;
  transform: scale(1.12);
  box-shadow: 0 0 20px #f39c12;
  animation: wb-square-pulse 0.8s ease-in-out infinite;
}

@keyframes wb-square-pulse {
  0%, 100% { transform: scale(1.12); }
  50% { transform: scale(1.2); }
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
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
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

.wb-avatar-ring-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  margin: 0 auto 16px;
}

.wb-avatar-ring-track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px dashed #3a3a55;
  background: #1c1c2c;
}

.wb-avatar-ring-item {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  z-index: 2;
}

.wb-avatar-ring-circle {
  border-radius: 50%;
  border: 2px solid #3a3a55;
  background: #2a2a40;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: transform 0.08s, border-color 0.08s, box-shadow 0.08s;
}

.wb-avatar-ring-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wb-avatar-fallback {
  color: #ccd6e0;
  font-weight: bold;
  font-size: 0.9rem;
}

.wb-avatar-ring-winner {
  width: 58px;
  height: 58px;
  margin: -29px 0 0 -29px;
  overflow: hidden;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.wb-avatar-ring-winner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.wb-avatar-ring-winner.wb-avatar-ring-winner-set {
  border-color: #f39c12;
  box-shadow: 0 0 18px #f39c12;
}

.wb-avatar-active {
  border-color: var(--primary-color);
  transform: scale(1.15);
  box-shadow: 0 0 14px var(--primary-color);
}

.wb-avatar-chosen {
  border-color: #f39c12;
  transform: scale(1.2);
  box-shadow: 0 0 20px #f39c12;
  animation: wb-square-pulse 0.8s ease-in-out infinite;
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
