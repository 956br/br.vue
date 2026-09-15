<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';

const router = useRouter();
const STORAGE_KEY = 'radarGame_players';

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
const tiktokJoinedUsers = new Set();

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(masterPlayersList)); } catch (e) { /* noop */ }
}

const gamePhase = ref('setup'); // setup | hiding | hunting | strike-result | ended
const players = reactive(new Map()); // id -> {id,name,alive,cellIndex,afkStreak,eliminatedReason}
const cells = reactive([]); // {index, destroyed, occupantId}
const gridN = ref(0);
const roundNumber = ref(0);
let roundDuration = 20;
const hidingTimeLeft = ref(0);
let hidingCountdown = null;
const weapons = reactive({ area: null, line: null, snipe: null });
const selectedWeapon = ref(null);
const armedPlayerId = ref(null);
const eventLog = ref([]);
let modalConfirmCallback = null;
const modalConfirmText = ref('موافق');
const huntAlertVisible = ref(false);
const hoveredIdx = ref(null);

const namesInput = ref(masterPlayersList.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const gridSizeInput = ref(1);
const roundDurationInput = ref(20);

function getAlivePlayers() {
  return Array.from(players.values()).filter((p) => p.alive);
}
function findPlayerByName(name) {
  for (const p of players.values()) if (p.name === name) return p;
  return null;
}

const controlsDisabled = computed(() => gamePhase.value !== 'setup');
const namesHint = computed(() => (controlsDisabled.value
  ? '🔒 مقفول بعد بدء اللعبة — اضغط "إعادة اللعبة" لتعديل القائمة من جديد.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل بعد بدء اللعبة.'));

function computeMinGridN() {
  return Math.max(1, Math.ceil(Math.sqrt(masterPlayersList.length || 1)));
}
function updateGridSizeSuggestion() {
  const minN = computeMinGridN();
  const current = parseInt(gridSizeInput.value, 10);
  if (Number.isNaN(current) || current < minN) gridSizeInput.value = minN;
}
const gridSizeHint = computed(() => {
  const minN = computeMinGridN();
  return `الحد الأدنى الحالي: ${minN}×${minN} (${minN * minN} مربع) — عدّل الرقم لتكبير الشبكة إذا تبي`;
});

function updateTextareaFromPlayers() {
  namesInput.value = masterPlayersList.map((p) => p.name).join('\n');
}
function syncTextareaToPlayers() {
  if (gamePhase.value !== 'setup') return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];
  if (names.length === 0) {
    masterPlayersList.splice(0, masterPlayersList.length);
    saveToStorage();
    updateGridSizeSuggestion();
    return;
  }
  const newList = names.map((name) => {
    const existing = masterPlayersList.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name };
  });
  masterPlayersList.splice(0, masterPlayersList.length, ...newList);
  saveToStorage();
  updateGridSizeSuggestion();
}

const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() {
  showModal_.value = false;
  const cb = modalConfirmCallback;
  modalConfirmCallback = null;
  modalConfirmText.value = 'موافق';
  if (cb) cb();
}

function addPlayer() {
  if (gamePhase.value !== 'setup') return;
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
  updateGridSizeSuggestion();
}

function addPlayerFromTikTok(name) {
  if (gamePhase.value !== 'setup' || !name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);
  if (masterPlayersList.some((p) => p.name === name)) return;
  masterPlayersList.push({ id: playerIdCounter++, name });
  updateTextareaFromPlayers();
  saveToStorage();
  updateGridSizeSuggestion();
}

function startGame() {
  if (gamePhase.value !== 'setup') return;
  if (masterPlayersList.length < 1) {
    openModal('تنبيه', ['<div class="log-item">تحتاج تسجيل لاعب واحد على الأقل قبل بدء اللعبة!</div>']);
    return;
  }

  players.clear();
  masterPlayersList.forEach((p) => {
    players.set(p.id, reactive({
      id: p.id, name: p.name, alive: true, cellIndex: null, afkStreak: 0, eliminatedReason: null,
    }));
  });

  const minN = computeMinGridN();
  let chosenN = parseInt(gridSizeInput.value, 10);
  if (Number.isNaN(chosenN) || chosenN < minN) chosenN = minN;
  gridN.value = chosenN;
  cells.splice(0, cells.length, ...Array.from({ length: chosenN * chosenN }, (_, i) => ({
    index: i, destroyed: false, occupantId: null,
  })));

  const totalCells = cells.length;
  const scale = totalCells / 25;
  const multiCellWeaponsUnlocked = gridN.value > 5;
  weapons.area = {
    charges: multiCellWeaponsUnlocked ? Math.max(1, Math.round(3 * scale)) : 0, baseDims: [3, 2], altDims: [2, 3], orientationAlt: false,
  };
  weapons.line = {
    charges: multiCellWeaponsUnlocked ? Math.max(1, Math.round(4 * scale)) : 0, baseDims: [3, 1], altDims: [1, 3], orientationAlt: false,
  };
  weapons.snipe = {
    charges: Math.max(1, Math.round(25 * scale)), baseDims: [1, 1], altDims: [1, 1], orientationAlt: false,
  };

  roundNumber.value = 0;
  selectedWeapon.value = null;
  armedPlayerId.value = null;
  eventLog.value = [];
  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🎮 بدأت اللعبة بـ ${players.size} لاعب — حجم الشبكة: ${gridN.value}×${gridN.value} (${cells.length} مربع)</div>`);

  startHidingRound();
}

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 5) val = 5;
  if (val > 180) val = 180;
  roundDurationInput.value = val;
  return val;
}

function startHidingRound() {
  roundNumber.value++;
  cells.forEach((c) => { if (!c.destroyed) c.occupantId = null; });
  getAlivePlayers().forEach((p) => { p.cellIndex = null; });

  gamePhase.value = 'hiding';
  selectedWeapon.value = null;
  armedPlayerId.value = null;
  roundDuration = getRoundDuration();
  hidingTimeLeft.value = roundDuration;

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🕵️ الجولة ${roundNumber.value}: باب الاختباء مفتوح (${roundDuration} ثانية)</div>`);

  startHidingTimer();
}

function startHidingTimer() {
  if (hidingCountdown) clearInterval(hidingCountdown);
  hidingCountdown = setInterval(() => {
    hidingTimeLeft.value--;
    if (hidingTimeLeft.value <= 0) {
      clearInterval(hidingCountdown);
      hidingCountdown = null;
      resolveHiding();
    }
  }, 1000);
}

function claimCell(playerId, cellIndex) {
  if (gamePhase.value !== 'hiding') return false;
  const player = players.get(playerId);
  if (!player || !player.alive || player.cellIndex !== null) return false;
  const cell = cells[cellIndex];
  if (!cell || cell.destroyed || cell.occupantId !== null) return false;
  cell.occupantId = playerId;
  player.cellIndex = cellIndex;
  player.afkStreak = 0;
  return true;
}

function handleManualHideClick(idx) {
  if (!armedPlayerId.value) return;
  if (claimCell(armedPlayerId.value, idx)) armedPlayerId.value = null;
}

function armPlayer(id) {
  if (gamePhase.value !== 'hiding') return;
  const p = players.get(id);
  if (!p || !p.alive || p.cellIndex !== null) return;
  armedPlayerId.value = (armedPlayerId.value === id) ? null : id;
}

function parseCellNumber(text, maxN) {
  const normalized = normalizeDigits(text);
  const matches = normalized.match(/\d+/g);
  if (!matches) return null;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n >= 1 && n <= maxN) return n;
  }
  return null;
}

function registerCellClaimFromComment(username, rawText) {
  if (gamePhase.value !== 'hiding' || !username || !rawText) return;
  const player = findPlayerByName(username);
  if (!player || !player.alive || player.cellIndex !== null) return;
  const num = parseCellNumber(rawText, cells.length);
  if (num === null) return;
  claimCell(player.id, num - 1);
}

function resolveHiding() {
  const alive = getAlivePlayers();
  const stragglers = alive.filter((p) => p.cellIndex === null);
  const freeCells = shuffleArray(cells.filter((c) => !c.destroyed && c.occupantId === null));

  const logs = [];
  const selfHidCount = alive.length - stragglers.length;
  logs.push(`<div class="log-item" style="text-align:center;">🙈 اختبأ بنفسه: <b>${selfHidCount}</b> | 🎲 يحتاجون توزيع عشوائي: <b>${stragglers.length}</b></div>`);

  stragglers.forEach((p) => {
    if (freeCells.length === 0) {
      p.alive = false;
      p.eliminatedReason = 'لا توجد أماكن اختباء متبقية';
      logs.push(`<div class="log-item log-miss">⚠️ <b>${escapeHtml(p.name)}</b> ما لقى مكان يختبي فيه وأُقصي من اللعبة!</div>`);
      return;
    }
    const cell = freeCells.pop();
    p.afkStreak = (p.afkStreak || 0) + 1;
    if (p.afkStreak >= 2) {
      p.alive = false;
      p.eliminatedReason = 'إقصاء بسبب الاعتماد على التوزيع العشوائي مرتين متتاليتين';
      logs.push(`<div class="log-item log-miss">😴 <b>${escapeHtml(p.name)}</b> اعتمد على التوزيع العشوائي مرتين متتاليتين — إقصاء نهائي!</div>`);
      freeCells.push(cell);
    } else {
      cell.occupantId = p.id;
      p.cellIndex = cell.index;
      logs.push(`<div class="log-item" style="color:#f1c40f;">🎲 <b>${escapeHtml(p.name)}</b> تم توزيعه عشوائياً (تحذير: مرة ثانية = إقصاء)</div>`);
    }
  });

  logs.forEach((l) => eventLog.value.push(l));

  const stillAlive = getAlivePlayers();
  if (stillAlive.length === 0) {
    endGame([]);
    return;
  }

  triggerHuntTransition();
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.3, 0.6].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, now + t);
      gain.gain.setValueAtTime(0.15, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.3);
    });
  } catch (e) { /* noop */ }
}

function triggerHuntTransition() {
  playAlertSound();
  huntAlertVisible.value = true;
  setTimeout(() => {
    huntAlertVisible.value = false;
    gamePhase.value = 'hunting';
    appendLog('<div class="log-item" style="text-align:center; color:#ff4757; font-weight:bold;">🎯 بدأت مرحلة الصيد! اختر سلاحاً وانقر على الشبكة</div>');
  }, 2200);
}

function currentDims(weaponKey) {
  const w = weapons[weaponKey];
  return w.orientationAlt ? w.altDims : w.baseDims;
}

function computeShapeCells(anchorIndex, w, h) {
  const N = gridN.value;
  const ww = Math.min(w, N);
  const hh = Math.min(h, N);
  const anchorRow = Math.floor(anchorIndex / N);
  const anchorCol = anchorIndex % N;
  const startRow = Math.max(Math.min(anchorRow, N - hh), 0);
  const startCol = Math.max(Math.min(anchorCol, N - ww), 0);
  const list = [];
  for (let r = startRow; r < startRow + hh; r++) {
    for (let c = startCol; c < startCol + ww; c++) list.push(r * N + c);
  }
  return list;
}

function selectWeapon(key) {
  if (gamePhase.value !== 'hunting') return;
  if (weapons[key].charges <= 0) return;
  selectedWeapon.value = (selectedWeapon.value === key) ? null : key;
}

function rotateWeapon(key) {
  weapons[key].orientationAlt = !weapons[key].orientationAlt;
}

const highlightedSet = computed(() => {
  if (gamePhase.value !== 'hunting' || !selectedWeapon.value || hoveredIdx.value === null) return new Set();
  const [w, h] = currentDims(selectedWeapon.value);
  return new Set(computeShapeCells(hoveredIdx.value, w, h));
});

function onCellMouseOver(idx) {
  hoveredIdx.value = idx;
}
function onGridMouseLeave() {
  hoveredIdx.value = null;
}

function handleStrikeClick(idx) {
  if (!selectedWeapon.value) return;
  const weapon = weapons[selectedWeapon.value];
  if (weapon.charges <= 0) return;
  performStrike(selectedWeapon.value, idx);
}

function onCellClick(idx) {
  if (gamePhase.value === 'hiding') handleManualHideClick(idx);
  else if (gamePhase.value === 'hunting') handleStrikeClick(idx);
}

function strike(cellIndexes) {
  const hits = [];
  cellIndexes.forEach((idx) => {
    const cell = cells[idx];
    if (!cell) return;
    if (!cell.destroyed && cell.occupantId !== null) {
      const player = players.get(cell.occupantId);
      if (player) {
        player.alive = false;
        player.eliminatedReason = 'أصيب بالقصف 💥';
        player.cellIndex = null;
        hits.push(player.name);
      }
      cell.occupantId = null;
    }
    cell.destroyed = true;
  });
  return hits;
}

function buildStrikeLogHtml(weaponKey, targetCount, hitNames) {
  const weaponNames = { area: 'قصف منطقة 🧨', line: 'قصف خطي ➖', snipe: 'قنص 🎯' };
  if (hitNames.length > 0) {
    return `<div class="log-item log-hit">💥 ${weaponNames[weaponKey]} أصاب: <b>${hitNames.map((n) => escapeHtml(n)).join('، ')}</b> (${targetCount} مربع تدمر)</div>`;
  }
  return `<div class="log-item" style="color:#8b93a3;">🌫️ ${weaponNames[weaponKey]} ضرب ${targetCount} مربع فارغ — ولا إصابة</div>`;
}

function performStrike(weaponKey, anchorIdx) {
  const weapon = weapons[weaponKey];
  const [w, h] = currentDims(weaponKey);
  const targets = computeShapeCells(anchorIdx, w, h);
  weapon.charges--;
  const hitNames = strike(targets);
  const logHtml = buildStrikeLogHtml(weaponKey, targets.length, hitNames);
  appendLog(logHtml);

  selectedWeapon.value = null;
  hoveredIdx.value = null;

  const alive = getAlivePlayers();
  const totalCharges = Object.values(weapons).reduce((s, wp) => s + wp.charges, 0);

  if (alive.length === 0) { endGame([]); return; }
  if (totalCharges === 0) { endGame(alive); return; }

  gamePhase.value = 'strike-result';
  modalConfirmText.value = '▶️ جولة اختباء جديدة';
  modalConfirmCallback = () => beginNextHidingRoundOrEnd();
  openModal(`نتيجة جولة القصف - الجولة ${roundNumber.value}`, [logHtml]);
}

function beginNextHidingRoundOrEnd() {
  const alive = getAlivePlayers();
  if (alive.length === 0) { endGame([]); return; }
  const freeCount = cells.filter((c) => !c.destroyed).length;
  if (freeCount === 0) { endGame(alive); return; }
  startHidingRound();
}

function endGame(survivors) {
  if (hidingCountdown) { clearInterval(hidingCountdown); hidingCountdown = null; }
  gamePhase.value = 'ended';
  selectedWeapon.value = null;
  const logs = [];
  if (survivors.length > 0) {
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 انتهت اللعبة! الناجون: <b>${survivors.map((p) => escapeHtml(p.name)).join('، ')}</b> 🏆</div>`);
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ff4757;">💀 انتهت اللعبة — تم اكتشاف جميع اللاعبين، لا يوجد ناجون!</div>');
  }
  appendLog(logs[0]);
  modalConfirmCallback = null;
  modalConfirmText.value = 'موافق';
  openModal('🏁 نتيجة اللعبة النهائية', logs);
}

function resetGame() {
  if (hidingCountdown) clearInterval(hidingCountdown);
  hidingCountdown = null;
  gamePhase.value = 'setup';
  players.clear();
  cells.splice(0, cells.length);
  gridN.value = 0;
  roundNumber.value = 0;
  selectedWeapon.value = null;
  armedPlayerId.value = null;
  weapons.area = null; weapons.line = null; weapons.snipe = null;
  eventLog.value = [];
  tiktokJoinedUsers.clear();
  stopRegistration();
  huntAlertVisible.value = false;
  updateGridSizeSuggestion();
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const captionText = computed(() => {
  if (gamePhase.value === 'setup') return 'سجّل اللاعبين ثم اضغط "بدء اللعبة" لبناء الشبكة تلقائياً';
  if (gamePhase.value === 'hiding') return `🕵️ باب الاختباء مفتوح — اكتب رقم المربع في الدردشة (من 1 إلى ${cells.length})`;
  if (gamePhase.value === 'hunting') return 'مرحلة الصيد جارية — اختر سلاحاً من الأسفل ثم مرر الماوس وانقر على الشبكة (ضربة واحدة تنهي الجولة)';
  if (gamePhase.value === 'strike-result') return 'تم القصف! جاري عرض نتيجة الجولة...';
  return 'انتهت اللعبة — اضغط "إعادة اللعبة" للبدء من جديد';
});
// eslint-disable-next-line vue/no-side-effects-in-computed-properties
const timerComputed = computed(() => {
  if (gamePhase.value === 'setup') return { text: '--', urgent: false };
  if (gamePhase.value === 'hiding') return { text: String(hidingTimeLeft.value), urgent: hidingTimeLeft.value <= 5 };
  if (gamePhase.value === 'hunting') return { text: '🎯', urgent: false };
  if (gamePhase.value === 'strike-result') return { text: '💥', urgent: false };
  return { text: '🏁', urgent: false };
});

const gridSizeInfo = computed(() => (cells.length ? `حجم الشبكة: ${gridN.value}×${gridN.value} (${cells.length} مربع)` : ''));

const weaponDefs = [
  {
    key: 'area', icon: '🧨', label: 'قصف منطقة', rotatable: true,
  },
  {
    key: 'line', icon: '➖', label: 'قصف خطي', rotatable: true,
  },
  {
    key: 'snipe', icon: '🎯', label: 'قنص', rotatable: false,
  },
];
const weaponsToolbarVisible = computed(() => gamePhase.value === 'hunting');

const waitingPlayers = computed(() => getAlivePlayers().filter((p) => p.cellIndex === null));
const awaitingChipsVisible = computed(() => gamePhase.value === 'hiding' && waitingPlayers.value.length > 0);

const alivePlayersDisplay = computed(() => Array.from(players.values()).filter((p) => p.alive));
const deadPlayersDisplay = computed(() => Array.from(players.values()).filter((p) => !p.alive));
function statusTextFor(p) {
  if (gamePhase.value === 'hiding') return p.cellIndex !== null ? '✅ اختبأ' : '⏳ ينتظر';
  return '🙈 مختبئ';
}

const startBtnVisible = computed(() => gamePhase.value === 'setup');
const forceEndBtnVisible = computed(() => ['hiding', 'hunting', 'strike-result'].includes(gamePhase.value));

const showRulesOverlay = ref(false);
function goHome() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordInput = ref('بلعب');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

function getJoinWord() { return joinWordInput.value.trim() || 'بلعب'; }
const joinModeHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية قبل بدء اللعبة ينضم تلقائياً كلاعب.'
  : `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم كلاعب قبل بدء اللعبة.`));
const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً كلاعب، وبعد بدء اللعبة يكتب رقم المربع اللي يبي يختبي فيه'
  : `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب، وبعد بدء اللعبة يكتب رقم المربع اللي يبي يختبي فيه`));

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

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }

    if (data.comment) {
      const text = data.comment.trim();
      if (gamePhase.value === 'setup') {
        if (registrationOpen.value && !joinViaGift.value && text === getJoinWord()) {
          addPlayerFromTikTok(data.user);
        }
      } else if (gamePhase.value === 'hiding') {
        registerCellClaimFromComment(data.user, text);
      }
    }

    if (registrationOpen.value && gamePhase.value === 'setup' && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {
  updateGridSizeSuggestion();
});
onUnmounted(() => {
  if (hidingCountdown) clearInterval(hidingCountdown);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="controlsDisabled" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">{{ tiktokSectionLabel }}</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordInput" type="text" placeholder="كلمة الانضمام (افتراضياً: بلعب)" :disabled="joinViaGift">
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
    <div class="field-hint">{{ joinModeHint }}</div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label for="gridSizeInput">🔲 حجم الشبكة (N×N) — يُقترح تلقائياً من عدد اللاعبين، ويحق للمستضيف تكبيره:</label>
    <div class="round-time-row">
      <input v-model="gridSizeInput" type="number" min="1" :disabled="controlsDisabled" @change="updateGridSizeSuggestion">
      <div class="field-hint" style="margin-top:0;">{{ gridSizeHint }}</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة كل جولة اختباء بالثواني (يحددها المستضيف):</label>
    <div class="round-time-row">
      <input v-model="roundDurationInput" type="number" min="5" max="180">
      <div class="field-hint" style="margin-top:0;">بعد انتهاء هذا الوقت يُغلق باب الاختباء وتُوزَّع الأماكن الفارغة عشوائياً.</div>
    </div>
  </div>

  <h1>📡 رادار الإقصاء</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>
  <div class="grid-size-info">{{ gridSizeInfo }}</div>

  <div class="master-controls">
    <button v-if="startBtnVisible" class="master-btn" @click="startGame">🎮 بدء اللعبة (بناء الشبكة)</button>
    <button v-if="forceEndBtnVisible" class="master-btn" style="background:#8A1538;" @click="endGame(getAlivePlayers())">🏁 إنهاء اللعبة الآن</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber || 0 }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>ساحة اللعب</h2>
      <div class="game-arena">
        <div class="timer-display" :class="{ urgent: timerComputed.urgent }">{{ timerComputed.text }}</div>
        <div class="hh-caption">{{ captionText }}</div>
        <div v-if="!cells.length" class="hh-grid">
          <div class="hh-placeholder">🔒 الشبكة ستُبنى تلقائياً بعد الضغط على "بدء اللعبة"</div>
        </div>
        <div
          v-else
          class="hh-grid"
          :style="{ '--hh-n': gridN, '--hh-font': Math.max(8, Math.min(18, 260 / gridN)) + 'px' }"
          @mouseleave="onGridMouseLeave"
        >
          <div
            v-for="cell in cells"
            :key="cell.index"
            class="hh-cell"
            :class="{ 'hh-destroyed': cell.destroyed, 'hh-active': !cell.destroyed, 'hh-targeted': highlightedSet.has(cell.index) }"
            @mouseover="onCellMouseOver(cell.index)"
            @click="onCellClick(cell.index)"
          >{{ cell.index + 1 }}</div>
        </div>

        <div v-if="awaitingChipsVisible" class="awaiting-chips-wrap" style="display:block;">
          <div class="field-hint" style="margin-bottom:6px;">🙋 وضع يدوي (اختباري بدون تيك توك): اضغط على اسم ثم اضغط مربع فاضي لتثبيته يدوياً</div>
          <div class="chips-row">
            <span
              v-for="p in waitingPlayers"
              :key="p.id"
              class="player-chip"
              :class="{ 'chip-armed': armedPlayerId === p.id }"
              @click="armPlayer(p.id)"
            >{{ p.name }}</span>
          </div>
        </div>

        <div v-if="weaponsToolbarVisible" class="weapons-toolbar" style="display:flex;">
          <div
            v-for="d in weaponDefs"
            :key="d.key"
            class="weapon-card"
            :class="{ 'weapon-selected': selectedWeapon === d.key, 'weapon-depleted': weapons[d.key].charges <= 0 }"
          >
            <button class="weapon-btn" :disabled="weapons[d.key].charges <= 0" @click="selectWeapon(d.key)">
              {{ d.icon }} {{ d.label }}<br>
              <small>{{ currentDims(d.key)[0] }}×{{ currentDims(d.key)[1] }} — الرصيد: {{ weapons[d.key].charges }}</small>
            </button>
            <button v-if="d.rotatable" class="weapon-rotate-btn" title="تدوير الاتجاه" @click="rotateWeapon(d.key)">🔄</button>
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
      <div style="display: flex; gap: 5px; width: 100%; margin-bottom: 10px;">
        <input v-model="newPlayerName" type="text" placeholder="اسم اللاعب الجديد (Enter للإضافة)" style="flex:1;" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" @click="addPlayer">إضافة</button>
      </div>
      <div class="players-list">
        <template v-if="players.size === 0">
          <div v-if="masterPlayersList.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
          <div v-for="p in masterPlayersList" :key="p.id" class="player-item"><span>{{ p.name }}</span><span>⏳ مسجل</span></div>
        </template>
        <template v-else>
          <div class="scoreboard-title">🙂 الأحياء ({{ alivePlayersDisplay.length }})</div>
          <div v-if="alivePlayersDisplay.length === 0" class="field-hint">لا يوجد لاعبون أحياء</div>
          <div v-for="p in alivePlayersDisplay" :key="p.id" class="player-item">
            <span>{{ p.name }} <span v-if="p.afkStreak > 0" style="color:#f39c12;">(خمول {{ p.afkStreak }}/2)</span></span>
            <span>{{ statusTextFor(p) }}</span>
          </div>
          <template v-if="deadPlayersDisplay.length > 0">
            <div class="scoreboard-title">💀 خارج اللعبة ({{ deadPlayersDisplay.length }})</div>
            <div v-for="p in deadPlayersDisplay" :key="p.id" class="player-item" style="opacity:0.6;">
              <span>{{ p.name }}</span><span>{{ p.eliminatedReason || '' }}</span>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>

  <div v-if="showModal_" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <h2>{{ modalTitle }}</h2>
      <div class="modal-logs">
        <div v-for="(log, i) in modalLogs" :key="i" v-html="log"></div>
      </div>
      <button class="master-btn" style="width:100%; padding:10px;" @click="closeModal">{{ modalConfirmText }}</button>
    </div>
  </div>

  <div v-if="huntAlertVisible" class="hunt-alert-overlay" style="display:flex;">
    <div class="hunt-alert-text">⚠️ مرحلة الصيد ⚠️</div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة رادار الإقصاء 📡</h2>
      <ul class="rules-list">
        <li><b>الشبكة:</b> يقترحها النظام تلقائياً حسب عدد اللاعبين المسجلين قبل بدء اللعبة (مربعة الأبعاد N×N)، ويحق للمستضيف تكبيرها يدوياً من حقل "حجم الشبكة" قبل الضغط على "بدء اللعبة"</li>
        <li><b>الاختباء:</b> كل مربع يتسع للاعب واحد فقط، ويُحجز لأول لاعب يكتب رقمه بالدردشة أثناء وقت الاختباء — الشبكة ما تُظهر أي إشارة على المربعات المحجوزة، فتبقى أماكن الاختباء سرّية بالكامل حتى لحظة القصف</li>
        <li><b>التوزيع العشوائي:</b> أي لاعب ما اختار مربعاً قبل انتهاء الوقت يوزَّع تلقائياً على مربع فارغ متبقي</li>
        <li><b>عقوبة الخمول:</b> لو اعتمد نفس اللاعب على التوزيع العشوائي مرتين متتاليتين، يُقصى نهائياً من اللعبة</li>
        <li><b>أسلحة المستضيف:</b> 🧨 قصف منطقة (3×2 أو 2×3) — ➖ قصف خطي (3×1 أو 1×3) — 🎯 قنص مربع واحد (1×1). في الشبكات الصغيرة (3×3، 4×4، 5×5) يتوفر القنص فقط، ورصيد قصف المنطقة والقصف الخطي = 0 حتى لا تُدمَّر أغلب الشبكة بضربة واحدة، ثم تبدأ أرصدتهما بالظهور تدريجياً بشكل نسبي مع حجم الشبكة ابتداءً من 6×6 فأكبر. رصيد القنص يبقى متاحاً دائماً ويُحسب حسب عدد مربعات الشبكة (نفس نسبة شبكة 5×5 القياسية)</li>
        <li>مرر الماوس فوق الشبكة بعد اختيار سلاح لمعاينة المربعات المستهدفة قبل النقر لتأكيد القصف</li>
        <li>عند إغلاق باب الاختباء يُشغَّل إنذار صوتي مع نص وامض "مرحلة الصيد" قبل تفعيل أزرار القصف</li>
        <li><b>تدمير الخريطة:</b> أي مربع يُقصف (فيه لاعب أو فارغ) يتحول إلى مربع مدمر ويُمنع الاختباء خلفه في الجولات القادمة، فتتقلص مساحة اللعب تدريجياً</li>
        <li><b>القصف ينهي الجولة فوراً:</b> ضربة واحدة فقط لكل جولة صيد — فور تنفيذها تظهر النتيجة وتبدأ جولة اختباء جديدة تلقائياً للناجين، وتستمر حتى نفاد كل الأسلحة أو خروج جميع اللاعبين</li>
        <li>يقدر المستضيف يضغط "🏁 إنهاء اللعبة الآن" بأي وقت لإيقاف اللعبة وإعلان اللاعبين الأحياء حالياً كناجين</li>
        <li>اللاعبون الباقون أحياء عند نفاد رصيد كل الأسلحة يُعلنون "الناجين" وفائزين باللعبة 🏆</li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="showRulesOverlay = false">🔙 رجوع للعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 30px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 6px; text-align: center; }
.grid-size-info { text-align: center; font-size: 0.85rem; color: #f1c40f; margin-bottom: 15px; min-height: 1.2em; }

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

.game-arena {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.timer-display {
  font-size: 34px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 10px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}

.timer-display.urgent { color: #ff4757; }

.hh-caption {
  text-align: center;
  font-size: 0.92rem;
  color: #ccd6e0;
  margin-bottom: 14px;
  min-height: 1.3em;
}

.hh-grid {
  display: grid;
  grid-template-columns: repeat(var(--hh-n, 5), 1fr);
  gap: 3px;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
}

.hh-placeholder {
  text-align: center;
  color: #8b93a3;
  padding: 30px 10px;
  font-size: 0.95rem;
}

.hh-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--hh-font, 14px);
  font-weight: bold;
  border-radius: 4px;
  user-select: none;
  transition: background 0.15s, box-shadow 0.15s;
}

.hh-cell.hh-active {
  background: rgba(52, 152, 219, 0.25);
  border: 1px solid rgba(52, 152, 219, 0.55);
  color: #eaf4ff;
  cursor: pointer;
}

.hh-cell.hh-destroyed {
  background: repeating-linear-gradient(45deg, #17171f, #17171f 4px, #1f1f29 4px, #1f1f29 8px);
  border: 1px solid #333;
  color: #555;
  cursor: not-allowed;
}

.hh-cell.hh-targeted {
  background: rgba(231, 76, 60, 0.6) !important;
  border-color: #e74c3c !important;
  box-shadow: 0 0 10px rgba(231, 76, 60, 0.85);
}

.weapons-toolbar {
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  width: 100%;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255,255,255,0.15);
}

.weapon-card {
  display: flex;
  align-items: center;
  gap: 4px;
}

.weapon-btn {
  background: #2a2a40;
  border: 2px solid rgba(255,255,255,0.15);
  color: #ecf0f1;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: bold;
  line-height: 1.5;
  cursor: pointer;
  text-align: center;
}

.weapon-btn small { font-weight: normal; color: #bdc3c7; }

.weapon-selected .weapon-btn {
  border-color: var(--primary-color);
  box-shadow: 0 0 12px var(--border-glow);
  background: #3a2f14;
}

.weapon-depleted .weapon-btn {
  opacity: 0.4;
  cursor: not-allowed;
}

.weapon-rotate-btn {
  background: #444;
  border: none;
  color: white;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 1rem;
  cursor: pointer;
}

.chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.player-chip {
  background: #1e1e2f;
  border: 1px solid rgba(255,255,255,0.2);
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 0.82rem;
  cursor: pointer;
}

.player-chip.chip-armed {
  background: var(--primary-color);
  color: #1e1e2f;
  border-color: #fff;
  box-shadow: 0 0 8px var(--primary-color);
}

.awaiting-chips-wrap {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255,255,255,0.12);
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
.event-log-panel :deep(.log-miss) { border-right: 4px solid #f39c12; }

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

.hunt-alert-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(20, 0, 0, 0.85);
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.hunt-alert-text {
  font-size: 2.4rem;
  font-weight: 900;
  color: #ff4757;
  text-shadow: 0 0 20px rgba(255, 71, 87, 0.9);
  animation: huntFlash 0.5s infinite alternate;
  text-align: center;
  padding: 0 20px;
}

@keyframes huntFlash {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0.4; transform: scale(1.06); }
}

.footer-note { padding: 15px; font-size: 0.85rem; }
</style>
