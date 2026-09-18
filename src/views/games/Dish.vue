<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { BRIDGE_URL } from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const SCORES_KEY = 'whatsTheDishGame_scores';

const DISHES = [
  { name: 'كبسة', ingredients: ['أرز بسمتي', 'دجاج', 'بصل', 'طماطم', 'بهارات كبسة'] },
  { name: 'مندي', ingredients: ['أرز', 'لحم غنم', 'سمن', 'هيل', 'زعفران'] },
  { name: 'كنافة', ingredients: ['عجينة كنافة', 'جبن', 'سمن', 'قطر', 'فستق'] },
  { name: 'بيتزا', ingredients: ['عجينة', 'صلصة طماطم', 'جبن موزاريلا', 'فلفل رومي', 'زيتون'] },
  { name: 'برجر', ingredients: ['خبز برجر', 'لحم مفروم', 'جبن', 'خس', 'طماطم'] },
  { name: 'حمص', ingredients: ['حمص مسلوق', 'طحينة', 'ليمون', 'ثوم', 'زيت زيتون'] },
  { name: 'تبولة', ingredients: ['برغل', 'بقدونس', 'طماطم', 'ليمون', 'نعناع'] },
  { name: 'شاورما', ingredients: ['خبز صاج', 'لحم أو دجاج', 'ثوم', 'بطاطا مقلية', 'مخلل'] },
  { name: 'فلافل', ingredients: ['حمص', 'بقدونس', 'ثوم', 'كزبرة', 'كمون'] },
  { name: 'مقلوبة', ingredients: ['أرز', 'باذنجان', 'دجاج', 'صنوبر', 'بهارات مشكلة'] },
  { name: 'سوشي', ingredients: ['أرز', 'نوري (عشب بحري)', 'سمك', 'خل الأرز', 'خيار'] },
  { name: 'مسقعة', ingredients: ['باذنجان', 'لحم مفروم', 'طماطم', 'بصل', 'ثوم'] },
  { name: 'ملوخية', ingredients: ['ملوخية', 'ثوم', 'دجاج', 'كزبرة', 'ليمون'] },
  { name: 'جريش', ingredients: ['جريش', 'لحم', 'بصل', 'ثوم', 'بهارات'] },
  { name: 'مطبق', ingredients: ['عجينة رقيقة', 'بيض', 'بصل', 'لحم مفروم', 'كاري'] },
  { name: 'باستا الفريدو', ingredients: ['معكرونة', 'كريمة', 'جبن بارميزان', 'زبدة', 'ثوم'] },
  { name: 'سمبوسة', ingredients: ['عجينة رقيقة', 'لحم مفروم أو جبن', 'بصل', 'بقدونس', 'بهارات'] },
  { name: 'كباب', ingredients: ['لحم مفروم', 'بصل', 'بقدونس', 'بهارات', 'فحم للشوي'] },
  { name: 'سلطة سيزر', ingredients: ['خس', 'دجاج مشوي', 'جبن بارميزان', 'خبز محمص', 'صلصة سيزر'] },
  { name: 'رامن', ingredients: ['نودلز', 'مرقة', 'بيضة مسلوقة', 'لحم أو دجاج', 'بصل أخضر'] },
  { name: 'متبل', ingredients: ['باذنجان مشوي', 'طحينة', 'ثوم', 'ليمون', 'رمان'] },
  { name: 'فتوش', ingredients: ['خس', 'خبز محمص', 'فجل', 'نعناع', 'سماق'] },
  { name: 'كشري', ingredients: ['أرز', 'عدس', 'مكرونة', 'بصل مقرمش', 'صلصة طماطم وخل'] },
  { name: 'ورق عنب', ingredients: ['ورق عنب', 'أرز', 'طماطم', 'بقدونس', 'ليمون'] },
  { name: 'بامية', ingredients: ['بامية', 'لحم', 'طماطم', 'بصل', 'ثوم'] },
  { name: 'فول مدمس', ingredients: ['فول', 'ثوم', 'ليمون', 'كمون', 'زيت زيتون'] },
  { name: 'كبة', ingredients: ['برغل', 'لحم مفروم', 'بصل', 'صنوبر', 'بهارات'] },
  { name: 'تشيز كيك', ingredients: ['بسكويت', 'جبن كريمي', 'زبدة', 'سكر', 'فراولة'] },
  { name: 'آيس كريم', ingredients: ['حليب', 'كريمة', 'سكر', 'فانيليا', 'بيض'] },
  { name: 'دجاج بروستد', ingredients: ['دجاج', 'طحين', 'بيض', 'بهارات', 'زيت للقلي'] },
  { name: 'شكشوكة', ingredients: ['بيض', 'طماطم', 'بصل', 'فلفل', 'كمون'] },
  { name: 'بطاطس بالجبن', ingredients: ['بطاطس', 'جبن', 'بيكون', 'بصل أخضر', 'صوص'] },
  { name: 'تاكو', ingredients: ['خبز تورتيلا', 'لحم مفروم', 'خس', 'جبن', 'صلصة'] },
  { name: 'سباغيتي بولونيز', ingredients: ['سباغيتي', 'لحم مفروم', 'صلصة طماطم', 'بصل', 'جبن بارميزان'] },
  { name: 'محشي كوسا', ingredients: ['كوسا', 'أرز', 'لحم مفروم', 'طماطم', 'بقدونس'] },
  { name: 'حلاوة الجبن', ingredients: ['جبن', 'سميد', 'قطر', 'سمن', 'ماء زهر'] },
  { name: 'لقيمات', ingredients: ['طحين', 'خميرة', 'زيت للقلي', 'قطر', 'سمسم'] },
  { name: 'برياني', ingredients: ['أرز بسمتي', 'دجاج أو لحم', 'زعفران', 'بهارات برياني', 'بصل مقرمش'] },
];
const TIER_POINTS = [25, 20, 15, 10, 5];
const WIN_BONUS = 5;
const MAX_WINNERS_PER_ROUND = 3;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function normalizeText(raw) {
  let s = String(raw).trim().replace(/\s+/g, ' ');
  s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  s = s.replace(/^ال/, '');
  return s.trim();
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

const usedDishIndices = new Set();
const hasGameStarted = ref(false);
const gamePhase = ref('idle'); // idle | playing | round-ended
const roundNumber = ref(0);
const currentDish = ref(null);
const revealedCount = ref(1);
const correctGuessers = ref([]); // [{name, rank, points, revealedAt}]
let ingredientDuration = 20;
const timeLeft = ref(0);
let tickTimer = null;
const eventLog = ref([]);

const ingredientDurationInput = ref(20);
const manualGuessName = ref('');
const manualGuessText = ref('');

const durationHint = computed(() => `كل مكون يظهر ${getIngredientDuration(false)} ثانية قبل ظهور المكون التالي`);
function getIngredientDuration(clamp = true) {
  let val = parseInt(ingredientDurationInput.value, 10);
  if (Number.isNaN(val) || val < 5) val = 5;
  if (val > 120) val = 120;
  if (clamp) ingredientDurationInput.value = val;
  return val;
}

function pickNextDish() {
  if (usedDishIndices.size >= DISHES.length) {
    usedDishIndices.clear();
    appendLog('<div class="log-item" style="color:#8b93a3;">🍽️ تم استخدام كل أطباق المكتبة — بدأت الدورة من جديد</div>');
  }
  const available = DISHES.map((d, i) => i).filter((i) => !usedDishIndices.has(i));
  const index = available[Math.floor(Math.random() * available.length)];
  usedDishIndices.add(index);
  const dish = DISHES[index];
  return { name: dish.name, ingredients: shuffleArray([...dish.ingredients]) };
}

function startGame() {
  if (gamePhase.value !== 'idle') return;
  hasGameStarted.value = true;
  beginRound();
}

function nextDish() {
  if (gamePhase.value !== 'round-ended') return;
  beginRound();
}

function beginRound() {
  roundNumber.value++;
  currentDish.value = pickNextDish();
  revealedCount.value = 1;
  correctGuessers.value = [];
  ingredientDuration = getIngredientDuration();
  timeLeft.value = ingredientDuration;
  gamePhase.value = 'playing';

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🍽️ الجولة ${roundNumber.value}: طبق جديد — أول مكون: ${escapeHtml(currentDish.value.ingredients[0])}</div>`);

  startTicker();
}

function startTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      if (revealedCount.value < 5) {
        revealedCount.value++;
        timeLeft.value = ingredientDuration;
        appendLog(`<div class="log-item">👀 ظهر المكون رقم ${revealedCount.value}: ${escapeHtml(currentDish.value.ingredients[revealedCount.value - 1])}</div>`);
      } else {
        finalizeRound();
      }
    }
  }, 1000);
}

function handleGuess(username, rawText) {
  if (gamePhase.value !== 'playing' || !username || !rawText) return;
  if (normalizeText(rawText) !== normalizeText(currentDish.value.name)) return;
  if (correctGuessers.value.some((g) => g.name === username)) return;

  const rank = correctGuessers.value.length + 1;
  const tier = TIER_POINTS[revealedCount.value - 1];
  const bonus = rank === 1 ? WIN_BONUS : 0;
  const points = tier + bonus;

  const player = getOrCreatePlayer(username);
  player.score += points;
  saveScores();

  correctGuessers.value.push({
    name: username, rank, points, revealedAt: revealedCount.value,
  });

  const bonusTxt = bonus > 0 ? ` + ${bonus} مكافأة أولية` : '';
  appendLog(`<div class="log-item log-hit">✅ الترتيب #${rank}: <b>${escapeHtml(username)}</b> جاوب صح على المكون ${revealedCount.value} — ${tier} نقطة${bonusTxt} = ${points} نقطة</div>`);

  if (correctGuessers.value.length >= MAX_WINNERS_PER_ROUND) {
    finalizeRound();
  }
}

function manualGuess() {
  if (gamePhase.value !== 'playing') return;
  const name = manualGuessName.value.trim();
  const text = manualGuessText.value.trim();
  if (name === '' || text === '') return;
  handleGuess(name, text);
  manualGuessText.value = '';
}

function finalizeRound() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  gamePhase.value = 'round-ended';

  if (correctGuessers.value.length === 0) {
    appendLog(`<div class="log-item log-miss">😅 ما أحد عرف الطبق — الطبق كان: <b>${escapeHtml(currentDish.value.name)}</b></div>`);
  } else {
    const namesList = correctGuessers.value.map((g) => `${escapeHtml(g.name)} (+${g.points})`).join('، ');
    appendLog(`<div class="log-item log-hit">🏆 انتهت الجولة! الطبق كان "<b>${escapeHtml(currentDish.value.name)}</b>" — ${namesList}</div>`);
  }
}

function resetScores() {
  playersScores.clear();
  saveScores();
  appendLog('<div class="log-item" style="text-align:center; color:#8b93a3;">🔄 صُفِّرت لوحة الصدارة</div>');
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const dishStatusText = computed(() => {
  if (gamePhase.value === 'idle') {
    return hasGameStarted.value ? 'اضغط "الطبق التالي" من لوحة التحكم العائمة للمتابعة' : 'اضغط "بدء اللعبة" من لوحة التحكم العائمة';
  }
  if (gamePhase.value === 'playing') {
    const remaining = MAX_WINNERS_PER_ROUND - correctGuessers.value.length;
    return `🕵️ خمّن اسم الطبق بالدردشة! (باقي ${remaining} من ${MAX_WINNERS_PER_ROUND} فرص للفوز بهذي الجولة)`;
  }
  return 'انتهت الجولة — اضغط "الطبق التالي" من لوحة التحكم العائمة للمتابعة';
});

const ingredientChips = computed(() => {
  if (!currentDish.value) {
    return Array.from({ length: 5 }, (_, i) => ({ num: i + 1, revealed: false, text: '❓' }));
  }
  return currentDish.value.ingredients.map((ing, i) => ({
    num: i + 1, revealed: i < revealedCount.value, text: i < revealedCount.value ? ing : '❓',
  }));
});

const progressVisible = computed(() => gamePhase.value === 'playing');
const progressUrgent = computed(() => timeLeft.value <= 5);
const progressPct = computed(() => Math.max(0, Math.min(100, (timeLeft.value / ingredientDuration) * 100)));

const roundResultClass = computed(() => {
  if (gamePhase.value !== 'round-ended' || !currentDish.value) return '';
  return correctGuessers.value.length === 0 ? 'is-fail' : 'is-win';
});
const roundResultHtml = computed(() => {
  if (gamePhase.value !== 'round-ended' || !currentDish.value) return '';
  if (correctGuessers.value.length === 0) {
    return `😅 ما أحد عرف — الطبق كان "${escapeHtml(currentDish.value.name)}"`;
  }
  const breakdown = correctGuessers.value.map((g) => `#${g.rank} ${escapeHtml(g.name)} (+${g.points})`).join(' &nbsp;|&nbsp; ');
  return `🏆 الطبق كان "${escapeHtml(currentDish.value.name)}"<br><span style="font-size:0.85rem;">${breakdown}</span>`;
});

const manualPanelVisible = computed(() => gamePhase.value === 'playing');
const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score).slice(0, 5));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const hfStartVisible = computed(() => gamePhase.value === 'idle' && !hasGameStarted.value);
const hfNextVisible = computed(() => gamePhase.value === 'round-ended');

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
  trackConnectRequest('dish', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) handleGuess(data.user, data.comment);
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: الجمهور يكتب اسم الطبق بالدردشة للتخمين</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label for="ingredientDurationInput">⏱️ مدة عرض كل مكون بالثواني (يحددها المستضيف):</label>
    <div class="round-time-row">
      <input v-model="ingredientDurationInput" type="number" min="5" max="120">
      <div class="field-hint" style="margin-top:0;">{{ durationHint }}</div>
    </div>
  </div>

  <h1>🍽️ شنو الطبق؟</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🎥 شاشة العرض (OBS)</h2>
      <div class="dish-status-line">{{ dishStatusText }}</div>

      <div class="ingredients-row">
        <div v-for="chip in ingredientChips" :key="chip.num" class="ingredient-chip" :class="{ revealed: chip.revealed }">
          <span class="ing-num">{{ chip.num }}</span>{{ chip.text }}
        </div>
      </div>

      <div v-if="progressVisible" class="progress-wrap" style="display:flex;">
        <div class="progress-timer" :class="{ urgent: progressUrgent }">{{ timeLeft }}</div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" :style="{ width: progressPct + '%', transition: 'none' }"></div>
        </div>
      </div>

      <div v-if="gamePhase === 'playing' && correctGuessers.length > 0" class="correct-guessers-row" style="display:flex;">
        <span v-for="g in correctGuessers" :key="g.name" class="guesser-chip"><span class="gc-rank">#{{ g.rank }}</span>{{ g.name }} ✅</span>
      </div>

      <div class="round-result-line" :class="roundResultClass" v-html="roundResultHtml"></div>
    </div>

    <div v-if="manualPanelVisible" class="panel" style="display:flex;">
      <h3>✍️ تخمين يدوي (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualGuessName" type="text" placeholder="اسم اللاعب">
        <input v-model="manualGuessText" type="text" placeholder="تخمين اسم الطبق" @keydown.enter.prevent="manualGuess">
        <button class="master-btn" @click="manualGuess">إرسال</button>
      </div>
    </div>

    <div class="panel">
      <h2>🏆 لوحة الصدارة (أفضل 5)</h2>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-top1': i === 0 }">
          <span><span class="lb-rank">{{ rankFor(i) }}</span>{{ p.name }}</span>
          <span>{{ p.score }} نقطة</span>
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

  <div class="host-float-panel">
    <div class="hf-title">🎛️ لوحة تحكم المستضيف</div>
    <button v-if="hfStartVisible" class="master-btn" id="hfStartBtn" @click="startGame">▶️ بدء اللعبة</button>
    <button v-if="hfNextVisible" class="master-btn" id="hfNextBtn" @click="nextDish">⏭️ الطبق التالي</button>
    <button class="master-btn" id="hfResetScoresBtn" @click="resetScores">🔄 تصفير النقاط</button>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة شنو الطبق؟ 🍽️</h2>
      <ul class="rules-list">
        <li><b>الفكرة:</b> تُعرض مكونات طبق واحد تدريجياً، مكون جديد كل فترة زمنية يحددها المستضيف (افتراضياً 20 ثانية)، وكل طبق له 5 مكونات بالضبط — وترتيب ظهور المكونات يتغير عشوائياً كل مرة حتى لو تكرر نفس الطبق</li>
        <li><b>التخمين:</b> يكتب المشاهد اسم الطبق بالدردشة، وتستمر الجولة حتى يجاوب 3 أشخاص صحيح (أو تنتهي المكونات كلها)</li>
        <li><b>أثناء الجولة:</b> أول ما يجاوب أحد صحيح يظهر اسمه فقط (بدون كشف اسم الطبق) عشان الباقين يقدرون يواصلون التخمين بعدالة</li>
        <li><b>النقاط التنازلية:</b> تخمين صحيح خلال المكون 1️⃣ = 25 نقطة، 2️⃣ = 20، 3️⃣ = 15، 4️⃣ = 10، 5️⃣ = 5 نقطة، حسب المكون الظاهر وقت الإجابة لكل لاعب على حدة</li>
        <li><b>مكافأة الأولية:</b> أول شخص يجاوب صحيح بالجولة (الترتيب #1) ياخذ +5 نقاط إضافية فوق نقاط المكون الظاهر وقتها</li>
        <li><b>نهاية الجولة:</b> بعد اكتمال 3 إجابات صحيحة، أو انتهاء كل الـ5 مكونات بدون اكتمال العدد، يُكشف اسم الطبق مع كل من جاوب صحيح ونقاطه</li>
        <li><b>لوحة الصدارة:</b> النقاط تتجمع لنفس اسم اللاعب عبر كل الجولات، وتظهر أفضل 5 لاعبين</li>
        <li>يقدر المستضيف يضغط "الطبق التالي" من لوحة التحكم العائمة بعد كل جولة للمتابعة، أو "تصفير النقاط" لتصفير لوحة الصدارة بدون إيقاف اللعبة</li>
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

input:focus, select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.round-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.round-time-row input {
  width: 90px;
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

.dish-status-line {
  text-align: center;
  font-size: 0.95rem;
  color: #ccd6e0;
  margin-bottom: 14px;
  min-height: 1.3em;
}

.ingredients-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  width: 100%;
  margin-bottom: 16px;
}

.ingredient-chip {
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 12px 16px;
  min-width: 90px;
  text-align: center;
  font-weight: bold;
  font-size: 0.95rem;
}

.ingredient-chip.revealed {
  border-color: var(--primary-color);
  background: rgba(243,156,18,0.15);
  color: #ffe6b3;
  box-shadow: 0 0 10px var(--border-glow);
}

.ingredient-chip .ing-num {
  display: block;
  font-size: 0.7rem;
  color: #8b93a3;
  margin-bottom: 4px;
}

.ingredient-chip.revealed .ing-num { color: var(--primary-color); }

.progress-wrap {
  width: 100%;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.progress-timer {
  font-size: 1.4rem;
  font-weight: bold;
  color: #ffa502;
  min-width: 46px;
  text-align: center;
}

.progress-timer.urgent { color: #ff4757; }

.progress-bar-track {
  flex: 1;
  height: 14px;
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--secondary-color), var(--primary-color));
  border-radius: 8px;
}

.correct-guessers-row {
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  width: 100%;
  margin-bottom: 10px;
}

.guesser-chip {
  background: rgba(46, 204, 113, 0.15);
  border: 1px solid var(--success-color);
  color: #d5f5e3;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: bold;
}

.guesser-chip .gc-rank { color: var(--primary-color); margin-left: 4px; }

.round-result-line {
  text-align: center;
  font-size: 1.05rem;
  font-weight: bold;
  min-height: 1.6em;
  width: 100%;
  margin-bottom: 4px;
}

.round-result-line.is-win { color: #2ecc71; }
.round-result-line.is-fail { color: #ff4757; }

.manual-add-row { display: flex; gap: 5px; width: 100%; flex-wrap: wrap; margin-top: 10px; }
.manual-add-row input { flex: 1; min-width: 120px; }
.manual-add-row button { flex: none; padding: 8px 15px; font-size: 0.9rem; }

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
.leaderboard-item.is-top1 { background: #f39c12; color: #1e1e2f; font-weight: bold; }

.event-log-panel {
  width: 100%;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.event-log-panel :deep(.log-miss) { border-right: 4px solid var(--danger-color); }

.footer-note { padding: 15px; font-size: 0.85rem; }

.host-float-panel {
  position: fixed;
  bottom: 14px;
  left: 14px;
  background: rgba(30, 30, 47, 0.95);
  border: 1px solid var(--border-glow);
  border-radius: 14px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 150;
  box-shadow: 0 6px 20px rgba(0,0,0,0.55);
  backdrop-filter: blur(8px);
  width: 160px;
}

.host-float-panel .hf-title {
  font-size: 0.68rem;
  color: #8b93a3;
  text-align: center;
  margin-bottom: 2px;
}

.host-float-panel button {
  font-size: 0.82rem;
  padding: 9px 10px;
  white-space: nowrap;
  width: 100%;
}

#hfStartBtn { background: var(--success-color); }
#hfNextBtn { background: #3498db; }
#hfResetScoresBtn { background: var(--danger-color); }
</style>
