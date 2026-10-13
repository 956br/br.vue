<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted, nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, GIFT_CHOICES, defaultGift, assignWheelColors, isLeaveComment,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
  displayName,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import { useSettingsOverlay } from '../../utils/useSettingsOverlay';
import { nameHtml } from '../../utils/nameHtml';

const router = useRouter();
const STORAGE_KEY = 'mahdiWheelGame_players';
const WHEEL_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

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

const gamePhase = ref('registration'); // registration | ready | spinning | awaiting-pick | smashing | ended
const players = reactive(new Map()); // name -> { name, avatar, alive, left, repeat, bought }
const boxes = reactive([]); // { index, occupantName, revealed, fatal }
const roundNumber = ref(0);
let wheelRotation = 0;
const wheelRotationDisplay = ref(0);
const wheelTransitionEnabled = ref(true);
const chosenPlayerName = ref(null);
const eventLog = ref([]);
const wheelDialBackground = ref('#333');
const wheelLabels = ref([]); // { name, style }

const pickerStyle = ref('wheel'); // wheel | grid | avatars | names
const rotatingName = ref(null); // { name, avatar }
const rotatingNameChosen = ref(false);
const squarePickerCells = ref([]); // { name }
const squarePickerActiveIndex = ref(-1);
const squarePickerChosenIndex = ref(-1);
const avatarRingCells = ref([]); // { name, avatar, initial, style, size }
const avatarRingActiveIndex = ref(-1);
const avatarRingChosenIndex = ref(-1);
const avatarRingWinnerAvatar = ref(null);
const avatarRingWinnerInitial = ref('');
let chaseTimerId = null;

// مهدي يكسر المربع المختار بالمطرقة قبل ما ينكشف اللي وراه
const SMASH_DURATION_MS = 850;
const SMASH_RESULT_MS = 1500;
const MAHDI_FRAMES = ['windup', 'slam', 'caught', 'empty', 'mock', 'angry', 'cheer', 'win', 'cool', 'think', 'think2', 'think3', 'register'].map((n) => `/mahdi/${n}.png`);
const smashingIndex = ref(-1);
let smashTimerId = null;
// بعد ما ينكشف المربع يبقى مهدي لحظة بتعبير النتيجة:
// caught (طلع لاعب) | mock (اللاعب طلّع نفسه) | angry (انطرد لاعب اسمه فيه "مهدي") | empty (فاضي)
const smashResult = ref(null); // { index, kind }
let smashResultTimerId = null;
const winnerName = ref(null);
// وضعيات انتظار اختيار المربع: كل جولة وضعية
const WAIT_FRAMES = ['think2', 'think3'];

// ===== إعدادات اللعبة =====
const MAX_PLAYER_BOXES = 5; // أقصى مربعات (فرص) يعطيها المستضيف للاعب يدوياً
const MAX_NAME_REPEAT = 5; // أقصى تكرار للاسم في العجلة
// المربعات الفارغة: نسبة عشوائية داخل المدى من مجموع مربعات اللاعبين (المدى ما ينعرض بالواجهة)
const EMPTY_MODES = [
  { id: 'none', label: '🚫 بدون', range: null },
  { id: 'few', label: '🔹 عدد قليل', range: [0.10, 0.20] },
  { id: 'good', label: '🔷 عدد جيد', range: [0.25, 0.35] },
];
const emptyMode = ref('good');
// مؤقت اختيار المربع: لو خلص واللاعب ما اختار، ينفتح له مربع عشوائي
const pickTimerEnabled = ref(false);
const pickTimerSeconds = ref(35);
const pickTimeLeft = ref(0);
let pickTimerId = null;
// شراء مربع إضافي بالهدايا (بحد أقصى لكل لاعب)
const buyBoxEnabled = ref(false);
const buyBoxGift = ref(defaultGift());
const buyBoxMax = ref(3);
// الرجوع بالهدايا: يرجّع المطرود بفرصة وحدة ويعيد توزيع المربعات
const reviveEnabled = ref(false);
const reviveGift = ref(defaultGift());
const shuffleFx = ref(false);
let shuffleFxTimerId = null;

const newPlayerName = ref('');
const joinKeyInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref(defaultGift());
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

const registrationLocked = computed(() => gamePhase.value !== 'registration');
const joinKeyDisabled = computed(() => joinViaGift.value || registrationLocked.value);

function getJoinKey() { return joinKeyInput.value.trim() || '1'; }
const joinKeyHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل الهدية المحددة أثناء فتح نافذة التسجيل ينضم تلقائياً كلاعب.'
  : `المشاهد يكتب "${getJoinKey()}" بالدردشة عشان ينضم كلاعب أثناء فتح نافذة التسجيل`));
// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationUnlimited = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = ref('');
function updateRegistrationHint() {
  registrationStatusHint.value = registrationOpen.value
    ? `🟢 التسجيل مفتوح ${registrationUnlimited.value ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${registrationTimeLeft.value} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
    : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.';
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
  if (registrationUnlimited.value) { registrationTimeLeft.value = 0; return; }
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
    else updateRegistrationHint();
  }, 1000);
}

function extendRegistration() {
  if (!registrationOpen.value || registrationUnlimited.value) return;
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

const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() { showModal_.value = false; }

function makePlayer(name, avatar) {
  return {
    id: playerIdCounter++, name, avatar, boxes: 1, repeat: 1, bought: 0,
  };
}

function addPlayer() {
  if (gamePhase.value !== 'registration') return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (masterPlayersList.some((p) => p.name === name)) {
    openModal('تنبيه', [`<div class="log-item">الاسم "${nameHtml(name)}" موجود مسبقاً في القائمة!</div>`]);
    return;
  }
  masterPlayersList.push(makePlayer(name));
  newPlayerName.value = '';
  saveToStorage();
}

function removePlayer(id) {
  if (gamePhase.value !== 'registration') return;
  const idx = masterPlayersList.findIndex((p) => p.id === id);
  if (idx !== -1) masterPlayersList.splice(idx, 1);
  saveToStorage();
}

function clearPlayers() {
  if (gamePhase.value !== 'registration') return;
  masterPlayersList.splice(0, masterPlayersList.length);
  joinedUsers.clear();
  saveToStorage();
}

function addPlayerFromTikTok(name, avatar) {
  if (gamePhase.value !== 'registration' || (!registrationOpen.value && !isChatMode()) || !name) return;
  if (joinedUsers.has(name)) return;
  joinedUsers.add(name);
  if (masterPlayersList.some((p) => p.name === name)) return;
  masterPlayersList.push(makePlayer(name, avatar || getUserAvatar(name)));
  saveToStorage();
}

function computeEmptyCount(playerBoxes) {
  const mode = EMPTY_MODES.find((m) => m.id === emptyMode.value) || EMPTY_MODES[0];
  if (!mode.range) return 0;
  const [min, max] = mode.range;
  return Math.max(1, Math.round(playerBoxes * (min + Math.random() * (max - min))));
}

function hiddenBoxesOf(name) {
  return boxes.filter((b) => b.occupantName === name && !b.revealed);
}

// يعيد توزيع اللي ورا المربعات المقفلة (المربع اللي ينكسر الحين ما ينلمس)
function reshuffleHiddenBoxes() {
  const hidden = boxes.filter((b) => !b.revealed && b.index !== smashingIndex.value);
  const occupants = shuffleArray(hidden.map((b) => b.occupantName));
  hidden.forEach((b, i) => { b.occupantName = occupants[i]; });
  shuffleFx.value = true;
  if (shuffleFxTimerId) clearTimeout(shuffleFxTimerId);
  shuffleFxTimerId = setTimeout(() => { shuffleFx.value = false; shuffleFxTimerId = null; }, 700);
}

function buildBoard() {
  if (gamePhase.value !== 'registration') return;
  if (masterPlayersList.length < 2) {
    openModal('تنبيه', ['<div class="log-item">تحتاج لاعبَين على الأقل قبل إغلاق التسجيل وبناء اللوحة!</div>']);
    return;
  }

  // كل لاعب له مربع لكل فرصة، وفوقهم المربعات الفارغة حسب الإعداد
  const assignments = [];
  masterPlayersList.forEach((p) => { for (let i = 0; i < p.boxes; i++) assignments.push(p.name); });
  const emptyCount = computeEmptyCount(assignments.length);
  for (let i = 0; i < emptyCount; i++) assignments.push(null);
  shuffleArray(assignments);

  boxes.splice(0, boxes.length, ...assignments.map((occupantName, i) => ({
    index: i, occupantName, revealed: false, fatal: false,
  })));
  players.clear();
  masterPlayersList.forEach((p) => players.set(p.name, reactive({
    name: p.name, avatar: p.avatar, alive: true, left: false, repeat: p.repeat, bought: p.bought,
  })));
  roundNumber.value = 0;
  chosenPlayerName.value = null;
  eventLog.value = [];
  gamePhase.value = 'ready';
  stopRegistration();

  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُغلق التسجيل — ${players.size} لاعب، ${boxes.length} مربع</div>`);
}

// سجل اللاعب: القائمة وقت التسجيل، وخريطة اللاعبين بعد بناء اللوحة
function playerEntry(name) {
  return gamePhase.value === 'registration' ? masterPlayersList.find((p) => p.name === name) : players.get(name);
}

function changeRepeat(name, delta) {
  const entry = playerEntry(name);
  if (!entry) return;
  entry.repeat = Math.min(MAX_NAME_REPEAT, Math.max(1, entry.repeat + delta));
}

// يضيف مربع (فرصة) للاعب: وقت التسجيل يزيد عدّاده، وباللعبة ينضاف مربع جديد وتتوزع المربعات المقفلة من جديد
function addBoxFor(name) {
  if (gamePhase.value === 'registration') {
    const entry = masterPlayersList.find((p) => p.name === name);
    if (!entry) return false;
    entry.boxes++;
    return true;
  }
  const player = players.get(name);
  if (!player || !player.alive || gamePhase.value === 'ended') return false;
  boxes.push({
    index: boxes.length, occupantName: name, revealed: false, fatal: false,
  });
  reshuffleHiddenBoxes();
  return true;
}

function boxCountOf(name) {
  if (gamePhase.value !== 'registration') return hiddenBoxesOf(name).length;
  const entry = masterPlayersList.find((p) => p.name === name);
  return entry ? entry.boxes : 0;
}

// تحكم المستضيف من نافذة اللاعبين (النقص وقت التسجيل فقط)
function changeBoxes(name, delta) {
  if (delta > 0) {
    if (boxCountOf(name) >= MAX_PLAYER_BOXES || !addBoxFor(name)) return;
    if (gamePhase.value !== 'registration') appendLog(`<div class="log-item log-safe">➕ المستضيف عطى <b>${nameHtml(name)}</b> مربع إضافي — انعاد توزيع المربعات المقفلة</div>`);
    return;
  }
  if (gamePhase.value !== 'registration') return;
  const entry = masterPlayersList.find((p) => p.name === name);
  if (entry && entry.boxes > 1) entry.boxes--;
}

function buyBoxFromGift(name) {
  const entry = playerEntry(name);
  if (!entry) return;
  const max = Math.max(1, parseInt(buyBoxMax.value, 10) || 3);
  if (entry.bought >= max || !addBoxFor(name)) return;
  entry.bought++;
  if (gamePhase.value !== 'registration') appendLog(`<div class="log-item log-safe">🎁 <b>${nameHtml(name)}</b> اشترى مربع إضافي (${entry.bought}/${max}) — انعاد توزيع المربعات المقفلة</div>`);
}

const pendingRevives = new Map(); // name -> viaGift

function flushPendingRevives() {
  const queued = Array.from(pendingRevives);
  pendingRevives.clear();
  queued.forEach(([name, viaGift]) => revivePlayer(name, viaGift));
}

function canRevivePlayer(p) {
  return !['registration', 'spinning', 'smashing', 'ended'].includes(gamePhase.value) && !p.alive && !p.left;
}

// يرجّع المطرود بفرصة وحدة: ينقلب مربعه ويتغطى معه مربع فارغ واحد من المكشوفة،
// ثم تنخلط كل المربعات المغطاة عشوائياً (لاعبين وفارغة). ما يشتغل بعد إعلان الفائز
function revivePlayer(name, viaGift = false) {
  if (gamePhase.value === 'registration' || gamePhase.value === 'ended') return;
  // مهدي يكسر مربع الحين: يتأجل الرجوع لين ينكشف، عشان الخلط يشمل كل المربعات المغطاة
  if (gamePhase.value === 'smashing') { pendingRevives.set(name, viaGift); return; }
  const player = players.get(name);
  if (!player || player.alive || player.left) return;
  const own = boxes.filter((b) => b.occupantName === name);
  const back = own.find((b) => b.fatal) || own[own.length - 1];
  if (!back) return;

  back.revealed = false;
  back.fatal = false;
  // مع كل رجوع يتغطى مربع فارغ واحد بس من المكشوفة (عشوائي)
  const openEmpties = boxes.filter((b) => !b.occupantName && b.revealed);
  if (openEmpties.length) openEmpties[Math.floor(Math.random() * openEmpties.length)].revealed = false;
  player.alive = true;
  clearSmashResult();
  reshuffleHiddenBoxes();
  appendLog(`<div class="log-item log-safe">🔄 <b>${nameHtml(name)}</b> رجع للعبة${viaGift ? ' بهدية' : ''} — انقلب مربعه${openEmpties.length ? ' ومربع فارغ' : ''} وانخلطت كل المربعات المغطاة</div>`);
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
    // ceil بدل floor: الذيل البطيء للتباطؤ يثبت على الفائز نفسه بدل اللي قبله
    const currentDistance = Math.ceil(eased * totalDistance);
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

// "الأسماء الدوارة": خانة عرض واحدة تتبدل فيها الأسماء بسرعة تتباطأ حتى تثبت على المختار
function runRotatingNamesChase(aliveList, pickIndex, durationMs) {
  rotatingNameChosen.value = false;
  runChaseAnimation(
    aliveList.length,
    pickIndex,
    durationMs,
    (idx) => { rotatingName.value = { name: aliveList[idx].name, avatar: aliveList[idx].avatar || null }; },
    () => { rotatingNameChosen.value = true; },
  );
}

const pickerBannerText = ref('سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"');
const pickerBannerHtml = ref('');

// خانات الاختيار: كل لاعب يتكرر بعدد تكراره، موزّعين بالتناوب عشان ما تتلاصق خانات نفس اللاعب
function buildPickEntries(alive) {
  const entries = [];
  const maxRepeat = Math.max(...alive.map((p) => p.repeat || 1));
  for (let r = 0; r < maxRepeat; r++) {
    alive.forEach((p) => { if ((p.repeat || 1) > r) entries.push(p); });
  }
  return entries;
}

function stopPickTimer() {
  if (pickTimerId !== null) {
    clearInterval(pickTimerId);
    pickTimerId = null;
  }
  pickTimeLeft.value = 0;
}

function startPickTimer() {
  stopPickTimer();
  if (!pickTimerEnabled.value) return;
  let secs = parseInt(pickTimerSeconds.value, 10);
  if (Number.isNaN(secs) || secs < 5) secs = 5;
  pickTimerSeconds.value = secs;
  pickTimeLeft.value = secs;
  pickTimerId = setInterval(() => {
    if (gamePhase.value !== 'awaiting-pick') { stopPickTimer(); return; }
    pickTimeLeft.value--;
    if (pickTimeLeft.value > 0) return;
    const name = chosenPlayerName.value;
    const closed = boxes.filter((b) => !b.revealed);
    stopPickTimer();
    if (!closed.length) return;
    const box = closed[Math.floor(Math.random() * closed.length)];
    appendLog(`<div class="log-item" style="text-align:center; color:#e67e22;">⏰ خلص وقت <b>${nameHtml(name)}</b> — مهدي اختار له المربع رقم ${box.index + 1} عشوائياً</div>`);
    resolvePick(box.index);
  }, 1000);
}

function spinWheel() {
  if (gamePhase.value !== 'ready') return;
  const alive = getAlivePlayers();
  if (alive.length <= 1) { checkWinner(); return; }

  gamePhase.value = 'spinning';
  clearSmashResult();

  const entries = buildPickEntries(alive);
  const pickIndex = Math.floor(Math.random() * entries.length);
  const chosen = entries[pickIndex];

  if (pickerStyle.value === 'grid') {
    pickerBannerText.value = '🔲 يتم اختيار اللاعب...';
    buildSquarePicker(entries);
    runSquareChase(entries.length, pickIndex, 4300);
  } else if (pickerStyle.value === 'avatars') {
    pickerBannerText.value = '🖼️ يتم اختيار اللاعب...';
    buildAvatarRing(entries);
    runAvatarRingChase(entries.length, pickIndex, 4300);
  } else if (pickerStyle.value === 'names') {
    pickerBannerText.value = '🔄 يتم اختيار اللاعب...';
    runRotatingNamesChase(entries, pickIndex, 4300);
  } else {
    pickerBannerText.value = '🎡 العجلة تدور...';
    buildWheelDial(entries);

    const sliceAngle = 360 / entries.length;
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
    // اللعبة انحسمت أو انعادت والعجلة تدور (مثلاً لاعب كتب "خروج")
    if (gamePhase.value !== 'spinning') return;
    if (!chosen.alive) {
      gamePhase.value = 'ready';
      appendLog(`<div class="log-item" style="text-align:center; color:#e67e22;">⚠️ تم حذف <b>${nameHtml(chosen.name)}</b> أثناء دوران العجلة — أعد التدوير</div>`);
      checkWinner();
      return;
    }
    chosenPlayerName.value = chosen.name;
    gamePhase.value = 'awaiting-pick';
    roundNumber.value++;
    startPickTimer();
    appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🎡 الجولة ${roundNumber.value}: العجلة اختارت <b>${nameHtml(chosen.name)}</b> ليفتح مربعاً</div>`);
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

function stopSmash() {
  if (smashTimerId !== null) {
    clearTimeout(smashTimerId);
    smashTimerId = null;
  }
  smashingIndex.value = -1;
}

function clearSmashResult() {
  if (smashResultTimerId !== null) {
    clearTimeout(smashResultTimerId);
    smashResultTimerId = null;
  }
  smashResult.value = null;
}

// يطابق "مهدي" حتى لو مكتوب بمسافات أو تطويل أو تشكيل أو حروف مكررة، أو بالإنجليزي
function isMahdiName(name) {
  const clean = String(name || '').replace(/[\sـً-ٟ._-]/g, '');
  return /م+ه+د+[يى]/.test(clean) || /m[ae]+hd[iy]/i.test(clean);
}

function caughtKind(occupantName) {
  if (isMahdiName(occupantName)) return 'angry';
  if (occupantName === chosenPlayerName.value) return 'mock';
  return 'caught';
}

function showSmashResult(index, kind) {
  clearSmashResult();
  smashResult.value = { index, kind };
  smashResultTimerId = setTimeout(clearSmashResult, SMASH_RESULT_MS);
}

function resolvePick(boxIndex) {
  const box = boxes[boxIndex];
  if (!box || box.revealed) return;

  stopPickTimer();
  clearSmashResult();
  gamePhase.value = 'smashing';
  smashingIndex.value = boxIndex;
  smashTimerId = setTimeout(() => {
    stopSmash();
    // اللعبة انحسمت أو انعادت ومهدي يكسر (مثلاً لاعب كتب "خروج")
    if (gamePhase.value !== 'smashing') return;
    revealBox(boxIndex);
  }, SMASH_DURATION_MS);
}

function revealBox(boxIndex) {
  const box = boxes[boxIndex];
  if (!box) return;

  if (box.revealed) {
    // انكشف المربع أثناء التكسير (صاحبه انحذف) — تنتهي الجولة بدون إقصاء إضافي
  } else if (box.occupantName) {
    box.revealed = true;
    const player = players.get(box.occupantName);
    const chancesLeft = hiddenBoxesOf(box.occupantName).length;
    box.fatal = chancesLeft === 0;
    showSmashResult(boxIndex, caughtKind(box.occupantName));
    if (box.fatal) {
      if (player) player.alive = false;
      appendLog(`<div class="log-item log-hit">💥 المربع رقم ${boxIndex + 1} كشف اللاعب <b>${nameHtml(box.occupantName)}</b> — إقصاء فوري!</div>`);
    } else {
      appendLog(`<div class="log-item log-hit">💔 المربع رقم ${boxIndex + 1} كشف اللاعب <b>${nameHtml(box.occupantName)}</b> — راحت عليه فرصة، باقي له ${chancesLeft}</div>`);
    }
  } else {
    box.revealed = true;
    showSmashResult(boxIndex, 'empty');
    appendLog(`<div class="log-item log-safe">🛡️ المربع رقم ${boxIndex + 1} فارغ — نجاة، ما أحد يُقصى هالجولة</div>`);
  }

  gamePhase.value = 'ready';
  chosenPlayerName.value = null;
  // اللي أرسل هدية الرجوع وقت التكسير يرجع قبل ما ينحسم الفائز
  flushPendingRevives();
  checkWinner();
}

function canDeletePlayer(p) {
  return gamePhase.value !== 'ended' && gamePhase.value !== 'spinning' && gamePhase.value !== 'smashing' && p.alive;
}

function deletePlayer(name, viaChat = false) {
  const how = viaChat ? 'كتب "خروج" وانحذف من اللعبة' : 'تم حذفه يدوياً';
  if (gamePhase.value === 'registration') {
    const idx = masterPlayersList.findIndex((p) => p.name === name);
    if (idx === -1) return;
    masterPlayersList.splice(idx, 1);
    saveToStorage();
    return;
  }
  if (gamePhase.value === 'ended') return;

  const player = players.get(name);
  if (!player || !player.alive) return;
  player.alive = false;
  player.left = true;

  const own = hiddenBoxesOf(name);
  own.forEach((b) => { b.revealed = true; b.fatal = true; });
  if (own.length === 1) {
    appendLog(`<div class="log-item log-hit">🗑️ اللاعب <b>${nameHtml(name)}</b> ${how} — انكشف مربعه رقم ${own[0].index + 1}</div>`);
  } else if (own.length > 1) {
    appendLog(`<div class="log-item log-hit">🗑️ اللاعب <b>${nameHtml(name)}</b> ${how} — انكشفت مربعاته: ${own.map((b) => b.index + 1).join('، ')}</div>`);
  } else {
    appendLog(`<div class="log-item log-hit">🗑️ اللاعب <b>${nameHtml(name)}</b> ${how}</div>`);
  }

  if (chosenPlayerName.value === name) {
    stopSmash();
    stopPickTimer();
    chosenPlayerName.value = null;
    gamePhase.value = 'ready';
    flushPendingRevives();
  }
  checkWinner();
}

function checkWinner() {
  const alive = getAlivePlayers();
  if (alive.length > 1) return;

  gamePhase.value = 'ended';
  const logs = [];
  if (alive.length === 1) {
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 الفائز بلعبة عجلة مهدي: <b>${nameHtml(alive[0].name)}</b> 🏆</div>`);
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ff4757;">انتهت اللعبة بدون فائز!</div>');
  }
  appendLog(logs[0]);
  if (alive.length === 1) {
    winnerName.value = alive[0].name;
    logs.unshift(`<img src="/mahdi/${winnerFrame.value}.png" alt="" style="display:block; height:150px; margin:0 auto;">`);
  }
  openModal('🏁 نتيجة اللعبة', logs);
}

function resetGame() {
  resetSettingsConfirm();
  pendingRevives.clear();
  stopRegistration();
  stopChaseAnimation();
  stopSmash();
  stopPickTimer();
  clearSmashResult();
  winnerName.value = null;
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
  rotatingName.value = null;
  rotatingNameChosen.value = false;
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
  if (pickerStyle.value === 'names') return '🔄 اختيار اللاعب';
  return '🎡 تدوير العجلة';
});

const spinningBannerText = computed(() => {
  if (pickerStyle.value === 'grid') return '🔲 يتم اختيار اللاعب...';
  if (pickerStyle.value === 'avatars') return '🖼️ يتم اختيار اللاعب...';
  if (pickerStyle.value === 'names') return '🔄 يتم اختيار اللاعب...';
  return '🎡 العجلة تدور...';
});

const pickerBannerComputed = computed(() => {
  if (gamePhase.value === 'registration') return { text: 'سجّل اللاعبين ثم اضغط "إغلاق التسجيل وبناء اللوحة"', html: null };
  if (gamePhase.value === 'ready') return { text: `اضغط "${spinBtnLabel.value}" لاختيار من يفتح المربع القادم`, html: null };
  if (gamePhase.value === 'spinning') return { text: spinningBannerText.value, html: null };
  if (gamePhase.value === 'awaiting-pick') return { text: null, html: `🎯 دور <b>${nameHtml(chosenPlayerName.value)}</b>! يكتب رقم المربع بالدردشة${pickTimeLeft.value > 0 ? ` <b style="color:#ff6b6b; white-space:nowrap;">⏳ ${pickTimeLeft.value}</b>` : ''}` };
  if (gamePhase.value === 'smashing') return { text: null, html: `🔨 مهدي يكسر المربع رقم ${smashingIndex.value + 1} اللي اختاره <b>${nameHtml(chosenPlayerName.value)}</b>...` };
  return { text: '🏁 انتهت اللعبة — اضغط "إعادة اللعبة بالكامل" للبدء من جديد', html: null };
});
// مهدي نفسه فاز → وضعية الفوز الخاصة فيه، غيره → الاحتفال العادي
const winnerFrame = computed(() => (isMahdiName(winnerName.value) ? 'win' : 'cheer'));

// صورة مهدي جنب اللافتة حسب المرحلة: بداية الجولة (نظارة) | الدوران (يطالع العجلة) | الانتظار | النهاية
const bannerMahdiFrame = computed(() => {
  if (gamePhase.value === 'ready') return 'cool';
  if (gamePhase.value === 'ended') return winnerName.value ? winnerFrame.value : 'empty';
  if (gamePhase.value === 'spinning') return 'think';
  return WAIT_FRAMES[roundNumber.value % WAIT_FRAMES.length];
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
      name: p.name, avatar: p.avatar, status: '⏳ مسجل', alive: true, left: false, boxes: p.boxes, repeat: p.repeat,
    }));
  }
  return Array.from(players.values()).map((p) => {
    const boxCount = hiddenBoxesOf(p.name).length;
    return {
      name: p.name,
      avatar: p.avatar,
      status: p.alive ? `🙂 في اللعبة · 📦×${boxCount}` : '💀 مُقصى',
      alive: p.alive,
      left: p.left,
      boxes: boxCount,
      repeat: p.repeat,
    };
  });
});

const barExpanded = ref(true);

const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

// نافذة الإعدادات (نفس باقي الألعاب): تنفتح من زر "الإعدادات"، وتلقائياً أول مرة عند إغلاق التسجيل
const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(buildBoard);

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
    if (isLeaveComment(text)) {
      // نفس الحذف اليدوي: ينحذف بأي وقت، ولو اللعبة شغّالة ينكشف مربعه
      joinedUsers.delete(data.user);
      deletePlayer(data.user, true);
    } else if (phase === 'registration' && !joinViaGift.value && normalizeDigits(text) === normalizeDigits(getJoinKey())) {
      addPlayerFromTikTok(data.user, data.avatar);
    } else if (phase === 'awaiting-pick') {
      registerBoxPickFromComment(data.user, text);
    }
  }

  if (isGiftEvent(data)) handleGift(data, phase);
}

// هدية وحدة ممكن تخدم أكثر من غرض حسب حالة مرسلها: غير مسجل ← ينضم، لاعب حي ← مربع إضافي، مطرود ← رجوع
function handleGift(data, phase) {
  const user = getGiftUser(data);
  if (!user) return;
  const passes = (giftName) => giftPassesFilter(data, { nameFilter: giftName });

  if (phase === 'registration') {
    if (!masterPlayersList.some((p) => p.name === user)) {
      if (joinViaGift.value && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
        addPlayerFromTikTok(user, data.avatar);
      }
    } else if (buyBoxEnabled.value && passes(buyBoxGift.value)) {
      buyBoxFromGift(user);
    }
    return;
  }

  const player = players.get(user);
  if (!player) return;
  if (player.alive) {
    if (buyBoxEnabled.value && passes(buyBoxGift.value)) buyBoxFromGift(user);
  } else if (reviveEnabled.value && passes(reviveGift.value)) {
    revivePlayer(user, true);
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
    if (showModal_.value || settingsVisible.value) return;
    if (buildBoardBtnVisible.value) requestStart();
    else if (spinBtnVisible.value) spinWheel();
  }
}

onMounted(() => {
  updateRegistrationHint();
  // تحميل مسبق لصور مهدي عشان ما ترمش أول ضربة
  MAHDI_FRAMES.forEach((src) => { new Image().src = src; });
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage, (name) => masterPlayersList.some((p) => p.name === name));
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromTikTok(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  stopChaseAnimation();
  stopSmash();
  stopPickTimer();
  if (shuffleFxTimerId) clearTimeout(shuffleFxTimerId);
  clearSmashResult();
  clearMessageHandler();
});
</script>

<template>
  <h1>🎡 عجلة مهدي</h1>
  <div class="subtitle">منصة تحديات 956BR</div>
  <div class="wb-status-line">{{ boardInfoText }}</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
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
    <button v-if="buildBoardBtnVisible" class="master-btn side-panel-btn" id="buildBoardBtn" @click="requestStart">🔒 إغلاق التسجيل وبناء اللوحة</button>
    <button v-if="spinBtnVisible" class="master-btn side-panel-btn" id="spinBtn" @click="spinWheel">{{ spinBtnLabel }}</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ playersDisplay.length }}</span></button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ كلمة الانضمام: ${getJoinKey()}` }}</button>
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        :disabled="!registrationOpen && registrationLocked"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? `⛔ إيقاف التسجيل${registrationUnlimited ? '' : ` (${registrationTimeLeft})`}` : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ joinViaGift ? 'من يرسل هدية ينضم تلقائياً كلاعب.' : `من يكتب "${getJoinKey()}" بالدردشة ينضم تلقائياً كلاعب.` }}</label>
      <div class="join-settings-row" style="margin-top:0;">
        <div v-if="!isChatMode()" class="join-mode-seg">
          <button type="button" class="join-mode-btn" :class="{ active: !joinViaGift }" :disabled="registrationLocked" @click="joinViaGift = false">✍️ الانضمام بكتابة الكلمة</button>
          <button type="button" class="join-mode-btn" :class="{ active: joinViaGift }" :disabled="registrationLocked" @click="joinViaGift = true">🎁 الانضمام بإرسال هدية</button>
        </div>
        <input v-model="joinKeyInput" type="text" maxlength="10" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" :disabled="joinKeyDisabled">
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_CHOICES" :disabled="registrationLocked" />
      </div>
      <div class="field-hint">{{ joinKeyHint }}</div>
      <div class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationUnlimited || registrationLocked">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <label class="join-gift-toggle">
          <input v-model="registrationUnlimited" type="checkbox" :disabled="registrationOpen">
          ♾️ تسجيل مفتوح بدون وقت
        </label>
        <input v-if="registrationOpen && !registrationUnlimited" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen && !registrationUnlimited" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" start-label="🔒 إغلاق التسجيل وبناء اللوحة" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>

      <div class="adv-item" :class="{ disabled: registrationLocked }">
        <span>📦 <b>المربعات الفارغة</b> — مربعات ما وراها أحد، واللي يفتحها ما يطرد أحد. العدد يتحدد عشوائياً وقت بناء اللوحة، وينقفل بعد إغلاق التسجيل.</span>
        <div class="adv-seg">
          <button
            v-for="m in EMPTY_MODES"
            :key="m.id"
            type="button"
            class="adv-seg-btn"
            :class="{ active: emptyMode === m.id }"
            :disabled="registrationLocked"
            @click="emptyMode = m.id"
          >{{ m.label }}</button>
        </div>
      </div>

      <div class="adv-item" :class="{ checked: pickTimerEnabled }">
        <label class="adv-item-label">
          <input v-model="pickTimerEnabled" type="checkbox">
          <span>⏱️ <b>مؤقت اختيار المربع</b> — لو خلص الوقت واللاعب ما كتب رقم، مهدي يفتح له مربع عشوائي.</span>
        </label>
        <div v-if="pickTimerEnabled" class="adv-item-extra">
          <input v-model="pickTimerSeconds" type="number" min="5" max="300">
          <div class="field-hint">مدة الاختيار بالثواني.</div>
        </div>
      </div>
    </div>

    <div v-if="!isChatMode()" class="adv-group gifts">
      <div class="adv-group-title">🎁 الهدايا</div>

      <div class="adv-columns">
        <div class="adv-item" :class="{ checked: buyBoxEnabled }">
          <label class="adv-item-label">
            <input v-model="buyBoxEnabled" type="checkbox">
            <span>📦 <b>شراء مربع إضافي</b> — اللاعب اللي يرسل الهدية ياخذ مربع زيادة (فرصة زيادة)، وباللعبة تتوزع المربعات المقفلة من جديد.</span>
          </label>
          <div v-if="buyBoxEnabled" class="adv-item-extra">
            <CustomSelect v-model="buyBoxGift" :options="GIFT_CHOICES" />
            <input v-model="buyBoxMax" type="number" min="1" max="10">
            <div class="field-hint">الحد الأقصى للمربعات اللي يشتريها اللاعب الواحد.</div>
          </div>
        </div>

        <div class="adv-item" :class="{ checked: reviveEnabled }">
          <label class="adv-item-label">
            <input v-model="reviveEnabled" type="checkbox">
            <span>🔄 <b>الرجوع للعبة</b> — المطرود اللي يرسل الهدية يرجع بفرصة وحدة: ينقلب مربعه ويتغطى معه مربع فارغ واحد من المكشوفة، وتنخلط كل المربعات المغطاة. ما يشتغل بعد إعلان الفائز.</span>
          </label>
          <div v-if="reviveEnabled" class="adv-item-extra">
            <CustomSelect v-model="reviveGift" :options="GIFT_CHOICES" />
          </div>
        </div>
      </div>
    </div>
  </SettingsOverlay>

  <div class="layout-wrapper">
    <div v-if="gamePhase === 'registration'" class="panel">
      <img class="wb-register-mahdi" src="/mahdi/register.png" alt="" aria-hidden="true">
      <div class="wb-picker-banner">{{ pickerBannerComputed.text }}</div>
    </div>

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
        <button
          type="button"
          class="wb-style-btn"
          :class="{ active: pickerStyle === 'names' }"
          :disabled="gamePhase === 'spinning'"
          @click="pickerStyle = 'names'"
        >🔄 الأسماء الدوارة</button>
      </div>

      <div v-if="pickerStyle === 'wheel'" class="wb-wheel-wrap">
        <div class="wb-wheel-pointer"></div>
        <div
          class="wb-wheel-dial"
          :style="{ background: wheelDialBackground, transform: `rotate(${wheelRotationDisplay}deg)`, transition: wheelTransitionEnabled ? 'transform 4.5s cubic-bezier(0.12, 0.67, 0.1, 0.99)' : 'none' }"
        >
          <div class="wb-wheel-label">
            <span v-for="(label, labelIndex) in wheelLabels" :key="labelIndex" :style="label.style"><bdi>{{ displayName(label.name) }}</bdi></span>
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
          <span class="wb-square-name"><bdi>{{ displayName(cell.name) }}</bdi></span>
        </div>
      </div>

      <div v-else-if="pickerStyle === 'names'" class="wb-rotating-names">
        <div class="wb-rotating-name" :class="{ 'wb-rotating-name-chosen': rotatingNameChosen }">
          <template v-if="rotatingName">
            <img v-if="rotatingName.avatar" :src="rotatingName.avatar" class="wb-rotating-avatar" alt="">
            <span><bdi>{{ displayName(rotatingName.name) }}</bdi></span>
          </template>
          <span v-else class="wb-rotating-placeholder">🔄 بانتظار الاختيار...</span>
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
        <img :key="bannerMahdiFrame" class="wb-banner-mahdi" :src="`/mahdi/${bannerMahdiFrame}.png`" alt="" aria-hidden="true">
        <div class="wb-picker-banner-text">
          <span v-if="pickerBannerComputed.html" v-html="pickerBannerComputed.html"></span>
          <template v-else>{{ pickerBannerComputed.text }}</template>
        </div>
      </div>
    </div>

    <div v-if="gridPanelVisible" class="panel" style="display:flex;">
      <h2>🔢 شبكة المربعات</h2>
      <div class="wb-grid" :class="{ 'wb-shuffling': shuffleFx }">
        <div
          v-for="box in boxes"
          :key="box.index"
          class="wb-box"
          :class="{ 'wb-revealed': box.revealed, 'wb-locked': !gridClickable || box.revealed, 'wb-smashing': box.index === smashingIndex, 'wb-mahdi-host': box.index === smashingIndex || (smashResult && smashResult.index === box.index) }"
          @click="handleBoxClick(box.index)"
        >
          <template v-if="box.index === smashingIndex">
            <svg class="wb-crack" viewBox="0 0 100 100" aria-hidden="true">
              <path class="wb-crack-1" d="M50 22 L44 38 L55 47 L46 62 L52 80 M44 38 L28 44 M55 47 L74 42" />
              <path class="wb-crack-2" d="M46 62 L26 70 L18 86 M52 80 L70 88 M74 42 L88 30 M28 44 L14 34 M55 47 L66 64 L84 68" />
            </svg>
            <img class="wb-mahdi wb-mahdi-windup" src="/mahdi/windup.png" alt="" aria-hidden="true">
            <img class="wb-mahdi wb-mahdi-slam" src="/mahdi/slam.png" alt="" aria-hidden="true">
          </template>
          <img
            v-else-if="smashResult && smashResult.index === box.index"
            class="wb-mahdi wb-mahdi-result"
            :class="`wb-mahdi-${smashResult.kind}`"
            :src="`/mahdi/${smashResult.kind}.png`"
            alt=""
            aria-hidden="true"
          >
          <div class="wb-box-inner">
            <div class="wb-box-face wb-box-front" :style="boxFrontStyle(box)">{{ box.index + 1 }}</div>
            <div class="wb-box-face wb-box-back" :class="!box.revealed ? 'is-hidden' : (box.occupantName ? 'is-player' : 'is-empty')">
              <!-- وجه المربع الخلفي يبقى فاضي لين ينكشف، عشان ما يبان اللي وراه وقت إعادة التوزيع -->
              <template v-if="!box.revealed"></template>
              <template v-else-if="box.occupantName">{{ box.fatal ? '💀' : '💔' }}<br><bdi>{{ displayName(box.occupantName) }}</bdi></template>
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
          <span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt=""><bdi>{{ displayName(p.name) }}</bdi></span>
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
      <div v-if="registrationLocked" class="field-hint" style="margin:0 0 8px;">🔒 الإضافة مقفولة بعد إغلاق التسجيل — اضغط "إعادة اللعبة بالكامل" لتعديل القائمة من جديد.</div>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" :disabled="registrationLocked" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" :disabled="registrationLocked" @click="addPlayer">➕ إضافة</button>
      </div>
      <div v-if="playersDisplay.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-if="playersDisplay.length" class="field-hint" style="margin-top:10px;">📦 عدد مربعات اللاعب (كل مربع فرصة له) · 🎡 تكرار اسمه في العجلة</div>
      <div v-if="playersDisplay.length" class="players-modal-list">
        <div v-for="p in playersDisplay" :key="p.name" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt=""><bdi>{{ displayName(p.name) }}</bdi> <span v-if="!p.alive" style="opacity:0.7;">{{ p.status }}</span></span>
          <div class="players-modal-perks">
            <div v-if="p.alive" class="rule-repeat" title="عدد مربعات اللاعب — كل مربع فرصة له">
              <span>📦</span>
              <button type="button" :disabled="registrationLocked || p.boxes <= 1" @click="changeBoxes(p.name, -1)">−</button>
              <span>×{{ p.boxes }}</span>
              <button type="button" :disabled="p.boxes >= MAX_PLAYER_BOXES || gamePhase === 'ended' || gamePhase === 'smashing'" @click="changeBoxes(p.name, 1)">+</button>
            </div>
            <div v-if="p.alive" class="rule-repeat" title="تكرار الاسم في العجلة — فرصة أكبر يطلع اسمه">
              <span>🎡</span>
              <button type="button" :disabled="p.repeat <= 1" @click="changeRepeat(p.name, -1)">−</button>
              <span>×{{ p.repeat }}</span>
              <button type="button" :disabled="p.repeat >= MAX_NAME_REPEAT" @click="changeRepeat(p.name, 1)">+</button>
            </div>
            <button v-if="canRevivePlayer(p)" type="button" class="players-modal-remove-btn wb-revive-btn" title="يرجع بفرصة وحدة وتتوزع المربعات من جديد" @click="revivePlayer(p.name)">🔄 إرجاع</button>
            <button v-if="canDeletePlayer(p)" type="button" class="players-modal-remove-btn" title="حذف اللاعب وكشف مربعاته" @click="deletePlayer(p.name)">🗑️ حذف</button>
          </div>
        </div>
      </div>
      <button v-if="!(gamePhase !== 'registration') && masterPlayersList.length" class="reset-btn" style="width:100%; margin-top:10px;" @click="clearPlayers">🧹 مسح كل اللاعبين</button>
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

input, select {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 1rem;
  outline: none;
}

input:disabled, select:disabled, button:disabled {
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
  flex-wrap: wrap;
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

.wb-rotating-names {
  width: 100%;
  max-width: 340px;
  margin: 0 auto 16px;
  background: rgba(0, 0, 0, 0.5);
  border: 2px dashed var(--primary-color);
  border-radius: 12px;
  padding: 20px 15px;
  min-height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wb-rotating-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 1.8rem;
  font-weight: bold;
  color: #f1c40f;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  word-break: break-word;
  transition: transform 0.2s;
}

.wb-rotating-name-chosen {
  color: #f39c12;
  animation: wb-square-pulse 0.8s ease-in-out infinite;
}

.wb-rotating-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #fff;
  flex-shrink: 0;
}

.wb-rotating-placeholder {
  font-size: 1.1rem;
  color: #8b93a3;
  text-shadow: none;
}

.wb-register-mahdi {
  height: 190px;
  max-width: 100%;
  object-fit: contain;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
  animation: wb-banner-mahdi-in 0.3s ease-out;
}

.wb-banner-mahdi {
  height: 84px;
  width: auto;
  flex: none;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
  animation: wb-banner-mahdi-in 0.3s ease-out;
}

@keyframes wb-banner-mahdi-in {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}

.wb-picker-banner-text {
  flex: 1;
  min-width: 0;
}

.wb-picker-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
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
.wb-box-back.is-hidden { background: #1e1e2f; }

/* إعادة توزيع المربعات المقفلة: هزّة قصيرة توضّح إن الأماكن تغيّرت */
.wb-shuffling .wb-box:not(.wb-revealed):not(.wb-smashing) {
  animation: wb-box-shuffle 0.7s ease-in-out;
}

@keyframes wb-box-shuffle {
  0%, 100% { transform: scale(1) rotate(0); }
  25% { transform: scale(0.82) rotate(-10deg); }
  50% { transform: scale(0.9) rotate(8deg); }
  75% { transform: scale(0.82) rotate(-6deg); }
}

.players-modal-item { flex-wrap: wrap; }

.players-modal-perks {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-inline-start: auto;
}

.rule-repeat {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  direction: ltr;
  color: #f1c40f;
  font-weight: bold;
}

.rule-repeat button {
  width: 26px;
  height: 26px;
  padding: 0;
  margin: 0;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.rule-repeat button:disabled { opacity: 0.35; cursor: not-allowed; }

.wb-revive-btn { background: var(--success-color); }
.wb-revive-btn:hover { background: #1e8449; }

/* ===== مهدي يكسر المربع: ضربة وحدة بالمطرقة ثم ينقلب المربع ===== */
.wb-box.wb-mahdi-host {
  position: relative;
  z-index: 6;
}

.wb-box.wb-smashing .wb-box-inner {
  transition: none;
  animation: wb-box-shake 0.6s linear both;
}

@keyframes wb-box-shake {
  0%, 56%, 100% { transform: translate(0, 0) rotate(0); }
  60% { transform: translate(-3px, 4px) rotate(-3deg) scale(0.92); }
  72% { transform: translate(3px, 1px) rotate(3deg); }
  86% { transform: translate(-2px, 0) rotate(-1deg); }
}

.wb-mahdi {
  position: absolute;
  height: auto;
  max-width: none;
  pointer-events: none;
  z-index: 3;
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.6));
}

/* رفع المطرقة: يطلع فوق المربع ثم ينزل عليه */
.wb-mahdi-windup {
  width: 150%;
  left: -25%;
  bottom: 35%;
  animation: wb-mahdi-windup 0.6s ease-in both;
}

@keyframes wb-mahdi-windup {
  0% { opacity: 1; transform: translateY(-12%) rotate(-4deg) scale(0.9); }
  38% { opacity: 1; transform: translateY(-26%) rotate(-10deg) scale(1); }
  57% { opacity: 1; transform: translateY(14%) rotate(8deg) scale(1); }
  58%, 100% { opacity: 0; transform: translateY(14%) rotate(8deg) scale(1); }
}

/* الضربة: راس المطرقة والانفجار على وسط المربع */
.wb-mahdi-slam {
  width: 170%;
  left: -35%;
  top: -62%;
  animation: wb-mahdi-slam 0.6s ease-out both;
}

@keyframes wb-mahdi-slam {
  0%, 57% { opacity: 0; transform: scale(0.85); }
  58% { opacity: 1; transform: scale(0.85); }
  70% { opacity: 1; transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}

/* تعبير النتيجة: فوق المربع عشان ما يغطي اللي انكشف */
.wb-mahdi-result {
  bottom: 55%;
  transform-origin: 50% 100%;
  animation: wb-mahdi-result 1.5s ease-out both;
}

.wb-mahdi-caught { width: 115%; left: -25%; }
.wb-mahdi-empty { width: 130%; left: -15%; }
.wb-mahdi-mock { width: 120%; left: -20%; }
.wb-mahdi-angry {
  width: 95%;
  left: 2%;
  animation: wb-mahdi-result 1.5s ease-out both, wb-mahdi-rage 0.12s linear 0.3s 8;
}

@keyframes wb-mahdi-rage {
  0%, 100% { rotate: 0deg; translate: 0 0; }
  25% { rotate: -6deg; translate: -3px 0; }
  75% { rotate: 6deg; translate: 3px 0; }
}

@keyframes wb-mahdi-result {
  0% { opacity: 0; transform: scale(0.4); }
  12% { opacity: 1; transform: scale(1.12); }
  20%, 82% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.9) translateY(-10%); }
}

.wb-crack {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}

.wb-crack path {
  fill: none;
  stroke: #1e1e2f;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  animation: wb-crack-show 0.1s linear forwards;
}

.wb-crack-1 { animation-delay: 0.35s; }
.wb-crack-2 { animation-delay: 0.42s; }

@keyframes wb-crack-show {
  to { opacity: 0.85; }
}

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
