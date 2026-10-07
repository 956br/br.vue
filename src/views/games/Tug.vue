<script setup>
import {
  ref, reactive, computed, watch, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import {
  GIFT_OPTIONS, isGiftEvent, getGiftName, getGiftUser,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();
const ROUND_WINS_KEY = 'tugOfWar_roundWins';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadRoundWins() {
  try {
    const data = localStorage.getItem(ROUND_WINS_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (typeof parsed.a !== 'number' || typeof parsed.b !== 'number') return null;
    return parsed;
  } catch (e) { return null; }
}
const roundWins = reactive(loadRoundWins() || { a: 0, b: 0 });
function saveRoundWins() {
  try { localStorage.setItem(ROUND_WINS_KEY, JSON.stringify(roundWins)); } catch (e) { /* noop */ }
}

// قيم احتياطية للهدايا الافتراضية لو ما وصلت القائمة المسجلة من /admin/gifts (اللي فيها القيمة الحقيقية)
const FALLBACK_COSTS = {
  Rose: 1, TikTok: 1, 'Ice Cream Cone': 1, 'Finger Heart': 5, Panda: 5, Perfume: 20, Doughnut: 30,
  'Hand Hearts': 100, Corgi: 299, 'Money Gun': 500, Galaxy: 1000, 'Starlight Sceptre': 1200,
};
function giftLabel(value) {
  const found = GIFT_OPTIONS.find((g) => g.value === value);
  return found ? found.label : value;
}

// الهدايا المسجلة مجمّعة حسب قيمتها — نعرض بس القيم اللي فيها هديتين أو أكثر عشان الفريقين يتساوون بالقيمة
const giftsByCost = computed(() => {
  const groups = new Map();
  GIFT_OPTIONS.slice(1).forEach((g) => {
    const cost = Number(g.diamonds) || FALLBACK_COSTS[g.value] || 0;
    if (cost <= 0) return;
    if (!groups.has(cost)) groups.set(cost, []);
    groups.get(cost).push(g);
  });
  return new Map([...groups].filter(([, gifts]) => gifts.length >= 2).sort((x, y) => x[0] - y[0]));
});

const gamePhase = ref('idle'); // idle | running | ended
const roundNumber = ref(0);
let roundDuration = 60;
const timeLeft = ref(0);
let countdown = null;
let instantWinThreshold = 30;
let visualScale = 20;
const eventLog = ref([]);
const ropeMarkerLeft = ref('50%');

// word = كلمة التعليق (أو الإيموجي) الأساسية اللي تسحب الحبل للفريق بنقطة.
// للجولة الحالية: extraWords = التعليقات الإضافية [{ word, points }]، gifts = الهدايا [{ value, points, instantWin }]
const teamA = reactive({
  key: 'a', name: 'الفريق الأحمر', word: '🔴', extraWords: [], gifts: [], score: 0, commentCount: 0, giftCount: 0,
});
const teamB = reactive({
  key: 'b', name: 'الفريق الأزرق', word: '🔵', extraWords: [], gifts: [], score: 0, commentCount: 0, giftCount: 0,
});

// إيموجيات جاهزة بدون محدد تنسيق (variation selector) عشان تطابق اللي يكتبه المشاهد بالدردشة
const CUSTOM_WORD = 'custom';
const wordOptions = [
  { value: CUSTOM_WORD, label: '✏️ تخصيص' },
  ...['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🔥', '⚡', '⭐', '👑', '💙', '💚', '💛', '💜', '🦁', '🐺', '🦅', '🐉']
    .map((e) => ({ value: e, label: e })),
];
const teamAWordSelect = ref('🔴');
const teamAWordCustom = ref('');
const teamANameInput = ref('الفريق الأحمر');
const teamBWordSelect = ref('🔵');
const teamBWordCustom = ref('');
const teamBNameInput = ref('الفريق الأزرق');
// الكلمة الطويلة تنعرض بخط أصغر بالساحة (الإيموجي الواحد يبقى كبير)
function isLongWord(word) { return [...word].length > 2; }
function pickedWord(select, custom, fallback) {
  return (select === CUSTOM_WORD ? custom.trim() : select) || fallback;
}

// ===== الهدايا الإضافية: كل صف = قيمة + هدية لكل فريق بنفس القيمة + نقاطها =====
let giftRowIdCounter = 0;
const giftRows = reactive([]); // { id, cost, giftA, giftB, points }
// هدايا القيمة اللي ما انحجزت بصف ثاني (الهدية الوحدة ما تتكرر بين الصفوف ولا بين الفريقين)
function freeGifts(row, cost) {
  const taken = new Set(giftRows.filter((r) => r.id !== row.id).flatMap((r) => [r.giftA, r.giftB]));
  return (giftsByCost.value.get(Number(cost)) || []).filter((g) => !taken.has(g.value));
}
function rowCostOptions(row) {
  return [...giftsByCost.value.keys()].filter((cost) => freeGifts(row, cost).length >= 2).map((cost) => ({
    value: String(cost), label: `💎 ${cost}`, hint: `${giftsByCost.value.get(cost).length} هدايا`,
  }));
}
function rowGiftOptions(row, side) {
  const other = side === 'giftA' ? row.giftB : row.giftA;
  return freeGifts(row, row.cost).filter((g) => g.value !== other).map(({ value, label }) => ({ value, label }));
}
function setRowCost(row, cost) {
  row.cost = cost;
  const free = freeGifts(row, cost);
  row.giftA = free[0]?.value || '';
  row.giftB = free[1]?.value || '';
}
const canAddGiftRow = computed(() => rowCostOptions({ id: 0 }).length > 0);
function addGiftRow() {
  giftRows.push({
    id: ++giftRowIdCounter, cost: '', giftA: '', giftB: '', points: 5, instantWin: false,
  });
}
function removeRow(rows, row) {
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx !== -1) rows.splice(idx, 1);
}

// ===== التعليقات الإضافية: كل صف = كلمة لكل فريق (كل تعليق بنقطة مثل الأساسي) =====
const commentRows = reactive([]); // { id, wordA, wordB }
function addCommentRow() {
  commentRows.push({ id: ++giftRowIdCounter, wordA: '', wordB: '' });
}
function cleanPoints(row) {
  const points = parseInt(row.points, 10);
  row.points = Number.isNaN(points) || points < 0 ? 0 : points;
  return row.points;
}

const giftsOnlyMode = ref(false);
const roundDurationInput = ref(60);
const instantWinEnabled = ref(true);
const instantWinInput = ref(30);

function syncTeamConfigFromInputs() {
  teamA.word = pickedWord(teamAWordSelect.value, teamAWordCustom.value, '🔴');
  teamA.name = teamANameInput.value.trim() || 'الفريق الأحمر';
  teamB.word = pickedWord(teamBWordSelect.value, teamBWordCustom.value, '🔵');
  teamB.name = teamBNameInput.value.trim() || 'الفريق الأزرق';
}
watch([teamAWordSelect, teamAWordCustom, teamANameInput, teamBWordSelect, teamBWordCustom, teamBNameInput], () => {
  if (gamePhase.value !== 'running') syncTeamConfigFromInputs();
});

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 10) val = 10;
  if (val > 600) val = 600;
  roundDurationInput.value = val;
  return val;
}
function getInstantWinThreshold() {
  if (!instantWinEnabled.value) return 0;
  let val = parseInt(instantWinInput.value, 10);
  if (Number.isNaN(val) || val < 1) val = 1;
  instantWinInput.value = val;
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

// ===== نافذة إعدادات الجولة (تنفتح قبل كل جولة) =====
const settingsVisible = ref(false);
const settingsError = ref('');
// forStart = النافذة انفتحت من زر بدء الجولة (زر التأكيد يبدأ الجولة)، وإلا من زر الإعدادات فوق (حفظ بس)
const settingsForStart = ref(true);
function openSettings(forStart = true) {
  if (gamePhase.value === 'running') return;
  settingsForStart.value = forStart;
  settingsError.value = '';
  settingsVisible.value = true;
}

function startRound() {
  if (gamePhase.value === 'running') return;
  syncTeamConfigFromInputs();

  if (!giftsOnlyMode.value) {
    const words = [teamA.word, teamB.word, ...commentRows.flatMap((row) => [row.wordA, row.wordB])]
      .map((w) => String(w).trim().toLowerCase());
    if (words.some((w) => !w)) {
      settingsError.value = 'اكتب تعليق الفريقين لكل تعليق إضافي، أو احذفه!';
      return;
    }
    // لو تعليق جزء من تعليق ثاني، تعليق المشاهد ممكن ينحسب للفريق الغلط
    if (words.some((w, i) => words.some((other, j) => i !== j && other.includes(w)))) {
      settingsError.value = 'لازم كل تعليق يكون مختلف عن الباقي وما يكون جزء منه!';
      return;
    }
  }

  // نتأكد إن هدايا كل صف لسا موجودة بنفس القيمة المختارة (القائمة المسجلة ممكن توصل بعد فتح اللعبة)
  const rowsOk = giftRows.every((row) => {
    const free = freeGifts(row, row.cost).map((g) => g.value);
    return free.includes(row.giftA) && free.includes(row.giftB) && row.giftA !== row.giftB;
  });
  if (!rowsOk) {
    settingsError.value = 'أكمل اختيار القيمة وهدية كل فريق لكل هدية إضافية، أو احذفها!';
    return;
  }
  if (giftsOnlyMode.value && !giftRows.length) {
    settingsError.value = 'لازم تضيف هدية واحدة على الأقل إذا فعّلت وضع "هدايا فقط"!';
    return;
  }

  [teamA, teamB].forEach((team) => {
    const side = team === teamA ? 'A' : 'B';
    team.gifts = giftRows.map((row) => ({
      value: row[`gift${side}`], points: cleanPoints(row), instantWin: row.instantWin,
    }));
    team.extraWords = commentRows.map((row) => ({ word: row[`word${side}`].trim(), points: 1 }));
  });
  teamA.score = 0; teamA.commentCount = 0; teamA.giftCount = 0;
  teamB.score = 0; teamB.commentCount = 0; teamB.giftCount = 0;
  settingsError.value = '';
  settingsVisible.value = false;

  roundDuration = getRoundDuration();
  instantWinThreshold = getInstantWinThreshold();
  visualScale = Math.max(10, Math.ceil(roundDuration / 4));

  timeLeft.value = roundDuration;
  roundNumber.value++;
  gamePhase.value = 'running';
  ropeMarkerLeft.value = '50%';

  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🚀 بدأت الجولة ${roundNumber.value}: ${escapeHtml(teamA.word)} ${escapeHtml(teamA.name)} ضد ${escapeHtml(teamB.word)} ${escapeHtml(teamB.name)}</div>`);

  startTimer();
}

function startTimer() {
  if (countdown) clearInterval(countdown);
  countdown = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(countdown);
      countdown = null;
      endRound('انتهاء الوقت');
    }
  }, 1000);
}

function registerCommentFromChat(rawText) {
  if (gamePhase.value !== 'running' || !rawText || giftsOnlyMode.value) return;
  const text = String(rawText).toLowerCase();
  const hit = [teamA, teamB]
    .flatMap((team) => [{ word: team.word, points: 1 }, ...team.extraWords].map((w) => ({ team, ...w })))
    .find((c) => text.includes(c.word.toLowerCase()));
  if (!hit) return;
  addScore(hit.team, hit.points);
  appendLog(`<div class="log-item log-${hit.team.key}">💬 ${escapeHtml(hit.word)} تعليق جديد لصالح ${escapeHtml(hit.team.name)} (+${hit.points})</div>`);
  afterScoreChange();
}

// ===== فقاعات الداعمين اللي يسحبون الحبل بالهدايا =====
const activePullers = reactive([]); // { id, teamKey, avatar, name }
let pullerIdCounter = 0;
const pullersA = computed(() => activePullers.filter((p) => p.teamKey === 'a'));
const pullersB = computed(() => activePullers.filter((p) => p.teamKey === 'b'));

function spawnPuller(team, username, avatar) {
  const id = ++pullerIdCounter;
  activePullers.push({
    id, teamKey: team.key, avatar: avatar || '', name: username || 'داعم',
  });
  if (activePullers.length > 12) activePullers.splice(0, activePullers.length - 12);
  setTimeout(() => {
    const idx = activePullers.findIndex((p) => p.id === id);
    if (idx !== -1) activePullers.splice(idx, 1);
  }, 1800);
}

function registerGiftFromEvent(data) {
  if (gamePhase.value !== 'running') return;
  const giftName = getGiftName(data);
  if (!giftName) return;
  const name = String(giftName).toLowerCase();
  const candidates = [teamA, teamB].flatMap((team) => team.gifts.map((g) => ({
    team, points: g.points, instantWin: g.instantWin, key: g.value.toLowerCase(),
  })));
  // التطابق التام أول، عشان لو اسم هدية جزء من اسم هدية ثانية ما تنحسب للغلط
  const hit = candidates.find((c) => c.key === name) || candidates.find((c) => name.includes(c.key));
  if (!hit) return;

  const { team, points, instantWin } = hit;
  const username = getGiftUser(data);
  team.giftCount++;
  spawnPuller(team, username, data.avatar || getUserAvatar(username));
  if (instantWin) {
    appendLog(`<div class="log-item log-${team.key}">🎁 هدية "${escapeHtml(giftName)}" — فوز مباشر لصالح ${escapeHtml(team.name)}!</div>`);
    endRound('هدية الفوز المباشر', team);
    return;
  }
  team.score += points;
  appendLog(`<div class="log-item log-${team.key}">🎁 هدية "${escapeHtml(giftName)}" لصالح ${escapeHtml(team.name)} (+${points})</div>`);
  afterScoreChange();
}

function addScore(team, points) {
  team.score += points;
  team.commentCount++;
}

function afterScoreChange() {
  renderRope();
  if (instantWinThreshold > 0) {
    const diff = Math.abs(teamA.score - teamB.score);
    if (diff >= instantWinThreshold) {
      endRound('فوز فوري');
    }
  }
}

function renderRope() {
  const diff = teamA.score - teamB.score;
  let scale = instantWinThreshold > 0 ? instantWinThreshold : visualScale;
  if (instantWinThreshold === 0 && Math.abs(diff) > visualScale) {
    visualScale = Math.ceil(Math.abs(diff) * 1.15);
    scale = visualScale;
  }
  let percent = 50 - (diff / scale) * 42;
  percent = Math.max(8, Math.min(92, percent));
  ropeMarkerLeft.value = `${percent}%`;
}

// forcedWinner = الفريق اللي وصلته هدية الفوز المباشر (يفوز بغض النظر عن النقاط)
function endRound(reason, forcedWinner = null) {
  if (gamePhase.value !== 'running') return;
  if (countdown) { clearInterval(countdown); countdown = null; }
  gamePhase.value = 'ended';

  let winner = null;
  if (forcedWinner) winner = forcedWinner;
  else if (teamA.score > teamB.score) winner = teamA;
  else if (teamB.score > teamA.score) winner = teamB;

  const logs = [];
  if (winner) {
    roundWins[winner.key]++;
    saveRoundWins();
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 فاز ${escapeHtml(winner.word)} <b>${escapeHtml(winner.name)}</b> بهذي الجولة! (${winner.score} مقابل ${winner === teamA ? teamB.score : teamA.score}) — السبب: ${escapeHtml(reason)}</div>`);
    if (forcedWinner || (instantWinThreshold > 0 && Math.abs(teamA.score - teamB.score) >= instantWinThreshold)) {
      ropeMarkerLeft.value = winner === teamA ? '8%' : '92%';
    }
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ccd6e0;">🤝 تعادل بين الفريقين هذي الجولة!</div>');
  }
  logs.push(`<div class="log-item" style="text-align:center;">السلسلة الآن: ${escapeHtml(teamA.word)} ${roundWins.a} - ${roundWins.b} ${escapeHtml(teamB.word)}</div>`);

  logs.forEach((l) => appendLog(l));
  openModal(`نتيجة الجولة ${roundNumber.value}`, logs);
}

function resetGame() {
  if (countdown) { clearInterval(countdown); countdown = null; }
  gamePhase.value = 'idle';
  roundNumber.value = 0;
  roundWins.a = 0; roundWins.b = 0;
  saveRoundWins();
  teamA.score = 0; teamA.commentCount = 0; teamA.giftCount = 0;
  teamB.score = 0; teamB.commentCount = 0; teamB.giftCount = 0;
  eventLog.value = [];
  ropeMarkerLeft.value = '50%';
  activePullers.splice(0, activePullers.length);
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 80) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const seriesBadgeText = computed(() => `السلسلة: ${teamA.word} ${roundWins.a} - ${roundWins.b} ${teamB.word}`);
const timerText = computed(() => {
  if (gamePhase.value === 'idle') return '--';
  if (gamePhase.value === 'running') return String(timeLeft.value);
  return '🏁';
});
const timerUrgent = computed(() => gamePhase.value === 'running' && timeLeft.value <= 10);
const statusText = computed(() => {
  if (gamePhase.value === 'idle') return 'اضبط إعدادات الفريقين ثم اضغط "بدء الجولة"';
  if (gamePhase.value === 'running') {
    const diff = teamA.score - teamB.score;
    if (diff > 0) return `${teamA.word} ${teamA.name} يسحب الحبل!`;
    if (diff < 0) return `${teamB.word} ${teamB.name} يسحب الحبل!`;
    return '⚖️ الفريقان متعادلان الآن';
  }
  return 'انتهت الجولة — اضغط "جولة جديدة" للعب مرة أخرى';
});

const startBtnVisible = computed(() => gamePhase.value === 'idle');
const newRoundBtnVisible = computed(() => gamePhase.value === 'ended');
const forceEndBtnVisible = computed(() => gamePhase.value === 'running');

const barExpanded = ref(true);
function goHome() { router.push('/'); }

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function handleTiktokMessage(data) {
  if (data.comment) registerCommentFromChat(data.comment);
  if (isGiftEvent(data)) registerGiftFromEvent(data);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'tug', onMessage: handleTiktokMessage });
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    if (settingsVisible.value) return;
    e.preventDefault();
    if (showModal_.value) return;
    if (startBtnVisible.value || newRoundBtnVisible.value) openSettings();
    else if (forceEndBtnVisible.value) endRound('يدوي');
  }
}

onMounted(() => {
  syncTeamConfigFromInputs();
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdown) clearInterval(countdown);
  clearMessageHandler();
});
</script>

<template>
  <h1>🪢 شد الحبل</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" :disabled="gamePhase === 'running'" title="إعدادات الجولة (تتعدل قبل بدء الجولة)" @click="openSettings(false)">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" start-label="▶️ ابدأ الجولة" @start="startRound" @close="settingsVisible = false">
    <div class="adv-group guess">
      <div class="adv-group-title">👥 الفريقين <span class="adv-group-note">الاسم وتعليق السحب</span></div>

      <div class="adv-columns">
        <div class="adv-item adv-team" style="border-inline-start-color:#e74c3c;">
          <span>🔴 <b>الفريق الأول</b>{{ giftsOnlyMode ? ' — اسم الفريق.' : ' — أي مشاهد يكتب تعليقه يسحب الحبل له. اختر "تخصيص" لكتابة كلمة من عندك.' }}</span>
          <input v-model="teamANameInput" type="text" maxlength="30" placeholder="اسم الفريق">
          <div v-if="!giftsOnlyMode" class="word-pick">
            <CustomSelect v-model="teamAWordSelect" :options="wordOptions" />
            <input v-if="teamAWordSelect === CUSTOM_WORD" v-model="teamAWordCustom" type="text" maxlength="20" placeholder="اكتب التعليق">
          </div>
        </div>
        <div class="adv-item adv-team" style="border-inline-start-color:#3498db;">
          <span>🔵 <b>الفريق الثاني</b>{{ giftsOnlyMode ? ' — اسم الفريق.' : ' — أي مشاهد يكتب تعليقه يسحب الحبل له. اختر "تخصيص" لكتابة كلمة من عندك.' }}</span>
          <input v-model="teamBNameInput" type="text" maxlength="30" placeholder="اسم الفريق">
          <div v-if="!giftsOnlyMode" class="word-pick">
            <CustomSelect v-model="teamBWordSelect" :options="wordOptions" />
            <input v-if="teamBWordSelect === CUSTOM_WORD" v-model="teamBWordCustom" type="text" maxlength="20" placeholder="اكتب التعليق">
          </div>
        </div>
      </div>
    </div>

    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات الجولة</div>

      <label class="adv-item">
        <span>⏱️ <b>مدة الجولة</b> — بالثواني.</span>
        <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="10" max="600">
      </label>

      <div class="adv-item" :class="{ checked: instantWinEnabled }">
        <label class="adv-item-label">
          <input v-model="instantWinEnabled" type="checkbox">
          <span>🏆 <b>الفوز الفوري</b> — لو وصل فرق النقاط بين الفريقين للرقم المحدد قبل انتهاء الوقت، ينتهي شد الحبل فوراً بفوز المتقدم.</span>
        </label>
        <div v-if="instantWinEnabled" class="adv-item-extra">
          <input id="instantWinInput" v-model="instantWinInput" type="number" min="1" placeholder="فرق النقاط">
          <div class="field-hint">فرق النقاط بين الفريقين اللي ينهي الجولة فوراً.</div>
        </div>
      </div>

      <div v-if="!isChatMode()" class="adv-item" :class="{ checked: giftsOnlyMode }">
        <label class="adv-item-label">
          <input v-model="giftsOnlyMode" type="checkbox">
          <span>🎁 <b>هدايا فقط</b> — تعليقات المشاهدين ما تُحتسب هذي الجولة، فقط الهدايا الإضافية المختارة تسحب الحبل.</span>
        </label>
      </div>
    </div>

    <div v-if="!isChatMode()" class="adv-group gifts">
      <div class="adv-group-title">🎁 هدايا إضافية <span class="adv-group-note">كل هدية لها نسخة لكل فريق بنفس القيمة</span></div>

      <div v-for="row in giftRows" :key="row.id" class="adv-item">
        <div class="tug-row three">
          <div class="tug-field" title="تطلع بس القيم اللي فيها هديتين أو أكثر من الهدايا المسجلة">
            <small>🎁 القيمة</small>
            <CustomSelect :model-value="row.cost" :options="rowCostOptions(row)" placeholder="اختر القيمة" @update:model-value="setRowCost(row, $event)" />
          </div>
          <div class="tug-field" title="أي مشاهد يرسلها يضيف نقاطها للفريق الأول">
            <small>🔴 هدية الفريق الأول</small>
            <CustomSelect v-model="row.giftA" :options="rowGiftOptions(row, 'giftA')" placeholder="—" :disabled="!row.cost" />
          </div>
          <div class="tug-field" title="بنفس قيمة هدية الفريق الأول بالضبط">
            <small>🔵 هدية الفريق الثاني</small>
            <CustomSelect v-model="row.giftB" :options="rowGiftOptions(row, 'giftB')" placeholder="—" :disabled="!row.cost" />
          </div>
        </div>
        <div class="tug-row-foot">
          <label class="adv-item-label">
            <input v-model="row.instantWin" type="checkbox">
            <span>🏆 <b>فوز مباشر</b> — أول فريق توصله هديته يفوز بالجولة فوراً.</span>
          </label>
          <input v-if="!row.instantWin" v-model="row.points" type="number" min="0" placeholder="➕ النقاط" title="النقاط اللي تضيفها هذي الهدية لفريقها" class="tug-points">
          <button type="button" class="gift-row-remove" title="حذف الهدية" @click="removeRow(giftRows, row)">✖</button>
        </div>
      </div>

      <div class="adv-seg">
        <button type="button" class="adv-seg-btn" :disabled="!canAddGiftRow" :title="canAddGiftRow ? '' : 'ما بقى قيمة فيها هديتين متاحة من الهدايا المسجلة'" @click="addGiftRow">🎁 إضافة هدية</button>
      </div>
    </div>

    <div v-if="!giftsOnlyMode" class="adv-group modes">
      <div class="adv-group-title">💬 تعليقات إضافية <span class="adv-group-note">كل تعليق يضيف نقطة لفريقه</span></div>

      <div v-for="row in commentRows" :key="row.id" class="adv-item">
        <div class="tug-row-foot">
          <div class="tug-field">
            <small>🔴 تعليق الفريق الأول</small>
            <input v-model="row.wordA" type="text" maxlength="20" placeholder="اكتب التعليق">
          </div>
          <div class="tug-field">
            <small>🔵 تعليق الفريق الثاني</small>
            <input v-model="row.wordB" type="text" maxlength="20" placeholder="اكتب التعليق">
          </div>
          <button type="button" class="gift-row-remove" title="حذف التعليق" @click="removeRow(commentRows, row)">✖</button>
        </div>
      </div>

      <div class="adv-seg">
        <button type="button" class="adv-seg-btn" @click="addCommentRow">💬 إضافة تعليق</button>
      </div>
    </div>

    <p v-if="settingsError" class="settings-error">⚠️ {{ settingsError }}</p>
  </SettingsOverlay>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startRoundBtn" @click="openSettings(true)">🚀 بدء الجولة</button>
    <button v-if="newRoundBtnVisible" class="master-btn side-panel-btn" id="newRoundBtn" @click="openSettings(true)">🔄 جولة جديدة</button>
    <button v-if="forceEndBtnVisible" class="master-btn side-panel-btn" style="background:#8A1538;" @click="endRound('يدوي')">🏁 إنهاء الجولة الآن</button>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🪢 ساحة شد الحبل</h2>
      <div class="series-badge">{{ seriesBadgeText }}</div>
      <div class="tug-timer" :class="{ urgent: timerUrgent }">{{ timerText }}</div>
      <div class="tug-status">{{ statusText }}</div>

      <div class="team-sides">
        <div class="team-side">
          <div class="team-emoji-big" :class="{ long: isLongWord(teamA.word) }">{{ teamA.word }}</div>
          <div class="team-name-label">{{ teamA.name }}</div>
          <div class="team-triggers">
            <template v-if="!giftsOnlyMode">
              <span class="trigger-chip">💬 {{ teamA.word }} (+1)</span>
              <span v-for="w in teamA.extraWords" :key="w.word" class="trigger-chip">💬 {{ w.word }} (+{{ w.points }})</span>
            </template>
            <template v-if="!isChatMode()">
              <span v-for="g in teamA.gifts" :key="g.value" class="trigger-chip">🎁 {{ giftLabel(g.value) }} ({{ g.instantWin ? '🏆 فوز مباشر' : `+${g.points}` }})</span>
            </template>
          </div>
          <div class="team-score-num">{{ teamA.score }}</div>
          <div class="team-stats-small">{{ teamA.commentCount }} تعليق<template v-if="!isChatMode()"> | {{ teamA.giftCount }} هدية</template></div>
          <div class="pullers-row">
            <div v-for="p in pullersA" :key="p.id" class="puller-chip" :title="p.name">
              <img v-if="p.avatar" :src="p.avatar" class="puller-avatar" alt="">
              <span v-else class="puller-avatar puller-fallback">🎁</span>
            </div>
          </div>
        </div>
        <div class="team-side">
          <div class="team-emoji-big" :class="{ long: isLongWord(teamB.word) }">{{ teamB.word }}</div>
          <div class="team-name-label">{{ teamB.name }}</div>
          <div class="team-triggers">
            <template v-if="!giftsOnlyMode">
              <span class="trigger-chip">💬 {{ teamB.word }} (+1)</span>
              <span v-for="w in teamB.extraWords" :key="w.word" class="trigger-chip">💬 {{ w.word }} (+{{ w.points }})</span>
            </template>
            <template v-if="!isChatMode()">
              <span v-for="g in teamB.gifts" :key="g.value" class="trigger-chip">🎁 {{ giftLabel(g.value) }} ({{ g.instantWin ? '🏆 فوز مباشر' : `+${g.points}` }})</span>
            </template>
          </div>
          <div class="team-score-num">{{ teamB.score }}</div>
          <div class="team-stats-small">{{ teamB.commentCount }} تعليق<template v-if="!isChatMode()"> | {{ teamB.giftCount }} هدية</template></div>
          <div class="pullers-row">
            <div v-for="p in pullersB" :key="p.id" class="puller-chip" :title="p.name">
              <img v-if="p.avatar" :src="p.avatar" class="puller-avatar" alt="">
              <span v-else class="puller-avatar puller-fallback">🎁</span>
            </div>
          </div>
        </div>
      </div>

      <div class="rope-track">
        <div class="rope-line"></div>
        <div class="rope-center-mark"></div>
        <div class="rope-marker" :style="{ left: ropeMarkerLeft }">🪢</div>
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

.team-config-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.team-config-row .word-input { width: 70px; flex: none; text-align: center; font-size: 1.3rem; }
.team-config-row .name-input { flex: 1; min-width: 140px; }

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

.series-badge {
  text-align: center;
  font-size: 1.05rem;
  font-weight: bold;
  margin-bottom: 12px;
  color: #ecf0f1;
}

.tug-timer {
  font-size: 42px;
  font-weight: bold;
  text-align: center;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 6px;
}

.tug-timer.urgent { color: #ff4757; }

.tug-status {
  text-align: center;
  color: #ccd6e0;
  font-size: 0.95rem;
  margin-bottom: 18px;
  min-height: 1.4em;
  font-weight: bold;
}

.team-sides {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
  margin-bottom: 12px;
  gap: 8px;
}

.team-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  flex: 1;
  min-width: 0;
}

.team-side .team-emoji-big { font-size: 2.2rem; line-height: 1.2; }
.team-side .team-name-label { font-size: 0.9rem; color: #ccd6e0; margin-top: 2px; max-width: 100%; word-break: break-word; }
.team-side .team-score-num { font-size: 1.8rem; font-weight: bold; color: var(--primary-color); margin-top: 4px; line-height: 1.2; }
.team-side .team-stats-small { font-size: 0.72rem; color: #8b93a3; margin-top: 2px; }

.team-side .team-emoji-big.long { font-size: 1.3rem; word-break: break-word; }

/* كل محفّز بسطر: التعليق فوق وتحته الهدايا */
.team-triggers {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

/* نافذة الإعدادات (SettingsOverlay): صفوف الهدايا والتعليقات الإضافية */
.tug-row { display: grid; gap: 8px; }
.tug-row.three { grid-template-columns: repeat(3, 1fr); }
.tug-row-foot { display: flex; align-items: flex-end; gap: 8px; }
.tug-row-foot .adv-item-label { flex: 1; align-self: center; }
.tug-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.tug-field small { font-size: 0.78rem; color: #ecf0f1; font-weight: bold; }
.tug-points { flex: none; width: 110px !important; }
@media (max-width: 600px) {
  .tug-row.three { grid-template-columns: 1fr; }
}

.gift-row-remove {
  flex: none;
  width: 40px;
  height: 40px;
  background: rgba(231, 76, 60, 0.25);
  border: 1px solid rgba(231, 76, 60, 0.6);
  border-radius: 8px;
  color: white;
  cursor: pointer;
}

/* عند "تخصيص": القائمة وحقل الكتابة جنب بعض بنفس السطر */
.word-pick { display: flex; gap: 6px; width: 100%; }
.word-pick :deep(.custom-select) { flex: 1 1 0; }
.word-pick input { flex: 1.4 1 0; min-width: 0; }

.settings-error {
  margin: 0;
  text-align: center;
  color: #ff6b6b;
  font-weight: bold;
  font-size: 0.95rem;
}

.trigger-chip {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 0.72rem;
  color: #ecf0f1;
  white-space: nowrap;
}

.pullers-row {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 34px;
  margin-top: 6px;
}

.puller-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--primary-color);
  box-shadow: 0 0 10px rgba(243, 156, 18, 0.8);
  animation: pullerTug 0.35s ease-in-out infinite alternate, pullerFade 1.8s ease forwards;
}

.puller-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  background: rgba(0, 0, 0, 0.4);
}

@keyframes pullerTug {
  0% { transform: translateY(0) rotate(-8deg) scale(1); }
  100% { transform: translateY(-5px) rotate(8deg) scale(1.18); }
}

@keyframes pullerFade {
  0% { opacity: 0; transform: scale(0.4); }
  12% { opacity: 1; transform: scale(1.25); }
  80% { opacity: 1; }
  100% { opacity: 0; transform: scale(0.7) translateY(-12px); }
}

.rope-track {
  position: relative;
  width: 100%;
  height: 60px;
  background: linear-gradient(90deg, rgba(231,76,60,0.25), rgba(255,255,255,0.05) 50%, rgba(52,152,219,0.25));
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.15);
  margin-bottom: 8px;
  overflow: hidden;
}

.rope-line {
  position: absolute;
  top: 50%;
  left: 6%;
  right: 6%;
  height: 4px;
  background: repeating-linear-gradient(90deg, #d2a679 0, #d2a679 8px, #8a5a2b 8px, #8a5a2b 16px);
  transform: translateY(-50%);
  border-radius: 4px;
}

.rope-center-mark {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 50%;
  width: 2px;
  background: rgba(255,255,255,0.35);
  transform: translateX(-50%);
}

.rope-marker {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 2rem;
  transition: left 0.5s ease;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
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
.event-log-panel :deep(.log-a) { border-right: 4px solid #e74c3c; }
.event-log-panel :deep(.log-b) { border-right: 4px solid #3498db; }

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
