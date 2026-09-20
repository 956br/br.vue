<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import { isGiftEvent, getGiftName, getGiftUser } from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
} from '../../utils/tiktokConnectionManager';
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

// التكلفة الحقيقية بالكوينز لكل هدية على منصة تيك توك (تحدد أي الهدايا متساوية القيمة فعلياً)
const APPROVED_GIFTS = [
  { value: 'Rose', label: '🌹 وردة', cost: 1 },
  { value: 'TikTok', label: '🎵 تيك توك', cost: 1 },
  { value: 'Ice Cream Cone', label: '🍦 مثلجات', cost: 1 },
  { value: 'Finger Heart', label: '🤏 قلب الأصابع', cost: 5 },
  { value: 'Panda', label: '🐼 باندا', cost: 5 },
  { value: 'Perfume', label: '🌸 عطر', cost: 20 },
  { value: 'Doughnut', label: '🍩 دونات', cost: 30 },
  { value: 'Hand Hearts', label: '💗 قلوب الأيدي', cost: 100 },
  { value: 'Corgi', label: '🐶 كورجي', cost: 299 },
  { value: 'Money Gun', label: '💵 مسدس المال', cost: 500 },
  { value: 'Galaxy', label: '🌌 المجرة', cost: 1000 },
  { value: 'Starlight Sceptre', label: '👑 الصولجان', cost: 1200 },
];
function giftLabel(value) {
  const found = APPROVED_GIFTS.find((g) => g.value === value);
  return found ? found.label : value;
}

// كل زوج هنا هداياه متساوية القيمة الحقيقية بالكوينز تماماً (1 مقابل 1، أو 5 مقابل 5)
const giftPairs = [
  { giftA: 'Rose', giftB: 'TikTok', value: 1 },
  { giftA: 'Rose', giftB: 'Ice Cream Cone', value: 1 },
  { giftA: 'Finger Heart', giftB: 'Panda', value: 5 },
];
const giftPairOptions = [
  { value: '', label: 'بدون هدايا مخصصة لهذي الجولة' },
  ...giftPairs.map((pair, i) => ({
    value: String(i),
    label: `🔴 ${giftLabel(pair.giftA)} = 🔵 ${giftLabel(pair.giftB)} (${pair.value} كوين)`,
  })),
];

const gamePhase = ref('idle'); // idle | running | ended
const roundNumber = ref(0);
let roundDuration = 60;
const timeLeft = ref(0);
let countdown = null;
let giftBonusPoints = 5;
let instantWinThreshold = 30;
let visualScale = 20;
const eventLog = ref([]);
const ropeMarkerLeft = ref('50%');

const teamA = reactive({
  key: 'a', name: 'الفريق الأحمر', emoji: '🔴', giftFilter: '', score: 0, commentCount: 0, giftCount: 0,
});
const teamB = reactive({
  key: 'b', name: 'الفريق الأزرق', emoji: '🔵', giftFilter: '', score: 0, commentCount: 0, giftCount: 0,
});

const teamAEmojiInput = ref('🔴');
const teamANameInput = ref('الفريق الأحمر');
const teamBEmojiInput = ref('🔵');
const teamBNameInput = ref('الفريق الأزرق');
const giftPairSelect = ref('');
const giftsOnlyMode = ref(false);
const roundDurationInput = ref(60);
const giftBonusInput = ref(5);
const instantWinEnabled = ref(true);
const instantWinInput = ref(30);

const configDisabled = computed(() => gamePhase.value !== 'idle');

function syncTeamConfigFromInputs() {
  teamA.emoji = teamAEmojiInput.value.trim() || '🔴';
  teamA.name = teamANameInput.value.trim() || 'الفريق الأحمر';
  teamB.emoji = teamBEmojiInput.value.trim() || '🔵';
  teamB.name = teamBNameInput.value.trim() || 'الفريق الأزرق';
}

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 10) val = 10;
  if (val > 600) val = 600;
  roundDurationInput.value = val;
  return val;
}
function getGiftBonus() {
  let val = parseInt(giftBonusInput.value, 10);
  if (Number.isNaN(val) || val < 0) val = 0;
  giftBonusInput.value = val;
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

function startRound() {
  if (gamePhase.value === 'running') return;
  syncTeamConfigFromInputs();

  if (teamA.emoji === teamB.emoji) {
    openModal('تنبيه', ['<div class="log-item">لازم يكون إيموجي كل فريق مختلف عن الثاني!</div>']);
    return;
  }

  const pairIndex = parseInt(giftPairSelect.value, 10);
  const selectedPair = !Number.isNaN(pairIndex) ? giftPairs[pairIndex] : null;

  if (giftsOnlyMode.value && !selectedPair) {
    openModal('تنبيه', ['<div class="log-item">لازم تختار زوج هدايا الفرق أول إذا فعّلت وضع "هدايا فقط"!</div>']);
    return;
  }

  teamA.giftFilter = selectedPair ? selectedPair.giftA : '';
  teamB.giftFilter = selectedPair ? selectedPair.giftB : '';
  teamA.score = 0; teamA.commentCount = 0; teamA.giftCount = 0;
  teamB.score = 0; teamB.commentCount = 0; teamB.giftCount = 0;

  roundDuration = getRoundDuration();
  giftBonusPoints = getGiftBonus();
  instantWinThreshold = getInstantWinThreshold();
  visualScale = Math.max(10, Math.ceil(roundDuration / 4));

  timeLeft.value = roundDuration;
  roundNumber.value++;
  gamePhase.value = 'running';
  ropeMarkerLeft.value = '50%';

  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🚀 بدأت الجولة ${roundNumber.value}: ${escapeHtml(teamA.emoji)} ${escapeHtml(teamA.name)} ضد ${escapeHtml(teamB.emoji)} ${escapeHtml(teamB.name)}</div>`);

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
  const text = String(rawText);
  if (text.includes(teamA.emoji)) {
    addScore(teamA, 1);
    appendLog(`<div class="log-item log-a">💬 ${escapeHtml(teamA.emoji)} تعليق جديد لصالح ${escapeHtml(teamA.name)} (+1)</div>`);
  } else if (text.includes(teamB.emoji)) {
    addScore(teamB, 1);
    appendLog(`<div class="log-item log-b">💬 ${escapeHtml(teamB.emoji)} تعليق جديد لصالح ${escapeHtml(teamB.name)} (+1)</div>`);
  } else {
    return;
  }
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
  const aFilter = teamA.giftFilter.toLowerCase();
  const bFilter = teamB.giftFilter.toLowerCase();
  const username = getGiftUser(data);
  const avatar = data.avatar || getUserAvatar(username);

  if (aFilter && name.includes(aFilter)) {
    teamA.giftCount++;
    addScore(teamA, giftBonusPoints);
    appendLog(`<div class="log-item log-a">🎁 هدية "${escapeHtml(giftName)}" لصالح ${escapeHtml(teamA.name)} (+${giftBonusPoints})</div>`);
    spawnPuller(teamA, username, avatar);
  } else if (bFilter && name.includes(bFilter)) {
    teamB.giftCount++;
    addScore(teamB, giftBonusPoints);
    appendLog(`<div class="log-item log-b">🎁 هدية "${escapeHtml(giftName)}" لصالح ${escapeHtml(teamB.name)} (+${giftBonusPoints})</div>`);
    spawnPuller(teamB, username, avatar);
  } else {
    return;
  }
  afterScoreChange();
}

function addScore(team, points) {
  team.score += points;
  if (points === 1) team.commentCount++;
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

function endRound(reason) {
  if (gamePhase.value !== 'running') return;
  if (countdown) { clearInterval(countdown); countdown = null; }
  gamePhase.value = 'ended';

  let winner = null;
  if (teamA.score > teamB.score) winner = teamA;
  else if (teamB.score > teamA.score) winner = teamB;

  const logs = [];
  if (winner) {
    roundWins[winner.key]++;
    saveRoundWins();
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 فاز ${escapeHtml(winner.emoji)} <b>${escapeHtml(winner.name)}</b> بهذي الجولة! (${winner.score} مقابل ${winner === teamA ? teamB.score : teamA.score}) — السبب: ${escapeHtml(reason)}</div>`);
    if (instantWinThreshold > 0 && Math.abs(teamA.score - teamB.score) >= instantWinThreshold) {
      ropeMarkerLeft.value = winner === teamA ? '8%' : '92%';
    }
  } else {
    logs.push('<div style="text-align:center; font-size:17px; color:#ccd6e0;">🤝 تعادل بين الفريقين هذي الجولة!</div>');
  }
  logs.push(`<div class="log-item" style="text-align:center;">السلسلة الآن: ${escapeHtml(teamA.emoji)} ${roundWins.a} - ${roundWins.b} ${escapeHtml(teamB.emoji)}</div>`);

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

const seriesBadgeText = computed(() => `السلسلة: ${teamA.emoji} ${roundWins.a} - ${roundWins.b} ${teamB.emoji}`);
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
    if (diff > 0) return `${teamA.emoji} ${teamA.name} يسحب الحبل!`;
    if (diff < 0) return `${teamB.emoji} ${teamB.name} يسحب الحبل!`;
    return '⚖️ الفريقان متعادلان الآن';
  }
  return 'انتهت الجولة — اضغط "جولة جديدة" للعب مرة أخرى';
});

const startBtnVisible = computed(() => gamePhase.value === 'idle');
const newRoundBtnVisible = computed(() => gamePhase.value === 'ended');
const forceEndBtnVisible = computed(() => gamePhase.value === 'running');

const showRulesOverlay = ref(false);
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
    e.preventDefault();
    if (showRulesOverlay.value || showModal_.value) return;
    if (startBtnVisible.value || newRoundBtnVisible.value) startRound();
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
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="top-names-section">
    <label>🔴 إعدادات الفريق الأول:</label>
    <div class="team-config-row">
      <input v-model="teamAEmojiInput" type="text" class="emoji-input" maxlength="4" :disabled="configDisabled" @input="syncTeamConfigFromInputs">
      <input v-model="teamANameInput" type="text" class="name-input" maxlength="30" :disabled="configDisabled" @input="syncTeamConfigFromInputs">
    </div>
    <div class="field-hint">أي مشاهد يكتب هذا الإيموجي بالتعليقات يسحب الحبل لهذا الفريق</div>
  </div>

  <div class="top-names-section">
    <label>🔵 إعدادات الفريق الثاني:</label>
    <div class="team-config-row">
      <input v-model="teamBEmojiInput" type="text" class="emoji-input" maxlength="4" :disabled="configDisabled" @input="syncTeamConfigFromInputs">
      <input v-model="teamBNameInput" type="text" class="name-input" maxlength="30" :disabled="configDisabled" @input="syncTeamConfigFromInputs">
    </div>
    <div class="field-hint">نفس الفكرة بالضبط لكن لهذا الفريق</div>
  </div>

  <div class="top-names-section">
    <label for="giftPairSelect">🎁 زوج هدايا الفرق:</label>
    <CustomSelect v-model="giftPairSelect" :options="giftPairOptions" :disabled="configDisabled" />
    <div class="field-hint">أي هدية بالاسم المطابق لفريقها بالزوج المختار تضيف نقاط بونص إضافية لنفس الفريق فقط. اختر "بدون هدايا مخصصة" لتعطيل هذه الميزة هذي الجولة</div>
    <label class="join-gift-toggle" for="giftsOnlyModeCheckbox" style="margin-top:10px;">
      <input id="giftsOnlyModeCheckbox" v-model="giftsOnlyMode" type="checkbox" :disabled="configDisabled">
      🎁 هدايا فقط (تعطيل السحب بالتعليقات هذي الجولة)
    </label>
    <div v-if="giftsOnlyMode" class="field-hint">💬 تعليقات المشاهدين لن تُحتسب هذي الجولة — فقط الهدايا المطابقة لزوج الهدايا المختار أعلاه تسحب الحبل.</div>
  </div>

  <div class="master-controls" style="margin-top:-5px;">
    <label for="roundDurationInput" style="color:#ecf0f1; font-size:0.9rem;">⏱️ مدة الجولة (ثانية):</label>
    <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="10" max="600" :disabled="configDisabled" style="width:80px; padding:6px; text-align:center;">

    <label for="giftBonusInput" style="color:#ecf0f1; font-size:0.9rem;">🎁 نقاط بونص لكل هدية:</label>
    <input id="giftBonusInput" v-model="giftBonusInput" type="number" min="0" :disabled="configDisabled" style="width:80px; padding:6px; text-align:center;">
  </div>

  <div class="master-controls" style="margin-top:-5px;">
    <label class="join-gift-toggle" for="instantWinEnabled" style="margin:0;">
      <input id="instantWinEnabled" v-model="instantWinEnabled" type="checkbox" :disabled="configDisabled">
      🏆 تفعيل الفوز الفوري
    </label>
    <template v-if="instantWinEnabled">
      <label for="instantWinInput" style="color:#ecf0f1; font-size:0.85rem;">فرق النقاط:</label>
      <input id="instantWinInput" v-model="instantWinInput" type="number" min="1" :disabled="configDisabled" style="width:80px; padding:6px; text-align:center;">
    </template>
  </div>
  <div class="field-hint" style="text-align:center; width:100%; margin-top:-10px; margin-bottom:15px;">لو فعّلت الخيار ووصل الفرق بالنقاط بين الفريقين لهذا الرقم قبل انتهاء الوقت، ينتهي شد الحبل فوراً بفوز الفريق المتقدم</div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startRoundBtn" @click="startRound">🚀 بدء الجولة</button>
    <button v-if="newRoundBtnVisible" class="master-btn side-panel-btn" id="newRoundBtn" @click="startRound">🔄 جولة جديدة</button>
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
          <div class="team-emoji-big">{{ teamA.emoji }}</div>
          <div class="team-name-label">{{ teamA.name }}</div>
          <div class="team-triggers">
            <span v-if="!giftsOnlyMode" class="trigger-chip">💬 {{ teamA.emoji }}</span>
            <span v-if="teamA.giftFilter" class="trigger-chip">🎁 {{ giftLabel(teamA.giftFilter) }}</span>
          </div>
          <div class="team-score-num">{{ teamA.score }}</div>
          <div class="team-stats-small">{{ teamA.commentCount }} تعليق | {{ teamA.giftCount }} هدية</div>
          <div class="pullers-row">
            <div v-for="p in pullersA" :key="p.id" class="puller-chip" :title="p.name">
              <img v-if="p.avatar" :src="p.avatar" class="puller-avatar" alt="">
              <span v-else class="puller-avatar puller-fallback">🎁</span>
            </div>
          </div>
        </div>
        <div class="team-side">
          <div class="team-emoji-big">{{ teamB.emoji }}</div>
          <div class="team-name-label">{{ teamB.name }}</div>
          <div class="team-triggers">
            <span v-if="!giftsOnlyMode" class="trigger-chip">💬 {{ teamB.emoji }}</span>
            <span v-if="teamB.giftFilter" class="trigger-chip">🎁 {{ giftLabel(teamB.giftFilter) }}</span>
          </div>
          <div class="team-score-num">{{ teamB.score }}</div>
          <div class="team-stats-small">{{ teamB.commentCount }} تعليق | {{ teamB.giftCount }} هدية</div>
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

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة شد الحبل 🪢</h2>
      <ul class="rules-list">
        <li><b>الفرق:</b> يحدد المستضيف إيموجي واسم لكل فريق قبل بدء الجولة (افتراضياً 🔴 و🔵)</li>
        <li><b>السحب بالتعليقات:</b> أي مشاهد يكتب إيموجي فريقه بالدردشة يضيف نقطة واحدة لفريقه فوراً</li>
        <li><b>السحب بالهدايا:</b> يختار المستضيف زوج هدايا متساوي بالقيمة بالكوينز من قائمة منسدلة (هدية للفريق 🔴 وأخرى بنفس القيمة بالضبط للفريق 🔵) — أي هدية تطابق اسم هدية فريقها تضيف نقاط بونص إضافية لنفس الفريق فقط</li>
        <li><b>الحبل:</b> يتحرك المؤشر بالوقت الفعلي نحو الفريق صاحب النقاط الأكثر، وكل نقطة تُحتسب لحظياً بدون تأخير</li>
        <li><b>الفوز الفوري:</b> لو وصل الفرق بالنقاط بين الفريقين للرقم المحدد قبل نهاية الوقت، تنتهي الجولة فوراً بفوز الفريق المتقدم</li>
        <li><b>نهاية الوقت:</b> لو انتهى العداد بدون فوز فوري، يفوز الفريق صاحب النقاط الأعلى في تلك اللحظة (تعادل لو تساووا)</li>
        <li><b>السلسلة:</b> تُحفظ نتيجة كل جولة (عدد الجولات المكسوبة لكل فريق) حتى تضغط "إعادة اللعبة بالكامل"</li>
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

.team-config-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.team-config-row .emoji-input { width: 70px; flex: none; text-align: center; font-size: 1.3rem; }
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

.team-triggers {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
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
