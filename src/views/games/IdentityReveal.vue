<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler,
} from '../../utils/tiktokConnectionManager';

const router = useRouter();

// ===== بنك الأسئلة العامة =====
const QUESTION_POOL = [
  'اسم ولد بحرف ف؟',
  'اسم بنت بحرف س؟',
  'دولة آسيوية؟',
  'دولة أوروبية؟',
  'طبق تراثي؟',
  'لون تحبه؟',
  'حيوان أليف؟',
  'فاكهة صيفية؟',
  'مدينة عربية؟',
  'نوع رياضة؟',
  'مسلسل تشاهده؟',
  'مشروب تفضله؟',
  'هواية تمارسها؟',
  'نوع حلى؟',
  'وسيلة مواصلات؟',
  'مهنة تحلم فيها؟',
  'لعبة فيديو تلعبها؟',
  'توابل تحبها؟',
  'اسم فنان أو فنانة؟',
  'موسم تفضله؟',
];

function pickQuestions(count) {
  return [...QUESTION_POOL].sort(() => 0.5 - Math.random()).slice(0, count);
}

function normalizeName(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function commentMatchesName(commentRaw, name) {
  const normComment = normalizeName(commentRaw);
  const normName = normalizeName(name);
  if (!normComment || !normName) return false;
  if (normComment === normName) return true;
  const tokens = normComment.split(' ').filter(Boolean);
  return tokens.includes(normName);
}

// ===== حالة الشاشة =====
const screen = ref('setup'); // setup | playing | reveal
const barExpanded = ref(true);

// ===== إعداد الأسئلة والتسجيل =====
const numQuestionsInput = ref(5);
const activeQuestions = ref([]);
const registrationOpen = ref(false);
const registrationDurationInput = ref(90);
const registrationTimeLeft = ref(0);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const players = reactive([]); // { user, answers: [] }
const registeredUsers = new Set();
const usedPlayers = new Set();

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية. كل متابع يكتب إجاباته الخمس بتعليق واحد مفصولة بفاصلة (،).`
  : '🔒 التسجيل مغلق — حدد عدد الأسئلة والمدة واضغط "بدء التسجيل".'));

function openRegistration() {
  let n = parseInt(numQuestionsInput.value, 10);
  if (Number.isNaN(n) || n < 3) n = 3;
  numQuestionsInput.value = n;
  activeQuestions.value = pickQuestions(n);

  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 10) dur = 10;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;

  if (registrationTimer) clearInterval(registrationTimer);
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) closeRegistration();
  }, 1000);
}
function extendRegistration() {
  if (!registrationOpen.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
}
function closeRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
}

function tryRegister(user, commentRaw) {
  if (!registrationOpen.value) return;
  if (registeredUsers.has(user)) return;
  const text = String(commentRaw).trim();
  if (!text) return;

  const parts = text.split(/[,،/]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < activeQuestions.value.length) return;

  registeredUsers.add(user);
  players.push({ user, answers: parts.slice(0, activeQuestions.value.length) });
}

// ===== إعداد الجولة =====
const level = ref('normal'); // normal | easy
const numWinnersInput = ref(1);
const currentTargets = ref([]);
const revealedCount = ref(0);
const hintProgress = ref(0);
const winners = reactive([]); // { user, targetIndex, targetName }
let progressInterval = null;
let elapsedMs = 0;

const requiredPlayers = computed(() => (level.value === 'easy' ? 2 : 1));
const canStartRound = computed(() => !registrationOpen.value && players.length >= requiredPlayers.value);

function pickTargets(count) {
  let pool = players.filter((p) => !usedPlayers.has(p.user));
  if (pool.length < count) {
    usedPlayers.clear();
    pool = players;
  }
  const shuffled = [...pool].sort(() => 0.5 - Math.random()).slice(0, count);
  shuffled.forEach((p) => usedPlayers.add(p.user));
  return shuffled;
}

function startRound() {
  if (!canStartRound.value) return;
  let need = parseInt(numWinnersInput.value, 10);
  if (Number.isNaN(need) || need < 1) need = 1;
  numWinnersInput.value = need;

  winners.length = 0;
  revealedCount.value = 1; // أول تلميح يظهر فوراً
  hintProgress.value = 0;
  elapsedMs = 0;

  currentTargets.value = pickTargets(requiredPlayers.value);
  screen.value = 'playing';

  if (progressInterval) clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    elapsedMs += 100;
    hintProgress.value = Math.min(100, (elapsedMs / 10000) * 100);
    if (elapsedMs >= 10000) {
      elapsedMs = 0;
      if (revealedCount.value < activeQuestions.value.length) {
        revealedCount.value++;
      }
    }
  }, 100);
}

function stopRoundTimers() {
  if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
}

function finishRound() {
  stopRoundTimers();
  screen.value = 'reveal';
}

function revealNow() {
  if (screen.value !== 'playing') return;
  finishRound();
}

function checkGuess(user, commentRaw) {
  if (screen.value !== 'playing') return;
  if (winners.some((w) => w.user === user)) return;

  for (let i = 0; i < currentTargets.value.length; i++) {
    const target = currentTargets.value[i];
    if (commentMatchesName(commentRaw, target.user)) {
      winners.push({ user, targetIndex: i, targetName: target.user });
      break;
    }
  }

  const need = parseInt(numWinnersInput.value, 10) || 1;
  if (winners.length >= need) finishRound();
}

function nextRound() {
  screen.value = 'setup';
}

function resetGame() {
  closeRegistration();
  stopRoundTimers();
  players.length = 0;
  registeredUsers.clear();
  usedPlayers.clear();
  winners.length = 0;
  currentTargets.value = [];
  activeQuestions.value = [];
  screen.value = 'setup';
}

function goHome() {
  resetGame();
  router.push('/');
}

// ===== موزّع تعليقات الشات (نقطة الدخول الوحيدة لأي تعليق حقيقي أو محاكى) =====
function handleChatMessage(user, commentRaw) {
  if (!user || commentRaw === undefined || commentRaw === null) return;
  if (registrationOpen.value) { tryRegister(user, commentRaw); return; }
  if (screen.value === 'playing') checkGuess(user, commentRaw);
}

// ===== ربط تيك توك لايف (اختياري) =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function handleTiktokMessage(data) {
  if (data.comment) handleChatMessage(data.user, data.comment);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'identity-reveal', onMessage: handleTiktokMessage });
}

// ===== محاكاة الدردشة (لاختبار دورة اللعبة كاملة بدون بث حقيقي) =====
const simulationOn = ref(false);
let simTimer = null;
let simCounter = 0;

const FAKE_USER_PREFIXES = ['سلطان', 'نورة', 'بندر', 'لمى', 'فيصل', 'ريم', 'عبدالله', 'هيا', 'تركي', 'منى', 'زياد', 'جود'];
const FAKE_ANSWER_BANK = ['فهد', 'اليابان', 'كبسة', 'أزرق', 'قطة', 'تفاح', 'جدة', 'كرة قدم', 'فرندز', 'شاي', 'قراءة', 'كنافة', 'دراجة', 'طبيب', 'فيفا', 'زعتر', 'يوسف', 'الصيف'];
const FAKE_GUESS_POOL = ['سارة', 'خالد', 'أحمد', 'نوف', 'ماجد', 'شيخة', 'عمر', 'دانة', 'راكان', 'الين'];

function randomFakeUser() {
  simCounter++;
  const prefix = FAKE_USER_PREFIXES[Math.floor(Math.random() * FAKE_USER_PREFIXES.length)];
  return `${prefix}_${simCounter}${Math.floor(Math.random() * 90)}`;
}
function randomAnswerComment() {
  const count = Math.max(activeQuestions.value.length, 3);
  const picks = [];
  for (let i = 0; i < count; i++) {
    picks.push(FAKE_ANSWER_BANK[Math.floor(Math.random() * FAKE_ANSWER_BANK.length)]);
  }
  return picks.join('، ');
}

function toggleSimulation() {
  if (simulationOn.value) {
    simulationOn.value = false;
    if (simTimer) { clearInterval(simTimer); simTimer = null; }
    return;
  }
  simulationOn.value = true;
  if (simTimer) clearInterval(simTimer);
  simTimer = setInterval(() => {
    if (registrationOpen.value) {
      handleChatMessage(randomFakeUser(), randomAnswerComment());
      return;
    }
    if (screen.value === 'playing' && currentTargets.value.length) {
      const wantsCorrect = Math.random() < 0.3;
      if (wantsCorrect) {
        const target = currentTargets.value[Math.floor(Math.random() * currentTargets.value.length)];
        handleChatMessage(randomFakeUser(), target.user);
      } else {
        const guess = FAKE_GUESS_POOL[Math.floor(Math.random() * FAKE_GUESS_POOL.length)];
        handleChatMessage(randomFakeUser(), guess);
      }
    }
  }, 900);
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (screen.value === 'setup') {
      if (canStartRound.value) startRound();
    } else if (screen.value === 'playing') {
      revealNow();
    } else if (screen.value === 'reveal') {
      nextRound();
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  stopRoundTimers();
  if (simTimer) clearInterval(simTimer);
  clearMessageHandler();
});
</script>

<template>
  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="screen === 'setup'" type="button" class="master-btn side-panel-btn" :disabled="!canStartRound" @click="startRound">▶️ بدء الجولة</button>
    <button v-if="screen === 'playing'" type="button" class="rules-btn side-panel-btn" @click="revealNow">👁️ كشف الآن</button>
    <button v-if="screen === 'reveal'" class="master-btn side-panel-btn" @click="nextRound">➡️ الجولة التالية</button>
    <span class="side-panel-badge">👥 اللاعبون المسجّلون: {{ players.length }}</span>
    <template v-if="barExpanded">
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? closeRegistration() : openRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <!-- ===== شاشة الإعداد: التسجيل + إعداد الجولة ===== -->
  <div v-if="screen === 'setup'" class="screen active">
    <div class="setup-container">
      <h1>🕵️ كشف الهوية</h1>
      <div class="subtitle">منصة تحديات 956BR</div>

      <div class="tiktok-box">
        <label for="tiktokUsername">🔴 ربط بث تيك توك لايف (اختياري)</label>
        <div class="tiktok-row">
          <button type="button" class="rules-btn" style="flex:1;" @click="toggleSimulation">
            {{ simulationOn ? '⏹️ إيقاف المحاكاة' : '🧪 تشغيل محاكاة الدردشة' }}
          </button>
        </div>
        <p v-if="simulationOn" class="tiktok-hint">🧪 المحاكاة تعمل الآن: تعليقات وهمية تُغذّي التسجيل ثم التخمين تلقائياً لاختبار اللعبة.</p>
      </div>

      <div class="reg-box">
        <h3>1️⃣ التسجيل</h3>
        <div class="tiktok-row">
          <input v-model="numQuestionsInput" type="number" min="3" :disabled="registrationOpen" placeholder="عدد الأسئلة (3 فأكثر)">
          <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="10" placeholder="مدة التسجيل (ثانية)">
        </div>
        <div class="tiktok-row" style="margin-top:10px;">
          <button v-if="!registrationOpen" type="button" class="master-btn" @click="openRegistration">🟢 بدء التسجيل</button>
          <template v-else>
            <input v-model="extendSecondsInput" type="number" min="5" placeholder="ثواني التمديد">
            <button type="button" class="master-btn" @click="extendRegistration">⏱️ تمديد</button>
            <button type="button" class="reset-btn" @click="closeRegistration">⛔ إيقاف التسجيل</button>
          </template>
        </div>
        <div class="tiktok-hint registration-status">{{ registrationStatusHint }}</div>

        <div v-if="activeQuestions.length" class="questions-list">
          <span v-for="(q, i) in activeQuestions" :key="i" class="q-chip">{{ i + 1 }}. {{ q }}</span>
        </div>

        <div class="players-counter">👥 اللاعبون المسجّلون: <strong>{{ players.length }}</strong></div>
      </div>

      <div class="reg-box">
        <h3>2️⃣ إعداد الجولة</h3>
        <div class="level-select">
          <button type="button" class="level-btn" :class="{ active: level === 'normal' }" @click="level = 'normal'">🎯 عادي (لاعب واحد)</button>
          <button type="button" class="level-btn" :class="{ active: level === 'easy' }" @click="level = 'easy'">🤝 أسهل (لاعبان)</button>
        </div>
        <div class="tiktok-row" style="margin-top:12px;">
          <input v-model="numWinnersInput" type="number" min="1" placeholder="عدد الفائزين المطلوب لإنهاء الجولة">
        </div>
        <p v-if="registrationOpen" class="tiktok-hint">⚠️ أوقف التسجيل أولاً قبل بدء الجولة.</p>
        <p v-else-if="players.length < requiredPlayers" class="tiktok-hint">⚠️ تحتاج {{ requiredPlayers }} لاعب/لاعبين مسجلين على الأقل لهذا المستوى.</p>
      </div>

      <button class="home-btn" style="display:block; width:100%; margin-top:12px;" @click="goHome">🏠 الخروج</button>

      <div class="footer-note" style="border:0; margin-top:20px;">
        <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
      </div>
    </div>
  </div>

  <!-- ===== شاشة اللعب: عرض التلميحات ===== -->
  <div v-if="screen === 'playing'" class="screen active">
    <div class="game-wrapper">
      <header>
        <h1>🕵️ من صاحب هذه الإجابات؟</h1>
        <div class="subtitle">اكتب اسم الشخص اللي تعتقد إنه صاحب التلميحات في الدردشة!</div>
        <div class="top-stats">
          <span class="rounds-badge">{{ level === 'easy' ? 'مستوى: أسهل' : 'مستوى: عادي' }}</span>
          <span class="rounds-badge">🏆 الفائزون: {{ winners.length }} / {{ numWinnersInput }}</span>
        </div>
      </header>

      <div class="progress-track">
        <div class="progress-fill" :style="{ width: hintProgress + '%' }"></div>
      </div>

      <div class="hints-area" :class="{ split: level === 'easy' }">
        <div v-for="(target, tIdx) in currentTargets" :key="target.user" class="hint-column">
          <div class="hint-column-title">{{ level === 'easy' ? (tIdx === 0 ? 'لاعب 🔵 يمين' : 'لاعب 🔴 يسار') : 'التلميحات' }}</div>
          <TransitionGroup name="hint-pop" tag="div" class="hint-list">
            <div v-for="(q, i) in activeQuestions.slice(0, revealedCount)" :key="i" class="hint-card">
              <div class="hint-question">{{ q }}</div>
              <div class="hint-answer">{{ target.answers[i] || '—' }}</div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <div class="host-controls-bar">
        <label class="winners-live-input">
          عدد الفائزين المطلوب:
          <input v-model="numWinnersInput" type="number" min="1">
        </label>
      </div>

      <div v-if="winners.length" class="winners-mini-list">
        <span v-for="(w, i) in winners" :key="i" class="winner-mini-chip">✅ {{ w.user }}</span>
      </div>
    </div>
  </div>

  <!-- ===== شاشة الكشف ===== -->
  <div v-if="screen === 'reveal'" class="screen modal" style="display:flex;">
    <div class="reveal-container">
      <h1 class="reveal-title">🎭 تم الكشف!</h1>

      <TransitionGroup name="reveal-pop" tag="div" class="identity-cards" appear>
        <div v-for="target in currentTargets" :key="target.user" class="identity-card">
          <div class="identity-avatar">🕵️</div>
          <div class="identity-name">{{ target.user }}</div>
          <div class="identity-answers">
            <span v-for="(a, i) in target.answers.slice(0, activeQuestions.length)" :key="i" class="identity-answer-chip">
              {{ activeQuestions[i] }} ← {{ a }}
            </span>
          </div>
        </div>
      </TransitionGroup>

      <div class="winners-final-box">
        <h3 v-if="winners.length">🏆 الفائزون</h3>
        <h3 v-else>لا يوجد فائز هذه الجولة</h3>
        <div class="winners-final-list">
          <span v-for="(w, i) in winners" :key="i" class="winner-final-chip">
            {{ w.user }} <small>(خمّن: {{ w.targetName }})</small>
          </span>
        </div>
      </div>

      <div style="display:flex; gap:15px; justify-content:center; flex-wrap:wrap;">
        <button class="reset-btn" @click="resetGame">🔄 إنهاء وإعادة اللعبة</button>
        <button class="home-btn" @click="goHome">🏠 الخروج</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 25px 15px; justify-content: flex-start; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

.screen {
  width: 100%;
  animation: fadeIn 0.5s ease-in-out;
  display: flex;
  flex-direction: column;
  align-items: center;
}

h1 { font-size: clamp(1.8rem, 4vw, 3rem); }
.subtitle { font-size: 1.05rem; margin-bottom: 20px; text-align: center; }

.setup-container {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 30px 25px;
  border-radius: 16px;
  text-align: center;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  width: 90%;
  max-width: 650px;
  animation: popIn 0.5s ease-out;
}

.tiktok-box, .reg-box {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(243, 156, 18, 0.35);
  border-radius: 12px;
  padding: 15px;
  margin: 14px 0;
  text-align: right;
}
.reg-box h3 { color: var(--primary-color); font-size: 1.15rem; margin-bottom: 12px; text-align: center; }
.tiktok-box > label { display: block; font-weight: bold; margin-bottom: 10px; color: #ecf0f1; font-size: 1rem; }

.tiktok-row { display: flex; gap: 10px; flex-wrap: wrap; }
.tiktok-row input {
  flex: 1;
  min-width: 140px;
  padding: 12px;
  font-size: 1rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  text-align: center;
}
.tiktok-row .master-btn, .tiktok-row .reset-btn, .tiktok-row .rules-btn { margin: 0; font-size: 0.95rem; padding: 10px 18px; }

.tiktok-status { margin: 10px 0 0; font-weight: bold; min-height: 1.2em; }
.tiktok-hint { font-size: 0.82rem; color: #bdc3c7; line-height: 1.7; margin-top: 10px; }
.registration-status { color: #f1c40f; }

.questions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  justify-content: center;
}
.q-chip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85rem;
  color: #ecf0f1;
}

.players-counter {
  margin-top: 14px;
  font-size: 1.1rem;
  color: var(--primary-color);
  text-align: center;
}

.level-select { display: flex; gap: 10px; }
.level-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 2px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 1rem;
  padding: 12px;
}
.level-btn.active {
  border-color: var(--primary-color);
  background: rgba(243, 156, 18, 0.2);
  box-shadow: 0 0 15px var(--border-glow);
}

.game-wrapper {
  max-width: 1400px;
  width: 95vw;
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 2vh 2vw;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 2vh;
}

header { text-align: center; }
header h1 { font-size: clamp(1.8rem, 4vw, 3rem); margin: 6px 0; }

.top-stats {
  display: flex;
  justify-content: center;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.rounds-badge {
  color: var(--primary-color);
  background: rgba(243, 156, 18, 0.15);
  border-radius: 20px;
  border: 1px solid var(--border-glow);
  font-weight: bold;
  padding: 8px 16px;
  font-size: 0.95rem;
}

.progress-track {
  width: 100%;
  height: 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
  transition: width 0.1s linear;
}

.hints-area { display: flex; justify-content: center; gap: 2vw; }
.hints-area.split .hint-column { flex: 1; max-width: 48%; }
.hint-column:not(.split *) { width: 100%; max-width: 700px; margin: 0 auto; }

.hint-column {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 14px;
  padding: 2vh;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.hint-column-title {
  text-align: center;
  font-weight: bold;
  color: var(--primary-color);
  margin-bottom: 12px;
  font-size: 1.1rem;
}

.hint-list { display: flex; flex-direction: column; gap: 10px; }
.hint-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint-question { color: #bdc3c7; font-size: 0.95rem; }
.hint-answer { color: #fff; font-weight: bold; font-size: 1.3rem; text-shadow: 0 0 10px var(--border-glow); }

.host-controls-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}
.winners-live-input {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ecf0f1;
  font-size: 0.95rem;
}
.winners-live-input input {
  width: 70px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  text-align: center;
}
.host-controls-bar .rules-btn { padding: 10px 20px; font-size: 0.95rem; margin: 0; }

.winners-mini-list { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.winner-mini-chip {
  background: rgba(39, 174, 96, 0.2);
  border: 1px solid var(--success-color);
  color: #fff;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85rem;
}

.modal {
  position: fixed;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.85);
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(8px);
}

.reveal-container {
  background: #2a2a40;
  border: 2px solid var(--primary-color);
  border-radius: 16px;
  width: 92%;
  max-width: 950px;
  padding: 35px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 30px var(--border-glow);
  text-align: center;
  animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.reveal-title {
  font-size: clamp(2rem, 4vw, 3rem);
  color: var(--primary-color);
  text-shadow: 0 0 15px var(--border-glow);
  margin-bottom: 25px;
}

.identity-cards {
  display: flex;
  justify-content: center;
  gap: 2vw;
  flex-wrap: wrap;
  margin-bottom: 25px;
}
.identity-card {
  flex: 1;
  min-width: 260px;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid var(--success-color);
  border-radius: 14px;
  padding: 20px;
}
.identity-avatar { font-size: 3rem; margin-bottom: 8px; }
.identity-name {
  font-size: clamp(1.5rem, 3vw, 2.2rem);
  font-weight: bold;
  color: var(--success-color);
  margin-bottom: 12px;
  text-shadow: 0 0 12px rgba(39, 174, 96, 0.5);
}
.identity-answers { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.identity-answer-chip {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 5px 10px;
  font-size: 0.8rem;
  color: #ecf0f1;
}

.winners-final-box { margin-bottom: 25px; }
.winners-final-box h3 { color: var(--primary-color); margin-bottom: 12px; }
.winners-final-list { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.winner-final-chip {
  background: rgba(39, 174, 96, 0.2);
  border: 1px solid var(--success-color);
  color: #fff;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 0.95rem;
}
.winner-final-chip small { color: #bdc3c7; }

/* انتقالات ديناميكية */
.hint-pop-enter-active { transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.hint-pop-enter-from { opacity: 0; transform: translateY(-15px) scale(0.9); }

.reveal-pop-enter-active { transition: all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.reveal-pop-enter-from { opacity: 0; transform: scale(0.5) rotateY(90deg); }

@media (max-width: 768px) {
  .hints-area.split { flex-direction: column; }
  .hints-area.split .hint-column { max-width: 100%; }
}
</style>
