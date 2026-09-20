<script setup>
import {
  ref, reactive, computed, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import { BRIDGE_URL, normalizeDigits } from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const SCORES_KEY = 'hideoutRevealGame_scores';

const LEVELS = [
  { id: 'easy', label: '🟢 سهل 3×3 = 3 نقاط', size: 3 },
  { id: 'medium', label: '🟡 متوسط 4×4 = 4 نقاط', size: 4 },
  { id: 'hard', label: '🔴 صعب 5×5 = 5 نقاط', size: 5 },
];

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

// ===== حالة اللعبة =====
const hostNameInput = ref('');
const gridLevel = ref('easy');
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

function startHiding() {
  if (settingsDisabled.value) return;
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
function goHome() { router.push('/'); }

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
  trackConnectRequest('dark-room', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) registerGuessFromComment(data.user, data.comment);
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onUnmounted(() => {
  if (hidingTimeout) clearTimeout(hidingTimeout);
  stopRoundTimer();
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="hostNameInput">👤 اسم المستضيف (يظهر بالمنتصف قبل الاختباء):</label>
    <input id="hostNameInput" v-model="hostNameInput" type="text" placeholder="مثال: محمد" :disabled="settingsDisabled">
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: كل مشاهد يكتب رقم المربع الذي يعتقد أن المستضيف مختبئ فيه، وتُعلن النتيجة بعد انتهاء وقت الجولة</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
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

  <div class="top-names-section">
    <label for="secretInput">🔒 رقم الاختباء (من 1 إلى {{ secretMax }}):</label>
    <input
      id="secretInput"
      v-model="secretInput"
      type="password"
      inputmode="numeric"
      maxlength="2"
      placeholder="******"
      :disabled="settingsDisabled"
      @keydown.enter.prevent="startHiding"
    >
    <div v-if="hideError" class="field-hint" style="color:#e74c3c;">{{ hideError }}</div>
    <div class="field-hint">يبقى الرقم سرياً تماماً ولا يظهر على الشاشة أبداً — أنت فقط من يعرفه</div>
  </div>

  <h1>🌑 كشف المخبأ</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button v-if="gamePhase === 'idle'" class="master-btn" @click="startHiding">🕶️ اختباء وبدء الجولة</button>
    <button v-if="gamePhase === 'guessing'" class="master-btn" style="background:#3498db;" @click="revealNow">💡 كشف المخبأ الآن</button>
    <button v-if="gamePhase === 'revealed'" class="master-btn" @click="nextRound">➡️ جولة جديدة</button>
    <button class="reset-btn" style="background:#8A1538;" @click="endAndResetGame">🏁 إنهاء اللعبة وعرض النتائج</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
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
