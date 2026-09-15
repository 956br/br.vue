<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, getGiftValue, getGiftName, getGiftUser,
} from '../../utils/tiktokBridge';

const router = useRouter();

const DISTRIBUTION = {
  4: { total: 16, ship: 5, mine: 5, empty: 6 },
  5: { total: 25, ship: 7, mine: 7, empty: 11 },
  6: { total: 36, ship: 11, mine: 11, empty: 14 },
};
const VOTE_DURATION = 30;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq = 440, duration = 0.15, type = 'sine', vol = 0.3, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const startTime = ctx.currentTime + delay;
    osc.start(startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.stop(startTime + duration);
  } catch (e) { /* noop */ }
}
const playShipSound = () => { beep(880, 0.15, 'triangle', 0.3); beep(1200, 0.15, 'triangle', 0.3, 0.1); };
const playMineSound = () => beep(150, 0.35, 'sawtooth', 0.4);
const playEmptySound = () => beep(400, 0.1, 'sine', 0.15);
const playFlipTick = () => beep(600, 0.05, 'square', 0.1);
const playWinSound = () => { beep(660, 0.15); beep(880, 0.15, 'sine', 0.3, 0.15); beep(1100, 0.25, 'sine', 0.3, 0.3); };

// ===== إعدادات وحالة اللعبة =====
const gridSizeSelect = ref('5');
const teamAInput = ref('');
const teamBInput = ref('');
const timerInput = ref(null);

const distributionHint = computed(() => {
  const d = DISTRIBUTION[Number(gridSizeSelect.value)];
  return `الإجمالي: ${d.total} مربع | 🚢 ${d.ship} مراكب | 💣 ${d.mine} قنابل | ⬜ ${d.empty} فارغة`;
});

let gridSize = 5;
const board = reactive([]); // { type, revealed }
const scores = reactive({ A: 0, B: 0 });
const teamNames = reactive({ A: 'الفريق أ', B: 'الفريق ب' });
const currentTeam = ref('A');
let revealedCount = 0;
const gameActive = ref(false);
let processing = false;
let timerInterval = null;
const timeLeft = ref(0);
const timerVisible = ref(false);

const totalShips = ref(0);
const totalMines = ref(0);
const revealedShips = ref(0);
const revealedMines = ref(0);

const skipUsed = reactive({ A: false, B: false });
const boardLocked = ref(false);
const scoreBoardStarted = ref(false);
const inputsDisabled = ref(false);
const startBtnDisabled = ref(false);
const skipBtnVisible = ref(false);
const remainingPanelVisible = ref(false);

const logItems = ref([]); // { cls, text }
function addLog(cls, text) {
  logItems.value.unshift({ cls, text });
}

const bannerClass = ref('neutral');
const bannerText = ref('في انتظار بدء اللعبة...');
const bannerFlip = ref(false);

const winnerModalVisible = ref(false);
const trophyIcon = ref('🏆');
const winnerTitle = ref('انتهت اللعبة');
const finalScoresHtml = ref('');
const rulesVisible = ref(false);

function updateTimerDisplay() {
  const m = Math.floor(timeLeft.value / 60).toString().padStart(2, '0');
  const s = (timeLeft.value % 60).toString().padStart(2, '0');
  return `⏱️ ${m}:${s}`;
}
const timerText = computed(updateTimerDisplay);
const timerUrgent = computed(() => timeLeft.value <= 15);

const remainingShips = computed(() => totalShips.value - revealedShips.value);
const remainingMines = computed(() => totalMines.value - revealedMines.value);

function buildBoard(size) {
  const d = DISTRIBUTION[size];
  const cells = [
    ...Array(d.ship).fill('ship'),
    ...Array(d.mine).fill('mine'),
    ...Array(d.empty).fill('empty'),
  ];
  shuffle(cells);
  return cells.map((type) => ({ type, revealed: false }));
}

function coinFlip(callback) {
  processing = true;
  bannerClass.value = '';
  bannerFlip.value = true;
  let ticks = 0;
  const maxTicks = 14;
  const flipTimer = setInterval(() => {
    const guess = Math.random() < 0.5 ? 'A' : 'B';
    bannerText.value = `🎲 القرعة تدور... ${teamNames[guess]}؟`;
    playFlipTick();
    ticks++;
    if (ticks >= maxTicks) {
      clearInterval(flipTimer);
      bannerFlip.value = false;
      const winnerTeam = Math.random() < 0.5 ? 'A' : 'B';
      processing = false;
      callback(winnerTeam);
    }
  }, 90);
}

function updateTurnBanner() {
  bannerClass.value = currentTeam.value === 'A' ? 'team-a' : 'team-b';
  const icon = currentTeam.value === 'A' ? '🔵' : '🔴';
  bannerText.value = `${icon} دور: ${teamNames[currentTeam.value]} — صوّتوا بكتابة رقم المربع`;

  if (gameActive.value) {
    skipBtnVisible.value = true;
  }
}

function startGame() {
  gridSize = Number(gridSizeSelect.value);

  const aName = teamAInput.value.trim();
  const bName = teamBInput.value.trim();
  teamNames.A = aName ? escapeHtml(aName) : 'الفريق أ';
  teamNames.B = bName ? escapeHtml(bName) : 'الفريق ب';

  const timerMinutes = parseInt(timerInput.value, 10) || 0;

  board.splice(0, board.length, ...buildBoard(gridSize));
  scores.A = 0; scores.B = 0;
  revealedCount = 0;
  gameActive.value = false;

  const d = DISTRIBUTION[gridSize];
  totalShips.value = d.ship;
  totalMines.value = d.mine;
  revealedShips.value = 0;
  revealedMines.value = 0;
  remainingPanelVisible.value = true;

  skipUsed.A = false; skipUsed.B = false;
  boardLocked.value = false;
  scoreBoardStarted.value = true;

  logItems.value = [];

  inputsDisabled.value = true;
  startBtnDisabled.value = true;
  skipBtnVisible.value = false;

  addLog('system', `🎮 بدأت اللعبة بشبكة ${gridSize}×${gridSize} — جارٍ إجراء القرعة...`);

  coinFlip((winnerTeam) => {
    currentTeam.value = winnerTeam;
    gameActive.value = true;
    updateTurnBanner();
    addLog('system', `🎲 القرعة اختارت ${teamNames[winnerTeam]} ليبدأ اللعب أولًا.`);
    skipBtnVisible.value = true;
    if (timerMinutes > 0) startTimer(timerMinutes);
    startVotingRound();
  });
}

function startTimer(minutes) {
  timeLeft.value = minutes * 60;
  timerVisible.value = true;
  timerInterval = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(timerInterval);
      addLog('system', '⏰ انتهى الوقت المحدد للعبة.');
      endGame();
    }
  }, 1000);
}

function revealCell(index) {
  if (!gameActive.value || processing) return;
  const cell = board[index];
  if (cell.revealed) return;

  clearVotingTimer();

  cell.revealed = true;
  revealedCount++;
  processing = true;

  let logClass;
  let logText;
  if (cell.type === 'ship') {
    scores[currentTeam.value]++;
    revealedShips.value++;
    playShipSound();
    logClass = 'ship';
    logText = `🚢 ${teamNames[currentTeam.value]} اكتشف مركبًا في المربع رقم ${index + 1} (+1 نقطة)`;
  } else if (cell.type === 'mine') {
    scores[currentTeam.value]--;
    revealedMines.value++;
    playMineSound();
    logClass = 'mine';
    logText = `💣 ${teamNames[currentTeam.value]} اكتشف قنبلة في المربع رقم ${index + 1} (−1 نقطة) — انتهى دوره`;
  } else {
    playEmptySound();
    logClass = 'empty';
    logText = `🌊 ${teamNames[currentTeam.value]} اختار مربعًا فارغًا رقم ${index + 1} — انتهى دوره`;
  }

  addLog(logClass, logText);

  setTimeout(() => {
    if (revealedCount >= board.length) {
      processing = false;
      endGame();
      return;
    }
    if (cell.type !== 'ship') {
      switchTeam();
    }
    processing = false;
    startVotingRound();
  }, 450);
}

function switchTeam() {
  currentTeam.value = currentTeam.value === 'A' ? 'B' : 'A';
  updateTurnBanner();
}

function useTeamSkip() {
  if (!gameActive.value || processing || skipUsed[currentTeam.value]) return;
  clearVotingTimer();
  skipUsed[currentTeam.value] = true;
  addLog('system', `⏭️ ${teamNames[currentTeam.value]} استخدم ميزة "تخطي الدور وتأمين النقاط" المتاحة له وانتقل الدور للفريق الآخر.`);
  switchTeam();
  startVotingRound();
}

function endGame() {
  gameActive.value = false;
  clearVotingTimer();
  if (timerInterval) clearInterval(timerInterval);
  timerVisible.value = false;
  skipBtnVisible.value = false;

  bannerClass.value = 'finished';
  bannerText.value = '🏁 انتهت اللعبة!';
  boardLocked.value = true;

  let title;
  let trophy;
  if (scores.A > scores.B) {
    title = `🏆 فاز ${teamNames.A}!`;
    trophy = '🏆';
  } else if (scores.B > scores.A) {
    title = `🏆 فاز ${teamNames.B}!`;
    trophy = '🏆';
  } else {
    title = '🤝 تعادل الفريقان!';
    trophy = '🤝';
  }

  trophyIcon.value = trophy;
  winnerTitle.value = title;
  finalScoresHtml.value = `🔵 ${teamNames.A}: <b>${scores.A}</b> نقطة<br>🔴 ${teamNames.B}: <b>${scores.B}</b> نقطة`;

  addLog('system', `🏁 انتهت اللعبة — ${title}`);
  playWinSound();
  winnerModalVisible.value = true;

  startBtnDisabled.value = false;
  inputsDisabled.value = false;
}

function resetGame() {
  gameActive.value = false;
  processing = false;
  clearVotingTimer();
  Object.keys(currentRoundVotes).forEach((k) => delete currentRoundVotes[k]);
  votedThisRound.clear();
  teamMembers.A.clear();
  teamMembers.B.clear();
  updateTeamCounts();
  stopRegistration();
  if (timerInterval) clearInterval(timerInterval);
  timerVisible.value = false;
  winnerModalVisible.value = false;
  remainingPanelVisible.value = false;

  board.splice(0, board.length);
  scores.A = 0; scores.B = 0;
  revealedCount = 0;
  skipUsed.A = false; skipUsed.B = false;
  logItems.value = [];
  skipBtnVisible.value = false;
  boardLocked.value = false;
  scoreBoardStarted.value = false;

  bannerClass.value = 'neutral';
  bannerFlip.value = false;
  bannerText.value = 'في انتظار بدء اللعبة...';

  startBtnDisabled.value = false;
  inputsDisabled.value = false;
}

function toggleRules(show) {
  rulesVisible.value = show;
}

function goHome() {
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

const teamMembers = { A: new Set(), B: new Set() };
const teamACount = ref(0);
const teamBCount = ref(0);
function updateTeamCounts() {
  teamACount.value = teamMembers.A.size;
  teamBCount.value = teamMembers.B.size;
}

const currentRoundVotes = reactive({});
const votedThisRound = new Set();
const votingOpen = ref(false);
let votingTimer = null;
const votingTimeLeft = ref(0);
const voteChipVisible = ref(false);
const voteUrgent = computed(() => votingTimeLeft.value <= 10);

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
  if (t1 && name.includes(t1)) return 'A';
  if (t2 && name.includes(t2)) return 'B';
  return null;
}

const joinModeHint = computed(() => (joinViaGift.value
  ? '🎁 الانضمام مفعّل عبر الهدايا: حدد اسم هدية للفريق الأزرق واسم هدية للفريق الأحمر (وأقل قيمة اختيارياً)، ومن يرسل هدية تطابق أحد الاسمين ينضم لفريقها تلقائياً.<br>🗳️ التصويت: وقت دور كل فريق، أعضاؤه بس يصوتون بكتابة رقم المربع اللي يبون يكشفونه، والمربع الأكثر تصويتًا خلال 30 ثانية يُكشف تلقائيًا.'
  : `🎯 الانضمام: الجمهور يكتب <b>"${getJoinWordTeam1()}"</b> للانضمام للفريق الأزرق، أو <b>"${getJoinWordTeam2()}"</b> للانضمام للفريق الأحمر (مرة وحدة بس لكل شخص).<br>🗳️ التصويت: وقت دور كل فريق، أعضاؤه بس يصوتون بكتابة رقم المربع اللي يبون يكشفونه، والمربع الأكثر تصويتًا خلال 30 ثانية يُكشف تلقائيًا.`));

function startVotingRound() {
  if (!gameActive.value) return;
  clearVotingTimer();
  Object.keys(currentRoundVotes).forEach((k) => delete currentRoundVotes[k]);
  votedThisRound.clear();

  votingOpen.value = true;
  votingTimeLeft.value = VOTE_DURATION;
  voteChipVisible.value = true;

  votingTimer = setInterval(() => {
    votingTimeLeft.value--;
    if (votingTimeLeft.value <= 0) {
      clearVotingTimer();
      resolveVoting();
    }
  }, 1000);
}

function clearVotingTimer() {
  if (votingTimer) { clearInterval(votingTimer); votingTimer = null; }
  votingOpen.value = false;
  voteChipVisible.value = false;
}

function resolveVoting() {
  if (!gameActive.value || processing) return;

  let bestCount = 0;
  let tied = [];
  Object.keys(currentRoundVotes).forEach((key) => {
    const idx = parseInt(key, 10);
    if (board[idx].revealed) return;
    const c = currentRoundVotes[idx];
    if (c > bestCount) { bestCount = c; tied = [idx]; } else if (c === bestCount && c > 0) { tied.push(idx); }
  });

  let chosen;
  if (tied.length > 0) {
    chosen = tied[Math.floor(Math.random() * tied.length)];
    addLog('system', `🗳️ انتهى التصويت — المربع رقم ${chosen + 1} فاز بـ ${bestCount} صوت وسيُكشف الآن.`);
  } else {
    const available = board.map((c, i) => (c.revealed ? null : i)).filter((i) => i !== null);
    if (available.length === 0) return;
    chosen = available[Math.floor(Math.random() * available.length)];
    addLog('system', `🗳️ ما وصل أي تصويت هذي الجولة — تم اختيار المربع رقم ${chosen + 1} عشوائيًا.`);
  }

  revealCell(chosen);
}

function handleTikTokMessage(user, commentRaw) {
  if (!user || !commentRaw) return;
  const text = normalizeDigits(commentRaw).trim();

  if (registrationOpen.value && !joinViaGift.value && !teamMembers.A.has(user) && !teamMembers.B.has(user)) {
    if (text === normalizeDigits(getJoinWordTeam1())) {
      teamMembers.A.add(user);
      updateTeamCounts();
      return;
    }
    if (text === normalizeDigits(getJoinWordTeam2())) {
      teamMembers.B.add(user);
      updateTeamCounts();
      return;
    }
  }

  if (!votingOpen.value) return;
  const num = parseInt(text, 10);
  if (Number.isNaN(num)) return;
  const idx = num - 1;
  if (idx < 0 || idx >= board.length) return;
  if (board[idx].revealed) return;
  if (!teamMembers[currentTeam.value].has(user)) return;
  if (votedThisRound.has(user)) return;

  votedThisRound.add(user);
  currentRoundVotes[idx] = (currentRoundVotes[idx] || 0) + 1;
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

    if (data.status) {
      tiktokStatus.value = data.status;
      tiktokStatusColor.value = '#2ecc71';
    }
    if (data.error) {
      tiktokStatus.value = data.error;
      tiktokStatusColor.value = '#e74c3c';
    }
    if (data.comment) {
      handleTikTokMessage(data.user, data.comment);
    }
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data) && giftValuePasses(data)) {
      const giftUser = getGiftUser(data);
      if (giftUser && !teamMembers.A.has(giftUser) && !teamMembers.B.has(giftUser)) {
        const team = matchTeamByGiftName(data);
        if (team === 'A') { teamMembers.A.add(giftUser); updateTeamCounts(); } else if (team === 'B') { teamMembers.B.add(giftUser); updateTeamCounts(); }
      }
    }
  };

  tiktokSocket.onerror = () => {
    tiktokStatus.value = '❌ صار خطأ بالاتصال';
    tiktokStatusColor.value = '#e74c3c';
  };

  tiktokSocket.onclose = () => {
    tiktokStatus.value = '🔌 تم قطع الاتصال';
    tiktokStatusColor.value = '#95a5a6';
  };
}

onMounted(() => {
  // لا شيء يُعرض قبل الضغط على "بدء اللعبة"
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
  if (votingTimer) clearInterval(votingTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) {
    tiktokSocket.close();
    tiktokSocket = null;
  }
});
</script>

<template>
  <div class="top-names-section">
    <label>⚙️ إعدادات اللعبة</label>
    <div class="setup-grid">
      <div class="setup-field">
        <label for="gridSizeSelect">حجم الشبكة</label>
        <select id="gridSizeSelect" v-model="gridSizeSelect" :disabled="inputsDisabled">
          <option value="4">4 × 4 (16 مربع)</option>
          <option value="5">5 × 5 (25 مربع)</option>
          <option value="6">6 × 6 (36 مربع)</option>
        </select>
      </div>
      <div class="setup-field">
        <label for="teamAInput">🔵 اسم الفريق الأول</label>
        <input id="teamAInput" v-model="teamAInput" type="text" placeholder="الفريق أ" maxlength="20" :disabled="inputsDisabled">
      </div>
      <div class="setup-field">
        <label for="teamBInput">🔴 اسم الفريق الثاني</label>
        <input id="teamBInput" v-model="teamBInput" type="text" placeholder="الفريق ب" maxlength="20" :disabled="inputsDisabled">
      </div>
      <div class="setup-field">
        <label for="timerInput">⏱️ الوقت بالدقائق (اختياري)</label>
        <input id="timerInput" v-model="timerInput" type="number" min="0" max="60" placeholder="بدون وقت محدد" :disabled="inputsDisabled">
      </div>
    </div>
    <div class="field-hint">اختر حجم الشبكة وأسماء الفرق، ثم اضغط "بدء اللعبة" لإجراء القرعة تلقائيًا وتحديد الفريق البادئ.</div>
    <div class="distribution-hint">{{ distributionHint }}</div>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف (اختياري)</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)"
        style="flex:1; min-width:200px; background: rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:white; padding:10px; font-size:1rem;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordTeam1" type="text" placeholder="كلمة انضمام الفريق الأزرق (افتراضياً: 1)" :disabled="joinViaGift">
      <input v-model="joinWordTeam2" type="text" placeholder="كلمة انضمام الفريق الأحمر (افتراضياً: 2)" :disabled="joinViaGift">
    </div>
    <div class="join-settings-row">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox">
        🎁 الانضمام بإرسال هدية بدل كتابة الكلمة (حسب نوع الهدية)
      </label>
    </div>
    <div v-if="joinViaGift" class="gift-filter-row">
      <select v-model="giftNameTeam1">
        <option value="">🎁 هدية الفريق الأزرق</option>
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
        <option value="">🎁 هدية الفريق الأحمر</option>
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
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <div class="field-hint" v-html="joinModeHint"></div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
    <div class="master-controls" style="margin-top:12px; margin-bottom:0;">
      <div class="rounds-badge team-score team-a">🔵 أعضاء منضمين: {{ teamACount }}</div>
      <div class="rounds-badge team-score team-b">🔴 أعضاء منضمين: {{ teamBCount }}</div>
    </div>
  </div>

  <h1>🚢 المراكب والألغام 💣</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <div class="rounds-badge team-score team-a">🔵 {{ scoreBoardStarted ? teamNames.A : '—' }}: {{ scores.A }}</div>
    <button class="master-btn" :disabled="startBtnDisabled" @click="startGame">🎲 بدء اللعبة</button>
    <button class="reset-btn" @click="resetGame">🔄 لعبة جديدة</button>
    <div v-if="timerVisible" class="timer-chip" style="display:inline-block;" :class="{ urgent: timerUrgent }">{{ timerText }}</div>
    <div v-if="voteChipVisible" class="timer-chip" style="display:inline-block;" :class="{ urgent: voteUrgent }">🗳️ {{ votingTimeLeft }}s</div>
    <div class="rounds-badge team-score team-b">🔴 {{ scoreBoardStarted ? teamNames.B : '—' }}: {{ scores.B }}</div>
  </div>

  <div v-if="remainingPanelVisible" class="master-controls" style="font-size: 0.9rem; background: rgba(0,0,0,0.25); padding: 8px 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
    <span>🚢 المراكب الباقية: <b style="color:var(--success-color);">{{ remainingShips }}</b></span>
    <span style="margin: 0 15px; color: rgba(255,255,255,0.2);">|</span>
    <span>💣 القنابل الباقية: <b style="color:var(--danger-color);">{{ remainingMines }}</b></span>
  </div>

  <div class="master-controls" style="margin-bottom: 10px;">
    <button class="rules-btn" @click="toggleRules(true)">📖 دليل القوانين</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
  </div>

  <div class="announcement-banner" :class="[bannerClass, { flip: bannerFlip }]" style="display:block;">{{ bannerText }}</div>

  <div class="game-panel">
    <div class="board-grid" :style="{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }">
      <div
        v-for="(cell, i) in board"
        :key="i"
        class="cell"
        :class="[{ revealed: cell.revealed, locked: boardLocked && !cell.revealed }, cell.revealed ? cell.type : '']"
        @click="revealCell(i)"
      >
        <template v-if="cell.revealed">{{ cell.type === 'ship' ? '🚢' : (cell.type === 'mine' ? '💣' : '🌊') }}</template>
        <template v-else>{{ i + 1 }}</template>
        <span v-if="currentRoundVotes[i] > 0 && !cell.revealed" class="cell-votes show">🗳️ {{ currentRoundVotes[i] }}</span>
      </div>
    </div>
    <div class="board-actions">
      <button
        v-if="skipBtnVisible"
        class="skip-btn"
        style="display:inline-block;"
        :disabled="skipUsed[currentTeam]"
        :style="skipUsed[currentTeam] ? 'opacity:0.5; cursor:not-allowed;' : ''"
        @click="useTeamSkip"
      >{{ skipUsed[currentTeam] ? '⏭️ تم استهلاك التخطي' : '⏭️ تخطي الدور وتأمين النقاط (متاحة مرة واحدة)' }}</button>
    </div>
  </div>

  <div class="log-panel">
    <h3>📜 سجل الأحداث</h3>
    <div>
      <div v-for="(item, i) in logItems" :key="i" class="log-item" :class="item.cls">{{ item.text }}</div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: var(--primary-color);">956br@</strong></span>
  </div>

  <div v-if="winnerModalVisible" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <div class="trophy">{{ trophyIcon }}</div>
      <h2>{{ winnerTitle }}</h2>
      <div class="final-scores" v-html="finalScoresHtml"></div>
      <button class="master-btn" style="width:100%;" @click="resetGame">🔄 لعبة جديدة</button>
    </div>
  </div>

  <div v-if="rulesVisible" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>📖 دليل لعبة المراكب والألغام</h2>
      <ul class="rules-list">
        <li>🎯 <b>فكرة اللعبة:</b> شبكة مربعات مخفية، كل مربع يخفي إما مركباً (+1 نقطة)، أو قنبلة (-1 نقطة)، أو مربعاً فارغاً بلا تأثير.</li>
        <li>🎲 <b>البداية:</b> تُجرى قرعة تلقائية عند الضغط على "بدء اللعبة" لتحديد الفريق البادئ.</li>
        <li>🔁 <b>الدور:</b> يختار الفريق رقم مربع مغلق ليُكشف أمام الجميع.</li>
        <li>⏭️ <b>تخطي الدور:</b> يمتلك كل فريق فرصة واحدة فقط طوال اللعبة لتخطي دوره وتأمين النقاط أو تجنب المخاطرة.</li>
        <li>🚢 <b>عند ظهور مركب:</b> +1 نقطة، ويحق للفريق الاستمرار باختيار مربع آخر أو استخدام زر التخطي لتأمين النقاط والانتقال للفريق الآخر.</li>
        <li>💣 <b>عند ظهور قنبلة:</b> −1 نقطة، وينتهي الدور فورًا وينتقل للفريق الآخر.</li>
        <li>🏁 <b>النهاية:</b> تنتهي اللعبة عند كشف كل المربعات أو انتهاء الوقت المحدد، ويفوز صاحب أعلى رصيد نقاط.</li>
      </ul>
      <h3>توزيع العناصر حسب حجم الشبكة</h3>
      <table class="rules-table">
        <tr><th>الشبكة</th><th>الإجمالي</th><th>🚢 مراكب</th><th>💣 قنابل</th><th>⬜ فارغة</th></tr>
        <tr><td>4×4</td><td>16</td><td>5</td><td>5</td><td>6</td></tr>
        <tr><td>5×5</td><td>25</td><td>7</td><td>7</td><td>11</td></tr>
        <tr><td>6×6</td><td>36</td><td>11</td><td>11</td><td>14</td></tr>
      </table>
      <button class="back-to-game-btn master-btn" @click="toggleRules(false)">↩️ العودة إلى اللعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 20px; }
h1 { font-size: 2.3rem; text-align: center; }
.subtitle { font-size: 1.1rem; margin-bottom: 20px; text-align: center; }

.top-names-section {
  width: 100%;
  max-width: 700px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 15px 20px;
  margin-bottom: 20px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.top-names-section > label {
  display: block;
  margin-bottom: 12px;
  font-size: 1.05rem;
  color: #ecf0f1;
  font-weight: bold;
}

.setup-grid {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.setup-field { flex: 1; min-width: 140px; }
.setup-field label { display: block; font-size: 0.85rem; color: #bdc3c7; margin-bottom: 5px; }

.setup-field select,
.setup-field input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 9px 10px;
  font-size: 0.95rem;
  outline: none;
}

.setup-field select:focus,
.setup-field input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.field-hint { font-size: 0.8rem; color: #8b93a3; margin-top: 6px; }

.join-settings-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}

.join-settings-row input[type="text"] {
  flex: 1;
  min-width: 140px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
}

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
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
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input,
.gift-filter-row select {
  flex: 1;
  min-width: 140px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
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
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row input[type="number"] {
  width: 90px;
  flex: none;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
}

.registration-status { font-weight: bold; color: #f1c40f; }

.distribution-hint {
  font-size: 0.85rem;
  color: #f1c40f;
  margin-top: 8px;
  text-align: center;
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  padding: 6px;
}

.master-controls {
  display: flex;
  gap: 15px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 15px;
  width: 100%;
}

.team-score { font-size: 1.05rem; padding: 10px 18px; }
.team-score.team-a { color: #3498db; background: rgba(52, 152, 219, 0.15); border-color: rgba(52, 152, 219, 0.4); }
.team-score.team-b { color: #e74c3c; background: rgba(231, 76, 60, 0.15); border-color: rgba(231, 76, 60, 0.4); }

.announcement-banner {
  width: 100%;
  max-width: 650px;
  padding: 14px 20px;
  border-radius: 12px;
  text-align: center;
  font-weight: bold;
  font-size: 1.2rem;
  margin: 0 auto 20px auto;
  box-shadow: 0 0 20px rgba(0,0,0,0.4);
  transition: background 0.3s ease;
}
.announcement-banner.neutral { background: rgba(255,255,255,0.06); border: 1px dashed var(--border-glow); color: #bdc3c7; font-size: 1.05rem; }
.announcement-banner.team-a { background: linear-gradient(135deg, #2980b9, #2471a3); }
.announcement-banner.team-b { background: linear-gradient(135deg, #c0392b, #a93226); }
.announcement-banner.finished { background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)); }
.announcement-banner.flip { animation: flipPulse 0.15s infinite alternate; }
@keyframes flipPulse { from { opacity: 1; } to { opacity: 0.6; } }

.timer-chip {
  font-size: 1rem;
  color: #f1c40f;
  background: rgba(0,0,0,0.3);
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(241,196,15,0.4);
  font-weight: bold;
}
.timer-chip.urgent { color: #ff4757; border-color: #ff4757; }

.game-panel {
  width: 100%;
  max-width: 650px;
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.board-grid {
  display: grid;
  gap: 8px;
  width: 100%;
  margin: 5px 0 15px 0;
}

.cell {
  aspect-ratio: 1 / 1;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: bold;
  color: #ecf0f1;
  cursor: pointer;
  transition: all 0.25s ease;
  user-select: none;
  position: relative;
}

.cell:hover:not(.revealed):not(.locked) {
  border-color: var(--primary-color);
  transform: translateY(-3px);
  box-shadow: 0 4px 12px rgba(243, 156, 18, 0.35);
}

.cell.locked { opacity: 0.35; cursor: not-allowed; }
.cell.revealed { cursor: default; transform: none; animation: popReveal 0.35s ease; }
.cell.revealed.ship { background: rgba(39, 174, 96, 0.25); border-color: var(--success-color); }
.cell.revealed.mine { background: rgba(138, 21, 56, 0.35); border-color: var(--danger-color); }
.cell.revealed.empty { background: rgba(52, 152, 219, 0.15); border-color: rgba(52, 152, 219, 0.4); }

.cell-votes {
  position: absolute;
  bottom: 3px;
  left: 3px;
  font-size: 0.65rem;
  color: #f1c40f;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 6px;
  padding: 1px 5px;
}

@keyframes popReveal {
  0% { transform: scale(0.7) rotateY(90deg); opacity: 0.3; }
  100% { transform: scale(1) rotateY(0deg); opacity: 1; }
}

.board-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.skip-btn {
  background: #e67e22;
  box-shadow: 0 4px 15px rgba(230, 126, 34, 0.4);
  font-size: 0.95rem;
  padding: 10px 22px;
}

.log-panel {
  width: 100%;
  max-width: 650px;
  margin-top: 15px;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  padding: 12px 15px;
  max-height: 160px;
  overflow-y: auto;
}
.log-panel h3 { font-size: 0.95rem; color: var(--primary-color); margin-bottom: 8px; }
.log-item { font-size: 0.85rem; padding: 6px 10px; border-radius: 6px; background: #1e1e2f; margin-bottom: 6px; line-height: 1.5; }
.log-item.ship { border-right: 4px solid var(--success-color); }
.log-item.mine { border-right: 4px solid var(--danger-color); }
.log-item.empty { border-right: 4px solid #3498db; }
.log-item.system { border-right: 4px solid var(--primary-color); color: #f1c40f; }

.modal-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.82);
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 15px;
}
.modal-content {
  background: #2a2a40;
  padding: 28px 22px;
  border-radius: 16px;
  width: 100%;
  max-width: 380px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
}
.modal-content .trophy { font-size: 3rem; margin-bottom: 10px; }
.modal-content h2 { color: var(--primary-color); font-size: 1.5rem; margin-bottom: 10px; }
.modal-content .final-scores { font-size: 1.1rem; color: #ecf0f1; margin-bottom: 20px; line-height: 1.8; }

.rules-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: var(--bg-gradient);
  flex-direction: column;
  align-items: center;
  z-index: 250;
  padding: 20px 15px;
  overflow-y: auto;
}
.rules-box {
  width: 100%;
  max-width: 480px;
  background: var(--panel-bg);
  border: 1px solid var(--border-glow);
  border-radius: 16px;
  padding: 22px;
  backdrop-filter: blur(10px);
}
.rules-box h2 { color: var(--primary-color); text-align: center; margin-bottom: 15px; font-size: 1.4rem; }
.rules-box h3 { color: #f1c40f; font-size: 1rem; margin: 14px 0 8px; }
.rules-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.rules-list li {
  background: #1e1e2f;
  padding: 10px 12px;
  border-radius: 8px;
  border-right: 4px solid var(--primary-color);
  font-size: 0.92rem;
  line-height: 1.6;
}
.rules-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 8px; }
.rules-table th, .rules-table td { padding: 6px 4px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
.rules-table th { color: var(--primary-color); }
.back-to-game-btn { display: block; width: 100%; max-width: 480px; margin: 18px auto 0; text-align: center; }

@media (max-width: 600px) {
  h1 { font-size: 1.8rem; }
  .cell { font-size: 1rem; }
}
</style>
