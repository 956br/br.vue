<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';

const router = useRouter();
const PLAYERS_KEY = 'mazeGame_players';
const SCORES_KEY = 'mazeGame_scores';

const TOKEN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#fd79a8', '#00cec9', '#0984e3', '#fdcb6e', '#55efc4'];
const DIR_WORDS = {
  يمين: 'right',
  يسار: 'left',
  شمال: 'left',
  فوق: 'top',
  أعلى: 'top',
  اعلى: 'top',
  طلوع: 'top',
  تحت: 'bottom',
  أسفل: 'bottom',
  اسفل: 'bottom',
  نزول: 'bottom',
};
const OPPOSITE = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
};
const DELTA = {
  top: [-1, 0], bottom: [1, 0], left: [0, -1], right: [0, 1],
};
const MEDALS = ['🥇', '🥈', '🥉'];
const DIR_TO_WORD = {
  right: 'يمين', left: 'يسار', top: 'فوق', bottom: 'تحت',
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function normalizeArabicWord(s) {
  return String(s).trim().replace(/[أإآ]/g, 'ا');
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadPlayers() {
  try {
    const data = localStorage.getItem(PLAYERS_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
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
  try { localStorage.setItem(PLAYERS_KEY, JSON.stringify(masterPlayersList)); } catch (e) { /* noop */ }
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
const players = reactive(new Map()); // name -> { name, color }
const tokens = reactive(new Map()); // name -> { row, col, animating }
const baseCellSize = 84;
const cellSize = ref(baseCellSize);
const isFullscreenMode = ref(false);
const maze = ref(null); // {n, cells, start, exits, solutions, maxMoves, solutionLength}
const exitClaimed = reactive({}); // "row,col" -> ownerName (for reactive door-lock visuals)
const flashExitKey = ref(null);
const roundNumber = ref(0);
const roundActive = ref(false);
let roundFinalized = true;
const roundWinners = ref([]);
const roundHistory = [];
const eventLog = ref([]);

const namesInput = ref(masterPlayersList.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const joinKeyInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const maxMovesInput = ref(8);

const namesHint = computed(() => (registrationLocked.value
  ? '🔒 مقفول بعد قفل التسجيل — اضغط "إعادة كل شيء" لتعديل القائمة من جديد.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل بعد قفل التسجيل.'));
function getJoinKey() { return joinKeyInput.value.trim() || '1'; }
const joinKeyHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء فتح نافذة التسجيل ينضم تلقائياً كلاعب مسجَّل. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.'
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

function getMaxMoves() {
  let val = parseInt(maxMovesInput.value, 10);
  if (Number.isNaN(val) || val < 3) val = 3;
  if (val > 15) val = 15;
  maxMovesInput.value = val;
  return val;
}

const mazePanelRef = ref(null);
const mazeControlsRef = ref(null);
const mazeStatusRef = ref(null);

function toggleFullscreen() {
  isFullscreenMode.value = !isFullscreenMode.value;
  if (!maze.value) return;
  nextTick(() => {
    if (isFullscreenMode.value) {
      const n = maze.value.n;
      const controlsHeight = mazeControlsRef.value?.offsetHeight || 0;
      const statusHeight = mazeStatusRef.value?.offsetHeight || 0;
      const availW = window.innerWidth * 0.94;
      const availH = window.innerHeight - controlsHeight - statusHeight - 160;
      const avail = Math.max(150, Math.min(availW, availH));
      cellSize.value = Math.floor(avail / n);
    } else {
      cellSize.value = baseCellSize;
    }
  });
}

function lockRegistration() {
  if (registrationLocked.value) return;
  if (masterPlayersList.length < 1) {
    openModal('تنبيه', ['<div class="log-item">تحتاج تسجيل لاعب واحد على الأقل قبل قفل التسجيل!</div>']);
    return;
  }

  players.clear();
  masterPlayersList.forEach((p, i) => {
    players.set(p.name, { name: p.name, color: TOKEN_COLORS[i % TOKEN_COLORS.length] });
  });
  registrationLocked.value = true;
  stopRegistration();
  appendLog(`<div class="log-item" style="text-align:center; color:#2ecc71;">🔒 أُقفل التسجيل بـ ${players.size} لاعب — جاهزين للسباق!</div>`);
}

function generateMazeCells(n) {
  const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => ({
    visited: false, top: false, right: false, bottom: false, left: false,
  })));
  const stack = [[0, 0]];
  cells[0][0].visited = true;
  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    const dirs = shuffleArray(['top', 'right', 'bottom', 'left']);
    let advanced = false;
    for (const dir of dirs) {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      if (cells[nr][nc].visited) continue;
      cells[r][c][dir] = true;
      cells[nr][nc][OPPOSITE[dir]] = true;
      cells[nr][nc].visited = true;
      stack.push([nr, nc]);
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }
  return cells;
}

function buildDistancesAndPaths(cells, n, start) {
  const dist = Array.from({ length: n }, () => Array(n).fill(-1));
  const parentDir = Array.from({ length: n }, () => Array(n).fill(null));
  dist[start.row][start.col] = 0;
  const queue = [start];
  while (queue.length > 0) {
    const { row, col } = queue.shift();
    for (const dir of ['top', 'right', 'bottom', 'left']) {
      if (!cells[row][col][dir]) continue;
      const [dr, dc] = DELTA[dir];
      const nr = row + dr;
      const nc = col + dc;
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[row][col] + 1;
      parentDir[nr][nc] = dir;
      queue.push({ row: nr, col: nc });
    }
  }
  return { dist, parentDir };
}

function tracePath(parentDir, start, exit) {
  const moves = [];
  let r = exit.row;
  let c = exit.col;
  while (r !== start.row || c !== start.col) {
    const dir = parentDir[r][c];
    moves.unshift(dir);
    const [dr, dc] = DELTA[OPPOSITE[dir]];
    r += dr; c += dc;
  }
  return moves;
}

function buildMaze(maxMoves) {
  const n = 5;
  const start = { row: Math.floor(n / 2), col: Math.floor(n / 2) };
  for (let attempt = 0; attempt < 500; attempt++) {
    const cells = generateMazeCells(n);
    const { dist, parentDir } = buildDistancesAndPaths(cells, n, start);

    const byDistance = new Map();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (r === start.row && c === start.col) continue;
        const d = dist[r][c];
        if (d < 3 || d > maxMoves) continue;
        const quadrant = (r <= start.row ? 0 : 2) + (c <= start.col ? 0 : 1);
        if (!byDistance.has(d)) byDistance.set(d, [[], [], [], []]);
        byDistance.get(d)[quadrant].push({ row: r, col: c });
      }
    }

    const sortedDistances = Array.from(byDistance.keys()).sort((a, b) => a - b);
    for (const d of sortedDistances) {
      const quadrants = byDistance.get(d);
      if (quadrants.every((q) => q.length > 0)) {
        const exits = quadrants.map((q) => ({ ...q[Math.floor(Math.random() * q.length)], claimedBy: null }));
        const solutions = exits.map((exit) => tracePath(parentDir, start, exit));
        return {
          n, cells, start, exits, solutions, solutionLength: d, maxMoves,
        };
      }
    }
  }
  return null;
}

function exitKey(row, col) { return `${row},${col}`; }

function startNewRound() {
  if (!registrationLocked.value) return;
  finalizeRoundHistory();

  const maxMoves = getMaxMoves();
  const built = buildMaze(maxMoves);
  if (!built) {
    openModal('تنبيه', [`<div class="log-item">تعذّر توليد متاهة بأربع أبواب متساوية ضمن حد ${maxMoves} حركة — جرّب ترفع "أقصى عدد حركات" وحاول مرة ثانية.</div>`]);
    return;
  }

  maze.value = built;
  Object.keys(exitClaimed).forEach((k) => delete exitClaimed[k]);
  roundNumber.value++;
  roundActive.value = true;
  roundFinalized = false;
  roundWinners.value = [];

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🌀 الجولة ${roundNumber.value}: متاهة جديدة بـ 4 أبواب خروج بنفس المستوى! كل باب يحتاج ${built.solutionLength} حركات</div>`);

  tokens.clear();
  players.forEach((p, name) => {
    tokens.set(name, reactive({
      row: built.start.row, col: built.start.col, animating: false, pulse: null,
    }));
  });
}

function parseMoveSequence(text) {
  const tokensArr = text.trim().split(/[\s,،]+/).filter(Boolean);
  if (tokensArr.length === 0) return null;
  const cap = maze.value ? maze.value.maxMoves : getMaxMoves();
  if (tokensArr.length > cap) return null;
  const moves = [];
  for (const tok of tokensArr) {
    const norm = normalizeArabicWord(tok);
    const dir = DIR_WORDS[norm];
    if (!dir) return null;
    moves.push(dir);
  }
  return moves;
}

function registerAttemptFromComment(name, rawText) {
  if (!registrationLocked.value || !roundActive.value || !name || !rawText) return;
  if (!players.has(name)) return;
  if (roundWinners.value.some((w) => w.name === name)) return;
  const token = tokens.get(name);
  if (!token || token.animating) return;
  const moves = parseMoveSequence(rawText);
  if (!moves) return;
  attemptForPlayer(name, moves);
}

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

async function animateTokenAlongPath(name, path) {
  const token = tokens.get(name);
  if (!token) return;
  for (let i = 1; i < path.length; i++) {
    token.row = path[i].row;
    token.col = path[i].col;
    await sleep(320);
  }
}

function flashToken(name, cls) {
  const token = tokens.get(name);
  if (!token) return;
  token.pulse = null;
  nextTick(() => { token.pulse = cls; });
}

function flashExitCell(exit, on) {
  if (!exit) return;
  flashExitKey.value = on ? exitKey(exit.row, exit.col) : null;
}

function markExitClosedVisual(exit) {
  if (!exit) return;
  exitClaimed[exitKey(exit.row, exit.col)] = exit.claimedBy;
}

async function attemptForPlayer(name, moves) {
  const currentMaze = maze.value;
  const token = tokens.get(name);
  token.animating = true;

  let pos = { ...currentMaze.start };
  const path = [{ ...pos }];
  let success = false;
  let hitExit = null;
  let hitLockedDoor = false;
  for (const dir of moves) {
    const cell = currentMaze.cells[pos.row][pos.col];
    if (!cell[dir]) break;
    const [dr, dc] = DELTA[dir];
    pos = { row: pos.row + dr, col: pos.col + dc };
    path.push({ ...pos });
    const matchedExit = currentMaze.exits.find((e) => e.row === pos.row && e.col === pos.col);
    if (matchedExit) {
      if (matchedExit.claimedBy) { hitLockedDoor = true; break; }
      matchedExit.claimedBy = name;
      success = true;
      hitExit = matchedExit;
      break;
    }
  }

  await animateTokenAlongPath(name, path);

  if (success && roundActive.value && roundWinners.value.length < 3) {
    flashToken(name, 'pulse-success');
    flashExitCell(hitExit, true);
    markExitClosedVisual(hitExit);
    registerWin(name);
    await sleep(900);
    flashExitCell(hitExit, false);
    token.animating = false;
  } else if (success) {
    markExitClosedVisual(hitExit);
    appendLog(`<div class="log-item" style="color:#8b93a3;">⏱️ <b>${escapeHtml(name)}</b> وصل بس الجولة كانت خلصت قبل لحظات — بدون نقاط</div>`);
    await sleep(500);
    flashExitCell(hitExit, false);
    token.animating = false;
  } else {
    flashToken(name, 'pulse-fail');
    const msg = hitLockedDoor
      ? `🔒 <b>${escapeHtml(name)}</b> وصل لباب مقفول أخذه لاعب ثاني قبله — يرجع للبداية`
      : `❌ <b>${escapeHtml(name)}</b> حاول ولم ينجح — يرجع للبداية`;
    appendLog(`<div class="log-item log-miss">${msg}</div>`);
    await sleep(350);
    const reversePath = path.slice().reverse();
    await animateTokenAlongPath(name, reversePath);
    token.animating = false;
  }
}

function registerWin(name) {
  if (!roundActive.value || roundWinners.value.length >= 3) return;
  const rank = roundWinners.value.length + 1;
  const points = [15, 10, 5][rank - 1] || 0;
  roundWinners.value.push({ name, rank, points });

  const player = getOrCreatePlayerScore(name);
  player.score += points;
  saveScores();

  appendLog(`<div class="log-item log-hit">${MEDALS[rank - 1]} <b>${escapeHtml(name)}</b> وصل بالمركز ${rank} وكسب ${points} نقطة!</div>`);

  if (roundWinners.value.length >= 3) {
    roundActive.value = false;
    finalizeRoundHistory();
    appendLog('<div class="log-item" style="text-align:center; color:#f39c12;">🏁 اكتملت المراكز الثلاثة — الجولة توقفت تلقائياً</div>');
  }
}

function finalizeRoundHistory() {
  if (roundFinalized || roundNumber.value === 0) return;
  roundHistory.push({ roundNumber: roundNumber.value, winners: roundWinners.value.slice() });
  roundFinalized = true;
}

function endGame() {
  finalizeRoundHistory();
  roundActive.value = false;

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
        ? r.winners.map((w) => `${MEDALS[w.rank - 1]} ${escapeHtml(w.name)}`).join(' — ')
        : 'بدون فائزين';
      logs.push(`<div class="log-item">الجولة ${r.roundNumber}: ${wtext}</div>`);
    });
  }

  openModal('🏁 النتيجة النهائية لتحدي المتاهة', logs);
}

function resetGame() {
  stopRegistration();
  isFullscreenMode.value = false;
  cellSize.value = baseCellSize;
  totalScores.clear();
  saveScores();
  roundNumber.value = 0;
  roundActive.value = false;
  roundFinalized = true;
  maze.value = null;
  players.clear();
  tokens.clear();
  registrationLocked.value = false;
  roundWinners.value = [];
  roundHistory.length = 0;
  eventLog.value = [];
  joinedUsers.clear();
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const mazeStatusHtml = computed(() => {
  if (!registrationLocked.value) return 'سجّل اللاعبين ثم اضغط "قفل التسجيل"';
  if (!maze.value) return 'اضغط "بدء جولة جديدة" لتوليد أول متاهة';
  if (roundActive.value) return `🌀 4 أبواب خروج، كل باب يحتاج ${maze.value.solutionLength} حركات بالضبط — كل لاعب مسجَّل يكتب مساره لأي باب بالدردشة بنفس الوقت (مثال: يمين تحت يسار)`;
  return '🏁 انتهت الجولة — اضغط "بدء جولة جديدة" للمتابعة';
});

const wrapStyle = computed(() => {
  if (!maze.value) return {};
  const n = maze.value.n;
  return { width: `${n * cellSize.value}px`, height: `${n * cellSize.value}px` };
});
const gridStyle = computed(() => {
  if (!maze.value) return {};
  const n = maze.value.n;
  return {
    width: `${n * cellSize.value}px`,
    height: `${n * cellSize.value}px`,
    gridTemplateColumns: `repeat(${n}, ${cellSize.value}px)`,
    gridTemplateRows: `repeat(${n}, ${cellSize.value}px)`,
  };
});

const mazeCellsFlat = computed(() => {
  if (!maze.value) return [];
  const { n, cells, start, exits } = maze.value;
  const wallColor = '#f39c12';
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = cells[r][c];
      const isStart = r === start.row && c === start.col;
      const exitHere = exits.find((e) => e.row === r && e.col === c);
      const key = exitKey(r, c);
      const locked = exitHere && exitClaimed[key];
      list.push({
        r,
        c,
        isStart,
        isExit: !!exitHere,
        locked,
        flashing: flashExitKey.value === key,
        content: isStart ? '🏁' : (locked ? '🔒' : (exitHere ? '🚪' : '')),
        style: {
          borderTop: cell.top ? '3px solid transparent' : `3px solid ${wallColor}`,
          borderRight: cell.right ? '3px solid transparent' : `3px solid ${wallColor}`,
          borderBottom: cell.bottom ? '3px solid transparent' : `3px solid ${wallColor}`,
          borderLeft: cell.left ? '3px solid transparent' : `3px solid ${wallColor}`,
        },
      });
    }
  }
  return list;
});

const tokenLayoutList = computed(() => {
  if (tokens.size === 0) return [];
  const groups = new Map();
  tokens.forEach((token, name) => {
    const key = `${token.row},${token.col}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  });
  const half = cellSize.value / 2;
  const singleOffset = cellSize.value / 4;
  const tokenSize = Math.round(cellSize.value / 2);
  const list = [];
  groups.forEach((names) => {
    names.forEach((name, idx) => {
      const token = tokens.get(name);
      const p = players.get(name);
      let left;
      let top;
      if (names.length > 1) {
        const qi = idx % 4;
        const qx = qi % 2;
        const qy = Math.floor(qi / 2);
        left = token.col * cellSize.value + qx * half;
        top = token.row * cellSize.value + qy * half;
      } else {
        left = token.col * cellSize.value + singleOffset;
        top = token.row * cellSize.value + singleOffset;
      }
      list.push({
        name,
        text: name.slice(0, 2),
        pulse: token.pulse,
        style: {
          width: `${tokenSize}px`,
          height: `${tokenSize}px`,
          background: p ? p.color : '#888',
          left: `${left}px`,
          top: `${top}px`,
        },
      });
    });
  });
  return list;
});

const roundWinnerSlots = computed(() => {
  const points = [15, 10, 5];
  return [0, 1, 2].map((i) => {
    const w = roundWinners.value[i];
    return {
      medal: MEDALS[i], name: w ? w.name : '—', points: w ? w.points : points[i], filled: !!w,
    };
  });
});

const registeredPlayersDisplay = computed(() => {
  if (players.size === 0) {
    return masterPlayersList.map((p) => ({ name: p.name, color: null, status: '⏳ مسجل' }));
  }
  return Array.from(players.values()).map((p) => ({ name: p.name, color: p.color, status: '🏎️ جاهز' }));
});

const leaderboardSorted = computed(() => Array.from(totalScores.values()).sort((a, b) => b.score - a.score));
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }

const lockBtnVisible = computed(() => !registrationLocked.value);
const newRoundBtnVisible = computed(() => registrationLocked.value);
const endGameBtnVisible = computed(() => roundNumber.value > 0);
const maxMovesDisabled = computed(() => roundActive.value);

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
  trackConnectRequest('maze', username);

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
      } else if (registrationLocked.value) {
        registerAttemptFromComment(data.user, data.comment);
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
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف: من يكتب مفتاح الانضمام بالدردشة ينضم تلقائياً كلاعب مسجَّل، وبعد قفل التسجيل يشترك بكل جولة بكتابة خطوات الحل كاملة بتعليق واحد (مثال: يمين يمين تحت يسار)</label>
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
    <label for="maxMovesInput">🔢 أقصى عدد حركات مسموح بكل محاولة (يحدده المستضيف):</label>
    <div class="round-time-row">
      <input v-model="maxMovesInput" type="number" min="3" max="15" :disabled="maxMovesDisabled">
      <div class="field-hint" style="margin-top:0;">يُولَّد حل كل باب ضمن هذا الحد بالضبط، وأي محاولة تكتب حركات أكثر من هذا العدد تُرفض تلقائياً</div>
    </div>
  </div>

  <h1>🌀 تحدي المتاهة</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="layout-wrapper">
    <div id="mazePanel" ref="mazePanelRef" class="panel" :class="{ 'is-fullscreen-mode': isFullscreenMode }">
      <h2>🌀 ساحة المتاهة</h2>
      <div ref="mazeControlsRef" class="master-controls">
        <button v-if="lockBtnVisible" class="master-btn" @click="lockRegistration">🔒 قفل التسجيل</button>
        <button v-if="newRoundBtnVisible" class="master-btn" @click="startNewRound">🎲 بدء جولة جديدة</button>
        <button v-if="endGameBtnVisible" class="master-btn end-btn" @click="endGame">🏁 حسم اللعبة</button>
        <button class="master-btn" style="background:#3498db;" @click="toggleFullscreen">{{ isFullscreenMode ? '🡼 تصغير' : '⛶ ملء الشاشة' }}</button>
        <button class="reset-btn" @click="resetGame">🔄 إعادة كل شيء</button>
        <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
        <button class="home-btn" @click="goHome">🏠 الخروج</button>
        <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
      </div>
      <div ref="mazeStatusRef" class="maze-status-line" v-html="mazeStatusHtml"></div>
      <div class="maze-wrap" :style="wrapStyle">
        <div v-if="!maze" class="maze-grid">
          <div class="field-hint" style="padding:20px;">🔒 لا توجد متاهة بعد</div>
        </div>
        <div v-else class="maze-grid" :style="gridStyle">
          <div
            v-for="cell in mazeCellsFlat"
            :key="`${cell.r}-${cell.c}`"
            class="maze-cell"
            :class="{ 'is-start': cell.isStart, 'is-exit': cell.isExit, 'is-exit-locked': cell.locked, 'flash-exit': cell.flashing }"
            :style="cell.style"
          >{{ cell.content }}</div>
        </div>
        <div
          v-for="item in tokenLayoutList"
          :key="item.name"
          class="player-token"
          :class="{ 'pulse-success': item.pulse === 'pulse-success', 'pulse-fail': item.pulse === 'pulse-fail' }"
          :style="item.style"
          :title="item.name"
        >{{ item.text }}</div>
      </div>
      <div class="round-winners-row">
        <div v-for="(slot, i) in roundWinnerSlots" :key="i" class="winner-slot" :class="{ 'is-filled': slot.filled }">
          <div class="medal">{{ slot.medal }}</div>
          <div class="w-name">{{ slot.name }}</div>
          <div class="w-points">{{ slot.points }} نقطة</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>👥 اللاعبون المسجَّلون</h3>
      <div class="players-list">
        <div v-if="registeredPlayersDisplay.length === 0" class="field-hint">لا يوجد لاعبون مسجلون بعد</div>
        <div v-for="p in registeredPlayersDisplay" :key="p.name" class="player-item">
          <span><span v-if="p.color" class="player-dot" :style="{ background: p.color }"></span>{{ p.name }}</span>
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
      <h2>قوانين تحدي المتاهة 🌀</h2>
      <ul class="rules-list">
        <li><b>التسجيل:</b> يكتب المتابع مفتاح الانضمام (افتراضياً "1") بالدردشة لينضم كلاعب قبل قفل التسجيل — كل اللاعبين لازم يكونوا مسجَّلين مسبقاً قبل بدء أي جولة</li>
        <li><b>المتاهة:</b> يولّد النظام متاهة عشوائية كل جولة، البداية دائماً من مركز المتاهة، وفيها 4 أبواب خروج موزعة على جهات المتاهة الأربع وكلها بنفس عدد الحركات بالضبط (نفس المستوى) — يقدر اللاعب يختار أي باب يوصله</li>
        <li><b>قفل الأبواب:</b> أول لاعب يوصل لباب معيّن يأخذه ويُقفل 🔒 نهائياً — ما يقدر أي لاعب ثاني يفتح نفس الباب، ولازم يوصل لباب مختلف من الثلاثة الباقية</li>
        <li><b>أقصى عدد حركات:</b> يحدد المستضيف حد أقصى لعدد الحركات (من 3 إلى 15) قبل بدء الجولة — تُبنى كل الأبواب ضمن هذا الحد بالضبط، وأي محاولة تكتب حركات أكثر منه تُرفض تلقائياً</li>
        <li><b>ملء الشاشة:</b> زر "⛶ ملء الشاشة" فوق ساحة المتاهة يكبّرها لتملأ الشاشة بالكامل، مناسب لعرضها بوضوح على البث</li>
        <li><b>اللعب الجماعي المتزامن:</b> كل لاعب مسجَّل له رمزه الخاص بلون مختلف على المتاهة، ويقدر أي عدد منهم يحاول بنفس الوقت — كل واحد يتحرك بشكل مستقل بدون ما ينتظر دوره</li>
        <li><b>الإجابة:</b> يكتب اللاعب المسجَّل كل خطوات الحل بتعليق واحد بالكلمات "يمين"، "يسار"، "فوق"، "تحت" (مثال: يمين يمين تحت يسار)</li>
        <li><b>الحركة:</b> بمجرد التقاط تعليق صحيح الصياغة من لاعب مسجَّل، يتحرك رمزه خطوة بخطوة بحركة متسلسلة تطبيقاً للمسار المكتوب</li>
        <li><b>الفشل:</b> لو اصطدم بجدار، أو وصل لباب مقفول أخذه لاعب ثاني، أو خلصت الخطوات قبل الوصول لباب مفتوح، يرجع الرمز فوراً بحركة عكسية لنقطة البداية، ويقدر اللاعب يحاول مرة ثانية</li>
        <li><b>النقاط:</b> أول 3 يوصلون صح ياخذون: 🥇 15 نقطة — 🥈 10 نقاط — 🥉 5 نقاط، ولا يفوز نفس الشخص مرتين بنفس الجولة</li>
        <li><b>توقف الجولة:</b> بمجرد وصول الفائز الثالث، تتوقف الجولة تلقائياً ولا تُحتسب أي محاولات إضافية</li>
        <li><b>حسم اللعبة:</b> يوقف المستضيف اللعبة نهائياً ويعرض النتيجة الكاملة لكل الجولات ولوحة الصدارة الإجمالية</li>
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

.round-time-row input[type="text"] {
  width: 110px;
  text-align: center;
  flex: none;
}

.join-settings-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 8px;
}

.join-settings-row input[type="text"] {
  flex: 1;
  min-width: 140px;
  width: auto;
}

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

.gift-filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input {
  flex: 1;
  min-width: 140px;
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
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row input[type="number"] {
  width: 90px;
  flex: none;
}

.registration-status { font-weight: bold; color: #f1c40f; }

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

.rules-box h2 {
  color: var(--primary-color);
  text-align: center;
  margin-bottom: 15px;
  font-size: 1.4rem;
}

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

.maze-status-line {
  text-align: center;
  font-size: 0.92rem;
  color: #ccd6e0;
  margin-bottom: 12px;
  min-height: 1.3em;
}

.maze-wrap {
  position: relative;
  margin: 0 auto 16px;
  direction: ltr;
}

.maze-grid {
  display: grid;
  background: #0f111a;
  border-radius: 6px;
  direction: ltr;
}

.maze-cell {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  border: 3px solid transparent;
}

.maze-cell.is-start { color: #2ecc71; font-weight: bold; }
.maze-cell.is-exit { color: #ffa502; }
.maze-cell.is-exit-locked { color: #55606e; }
.maze-cell.flash-exit { background: rgba(46, 204, 113, 0.4); }

#mazePanel.is-fullscreen-mode {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: #0f111a;
  border-radius: 0;
  margin: 0;
  max-width: none;
  padding: 16px;
  overflow-y: auto;
  justify-content: flex-start;
}

.player-token {
  position: absolute;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.62rem;
  font-weight: bold;
  color: #fff;
  border: 2px solid rgba(255,255,255,0.75);
  box-shadow: 0 2px 5px rgba(0,0,0,0.5);
  transition: left 0.32s ease, top 0.32s ease;
  pointer-events: none;
  z-index: 5;
}

.player-token.pulse-success { animation: charSuccess 0.7s ease; }
.player-token.pulse-fail { animation: charFail 0.5s ease; }

@keyframes charSuccess {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.6); }
}

@keyframes charFail {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

.round-winners-row {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 10px;
}

.winner-slot {
  flex: 1;
  min-width: 100px;
  max-width: 140px;
  background: #1e1e2f;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 10px 6px;
  text-align: center;
}

.winner-slot .medal { font-size: 1.4rem; }
.winner-slot .w-name { font-size: 0.85rem; font-weight: bold; margin-top: 4px; word-break: break-word; }
.winner-slot .w-points { font-size: 0.75rem; color: var(--primary-color); }
.winner-slot.is-filled { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

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

.player-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-left: 6px;
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
.event-log-panel :deep(.log-miss) { border-right: 4px solid var(--danger-color); }

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
