<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const PLAYERS_KEY = 'pipeRaceGame_players';
const SCORES_KEY = 'pipeRaceGame_scores';

const SOURCE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#fd79a8'];
const MEDALS = ['🥇', '🥈', '🥉'];

const LEVELS = [
  {
    n: 6, layers: 5, label: 'مبتدئ', points: 20, shape: 'linear',
  },
  {
    n: 7, layers: 6, label: 'سهل', points: 25, shape: 'linear',
  },
  {
    n: 8, layers: 7, label: 'متوسط', points: 30, shape: 'linear',
  },
  {
    n: 8, layers: 6, label: 'صعب', points: 35, shape: 'circular',
  },
  {
    n: 10, layers: 8, label: 'مستحيل', points: 40, shape: 'circular',
  },
];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadPlayers() {
  try { localStorage.removeItem(PLAYERS_KEY); } catch (e) { /* noop */ }
  return null;
}
function loadScores() {
  try {
    const data = localStorage.getItem(SCORES_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const masterPlayersList = reactive(loadPlayers() || []);
let playerIdCounter = Math.max(0, ...masterPlayersList.map((p) => p.id), 0) + 1;
const joinedUsers = new Set();

function savePlayers() {
  // أسماء اللاعبين لا تُحفظ بين الجلسات
}

const totalScores = reactive(new Map((loadScores() || []).map((p) => [p.name, p])));
function saveScores() {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(Array.from(totalScores.values()))); } catch (e) { /* noop */ }
}
function getOrCreatePlayerScore(name) {
  if (!totalScores.has(name)) totalScores.set(name, reactive({ name, score: 0 }));
  return totalScores.get(name);
}

const registrationLocked = ref(false);
const players = reactive(new Map()); // name -> { name }
const eventLog = ref([]);

const namesInput = ref(masterPlayersList.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const joinKeyInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);

const namesHint = computed(() => (registrationLocked.value
  ? '🔒 مقفول بعد قفل التسجيل — اضغط "إعادة كل شيء" لتعديل القائمة من جديد.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل بعد قفل التسجيل.'));
function getJoinKey() { return joinKeyInput.value.trim() || '1'; }
const joinKeyHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء فتح نافذة التسجيل ينضم تلقائياً كلاعب مسجَّل.'
  : `المشاهد يكتب "${getJoinKey()}" بالدردشة عشان ينضم كلاعب مسجَّل أثناء فتح نافذة التسجيل`));

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
  if (registrationLocked.value || registrationOpen.value) return;
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

function updateTextareaFromPlayers() {
  namesInput.value = masterPlayersList.map((p) => p.name).join('\n');
}
function syncTextareaToPlayers() {
  if (registrationLocked.value) return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];
  if (names.length === 0) {
    masterPlayersList.splice(0, masterPlayersList.length);
    savePlayers();
    return;
  }
  const newList = names.map((name) => {
    const existing = masterPlayersList.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name };
  });
  masterPlayersList.splice(0, masterPlayersList.length, ...newList);
  savePlayers();
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

function addPlayer() {
  if (registrationLocked.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (masterPlayersList.some((p) => p.name === name)) {
    openModal('تنبيه', [`<div class="log-item">الاسم "${escapeHtml(name)}" موجود مسبقاً في القائمة!</div>`]);
    return;
  }
  masterPlayersList.push({ id: playerIdCounter++, name });
  newPlayerName.value = '';
  updateTextareaFromPlayers();
  savePlayers();
}

function addPlayerFromTikTok(name) {
  if (registrationLocked.value || !registrationOpen.value || !name) return;
  if (joinedUsers.has(name)) return;
  joinedUsers.add(name);
  if (masterPlayersList.some((p) => p.name === name)) return;
  masterPlayersList.push({ id: playerIdCounter++, name });
  updateTextareaFromPlayers();
  savePlayers();
}

function lockRegistration() {
  if (registrationLocked.value) return;
  if (masterPlayersList.length < 1) {
    openModal('تنبيه', ['<div class="log-item">تحتاج تسجيل لاعب واحد على الأقل قبل قفل التسجيل!</div>']);
    return;
  }
  players.clear();
  masterPlayersList.forEach((p) => players.set(p.name, { name: p.name }));
  registrationLocked.value = true;
  stopRegistration();
  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُقفل التسجيل بـ ${players.size} لاعب — جاهزين للسباق!</div>`);
}

// ===== توليد شبكة الأنابيب =====
// نمط "حائط الطوب" (brick-wall) المشترك بين الشكلين: كل طبقة/حلقة تُبادل إما الأزواج
// الزوجية (0,1)(2,3).. أو الفردية (1,2)(3,4).. بالتناوب، فكل أنبوب يمر بفرصة تشابك في نصف
// الطبقات على الأقل. مع احتمال عالٍ للتنفيذ (لا 100% حتى يختلف الشكل بين الجولات) + تحقّق
// لاحق يضمن ألا يبقى أي أنبوب بمسار بلا أي تقاطع (وإلا يُعاد التوليد من جديد).

// الشكل الخطي: مصادر بأعمدة متوازية أعلى الشاشة تتشابك عبر طبقات أفقية نزولاً لصف نهايات أسفل الشاشة
function attemptBuildLinearLayers(n, numLayers, geo) {
  const laneX = (lane) => geo.marginX + lane * geo.laneGap;
  const currentLane = Array.from({ length: n }, (_, i) => i);
  const crossCount = Array.from({ length: n }, () => 0);
  const paths = Array.from({ length: n }, (_, i) => ({
    id: i,
    color: SOURCE_COLORS[i % SOURCE_COLORS.length],
    d: `M ${laneX(i)} ${geo.topY}`,
    lane: i,
    endX: 0,
    endY: 0,
  }));

  let y = geo.topY;
  for (let L = 0; L < numLayers; L++) {
    const yNext = y + geo.layerH;
    const yMid = y + geo.layerH / 2;
    const offset = L % 2; // 0: أزواج (0,1)(2,3).. — 1: أزواج (1,2)(3,4)..
    const pairs = [];
    for (let laneA = offset; laneA + 1 < n; laneA += 2) {
      if (Math.random() < 0.82) pairs.push([laneA, laneA + 1]);
    }
    const swapMap = new Map();
    pairs.forEach(([a, b]) => { swapMap.set(a, b); swapMap.set(b, a); });

    for (let i = 0; i < n; i++) {
      const laneNow = currentLane[i];
      if (swapMap.has(laneNow)) {
        const otherLane = swapMap.get(laneNow);
        paths[i].d += ` C ${laneX(laneNow)} ${yMid}, ${laneX(otherLane)} ${yMid}, ${laneX(otherLane)} ${yNext}`;
        currentLane[i] = otherLane;
        crossCount[i]++;
      } else {
        paths[i].d += ` L ${laneX(laneNow)} ${yNext}`;
      }
    }
    y = yNext;
  }

  const endY = y + 34;
  for (let i = 0; i < n; i++) {
    const finalLane = currentLane[i];
    paths[i].d += ` L ${laneX(finalLane)} ${endY}`;
    paths[i].lane = finalLane;
    paths[i].endX = laneX(finalLane);
    paths[i].endY = endY;
  }

  return { paths, crossCount };
}

// الشكل الدائري (أصعب): المصادر موزّعة بالتساوي حول دائرة خارجية، وتتشابك عبر حلقات متحدة
// المركز تتقلّص تدريجياً نحو حلقة داخلية صغيرة فيها نقاط النهاية — تتبّع مسار دائري ملتفّ
// أصعب بصرياً من الخطوط المستقيمة. يتطلب عدد أنابيب زوجي لضمان تغطية كاملة لكل حلقة.
function attemptBuildCircularLayers(n, numLayers, geo) {
  const {
    cx, cy, rOuter, rInner,
  } = geo;
  const ringStep = (rOuter - rInner) / numLayers;
  const angleFor = (lane) => (lane / n) * Math.PI * 2 - Math.PI / 2;
  const pointAt = (lane, r) => {
    const a = angleFor(lane);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const fmt = (v) => v.toFixed(1);

  const currentLane = Array.from({ length: n }, (_, i) => i);
  const crossCount = Array.from({ length: n }, () => 0);
  const paths = Array.from({ length: n }, (_, i) => {
    const [x, y] = pointAt(i, rOuter);
    return {
      id: i, color: SOURCE_COLORS[i % SOURCE_COLORS.length], d: `M ${fmt(x)} ${fmt(y)}`, lane: i, endX: 0, endY: 0,
    };
  });

  let r = rOuter;
  for (let L = 0; L < numLayers; L++) {
    const rNext = r - ringStep;
    const rMid = r - ringStep / 2;
    const offset = L % 2; // 0: أزواج (0,1)(2,3).. — 1: أزواج (1,2)(3,4).. وآخرها يلتف حول الدائرة
    const pairs = [];
    for (let k = 0; k < n / 2; k++) {
      const laneA = (offset + k * 2) % n;
      const laneB = (laneA + 1) % n;
      if (Math.random() < 0.82) pairs.push([laneA, laneB]);
    }
    const swapMap = new Map();
    pairs.forEach(([a, b]) => { swapMap.set(a, b); swapMap.set(b, a); });

    for (let i = 0; i < n; i++) {
      const laneNow = currentLane[i];
      if (swapMap.has(laneNow)) {
        const otherLane = swapMap.get(laneNow);
        const [mx1, my1] = pointAt(laneNow, rMid);
        const [mx2, my2] = pointAt(otherLane, rMid);
        const [ex, ey] = pointAt(otherLane, rNext);
        paths[i].d += ` C ${fmt(mx1)} ${fmt(my1)}, ${fmt(mx2)} ${fmt(my2)}, ${fmt(ex)} ${fmt(ey)}`;
        currentLane[i] = otherLane;
        crossCount[i]++;
      } else {
        const [x, y] = pointAt(laneNow, rNext);
        paths[i].d += ` L ${fmt(x)} ${fmt(y)}`;
      }
    }
    r = rNext;
  }

  for (let i = 0; i < n; i++) {
    const finalLane = currentLane[i];
    const [x, y] = pointAt(finalLane, r);
    paths[i].lane = finalLane;
    paths[i].endX = x;
    paths[i].endY = y;
  }

  return { paths, crossCount };
}

function generateNetwork(levelIdx) {
  const cfg = LEVELS[levelIdx];
  const n = cfg.n;
  const numLayers = cfg.layers;
  const isCircular = cfg.shape === 'circular';
  const minCrossings = Math.max(1, Math.floor(numLayers / 2));

  let geo;
  let sources;
  let width;
  let height;
  let attemptFn;

  if (isCircular) {
    geo = {
      cx: 230, cy: 230, rOuter: 195, rInner: 78,
    };
    attemptFn = () => attemptBuildCircularLayers(n, numLayers, geo);
    sources = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        id: i, x: geo.cx + geo.rOuter * Math.cos(a), y: geo.cy + geo.rOuter * Math.sin(a), color: SOURCE_COLORS[i % SOURCE_COLORS.length],
      };
    });
    width = geo.cx * 2;
    height = geo.cy * 2;
  } else {
    geo = {
      marginX: 42, laneGap: 64, topY: 34, layerH: 58,
    };
    const laneX = (lane) => geo.marginX + lane * geo.laneGap;
    attemptFn = () => attemptBuildLinearLayers(n, numLayers, geo);
    sources = Array.from({ length: n }, (_, i) => ({
      id: i, x: laneX(i), y: geo.topY, color: SOURCE_COLORS[i % SOURCE_COLORS.length],
    }));
  }

  let built = attemptFn();
  for (let attempt = 0; attempt < 40 && built.crossCount.some((c) => c < minCrossings); attempt++) {
    built = attemptFn();
  }
  const { paths } = built;

  if (!isCircular) {
    width = geo.marginX * 2 + (n - 1) * geo.laneGap;
    height = paths[0].endY + 46;
  }

  const winningLane = Math.floor(Math.random() * n);
  const correctSource = paths.findIndex((p) => p.lane === winningLane);

  return {
    n,
    numLayers,
    paths,
    sources,
    winningLane,
    correctSource,
    winningX: paths[correctSource].endX,
    winningY: paths[correctSource].endY,
    width,
    height,
  };
}

// ===== حالة الجولة =====
const selectedLevelIndex = ref(0);
const roundPhase = ref('idle'); // idle | guessing | revealing | done
const network = ref(null);
// يبقى false إلى أن تظهر نافذة نتيجة الجولة فعلياً على الشاشة، فلا تُضخّ الألوان بالأنابيب قبلها
const resultRevealed = ref(false);
const currentGuesses = reactive(new Map()); // name -> number (1-based)
const armedPlayerName = ref(null);
const roundNumber = ref(0);
const guessDurationInput = ref(25);
const guessTimeLeft = ref(0);
let guessCountdown = null;
const roundWinners = ref([]); // [{name, points}]
const roundHistory = [];

const levelLocked = computed(() => roundPhase.value === 'guessing' || roundPhase.value === 'revealing');
function selectLevel(idx) {
  if (levelLocked.value) return;
  selectedLevelIndex.value = idx;
}

function getGuessDuration() {
  let val = parseInt(guessDurationInput.value, 10);
  if (Number.isNaN(val) || val < 5) val = 5;
  if (val > 120) val = 120;
  guessDurationInput.value = val;
  return val;
}

// مهلة تجميد قصيرة قبل بدء تدفق اللون (لا يظهر أي لون على الأنابيب قبلها إطلاقاً)
const REVEAL_FREEZE_MS = 500;
// مدة حركة تدفق اللون داخل الأنبوب الصحيح — تظهر كاملة وواضحة للاعب قبل فتح نافذة النتيجة
const FLOW_REVEAL_MS = 1000;

function startNewRound() {
  if (!registrationLocked.value) return;
  if (roundPhase.value === 'guessing' || roundPhase.value === 'revealing') return;
  network.value = generateNetwork(selectedLevelIndex.value);
  currentGuesses.clear();
  armedPlayerName.value = null;
  resultRevealed.value = false;
  roundNumber.value++;
  roundWinners.value = [];
  const dur = getGuessDuration();
  guessTimeLeft.value = dur;
  roundPhase.value = 'guessing';
  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🌀 الجولة ${roundNumber.value} — مستوى ${selectedLevelIndex.value + 1} (${LEVELS[selectedLevelIndex.value].label}): شبكة جديدة بـ ${network.value.n} أنابيب، اختر رقم الأنبوب الصحيح خلال ${dur} ثانية!</div>`);

  if (guessCountdown) clearInterval(guessCountdown);
  guessCountdown = setInterval(() => {
    guessTimeLeft.value--;
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
  appendLog('<div class="log-item" style="text-align:center; color:#f1c40f;">⚡ انتهى وقت الاختيار — تدفق الألوان يبدأ الآن!</div>');
  setTimeout(() => { startColorReveal(); }, REVEAL_FREEZE_MS);
}

// تبدأ ألوان الأنابيب بالتدفق ظاهرة بالكامل على الشاشة (بدون أي نافذة تغطيها)،
// وفقط بعد اكتمال حركة التدفق بصرياً تظهر نافذة نتيجة الجولة بالتفاصيل النصية
function startColorReveal() {
  const net = network.value;
  if (!net) return;
  roundPhase.value = 'done';
  resultRevealed.value = true;
  setTimeout(() => { finalizeRoundResults(); }, FLOW_REVEAL_MS);
}

function finalizeRoundResults() {
  const net = network.value;
  if (!net) return;
  const correctNumber = net.correctSource + 1;
  const pts = LEVELS[selectedLevelIndex.value].points;
  const winnerEntries = [];
  currentGuesses.forEach((num, name) => {
    if (num === correctNumber) {
      const player = getOrCreatePlayerScore(name);
      player.score += pts;
      winnerEntries.push({ name, points: pts });
    }
  });
  saveScores();
  roundWinners.value = winnerEntries;

  const logs = [];
  logs.push(`<div class="log-item" style="text-align:center; color:#f39c12;">🏆 الأنبوب الصحيح كان رقم <b>${correctNumber}</b>!</div>`);
  if (winnerEntries.length > 0) {
    winnerEntries.forEach((w) => {
      logs.push(`<div class="log-item log-hit">🎉 <b>${escapeHtml(w.name)}</b> اختار صح وكسب ${w.points} نقطة!</div>`);
    });
  } else {
    logs.push('<div class="log-item" style="color:#8b93a3;">لا أحد اختار الأنبوب الصحيح هالجولة.</div>');
  }
  logs.forEach((l) => appendLog(l));
  roundHistory.push({
    roundNumber: roundNumber.value, level: selectedLevelIndex.value + 1, correctNumber, winners: winnerEntries,
  });
  openModal(`نتيجة الجولة ${roundNumber.value}`, logs);
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

function registerGuessFromComment(name, rawText) {
  if (roundPhase.value !== 'guessing' || !name || !rawText) return;
  if (!players.has(name)) return;
  const net = network.value;
  if (!net) return;
  const num = parseGuessNumber(rawText, net.n);
  if (num === null) return;
  currentGuesses.set(name, num);
}

function armPlayer(name) {
  if (roundPhase.value !== 'guessing') return;
  armedPlayerName.value = (armedPlayerName.value === name) ? null : name;
}
function assignGuess(sourceId) {
  if (roundPhase.value !== 'guessing' || !armedPlayerName.value) return;
  currentGuesses.set(armedPlayerName.value, sourceId + 1);
  armedPlayerName.value = null;
}

function endAndResetGame() {
  endGame();
  resetGame();
}

function endGame() {
  if (guessCountdown) { clearInterval(guessCountdown); guessCountdown = null; }
  roundPhase.value = 'idle';
  network.value = null;
  resultRevealed.value = false;

  const sorted = Array.from(totalScores.values()).sort((a, b) => b.score - a.score);
  const logs = [];
  logs.push('<div class="log-item" style="text-align:center; font-weight:bold; color:#f39c12;">🏁 انتهت اللعبة — النتيجة النهائية</div>');
  if (sorted.length === 0) {
    logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي فائزين هالمرة.</div>');
  } else {
    logs.push(...sorted.map((p, i) => `<div class="log-item">${MEDALS[i] || `${i + 1}.`} <b>${escapeHtml(p.name)}</b> — ${p.score} نقطة</div>`));
  }
  if (roundHistory.length > 0) {
    logs.push('<div class="scoreboard-title" style="border-top:1px solid rgba(255,255,255,0.15); padding-top:8px;">تفاصيل كل جولة</div>');
    roundHistory.forEach((r) => {
      const wtext = r.winners.length > 0
        ? r.winners.map((w) => escapeHtml(w.name)).join('، ')
        : 'بدون فائزين';
      logs.push(`<div class="log-item">الجولة ${r.roundNumber} (مستوى ${r.level}) — صحيح: #${r.correctNumber}: ${wtext}</div>`);
    });
  }
  openModal('🏁 النتيجة النهائية لشبكة الأنابيب', logs);
}

function resetGame() {
  stopRegistration();
  if (guessCountdown) { clearInterval(guessCountdown); guessCountdown = null; }
  totalScores.clear();
  saveScores();
  roundNumber.value = 0;
  roundPhase.value = 'idle';
  network.value = null;
  resultRevealed.value = false;
  currentGuesses.clear();
  armedPlayerName.value = null;
  players.clear();
  registrationLocked.value = false;
  roundWinners.value = [];
  roundHistory.length = 0;
  eventLog.value = [];
  joinedUsers.clear();
  selectedLevelIndex.value = 0;
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
  if (!registrationLocked.value) return 'سجّل اللاعبين ثم اضغط "قفل التسجيل"';
  if (roundPhase.value === 'idle') return 'اختر المستوى ثم اضغط "بدء جولة جديدة" لتوليد شبكة الأنابيب الأولى';
  if (roundPhase.value === 'guessing') return `👀 الأنابيب شفافة وبدون ألوان الآن — تتبّع تشابكها بعينك بدقة واختر رقم الأنبوب الذي يصل لوعاء الفوز 🏆! (${answeredCount.value}/${totalRegisteredCount.value} اختاروا حتى الآن)`;
  if (roundPhase.value === 'revealing') return '⚡ لحظات وتُكشف الألوان... ترقّب النتيجة!';
  return '🏁 انتهت الجولة — اختر المستوى واضغط "بدء جولة جديدة" للمتابعة';
});

const deadEndPaths = computed(() => {
  if (!network.value) return [];
  return network.value.paths.filter((p) => p.id !== network.value.correctSource);
});

const registeredPlayersDisplay = computed(() => {
  if (players.size === 0) {
    return masterPlayersList.map((p) => ({ name: p.name, status: '⏳ مسجل' }));
  }
  return registeredNames.value.map((name) => {
    let status = '🏁 جاهز';
    if (roundPhase.value === 'guessing') {
      status = currentGuesses.has(name) ? `✅ اختار #${currentGuesses.get(name)}` : '⏳ ينتظر';
    } else if (roundPhase.value === 'revealing') {
      status = '⚡ لحظة الحسم...';
    } else if (roundPhase.value === 'done' && network.value) {
      const correctNumber = network.value.correctSource + 1;
      if (currentGuesses.get(name) === correctNumber) status = '🏆 فاز!';
      else if (currentGuesses.has(name)) status = '❌ خطأ';
      else status = '🚫 لم يشارك';
    }
    return { name, status };
  });
});

const leaderboardSorted = computed(() => Array.from(totalScores.values()).sort((a, b) => b.score - a.score));
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const lockBtnVisible = computed(() => !registrationLocked.value);
const newRoundBtnVisible = computed(() => registrationLocked.value && roundPhase.value !== 'guessing' && roundPhase.value !== 'revealing');
const forceEndBtnVisible = computed(() => roundPhase.value === 'guessing');

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
  trackConnectRequest('pipe-race', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment && data.user) {
      const text = data.comment.trim();
      if (registrationOpen.value && !joinViaGift.value && !registrationLocked.value && text === getJoinKey()) {
        addPlayerFromTikTok(data.user);
      } else if (roundPhase.value === 'guessing') {
        registerGuessFromComment(data.user, data.comment);
      }
    }
    if (registrationOpen.value && joinViaGift.value && !registrationLocked.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {});
onUnmounted(() => {
  if (registrationTimer) clearInterval(registrationTimer);
  if (guessCountdown) clearInterval(guessCountdown);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: من يكتب مفتاح الانضمام بالدردشة ينضم تلقائياً كلاعب مسجَّل، وأثناء وقت الاختيار يكتب رقم الأنبوب الذي يعتقد أنه يوصل لوعاء الفوز</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinKeyInput" type="text" maxlength="10" :disabled="joinViaGift || registrationLocked">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox" :disabled="registrationLocked">
        🎁 الانضمام بإرسال هدية بدل كتابة المفتاح
      </label>
    </div>
    <div v-if="joinViaGift" class="gift-filter-row">
      <select v-model="giftNameFilter" :disabled="registrationLocked">
        <option value="">🎁 أي هدية</option>
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
      <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)" :disabled="registrationLocked">
    </div>
    <div class="field-hint" style="margin-top:8px;">{{ joinKeyHint }}</div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationLocked">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" :disabled="registrationLocked" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين المسجَّلين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="registrationLocked" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
    <div style="display: flex; gap: 5px; width: 100%; margin-top: 10px;">
      <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد (Enter للإضافة)" style="flex:1;" :disabled="registrationLocked" @keydown.enter.prevent="addPlayer">
      <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" :disabled="registrationLocked" @click="addPlayer">إضافة</button>
    </div>
  </div>

  <div class="top-names-section">
    <label>🌀 مستوى تشابك الأنابيب (يحدد عدد الأنابيب والنقاط):</label>
    <div class="levels-row">
      <button
        v-for="(lvl, idx) in LEVELS"
        :key="idx"
        class="level-btn"
        :class="{ 'level-active': selectedLevelIndex === idx }"
        :disabled="levelLocked"
        @click="selectLevel(idx)"
      >
        {{ idx + 1 }}️⃣ {{ lvl.label }}<br>
        <small>{{ lvl.n }} أنابيب — {{ lvl.points }} نقطة</small>
      </button>
    </div>
    <div class="field-hint">أعلى مستوى = تشابك أصعب + نقاط أكثر للفائزين. لا يمكن تغييره أثناء وقت الاختيار أو لحظة إعلان النتيجة.</div>
  </div>

  <div class="top-names-section">
    <label for="guessDurationInput">⏱️ مهلة اختيار رقم الأنبوب بالثواني (افتراضياً 25 كما في فكرة اللعبة):</label>
    <div class="round-time-row">
      <input v-model="guessDurationInput" type="number" min="5" max="120" :disabled="roundPhase === 'guessing' || roundPhase === 'revealing'">
      <div class="field-hint" style="margin-top:0;">بعد انتهاء هذه المهلة تتجمّد الأنابيب للحظة وتُكشف النتيجة تلقائياً بسرعة.</div>
    </div>
  </div>

  <h1>🚰 شبكة الأنابيب</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>🚰 ساحة الأنابيب</h2>
      <div class="master-controls">
        <button v-if="lockBtnVisible" class="master-btn" @click="lockRegistration">🔒 قفل التسجيل</button>
        <button v-if="newRoundBtnVisible" class="master-btn" @click="startNewRound">🎲 بدء جولة جديدة</button>
        <button v-if="forceEndBtnVisible" class="master-btn" style="background:#3498db;" @click="forceEndGuessing">⏩ إنهاء الوقت الآن</button>
        <button class="master-btn end-btn" @click="endAndResetGame">🏁 إنهاء اللعبة وعرض النتائج</button>
        <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
        <button class="home-btn" @click="goHome">🏠 الخروج</button>
        <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
      </div>

      <div class="pipe-caption">{{ statusCaption }}</div>
      <div class="timer-display" :class="{ urgent: roundPhase === 'guessing' && guessTimeLeft <= 5 }">⏱ {{ roundPhase === 'guessing' ? guessTimeLeft : '--' }}</div>

      <div class="pipe-arena">
        <div v-if="!network" class="pipe-placeholder">🔒 لا توجد شبكة أنابيب بعد — اضغط "بدء جولة جديدة"</div>
        <svg
          v-else
          class="pipe-svg"
          :viewBox="`0 0 ${network.width} ${network.height}`"
          preserveAspectRatio="xMidYMid meet"
        >
          <path v-for="p in network.paths" :key="`tube-out-${p.id}`" :d="p.d" class="pipe-tube-outer" />
          <path v-for="p in network.paths" :key="`tube-in-${p.id}`" :d="p.d" class="pipe-tube-inner" />
          <path
            v-for="p in network.paths"
            :key="`flow-${p.id}`"
            :d="p.d"
            class="pipe-flow"
            pathLength="100"
            :class="{
              'is-correct-reveal': resultRevealed && p.id === network.correctSource,
              'is-wrong-reveal': resultRevealed && p.id !== network.correctSource,
            }"
            :style="{
              stroke: p.color,
              color: p.color,
              strokeDashoffset: (p.id === network.correctSource && !resultRevealed) ? 100 : 0,
            }"
          />
          <circle
            v-for="p in deadEndPaths"
            :key="`cap-${p.id}`"
            :cx="p.endX"
            :cy="p.endY"
            r="9"
            class="pipe-cap"
          />
          <g class="win-vessel" :class="{ 'is-filled': resultRevealed }" :transform="`translate(${network.winningX}, ${network.winningY})`">
            <circle r="22" class="vessel-glow" />
            <circle r="15" class="vessel-cup" />
            <text y="6" text-anchor="middle" class="vessel-icon">🏆</text>
          </g>
          <g
            v-for="s in network.sources"
            :key="`src-${s.id}`"
            class="source-badge"
            :class="{ armed: roundPhase === 'guessing' && armedPlayerName, 'is-correct': resultRevealed && s.id === network.correctSource }"
            :transform="`translate(${s.x}, ${s.y})`"
            @click="assignGuess(s.id)"
          >
            <circle r="18" :style="{ fill: '#1e1e2f', stroke: s.color }" stroke-width="3" />
            <text text-anchor="middle" dy="6" :style="{ fill: s.color }">{{ s.id + 1 }}</text>
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
            >{{ name }}<template v-if="currentGuesses.has(name)"> (#{{ currentGuesses.get(name) }})</template></span>
          </div>
        </div>

        <div v-if="roundPhase === 'done' && network" class="round-result-row">
          <div class="result-banner">🏆 الأنبوب الصحيح كان رقم {{ network.correctSource + 1 }}</div>
          <div class="winners-chips">
            <span v-for="w in roundWinners" :key="w.name" class="winner-chip">🎉 {{ w.name }} (+{{ w.points }})</span>
            <span v-if="roundWinners.length === 0" class="field-hint">لا أحد فاز هالجولة</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>👥 اللاعبون المسجَّلون</h3>
      <div class="players-list">
        <div v-if="registeredPlayersDisplay.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
        <div v-for="p in registeredPlayersDisplay" :key="p.name" class="player-item">
          <span>{{ p.name }}</span>
          <span>{{ p.status }}</span>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>🏆 لوحة الصدارة الإجمالية</h3>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item">
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
      <h2>قوانين شبكة الأنابيب 🚰</h2>
      <ul class="rules-list">
        <li><b>الفكرة:</b> شبكة معقدة من أنابيب شفافة ومتشابكة، لكل منها مصدر سائل ملوّن ومرقّم أعلى الشاشة. أنبوب واحد فقط من بينها يمتد ليصل فعلياً إلى وعاء الفوز 🏆 المميّز أسفل الشبكة</li>
        <li><b>التسجيل:</b> يكتب المتابع مفتاح الانضمام (افتراضياً "1") بالدردشة لينضم كلاعب قبل قفل التسجيل</li>
        <li><b>الاختيار:</b> بعد بدء كل جولة، أمام كل لاعب مسجَّل مهلة محددة (25 ثانية افتراضياً) ليتتبّع المسارات بعينه بتركيز ويكتب رقم الأنبوب الذي يعتقد أنه يوصل لوعاء الفوز</li>
        <li><b>بدون ألوان أثناء الاختيار:</b> الأنابيب شفافة وبلا أي لون أو حركة طوال وقت الاختيار — تتبّع التشابك بالشكل فقط، دون أي مؤشر يدلّك على المسار</li>
        <li>يقدر اللاعب يغيّر اختياره أي عدد من المرات قبل انتهاء المهلة، ويُحتسب آخر رقم كتبه فقط</li>
        <li><b>الكشف:</b> بعد انتهاء المهلة، وبلا أي مهلة إضافية للتتبع، يتدفق اللون داخل الأنبوب الصحيح ويضيء ببريق ذهبي حتى وعاء الفوز أمام الجميع، وبعدها فقط تظهر نافذة نتيجة الجولة بالتفاصيل</li>
        <li><b>الفوز:</b> كل لاعب اختار رقم الأنبوب الذي وصل فعلياً لوعاء الفوز يكسب نقاطاً تُضاف مباشرة لرصيده الإجمالي في لوحة الصدارة</li>
        <li><b>المستويات:</b> 5 مستويات تزداد فيها الأنابيب تشابكاً وصعوبة (من 6 أنابيب حتى 10)، والمستويان الأخيران بشكل دائري بدل الخطوط المستقيمة، وكل مستوى أصعب يمنح نقاطاً أكبر للفائزين</li>
        <li>يختار المستضيف المستوى قبل بدء كل جولة، ولا يمكن تغييره أثناء وقت الاختيار أو لحظة إعلان النتيجة</li>
        <li>يقدر المستضيف إنهاء وقت الاختيار مبكراً بزر "⏩ إنهاء الوقت الآن"، وزر "🏁 إنهاء اللعبة وعرض النتائج" يعرض النتيجة الكاملة لكل الجولات ولوحة الصدارة الإجمالية ثم يصفّر كل شي تلقائياً استعداداً للعبة جديدة</li>
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

textarea:disabled, input:disabled, select:disabled, button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

textarea { height: 70px; resize: vertical; }
textarea:focus, input:focus, select:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

.round-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.round-time-row input { width: 110px; text-align: center; flex: none; }

.join-settings-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.join-settings-row input[type="text"] { flex: 1; min-width: 140px; width: auto; }

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #ecf0f1;
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
.gift-filter-row input { flex: 1; min-width: 140px; }
.gift-filter-row input[type="number"] { flex: none; width: 170px; }

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
.registration-status { font-weight: bold; color: #f1c40f; }

.levels-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.level-btn {
  flex: 1;
  min-width: 110px;
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  color: #ecf0f1;
  padding: 10px 8px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.6;
}
.level-btn small { font-weight: normal; color: #bdc3c7; }
.level-btn.level-active { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); background: #3a2f14; }

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
.end-btn { background: #8A1538; box-shadow: 0 4px 15px rgba(138, 21, 56, 0.4); }

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
.rules-box h2 { color: var(--primary-color); text-align: center; margin-bottom: 15px; font-size: 1.4rem; }
.rules-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
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
  color: #ecf0f1;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px;
  width: 100%;
  text-align: center;
}

.pipe-caption {
  text-align: center;
  font-size: 0.92rem;
  color: #ccd6e0;
  margin-bottom: 10px;
  min-height: 1.3em;
}

.timer-display {
  text-align: center;
  font-size: 30px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 10px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}
.timer-display.urgent { color: #ff4757; }

.pipe-arena { width: 100%; display: flex; flex-direction: column; align-items: center; }

.pipe-placeholder { text-align: center; color: #8b93a3; padding: 40px 10px; font-size: 0.95rem; }

.pipe-svg { width: 100%; max-width: 560px; height: auto; direction: ltr; }

.pipe-tube-outer { fill: none; stroke: #05060a; stroke-width: 18; stroke-linecap: round; stroke-linejoin: round; }
.pipe-tube-inner { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 12; stroke-linecap: round; stroke-linejoin: round; }

.pipe-flow {
  fill: none;
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 100;
  opacity: 0;
}

.pipe-flow.is-correct-reveal {
  stroke-width: 10;
  opacity: 1;
  transition: stroke-dashoffset 0.95s ease-out, opacity 0.15s ease, stroke-width 0.3s ease, filter 0.3s ease;
  filter: drop-shadow(0 0 7px currentColor);
}

.pipe-flow.is-wrong-reveal {
  opacity: 0.1;
  transition: opacity 0.5s ease;
}

.pipe-cap { fill: #2a2a40; stroke: #555; stroke-width: 2; }

.vessel-glow { fill: rgba(243,156,18,0.25); filter: blur(6px); animation: vesselPulse 1.6s ease-in-out infinite; }
.vessel-cup { fill: #1e1e2f; stroke: var(--primary-color); stroke-width: 3; }
.vessel-icon { font-size: 16px; }
.win-vessel.is-filled .vessel-cup { fill: var(--primary-color); }
.win-vessel.is-filled .vessel-glow { animation: none; opacity: 0.9; }

@keyframes vesselPulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}

.source-badge text { font-size: 15px; font-weight: bold; user-select: none; pointer-events: none; }
.source-badge circle { transition: filter 0.2s, transform 0.2s; }
.source-badge.armed { cursor: pointer; }
.source-badge.armed:hover circle { filter: drop-shadow(0 0 6px #fff); transform: scale(1.08); }
.source-badge.is-correct circle { stroke-width: 5; filter: drop-shadow(0 0 10px gold); }

.awaiting-chips-wrap {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255,255,255,0.12);
}

.chips-row { display: flex; flex-wrap: wrap; gap: 6px; }

.player-chip {
  background: #1e1e2f;
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
  background: #1e1e2f;
  border: 1px solid var(--success-color);
  padding: 5px 10px;
  border-radius: 16px;
  font-size: 0.85rem;
}

.leaderboard-list, .players-list { display: flex; flex-direction: column; gap: 6px; width: 100%; }

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

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: #1e1e2f;
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
  z-index: 100;
  padding: 15px;
}

.modal-content {
  background: #2a2a40;
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
