<script setup>
import RegistrationHub from '../../components/RegistrationHub.vue';
import { useFloatingBar } from '../../utils/useFloatingBar';
import { avatarOrLogo } from '../../utils/gameLogo';
import {
  ref, reactive, computed, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import { useSettingsOverlay } from '../../utils/useSettingsOverlay';
import { useRegistration } from '../../utils/useRegistration';
import { normalizeDigits, isLeaveComment } from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler,
  isChatMode, setJoinHandler, getUserAvatar,
  displayName,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';
import { nameHtml } from '../../utils/nameHtml';
import { topScorerNames, celebrateGameWin } from '../../utils/gameWin';

const router = useRouter();

const SOURCE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#fd79a8', '#00cec9', '#fdcb6e'];
const MEDALS = ['🥇', '🥈', '🥉'];

// ===== أصوات اللعبة (نغمات مولّدة عبر Web Audio API، بدون ملفات خارجية) =====
const soundEnabled = ref(true);
let audioCtx = null;
function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq, duration, type, volume, endFreq, delay = 0) {
  if (!soundEnabled.value) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (e) { /* الصوت غير متاح بهذا المتصفح أو قبل أول تفاعل من المستخدم */ }
}
function playTickSound() { playTone(700, 0.08, 'square', 0.05); }
// خرير الماي وهو يتدفق بالأنابيب
function playFlowSound(seconds) {
  playTone(160, seconds, 'sine', 0.07, 480);
  for (let t = 0; t < seconds; t += 0.22) playTone(500 + Math.random() * 500, 0.06, 'sine', 0.04, 250, t);
}
function playPopSound(kind) {
  if (kind === 'bomb') playTone(140, 0.5, 'sawtooth', 0.14, 40);
  else if (kind === 'silver') [660, 880].forEach((f, i) => playTone(f, 0.12, 'triangle', 0.12, null, i * 0.07));
  else playTone(900, 0.1, 'triangle', 0.1, 1300);
}
function playWinSound() {
  [523, 659, 784, 1047].forEach((f, i) => playTone(f, 0.22, 'triangle', 0.18, null, i * 0.12));
}

// ===== الصعوبة (يختارها المستضيف: عدد الأنابيب + أي صعوبات يبيها) =====
// الأصل دايماً موجود: "حائط الطوب" (كل طبقة تبادل الأنابيب المتجاورة (0,1)(2,3).. أو (1,2)(3,4).. بالتناوب)
// + الجسور (كل تقاطع يختار عشوائياً مين يمر فوق ومين تحت، فما تقدر تعتمد على ترتيب ثابت).
// بالأصل كل أنبوب يتحرك بـ 3 اتجاهات بس: تحت، تحت يمين، تحت يسار.
// قفزات: بعض الطبقات فيها أنبوبان يتبادلان على مسافة 3 مسارات ويعبرون فوق اللي بينهم
// صعود ونزول: طبقات إضافية بين طبقات التشابك، فيها كل أنبوب يتحرك بـ 7 اتجاهات
//   (يضيف يمين، يسار، فوق يمين، فوق يسار) — ينزل ثم يطلع لفوق ويغيّر مساره
// ضباب: بقع تغطي أجزاء من الشبكة وتنقشع وحدة وحدة مع الوقت
const PIPE_COUNTS = [4, 5, 6, 7, 8, 9, 10];
const pipeCount = ref(6);
const useJumps = ref(false);
const useUpDown = ref(false);
const useFog = ref(false);

// كل أنبوب = 5 نقاط للكأس، وكل صعوبة مفعّلة تزيد 5
const roundConfig = computed(() => {
  const n = pipeCount.value;
  return {
    n,
    layers: Math.min(9, Math.max(5, n)),
    points: 5 * n + 5 * [useJumps.value, useUpDown.value, useFog.value].filter(Boolean).length,
    jump: useJumps.value ? 0.45 : 0,
    upDown: useUpDown.value,
    laneGap: useUpDown.value ? UPDOWN_LANE_GAP : GEO.laneGap,
    fog: useFog.value ? (n >= 8 ? 3 : 2) : 0,
    bombs: n >= 7 ? 2 : 1,
  };
});

function configFeatures(cfg) {
  return [
    `${cfg.n} أنابيب`,
    cfg.jump > 0 ? 'قفزات' : '',
    cfg.upDown ? 'صعود ونزول' : '',
    cfg.fog > 0 ? 'ضباب' : '',
  ].filter(Boolean).join(' · ');
}

// نهايات الأنابيب: كأس واحد، فضية وحدة، قنابل، والباقي عملات — كلها ظاهرة للاعبين وقت الاختيار
const ENDING_ICONS = {
  gold: '🏆', silver: '🥈', coin: '🪙', bomb: '💣',
};
function endingValue(kind, points) {
  if (kind === 'gold') return points;
  if (kind === 'silver') return Math.round(points / 2);
  if (kind === 'bomb') return -Math.round(points / 2);
  return Math.round(points / 5);
}

// ===== نقاط السرعة =====
// الجائزة كاملة لأسرع إجابة وتنزل لين 40% منها بآخر ثانية — اللي ينتظر عشان ينسخ من الدردشة ياخذ أقل.
// القنبلة تخصم كاملة بدون تأثير للسرعة.
const SPEED_MIN = 0.4;

// ===== نقاط الفوز (اختيارية — الخانة الفاضية = لعب مفتوح بدون حد) =====
const winScoreInput = ref('');
function getWinScore() {
  const val = parseInt(winScoreInput.value, 10);
  return Number.isNaN(val) || val < 1 ? null : val;
}
// يضيف النقاط للاعب (والرصيد ما ينزل تحت الصفر) ويرجّع true لو وصل لنقاط الفوز بهذي الإضافة
function addPoints(player, points) {
  const winScore = getWinScore();
  const wasBelow = winScore !== null && player.score < winScore;
  player.score = Math.max(0, player.score + points);
  return wasBelow && player.score >= winScore;
}
function gameWinHtml(names) {
  return `<div style="text-align:center; font-size:16px; color:var(--primary-color); background:var(--ink-color); padding:12px; border-radius:10px; margin-top:6px;">🏆 وصل لنقاط الفوز (${getWinScore()}) وفاز باللعبة: <b>${names.map((n) => nameHtml(n)).join('، ')}</b> 🏆</div>`;
}

// السجل ما يُحفظ بين الجلسات: الخروج من اللعبة يمسح النقاط
const totalScores = reactive(new Map());
function getOrCreatePlayerScore(name) {
  if (!totalScores.has(name)) totalScores.set(name, reactive({ name, score: 0 }));
  return totalScores.get(name);
}

// الفوز ينهي اللعبة: ما تبدأ جولة جديدة لين "إعادة اللعبة"
const gameOver = ref(false);
function blockIfGameOver() {
  if (!gameOver.value) return false;
  openModal('🏆 انتهت اللعبة', ['<div class="log-item" style="text-align:center;">🏆 انتهت اللعبة بفوز لاعب — اضغط "🏁 إنهاء اللعبة وعرض النتائج" للبدء من جديد.</div>']);
  return true;
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

const {
  registrationLocked, masterPlayersList, newPlayerName,
  joinKeyInput, joinViaGift, giftNameFilter, selectedGiftLabel, getJoinKey, joinKeyHint,
  registrationOpen, registrationUnlimited, registrationTimeLeft, registrationDurationInput, extendSecondsInput, registrationStatusHint,
  startRegistration, extendRegistration, stopRegistration,
  addPlayer, removePlayer, clearPlayers, addPlayerFromLive, removeFromList, hasPlayer, handleJoinMessage,
  playersModalVisible, openPlayersModal, closePlayersModal,
  resetRegistration, disposeRegistration,
} = useRegistration({
  onDuplicate: (name) => openModal('تنبيه', [`<div class="log-item">الاسم "${nameHtml(name)}" موجود مسبقاً في القائمة!</div>`]),
});

const players = reactive(new Map()); // name -> { name, avatar }
const eventLog = ref([]);

// مشاركة الجميع: أي مشاهد يكتب رقم وقت الاختيار ينضم تلقائياً بدون تسجيل مسبق
const openPlay = ref(false);
const startBtnLabel = computed(() => (openPlay.value ? '🚀 بدء اللعب' : '🔒 قفل التسجيل'));

function lockRegistration() {
  if (registrationLocked.value) return;
  if (!openPlay.value && masterPlayersList.length < 1) {
    openModal('تنبيه', ['<div class="log-item">تحتاج تسجيل لاعب واحد على الأقل قبل قفل التسجيل — أو فعّل "مشاركة الجميع" من الإعدادات!</div>']);
    return;
  }
  players.clear();
  masterPlayersList.forEach((p) => players.set(p.name, { name: p.name, avatar: p.avatar }));
  registrationLocked.value = true;
  stopRegistration();
  appendLog(openPlay.value
    ? '<div class="log-item" style="text-align:center; color:var(--success-light);">👥 مشاركة الجميع مفعّلة — أي أحد يكتب رقم وقت الجولة يدخل السباق!</div>'
    : `<div class="log-item" style="text-align:center; color:var(--success-light);">🔒 أُقفل التسجيل بـ ${players.size} لاعب — جاهزين للسباق!</div>`);
}

// ===== توليد شبكة الأنابيب =====
// مصادر بأعمدة متوازية أعلى الشاشة تتشابك عبر طبقات أفقية نزولاً لصف نهايات أسفل الشاشة.
// كل أنبوب مقسوم لمقاطع (مقطع لكل طبقة) عشان كل تقاطع يقدر يختار مين فوق ومين تحت،
// وعشان الماي يتدفق مقطع مقطع بنفس السرعة بكل الأنابيب وقت الكشف.
const GEO = {
  marginX: 42, laneGap: 64, topY: 78, layerH: 58,
};
const laneX = (lane, gap = GEO.laneGap) => GEO.marginX + lane * gap;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const range = (n) => Array.from({ length: n }, (_, i) => i);

// حائط الطوب: احتمال عالٍ للتبديل (لا 100% حتى يختلف الشكل بين الجولات)
function brickPairs(n, layerIdx) {
  const pairs = [];
  for (let a = layerIdx % 2; a + 1 < n; a += 2) {
    if (Math.random() < 0.82) pairs.push([a, a + 1]);
  }
  return pairs;
}

// قفزات بعيدة: أنبوبان يتبادلان على مسافة 3 مسارات والأنبوبين اللي بينهم يكملون مستقيم.
// المسافة فردية دايماً عشان نقطة تقاطع القفزة تجي بين مسارين، مو فوق أنبوب مستقيم
// (التقاطع الثلاثي بنفس النقطة يخلي التتبع مستحيل). مدى القفزة محجوز كامل فما تتداخل قفزتين.
const JUMP_DIST = 3;
function jumpPairs(n) {
  const free = new Set(range(n));
  const pairs = [];
  const maxJumps = Math.max(1, Math.floor(n / 4));
  for (const a of shuffle(range(n - JUMP_DIST))) {
    if (pairs.length >= maxJumps) break;
    const span = range(JUMP_DIST + 1).map((k) => a + k);
    if (!span.every((x) => free.has(x))) continue;
    span.forEach((x) => free.delete(x));
    pairs.push([a, a + JUMP_DIST]);
  }
  for (let a = 0; a + 1 < n; a++) {
    if (free.has(a) && free.has(a + 1) && Math.random() < 0.5) {
      free.delete(a);
      free.delete(a + 1);
      pairs.push([a, a + 1]);
    }
  }
  return pairs;
}

// ===== طبقات الصعود والنزول =====
// تنضاف بين طبقات التشابك العادية (ما تستبدلها، عشان الشبكة تبقى كثيفة ومتحدية).
// بطبقة الصعود كل زوج أنابيب متجاورة يتبادل: الأنبوب الأول ينزل بمساره، يلف تحت ويطلع لفوق مسافة طويلة
// (≈ طبقة كاملة) بعمود الفراغ، يلف فوق وينزل بمسار جاره. الجار يطلع من مساره من فوق، ينزل بعمود ثاني
// بالفراغ، ويقطع الأول عند قاع لفته (جسر)، ثم يكمل لمسار الأول. بهالمسافة نحتاج فراغ أعرض بين الأنابيب،
// فوضع الصعود والنزول يوسّع المسافة بين المسارات (UPDOWN_LANE_GAP).
// x داخل الزوج: 0 = المسار اليسار، gap/4 = عمود الجار، gap/2 = عمود الصعود، gap = المسار اليمين.
const UPDOWN_LANE_GAP = 104;
const CLIMB_TOP = 84; // مكان قمة الصعود من بداية الطبقة (فوقها يمر الجار)

function climbLayerHeight(gap, rise) { return CLIMB_TOP + rise + gap / 4 + 60; }

function climbPair(xl, y0, gap, rise, mirror) {
  const r = gap / 4;
  const yT = y0 + CLIMB_TOP;
  const yB = yT + rise;
  const y2 = yB + r + 20; // تحت قاع اللفة، الجار يبدأ يرجع لمسار الأول
  const yEnd = y0 + climbLayerHeight(gap, rise);
  const X = (x) => (mirror ? xl + gap - x : xl + x);
  const down = mirror ? 1 : 0; // اتجاه الدوران للفّة اللي تحت (يقلب مع المرآة)
  const over = mirror ? 0 : 1;
  return {
    climber: `M ${X(0)} ${y0} L ${X(0)} ${yB} A ${r} ${r} 0 0 ${down} ${X(2 * r)} ${yB} L ${X(2 * r)} ${yT} A ${r} ${r} 0 0 ${over} ${X(gap)} ${yT} L ${X(gap)} ${yEnd}`,
    partner: `M ${X(gap)} ${y0} C ${X(gap)} ${y0 + 26}, ${X(r)} ${y0 + 26}, ${X(r)} ${y0 + 52} L ${X(r)} ${y2} C ${X(r)} ${y2 + 20}, ${X(0)} ${y2 + 20}, ${X(0)} ${yEnd}`,
  };
}

function attemptBuild(cfg) {
  const { n, layers, laneGap } = cfg;
  const lx = (lane) => laneX(lane, laneGap);
  const currentLane = range(n);
  const crossCount = range(n).map(() => 0);
  const segments = [];

  let y = GEO.topY;
  let t = 0; // وقت بداية تدفق الماي بالطبقة الحالية
  let climbs = 0;
  // طبقة الصعود طويلة (≈ 4 طبقات) فتاخذ مكان 3 طبقات من العدد الكلي، ومضمون تطلع وحدة على الأقل
  for (let L = 0; L < layers; L++) {
    const roomForClimb = L >= 1 && L <= layers - 3;
    const isClimb = cfg.upDown && roomForClimb && (Math.random() < 0.35 || (climbs === 0 && L === layers - 3));
    const isJump = !isClimb && Math.random() < cfg.jump;
    const pairs = isJump ? jumpPairs(n) : brickPairs(n, L);
    const rise = 50 + Math.random() * 25;
    // طبقة القفزات أطول عشان المنحنى البعيد ما يطلع مسطّح ومتشابك
    const layerH = isClimb ? climbLayerHeight(laneGap, rise) : (isJump ? GEO.layerH * 1.6 * (laneGap / GEO.laneGap) : GEO.layerH);
    const yNext = y + layerH;
    const yMid = y + layerH / 2;
    const swapMap = new Map();
    pairs.forEach(([a, b]) => { swapMap.set(a, b); swapMap.set(b, a); });

    // بطبقة الصعود: لكل زوج مرآة عشوائية (مين اللي يصعد: اليسار أو اليمين)
    const climbPath = new Map();
    if (isClimb) {
      pairs.forEach(([l, r]) => {
        const mirror = Math.random() < 0.5;
        const p = climbPair(lx(l), y, laneGap, rise, mirror);
        climbPath.set(mirror ? r : l, p.climber);
        climbPath.set(mirror ? l : r, p.partner);
      });
    }

    const dur = SEG_MS * (layerH / GEO.layerH);
    for (let i = 0; i < n; i++) {
      const from = currentLane[i];
      const x0 = lx(from);
      let d;
      if (swapMap.has(from)) {
        const to = swapMap.get(from);
        const x1 = lx(to);
        d = climbPath.get(from) || `M ${x0} ${y} C ${x0} ${yMid}, ${x1} ${yMid}, ${x1} ${yNext}`;
        currentLane[i] = to;
        crossCount[i]++;
      } else {
        d = `M ${x0} ${y} L ${x0} ${yNext}`;
      }
      segments.push({
        key: `${L}-${i}`, pipe: i, layer: L, d, z: Math.random(), delay: t, dur,
      });
    }
    if (isClimb) {
      climbs++;
      L += 2;
    }
    t += dur;
    y = yNext;
  }

  const endY = y + 34;
  for (let i = 0; i < n; i++) {
    const x = lx(currentLane[i]);
    segments.push({
      key: `end-${i}`, pipe: i, layer: layers + 1, d: `M ${x} ${y} L ${x} ${endY}`, z: i, delay: t, dur: SEG_MS,
    });
  }
  segments.sort((a, b) => a.layer - b.layer || a.z - b.z);

  // الماي يتدفق مقطع مقطع: كل الأنابيب تخلص نفس الطبقة بنفس اللحظة
  return {
    tubes: segments,
    flows: segments.map((s) => ({
      key: s.key, pipe: s.pipe, d: s.d, delay: s.delay, dur: s.dur,
    })),
    flowMs: t + SEG_MS,
    crossCount,
    finalLane: currentLane,
    endY,
  };
}

// بقع الضباب ما تغطي المصادر ولا النهايات، وكل وحدة تنقشع بوقت مختلف:
// اللي ينتظر يشوف أوضح بس ياخذ نقاط سرعة أقل
function buildFog(cfg, width, endY) {
  const top = GEO.topY + 24;
  const bottom = endY - 30;
  return range(cfg.fog).map((k) => {
    const w = cfg.laneGap * (2 + Math.random() * 1.5);
    const h = GEO.layerH * (1.6 + Math.random());
    return {
      id: k,
      x: Math.random() * Math.max(0, width - w),
      y: top + Math.random() * Math.max(0, bottom - top - h),
      w,
      h,
      clearAt: 0.35 + (k / Math.max(1, cfg.fog - 1)) * 0.4 + Math.random() * 0.05,
    };
  });
}

let networkIdCounter = 0;
function generateNetwork(cfg) {
  const { n } = cfg;
  // تحقّق يضمن ألا يبقى أي أنبوب بمسار شبه مستقيم (وإلا يُعاد التوليد من جديد)
  const minCrossings = Math.max(1, Math.floor(cfg.layers / 2) - (cfg.upDown ? 1 : 0));
  let built = attemptBuild(cfg);
  for (let attempt = 0; attempt < 40 && built.crossCount.some((c) => c < minCrossings); attempt++) {
    built = attemptBuild(cfg);
  }

  const lx = (lane) => laneX(lane, cfg.laneGap);
  const width = GEO.marginX * 2 + (n - 1) * cfg.laneGap;
  const kinds = shuffle([
    'gold', 'silver',
    ...range(cfg.bombs).map(() => 'bomb'),
    ...range(n - 2 - cfg.bombs).map(() => 'coin'),
  ]);
  const endings = kinds.map((kind, lane) => ({
    lane, kind, icon: ENDING_ICONS[kind], value: endingValue(kind, cfg.points), x: lx(lane), y: built.endY,
  }));

  return {
    id: ++networkIdCounter,
    features: configFeatures(cfg),
    n,
    tubes: built.tubes,
    flows: built.flows,
    flowMs: built.flowMs,
    sources: range(n).map((i) => ({
      id: i, x: lx(i), y: GEO.topY, color: SOURCE_COLORS[i % SOURCE_COLORS.length],
    })),
    pipeLane: built.finalLane,
    endings,
    fog: buildFog(cfg, width, built.endY),
    width,
    height: built.endY + 56,
  };
}

const endingForSource = (net, sourceId) => net.endings[net.pipeLane[sourceId]];

// ===== حالة الجولة =====
const roundPhase = ref('idle'); // idle | guessing | revealing | done
const network = ref(null);
const currentGuesses = reactive(new Map()); // name -> { num (1-based), ms منذ بداية الجولة }
const armedPlayerName = ref(null);
const roundNumber = ref(0);
const guessDurationInput = ref(30);
const roundDuration = ref(30);
const guessTimeLeft = ref(0);
let guessCountdown = null;
let roundStartedAt = 0;
const roundResults = ref([]); // [{ name, num, ms, ending, points }] مرتبة من الأعلى
const roundHistory = [];

// مراحل الكشف: الماي يتدفق بكل الأنابيب ← النهايات تنكشف من الأقل للأعلى وأنبوبها ينطفي ← يبقى أنبوب الكأس
const flowStarted = ref(false);
const outPipes = reactive(new Set());
const poppedLanes = reactive(new Set());
const resultRevealed = ref(false);
let revealTimers = [];
function later(fn, ms) { revealTimers.push(setTimeout(fn, ms)); }
function clearRevealTimers() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
}

const levelLocked = computed(() => roundPhase.value === 'guessing' || roundPhase.value === 'revealing');
// الصعوبة تنختار من نافذة الإعدادات (تنفتح عند "قفل التسجيل"، ومن زر الإعدادات لتغييرها بين الجولات)
const DIFFICULTY_TOGGLES = [
  { model: useJumps, label: '↔️ قفزات', desc: 'أنبوب يعبر فوق اثنين' },
  { model: useUpDown, label: '🎢 صعود ونزول', desc: 'ينزل ثم يطلع ويغيّر مساره' },
  { model: useFog, label: '🌫️ ضباب', desc: 'ينقشع مع الوقت' },
];
function toggleDifficulty(t) { t.model.value = !t.model.value; }

function getGuessDuration() {
  let val = parseInt(guessDurationInput.value, 10);
  if (Number.isNaN(val) || val < 25) val = 25;
  if (val > 120) val = 120;
  guessDurationInput.value = val;
  return val;
}

// مهلة تجميد قصيرة قبل بدء تدفق الماي
const REVEAL_FREEZE_MS = 600;
// مدة تدفق الماي بكل مقطع (طبقة) — كل الأنابيب تتدفق مع بعض بنفس السرعة
const SEG_MS = 320;

const goldSource = computed(() => {
  const net = network.value;
  if (!net) return -1;
  return net.sources.findIndex((s) => endingForSource(net, s.id).kind === 'gold');
});
const guessElapsedFraction = computed(() => (roundDuration.value > 0 ? 1 - guessTimeLeft.value / roundDuration.value : 1));
function fogVisible(f) { return roundPhase.value === 'guessing' && guessElapsedFraction.value < f.clearAt; }

function startNewRound() {
  if (!registrationLocked.value) return;
  if (blockIfGameOver()) return;
  if (roundPhase.value === 'guessing' || roundPhase.value === 'revealing') return;
  clearRevealTimers();
  network.value = generateNetwork(roundConfig.value);
  currentGuesses.clear();
  armedPlayerName.value = null;
  flowStarted.value = false;
  outPipes.clear();
  poppedLanes.clear();
  resultRevealed.value = false;
  roundNumber.value++;
  roundResults.value = [];
  const dur = getGuessDuration();
  roundDuration.value = dur;
  guessTimeLeft.value = dur;
  roundStartedAt = Date.now();
  roundPhase.value = 'guessing';
  appendLog(`<div class="log-item" style="text-align:center; color:var(--info-color);">🌀 الجولة ${roundNumber.value} — شبكة جديدة (${network.value.features})، أول رقم تكتبه ينحسب وكل ما كنت أسرع نقاطك أكثر!</div>`);

  if (guessCountdown) clearInterval(guessCountdown);
  guessCountdown = setInterval(() => {
    guessTimeLeft.value--;
    if (guessTimeLeft.value > 0 && guessTimeLeft.value <= 5) playTickSound();
    if (guessTimeLeft.value <= 0) {
      clearInterval(guessCountdown);
      guessCountdown = null;
      finishGuessingPhase();
    }
  }, 1000);
}

function forceEndGuessing() {
  if (roundPhase.value !== 'guessing') return;
  if (guessCountdown) { clearInterval(guessCountdown); guessCountdown = null; }
  finishGuessingPhase();
}

function finishGuessingPhase() {
  roundPhase.value = 'revealing';
  armedPlayerName.value = null;
  appendLog('<div class="log-item" style="text-align:center; color:var(--gold-color);">⚡ انتهى وقت الاختيار — الماي يتدفق بكل الأنابيب الآن!</div>');
  later(startFlow, REVEAL_FREEZE_MS);
}

function startFlow() {
  const net = network.value;
  if (!net) return;
  flowStarted.value = true;
  playFlowSound(net.flowMs / 1000);
  later(eliminateEndings, net.flowMs + 250);
}

// النهايات تنكشف وحدة وحدة من الأقل قيمة (القنابل) للأعلى، وكل أنبوب ينطفي مع نهايته لين يبقى أنبوب الكأس
function eliminateEndings() {
  const net = network.value;
  if (!net) return;
  const order = net.sources
    .map((s) => ({ pipe: s.id, ending: endingForSource(net, s.id) }))
    .filter((o) => o.ending.kind !== 'gold')
    .sort((a, b) => a.ending.value - b.ending.value);
  const stepMs = Math.min(450, 3600 / net.n);
  order.forEach((o, i) => {
    later(() => {
      outPipes.add(o.pipe);
      poppedLanes.add(o.ending.lane);
      playPopSound(o.ending.kind);
    }, i * stepMs);
  });
  later(() => {
    poppedLanes.add(net.pipeLane[goldSource.value]);
    resultRevealed.value = true;
    roundPhase.value = 'done';
    playWinSound();
    later(finalizeRoundResults, 900);
  }, order.length * stepMs + 200);
}

function pointsFor(ending, ms) {
  if (ending.value <= 0) return ending.value;
  const factor = 1 - (1 - SPEED_MIN) * Math.min(1, ms / (roundDuration.value * 1000));
  return Math.max(1, Math.round(ending.value * factor));
}
const fmtSec = (ms) => (ms / 1000).toFixed(1);

function finalizeRoundResults() {
  const net = network.value;
  if (!net) return;
  const results = [];
  currentGuesses.forEach((g, name) => {
    const ending = endingForSource(net, g.num - 1);
    results.push({
      name, num: g.num, ms: g.ms, ending, points: pointsFor(ending, g.ms),
    });
  });
  results.sort((a, b) => b.points - a.points || a.ms - b.ms);
  const gameWinners = [];
  results.forEach((r) => {
    if (addPoints(getOrCreatePlayerScore(r.name), r.points)) gameWinners.push(r.name);
  });
  roundResults.value = results;

  const logs = [];
  logs.push(`<div class="log-item" style="text-align:center; color:var(--primary-color);">🏆 الأنبوب رقم <b>${goldSource.value + 1}</b> وصل للكأس!</div>`);
  if (results.length === 0) {
    logs.push('<div class="log-item" style="color:var(--text-faint);">لا أحد اختار أنبوب هالجولة.</div>');
  }
  let rank = 0;
  results.forEach((r) => {
    const time = `خلال ${fmtSec(r.ms)}ث`;
    if (r.points > 0) {
      const mark = MEDALS[rank] || `${rank + 1}.`;
      rank++;
      logs.push(`<div class="log-item${r.ending.kind === 'gold' ? ' log-hit' : ''}">${mark} <b>${nameHtml(r.name)}</b> — أنبوب ${r.num} ${r.ending.icon} ${time} ← <b>+${r.points}</b></div>`);
    } else {
      logs.push(`<div class="log-item log-bomb">💣 <b>${nameHtml(r.name)}</b> — أنبوب ${r.num} انفجر عليه ← <b>${r.points}</b></div>`);
    }
  });
  // أكثر من لاعب تجاوز نقاط الفوز بنفس الجولة: الأعلى يفوز، وعند التعادل يتشاركون المركز
  if (gameWinners.length > 0) gameOver.value = true;
  const finalWinners = gameWinners.length > 0 ? topScorerNames(gameWinners.map((n) => getOrCreatePlayerScore(n))) : [];
  if (finalWinners.length > 0) logs.push(gameWinHtml(finalWinners));
  logs.forEach((l) => appendLog(l));
  roundHistory.push({
    roundNumber: roundNumber.value, features: net.features, goldNumber: goldSource.value + 1, results,
  });
  openModal(`نتيجة الجولة ${roundNumber.value}`, logs);
  if (finalWinners.length > 0) celebrateGameWin(finalWinners, { winScore: getWinScore() });
}

function parseGuessNumber(text, maxN) {
  const normalized = normalizeDigits(text);
  const matches = normalized.match(/\d+/g);
  if (!matches) return null;
  for (const m of matches) {
    const num = parseInt(m, 10);
    if (num >= 1 && num <= maxN) return num;
  }
  return null;
}

function recordGuess(name, num) {
  currentGuesses.set(name, { num, ms: Date.now() - roundStartedAt });
}

// أول رقم يكتبه اللاعب بس ينحسب — ما فيه تغيير بعد ما يشوف أرقام غيره بالدردشة
function registerGuessFromComment(name, rawText, avatar) {
  if (roundPhase.value !== 'guessing' || !name || !rawText) return;
  if (currentGuesses.has(name) || (!players.has(name) && !openPlay.value)) return;
  const net = network.value;
  if (!net) return;
  const num = parseGuessNumber(rawText, net.n);
  if (num === null) return;
  if (!players.has(name)) players.set(name, { name, avatar: avatar || getUserAvatar(name) });
  recordGuess(name, num);
}

function armPlayer(name) {
  if (roundPhase.value !== 'guessing') return;
  armedPlayerName.value = (armedPlayerName.value === name) ? null : name;
}
function assignGuess(sourceId) {
  if (roundPhase.value !== 'guessing' || !armedPlayerName.value) return;
  recordGuess(armedPlayerName.value, sourceId + 1);
  armedPlayerName.value = null;
}

function endAndResetGame() {
  endGame();
  resetGame();
}

function endGame() {
  if (guessCountdown) { clearInterval(guessCountdown); guessCountdown = null; }
  clearRevealTimers();
  roundPhase.value = 'idle';
  network.value = null;
  resultRevealed.value = false;

  const sorted = Array.from(totalScores.values()).sort((a, b) => b.score - a.score);
  const logs = [];
  logs.push('<div class="log-item" style="text-align:center; font-weight:bold; color:var(--primary-color);">🏁 انتهت اللعبة — النتيجة النهائية</div>');
  if (sorted.length === 0) {
    logs.push('<div class="log-item" style="color:var(--text-faint);">ما فيه أي فائزين هالمرة.</div>');
  } else {
    logs.push(...sorted.map((p, i) => `<div class="log-item">${MEDALS[i] || `${i + 1}.`} <b>${nameHtml(p.name)}</b> — ${p.score} نقطة</div>`));
  }
  if (roundHistory.length > 0) {
    logs.push('<div class="scoreboard-title" style="border-top:1px solid rgba(255,255,255,0.15); padding-top:8px;">تفاصيل كل جولة</div>');
    roundHistory.forEach((r) => {
      const top = r.results.filter((x) => x.points > 0).slice(0, 3);
      const wtext = top.length > 0
        ? top.map((x) => `${nameHtml(x.name)} (+${x.points})`).join('، ')
        : 'بدون فائزين';
      logs.push(`<div class="log-item">الجولة ${r.roundNumber} (${r.features}) — الكأس: #${r.goldNumber}: ${wtext}</div>`);
    });
  }
  openModal('🏁 النتيجة النهائية لسباق الأنابيب', logs);
}

function resetGame() {
  resetSettingsConfirm();
  gameOver.value = false;
  resetRegistration();
  if (guessCountdown) { clearInterval(guessCountdown); guessCountdown = null; }
  clearRevealTimers();
  totalScores.clear();
  roundNumber.value = 0;
  roundPhase.value = 'idle';
  network.value = null;
  flowStarted.value = false;
  outPipes.clear();
  poppedLanes.clear();
  resultRevealed.value = false;
  currentGuesses.clear();
  armedPlayerName.value = null;
  players.clear();
  roundResults.value = [];
  roundHistory.length = 0;
  eventLog.value = [];
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const answeredCount = computed(() => currentGuesses.size);
const totalRegisteredCount = computed(() => players.size);
const registeredNames = computed(() => Array.from(players.keys()));

const statusCaption = computed(() => {
  if (!registrationLocked.value) return openPlay.value ? '👥 مشاركة الجميع مفعّلة — اضغط "بدء اللعب" وأي أحد يكتب رقم يدخل السباق' : 'سجّل اللاعبين ثم اضغط "قفل التسجيل"';
  if (roundPhase.value === 'idle') return 'اختر عدد الأنابيب والصعوبات من ⚙️ الإعدادات ثم اضغط "بدء جولة جديدة" لتوليد شبكة الأنابيب الأولى';
  if (roundPhase.value === 'guessing') return `👀 تتبّع الأنابيب واختر نهايتك: 🏆 كأس، 🥈 فضية، 🪙 عملة، 💣 قنبلة — أول رقم بس ينحسب، والأسرع ياخذ نقاط أكثر! (${answeredCount.value}/${totalRegisteredCount.value} اختاروا)`;
  if (roundPhase.value === 'revealing') return '💧 الماي يتدفق بكل الأنابيب... مين وصل للكأس؟';
  return '🏁 انتهت الجولة — غيّر الصعوبة من ⚙️ الإعدادات لو تبي، واضغط "بدء جولة جديدة" للمتابعة';
});

// أسماء اللي اختاروا كل أنبوب تطلع فوقه بعد ما يخلص الوقت (قبلها تكشف الإجابات للي ينسخون)
const choosersBySource = computed(() => {
  if (!network.value || roundPhase.value === 'idle' || roundPhase.value === 'guessing') return [];
  const map = new Map();
  Array.from(currentGuesses.entries())
    .sort((a, b) => a[1].ms - b[1].ms)
    .forEach(([name, g]) => {
      const id = g.num - 1;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(name);
    });
  return Array.from(map, ([id, names]) => ({ id, names, source: network.value.sources[id] }));
});
function shortName(name) {
  const s = String(displayName(name));
  return s.length > 8 ? `${s.slice(0, 7)}…` : s;
}

const resultsByName = computed(() => new Map(roundResults.value.map((r) => [r.name, r])));
const roundWinners = computed(() => roundResults.value.filter((r) => r.points > 0));

const registeredPlayersDisplay = computed(() => {
  if (players.size === 0) {
    return masterPlayersList.map((p) => ({ name: p.name, avatar: p.avatar, status: '⏳ مسجل' }));
  }
  return registeredNames.value.map((name) => {
    let status = '🏁 جاهز';
    if (roundPhase.value === 'guessing') {
      // الرقم المختار ما يظهر على الشاشة وقت الاختيار عشان ما أحد ينسخه
      status = currentGuesses.has(name) ? '✅ اختار' : '⏳ ينتظر';
    } else if (roundPhase.value === 'revealing') {
      status = '💧 لحظة الحسم...';
    } else if (roundPhase.value === 'done' && network.value) {
      const r = resultsByName.value.get(name);
      if (!r) status = currentGuesses.has(name) ? '💧 لحظة الحسم...' : '🚫 لم يشارك';
      else status = `${r.ending.icon} ${r.points > 0 ? '+' : ''}${r.points}`;
    }
    return { name, avatar: players.get(name)?.avatar, status };
  });
});

const leaderboardSorted = computed(() => Array.from(totalScores.values()).sort((a, b) => b.score - a.score));
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const lockBtnVisible = computed(() => !registrationLocked.value);
const newRoundBtnVisible = computed(() => registrationLocked.value && roundPhase.value !== 'guessing' && roundPhase.value !== 'revealing');
const forceEndBtnVisible = computed(() => roundPhase.value === 'guessing');

const barExpanded = useFloatingBar();

function goHome() { router.push('/'); }

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

// اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة بأي وقت (حتى بعد قفل التسجيل) مع اختياره ونقاطه
function leavePlayerFromChat(name) {
  removeFromList(name);
  players.delete(name);
  currentGuesses.delete(name);
  if (armedPlayerName.value === name) armedPlayerName.value = null;
  totalScores.delete(name);
}

function handleTiktokMessage(data) {
  if (data.comment && data.user && isLeaveComment(data.comment.trim())) {
    leavePlayerFromChat(data.user);
    return;
  }
  if (handleJoinMessage(data)) return;
  if (data.comment && data.user && roundPhase.value === 'guessing') registerGuessFromComment(data.user, data.comment, data.avatar);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'pipe-race', onMessage: handleTiktokMessage });
}

const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(lockRegistration);

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (settingsVisible.value) return;
    if (showModal_.value) return;
    if (lockBtnVisible.value) requestStart();
    else if (newRoundBtnVisible.value) startNewRound();
    else if (forceEndBtnVisible.value) forceEndGuessing();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage, hasPlayer);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromLive(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  disposeRegistration();
  if (guessCountdown) clearInterval(guessCountdown);
  clearRevealTimers();
  clearMessageHandler();
});
</script>

<template>
  <h1>🚰 سباق الأنابيب</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="master-btn end-btn" @click="endAndResetGame">🏁 إنهاء اللعبة وعرض النتائج</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <button class="rules-btn" @click="soundEnabled = !soundEnabled">{{ soundEnabled ? '🔊' : '🔇' }}</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" :start-label="openPlay ? '🚀 بدء اللعب' : '🔒 قفل التسجيل وبدء اللعب'" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>

      <div class="adv-item" :class="{ disabled: levelLocked }">
        <span>🚰 <b>عدد الأنابيب</b> — كل ما زادت صار التتبع أصعب وجائزة الكأس أكبر. ما يتغير أثناء وقت الاختيار أو الكشف.</span>
        <div class="adv-seg">
          <button v-for="c in PIPE_COUNTS" :key="c" type="button" class="adv-seg-btn" :class="{ active: pipeCount === c }" :disabled="levelLocked" @click="pipeCount = c">{{ c }}</button>
        </div>
      </div>

      <div class="adv-item" :class="{ disabled: levelLocked }">
        <span>🎚️ <b>الصعوبات</b> — بالأصل الأنبوب ينزل بـ 3 اتجاهات (تحت، تحت يمين، تحت يسار) مع جسور عشوائية مين فوق ومين تحت. "صعود ونزول" يضيف طبقات فيها 7 اتجاهات (يمين، يسار، فوق يمين، فوق يسار) — الأنبوب ينزل ثم يطلع ويغيّر مساره. تقدر تجمع الصعوبات كلها مع بعض. كل صعوبة تزيد جائزة الكأس 5 نقاط — الكأس الحين: <b>{{ roundConfig.points }}</b> نقطة.</span>
        <div class="adv-seg">
          <button v-for="t in DIFFICULTY_TOGGLES" :key="t.label" type="button" class="adv-seg-btn" :class="{ active: t.model.value }" :disabled="levelLocked" @click="toggleDifficulty(t)">{{ t.label }}<small>{{ t.desc }}</small></button>
        </div>
      </div>

      <div class="adv-item">
        <span>👥 <b>طريقة المشاركة</b> — "مشاركة الجميع": ما فيه تسجيل، أي مشاهد يكتب رقم وقت الجولة يدخل السباق تلقائياً.</span>
        <div class="adv-seg">
          <button type="button" class="adv-seg-btn" :class="{ active: !openPlay }" @click="openPlay = false">🔒 المسجّلين بس<small>بكلمة أو هدية الانضمام</small></button>
          <button type="button" class="adv-seg-btn" :class="{ active: openPlay }" @click="openPlay = true">👥 مشاركة الجميع<small>بدون تسجيل</small></button>
        </div>
      </div>

      <div class="adv-columns">
        <label class="adv-item">
          <span>⏱️ <b>مدة الجولة</b> — مهلة اختيار رقم الأنبوب بالثواني. أسرع إجابة تاخذ الجائزة كاملة، وآخر ثانية تاخذ 40% منها.</span>
          <input v-model="guessDurationInput" type="number" min="25" max="120" :disabled="roundPhase === 'guessing' || roundPhase === 'revealing'">
        </label>
        <label class="adv-item">
          <span>🏆 <b>نقاط الفوز</b> — اختياري: أول لاعب يوصلها يفوز باللعبة، واتركها فاضية للعب مفتوح.</span>
          <input v-model="winScoreInput" type="number" min="1" placeholder="مفتوح">
        </label>
      </div>
    </div>
  </SettingsOverlay>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">{{ tiktokState.connectLabel }}</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="lockBtnVisible" class="master-btn side-panel-btn" @click="requestStart">{{ startBtnLabel }}</button>
    <button v-if="newRoundBtnVisible" class="master-btn side-panel-btn" @click="startNewRound">🎲 بدء جولة جديدة</button>
    <button v-if="forceEndBtnVisible" class="master-btn side-panel-btn" style="background:var(--info-color);" @click="forceEndGuessing">⏩ إنهاء الوقت الآن</button>
    <!-- زر واحد للنافذة الموحّدة: عدد اللاعبين + كلمة/هدية الانضمام -->
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">
      👥 <span>{{ registrationLocked ? players.size : masterPlayersList.length }}</span>
      <template v-if="!openPlay && !isChatMode()"> · {{ joinViaGift ? `🎁 ${selectedGiftLabel}` : `🎟️ ${getJoinKey()}` }}</template>
    </button>
    <div v-if="openPlay" class="player-count-badge side-panel-count">👥 مشاركة الجميع مفعّلة</div>
    <template v-if="barExpanded && !openPlay">
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        :disabled="!registrationOpen && registrationLocked"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? `⛔ إيقاف التسجيل${registrationUnlimited ? '' : ` (${registrationTimeLeft})`}` : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <!-- نافذة موحّدة: طريقة الانضمام + التسجيل + شبكة بطاقات اللاعبين (بدل نافذتين منفصلتين) -->
  <RegistrationHub
    v-if="playersModalVisible"
    v-model:join-via-gift="joinViaGift"
    v-model:join-key="joinKeyInput"
    v-model:gift-filter="giftNameFilter"
    v-model:reg-unlimited="registrationUnlimited"
    v-model:reg-duration="registrationDurationInput"
    v-model:extend-seconds="extendSecondsInput"
    v-model:new-name="newPlayerName"
    :show-join="!openPlay"
    :locked="registrationLocked"
    :join-hint="joinKeyHint"
    :reg-open="registrationOpen"
    :reg-time-left="registrationTimeLeft"
    :players="masterPlayersList"
    @start="startRegistration"
    @stop="stopRegistration"
    @extend="extendRegistration"
    @add="addPlayer"
    @remove="(p) => removePlayer(p.id)"
    @clear="clearPlayers"
    @close="closePlayersModal"
  />

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🚰 ساحة الأنابيب</h2>

      <div class="pipe-caption">{{ statusCaption }}</div>
      <div class="timer-display" :class="{ urgent: roundPhase === 'guessing' && guessTimeLeft <= 5 }">⏱ {{ roundPhase === 'guessing' ? guessTimeLeft : '--' }}</div>

      <div class="pipe-arena">
        <div v-if="!network" class="pipe-placeholder">🔒 لا توجد شبكة أنابيب بعد — اضغط "بدء جولة جديدة"</div>
        <svg
          v-else
          :key="network.id"
          class="pipe-svg"
          :viewBox="`0 0 ${network.width} ${network.height}`"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="pipeFogBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
          </defs>

          <g
            v-for="t in network.tubes"
            :key="t.key"
            class="pipe-seg"
            :class="{ 'is-out': outPipes.has(t.pipe) }"
          >
            <path :d="t.d" class="pipe-tube-outer" />
            <path :d="t.d" class="pipe-tube-inner" />
          </g>

          <path
            v-for="f in network.flows"
            :key="`flow-${f.key}`"
            :d="f.d"
            class="pipe-flow"
            pathLength="100"
            :class="{ flowing: flowStarted, 'is-out': outPipes.has(f.pipe), 'is-gold': resultRevealed && f.pipe === goldSource }"
            :style="{
              stroke: network.sources[f.pipe].color,
              color: network.sources[f.pipe].color,
              transition: `stroke-dashoffset ${f.dur}ms linear ${f.delay}ms, opacity 0.15s ease ${f.delay}ms`,
            }"
          />

          <g v-for="f in network.fog" :key="`fog-${f.id}`" class="pipe-fog" :class="{ cleared: !fogVisible(f) }">
            <rect :x="f.x" :y="f.y" :width="f.w" :height="f.h" rx="26" filter="url(#pipeFogBlur)" />
            <text :x="f.x + f.w / 2" :y="f.y + f.h / 2 + 8" text-anchor="middle">🌫️</text>
          </g>

          <g
            v-for="e in network.endings"
            :key="`end-${e.lane}`"
            class="pipe-ending"
            :class="[`kind-${e.kind}`, { popped: poppedLanes.has(e.lane), 'is-filled': resultRevealed && e.kind === 'gold', dimmed: resultRevealed && e.kind !== 'gold' }]"
            :transform="`translate(${e.x}, ${e.y})`"
          >
            <g class="ending-body">
              <circle v-if="e.kind === 'gold'" r="23" class="vessel-glow" />
              <circle r="17" class="ending-cup" />
              <text y="6" text-anchor="middle" class="ending-icon">{{ e.icon }}</text>
              <text y="36" text-anchor="middle" class="ending-value">{{ e.value > 0 ? `+${e.value}` : e.value }}</text>
            </g>
          </g>

          <g
            v-for="s in network.sources"
            :key="`src-${s.id}`"
            class="source-badge"
            :class="{ armed: roundPhase === 'guessing' && armedPlayerName, 'is-correct': resultRevealed && s.id === goldSource, 'is-out': outPipes.has(s.id) }"
            :transform="`translate(${s.x}, ${s.y})`"
            @click="assignGuess(s.id)"
          >
            <circle r="18" :style="{ fill: 'var(--ink-color)', stroke: s.color }" stroke-width="3" />
            <text text-anchor="middle" dy="6" :style="{ fill: s.color }">{{ s.id + 1 }}</text>
          </g>

          <g
            v-for="c in choosersBySource"
            :key="`who-${c.id}`"
            class="chooser-label"
            :transform="`translate(${c.source.x}, ${c.source.y - 28})`"
          >
            <text text-anchor="middle" class="chooser-name">{{ shortName(c.names[0]) }}</text>
            <text v-if="c.names.length > 1" y="-14" text-anchor="middle" class="chooser-more">+{{ c.names.length - 1 }}</text>
          </g>
        </svg>

        <div v-if="roundPhase === 'guessing'" class="awaiting-chips-wrap">
          <div class="field-hint" style="margin-bottom:6px;">🙋 وضع يدوي (اختباري بدون تيك توك): اضغط اسم لاعب ثم اضغط رقم الأنبوب فوق لتسجيل اختياره</div>
          <div class="chips-row">
            <span
              v-for="name in registeredNames"
              :key="name"
              class="player-chip"
              :class="{ 'chip-armed': armedPlayerName === name, 'chip-answered': currentGuesses.has(name) }"
              @click="armPlayer(name)"
            ><bdi>{{ displayName(name) }}</bdi><template v-if="currentGuesses.has(name)"> ✅</template></span>
          </div>
        </div>

        <div v-if="roundPhase === 'done' && network" class="round-result-row">
          <div class="result-banner">🏆 الأنبوب رقم {{ goldSource + 1 }} وصل للكأس</div>
          <div class="winners-chips">
            <span v-for="(w, i) in roundWinners" :key="w.name" class="winner-chip" :class="{ 'is-gold': w.ending.kind === 'gold' }">{{ MEDALS[i] || w.ending.icon }} <bdi>{{ displayName(w.name) }}</bdi> (+{{ w.points }} · {{ fmtSec(w.ms) }}ث)</span>
            <span v-if="roundWinners.length === 0" class="field-hint">لا أحد كسب نقاط هالجولة</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>👥 اللاعبون المسجَّلون</h3>
      <div class="players-list">
        <div v-if="registeredPlayersDisplay.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
        <div v-for="p in registeredPlayersDisplay" :key="p.name" class="player-item">
          <span><img :src="avatarOrLogo(p.avatar)" class="player-avatar" alt=""><bdi>{{ displayName(p.name) }}</bdi></span>
          <span>{{ p.status }}</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>🏆 لوحة الصدارة الإجمالية</h3>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item">
          <span><span class="lb-rank">{{ rankFor(i) }}</span><bdi>{{ displayName(p.name) }}</bdi></span>
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
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: var(--primary-color);">956br@</strong></span>
  </div>
</template>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 30px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 15px; text-align: center; }

.field-hint {
  font-size: 0.75rem;
  color: var(--text-faint);
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

input:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

.join-settings-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.join-settings-row input[type="text"] { flex: 1; min-width: 140px; width: auto; }

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--text-color);
  font-weight: normal;
  cursor: pointer;
}
.join-gift-toggle input[type="checkbox"] { width: auto; accent-color: var(--primary-color); cursor: pointer; }

.gift-filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}
.registration-row input[type="number"] { width: 90px; flex: none; }
.registration-status { font-weight: bold; color: var(--gold-color); }

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
.end-btn { background: var(--danger-color); box-shadow: 0 4px 15px rgba(138, 21, 56, 0.4); }

.rounds-badge { font-size: 0.95rem; padding: 8px 15px; }

.layout-wrapper { display: flex; flex-direction: column; gap: 20px; width: 100%; }

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
  color: var(--text-color);
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px;
  width: 100%;
  text-align: center;
}

.pipe-caption {
  text-align: center;
  font-size: 0.92rem;
  color: var(--text-soft);
  margin-bottom: 10px;
  min-height: 1.3em;
}

.timer-display {
  text-align: center;
  font-size: 30px;
  font-weight: bold;
  color: var(--amber-color);
  margin-bottom: 10px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}
.timer-display.urgent { color: var(--red-bright); }

.pipe-arena { width: 100%; display: flex; flex-direction: column; align-items: center; }

.pipe-placeholder { text-align: center; color: var(--text-faint); padding: 40px 10px; font-size: 0.95rem; }

/* الشبكة دايماً تنعرض كاملة داخل الشاشة: لو طويلة تصغر بنفس النسبة بدل ما تطلع برا */
.pipe-svg { width: 100%; max-width: 560px; height: auto; max-height: 72vh; direction: ltr; }

/* أطراف المقاطع مقصوصة (butt) عشان تلتحم بدون عقد عند حدود الطبقات — كل مقطع يبدأ وينتهي عمودي،
   وطرفا الأنبوب الأول والأخير مغطيين بدائرة الرقم ودائرة النهاية */
.pipe-tube-outer { fill: none; stroke: #05060a; stroke-width: 18; stroke-linecap: butt; stroke-linejoin: round; }
.pipe-tube-inner { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 12; stroke-linecap: butt; stroke-linejoin: round; }

/* الماي مخفي وقت الاختيار، ويتدفق مقطع مقطع (التوقيت inline حسب رقم الطبقة) لما يبدأ الكشف */
.pipe-flow {
  fill: none;
  stroke-width: 7;
  stroke-linecap: butt;
  stroke-linejoin: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  opacity: 0;
}
.pipe-flow.flowing { stroke-dashoffset: 0; opacity: 1; }
.pipe-flow.flowing.is-out { opacity: 0.12; transition: opacity 0.4s ease !important; }
.pipe-flow.is-gold { stroke-width: 10; filter: drop-shadow(0 0 7px currentColor); }


.pipe-seg { transition: opacity 0.4s ease; }
.pipe-seg.is-out { opacity: 0.18; }

.pipe-fog { transition: opacity 1.2s ease; }
.pipe-fog rect { fill: #262638; opacity: 0.97; }
.pipe-fog text { font-size: 22px; opacity: 0.6; }
.pipe-fog.cleared { opacity: 0; pointer-events: none; }

.ending-body { transform-box: fill-box; transform-origin: center; transition: opacity 0.4s ease; }
.ending-cup { fill: var(--ink-color); stroke: #555; stroke-width: 2.5; }
.ending-icon { font-size: 15px; user-select: none; }
.ending-value { font-size: 12px; font-weight: bold; fill: var(--text-color); }
.kind-gold .ending-cup { stroke: var(--primary-color); stroke-width: 3; }
.kind-gold .ending-value { fill: var(--gold-color); }
.kind-silver .ending-cup { stroke: var(--text-muted); }
.kind-coin .ending-cup { stroke: #c49b3c; }
.kind-bomb .ending-cup { stroke: var(--error-color); }
.kind-bomb .ending-value { fill: var(--error-soft); }
.pipe-ending.popped .ending-body { animation: endingPop 0.45s ease-out; }
.pipe-ending.dimmed .ending-body { opacity: 0.45; }
.pipe-ending.is-filled .ending-cup { fill: var(--primary-color); }
.pipe-ending.is-filled .vessel-glow { animation: none; opacity: 0.9; }

.vessel-glow { fill: rgba(243,156,18,0.25); filter: blur(6px); animation: vesselPulse 1.6s ease-in-out infinite; }

@keyframes vesselPulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
@keyframes endingPop {
  0% { transform: scale(1); }
  40% { transform: scale(1.45); }
  100% { transform: scale(1); }
}

.source-badge text { font-size: 15px; font-weight: bold; user-select: none; pointer-events: none; }
.source-badge circle { transition: filter 0.2s, transform 0.2s, opacity 0.4s; }
.source-badge.armed { cursor: pointer; }
.source-badge.armed:hover circle { filter: drop-shadow(0 0 6px #fff); transform: scale(1.08); }
.source-badge.is-out { opacity: 0.35; }
.source-badge.is-correct circle { stroke-width: 5; filter: drop-shadow(0 0 10px gold); }

.chooser-label text { user-select: none; pointer-events: none; }
.chooser-name { font-size: 11px; font-weight: bold; fill: var(--text-color); }
.chooser-more { font-size: 10px; fill: var(--gold-color); }

.awaiting-chips-wrap {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255,255,255,0.12);
}

.chips-row { display: flex; flex-wrap: wrap; gap: 6px; }

.player-chip {
  background: var(--ink-color);
  border: 1px solid rgba(255,255,255,0.2);
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 0.82rem;
  cursor: pointer;
}
.player-chip.chip-armed { background: var(--primary-color); color: #1e1e2f; border-color: #fff; box-shadow: 0 0 8px var(--primary-color); }
.player-chip.chip-answered { border-color: var(--success-color); }

.round-result-row {
  width: 100%;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255,255,255,0.15);
  text-align: center;
}
.result-banner { font-weight: bold; color: var(--primary-color); margin-bottom: 8px; }
.winners-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.winner-chip {
  background: var(--ink-color);
  border: 1px solid var(--success-color);
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 0.85rem;
}
.winner-chip.is-gold { border-color: var(--primary-color); box-shadow: 0 0 8px rgba(243,156,18,0.4); }

.leaderboard-list, .players-list { display: flex; flex-direction: column; gap: 6px; width: 100%; }

.leaderboard-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--ink-color);
  border-radius: 8px;
  font-size: 0.95rem;
}
.leaderboard-item .lb-rank { font-weight: bold; color: var(--primary-color); margin-left: 8px; }

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: var(--ink-color);
  border-radius: 6px;
  font-size: 0.9rem;
  width: 100%;
}

.event-log-panel {
  width: 100%;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: var(--ink-color); font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.event-log-panel :deep(.log-bomb), .modal-logs :deep(.log-bomb) { border-right: 4px solid var(--error-color); }

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
  background: var(--surface-color);
  padding: 20px;
  border-radius: 15px;
  width: 100%;
  max-width: 420px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}
.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.15rem; }
.modal-logs { text-align: right; margin: 15px 0; font-size: 0.88rem; line-height: 1.5; display: flex; flex-direction: column; gap: 6px; }
.modal-logs :deep(.scoreboard-title) {
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  width: 100%;
}
</style>
