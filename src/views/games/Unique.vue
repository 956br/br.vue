<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { BRIDGE_URL } from '../../utils/tiktokBridge';

const router = useRouter();
const SCORES_KEY = 'uniqueWordGame_scores';

const QUESTION_LIBRARY = [
  'اذكر اسم فاكهة',
  'اذكر اسم خضار',
  'اذكر اسم حيوان',
  'اذكر اسم طائر',
  'اذكر لون',
  'اذكر اسم دولة عربية',
  'اذكر اسم عاصمة عربية',
  'اذكر اسم مدينة سعودية',
  'اذكر اسم بحر أو محيط',
  'اذكر اسم كوكب',
  'اذكر اسم لاعب كرة قدم',
  'اذكر اسم مسلسل تعرفه',
  'اذكر اسم فيلم كرتون',
  'اذكر اسم برنامج تلفزيوني',
  'اذكر مهنة',
  'اذكر اسم رياضة',
  'اذكر اسم حلوى أو مشروب',
  'اذكر اسم حرف من الحروف الأبجدية',
  'اذكر رقم من 1 إلى 100',
  'اذكر اسم قناة أو حساب تيك توك تعرفه',
];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function normalizeAnswer(raw) {
  let s = String(raw).trim().replace(/\s+/g, ' ');
  s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  s = s.replace(/^ال/, '');
  return s.trim();
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

const hasGameStarted = ref(false);
const gamePhase = ref('idle'); // idle | collecting | sorting
const roundNumber = ref(0);
let roundDuration = 30;
const timeLeft = ref(0);
let collectingCountdown = null;
const currentRoundAnswers = new Map(); // name -> {name, rawAnswer, normalizedAnswer}
const excludedKeys = reactive(new Set());
const eventLog = ref([]);
let currentQuestion = '';
const usedQuestionIndices = new Set();
const answersVersion = ref(0); // يُستخدم لإجبار إعادة حساب المجموعات عند تغيّر الإجابات

const answerPrefixInput = ref('ج');
const winScoreInput = ref(20);
const roundDurationInput = ref(30);
const questionInput = ref('');
const extendSecondsInput = ref(15);
const manualNameInput = ref('');
const manualAnswerInput = ref('');

const gameSettingsLocked = computed(() => hasGameStarted.value);
const roundControlsDisabled = computed(() => gamePhase.value !== 'idle');

function getAnswerPrefix() { return answerPrefixInput.value.trim() || 'ج'; }
const prefixHint = computed(() => `مثال: يكتب المشاهد "${getAnswerPrefix()} تفاح" أو "${getAnswerPrefix()}تفاح" عشان تُحتسب إجابته`);

function pickRandomQuestion() {
  if (gamePhase.value !== 'idle') return;
  if (usedQuestionIndices.size >= QUESTION_LIBRARY.length) {
    usedQuestionIndices.clear();
    appendLog('<div class="log-item" style="color:#8b93a3;">📚 تم استخدام كل أسئلة المكتبة — بدأت الدورة من جديد</div>');
  }
  const available = QUESTION_LIBRARY.map((q, i) => i).filter((i) => !usedQuestionIndices.has(i));
  const index = available[Math.floor(Math.random() * available.length)];
  usedQuestionIndices.add(index);
  questionInput.value = QUESTION_LIBRARY[index];
}

const showLibraryOverlay = ref(false);
function openLibrary() {
  if (gamePhase.value !== 'idle') return;
  showLibraryOverlay.value = true;
}
function closeLibrary() { showLibraryOverlay.value = false; }
function selectLibraryQuestion(index) {
  usedQuestionIndices.add(index);
  questionInput.value = QUESTION_LIBRARY[index];
  closeLibrary();
}
const libraryItems = computed(() => QUESTION_LIBRARY.map((q, i) => ({ text: q, index: i, isUsed: usedQuestionIndices.has(i) })));

function getWinScore() {
  let val = parseInt(winScoreInput.value, 10);
  if (Number.isNaN(val) || val < 1) val = 1;
  winScoreInput.value = val;
  return val;
}
function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 10) val = 10;
  if (val > 180) val = 180;
  roundDurationInput.value = val;
  return val;
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

function startRound() {
  if (gamePhase.value !== 'idle') return;
  const question = questionInput.value.trim();
  if (question === '') {
    openModal('تنبيه', ['<div class="log-item">لازم تكتب سؤال الجولة أول!</div>']);
    return;
  }

  if (!hasGameStarted.value) hasGameStarted.value = true;

  roundNumber.value++;
  currentQuestion = question;
  roundDuration = getRoundDuration();
  timeLeft.value = roundDuration;
  currentRoundAnswers.clear();
  excludedKeys.clear();
  gamePhase.value = 'collecting';
  answersVersion.value++;

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 الجولة ${roundNumber.value}: فُتح باب الإجابات (${roundDuration} ثانية) — السؤال: ${escapeHtml(question)}</div>`);

  startCollectingTimer();
}

function extendRound() {
  if (gamePhase.value !== 'collecting') return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 15;
  timeLeft.value += add;
  appendLog(`<div class="log-item" style="text-align:center; color:#8e44ad;">⏱️ مُدِّد وقت الجمع ${add} ثانية إضافية</div>`);
}

function startCollectingTimer() {
  if (collectingCountdown) clearInterval(collectingCountdown);
  collectingCountdown = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(collectingCountdown);
      collectingCountdown = null;
      endCollecting();
    }
  }, 1000);
}

function registerAnswer(name, rawAnswer) {
  if (gamePhase.value !== 'collecting') return false;
  if (!name) return false;
  const normalized = normalizeAnswer(rawAnswer);
  if (normalized === '') return false;
  currentRoundAnswers.set(name, { name, rawAnswer: rawAnswer.trim(), normalizedAnswer: normalized });
  answersVersion.value++;
  return true;
}

function registerAnswerFromComment(username, rawComment) {
  if (gamePhase.value !== 'collecting' || !username || !rawComment) return;
  const prefix = getAnswerPrefix();
  const text = rawComment.trim();
  if (!text.startsWith(prefix)) return;
  const answerPart = text.slice(prefix.length).trim();
  if (answerPart === '') return;
  registerAnswer(username, answerPart);
}

function manualAddAnswer() {
  if (gamePhase.value !== 'collecting') return;
  const name = manualNameInput.value.trim();
  const answer = manualAnswerInput.value.trim();
  if (name === '' || answer === '') return;
  registerAnswer(name, answer);
  manualAnswerInput.value = '';
}

function endCollecting() {
  if (gamePhase.value !== 'collecting') return;
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  gamePhase.value = 'sorting';

  const totalAnswers = currentRoundAnswers.size;
  const groupCount = activeGroups.value.length;
  appendLog(`<div class="log-item" style="text-align:center;">⏳ انتهى وقت الجمع — استلمنا ${totalAnswers} إجابة، مجمّعة في ${groupCount} بطاقة</div>`);
}

function buildGroupsFrom(predicate) {
  const groups = new Map();
  currentRoundAnswers.forEach((entry) => {
    if (!predicate(entry.normalizedAnswer)) return;
    if (!groups.has(entry.normalizedAnswer)) {
      groups.set(entry.normalizedAnswer, { key: entry.normalizedAnswer, answer: entry.normalizedAnswer, players: [] });
    }
    groups.get(entry.normalizedAnswer).players.push(entry.name);
  });
  return Array.from(groups.values());
}

const activeGroups = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return buildGroupsFrom((key) => !excludedKeys.has(key))
    .sort((a, b) => b.players.length - a.players.length || a.answer.localeCompare(b.answer, 'ar'));
});
const excludedGroups = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return buildGroupsFrom((key) => excludedKeys.has(key));
});

function excludeGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  excludedKeys.add(key);
  answersVersion.value++;
}
function restoreGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  excludedKeys.delete(key);
  answersVersion.value++;
}

function confirmScoring() {
  if (gamePhase.value !== 'sorting') return;
  const groups = activeGroups.value;
  const logs = [];
  const newWinners = [];
  const winScore = getWinScore();

  groups.forEach((group) => {
    const points = group.players.length > 1 ? 1 : 5;
    const badge = group.players.length > 1 ? '🔁 مكررة' : '🌟 فريدة';
    group.players.forEach((name) => {
      const player = getOrCreatePlayer(name);
      const wasWinnerAlready = player.score >= winScore;
      player.score += points;
      if (!wasWinnerAlready && player.score >= winScore) newWinners.push(player.name);
    });
    logs.push(`<div class="log-item ${group.players.length > 1 ? 'log-hit' : 'log-star'}">${badge}: <b>${escapeHtml(group.answer)}</b> (${group.players.length} لاعب) — كل واحد +${points} نقطة: ${group.players.map((n) => escapeHtml(n)).join('، ')}</div>`);
  });

  if (groups.length === 0) {
    logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي إجابة معتمدة بهذي الجولة.</div>');
  }

  if (newWinners.length > 0) {
    logs.push(`<div style="text-align:center; font-size:16px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px; margin-top:6px;">🏆 وصل لنقاط الفوز (${winScore}): <b>${newWinners.map((n) => escapeHtml(n)).join('، ')}</b> 🏆</div>`);
  }

  logs.forEach((l) => appendLog(l));
  saveScores();

  gamePhase.value = 'idle';
  currentRoundAnswers.clear();
  excludedKeys.clear();
  answersVersion.value++;
  questionInput.value = '';

  openModal(`نتائج التوزيع - الجولة ${roundNumber.value}`, logs);
}

function resetGame() {
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  playersScores.clear();
  saveScores();
  hasGameStarted.value = false;
  gamePhase.value = 'idle';
  roundNumber.value = 0;
  currentRoundAnswers.clear();
  excludedKeys.clear();
  answersVersion.value++;
  eventLog.value = [];
  usedQuestionIndices.clear();
  questionInput.value = '';
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const stageQuestionText = computed(() => {
  if (gamePhase.value === 'collecting') return currentQuestion;
  return hasGameStarted.value ? 'استعدوا... السؤال القادم بعد شوي!' : 'اضغط "بدء الجولة" لعرض السؤال هنا';
});
const stageTimerText = computed(() => {
  if (gamePhase.value === 'collecting') return String(timeLeft.value);
  if (gamePhase.value === 'sorting') return '🗂️';
  return '--';
});
const stageTimerUrgent = computed(() => gamePhase.value === 'collecting' && timeLeft.value <= 5);
const stageStatusText = computed(() => {
  if (gamePhase.value === 'idle') return 'جاهز لبدء جولة جديدة';
  if (gamePhase.value === 'collecting') return `✍️ باب الإجابات مفتوح — اكتب إجابتك بالدردشة تبدأ بـ "${getAnswerPrefix()}"`;
  return 'المستضيف يفرز الإجابات الآن...';
});

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }
const currentWinScore = computed(() => getWinScore());

function cardBadge(group) {
  const isUnique = group.players.length === 1;
  const points = isUnique ? 5 : 1;
  return isUnique ? `🌟 فريدة! +${points}` : `🔁 مكررة +${points}`;
}

const manualPanelVisible = computed(() => gamePhase.value === 'collecting');
const sortingPanelVisible = computed(() => gamePhase.value === 'sorting');
const startBtnVisible = computed(() => gamePhase.value === 'idle');
const collectingBtnsVisible = computed(() => gamePhase.value === 'collecting');
const confirmBtnVisible = computed(() => gamePhase.value === 'sorting');

const showRulesOverlay = ref(false);
function goHome() {
  try { localStorage.removeItem(SCORES_KEY); } catch (e) { /* noop */ }
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

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) registerAnswerFromComment(data.user, data.comment);
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {});
onUnmounted(() => {
  if (collectingCountdown) clearInterval(collectingCountdown);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: اللاعبون يكتبون إجاباتهم بالدردشة مسبوقة بمفتاح الالتقاط</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label for="answerPrefixInput">🔑 مفتاح التقاط الإجابات (يتجاهل النظام أي تعليق ما يبدأ فيه):</label>
    <div class="round-time-row">
      <input v-model="answerPrefixInput" type="text" maxlength="5" :disabled="gameSettingsLocked">
      <div class="field-hint" style="margin-top:0;">{{ prefixHint }}</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="winScoreInput">🏆 نقاط الفوز (تُحدَّد مرة وحدة قبل أول جولة، وتُقفَل بعدها):</label>
    <div class="round-time-row">
      <input v-model="winScoreInput" type="number" min="1" :disabled="gameSettingsLocked">
      <div class="field-hint" style="margin-top:0;">أول لاعب يوصل لهذا الرصيد يُعلَن فائزاً وتُظهر لوحة الصدارة تتويجه 🏆</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة جمع الإجابات بالثواني (يحددها المستضيف كل جولة):</label>
    <div class="round-time-row">
      <input v-model="roundDurationInput" type="number" min="10" max="180" :disabled="roundControlsDisabled">
      <div class="field-hint" style="margin-top:0;">بعد انتهاء الوقت يُغلق باب الإجابات وتظهر شاشة الفرز</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="questionInput">❓ سؤال هذه الجولة:</label>
    <textarea id="questionInput" v-model="questionInput" :disabled="roundControlsDisabled" placeholder="اكتب سؤالاً مفتوحاً... مثال: اذكر اسم فاكهة"></textarea>
    <div style="display:flex; gap:5px; width:100%; margin-top:10px; flex-wrap:wrap;">
      <button class="master-btn" style="padding:8px 15px; font-size:0.9rem; flex:1; min-width:160px; margin:0;" :disabled="roundControlsDisabled" @click="pickRandomQuestion">🎲 سؤال عشوائي من المكتبة</button>
      <button class="master-btn" style="padding:8px 15px; font-size:0.9rem; background:#3498db; flex:1; min-width:160px; margin:0;" :disabled="roundControlsDisabled" @click="openLibrary">📚 تصفح المكتبة</button>
    </div>
    <div class="field-hint">اضغط 🎲 لسؤال عشوائي جديد، أو 📚 لتصفح كل أسئلة المكتبة واختيار واحد يدوياً</div>
  </div>

  <h1>🧩 لعبة الكلمة الفريدة</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button v-if="startBtnVisible" class="master-btn" @click="startRound">🚀 بدء الجولة (فتح باب الإجابات)</button>
    <input v-if="collectingBtnsVisible" v-model="extendSecondsInput" type="number" min="5" max="600" style="width:70px; flex:none;" title="مقدار التمديد بالثواني">
    <button v-if="collectingBtnsVisible" class="master-btn" style="background:#8e44ad;" @click="extendRound">⏱️ تمديد</button>
    <button v-if="collectingBtnsVisible" class="master-btn" style="background:#3498db;" @click="endCollecting">⏹️ إنهاء الجمع الآن</button>
    <button v-if="confirmBtnVisible" class="master-btn" @click="confirmScoring">✅ اعتماد وتوزيع النقاط</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🎥 شاشة العرض للجمهور</h2>
      <div class="stage-question">{{ stageQuestionText }}</div>
      <div class="stage-timer" :class="{ urgent: stageTimerUrgent }">{{ stageTimerText }}</div>
      <div class="stage-status">{{ stageStatusText }}</div>
      <div class="scoreboard-title">🏆 لوحة الصدارة</div>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-winner': p.score >= currentWinScore }">
          <span><span class="lb-rank">{{ rankFor(i) }}</span>{{ p.name }}{{ p.score >= currentWinScore ? ' 🏆' : '' }}</span>
          <span>{{ p.score }} نقطة</span>
        </div>
      </div>
    </div>

    <div v-if="manualPanelVisible" class="panel" style="display:flex;">
      <h3>✍️ إضافة إجابة يدوياً (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualAnswerInput" type="text" placeholder="الإجابة" @keydown.enter.prevent="manualAddAnswer">
        <button class="master-btn" @click="manualAddAnswer">إضافة</button>
      </div>
    </div>

    <div v-if="sortingPanelVisible" class="panel" style="display:flex;">
      <h3>🗂️ فرز الإجابات (اضغط ❌ لاستبعاد إجابة وكل من كتبها)</h3>
      <div class="answer-cards-grid">
        <div v-if="activeGroups.length === 0" class="field-hint">ما فيه أي إجابة وصلت هذي الجولة</div>
        <div v-for="g in activeGroups" :key="g.key" class="answer-card" :class="{ 'is-unique': g.players.length === 1 }">
          <button class="card-action-btn remove-btn" title="استبعاد" @click="excludeGroup(g.key)">❌</button>
          <div class="answer-text">{{ g.answer }}</div>
          <div class="answer-meta">{{ g.players.length }} لاعب{{ g.players.length > 1 ? 'اً' : '' }}</div>
          <div class="answer-badge">{{ cardBadge(g) }}</div>
        </div>
      </div>
      <div v-if="excludedGroups.length > 0" class="excluded-wrap" style="display:block;">
        <div class="scoreboard-title">🗑️ إجابات مستبعدة (اضغط ↩️ للاسترجاع)</div>
        <div class="answer-cards-grid">
          <div v-for="g in excludedGroups" :key="g.key" class="answer-card is-excluded" :class="{ 'is-unique': g.players.length === 1 }">
            <button class="card-action-btn restore-btn" title="استرجاع" @click="restoreGroup(g.key)">↩️</button>
            <div class="answer-text">{{ g.answer }}</div>
            <div class="answer-meta">{{ g.players.length }} لاعب{{ g.players.length > 1 ? 'اً' : '' }}</div>
            <div class="answer-badge">{{ cardBadge(g) }}</div>
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

  <div v-if="showLibraryOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>📚 مكتبة الأسئلة</h2>
      <ul class="rules-list" style="max-height: 60vh; overflow-y: auto;">
        <li
          v-for="item in libraryItems"
          :key="item.index"
          class="library-item"
          :class="{ 'is-used': item.isUsed }"
          @click="selectLibraryQuestion(item.index)"
        >
          <span>{{ item.text }}</span>
          <span v-if="item.isUsed" class="lib-used-badge">✅ استُخدم</span>
        </li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="closeLibrary">🔙 رجوع للعبة</button>
    </div>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة الكلمة الفريدة 🧩</h2>
      <ul class="rules-list">
        <li><b>السؤال:</b> يطرح المستضيف سؤالاً مفتوحاً، ويحدد مفتاح الالتقاط (مثل "ج" أو "!") ومدة الجمع قبل الضغط على "بدء الجولة"</li>
        <li><b>الإجابة:</b> يكتب المشاهد إجابته بالدردشة مسبوقة بالمفتاح، مثل "ج تفاح" أو "!تفاح" — أي تعليق ما يبدأ بالمفتاح يُتجاهل تماماً</li>
        <li><b>التجميع:</b> خلال مدة الجولة تُجمع كل الإجابات بدون احتساب أي نقاط، وكل لاعب آخر إجابة يكتبها هي المعتمدة له</li>
        <li><b>التنظيف التلقائي:</b> تُوحَّد الإجابات المتشابهة تلقائياً (إزالة المسافات الزائدة، حذف "ال" التعريف، وتوحيد أ/إ/آ إلى ا و ة إلى ه) عشان تتجمع نفس الكلمة مع بعض حتى لو اختلفت كتابتها شوي</li>
        <li><b>الفرز:</b> بعد انتهاء الوقت تظهر الإجابات كبطاقات مجمعة، ويقدر المستضيف يضغط ❌ على أي بطاقة لاستبعادها هي وكل من كتبها، مع إمكانية التراجع (↩️) قبل اعتماد النقاط</li>
        <li><b>التنقيط:</b> عند الضغط على "اعتماد وتوزيع النقاط" — الإجابة المكررة (كتبها أكثر من لاعب) تعطي كل واحد منهم نقطة واحدة، والإجابة المنفردة (كتبها لاعب واحد فقط) تعطيه 5 نقاط</li>
        <li><b>الفوز:</b> أول لاعب يوصل لنقاط الفوز المحددة بداية اللعبة يُعلَن فائزاً على لوحة الصدارة 🏆، وتقدر تكمل جولات أكثر أو تضغط "إعادة اللعبة بالكامل" للبدء من جديد</li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="showRulesOverlay = false">🔙 رجوع للعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 30px; }
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

textarea { height: 60px; resize: vertical; }
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
  width: 110px;
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

.library-item {
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.library-item:hover { background: #2a2a40; }
.library-item.is-used { opacity: 0.5; border-right-color: #8b93a3; }
.library-item .lib-used-badge { font-size: 0.75rem; color: #2ecc71; white-space: nowrap; }

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

.stage-question {
  font-size: 1.5rem;
  font-weight: bold;
  text-align: center;
  color: #fff;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 14px;
  min-height: 2.4em;
  line-height: 1.45;
  width: 100%;
}

.stage-timer {
  font-size: 42px;
  font-weight: bold;
  text-align: center;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 6px;
}

.stage-timer.urgent { color: #ff4757; }

.stage-status {
  text-align: center;
  color: #ccd6e0;
  font-size: 0.92rem;
  margin-bottom: 14px;
  min-height: 1.3em;
}

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
.leaderboard-item.is-winner { background: #f39c12; color: #1e1e2f; font-weight: bold; }

.manual-add-row { display: flex; gap: 5px; width: 100%; flex-wrap: wrap; }
.manual-add-row input { flex: 1; min-width: 120px; }
.manual-add-row button { flex: none; padding: 8px 15px; font-size: 0.9rem; }

.answer-cards-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
  justify-content: center;
}

.answer-card {
  position: relative;
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 14px 34px 12px 14px;
  min-width: 150px;
  text-align: center;
}

.answer-card.is-unique {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.answer-card.is-excluded { opacity: 0.55; }

.answer-card .answer-text {
  font-size: 1.05rem;
  font-weight: bold;
  margin-bottom: 6px;
  word-break: break-word;
}

.answer-card .answer-meta { font-size: 0.78rem; color: #bdc3c7; }

.answer-card .answer-badge {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 10px;
  background: rgba(52, 152, 219, 0.25);
  color: #eaf4ff;
}

.answer-card.is-unique .answer-badge {
  background: rgba(243, 156, 18, 0.3);
  color: #ffe6b3;
}

.answer-card .card-action-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1;
  color: white;
}

.answer-card .remove-btn { background: #8A1538; }
.answer-card .restore-btn { background: #27ae60; }

.excluded-wrap {
  width: 100%;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255,255,255,0.15);
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
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.event-log-panel :deep(.log-star) { border-right: 4px solid var(--primary-color); }

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
  max-width: 400px;
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
