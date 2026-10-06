<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, isLeaveComment,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();
const STORAGE_KEY = 'appleSoloGame_players';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const COLOR_PALETTE = ['#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#d35400', '#16a085'];

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

const gamePhase = ref('registration'); // registration | ready | running
let cols = 8;
let rows = 6;
const cellSize = ref(48);
let tokenShape = 'square';
const applePos = reactive({ row: 0, col: 0 });
const playerTokens = reactive(new Map()); // name -> { name, row, col, color, avatarUrl }
const playersScores = reactive(new Map()); // name -> { name, score }
const roundNumber = ref(0);
let roundDuration = 60;
const timeLeft = ref(0);
let roundCountdown = null;
const eventLog = ref([]);
const applePopKey = ref(0);

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
const colsInput = ref(8);
const rowsInput = ref(6);
const tokenShapeInput = ref('square');
const roundDurationInput = ref(60);

const registrationLocked = computed(() => gamePhase.value !== 'registration');
const joinKeyDisabled = computed(() => joinViaGift.value || registrationLocked.value);
const namesHint = computed(() => (registrationLocked.value
  ? '🔒 التسجيل مقفول — اضغط "إيقاف الجولة وتصفير النقاط" لفتحه من جديد.'
  : 'التسجيل يبقى مفتوحاً لحد ما تضغط "إغلاق التسجيل" — بعدها ما ينضم أحد جديد.'));

function getJoinKey() { return joinKeyInput.value.trim() || '1'; }

const joinKeyHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء فتح نافذة التسجيل ينضم تلقائياً.'
  : `المشاهد يكتب "${getJoinKey()}" بالدردشة عشان ينضم كلاعب مسجّل أثناء فتح نافذة التسجيل`));
const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف: من يرسل هدية ينضم تلقائياً كلاعب مسجّل'
  : `🔴 ربط بث تيك توك لايف: من يكتب "${getJoinKey()}" بالدردشة ينضم تلقائياً كلاعب مسجّل`));

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationUnlimited = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح ${registrationUnlimited.value ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${registrationTimeLeft.value} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
  : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.'));

function startRegistration() {
  if (registrationLocked.value || registrationOpen.value) return;
  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 5;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;
  if (registrationTimer) clearInterval(registrationTimer);
  if (registrationUnlimited.value) { registrationTimeLeft.value = 0; return; }
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
  }, 1000);
}
function extendRegistration() {
  if (!registrationOpen.value || registrationUnlimited.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
}
function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
}

function isRegistered(name) {
  return masterPlayersList.some((p) => p.name === name);
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
    return existing || { id: playerIdCounter++, name, avatar: getUserAvatar(name) };
  });
  masterPlayersList.splice(0, masterPlayersList.length, ...newList);
  saveToStorage();
}

function addPlayer() {
  if (gamePhase.value !== 'registration') return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (masterPlayersList.some((p) => p.name === name)) {
    openModal('تنبيه', [`<div class="log-item">الاسم "${escapeHtml(name)}" موجود مسبقاً في القائمة!</div>`]);
    return;
  }
  masterPlayersList.push({ id: playerIdCounter++, name, avatar: getUserAvatar(name) });
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

function clearPlayers() {
  if (gamePhase.value !== 'registration') return;
  masterPlayersList.splice(0, masterPlayersList.length);
  joinedUsers.clear();
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

// اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة بأي وقت (حتى وسط الجولة)، ويقدر ينضم من جديد
function leavePlayerFromChat(name) {
  joinedUsers.delete(name);
  const idx = masterPlayersList.findIndex((p) => p.name === name);
  if (idx === -1) return;
  masterPlayersList.splice(idx, 1);
  playerTokens.delete(name);
  playersScores.delete(name);
  updateTextareaFromPlayers();
  saveToStorage();
}

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 15) val = 15;
  if (val > 600) val = 600;
  roundDurationInput.value = val;
  return val;
}
function getGridSize() {
  let c = parseInt(colsInput.value, 10);
  let r = parseInt(rowsInput.value, 10);
  if (Number.isNaN(c) || c < 4) c = 4;
  if (c > 16) c = 16;
  if (Number.isNaN(r) || r < 4) r = 4;
  if (r > 16) r = 16;
  colsInput.value = c;
  rowsInput.value = r;
  return { cols: c, rows: r };
}

function closeRegistration() {
  if (gamePhase.value !== 'registration') return;
  if (masterPlayersList.length < 1) {
    openModal('تنبيه', ['<div class="log-item">تحتاج تسجيل لاعب واحد على الأقل قبل إغلاق التسجيل!</div>']);
    return;
  }

  const size = getGridSize();
  cols = size.cols;
  rows = size.rows;
  tokenShape = tokenShapeInput.value;
  buildGrid();

  gamePhase.value = 'ready';
  stopRegistration();
  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُغلق التسجيل — ${masterPlayersList.length} لاعب مسجّل، شبكة ${cols}×${rows}</div>`);
}

const gridCells = ref([]);
function buildGrid() {
  const maxW = Math.min(420, window.innerWidth - 60);
  const maxH = Math.min(420, window.innerHeight - 260);
  cellSize.value = Math.max(14, Math.min(56, Math.floor(maxW / cols), Math.floor(maxH / rows)));
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ shade: (r + c) % 2 !== 0 });
  }
  gridCells.value = cells;
}

function isCellOccupiedByAnyToken(pos) {
  for (const token of playerTokens.values()) {
    if (token.row === pos.row && token.col === pos.col) return true;
  }
  return false;
}

function spawnApple() {
  let pos;
  let guard = 0;
  do {
    pos = { row: Math.floor(Math.random() * rows), col: Math.floor(Math.random() * cols) };
    guard++;
  } while (isCellOccupiedByAnyToken(pos) && guard < 200);
  applePos.row = pos.row;
  applePos.col = pos.col;
  applePopKey.value++;
}

function createPlayerTokenAt(name, row, col, avatar) {
  const colorIndex = playerTokens.size % COLOR_PALETTE.length;
  const color = COLOR_PALETTE[colorIndex];
  playerTokens.set(name, reactive({
    name, row, col, color, avatarUrl: avatar || null,
  }));
}

function startRound() {
  if (gamePhase.value !== 'ready') return;

  roundNumber.value++;
  roundDuration = getRoundDuration();
  timeLeft.value = roundDuration;
  gamePhase.value = 'running';

  playerTokens.clear();
  const centerRow = Math.floor(rows / 2);
  const centerCol = Math.floor(cols / 2);
  masterPlayersList.forEach((p) => createPlayerTokenAt(p.name, centerRow, centerCol, p.avatar));

  spawnApple();

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 بدأت الجولة ${roundNumber.value} (${roundDuration} ثانية) — الجميع بالمربع الأوسط</div>`);

  startRoundTimer();
}

function startRoundTimer() {
  if (roundCountdown) clearInterval(roundCountdown);
  roundCountdown = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) endRoundSoft();
  }, 1000);
}

// winnerName: يُمرَّر لو الجولة انتهت لأن لاعب وصل لنقاط الفوز
function endRoundSoft(winnerName) {
  if (roundCountdown) { clearInterval(roundCountdown); roundCountdown = null; }
  gamePhase.value = 'ready';
  appendLog(`<div class="log-item" style="text-align:center; color:#f1c40f;">⏳ انتهت الجولة ${roundNumber.value} — النقاط محفوظة</div>`);

  const sorted = Array.from(playersScores.values()).sort((a, b) => b.score - a.score);
  const logs = sorted.slice(0, 10).map((p, i) => `<div class="log-item">${rankFor(i)} ${escapeHtml(p.name)} — ${p.score} تفاحة</div>`);
  if (logs.length === 0) logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي نقاط بعد</div>');
  if (winnerName) {
    const winHtml = gameWinHtml([winnerName]);
    appendLog(winHtml);
    logs.unshift(winHtml);
  }
  openModal(`نتائج الجولة ${roundNumber.value}`, logs);
}

function stopAndReset() {
  stopRegistration();
  if (roundCountdown) { clearInterval(roundCountdown); roundCountdown = null; }
  gamePhase.value = 'registration';
  roundNumber.value = 0;
  timeLeft.value = 0;
  playersScores.clear();
  playerTokens.clear();
  eventLog.value = [];
  joinedUsers.clear();
  gridCells.value = [];
}

function parseDirection(text) {
  const t = String(text);
  if (t.includes('فوق')) return 'up';
  if (t.includes('تحت')) return 'down';
  if (t.includes('يمين')) return 'right';
  if (t.includes('يسار')) return 'left';
  return null;
}

function handleIncomingComment(username, rawText, avatarUrl) {
  if (gamePhase.value !== 'running' || !username || !rawText) return;
  if (!isRegistered(username)) return;
  const dir = parseDirection(rawText);
  if (!dir) return;
  movePlayer(dir, username, avatarUrl || null);
}

function movePlayer(dir, username, avatarUrl) {
  const token = playerTokens.get(username);
  if (!token) return;
  if (avatarUrl) token.avatarUrl = avatarUrl;

  let { row, col } = token;
  if (dir === 'up') row = Math.max(0, row - 1);
  else if (dir === 'down') row = Math.min(rows - 1, row + 1);
  else if (dir === 'left') col = Math.max(0, col - 1);
  else if (dir === 'right') col = Math.min(cols - 1, col + 1);

  token.row = row;
  token.col = col;

  checkAppleCatch(username);
}

function getOrCreatePlayerScore(name) {
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

function checkAppleCatch(username) {
  const token = playerTokens.get(username);
  if (!token || token.row !== applePos.row || token.col !== applePos.col) return;
  const player = getOrCreatePlayerScore(username);
  const reachedWin = addPoints(player, 1);
  appendLog(`<div class="log-item log-hit">🍎 <b>${escapeHtml(username)}</b> التقط التفاحة! (${player.score} نقطة)</div>`);
  spawnApple();
  if (reachedWin) endRoundSoft(username);
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

// ---------- تخطيط الشرائح عند تجمّع أكثر من لاعب بنفس المربع ----------
const tokenLayoutList = computed(() => {
  const groups = new Map();
  playerTokens.forEach((token, name) => {
    const key = `${token.row},${token.col}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  });

  const list = [];
  groups.forEach((names) => {
    names.sort((a, b) => a.localeCompare(b, 'ar'));
    const n = names.length;
    const subW = cellSize.value;
    const subH = cellSize.value / n;
    const maxChars = Math.max(2, Math.min(6, Math.floor(subW / 9)));
    const fontSize = Math.max(6, Math.floor(subH * 0.55));

    names.forEach((name, i) => {
      const token = playerTokens.get(name);
      list.push({
        name,
        token,
        style: {
          left: `${token.col * cellSize.value}px`,
          top: `${token.row * cellSize.value + i * subH}px`,
          width: `${subW}px`,
          height: `${subH}px`,
          fontSize: `${fontSize}px`,
          background: token.avatarUrl ? 'none' : token.color,
          backgroundImage: token.avatarUrl
            ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url('${token.avatarUrl}')`
            : 'none',
        },
        text: token.avatarUrl ? '' : name.slice(0, maxChars),
      });
    });
  });
  return list;
});

const activePlayersLine = computed(() => (playerTokens.size > 0 ? `🎮 عدد اللاعبين النشطين هالجولة: ${playerTokens.size}` : ''));

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score).slice(0, 10));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const gridWrapStyle = computed(() => ({ width: `${cellSize.value * cols}px`, height: `${cellSize.value * rows}px` }));
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols}, ${cellSize.value}px)`,
  gridTemplateRows: `repeat(${rows}, ${cellSize.value}px)`,
}));
const fruitStyle = computed(() => ({
  display: (gamePhase.value === 'running' || playerTokens.size > 0) ? 'flex' : 'none',
  width: `${cellSize.value}px`,
  height: `${cellSize.value}px`,
  fontSize: `${Math.floor(cellSize.value * 0.55)}px`,
  left: `${applePos.col * cellSize.value}px`,
  top: `${applePos.row * cellSize.value}px`,
}));

const closeRegBtnVisible = computed(() => gamePhase.value === 'registration');
const startBtnVisible = computed(() => gamePhase.value === 'ready');
const timerText = computed(() => (gamePhase.value === 'running' ? String(timeLeft.value) : '--'));
const timerUrgent = computed(() => gamePhase.value === 'running' && timeLeft.value <= 10);
const captionHtml = computed(() => {
  if (gamePhase.value === 'registration') return 'سجّل اللاعبين ثم اضغط "إغلاق التسجيل"';
  if (gamePhase.value === 'ready') return 'اضغط "بدء الجولة" — يبدأ الجميع بالمربع الأوسط';
  return 'كل واحد يتحكم بشخصيته الخاصة! اكتب: <b>فوق</b> / <b>تحت</b> / <b>يمين</b> / <b>يسار</b> بالدردشة';
});

function playerStatusText(p) {
  const score = playersScores.get(p.name);
  return score ? `🍎 ${score.score}` : '⏳ مسجّل';
}
function tokenSwatch(name) {
  const t = playerTokens.get(name);
  return t ? t.color : null;
}

const barExpanded = ref(true);
const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }
const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }
const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() { showModal_.value = false; }

const stageContainerRef = ref(null);
const isFullscreen = ref(false);
let usingNativeFullscreen = false;

function enterCssFullscreen() {
  usingNativeFullscreen = false;
  isFullscreen.value = true;
  document.body.style.overflow = 'hidden';
}
function exitCssFullscreen() {
  isFullscreen.value = false;
  document.body.style.overflow = '';
}

function toggleFullscreen() {
  const el = stageContainerRef.value;
  if (!el) return;

  if (isFullscreen.value) {
    if (usingNativeFullscreen && (document.fullscreenElement || document.webkitFullscreenElement)) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      exitCssFullscreen();
    }
    return;
  }

  const requestFs = el.requestFullscreen || el.webkitRequestFullscreen;
  if (requestFs) {
    Promise.resolve(requestFs.call(el)).then(() => {
      usingNativeFullscreen = true;
      isFullscreen.value = true;
    }).catch(() => enterCssFullscreen());
  } else {
    // متصفحات الهاتف (مثل Safari على آيفون) لا تدعم Fullscreen API إطلاقاً — استخدم بديل بصري
    enterCssFullscreen();
  }
}

function onFullscreenChange() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    usingNativeFullscreen = true;
    isFullscreen.value = true;
  } else if (usingNativeFullscreen) {
    usingNativeFullscreen = false;
    isFullscreen.value = false;
    document.body.style.overflow = '';
  }
}

function goHome() { router.push('/'); }

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (showModal_.value) return;
    if (closeRegBtnVisible.value) closeRegistration();
    else if (startBtnVisible.value) startRound();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function getAvatarUrl(data) {
  return data.profilePictureUrl || data.profilePicture || data.avatar || data.userAvatar || null;
}

function handleTiktokMessage(data) {
  const phase = gamePhase.value;

  if (data.comment && data.user) {
    const text = data.comment.trim();
    if (isLeaveComment(text)) {
      leavePlayerFromChat(data.user);
    } else if (phase === 'registration' && !joinViaGift.value && normalizeDigits(text) === normalizeDigits(getJoinKey())) {
      addPlayerFromTikTok(data.user, getAvatarUrl(data));
    } else if (phase === 'running') {
      handleIncomingComment(data.user, text, getAvatarUrl(data));
    }
  }

  if (phase === 'registration' && joinViaGift.value && isGiftEvent(data)
    && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
    addPlayerFromTikTok(getGiftUser(data), getAvatarUrl(data));
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'apple-solo', onMessage: handleTiktokMessage });
}

function onWindowResize() {
  buildGrid();
}

onMounted(() => {
  buildGrid();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromTikTok(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('keydown', handleGlobalKeydown);
  document.body.style.overflow = '';
  if (roundCountdown) clearInterval(roundCountdown);
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🍏 التقط التفاح الفردي</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="stopAndReset">⏹️ إيقاف الجولة وتصفير النقاط</button>
    <button class="master-btn" style="background:#3498db;" @click="toggleFullscreen">{{ isFullscreen ? '🗗 الخروج من ملء الشاشة' : '🖥️ ملء الشاشة' }}</button>
    <GameDemoBtn />
    <button class="rules-btn" @click="router.replace('/apple')">🔀 تغيير النمط</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="top-names-section settings-row">
    <label class="setting-cell" title="عدد أعمدة الشبكة — يُقفَل بعد إغلاق التسجيل، وكبّر الشبكة لتصعيب اللعبة">
      <span>🔲 الأعمدة</span>
      <input v-model="colsInput" type="number" min="4" max="16" :disabled="registrationLocked">
    </label>
    <label class="setting-cell" title="عدد صفوف الشبكة — يُقفَل بعد إغلاق التسجيل، وكبّر الشبكة لتصعيب اللعبة">
      <span>🔲 الصفوف</span>
      <input v-model="rowsInput" type="number" min="4" max="16" :disabled="registrationLocked">
    </label>
    <label class="setting-cell" title="مدة الجولة بالثواني — عند انتهائها تتوقف الحركة وتبقى النقاط محفوظة، وكل جولة جديدة يرجع الكل للمربع الأوسط">
      <span>⏱️ مدة الجولة (ث)</span>
      <input v-model="roundDurationInput" type="number" min="15" max="600">
    </label>
    <label class="setting-cell" title="اختياري — أول لاعب يوصل لهذي النقاط يفوز باللعبة وتتوقف الجولة، واتركها فاضية للعب مفتوح بدون حد">
      <span>🏆 نقاط الفوز</span>
      <input v-model="winScoreInput" type="number" min="1" placeholder="مفتوح">
    </label>
    <div class="shape-toggle-row" style="flex-basis: 100%; margin-top:0;" title="شكل الشخصيات — يُقفَل بعد إغلاق التسجيل">
      <label><input v-model="tokenShapeInput" type="radio" name="tokenShape" value="square" :disabled="registrationLocked"> ⬜ مربع</label>
      <label><input v-model="tokenShapeInput" type="radio" name="tokenShape" value="circle" :disabled="registrationLocked"> ⚪ دائرة</label>
    </div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="closeRegBtnVisible" class="master-btn side-panel-btn" id="closeRegistrationBtn" @click="closeRegistration">🔒 إغلاق التسجيل</button>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startBtn" @click="startRound">🚀 بدء الجولة</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ masterPlayersList.length }}</span></button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ مفتاح الانضمام: ${getJoinKey()}` }}</button>
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
      <label class="join-gift-toggle" style="margin-top:12px;">
        <input v-model="registrationUnlimited" type="checkbox" :disabled="registrationOpen">
        ♾️ تسجيل مفتوح بدون وقت (يبقى لين توقفه)
      </label>
      <div class="registration-row">
        <input v-if="!registrationOpen && !registrationUnlimited" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationLocked">
        <span v-if="!registrationOpen && !registrationUnlimited" class="field-hint" style="margin:0;">ثانية</span>
        <input v-if="registrationOpen && !registrationUnlimited" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen && !registrationUnlimited" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div ref="stageContainerRef" class="stage-container" :class="{ 'is-fullscreen': isFullscreen }">
      <div class="panel">
        <h2>🧩 المتاهة</h2>
        <div class="apple-timer" :class="{ urgent: timerUrgent }">{{ timerText }}</div>
        <div class="apple-caption" v-html="captionHtml"></div>
        <div class="apple-grid-wrap" :style="gridWrapStyle">
          <div class="apple-grid" :style="gridStyle">
            <div v-for="(cell, i) in gridCells" :key="i" class="apple-cell" :class="{ shade: cell.shade }"></div>
          </div>
          <div :key="applePopKey" class="apple-fruit" :style="fruitStyle">🍎</div>
          <div
            v-for="item in tokenLayoutList"
            :key="item.name"
            class="player-token"
            :class="`token-${tokenShape}`"
            :style="item.style"
            :title="item.name"
          >{{ item.text }}</div>
        </div>
        <div class="active-players-line">{{ activePlayersLine }}</div>
      </div>

      <div class="panel">
        <h3>🏆 لوحة الصدارة</h3>
        <div class="leaderboard-list">
          <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا تفاحاً بعد</div>
          <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-top': i === 0 }">
            <span>
              <span v-if="tokenSwatch(p.name)" class="lb-swatch" :style="{ background: tokenSwatch(p.name) }"></span>
              <span class="lb-rank">{{ rankFor(i) }}</span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}
            </span>
            <span>🍎 {{ p.score }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون المسجّلون</h3>
      <div style="width: 100%;">
        <div v-if="masterPlayersList.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
        <div v-for="p in masterPlayersList" :key="p.id" class="player-item">
          <span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span><span>{{ playerStatusText(p) }}</span>
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
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ masterPlayersList.length }})</h3>
      <label for="namesInput" class="field-hint" style="display:block; margin-top:0;">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
      <textarea id="namesInput" v-model="namesInput" :disabled="registrationLocked" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
      <div class="field-hint">{{ namesHint }}</div>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" :disabled="registrationLocked" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" :disabled="registrationLocked" @click="addPlayer">➕ إضافة</button>
      </div>
      <div v-if="masterPlayersList.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in masterPlayersList" :key="p.id" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
          <button v-if="!registrationLocked" type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️ حذف</button>
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

.round-time-row input[type="number"], .round-time-row input[type="text"] {
  width: 100px;
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

.join-settings-row input[type="text"] { flex: 1; min-width: 140px; width: auto; }

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #ecf0f1;
  font-weight: normal;
  cursor: pointer;
}

.join-gift-toggle input[type="checkbox"] { width: auto; accent-color: var(--primary-color); cursor: pointer; }

.gift-filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input { flex: 1; min-width: 140px; }
.gift-filter-row input[type="number"] { flex: none; width: 170px; }

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

.shape-toggle-row {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}

.shape-toggle-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: normal;
  font-size: 0.9rem;
  color: #ecf0f1;
  cursor: pointer;
}

.shape-toggle-row input[type="radio"] { width: auto; accent-color: var(--primary-color); cursor: pointer; }

.setting-btn {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  font-size: 0.95rem;
  cursor: pointer;
}

.setting-btn:hover { border-color: var(--primary-color); }

.settings-row {
  display: flex;
  flex-wrap: wrap;
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
/* الصف يتكيّف مع حجم الشاشة: الخانات تتمدد وتنزل لسطر جديد لو ضاقت المساحة */
.settings-row .setting-cell { flex: 1 1 110px; min-width: 0; }
.settings-row .setting-cell.wide { flex: 2 1 220px; }
.settings-row .setting-cell :deep(.custom-select-trigger > span:first-child) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-row .setting-btn.active { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.2); }
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

.rounds-badge { font-size: 0.95rem; padding: 8px 15px; }

.layout-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

.stage-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

.stage-container.is-fullscreen {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 300;
  background: var(--bg-gradient);
  padding: 30px 15px;
  overflow-y: auto;
  justify-content: center;
  align-items: center;
}

.stage-container.is-fullscreen .panel {
  max-width: 600px;
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

.apple-timer {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 8px;
  text-align: center;
}

.apple-timer.urgent { color: #ff4757; }

.apple-caption {
  text-align: center;
  font-size: 0.9rem;
  color: #ccd6e0;
  margin-bottom: 14px;
}

.apple-caption :deep(b) { color: var(--primary-color); }

.apple-grid-wrap {
  position: relative;
  margin: 0 auto;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  border: 2px solid rgba(255,255,255,0.1);
  direction: ltr;
}

.apple-grid { display: grid; }

.apple-cell {
  border: 1px solid rgba(255,255,255,0.06);
  box-sizing: border-box;
}

.apple-cell.shade { background: rgba(255,255,255,0.025); }

.player-token {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background-size: cover;
  background-position: center;
  border: 1.5px solid rgba(255,255,255,0.85);
  box-shadow: 0 2px 6px rgba(0,0,0,0.5);
  transition: left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease;
  z-index: 3;
  color: #fff;
  font-weight: bold;
  overflow: hidden;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}

.player-token.token-circle { border-radius: 50%; }
.player-token.token-square { border-radius: 4px; }

.apple-fruit {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  z-index: 2;
  animation: applePop 0.3s ease;
}

@keyframes applePop {
  from { transform: scale(0); }
  to { transform: scale(1); }
}

.active-players-line {
  text-align: center;
  font-size: 0.85rem;
  color: #f1c40f;
  margin-top: 10px;
  min-height: 1.3em;
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
.leaderboard-item.is-top { background: #f39c12; color: #1e1e2f; font-weight: bold; }
.leaderboard-item .lb-swatch { display:inline-block; width:12px; height:12px; border-radius:50%; margin-left:6px; vertical-align:middle; }

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

.event-log-panel {
  width: 100%;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--success-color); }

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
.modal-logs :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; }
</style>
