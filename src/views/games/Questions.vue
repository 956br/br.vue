<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import allQuestions from '../../data/questions.js';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, getGiftValue, getGiftName, getGiftUser,
} from '../../utils/tiktokBridge';

const router = useRouter();
const STORAGE_KEY = 'triviaGameData';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function getRandomItems(arr, count) {
  return [...arr].sort(() => 0.5 - Math.random()).slice(0, count);
}

const screen = ref('start'); // start | game | end
const resumeAvailable = ref(!!localStorage.getItem(STORAGE_KEY));

const team1Input = ref('');
const team2Input = ref('');
const teamNames = reactive(['فريق 1', 'فريق 2']);
const scores = reactive([0, 0]);
const currentTeam = ref(0);

const gameData = reactive({ easy: [], medium: [], hard: [] });
let totalQuestions = 36;
const answeredQuestions = ref(0);
const remainingQuestions = computed(() => totalQuestions - answeredQuestions.value);

const modalVisible = ref(false);
const modalTurnIndicator = ref('دور: -');
const modalDiffBadge = ref('المستوى');
const modalQuestionText = ref('جاري تحميل السؤال...');
const modalCloseVisible = ref(false);
const currentOptions = ref([]); // { text, revealClass }
let activeQuestionData = null;
let activeCategory = null;
let activeIndex = null;

const timerValue = ref(20);
const timerWarning = ref(false);
let timerInterval = null;

const scorePulse = reactive([false, false]);

function setupQuestions() {
  const easyList = allQuestions.filter((q) => q.difficulty === 'سهل');
  const medList = allQuestions.filter((q) => q.difficulty === 'متوسط');
  const hardList = allQuestions.filter((q) => q.difficulty === 'صعب');

  gameData.easy = getRandomItems(easyList, 12).map((q) => ({ ...q, answered: false }));
  gameData.medium = getRandomItems(medList, 12).map((q) => ({ ...q, answered: false }));
  gameData.hard = getRandomItems(hardList, 12).map((q) => ({ ...q, answered: false }));

  totalQuestions = gameData.easy.length + gameData.medium.length + gameData.hard.length;
}

function startGame() {
  teamNames[0] = team1Input.value.trim() || 'فريق 1';
  teamNames[1] = team2Input.value.trim() || 'فريق 2';

  scores[0] = 0; scores[1] = 0;
  currentTeam.value = 0;
  answeredQuestions.value = 0;

  setupQuestions();
  screen.value = 'game';
  updateMemberCounts();
  saveGameLocally();
}

function resumeGame() {
  const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (!savedData) return;
  scores[0] = savedData.scores[0];
  scores[1] = savedData.scores[1];
  teamNames[0] = savedData.teamNames[0];
  teamNames[1] = savedData.teamNames[1];
  currentTeam.value = savedData.currentTeam;
  answeredQuestions.value = savedData.answeredQuestions;

  setupQuestions();
  screen.value = 'game';
  updateMemberCounts();
}

function openQuestion(category, index) {
  const item = gameData[category][index];
  if (item.answered) return;
  activeCategory = category;
  activeIndex = index;
  activeQuestionData = item;

  modalDiffBadge.value = `المستوى: ${category === 'easy' ? 'سهل' : category === 'medium' ? 'متوسط' : 'صعب'}`;
  modalTurnIndicator.value = `دور: ${teamNames[currentTeam.value]}`;
  modalQuestionText.value = item.question;

  currentOptions.value = [...item.options].sort(() => 0.5 - Math.random()).map((text) => ({ text, votes: 0, cls: '' }));
  Object.keys(optionVotes).forEach((k) => delete optionVotes[k]);
  votedThisQuestion.clear();
  votingOpen.value = true;

  modalCloseVisible.value = false;
  modalVisible.value = true;

  startTimer();
}

function startTimer() {
  timerValue.value = 20;
  timerWarning.value = false;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerValue.value--;
    if (timerValue.value <= 5) timerWarning.value = true;
    if (timerValue.value <= 0) {
      clearInterval(timerInterval);
      resolveByVotesOrTimeout();
    }
  }, 1000);
}

function resolveByVotesOrTimeout() {
  votingOpen.value = false;
  let best = 0;
  let tied = [];
  Object.keys(optionVotes).forEach((k) => {
    const c = optionVotes[k];
    if (c > best) { best = c; tied = [parseInt(k, 10)]; } else if (c === best && c > 0) { tied.push(parseInt(k, 10)); }
  });

  if (tied.length > 0) {
    const idx = tied[Math.floor(Math.random() * tied.length)];
    processAnswer(idx);
  } else {
    processAnswer(null);
  }
}

function processAnswer(selectedIdx) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  votingOpen.value = false;

  const chosenOption = selectedIdx !== null ? currentOptions.value[selectedIdx].text : null;
  const pointsValue = activeQuestionData.difficulty === 'سهل' ? 10 : (activeQuestionData.difficulty === 'متوسط' ? 20 : 30);

  currentOptions.value.forEach((opt) => { opt.disabled = true; });

  if (chosenOption === activeQuestionData.answer) {
    if (selectedIdx !== null) currentOptions.value[selectedIdx].cls = 'correct';
    scores[currentTeam.value] += pointsValue;
    animateScoreUpdate(currentTeam.value);
  } else {
    if (selectedIdx !== null) currentOptions.value[selectedIdx].cls = 'wrong';
    currentOptions.value.forEach((opt) => {
      if (opt.text === activeQuestionData.answer) opt.cls = 'correct';
    });
  }

  gameData[activeCategory][activeIndex].answered = true;

  answeredQuestions.value++;
  currentTeam.value = currentTeam.value === 0 ? 1 : 0;

  saveGameLocally();
  modalCloseVisible.value = true;
}

function closeModal() {
  modalVisible.value = false;
  votingOpen.value = false;
  updateMemberCounts();
  if (answeredQuestions.value >= totalQuestions) {
    showWinner();
  }
}

const winnerName = ref('');
const winnerScoreText = ref('');

function showWinner() {
  screen.value = 'end';
  if (scores[0] > scores[1]) {
    winnerName.value = `🏆 ${teamNames[0]} 🏆`;
    winnerScoreText.value = `النقاط: ${scores[0]}`;
  } else if (scores[1] > scores[0]) {
    winnerName.value = `🏆 ${teamNames[1]} 🏆`;
    winnerScoreText.value = `النقاط: ${scores[1]}`;
  } else {
    winnerName.value = '🤝 تعادل 🤝';
    winnerScoreText.value = `النقاط: ${scores[0]}`;
  }
  localStorage.removeItem(STORAGE_KEY);
}

function animateScoreUpdate(teamIndex) {
  scorePulse[teamIndex] = true;
  setTimeout(() => { scorePulse[teamIndex] = false; }, 300);
}

function saveGameLocally() {
  const gameProgress = {
    scores: [scores[0], scores[1]], teamNames: [teamNames[0], teamNames[1]], currentTeam: currentTeam.value, answeredQuestions: answeredQuestions.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gameProgress));
}

function resetFullGame() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function goHome() {
  localStorage.removeItem(STORAGE_KEY);
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordTeam1 = ref('1');
const joinWordTeam2 = ref('2');
const joinViaGift = ref(false);
const giftNameTeam1 = ref('');
const giftNameTeam2 = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

const teamMembers = [new Set(), new Set()];
const team1Count = ref(0);
const team2Count = ref(0);
const team1VotesText = ref('👥 0 منضم');
const team2VotesText = ref('👥 0 منضم');
const optionVotes = reactive({});
const votedThisQuestion = new Set();
const votingOpen = ref(false);

function getJoinWordTeam1() { return joinWordTeam1.value.trim() || '1'; }
function getJoinWordTeam2() { return joinWordTeam2.value.trim() || '2'; }

function giftValuePasses(data) {
  const minValue = Number(giftMinValue.value) || 0;
  return minValue <= 0 || getGiftValue(data) >= minValue;
}
function matchTeamByGiftName(data) {
  const name = getGiftName(data).toLowerCase();
  const t1 = giftNameTeam1.value.trim().toLowerCase();
  const t2 = giftNameTeam2.value.trim().toLowerCase();
  if (t1 && name.includes(t1)) return 0;
  if (t2 && name.includes(t2)) return 1;
  return -1;
}

const joinModeHint = computed(() => (joinViaGift.value
  ? '🎁 الانضمام مفعّل عبر الهدايا: حدد اسم هدية للفريق الأول واسم هدية للفريق الثاني (وأقل قيمة اختيارياً)، ومن يرسل هدية تطابق أحد الاسمين ينضم لفريقها تلقائياً.<br>🗳️ التصويت: وقت السؤال، أعضاء الفريق صاحب الدور فقط يكتبون رقم الإجابة (1 إلى 4)، والإجابة الأكثر تصويتاً تُعتمد تلقائياً عند انتهاء المؤقت.'
  : `🎯 الانضمام: المشاهد يكتب <b>"${getJoinWordTeam1()}"</b> للفريق الأول أو <b>"${getJoinWordTeam2()}"</b> للفريق الثاني (مرة واحدة لكل شخص).<br>🗳️ التصويت: وقت السؤال، أعضاء الفريق صاحب الدور فقط يكتبون رقم الإجابة (1 إلى 4)، والإجابة الأكثر تصويتاً تُعتمد تلقائياً عند انتهاء المؤقت.`));

function updateMemberCounts() {
  team1Count.value = teamMembers[0].size;
  team2Count.value = teamMembers[1].size;
  if (!votingOpen.value) {
    team1VotesText.value = `👥 ${teamMembers[0].size} منضم`;
    team2VotesText.value = `👥 ${teamMembers[1].size} منضم`;
  }
}

function updateVoteBadges() {
  let totalVotes = 0;
  currentOptions.value.forEach((opt, i) => {
    const c = optionVotes[i] || 0;
    totalVotes += c;
    opt.votes = c;
  });
  if (currentTeam.value === 0) team1VotesText.value = `🗳️ أصوات ${teamNames[0]}: ${totalVotes}`;
  else team2VotesText.value = `🗳️ أصوات ${teamNames[1]}: ${totalVotes}`;
}

function handleTikTokMessage(user, commentRaw) {
  if (!user || !commentRaw) return;
  const text = normalizeDigits(String(commentRaw)).trim();

  if (registrationOpen.value && !joinViaGift.value && !teamMembers[0].has(user) && !teamMembers[1].has(user)) {
    if (text === normalizeDigits(getJoinWordTeam1())) { teamMembers[0].add(user); updateMemberCounts(); return; }
    if (text === normalizeDigits(getJoinWordTeam2())) { teamMembers[1].add(user); updateMemberCounts(); return; }
  }

  if (!votingOpen.value) return;
  if (!teamMembers[currentTeam.value].has(user)) return;
  if (votedThisQuestion.has(user)) return;

  const n = parseInt(text, 10);
  if (Number.isNaN(n) || n < 1 || n > currentOptions.value.length) return;

  votedThisQuestion.add(user);
  const idx = n - 1;
  optionVotes[idx] = (optionVotes[idx] || 0) + 1;
  updateVoteBadges();
}

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
    if (data.comment) handleTikTokMessage(data.user, data.comment);
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data) && giftValuePasses(data)) {
      const giftUser = getGiftUser(data);
      if (giftUser && !teamMembers[0].has(giftUser) && !teamMembers[1].has(giftUser)) {
        const team = matchTeamByGiftName(data);
        if (team === 0 || team === 1) { teamMembers[team].add(giftUser); updateMemberCounts(); }
      }
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div v-if="screen === 'start'" class="screen active">
    <div class="setup-container">
      <h1>إعداد اللعبة</h1>
      <div class="subtitle">منصة تحديات بو راشد | @956br</div>
      <div class="input-group">
        <input v-model="team1Input" type="text" placeholder="اسم الفريق الأول">
        <input v-model="team2Input" type="text" placeholder="اسم الفريق الثاني">
      </div>

      <div class="tiktok-box">
        <label for="tiktokUsername">🔴 ربط بث تيك توك لايف (اختياري)</label>
        <div class="tiktok-row">
          <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)">
          <button type="button" class="master-btn" @click="connectTikTok">اتصال 🔗</button>
        </div>
        <div class="tiktok-row" style="margin-top:10px;">
          <input v-model="joinWordTeam1" type="text" placeholder="كلمة انضمام الفريق الأول (افتراضياً: 1)" :disabled="joinViaGift">
          <input v-model="joinWordTeam2" type="text" placeholder="كلمة انضمام الفريق الثاني (افتراضياً: 2)" :disabled="joinViaGift">
        </div>
        <div class="tiktok-row" style="margin-top:8px;">
          <label class="join-gift-toggle" for="joinViaGiftCheckbox">
            <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox">
            🎁 الانضمام بإرسال هدية بدل كتابة الكلمة (حسب نوع الهدية)
          </label>
        </div>
        <div v-if="joinViaGift" class="tiktok-row gift-filter-row">
          <select v-model="giftNameTeam1">
            <option value="">🎁 هدية الفريق الأول</option>
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
          <select v-model="giftNameTeam2">
            <option value="">🎁 هدية الفريق الثاني</option>
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
        <p class="tiktok-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
        <div class="tiktok-hint" v-html="joinModeHint"></div>
        <div class="tiktok-row registration-row">
          <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
          <span v-if="!registrationOpen" class="tiktok-hint" style="margin:0;">ثانية</span>
          <button v-if="!registrationOpen" type="button" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
          <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
          <button v-if="registrationOpen" type="button" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
          <button v-if="registrationOpen" type="button" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
        </div>
        <div class="tiktok-hint registration-status">{{ registrationStatusHint }}</div>
        <div class="tiktok-counts">
          <span class="tk-count tk-a">🔵 أعضاء الفريق 1: {{ team1Count }}</span>
          <span class="tk-count tk-b">🔴 أعضاء الفريق 2: {{ team2Count }}</span>
        </div>
      </div>

      <button class="master-btn" @click="startGame">بدء التحدي</button>
      <button v-if="resumeAvailable" class="rules-btn" style="margin-top:12px;" @click="resumeGame">استكمال اللعبة السابقة</button>
      <button class="home-btn" style="display:block; width:100%; margin-top:12px;" @click="goHome">🏠 الخروج</button>

      <div class="footer-note" style="border:0; margin-top:20px;">
        <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
      </div>
    </div>
  </div>

  <div v-if="screen === 'game'" class="screen active">
    <div class="game-wrapper">
      <header>
        <h1>تحدي الفرق</h1>
        <div class="subtitle">منصة تحديات بو راشد | @956br</div>
        <div class="top-stats">
          <span>الأسئلة المتبقية: {{ remainingQuestions }}</span>
        </div>
      </header>

      <div class="teams-container">
        <div class="team-card" :class="{ 'active-team': currentTeam === 0 }">
          <h3>{{ teamNames[0] }}</h3>
          <div class="score-val" :style="{ transform: scorePulse[0] ? 'scale(1.5)' : 'scale(1)' }">{{ scores[0] }}</div>
          <div class="team-votes">{{ team1VotesText }}</div>
        </div>
        <div class="team-card" :class="{ 'active-team': currentTeam === 1 }">
          <h3>{{ teamNames[1] }}</h3>
          <div class="score-val" :style="{ transform: scorePulse[1] ? 'scale(1.5)' : 'scale(1)' }">{{ scores[1] }}</div>
          <div class="team-votes">{{ team2VotesText }}</div>
        </div>
      </div>

      <div class="categories-grid">
        <div class="cat-column">
          <h4>سهل (10 نقاط)</h4>
          <div class="q-buttons-grid">
            <button v-for="(q, i) in gameData.easy" :key="i" class="q-btn" :disabled="q.answered" @click="openQuestion('easy', i)">{{ i + 1 }}</button>
          </div>
        </div>
        <div class="cat-column">
          <h4>متوسط (20 نقطة)</h4>
          <div class="q-buttons-grid">
            <button v-for="(q, i) in gameData.medium" :key="i" class="q-btn" :disabled="q.answered" @click="openQuestion('medium', i)">{{ i + 1 }}</button>
          </div>
        </div>
        <div class="cat-column">
          <h4>صعب (30 نقطة)</h4>
          <div class="q-buttons-grid">
            <button v-for="(q, i) in gameData.hard" :key="i" class="q-btn" :disabled="q.answered" @click="openQuestion('hard', i)">{{ i + 1 }}</button>
          </div>
        </div>
      </div>

      <div class="controls-bar">
        <button class="reset-btn" @click="resetFullGame">🔄 إنهاء وإعادة اللعبة</button>
        <button class="home-btn" @click="goHome">🏠 الخروج</button>
      </div>

      <div class="footer-note">
        <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
      </div>
    </div>
  </div>

  <div v-if="modalVisible" class="modal" style="display:flex;">
    <div class="modal-content">
      <div class="modal-header">
        <span style="color: var(--primary-color); font-weight: bold;">{{ modalTurnIndicator }}</span>
        <div class="timer-circle" :class="{ warning: timerWarning }">{{ timerValue }}</div>
        <span style="background: rgba(255,255,255,0.1); padding: 5px 15px; border-radius: 10px;">{{ modalDiffBadge }}</span>
      </div>
      <div class="question-text">{{ modalQuestionText }}</div>
      <div class="options-grid">
        <button
          v-for="(opt, i) in currentOptions"
          :key="i"
          class="option-btn"
          :class="opt.cls"
          :disabled="opt.disabled"
          @click="processAnswer(i)"
        >
          <span class="opt-num">{{ i + 1 }}</span>
          <span class="opt-text">{{ opt.text }}</span>
          <span class="opt-votes">{{ opt.votes > 0 ? `🗳️ ${opt.votes}` : '' }}</span>
        </button>
      </div>
      <button v-if="modalCloseVisible" class="master-btn" style="margin: 0 auto;" @click="closeModal">متابعة اللعبة</button>
    </div>
  </div>

  <div v-if="screen === 'end'" class="screen modal" style="display:flex;">
    <div class="winner-container">
      <h1 class="winner-title">🏆 الفائز 🏆</h1>
      <h2 style="font-size: 3.5rem; margin-bottom: 10px;">{{ winnerName }}</h2>
      <div class="winner-score">{{ winnerScoreText }}</div>
      <div style="display:flex; gap:15px; justify-content:center; flex-wrap:wrap;">
        <button class="master-btn" @click="resetFullGame">🔄 بدء لعبة جديدة</button>
        <button class="home-btn" style="margin-top:12px;" @click="goHome">🏠 الخروج</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 25px 15px; justify-content: flex-start; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes pulseGlow { 0% { box-shadow: 0 0 15px var(--border-glow); } 50% { box-shadow: 0 0 30px var(--border-glow); } 100% { box-shadow: 0 0 30px var(--border-glow); } }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }

.screen {
  width: 100%;
  animation: fadeIn 0.5s ease-in-out;
  display: flex;
  flex-direction: column;
  align-items: center;
}

h1 { font-size: clamp(2rem, 4vw, 3rem); }
.subtitle { font-size: 1.1rem; margin-bottom: 20px; }

.setup-container, .winner-container {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 35px 30px;
  border-radius: 16px;
  text-align: center;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  width: 90%;
  max-width: 600px;
  animation: popIn 0.5s ease-out;
}

.input-group {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

input[type="text"] {
  padding: 14px;
  font-size: 1.1rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  text-align: center;
  transition: all 0.3s;
}
input[type="text"]:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 10px var(--border-glow);
}

.master-btn { font-size: 1.15rem; padding: 14px 34px; margin-top: 12px; }
.setup-container .master-btn,
.winner-container .master-btn { margin-top: 18px; }

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

header {
  text-align: center;
  position: relative;
}
header h1 {
  font-size: clamp(2rem, 4vw, 3.2rem);
  margin: 6px 0;
}
header .subtitle { margin-bottom: 12px; }

.top-stats {
  display: flex;
  justify-content: center;
  gap: 20px;
  font-size: clamp(1.1rem, 2vw, 1.6rem);
  margin-bottom: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px;
  border-radius: 12px;
}

.teams-container {
  display: flex;
  justify-content: space-between;
  gap: 2vw;
}

.team-card {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  padding: 2vh 2vw;
  text-align: center;
  border: 2px solid rgba(255, 255, 255, 0.08);
  transition: all 0.4s ease;
}

.team-card.active-team {
  border-color: var(--primary-color);
  background: rgba(243, 156, 18, 0.12);
  animation: pulseGlow 2s infinite;
  transform: scale(1.02);
}

.team-card h3 {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  color: #ecf0f1;
  margin: 0 0 10px 0;
}

.score-val {
  font-size: clamp(3rem, 5vw, 5rem);
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 15px var(--border-glow);
  transition: all 0.3s;
}

.categories-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2vw;
  margin-top: 1vh;
}

.cat-column {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 14px;
  padding: 2vh;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.cat-column h4 {
  margin-bottom: 15px;
  font-size: clamp(1.2rem, 2vw, 1.8rem);
  color: var(--primary-color);
}

.q-buttons-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.q-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 1.5vh 0;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
  font-size: clamp(1.2rem, 1.5vw, 1.5rem);
  cursor: pointer;
  transition: all 0.2s;
}

.q-btn:hover:not(:disabled) {
  background: var(--primary-color);
  color: #1e1e2f;
  transform: translateY(-2px);
  box-shadow: 0 4px 15px var(--border-glow);
}

.q-btn:disabled {
  background: rgba(0, 0, 0, 0.35);
  color: #7f8c8d;
  border-color: transparent;
  cursor: not-allowed;
  opacity: 0.5;
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

.modal-content {
  background: #2a2a40;
  border: 2px solid var(--primary-color);
  border-radius: 16px;
  width: 90%;
  max-width: 900px;
  padding: 35px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 30px var(--border-glow);
  text-align: center;
  animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  font-size: 1.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 15px;
}

.timer-circle {
  background: var(--danger-color);
  color: #fff;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 2.5rem;
  font-weight: bold;
  box-shadow: 0 0 18px rgba(138, 21, 56, 0.6);
  transition: all 0.3s;
}
.timer-circle.warning {
  animation: pulseGlow 0.5s infinite;
}

.question-text {
  font-size: clamp(1.8rem, 3vw, 2.8rem);
  margin-bottom: 30px;
  line-height: 1.6;
  color: #fff;
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 30px;
}

.option-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 2px solid rgba(255, 255, 255, 0.15);
  padding: 20px;
  border-radius: 12px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
  font-size: clamp(1.2rem, 2vw, 1.8rem);
  font-family: inherit;
}

.option-btn:hover:not(:disabled) {
  background: rgba(243, 156, 18, 0.25);
  border-color: var(--primary-color);
  transform: scale(1.02);
}

.option-btn.correct {
  background: var(--success-color) !important;
  border-color: var(--success-color);
  animation: popIn 0.3s;
}

.option-btn.wrong {
  background: var(--danger-color) !important;
  border-color: var(--danger-color);
  animation: shake 0.4s;
}

.controls-bar {
  margin-top: 20px;
  display: flex;
  justify-content: center;
  gap: 15px;
  flex-wrap: wrap;
}
.controls-bar .reset-btn,
.controls-bar .home-btn { font-size: 1rem; padding: 10px 22px; margin-top: 0; }

.winner-title {
  font-size: clamp(2.5rem, 5vw, 4rem);
  color: var(--primary-color);
  text-shadow: 0 0 15px var(--border-glow);
  margin-bottom: 20px;
}
.winner-score {
  font-size: clamp(2rem, 4vw, 3rem);
  margin-bottom: 30px;
}

.tiktok-box {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(243, 156, 18, 0.35);
  border-radius: 12px;
  padding: 15px;
  margin: 10px 0 5px;
  text-align: right;
}
.tiktok-box > label {
  display: block;
  font-weight: bold;
  margin-bottom: 10px;
  color: #ecf0f1;
  font-size: 1rem;
}
.tiktok-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.tiktok-row input,
.tiktok-row select {
  flex: 1;
  min-width: 160px;
  padding: 12px;
  font-size: 1rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  text-align: center;
}
.tiktok-row .master-btn {
  margin: 0;
  font-size: 1rem;
  padding: 10px 20px;
}
.tiktok-status { margin: 10px 0 0; font-weight: bold; min-height: 1.2em; }
.tiktok-hint {
  font-size: 0.82rem;
  color: #bdc3c7;
  line-height: 1.7;
  margin-top: 10px;
}
.tiktok-counts {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.tk-count {
  flex: 1;
  min-width: 140px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: bold;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.tk-count.tk-a { color: #3498db; border-color: rgba(52, 152, 219, 0.4); }
.tk-count.tk-b { color: #e74c3c; border-color: rgba(231, 76, 60, 0.4); }

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  color: #ecf0f1;
  font-weight: normal;
  cursor: pointer;
  width: 100%;
}
.join-gift-toggle input[type="checkbox"] {
  width: auto;
  accent-color: var(--primary-color);
  cursor: pointer;
}
.gift-filter-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
}
.gift-filter-row input[type="number"] {
  flex: none;
  width: 170px;
}

.registration-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.15);
}
.registration-row input[type="number"] {
  flex: none;
  width: 90px;
}
.registration-status { color: #f1c40f; }

.team-votes {
  font-size: clamp(0.9rem, 1.4vw, 1.15rem);
  color: #bdc3c7;
  margin-top: 6px;
  min-height: 1.3em;
}

.option-btn .opt-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9em;
  height: 1.9em;
  margin-left: 10px;
  border-radius: 8px;
  background: rgba(243, 156, 18, 0.25);
  color: var(--primary-color);
  font-weight: bold;
}
.option-btn .opt-votes {
  display: inline-block;
  margin-right: 10px;
  font-size: 0.8em;
  color: #f1c40f;
}
</style>
