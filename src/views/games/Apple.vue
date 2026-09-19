<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { BRIDGE_URL } from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

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
    playersScoresReactive.set(name, reactive({ name, score: 0 }));
  }
  return playersScoresReactive.get(name);
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
  const maxH = 420;
  cellSize.value = Math.max(24, Math.min(56, Math.floor(maxW / cols), Math.floor(maxH / rows)));

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

function endRoundSoft() {
  if (roundCountdown) { clearInterval(roundCountdown); roundCountdown = null; }
  gamePhase.value = 'setup';
  appendLog(`<div class="log-item" style="text-align:center; color:#f1c40f;">⏳ انتهت الجولة ${roundNumber.value} — النقاط محفوظة</div>`);

  const sorted = Array.from(playersScoresReactive.values()).sort((a, b) => b.score - a.score);
  const logs = sorted.slice(0, 10).map((p, i) => `<div class="log-item">${rankFor(i)} ${escapeHtml(p.name)} — ${p.score} تفاحة</div>`);
  if (logs.length === 0) logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي نقاط بعد</div>');
  showModal(`نتائج الجولة ${roundNumber.value}`, logs);
}

function stopAndReset() {
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

function handleIncomingComment(username, rawText, avatarUrl) {
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
  player.score++;
  appendLog(`<div class="log-item log-hit">🍎 <b>${escapeHtml(username)}</b> التقط التفاحة! (${player.score} نقطة)</div>`);
  spawnApple();
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const showRulesOverlay = ref(false);
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
function toggleFullscreen() {
  const el = stageContainerRef.value;
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}
function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

function goHome() {
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
let tiktokSocket = null;

function getAvatarUrl(data) {
  return data.profilePictureUrl || data.profilePicture || data.avatar || data.userAvatar || null;
}

function connectTikTok() {
  const username = tiktokUsername.value.trim();
  if (!username) {
    tiktokStatus.value = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokStatusColor.value = 'orange';
    return;
  }
  if (tiktokSocket) tiktokSocket.close();
  trackConnectRequest('apple', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) handleIncomingComment(data.user, data.comment, getAvatarUrl(data));
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

function onWindowResize() {
  buildGrid();
}

onMounted(() => {
  buildGrid();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('resize', onWindowResize);
});
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('resize', onWindowResize);
  if (roundCountdown) clearInterval(roundCountdown);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: من يكتب "فوق" أو "تحت" أو "يمين" أو "يسار" بالدردشة يحرّك الشخصية</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label>🧩 حجم الشبكة (يُقفَل بعد بدء أول جولة):</label>
    <div class="round-time-row">
      <input v-model="colsInput" type="number" min="4" max="16" title="عدد الأعمدة" :disabled="gridSettingsLocked">
      <span style="color:#8b93a3;">×</span>
      <input v-model="rowsInput" type="number" min="4" max="16" title="عدد الصفوف" :disabled="gridSettingsLocked">
      <div class="field-hint" style="margin-top:0;">أعمدة × صفوف — كبّر الشبكة لتصعيب اللعبة</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة الجولة بالثواني:</label>
    <div class="round-time-row">
      <input v-model="roundDurationInput" type="number" min="15" max="600">
      <div class="field-hint" style="margin-top:0;">عند انتهاء الوقت تتوقف الحركة وتبقى النقاط محفوظة لحد ما تضغط "بدء الجولة" من جديد</div>
    </div>
  </div>

  <h1>🍏 التقط التفاح</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button class="reset-btn" @click="stopAndReset">⏹️ إيقاف الجولة وتصفير النقاط</button>
    <button class="master-btn" style="background:#3498db;" @click="toggleFullscreen">{{ isFullscreen ? '🗗 الخروج من ملء الشاشة' : '🖥️ ملء الشاشة' }}</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="layout-wrapper">
    <div ref="stageContainerRef" class="stage-container">
      <button v-if="startBtnVisible" class="master-btn" id="startBtn" @click="startRound">🚀 بدء الجولة</button>
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
            <span><span class="lb-rank">{{ rankFor(i) }}</span>{{ p.name }}</span>
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
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة التقط التفاح 🍏</h2>
      <ul class="rules-list">
        <li><b>الحركة:</b> أي تعليق يحتوي كلمة "فوق" أو "تحت" أو "يمين" أو "يسار" يحرّك الشخصية خطوة واحدة بذلك الاتجاه</li>
        <li><b>التقاط التفاحة:</b> صاحب التعليق اللي وصّل الشخصية لمربع التفاحة 🍎 تُحتسب له النقطة، وتظهر تفاحة جديدة فوراً بمكان عشوائي آخر</li>
        <li><b>الحدود:</b> الشخصية ما تقدر تطلع خارج حدود الشبكة — أي أمر يطلعها برا الحدود يُتجاهل</li>
        <li><b>الشخصية:</b> تعرض صورة آخر شخص حرّكها إن كانت متوفرة من بيانات البث</li>
        <li><b>المؤقت:</b> يحدد المستضيف مدة الجولة، وعند انتهائها تتوقف الحركة لكن النقاط تبقى محفوظة لجولات لاحقة</li>
        <li><b>التصفير:</b> زر "إيقاف الجولة وتصفير النقاط" يوقف كل شي فوراً ويرجّع لوحة الصدارة لصفر، ويفتح إعدادات حجم الشبكة من جديد</li>
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

#startBtn {
  position: fixed;
  bottom: 100px;
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

.stage-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

.stage-container:fullscreen {
  background: var(--bg-gradient);
  padding: 30px 15px;
  overflow-y: auto;
  justify-content: center;
  align-items: center;
}

.stage-container:fullscreen .panel {
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
