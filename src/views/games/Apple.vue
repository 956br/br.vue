<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import { useSettingsOverlay } from '../../utils/useSettingsOverlay';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode,
} from '../../utils/liveConnection';
import { isLeaveComment } from '../../utils/tiktokBridge';

const router = useRouter();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const gamePhase = ref('setup'); // setup | running
const hasGameStarted = ref(false);
let cols = 8;
let rows = 6;
const cellSize = ref(48);
const charPos = reactive({ row: 0, col: 0 });
const applePos = reactive({ row: 0, col: 0 });
const lastMoverName = ref(null);
const lastMoverAvatarUrl = ref(null);
const playersScores = new Map();
const roundNumber = ref(0);
let roundDuration = 60;
const timeLeft = ref(0);
let roundCountdown = null;
const eventLog = ref([]);
const applePopKey = ref(0);

const colsInput = ref(8);
const rowsInput = ref(6);
const roundDurationInput = ref(60);

const gridSettingsLocked = computed(() => hasGameStarted.value);
const startBtnVisible = computed(() => gamePhase.value !== 'running');
const timerUrgent = computed(() => gamePhase.value === 'running' && timeLeft.value <= 10);
const timerText = computed(() => (gamePhase.value === 'running' ? String(timeLeft.value) : '--'));

const captionHtml = computed(() => {
  if (gamePhase.value === 'running') return 'وجّه الشخصية للتفاحة 🍎 بكتابة: <b>فوق</b> / <b>تحت</b> / <b>يمين</b> / <b>يسار</b> بالدردشة';
  if (hasGameStarted.value) return 'اضغط "بدء الجولة" لبدء جولة جديدة — النقاط محفوظة';
  return 'اضبط الإعدادات واضغط "بدء الجولة" — وجّه الشخصية للتفاحة 🍎 بكتابة: <b>فوق</b> / <b>تحت</b> / <b>يمين</b> / <b>يسار</b>';
});

const gridCells = ref([]); // { shade }
const gridWrapStyle = computed(() => ({ width: `${cellSize.value * cols}px`, height: `${cellSize.value * rows}px` }));
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols}, ${cellSize.value}px)`,
  gridTemplateRows: `repeat(${rows}, ${cellSize.value}px)`,
}));
const charStyle = computed(() => ({
  display: hasGameStarted.value ? 'flex' : 'none',
  width: `${cellSize.value}px`,
  height: `${cellSize.value}px`,
  fontSize: `${Math.floor(cellSize.value * 0.55)}px`,
  left: `${charPos.col * cellSize.value}px`,
  top: `${charPos.row * cellSize.value}px`,
  backgroundImage: lastMoverAvatarUrl.value ? `url('${lastMoverAvatarUrl.value}')` : 'none',
}));
const fruitStyle = computed(() => ({
  display: hasGameStarted.value ? 'flex' : 'none',
  width: `${cellSize.value}px`,
  height: `${cellSize.value}px`,
  fontSize: `${Math.floor(cellSize.value * 0.55)}px`,
  left: `${applePos.col * cellSize.value}px`,
  top: `${applePos.row * cellSize.value}px`,
}));

const leaderboardSorted = computed(() => Array.from(playersScoresReactive.values()).sort((a, b) => b.score - a.score).slice(0, 10));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

// نحتاج نسخة تفاعلية من الخريطة لعرض لوحة الصدارة مباشرة
const playersScoresReactive = reactive(new Map());

function getOrCreatePlayer(name) {
  if (!playersScoresReactive.has(name)) {
    playersScoresReactive.set(name, reactive({ name, score: 0, avatar: getUserAvatar(name) }));
  }
  const player = playersScoresReactive.get(name);
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

function buildGrid() {
  const maxW = Math.min(420, window.innerWidth - 60);
  const maxH = Math.min(420, window.innerHeight - 260);
  cellSize.value = Math.max(14, Math.min(56, Math.floor(maxW / cols), Math.floor(maxH / rows)));

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ shade: (r + c) % 2 !== 0 });
    }
  }
  gridCells.value = cells;
}

function spawnApple() {
  let pos;
  do {
    pos = { row: Math.floor(Math.random() * rows), col: Math.floor(Math.random() * cols) };
  } while (pos.row === charPos.row && pos.col === charPos.col);
  applePos.row = pos.row;
  applePos.col = pos.col;
  applePopKey.value++;
}

function startRound() {
  if (gamePhase.value === 'running') return;

  if (!hasGameStarted.value) {
    hasGameStarted.value = true;
    const size = getGridSize();
    cols = size.cols;
    rows = size.rows;
    buildGrid();
  }

  roundNumber.value++;
  roundDuration = getRoundDuration();
  timeLeft.value = roundDuration;
  gamePhase.value = 'running';

  charPos.row = Math.floor(rows / 2);
  charPos.col = Math.floor(cols / 2);
  lastMoverName.value = null;
  lastMoverAvatarUrl.value = null;
  spawnApple();

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 بدأت الجولة ${roundNumber.value} (${roundDuration} ثانية)</div>`);

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
  gamePhase.value = 'setup';
  appendLog(`<div class="log-item" style="text-align:center; color:#f1c40f;">⏳ انتهت الجولة ${roundNumber.value} — النقاط محفوظة</div>`);

  const sorted = Array.from(playersScoresReactive.values()).sort((a, b) => b.score - a.score);
  const logs = sorted.slice(0, 10).map((p, i) => `<div class="log-item">${rankFor(i)} ${escapeHtml(p.name)} — ${p.score} تفاحة</div>`);
  if (logs.length === 0) logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي نقاط بعد</div>');
  if (winnerName) {
    const winHtml = gameWinHtml([winnerName]);
    appendLog(winHtml);
    logs.unshift(winHtml);
  }
  showModal(`نتائج الجولة ${roundNumber.value}`, logs);
}

function stopAndReset() {
  resetSettingsConfirm();
  if (roundCountdown) { clearInterval(roundCountdown); roundCountdown = null; }
  gamePhase.value = 'setup';
  hasGameStarted.value = false;
  roundNumber.value = 0;
  timeLeft.value = 0;
  playersScoresReactive.clear();
  eventLog.value = [];
  lastMoverName.value = null;
  lastMoverAvatarUrl.value = null;
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

// اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة (نقاطه وترتيبه) بأي وقت
function leavePlayerFromChat(name) {
  playersScoresReactive.delete(name);
  if (lastMoverName.value === name) {
    lastMoverName.value = null;
    lastMoverAvatarUrl.value = null;
  }
}

function handleIncomingComment(username, rawText, avatarUrl) {
  if (username && isLeaveComment(rawText)) { leavePlayerFromChat(username); return; }
  if (gamePhase.value !== 'running' || !username || !rawText) return;
  const dir = parseDirection(rawText);
  if (!dir) return;
  moveCharacter(dir, username, avatarUrl || null);
}

function moveCharacter(dir, username, avatarUrl) {
  let { row, col } = charPos;
  if (dir === 'up') row = Math.max(0, row - 1);
  else if (dir === 'down') row = Math.min(rows - 1, row + 1);
  else if (dir === 'left') col = Math.max(0, col - 1);
  else if (dir === 'right') col = Math.min(cols - 1, col + 1);

  if (row === charPos.row && col === charPos.col) return;

  charPos.row = row;
  charPos.col = col;
  lastMoverName.value = username;
  lastMoverAvatarUrl.value = avatarUrl;
  checkAppleCatch(username);
}

function checkAppleCatch(username) {
  if (charPos.row !== applePos.row || charPos.col !== applePos.col) return;
  const player = getOrCreatePlayer(username);
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

const barExpanded = ref(true);
const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function showModal(title, logsArray) {
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

function goHome() {
  router.push('/');
}

// ===== نمط اللعب: ينختار من نافذة الإعدادات (النمط الفردي صفحة مستقلة /apple-solo تنفتح على إعداداتها) =====
function chooseMode(mode) {
  if (mode === 'solo') router.replace({ path: '/apple-solo', query: { settings: '1' } });
}

const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(startRound);

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (settingsVisible.value) return;
    if (showModal_.value) return;
    if (startBtnVisible.value) requestStart();
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
  if (data.comment && data.user) handleIncomingComment(data.user, data.comment, getAvatarUrl(data));
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'apple', onMessage: handleTiktokMessage });
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
  // النافذة تنفتح أول ما تنفتح اللعبة عشان ينختار النمط والإعدادات
  openSettings();
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  window.removeEventListener('resize', onWindowResize);
  document.removeEventListener('keydown', handleGlobalKeydown);
  document.body.style.overflow = '';
  if (roundCountdown) clearInterval(roundCountdown);
  clearMessageHandler();
});
</script>

<template>
  <h1>🍏 التقط التفاح</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="stopAndReset">⏹️ إيقاف الجولة وتصفير النقاط</button>
    <button class="master-btn" style="background:#3498db;" @click="toggleFullscreen">{{ isFullscreen ? '🗗 الخروج من ملء الشاشة' : '🖥️ ملء الشاشة' }}</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" start-label="🚀 بدء الجولة" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group modes">
      <div class="adv-group-title">🎮 نمط اللعب <span class="adv-group-note">اختر واحد — تغيير النمط يبدأ اللعبة من جديد</span></div>

      <div class="adv-item" :class="{ checked: true }">
        <label class="adv-item-label">
          <input type="radio" name="appleMode" checked>
          <span>👥 <b>الجميع في واحد</b> — كلكم تحركون شخصية وحدة، وشلون بتوصلون للتفاحة سوا؟</span>
        </label>
      </div>

      <div class="adv-item">
        <label class="adv-item-label">
          <input type="radio" name="appleMode" @change="chooseMode('solo')">
          <span>🧍 <b>فردي</b> — كل واحد بروحه وبشخصيته، مين يلقط تفاح أكثر؟</span>
        </label>
      </div>
    </div>

    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>

      <div class="adv-columns">
        <label class="adv-item" :class="{ disabled: gridSettingsLocked }">
          <span>🔲 <b>الأعمدة</b> — عدد أعمدة الشبكة، ينقفل بعد بدء أول جولة. كبّر الشبكة لتصعيب اللعبة.</span>
          <input v-model="colsInput" type="number" min="4" max="16" :disabled="gridSettingsLocked">
        </label>
        <label class="adv-item" :class="{ disabled: gridSettingsLocked }">
          <span>🔲 <b>الصفوف</b> — عدد صفوف الشبكة، ينقفل بعد بدء أول جولة. كبّر الشبكة لتصعيب اللعبة.</span>
          <input v-model="rowsInput" type="number" min="4" max="16" :disabled="gridSettingsLocked">
        </label>
        <label class="adv-item">
          <span>⏱️ <b>مدة الجولة</b> — بالثواني، وعند انتهائها تتوقف الحركة وتبقى النقاط محفوظة لين تبدأ جولة جديدة.</span>
          <input v-model="roundDurationInput" type="number" min="15" max="600">
        </label>
        <label class="adv-item">
          <span>🏆 <b>نقاط الفوز</b> — اختياري: أول لاعب يوصلها يفوز وتتوقف الجولة، واتركها فاضية للعب مفتوح.</span>
          <input v-model="winScoreInput" type="number" min="1" placeholder="مفتوح">
        </label>
      </div>
    </div>
  </SettingsOverlay>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startBtn" @click="requestStart">🚀 بدء الجولة</button>
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
          <div class="apple-char" :style="charStyle">{{ lastMoverAvatarUrl ? '' : '🚶' }}</div>
        </div>
        <div class="last-mover-line">{{ lastMoverName ? `آخر تحريك من: ${lastMoverName}` : '' }}</div>
      </div>

      <div class="panel">
        <h3>🏆 لوحة الصدارة</h3>
        <div class="leaderboard-list">
          <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا تفاحاً بعد</div>
          <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-top': i === 0 }">
            <span><span class="lb-rank">{{ rankFor(i) }}</span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
            <span>🍎 {{ p.score }}</span>
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

textarea:disabled, input:disabled, button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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

.round-time-row input[type="number"] {
  width: 100px;
  text-align: center;
  flex: none;
}

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

.apple-grid {
  display: grid;
}

.apple-cell {
  border: 1px solid rgba(255,255,255,0.06);
  box-sizing: border-box;
}

.apple-cell.shade { background: rgba(255,255,255,0.025); }

.apple-char {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 50%;
  background-color: #2a2a40;
  background-size: cover;
  background-position: center;
  box-shadow: 0 0 12px rgba(243,156,18,0.7);
  border: 2px solid var(--primary-color);
  transition: left 0.18s ease, top 0.18s ease;
  z-index: 3;
}

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

.last-mover-line {
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
