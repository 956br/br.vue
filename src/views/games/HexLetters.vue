<script setup>
import {
  ref, reactive, computed, watch, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, getGiftName, GIFT_OPTIONS, isLeaveComment,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';
import QUESTIONS from '../../data/letterQuestions.json';

const router = useRouter();
const ROUND_WINS_KEY = 'hexLetters_roundWins';
const LEVELS = [4, 5, 6];

// ===== بنك الأسئلة: مجمّع حسب الحرف، وكل سؤال ما يتكرر بنفس الجلسة إلا لو خلصت أسئلة حرفه =====
const questionsByLetter = QUESTIONS.reduce((acc, q) => {
  (acc[q.letter] ||= []).push(q);
  return acc;
}, {});
const ALL_LETTERS = Object.keys(questionsByLetter);
const usedQuestions = new Set();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// إجابات تيك توك يخفي تعليقاتها (شتايم أو عنف)، فما تنفع بنسخة البث — تبقى بس لنسخة الشات الداخلي
const TIKTOK_BLOCKED_ANSWERS = new Set([
  'بقرة', 'كلب', 'حمار وحشي', 'تيس', 'ثور', 'جرو', 'خروف', 'نعجة', 'ماعز', 'ضأن', 'جاموس',
  'قرد', 'شمبانزي', 'غوريلا', 'ضبع', 'حرباء', 'ذليل', 'ظالم', 'ظلوم', 'لئيم', 'لص', 'كذب',
  'عدو', 'ميت', 'ضحية', 'ذبيحة', 'جزار', 'دم', 'ضرب', 'ثأر', 'سكين', 'خنجر', 'رصاص',
  'ذخيرة', 'دبابة', 'صاروخ', 'سرطان',
]);

function takeQuestion(letter, exclude = null) {
  const all = questionsByLetter[letter] || [];
  const list = isChatMode() ? all : all.filter((q) => !TIKTOK_BLOCKED_ANSWERS.has(q.answer));
  let unused = list.filter((q) => !usedQuestions.has(q) && q !== exclude);
  if (unused.length === 0) {
    list.forEach((q) => usedQuestions.delete(q));
    unused = list.filter((q) => q !== exclude);
    if (unused.length === 0) unused = list;
  }
  const q = unused[Math.floor(Math.random() * unused.length)];
  usedQuestions.add(q);
  return q;
}

// ===== مطابقة الإجابة: نتجاهل التشكيل والهمزات والتاء المربوطة والمسافات، وتكفي حروف الإجابة
// متتابعة بأي مكان بالتعليق (الإجابة "كويت" تقبل "الكويت" و"دولة الكويت") =====
function normText(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .toLowerCase()
    .replace(/[^ء-ي0-9a-z]+/g, '');
}
function isCorrectAnswer(comment, answer) {
  const a = normText(String(answer).trim().replace(/^ال(?=..)/, ''));
  const c = normText(comment);
  return a.length > 0 && c.includes(a);
}

// ===== الفريقين: كل فريق يختار لونه، والأول يوصل يمين ↔ يسار والثاني فوق ↕ تحت =====
const TEAM_COLORS = [
  { id: 'red', label: 'الأحمر', emoji: '🔴', color: '#e74c3c' },
  { id: 'blue', label: 'الأزرق', emoji: '🔵', color: '#3498db' },
  { id: 'green', label: 'الأخضر', emoji: '🟢', color: '#2ecc71' },
  { id: 'yellow', label: 'الأصفر', emoji: '🟡', color: '#f1c40f' },
  { id: 'orange', label: 'البرتقالي', emoji: '🟠', color: '#e67e22' },
  { id: 'purple', label: 'البنفسجي', emoji: '🟣', color: '#9b59b6' },
  { id: 'brown', label: 'البني', emoji: '🟤', color: '#a0522d' },
  { id: 'white', label: 'الأبيض', emoji: '⚪', color: '#ecf0f1' },
  { id: 'pink', label: 'الوردي', emoji: '🩷', color: '#ff6fae' },
];
// لون مخصص: المستضيف يكتب كوده (مثل #00bcd4 أو 00bcd4)
const CUSTOM_ID = 'custom';
const customColorInputs = reactive({ a: '#00bcd4', b: '#ff5722' });
function parseHexColor(raw) {
  const v = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split('').map((ch) => ch + ch).join('')}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toLowerCase();
  return null;
}
const customColorValid = (key) => parseHexColor(customColorInputs[key]) !== null;
function colorOf(key, colorId = teams[key].colorId) {
  if (colorId !== CUSTOM_ID) return TEAM_COLORS.find((x) => x.id === colorId);
  return {
    id: CUSTOM_ID, label: 'المميز', emoji: '🎨', color: parseHexColor(customColorInputs[key]) || '#00bcd4',
  };
}
const defaultTeamName = (c) => `الفريق ${c.label}`;
// رمز الانضمام الافتراضي = اسم اللون بدون "ال" (أحمر، أخضر...)
const defaultJoinWord = (c) => c.label.replace(/^ال/, '');
const joinWords = reactive({ a: defaultJoinWord(TEAM_COLORS[0]), b: defaultJoinWord(TEAM_COLORS[2]) });

const teams = reactive({
  a: { key: 'a', colorId: 'red', name: '', emoji: '', color: '', dir: 'يوصل اليمين باليسار ↔' },
  b: { key: 'b', colorId: 'green', name: '', emoji: '', color: '', dir: 'يوصل فوق بتحت ↕' },
});
const teamNameInputs = reactive({ a: defaultTeamName(TEAM_COLORS[0]), b: defaultTeamName(TEAM_COLORS[2]) });

function syncTeams() {
  ['a', 'b'].forEach((key) => {
    const c = colorOf(key);
    teams[key].emoji = c.emoji;
    teams[key].color = c.color;
    teams[key].name = teamNameInputs[key].trim() || defaultTeamName(c);
  });
}
function pickTeamColor(key, colorId) {
  const other = key === 'a' ? 'b' : 'a';
  if (colorId !== CUSTOM_ID && teams[other].colorId === colorId) return;
  const oldColor = colorOf(key);
  const newColor = colorOf(key, colorId);
  // لو الاسم أو رمز الانضمام لسا الافتراضي، يتغير مع اللون
  if (teamNameInputs[key].trim() === defaultTeamName(oldColor) || !teamNameInputs[key].trim()) {
    teamNameInputs[key] = defaultTeamName(newColor);
  }
  if (joinWords[key].trim() === defaultJoinWord(oldColor) || !joinWords[key].trim()) {
    joinWords[key] = defaultJoinWord(newColor);
  }
  teams[key].colorId = colorId;
  syncTeams();
}
syncTeams();

function loadRoundWins() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROUND_WINS_KEY) || 'null');
    if (!parsed || typeof parsed.a !== 'number' || typeof parsed.b !== 'number') return null;
    return parsed;
  } catch (e) { return null; }
}
const roundWins = reactive(loadRoundWins() || { a: 0, b: 0 });
function saveRoundWins() {
  try { localStorage.setItem(ROUND_WINS_KEY, JSON.stringify(roundWins)); } catch (e) { /* noop */ }
}

// ===== اللاعبين: كل مشاهد ينضم لفريق برمزه، وبعدها ما يقدر يغيّر — النقل بين الفرق للمستضيف فقط =====
const players = reactive([]);
let playerIdCounter = 1;
const newPlayerName = ref('');
const newPlayerTeam = ref('a');
const teamPlayers = (key) => players.filter((p) => p.team === key);
const playersA = computed(() => teamPlayers('a'));
const playersB = computed(() => teamPlayers('b'));

function smallerTeam() {
  return playersA.value.length <= playersB.value.length ? 'a' : 'b';
}

function addPlayer() {
  const name = newPlayerName.value.trim();
  if (!name) return;
  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً!`]);
    return;
  }
  players.push({ id: playerIdCounter++, name, avatar: '', team: newPlayerTeam.value, correct: 0 });
  newPlayerName.value = '';
}

function addPlayerFromLive(name, avatar, teamKey = null) {
  // اللاعب المسجل ما يتغير فريقه لو كتب رمز الفريق الثاني
  if (!name || players.some((p) => p.name === name)) return;
  const team = teamKey || smallerTeam();
  players.push({
    id: playerIdCounter++, name, avatar: avatar || getUserAvatar(name), team, correct: 0,
  });
  appendLog(`➕ ${name} انضم لـ ${teams[team].emoji} ${teams[team].name}`, team);
}

function removePlayer(id) {
  const idx = players.findIndex((p) => p.id === id);
  if (idx !== -1) players.splice(idx, 1);
}
function clearPlayers() { players.splice(0, players.length); }
function switchTeam(p) { p.team = p.team === 'a' ? 'b' : 'a'; }

// ===== الشبكة السداسية (صفوف متداخلة: الصفوف الفردية مزاحة نص خلية) =====
const levelInput = ref(5);
const boardSize = ref(5);
const cells = ref([]);

const NEIGHBORS_EVEN = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
const NEIGHBORS_ODD = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];
function neighbors(cell) {
  const n = boardSize.value;
  const deltas = cell.r % 2 === 0 ? NEIGHBORS_EVEN : NEIGHBORS_ODD;
  return deltas
    .map(([dr, dc]) => [cell.r + dr, cell.c + dc])
    .filter(([r, c]) => r >= 0 && r < n && c >= 0 && c < n)
    .map(([r, c]) => cells.value[r * n + c]);
}

function buildBoard() {
  const n = boardSize.value;
  const total = n * n;
  // الحروف ما تتكرر إلا بمستوى 6 (36 خلية أكثر من 28 حرف)
  let letters = shuffle(ALL_LETTERS);
  while (letters.length < total) letters = letters.concat(shuffle(ALL_LETTERS));
  letters = letters.slice(0, total);
  cells.value = letters.map((letter, i) => ({
    idx: i, num: i + 1, r: Math.floor(i / n), c: i % n, letter, owner: null, win: false, burned: false,
  }));
}

function cellStyle(cell) {
  return {
    '--x': cell.c + (cell.r % 2 ? 0.5 : 0),
    '--y': cell.r * 0.866,
  };
}
function ownerStyle(cell) {
  if (!cell.owner) return {};
  const color = teams[cell.owner].color;
  return {
    '--owner-color': color,
  };
}
const boardStyle = computed(() => ({ '--n': boardSize.value }));

// ===== مراحل اللعب =====
const phase = ref('idle'); // idle | pick | drawing | question | sabotage | ended

function readSeconds(input, min, max, fallback) {
  let v = parseInt(input.value, 10);
  if (Number.isNaN(v)) v = fallback;
  v = Math.max(min, Math.min(max, v));
  input.value = v;
  return v;
}

const levelLocked = computed(() => ['drawing', 'question', 'sabotage'].includes(phase.value)
  || (phase.value === 'pick' && cells.value.some((c) => c.owner)));

function selectLevel(n) {
  if (levelLocked.value) return;
  levelInput.value = n;
  boardSize.value = n;
  buildBoard();
}

function startGame() {
  clearSabotageQueue();
  syncTeams();
  boardSize.value = levelInput.value;
  buildBoard();
  current.value = null;
  lastResult.value = null;
  drawnPlayer.value = null;
  phase.value = 'pick';
  appendLog(`🚀 بدأت لعبة جديدة بمستوى ${boardSize.value}×${boardSize.value}`);
}

// ===== القرعة: نفس الشخص ما ينسحب مرتين خلال أي 3 قرعات متتالية =====
const drawScope = ref('all');
const drawScopeOptions = computed(() => [
  { value: 'all', label: '👥 القرعة بين الكل' },
  { value: 'a', label: `${teams.a.emoji} القرعة من ${teams.a.name} فقط` },
  { value: 'b', label: `${teams.b.emoji} القرعة من ${teams.b.name} فقط` },
]);
const drawHistory = []; // ids آخر المسحوبين
const drawnPlayer = ref(null);
const drawOverlay = ref(false);
const rollingName = ref('');
let rollingTimer = null;
let drawOverlayTimer = null;

function drawEligible() {
  const pool = drawScope.value === 'all' ? [...players] : players.filter((p) => p.team === drawScope.value);
  if (pool.length === 0) return [];
  // 4 لاعبين أو أقل: قاعدة الـ3 قرعات تتوقف، ونمنع بس إن نفس الشخص يطلع مرتين ورا بعض
  const recent = drawHistory.slice(pool.length <= 4 ? -1 : -2);
  let eligible = pool.filter((p) => !recent.includes(p.id));
  if (eligible.length === 0) eligible = pool;
  return eligible;
}

function startDraw() {
  if (phase.value !== 'pick' || rollingTimer) return;
  const eligible = drawEligible();
  if (eligible.length === 0) {
    openModal('تنبيه', ['ما فيه لاعبين بالقرعة — سجّل أسماء أول أو غيّر نطاق القرعة.']);
    return;
  }
  const chosen = eligible[Math.floor(Math.random() * eligible.length)];
  drawnPlayer.value = null;
  drawOverlay.value = true;
  let ticks = 0;
  rollingTimer = setInterval(() => {
    rollingName.value = eligible[Math.floor(Math.random() * eligible.length)].name;
    ticks++;
    if (ticks < 20) return;
    clearInterval(rollingTimer);
    rollingTimer = null;
    rollingName.value = '';
    drawHistory.push(chosen.id);
    if (drawHistory.length > 10) drawHistory.shift();
    drawnPlayer.value = chosen;
    phase.value = 'drawing';
    appendLog(`🎲 القرعة طلعت على ${chosen.name} — يكتب رقم الخلية`, chosen.team);
    // الاسم يبقى معروض بالطبقة شوي، بعدين تنقفل ونرجع لشبكة الحروف والاسم يبقى فوقها
    drawOverlayTimer = setTimeout(closeDrawOverlay, 2500);
  }, 90);
}

function closeDrawOverlay() {
  if (rollingTimer) return;
  if (drawOverlayTimer) { clearTimeout(drawOverlayTimer); drawOverlayTimer = null; }
  drawOverlay.value = false;
}

function cancelDraw() {
  if (phase.value !== 'drawing') return;
  closeDrawOverlay();
  drawnPlayer.value = null;
  phase.value = 'pick';
}

function pickFromComment(player, text) {
  const m = normalizeDigits(text).match(/\d+/);
  if (!m) return;
  const cell = cells.value[parseInt(m[0], 10) - 1];
  if (!cell || cell.owner) return;
  openQuestion(cell, player);
}

// ===== السؤال: أسرع إجابة صحيحة من لاعب مسجل تاخذ الخلية لفريقه =====
const current = ref(null); // { cell, q, pickedBy }
const answerShown = ref(false);
const lastResult = ref(null); // { answer, letter, num, winnerName, team }
const resultOverlay = ref(false);
let pendingWinLines = null;

function onCellClick(cell) {
  // وقت الإلغاء: المستضيف يقدر يضغط الخلية عن الداعم
  if (phase.value === 'sabotage') { applySabotage(cell); return; }
  if (cell.owner || !['pick', 'drawing'].includes(phase.value) || rollingTimer) return;
  openQuestion(cell, null);
}

function openQuestion(cell, pickedBy) {
  closeDrawOverlay();
  drawnPlayer.value = null;
  current.value = { cell, q: takeQuestion(cell.letter), pickedBy };
  answerShown.value = false;
  phase.value = 'question';
  appendLog(`🔠 انفتحت الخلية ${cell.num} (${cell.letter})${pickedBy ? ` باختيار ${pickedBy.name}` : ''}`, pickedBy?.team);
}

function swapQuestion() {
  if (phase.value !== 'question') return;
  clearClaims();
  current.value = { ...current.value, q: takeQuestion(current.value.cell.letter, current.value.q) };
  answerShown.value = false;
}

function cancelQuestion() {
  if (phase.value !== 'question') return;
  clearClaims();
  current.value = null;
  phase.value = 'pick';
}

// ===== إجابة من مشاهد غير مسجل (خاصية يقدر المستضيف يقفلها):
// نحجز إجابته ونطلب منه يختار فريقه، والمستضيف يقدر يحدد الفريق عنه أو يغيّر السؤال =====
const allowUnregistered = ref(true);
const pendingClaim = ref(null); // { name, avatar }
// الإجابات الصحيحة اللي وصلت وقت الحجز، بالترتيب (مسجلين أو لا)
const claimQueue = [];
const claimQueueSize = ref(0);
const nextInQueue = computed(() => (claimQueueSize.value ? claimQueue[0].name : ''));

function clearClaims() {
  pendingClaim.value = null;
  claimQueue.length = 0;
  claimQueueSize.value = 0;
}

function holdClaim(name, avatar) {
  pendingClaim.value = { name, avatar };
  appendLog(`⚡ ${name} جاوب صح وهو مب مسجل — ينتظر يختار فريقه`);
}

function claimTeamFromText(text) {
  const typed = normText(normalizeDigits(text));
  if (typed === '1') return 'a';
  if (typed === '2') return 'b';
  if (joinWordsClash.value) return null;
  return ['a', 'b'].find((k) => typed === normText(normalizeDigits(getJoinWord(k)))) || null;
}

function resolvePendingClaim(teamKey) {
  if (phase.value !== 'question' || !pendingClaim.value) return;
  const { name, avatar } = pendingClaim.value;
  pendingClaim.value = null;
  addPlayerFromLive(name, avatar, teamKey);
  const player = players.find((p) => p.name === name);
  finishQuestion(player ? player.team : teamKey, player || null);
}

// تجاهل = سكيب: الدور ينتقل لأول واحد جاوب صح بعده. لو مسجل ياخذ الخلية فوراً، ولو مب مسجل تنحجز إجابته هو
function dismissPendingClaim() {
  if (phase.value !== 'question' || !pendingClaim.value) return;
  appendLog(`⏭️ المستضيف تجاهل إجابة ${pendingClaim.value.name}`);
  pendingClaim.value = null;
  while (claimQueue.length) {
    const next = claimQueue.shift();
    claimQueueSize.value = claimQueue.length;
    const player = players.find((p) => p.name === next.name);
    if (player) {
      clearClaims();
      finishQuestion(player.team, player);
      return;
    }
    if (allowUnregistered.value) {
      holdClaim(next.name, next.avatar);
      return;
    }
  }
}

function noAnswer() {
  if (phase.value !== 'question') return;
  finishQuestion(null, null);
}

function awardByHost(teamKey) {
  if (phase.value !== 'question') return;
  finishQuestion(teamKey, null);
}

function finishQuestion(teamKey, player) {
  clearClaims();
  const { cell, q } = current.value;
  lastResult.value = {
    answer: q.answer,
    letter: cell.letter,
    num: cell.num,
    winnerName: player ? player.name : (teamKey ? teams[teamKey].name : ''),
    team: teamKey,
  };
  resultOverlay.value = true;
  current.value = null;
  if (!teamKey) {
    appendLog(`🚫 ما أحد جاوب — الإجابة: ${q.answer} (الخلية ${cell.num} بقت فاضية)`);
    phase.value = 'pick';
    return;
  }
  cell.owner = teamKey;
  if (player) player.correct++;
  appendLog(`✅ ${player ? player.name : 'المستضيف'} أخذ الخلية ${cell.num} لـ ${teams[teamKey].emoji} ${teams[teamKey].name} — الإجابة: ${q.answer}`, teamKey);
  const path = findWinningPath(teamKey);
  if (path) endGame(teamKey, path);
  else phase.value = 'pick';
}

function closeResultOverlay() {
  resultOverlay.value = false;
  if (pendingWinLines) {
    openModal('🏆 نهاية اللعبة', pendingWinLines);
    pendingWinLines = null;
  }
}

// ===== الفوز: BFS من ضلع الفريق الأول لضلعه الثاني، ونرجع أقصر مسار عشان نبرزه =====
function findWinningPath(teamKey) {
  const n = boardSize.value;
  const isStart = (c) => (teamKey === 'a' ? c.c === 0 : c.r === 0);
  const isEnd = (c) => (teamKey === 'a' ? c.c === n - 1 : c.r === n - 1);
  const parent = new Map();
  const queue = cells.value.filter((c) => c.owner === teamKey && isStart(c));
  queue.forEach((c) => parent.set(c.idx, null));
  while (queue.length) {
    const cell = queue.shift();
    if (isEnd(cell)) {
      const path = [];
      for (let k = cell.idx; k !== null; k = parent.get(k)) path.push(cells.value[k]);
      return path;
    }
    neighbors(cell).forEach((nb) => {
      if (nb.owner === teamKey && !parent.has(nb.idx)) {
        parent.set(nb.idx, cell.idx);
        queue.push(nb);
      }
    });
  }
  return null;
}

function endGame(teamKey, path) {
  path.forEach((c) => { c.win = true; });
  clearSabotageQueue();
  phase.value = 'ended';
  roundWins[teamKey]++;
  saveRoundWins();
  const team = teams[teamKey];
  const top = teamPlayers(teamKey).filter((p) => p.correct > 0).sort((x, y) => y.correct - x.correct);
  const lines = [`🏆 فاز ${team.emoji} ${team.name} ووصل الطريق!`];
  if (top.length) lines.push(`⭐ نجوم الفريق: ${top.slice(0, 5).map((p) => `${p.name} (${p.correct})`).join('، ')}`);
  lines.push(`السلسلة: ${teams.a.emoji} ${roundWins.a} - ${roundWins.b} ${teams.b.emoji}`);
  appendLog(lines[0], teamKey);
  pendingWinLines = lines;
}

// ===== إلغاء خلية من الخصم بالهدايا (خاصية يفعّلها المستضيف، بنسخة تيك توك فقط):
// لو أحد أرسل الهدية المختارة قبل اختيار الخلية، يختار رقم خلية مكسوبة للخصم وترجع فاضية =====
const sabotageEnabled = ref(false);
const sabotageGift = ref('');
const sabotage = ref(null); // { name, avatar, team } — team = فريق الداعم، أو null لو مب مسجل
const sabotageOverlay = ref(false);
let sabotageOverlayTimer = null;

// الداعم المسجل يلغي بس من خلايا الفريق الثاني، وغير المسجل من أي خلية مكسوبة
function sabotageTargets(s) {
  return cells.value.filter((c) => c.owner && (!s.team || c.owner !== s.team));
}
const sabotageTargetLabel = computed(() => {
  const s = sabotage.value;
  if (!s || !s.team) return 'من الخلايا المكسوبة';
  const other = teams[s.team === 'a' ? 'b' : 'a'];
  return `من خلايا ${other.emoji} ${other.name}`;
});
const sabotageTargetSet = computed(() => new Set(
  sabotage.value ? sabotageTargets(sabotage.value).map((c) => c.idx) : [],
));

// كل هدية = إلغاء خلية وحدة. الهدايا تنسجل بطابور بالترتيب وتتنفذ بمرحلة اختيار الخلية أو القرعة
// (لو وصلت وقت السؤال أو القرعة أو النتيجة تبقى معلقة لين يجي وقتها).
// الداعم اللي أرسل حزمة (×5 مثلاً) ياخذ 5 إلغاءات ورا بعض لين تخلص هداياه أو خلايا الخصم.
const sabotageQueue = []; // { name, avatar, count }
const sabotageQueueSize = ref(0); // مجموع الإلغاءات المعلقة

function updateSabotageQueueSize() {
  sabotageQueueSize.value = sabotageQueue.reduce((sum, s) => sum + s.count, 0);
}

function clearSabotageQueue() {
  sabotageQueue.length = 0;
  updateSabotageQueueSize();
}

// تيك توك يرسل للهدية الوحدة أكثر من حدث (بداية الكومبو ونهايته، أو تحديث كل ما زاد العدد)
// وكل حدث يحمل repeatCount التراكمي للكومبو. فنحسب بس الزيادة عن آخر حدث لنفس الشخص ونفس الهدية:
// حدث مكرر بنفس العدد = 0، وكومبو يكبر من 3 لـ 5 = +2، وكومبو جديد (العدد رجع أقل أو مر وقت) يبدأ من جديد.
// لو الجسر يرسل repeatEnd نعتمد عليه: الهدايا القابلة للتكرار ما تنحسب إلا بحدث النهاية.
const giftStreaks = new Map(); // `${user}|${gift}` → { count, at }
const STREAK_WINDOW_MS = 4000;

function giftIncrement(data) {
  const count = Math.max(1, parseInt(data.repeatCount, 10) || 1);
  if (data.repeatEnd !== undefined && Number(data.giftType) === 1 && !data.repeatEnd) return 0;
  const key = `${getGiftUser(data)}|${data.giftId ?? getGiftName(data)}`;
  const now = Date.now();
  const prev = giftStreaks.get(key);
  giftStreaks.set(key, { count, at: now });
  if (prev && now - prev.at < STREAK_WINDOW_MS && count >= prev.count) return count - prev.count;
  return count;
}

function onSabotageGift(data) {
  if (!sabotageEnabled.value || isChatMode()) return;
  if (!['pick', 'drawing', 'question', 'sabotage'].includes(phase.value)) return;
  if (!giftPassesFilter(data, { nameFilter: sabotageGift.value })) return;
  const name = getGiftUser(data);
  if (!name) return;
  const count = giftIncrement(data);
  if (count <= 0) return;
  // هدايا إضافية من نفس الداعم تنضاف لرصيده بدل ما يرجع آخر الطابور
  if (sabotage.value?.name === name) {
    sabotage.value.remaining += count;
    appendLog(`🎁 ${name} أضاف ${count} إلغاء — متبقي له ${sabotage.value.remaining}`, sabotage.value.team);
    return;
  }
  const queued = sabotageQueue.find((s) => s.name === name);
  if (queued) queued.count += count;
  else sabotageQueue.push({ name, avatar: data.avatar || getUserAvatar(name), count });
  updateSabotageQueueSize();
  if (!canRunSabotage()) appendLog(`🎁 ${name} أرسل ${count > 1 ? `${count} هدايا إلغاء` : 'هدية الإلغاء'} — معلقة لين مرحلة اختيار الخلية`);
  runQueuedSabotage();
}

function canRunSabotage() {
  return phase.value === 'pick' && !rollingTimer && !sabotage.value
    && !resultOverlay.value && !drawOverlay.value;
}

function runQueuedSabotage() {
  while (canRunSabotage() && sabotageQueue.length) {
    const next = sabotageQueue.shift();
    updateSabotageQueueSize();
    if (startSabotage(next)) return;
  }
}

function startSabotage({ name, avatar, count }) {
  // الفريق يتحدد وقت التنفيذ، عشان لو انضم بعد ما أرسل الهدية
  const player = players.find((p) => p.name === name);
  const s = {
    name, avatar, team: player ? player.team : null, remaining: count,
  };
  if (sabotageTargets(s).length === 0) {
    appendLog(`🎁 إلغاءات ${name} (${count}) انتهت — ما فيه خلايا مكسوبة للخصم`, s.team);
    return false;
  }
  sabotage.value = s;
  phase.value = 'sabotage';
  sabotageOverlay.value = true;
  appendLog(`💥 ${name} قرر يلغي خلية!`, s.team);
  sabotageOverlayTimer = setTimeout(closeSabotageOverlay, 3000);
  return true;
}

watch([phase, resultOverlay, drawOverlay], () => runQueuedSabotage());

function closeSabotageOverlay() {
  if (sabotageOverlayTimer) { clearTimeout(sabotageOverlayTimer); sabotageOverlayTimer = null; }
  sabotageOverlay.value = false;
}

function endSabotage() {
  closeSabotageOverlay();
  sabotage.value = null;
  if (phase.value === 'sabotage') phase.value = 'pick';
}

function applySabotage(cell) {
  if (phase.value !== 'sabotage' || !cell || !sabotageTargetSet.value.has(cell.idx)) return;
  const lostTeam = cell.owner;
  cell.owner = null;
  cell.win = false;
  cell.burned = true;
  setTimeout(() => { cell.burned = false; }, 1200);
  appendLog(`💥 ${sabotage.value.name} ألغى الخلية ${cell.num} (${cell.letter}) من ${teams[lostTeam].emoji} ${teams[lostTeam].name}`, lostTeam);
  nextSabotageAction();
}

// بعد كل إلغاء (أو سكيب): لو باقي له هدايا وفيه خلايا للخصم يكمل، وإلا ينتهي دوره ويجي اللي بعده
function nextSabotageAction() {
  const s = sabotage.value;
  s.remaining--;
  if (s.remaining > 0 && sabotageTargets(s).length > 0) return;
  if (s.remaining > 0) appendLog(`🎁 باقي ${s.remaining} إلغاء لـ ${s.name} راحت — خلصت خلايا الخصم`, s.team);
  endSabotage();
}

function skipSabotage() {
  if (!sabotage.value) return;
  appendLog(`⏭️ المستضيف تخطى إلغاء ${sabotage.value.name}`);
  nextSabotageAction();
}

function skipAllSabotage() {
  if (!sabotage.value) return;
  appendLog(`⏭️ المستضيف تخطى كل إلغاءات ${sabotage.value.name} (${sabotage.value.remaining})`);
  endSabotage();
}

function resetAll() {
  if (rollingTimer) { clearInterval(rollingTimer); rollingTimer = null; }
  closeDrawOverlay();
  clearSabotageQueue();
  endSabotage();
  roundWins.a = 0; roundWins.b = 0;
  saveRoundWins();
  players.forEach((p) => { p.correct = 0; });
  drawHistory.length = 0;
  current.value = null;
  lastResult.value = null;
  resultOverlay.value = false;
  pendingWinLines = null;
  clearClaims();
  drawnPlayer.value = null;
  rollingName.value = '';
  eventLog.value = [];
  phase.value = 'idle';
  boardSize.value = levelInput.value;
  buildBoard();
}

// ===== السجل والنوافذ =====
const eventLog = ref([]);
let logId = 0;
function appendLog(text, team = null) {
  eventLog.value.unshift({ id: ++logId, text, team });
  if (eventLog.value.length > 80) eventLog.value.pop();
}

const showModal = ref(false);
const modalTitle = ref('');
const modalLines = ref([]);
function openModal(title, lines) { modalTitle.value = title; modalLines.value = lines; showModal.value = true; }

const showRules = ref(false);
const playersModalVisible = ref(false);
const joinModalVisible = ref(false);
const barExpanded = ref(true);

const statusText = computed(() => {
  if (phase.value === 'idle') return 'اختر المستوى وسجّل اللاعبين ثم اضغط "بدء اللعبة"';
  if (phase.value === 'pick') return 'المستضيف يضغط على خلية أو يسوي قرعة 🎲';
  if (phase.value === 'drawing' || phase.value === 'sabotage') return '';
  if (phase.value === 'question') return 'السؤال مفتوح...';
  return '🏁 انتهت اللعبة — اضغط "لعبة جديدة"';
});

// ===== ربط تيك توك لايف والانضمام (نفس نظام باقي الألعاب) =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
// كل فريق له رمز انضمام بالكتابة، أو هدية خاصة فيه بوضع الهدايا
const joinViaGift = ref(false);
const giftFilters = reactive({ a: 'Rose', b: 'TikTok' });
const giftMinValue = ref(null);
const giftLabel = (value) => {
  const found = GIFT_OPTIONS.find((g) => g.value === value);
  return found ? found.label : '🎁 أي هدية';
};

function getJoinWord(key) { return joinWords[key].trim() || defaultJoinWord(colorOf(key)); }
const joinWordsClash = computed(() => normText(getJoinWord('a')) === normText(getJoinWord('b')));
const giftsClash = computed(() => giftFilters.a === giftFilters.b);

const joinModeHint = computed(() => (joinViaGift.value
  ? 'كل فريق له هدية: المشاهد يرسل هدية فريقه وقت التسجيل وينضم له. لو اخترت "أي هدية" للفريقين، المنضم يروح للفريق الأقل عدداً.'
  : 'المشاهد يكتب رمز فريقه بالدردشة وقت التسجيل وينضم له. بعد التسجيل ما يقدر يغيّر فريقه — النقل للمستضيف فقط.'));

const registrationOpen = ref(false);
const registrationUnlimited = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => {
  if (!registrationOpen.value) return '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل".';
  if (registrationUnlimited.value) return '🟢 التسجيل مفتوح بدون وقت — يبقى مفتوح لين توقفه.';
  return `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية.`;
});

function startRegistration() {
  if (registrationOpen.value) return;
  registrationOpen.value = true;
  if (registrationTimer) clearInterval(registrationTimer);
  if (registrationUnlimited.value) return;
  registrationTimeLeft.value = readSeconds(registrationDurationInput, 5, 3600, 60);
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
  }, 1000);
}
function extendRegistration() {
  if (!registrationOpen.value || registrationUnlimited.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
}
function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
}

function giftJoinTeam(data) {
  const minValue = giftMinValue.value;
  // الهدية المحددة أولى من "أي هدية" عشان ما ياخذ فريق "أي هدية" كل الهدايا
  const keys = ['a', 'b'].sort((x, y) => Number(!giftFilters[x]) - Number(!giftFilters[y]));
  const matched = keys.filter((k) => giftPassesFilter(data, { nameFilter: giftFilters[k], minValue }));
  if (matched.length === 0) return undefined;
  if (matched.length === 2 && !giftFilters.a && !giftFilters.b) return null; // الفريقين "أي هدية" = الأقل عدداً
  return matched[0];
}

function handleTiktokMessage(data) {
  if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)) {
    const team = giftJoinTeam(data);
    if (team !== undefined) addPlayerFromLive(getGiftUser(data), data.avatar, team);
  }
  if (isGiftEvent(data)) onSabotageGift(data);
  if (!data.comment || !data.user) return;
  const text = String(data.comment).trim();
  // اللاعب كتب "خروج": ينحذف من فريقه بأي وقت (مثل حذف المستضيف له)، ويقدر ينضم من جديد
  if (isLeaveComment(text)) {
    const leaver = players.find((p) => p.name === data.user);
    if (leaver) {
      removePlayer(leaver.id);
      appendLog(`🚪 ${leaver.name} كتب "خروج" وانحذف من ${teams[leaver.team].emoji} ${teams[leaver.team].name}`, leaver.team);
    }
    return;
  }
  // الداعم يكتب رقم الخلية اللي يبي يلغيها
  if (phase.value === 'sabotage' && sabotage.value && sabotage.value.name === data.user) {
    const m = normalizeDigits(text).match(/\d+/);
    if (m) applySabotage(cells.value[parseInt(m[0], 10) - 1]);
    return;
  }
  // صاحب الإجابة المحجوزة يختار فريقه
  if (phase.value === 'question' && pendingClaim.value && pendingClaim.value.name === data.user) {
    const team = claimTeamFromText(text);
    if (team) resolvePendingClaim(team);
    return;
  }
  if (registrationOpen.value && !joinViaGift.value && !joinWordsClash.value) {
    const typed = normText(normalizeDigits(text));
    const team = ['a', 'b'].find((k) => typed === normText(normalizeDigits(getJoinWord(k))));
    // اللاعب المسجل لو كتب الرمز نكمل عادي (يمكن تكون إجابة)، وما يتغير فريقه
    if (team && !players.some((p) => p.name === data.user)) {
      addPlayerFromLive(data.user, data.avatar, team);
      return;
    }
  }
  const player = players.find((p) => p.name === data.user);
  if (phase.value === 'drawing') {
    if (player && drawnPlayer.value && player.id === drawnPlayer.value.id) pickFromComment(player, text);
    return;
  }
  if (phase.value !== 'question') return;
  if (!player && !allowUnregistered.value) return;
  if (!isCorrectAnswer(text, current.value.q.answer)) return;
  // فيه إجابة محجوزة: نسجل الصح بعدها بالترتيب عشان لو المستضيف تجاهلها تروح للي بعده
  if (pendingClaim.value) {
    if (!claimQueue.some((c) => c.name === data.user)) {
      claimQueue.push({ name: data.user, avatar: data.avatar || getUserAvatar(data.user) });
      claimQueueSize.value = claimQueue.length;
    }
    return;
  }
  if (player) finishQuestion(player.team, player);
  else holdClaim(data.user, data.avatar || getUserAvatar(data.user));
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'hex-letters', onMessage: handleTiktokMessage });
}

function handleGlobalKeydown(e) {
  if (e.code !== 'Space') return;
  const el = document.activeElement;
  if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
  e.preventDefault();
  if (showRules.value || showModal.value) return;
  if (resultOverlay.value) { closeResultOverlay(); return; }
  if (drawOverlay.value) { closeDrawOverlay(); return; }
  if (sabotageOverlay.value) { closeSabotageOverlay(); return; }
  if (phase.value === 'idle' || phase.value === 'ended') startGame();
  else if (phase.value === 'pick') startDraw();
}

function goHome() { router.push('/'); }

onMounted(() => {
  buildBoard();
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromLive(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (rollingTimer) clearInterval(rollingTimer);
  if (drawOverlayTimer) clearTimeout(drawOverlayTimer);
  if (sabotageOverlayTimer) clearTimeout(sabotageOverlayTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🔠 تحدي الحروف</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetAll">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="showRules = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">السلسلة: {{ teams.a.emoji }} {{ roundWins.a }} - {{ roundWins.b }} {{ teams.b.emoji }}</div>
  </div>

  <div class="top-names-section">
    <label>🎚️ المستوى (يختاره المستضيف):</label>
    <div class="level-row">
      <button
        v-for="n in LEVELS"
        :key="n"
        type="button"
        class="level-btn"
        :class="{ active: levelInput === n }"
        :disabled="levelLocked"
        @click="selectLevel(n)"
      >{{ n }}×{{ n }}<small>{{ n * n }} خلية</small></button>
    </div>
    <div class="field-hint">المستوى يتغير قبل بداية اللعبة أو بعد نهايتها. بمستوى 6 تتكرر بعض الحروف لأن الخلايا أكثر من الحروف.</div>
  </div>

  <div class="top-names-section">
    <label>👥 الفريقين (الاسم واللون):</label>
    <div v-for="key in ['a', 'b']" :key="key" class="team-setup" :style="{ borderColor: teams[key].color }">
      <div class="team-setup-head">
        <span class="team-setup-dir" :style="{ color: teams[key].color }">{{ teams[key].emoji }} {{ teams[key].dir }}</span>
        <input v-model="teamNameInputs[key]" type="text" maxlength="30" @input="syncTeams">
      </div>
      <div class="swatches">
        <button
          v-for="c in TEAM_COLORS"
          :key="c.id"
          type="button"
          class="swatch"
          :class="{ selected: teams[key].colorId === c.id }"
          :style="{ background: c.color }"
          :disabled="teams[key === 'a' ? 'b' : 'a'].colorId === c.id"
          :title="c.label"
          @click="pickTeamColor(key, c.id)"
        ></button>
        <button
          type="button"
          class="swatch swatch-custom"
          :class="{ selected: teams[key].colorId === CUSTOM_ID }"
          :style="{ background: parseHexColor(customColorInputs[key]) || 'transparent' }"
          title="لون مخصص"
          @click="pickTeamColor(key, CUSTOM_ID)"
        >🎨</button>
      </div>
      <div v-if="teams[key].colorId === CUSTOM_ID" class="custom-color-row">
        <span class="inline-label">كود اللون:</span>
        <input
          v-model="customColorInputs[key]"
          type="text"
          maxlength="7"
          placeholder="#00bcd4"
          dir="ltr"
          :class="{ invalid: !customColorValid(key) }"
          @input="syncTeams"
        >
        <span class="custom-preview" :style="{ background: teams[key].color }"></span>
        <span v-if="!customColorValid(key)" class="clash-warning" style="margin:0;">الكود غلط — اكتب 6 خانات مثل #ff00aa</span>
      </div>
    </div>
    <label class="join-gift-toggle" for="hexAllowUnregistered" style="margin-bottom:10px;">
      <input id="hexAllowUnregistered" v-model="allowUnregistered" type="checkbox">
      ⚡ قبول إجابة غير المسجلين (تنحجز إجابته ويختار فريقه)
    </label>
    <template v-if="!isChatMode()">
      <label class="join-gift-toggle" for="hexSabotage" style="margin-bottom:8px;">
        <input id="hexSabotage" v-model="sabotageEnabled" type="checkbox">
        💥 إلغاء خلية من الخصم بالهدايا
      </label>
      <div v-if="sabotageEnabled" style="margin-bottom:10px;">
        <CustomSelect v-model="sabotageGift" :options="GIFT_OPTIONS" />
        <div class="field-hint">اللي يرسل هذي الهدية يكتب رقم خلية مكسوبة للخصم وترجع فاضية. لو وصلت نص الجولة تنحفظ وتتنفذ بمرحلة اختيار الخلية.</div>
      </div>
    </template>
    <CustomSelect v-model="drawScope" :options="drawScopeOptions" />
    <div class="field-hint">القرعة ما تطلع نفس الشخص مرتين خلال أي 3 قرعات متتالية. لو اللاعبين 4 أو أقل: بس ما يطلع نفس الشخص مرتين ورا بعض.</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="phase === 'idle' || phase === 'ended'" class="master-btn side-panel-btn" @click="startGame">{{ phase === 'idle' ? '🚀 بدء اللعبة' : '🔄 لعبة جديدة' }}</button>
    <button v-if="phase === 'pick'" class="master-btn side-panel-btn" @click="startDraw">🎲 قرعة</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="playersModalVisible = true">👥 {{ teams.a.emoji }} {{ playersA.length }} | {{ playersB.length }} {{ teams.b.emoji }}</button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="joinModalVisible = true">
        🎟️ {{ teams.a.emoji }} {{ joinViaGift ? giftLabel(giftFilters.a) : getJoinWord('a') }} | {{ joinViaGift ? giftLabel(giftFilters.b) : getJoinWord('b') }} {{ teams.b.emoji }}
      </button>
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? `⛔ إيقاف التسجيل${registrationUnlimited ? '' : ` (${registrationTimeLeft})`}` : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div class="layout-wrapper">
    <div class="panel board-panel">
      <div
        v-if="phase === 'drawing' && drawnPlayer && !drawOverlay"
        class="drawn-banner"
        :style="{ borderColor: teams[drawnPlayer.team].color }"
      >
        <span>🎯 الدور على</span>
        <b :style="{ color: teams[drawnPlayer.team].color }">{{ drawnPlayer.name }}</b>
        <span>— اكتب رقم الخلية بالتعليقات</span>
        <button type="button" class="banner-cancel" title="إلغاء القرعة" @click="cancelDraw">✖️</button>
      </div>
      <div
        v-else-if="phase === 'sabotage' && sabotage && !sabotageOverlay"
        class="drawn-banner sabotage-banner"
      >
        <span>💥</span>
        <b>{{ sabotage.name }}</b>
        <span>يلغي خلية — اكتب رقم خلية {{ sabotageTargetLabel }}</span>
        <span v-if="sabotage.remaining > 1" class="remaining-chip">×{{ sabotage.remaining }}</span>
        <button type="button" class="skip-btn" @click="skipSabotage">⏭️ سكيب</button>
        <button v-if="sabotage.remaining > 1" type="button" class="skip-btn" @click="skipAllSabotage">⏭️ سكيب الكل</button>
      </div>
      <div v-else class="status-line">{{ statusText }}</div>
      <div v-if="sabotageQueueSize" class="queue-badge">🎁 إلغاءات معلقة: {{ sabotageQueueSize }} — تتنفذ بعد السؤال</div>

      <div class="hex-frame" :style="boardStyle">
        <div class="edge edge-left" :style="{ background: teams.a.color }"></div>
        <div class="edge edge-right" :style="{ background: teams.a.color }"></div>
        <div class="edge edge-top" :style="{ background: teams.b.color }"></div>
        <div class="edge edge-bottom" :style="{ background: teams.b.color }"></div>
        <div class="hex-board">
          <div
            v-for="cell in cells"
            :key="cell.idx"
            class="hex-slot"
            :class="{
              clickable: (!cell.owner && (phase === 'pick' || phase === 'drawing')) || sabotageTargetSet.has(cell.idx),
              active: current && current.cell === cell,
              win: cell.win,
              target: sabotageTargetSet.has(cell.idx),
              dimmed: phase === 'sabotage' && !sabotageTargetSet.has(cell.idx),
              burned: cell.burned,
            }"
            :style="cellStyle(cell)"
            @click="onCellClick(cell)"
          >
            <div class="hex-cell" :class="{ owned: cell.owner }" :style="ownerStyle(cell)">
              <div class="hex-inner">
                <span class="hex-letter">{{ cell.letter }}</span>
                <span class="hex-num">{{ cell.num }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="dir-legend">
        <span :style="{ color: teams.a.color }">{{ teams.a.emoji }} {{ teams.a.name }}: {{ teams.a.dir }}</span>
        <span :style="{ color: teams.b.color }">{{ teams.b.emoji }} {{ teams.b.name }}: {{ teams.b.dir }}</span>
      </div>
    </div>

    <div class="side-col">
      <div class="panel teams-panel">
        <div v-for="key in ['a', 'b']" :key="key" class="team-col" :style="{ borderColor: teams[key].color }">
          <div class="team-title" :style="{ color: teams[key].color }">{{ teams[key].emoji }} {{ teams[key].name }}</div>
          <div class="team-count">{{ cells.filter((c) => c.owner === key).length }} خلية</div>
          <div v-for="p in teamPlayers(key)" :key="p.id" class="team-player">
            <img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">
            <span>{{ p.name }}</span>
            <span v-if="p.correct" class="p-score">⭐{{ p.correct }}</span>
          </div>
          <div v-if="teamPlayers(key).length === 0" class="field-hint">ما فيه لاعبين</div>
        </div>
      </div>

      <div class="panel">
        <h3>📜 سجل الأحداث</h3>
        <div class="event-log-panel">
          <div v-if="eventLog.length === 0" class="field-hint">لا توجد أحداث بعد</div>
          <div v-for="log in eventLog" :key="log.id" class="log-item" :style="log.team ? { borderRightColor: teams[log.team].color } : {}">{{ log.text }}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- طبقة إلغاء الخلية بالهدية -->
  <div v-if="sabotageOverlay && sabotage" class="game-overlay" @click.self="closeSabotageOverlay">
    <div class="overlay-card sabotage-card">
      <img v-if="sabotage.avatar" :src="sabotage.avatar" class="sabotage-avatar" alt="">
      <div class="overlay-label">🎁 الداعم</div>
      <div class="draw-name landed" :style="sabotage.team ? { color: teams[sabotage.team].color } : {}">{{ sabotage.name }}</div>
      <div class="sabotage-title">💥 قرر يلغي {{ sabotage.remaining > 1 ? `${sabotage.remaining} خلايا` : 'خلية' }}!</div>
      <div class="overlay-sub">يكتب رقم خلية {{ sabotageTargetLabel }}</div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="skip-btn" @click="skipSabotage">⏭️ سكيب</button>
        <button v-if="sabotage.remaining > 1" type="button" class="skip-btn" @click="skipAllSabotage">⏭️ سكيب الكل</button>
      </div>
    </div>
  </div>

  <!-- طبقة القرعة -->
  <div v-if="drawOverlay" class="game-overlay" @click.self="closeDrawOverlay">
    <div class="overlay-card draw-card" :style="drawnPlayer ? { borderColor: teams[drawnPlayer.team].color } : {}">
      <template v-if="!drawnPlayer">
        <div class="overlay-label">🎲 القرعة...</div>
        <div class="draw-name rolling">{{ rollingName }}</div>
      </template>
      <template v-else>
        <div class="overlay-label">القرعة طلعت على</div>
        <div class="draw-name landed" :style="{ color: teams[drawnPlayer.team].color }">{{ drawnPlayer.name }}</div>
        <div class="overlay-sub">{{ teams[drawnPlayer.team].emoji }} {{ teams[drawnPlayer.team].name }} — اختار رقم الخلية</div>
      </template>
    </div>
  </div>

  <!-- طبقة السؤال -->
  <div v-if="phase === 'question' && current" class="game-overlay">
    <div class="overlay-card question-card">
      <div class="q-head">
        <div class="q-letter">{{ current.cell.letter }}</div>
        <div class="q-cellnum">الخلية رقم <b>{{ current.cell.num }}</b></div>
      </div>
      <div class="q-text">{{ current.q.question }}</div>
      <div v-if="pendingClaim" class="pending-claim">
        <div class="pending-title">⚡ <b>{{ pendingClaim.name }}</b> جاوب صح بس مب مسجل بفريق!</div>
        <div class="pending-sub">
          اكتب رقم فريقك بالتعليقات:
          <b :style="{ color: teams.a.color }">1 أو "{{ getJoinWord('a') }}" {{ teams.a.emoji }}</b>
          —
          <b :style="{ color: teams.b.color }">2 أو "{{ getJoinWord('b') }}" {{ teams.b.emoji }}</b>
        </div>
        <div class="host-actions">
          <button type="button" :style="{ background: teams.a.color }" @click="resolvePendingClaim('a')">ضمّه لـ {{ teams.a.emoji }}</button>
          <button type="button" :style="{ background: teams.b.color }" @click="resolvePendingClaim('b')">ضمّه لـ {{ teams.b.emoji }}</button>
          <button type="button" class="rules-btn" @click="swapQuestion">🔁 تغيير السؤال</button>
          <button type="button" class="cancel-btn" @click="dismissPendingClaim">⏭️ تجاهل{{ nextInQueue ? ` (التالي: ${nextInQueue})` : '' }}</button>
        </div>
        <div class="pending-queue">
          {{ claimQueueSize ? `👥 ${claimQueueSize} جاوبوا صح بعده بالترتيب` : 'ما أحد جاوب صح بعده للحين — لو تجاهلت يرجع السؤال مفتوح' }}
        </div>
      </div>
      <div v-else class="q-hint">أسرع إجابة صحيحة بالتعليقات تاخذ الخلية!</div>
      <div class="q-answer-host">
        <span v-if="answerShown">الإجابة: <b>{{ current.q.answer }}</b></span>
        <button v-else type="button" class="peek-btn" @click="answerShown = true">👁️ إظهار الإجابة للمستضيف</button>
      </div>
      <div class="host-actions">
        <button type="button" :style="{ background: teams.a.color }" @click="awardByHost('a')">✓ {{ teams.a.emoji }}</button>
        <button type="button" :style="{ background: teams.b.color }" @click="awardByHost('b')">✓ {{ teams.b.emoji }}</button>
        <button type="button" class="rules-btn" @click="swapQuestion">🔁 سؤال آخر</button>
        <button type="button" class="reset-btn" @click="noAnswer">🚫 ما أحد جاوب</button>
        <button type="button" class="cancel-btn" @click="cancelQuestion">✖️ إلغاء</button>
      </div>
    </div>
  </div>

  <!-- طبقة النتيجة -->
  <div v-if="resultOverlay && lastResult" class="game-overlay" @click.self="closeResultOverlay">
    <div class="overlay-card result-card" :style="lastResult.team ? { borderColor: teams[lastResult.team].color } : {}">
      <div class="overlay-label">الإجابة الصحيحة ({{ lastResult.letter }} — خلية {{ lastResult.num }})</div>
      <div class="reveal-answer">{{ lastResult.answer }}</div>
      <div v-if="lastResult.team" class="reveal-winner" :style="{ color: teams[lastResult.team].color, borderColor: teams[lastResult.team].color }">
        ⚡ أول من جاوب: {{ lastResult.winnerName }} {{ teams[lastResult.team].emoji }}
      </div>
      <div v-else class="reveal-winner none">🚫 ما أحد جاوب صح — الخلية بقت فاضية</div>
      <button class="master-btn" style="margin-top:18px;" @click="closeResultOverlay">متابعة ⬅️</button>
    </div>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="playersModalVisible = false">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ players.length }})</h3>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="addPlayer">
        <button type="button" class="team-pick-btn" :style="{ background: teams[newPlayerTeam].color }" @click="newPlayerTeam = newPlayerTeam === 'a' ? 'b' : 'a'">{{ teams[newPlayerTeam].emoji }}</button>
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayer">➕</button>
      </div>
      <div class="field-hint">اضغط الدائرة الملونة عشان تختار فريق الاسم الجديد.</div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in players" :key="p.id" class="players-modal-item" :style="{ borderRight: `4px solid ${teams[p.team].color}` }">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
          <span style="display:flex; gap:6px;">
            <button type="button" class="team-pick-btn small" :style="{ background: teams[p.team].color }" title="نقل للفريق الثاني" @click="switchTeam(p)">{{ teams[p.team].emoji }} ⇄</button>
            <button type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️</button>
          </span>
        </div>
      </div>
      <button v-if="players.length" class="reset-btn" style="width:100%; margin-top:10px;" @click="clearPlayers">🧹 مسح كل اللاعبين</button>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="playersModalVisible = false">إغلاق</button>
    </div>
  </div>

  <div v-if="joinModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="joinModalVisible = false">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-gift-toggle" for="hexJoinViaGift">
        <input id="hexJoinViaGift" v-model="joinViaGift" type="checkbox">
        🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
      </label>
      <div v-for="key in ['a', 'b']" :key="key" class="join-settings-row team-join-row" :style="{ borderColor: teams[key].color }">
        <span class="team-join-label" :style="{ color: teams[key].color }">{{ teams[key].emoji }} {{ teams[key].name }}</span>
        <input v-if="!joinViaGift" v-model="joinWords[key]" type="text" maxlength="20" placeholder="رمز الانضمام لهذا الفريق">
        <CustomSelect v-else v-model="giftFilters[key]" :options="GIFT_OPTIONS" />
      </div>
      <div v-if="joinViaGift" class="join-settings-row">
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div v-if="!joinViaGift && joinWordsClash" class="clash-warning">⚠️ رمز الفريقين نفسه — غيّر واحد منهم عشان يشتغل التسجيل</div>
      <div v-if="joinViaGift && giftsClash && giftFilters.a" class="clash-warning">⚠️ الفريقين نفس الهدية — كل المنضمين بيروحون لـ {{ teams.a.name }}</div>
      <div class="field-hint">{{ joinModeHint }}</div>
      <label class="join-gift-toggle" for="hexRegUnlimited" style="margin-top:12px;">
        <input id="hexRegUnlimited" v-model="registrationUnlimited" type="checkbox" :disabled="registrationOpen">
        ♾️ تسجيل مفتوح بدون وقت (يبقى لين توقفه)
      </label>
      <div v-if="!registrationUnlimited" class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      </div>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        style="width:100%; margin-top:12px;"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
      <div class="field-hint">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="joinModalVisible = false">إغلاق</button>
    </div>
  </div>

  <div v-if="showModal" class="players-modal-overlay" style="display:flex;">
    <div class="players-modal-card">
      <h3>{{ modalTitle }}</h3>
      <div v-for="(line, i) in modalLines" :key="i" class="log-item" style="margin-bottom:8px;">{{ line }}</div>
      <button class="master-btn" style="width:100%; margin-top:10px;" @click="showModal = false">موافق</button>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRules" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين تحدي الحروف 🔠</h2>
      <ul class="rules-list">
        <li><b>المستوى:</b> المستضيف يختار حجم اللوحة 4×4 أو 5×5 أو 6×6 قبل بداية اللعبة</li>
        <li v-if="!joinViaGift"><b>الانضمام:</b> وقت التسجيل اكتب <b>"{{ getJoinWord('a') }}"</b> تنضم لـ {{ teams.a.emoji }} {{ teams.a.name }}، أو <b>"{{ getJoinWord('b') }}"</b> تنضم لـ {{ teams.b.emoji }} {{ teams.b.name }}</li>
        <li v-else><b>الانضمام:</b> وقت التسجيل أرسل {{ giftLabel(giftFilters.a) }} تنضم لـ {{ teams.a.emoji }} {{ teams.a.name }}، أو {{ giftLabel(giftFilters.b) }} تنضم لـ {{ teams.b.emoji }} {{ teams.b.name }}</li>
        <li><b>تبديل الفريق:</b> بعد ما تنضم ما تقدر تغيّر فريقك — المستضيف بس هو اللي يقدر ينقل اللاعبين بين الفريقين</li>
        <li><b>الهدف:</b> {{ teams.a.emoji }} {{ teams.a.name }} يكوّن طريق متصل من اليمين لليسار، و{{ teams.b.emoji }} {{ teams.b.name }} من فوق لتحت. أول فريق يوصل يفوز</li>
        <li><b>اختيار الخلية:</b> المستضيف يضغط على خلية، أو يسوي قرعة والشخص اللي تطلع عليه يكتب <b>رقم الخلية</b> بالتعليقات</li>
        <li><b>القرعة:</b> نفس الشخص ما يطلع مرتين خلال أي 3 قرعات متتالية (ولو اللاعبين 4 أو أقل: بس ما يطلع مرتين ورا بعض)</li>
        <li><b>السؤال:</b> كل خلية سؤال إجابته تبدأ بحرفها، و<b>أسرع إجابة صحيحة</b> من أي لاعب مسجل تاخذ الخلية لفريقه. تكفي الإجابة بأي صيغة (مثلاً "الكويت" أو "دولة الكويت")</li>
        <li v-if="allowUnregistered"><b>غير المسجلين:</b> لو جاوب صح وهو مب مسجل، تنحجز إجابته ويكتب <b>1</b> أو <b>2</b> (أو رمز الفريق) عشان يختار فريقه ويأخذ الخلية. المستضيف يقدر يحدد فريقه عنه أو يغيّر السؤال</li>
        <li v-if="sabotageEnabled && !isChatMode()"><b>إلغاء خلية:</b> اللي يرسل {{ giftLabel(sabotageGift) }} يكتب رقم خلية مكسوبة للفريق الخصم وترجع فاضية (ما يقدر يختار خلية فاضية). لو أرسلها وقت السؤال أو القرعة تنحفظ ويجي دوره بعد الإجابة. كل هدية = إلغاء خلية، واللي يرسل حزمة ياخذ إلغاء عن كل هدية لين تخلص هداياه أو خلايا الخصم</li>
        <li><b>كشف الإجابة:</b> بعد كل سؤال تنكشف الإجابة مع اسم أول واحد جاوب بلون فريقه</li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="showRules = false">🔙 رجوع للعبة</button>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 110px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 15px; text-align: center; }

.master-controls {
  display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;
  margin-bottom: 15px; width: 100%;
}
.rounds-badge { font-size: 0.95rem; padding: 8px 15px; }

.top-names-section {
  width: 100%; background: var(--panel-bg); border-radius: 12px; padding: 12px; margin-bottom: 15px;
  backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1);
}
.top-names-section > label { display: block; margin-bottom: 8px; font-size: 0.95rem; color: #ecf0f1; font-weight: bold; }
.field-hint { font-size: 0.75rem; color: #8b93a3; margin-top: 4px; }

input {
  background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px;
  color: white; padding: 10px; font-size: 1rem; outline: none;
}
input:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

.level-row { display: flex; gap: 10px; flex-wrap: wrap; }
.level-btn {
  flex: 1; min-width: 90px; border-radius: 12px; padding: 10px; font-size: 1.3rem;
  background: rgba(0, 0, 0, 0.35); border: 2px solid rgba(255, 255, 255, 0.15);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.level-btn small { font-size: 0.72rem; color: #bdc3c7; font-weight: normal; }
.level-btn.active { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.2); color: var(--primary-color); }

.team-setup {
  border-right: 5px solid; border-radius: 10px; background: rgba(0, 0, 0, 0.2);
  padding: 10px; margin-bottom: 10px;
}
.team-setup-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.team-setup-head input { flex: 1; min-width: 140px; }
.team-setup-dir { font-weight: bold; font-size: 0.85rem; white-space: nowrap; }
.swatches { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.swatch {
  width: 34px; height: 34px; padding: 0; border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.15);
}
.swatch.selected { border-color: #fff; box-shadow: 0 0 12px rgba(255, 255, 255, 0.7); transform: scale(1.12); }
.swatch:disabled { opacity: 0.2; }
.swatch-custom { font-size: 1rem; display: flex; align-items: center; justify-content: center; border-style: dashed; }
.custom-color-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.custom-color-row input { width: 120px; text-align: center; font-family: monospace; }
.custom-color-row input.invalid { border-color: #ff6b6b; }
.custom-preview { width: 34px; height: 34px; border-radius: 8px; border: 2px solid rgba(255, 255, 255, 0.4); }
.inline-label { font-size: 0.85rem; color: #bdc3c7; }

.layout-wrapper { display: flex; flex-direction: column; gap: 20px; width: 100%; }
@media (min-width: 1000px) {
  .layout-wrapper { flex-direction: row; align-items: flex-start; }
  .board-panel { flex: 1.6; }
  .side-col { flex: 1; }
}
.side-col { display: flex; flex-direction: column; gap: 20px; width: 100%; min-width: 0; }

.panel {
  background: var(--panel-bg); border-radius: 16px; padding: 15px; backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column; align-items: center; width: 100%; min-width: 0;
}
.panel h3 {
  font-size: 1.2rem; margin-bottom: 12px; color: #ecf0f1; border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px; width: 100%; text-align: center;
}
.status-line { font-weight: bold; color: #ccd6e0; margin-bottom: 14px; text-align: center; min-height: 1.4em; }

.drawn-banner {
  display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;
  border: 2px solid; border-radius: 30px; padding: 8px 18px; margin-bottom: 14px;
  background: rgba(0, 0, 0, 0.35); font-size: 1.05rem; color: #ecf0f1;
  animation: popIn 0.4s ease;
}
.drawn-banner b { font-size: 1.4rem; }
.banner-cancel { background: transparent; padding: 2px 6px; font-size: 0.9rem; opacity: 0.6; }
.banner-cancel:hover { opacity: 1; }

/* ===== اللوحة السداسية ===== */
.hex-frame {
  --w: min(104px, calc((100vw - 90px) / (var(--n) + 0.5)));
  position: relative;
  padding: 16px;
  direction: ltr;
}
@media (min-width: 1000px) {
  .hex-frame { --w: min(110px, calc((58vw - 90px) / (var(--n) + 0.5))); }
}
.edge { position: absolute; border-radius: 6px; opacity: 0.9; }
.edge-left, .edge-right { top: 16px; bottom: 16px; width: 8px; }
.edge-left { left: 0; }
.edge-right { right: 0; }
.edge-top, .edge-bottom { left: 16px; right: 16px; height: 8px; }
.edge-top { top: 0; }
.edge-bottom { bottom: 0; }

.hex-board {
  position: relative;
  width: calc(var(--w) * (var(--n) + 0.5));
  height: calc(var(--w) * (0.866 * (var(--n) - 1) + 1.1547));
}
.hex-slot {
  position: absolute;
  left: calc(var(--w) * var(--x));
  top: calc(var(--w) * var(--y));
  width: var(--w);
  height: calc(var(--w) * 1.1547);
  transition: transform 0.2s ease, filter 0.2s ease;
}
.hex-slot.clickable { cursor: pointer; }
.hex-slot.clickable:hover { transform: scale(1.06); z-index: 2; filter: drop-shadow(0 0 8px rgba(243, 156, 18, 0.8)); }
.hex-slot.active { z-index: 3; animation: activePulse 1s ease-in-out infinite alternate; }
.hex-slot.win { z-index: 2; animation: winGlow 0.9s ease-in-out infinite alternate; }

.hex-cell, .hex-inner {
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.hex-cell {
  width: 100%; height: 100%; padding: 3px;
  transform: scale(0.95);
  background: rgba(243, 156, 18, 0.55);
}
.hex-inner {
  width: 100%; height: 100%;
  background: linear-gradient(160deg, #2c3e50, #1a2533);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: background 0.4s ease;
}
.hex-letter { font-size: calc(var(--w) * 0.4); font-weight: bold; line-height: 1; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
.hex-num { font-size: calc(var(--w) * 0.15); color: #f1c40f; margin-top: calc(var(--w) * 0.04); font-weight: bold; }

.hex-cell.owned { background: rgba(255, 255, 255, 0.75); }
.hex-cell.owned .hex-inner {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.18), rgba(0, 0, 0, 0.3)), var(--owner-color);
}
.hex-cell.owned .hex-num { color: rgba(255, 255, 255, 0.9); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.hex-slot.active .hex-cell { background: #fff; }
.hex-slot.active .hex-inner { background: linear-gradient(160deg, #f1c40f, #d68910); }
.hex-slot.active .hex-letter, .hex-slot.active .hex-num { color: #1a1e2f; text-shadow: none; }

.hex-slot.dimmed { opacity: 0.35; }
.hex-slot.target { z-index: 2; animation: targetPulse 0.8s ease-in-out infinite alternate; }
.hex-slot.target .hex-cell { background: #ff3b3b; }
.hex-slot.burned { animation: burnFlash 1.2s ease; }
@keyframes targetPulse {
  from { filter: drop-shadow(0 0 3px #ff3b3b); }
  to { filter: drop-shadow(0 0 14px #ff3b3b); }
}
@keyframes burnFlash {
  0% { transform: scale(1.25); filter: drop-shadow(0 0 22px #ff3b3b) brightness(2); }
  100% { transform: scale(1); filter: none; }
}
.queue-badge {
  margin: -6px 0 12px; padding: 4px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: bold;
  color: #ff9f9f; background: rgba(255, 59, 59, 0.12); border: 1px solid rgba(255, 59, 59, 0.5);
}
.sabotage-banner { border-color: #ff3b3b; }
.remaining-chip {
  background: #ff3b3b; color: #fff; font-weight: bold; border-radius: 20px; padding: 2px 10px; font-size: 0.95rem;
}
.sabotage-banner b { color: #ff6b6b; }
.skip-btn { background: #7f8c8d; padding: 6px 14px; font-size: 0.9rem; }
.sabotage-card { border-color: #ff3b3b; box-shadow: 0 0 40px rgba(255, 59, 59, 0.35); }
.sabotage-avatar { width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 3px solid #ff3b3b; }
.sabotage-title { font-size: 2rem; font-weight: bold; color: #ff6b6b; }

@keyframes activePulse {
  from { transform: scale(1); filter: drop-shadow(0 0 4px #f1c40f); }
  to { transform: scale(1.1); filter: drop-shadow(0 0 16px #f1c40f); }
}
@keyframes winGlow {
  from { filter: drop-shadow(0 0 3px #fff) brightness(1); }
  to { filter: drop-shadow(0 0 16px #fff) brightness(1.35); }
}

.dir-legend { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; margin-top: 12px; font-size: 0.85rem; font-weight: bold; }

/* ===== الطبقات (القرعة / السؤال / النتيجة) ===== */
.game-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(5, 7, 14, 0.82); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: fadeIn 0.25s ease;
}
.overlay-card {
  width: 100%; max-width: 720px; text-align: center;
  background: linear-gradient(160deg, #23263a, #171a29);
  border: 3px solid var(--primary-color); border-radius: 24px;
  padding: 28px 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  animation: popIn 0.4s ease;
  max-height: 92vh; overflow-y: auto;
}
.overlay-label { color: #bdc3c7; font-size: 1.1rem; }
.overlay-sub { color: #ecf0f1; font-size: 1.1rem; }

.draw-name { font-size: 3.2rem; font-weight: bold; color: #ecf0f1; word-break: break-word; line-height: 1.3; }
.draw-name.rolling { opacity: 0.8; }
.draw-name.landed { animation: popIn 0.5s ease; }

.q-head { display: flex; align-items: center; justify-content: center; gap: 16px; }
.q-letter {
  font-size: 3.6rem; font-weight: bold; color: #1a1e2f; background: #f1c40f;
  width: 100px; height: 100px; border-radius: 22px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 25px rgba(241, 196, 15, 0.5);
}
.q-cellnum { font-size: 1.1rem; color: #ecf0f1; }
.q-text { font-size: 2rem; font-weight: bold; line-height: 1.6; color: #fff; padding: 8px 4px; }
.q-hint { color: #f1c40f; font-weight: bold; }
.pending-claim {
  width: 100%; border: 2px dashed #f1c40f; border-radius: 16px; padding: 12px;
  background: rgba(241, 196, 15, 0.08); display: flex; flex-direction: column; gap: 8px;
  animation: popIn 0.4s ease;
}
.pending-title { font-size: 1.3rem; color: #fff; }
.pending-title b { color: #f1c40f; }
.pending-sub { font-size: 1.05rem; color: #ecf0f1; line-height: 1.8; }
.pending-queue { font-size: 0.85rem; color: #bdc3c7; }
.q-answer-host { font-size: 1.05rem; color: #bdc3c7; }
.q-answer-host b { color: var(--primary-color); }
.peek-btn { background: rgba(255, 255, 255, 0.1); font-size: 0.85rem; padding: 6px 14px; }
.host-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
.host-actions button { padding: 8px 16px; font-size: 0.95rem; }
.cancel-btn { background: #7f8c8d; }

.reveal-answer { font-size: 3.4rem; font-weight: bold; color: #fff; animation: popIn 0.4s ease; }
.reveal-winner {
  font-size: 1.6rem; font-weight: bold; padding: 10px 24px; border-radius: 40px;
  border: 3px solid; background: rgba(0, 0, 0, 0.35); animation: popIn 0.6s ease;
  word-break: break-word;
}
.reveal-winner.none { color: #bdc3c7; border-color: #7f8c8d; }

@keyframes popIn {
  0% { transform: scale(0.5); opacity: 0; }
  70% { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

@media (max-width: 600px) {
  .q-text { font-size: 1.4rem; }
  .draw-name, .reveal-answer { font-size: 2.2rem; }
  .reveal-winner { font-size: 1.2rem; }
}

/* ===== الفريقين ===== */
.teams-panel { flex-direction: row; align-items: stretch; gap: 10px; }
.team-col { flex: 1; min-width: 0; border-top: 4px solid; border-radius: 10px; padding: 10px; background: rgba(0, 0, 0, 0.2); }
.team-title { font-weight: bold; font-size: 1rem; text-align: center; word-break: break-word; }
.team-count { text-align: center; font-size: 0.8rem; color: #bdc3c7; margin-bottom: 8px; }
.team-player { display: flex; align-items: center; gap: 4px; font-size: 0.88rem; padding: 3px 0; overflow-wrap: anywhere; }
.p-score { margin-right: auto; color: #f1c40f; font-size: 0.8rem; }

.event-log-panel { width: 100%; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.log-item {
  padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5;
  border-right: 4px solid var(--primary-color);
}

.team-pick-btn { padding: 8px 12px; font-size: 1rem; margin: 0; }
.team-pick-btn.small { padding: 5px 10px; font-size: 0.85rem; border-radius: 8px; }

.join-gift-toggle {
  display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #ecf0f1; cursor: pointer;
}
.join-gift-toggle input[type="checkbox"] { width: auto; accent-color: var(--primary-color); cursor: pointer; }
.join-settings-row { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.join-settings-row input { width: 100%; }
.team-join-row { border-right: 4px solid; padding-right: 10px; }
.team-join-label { font-weight: bold; font-size: 0.9rem; }
.clash-warning { color: #ff6b6b; font-size: 0.85rem; font-weight: bold; margin-top: 8px; }
.registration-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.registration-row input { width: 100px; text-align: center; }

.rules-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-gradient);
  flex-direction: column; align-items: center; z-index: 1300; padding: 20px 15px; overflow-y: auto;
}
.rules-box {
  width: 100%; max-width: 480px; background: var(--panel-bg); border: 1px solid var(--border-glow);
  border-radius: 16px; padding: 20px;
}
.rules-box h2 { color: var(--primary-color); text-align: center; margin-bottom: 15px; font-size: 1.4rem; }
.rules-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.rules-list li {
  background: #1e1e2f; padding: 10px 12px; border-radius: 8px; border-right: 4px solid var(--primary-color);
  font-size: 0.92rem; line-height: 1.6;
}
.back-to-game-btn { display: block; width: 100%; margin-top: 18px; background: var(--success-color); padding: 12px; }

.footer-note { padding: 15px; font-size: 0.85rem; }
</style>
