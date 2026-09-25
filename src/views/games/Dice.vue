<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, getGiftName, getGiftValue, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
} from '../../utils/tiktokConnectionManager';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();

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

function playTone(freq, duration, type, delay, volume) {
  if (!soundEnabled.value) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const startTime = ctx.currentTime + delay;
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  } catch (e) { /* الصوت غير متاح بهذا المتصفح أو قبل أول تفاعل من المستخدم */ }
}

function playDiceRollSound() {
  for (let i = 0; i < 6; i++) playTone(280 + Math.random() * 220, 0.06, 'square', i * 0.12, 0.08);
}

function playWinSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, 0.25, 'triangle', i * 0.14, 0.18));
}

function playEliminationSound() {
  [440, 349.23, 293.66, 220].forEach((f, i) => playTone(f, 0.3, 'sawtooth', i * 0.15, 0.15));
}

const LOSE_SCORE = -5;
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const STORAGE_KEY = 'diceGame_players';

// ===== نقاط الفوز (يحددها المستضيف) =====
const winScoreInput = ref(5);
const winScore = computed(() => {
  let v = parseInt(winScoreInput.value, 10);
  if (Number.isNaN(v) || v < 1) v = 1;
  return v;
});

// ===== الجولة الذهبية (مفاجأة 10% تضاعف النقاط) =====
const goldenRoundEnabled = ref(true);
const isGoldenRound = ref(false);

// ===== إعدادات أوضاع اللعب المتقدمة (يحددها المستضيف) =====
const numbersToPick = ref(2); // 1 = رقم واحد (مخاطرة عالية، مكافأة أكبر)، 2 = رقمين (الوضع الافتراضي)
const doubleDiceMode = ref(false); // نرد مزدوج: رمي نردين واحتساب مجموعهما (نطاق 2-12)
const bettingEnabled = ref(false); // رهان بالنقاط: كل لاعب يحدد رهانه (1-3) بدل نقطة ثابتة
const extraNumberGiftEnabled = ref(false); // هدية تمنح رقم توقع إضافي أثناء الجولة النشطة
const extraNumberGift = ref('');
const extraNumberGiftMinValue = ref(null);

const pointGiftEnabled = ref(false); // هدية تمنح نقطة مباشرة لأي لاعب نشط في أي وقت
const pointGift = ref('');
const pointGiftMinValue = ref(null);
const selectedPointGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === pointGift.value);
  return found ? found.label : '🎁 أي هدية';
});

// ===== فزعة الفرق (Community Tug-of-War) — غير متوافق مع وضع الدوري =====
const tugOfWarEnabled = ref(false);
const teamAName = ref('فريق الشرق');
const teamBName = ref('فريق الغرب');
const tugTargetInput = ref(10);
const tugTarget = computed(() => {
  let v = parseInt(tugTargetInput.value, 10);
  if (Number.isNaN(v) || v < 1) v = 1;
  return v;
});
const tugPosition = ref(0);
const tugWinnerTeam = ref(null); // 'A' | 'B' | null
const tugMarkerPct = computed(() => {
  const clamped = Math.max(-tugTarget.value, Math.min(tugTarget.value, tugPosition.value));
  return 50 + (clamped / tugTarget.value) * 50;
});

function assignTeam() {
  const countA = players.filter((p) => p.team === 'A').length;
  const countB = players.filter((p) => p.team === 'B').length;
  if (countA === countB) return Math.random() < 0.5 ? 'A' : 'B';
  return countA < countB ? 'A' : 'B';
}

function toggleTugOfWar(enabled) {
  tugOfWarEnabled.value = enabled;
  if (enabled) tournamentModeEnabled.value = false;
}

// ===== وضع الدوري (مباريات 1 ضد 1 حتى نهائي واحد) — غير متوافق مع فزعة الفرق =====
const tournamentModeEnabled = ref(false); // تفعيل الوضع من الإعدادات المتقدمة
const tournamentActive = ref(false); // الدوري بدأ فعلياً وفيه مباريات جارية
const tournamentFinished = ref(false);
const tournamentRounds = reactive([]); // كل عنصر: مصفوفة مباريات الدور [{p1,p2,score1,score2,winner,isBye}]
const currentRoundIdx = ref(0);
const currentMatchIdx = ref(0);
const tournamentWildcardQueue = reactive([]); // لاعبون رجعوا بهدية، بانتظار دخول مباراة جديدة
const tournamentChampionId = ref(null);
const matchCards = reactive([]); // [{ playerId, name, selected: null, conflictHint: '' }]
const matchRoundActive = ref(false);

function toggleTournamentMode(enabled) {
  tournamentModeEnabled.value = enabled;
  if (enabled) tugOfWarEnabled.value = false;
}

const currentMatch = computed(() => {
  const round = tournamentRounds[currentRoundIdx.value];
  if (!round) return null;
  return round[currentMatchIdx.value] || null;
});

const tournamentChampionName = computed(() => (tournamentChampionId.value ? playerName(tournamentChampionId.value) : ''));

function playerName(id) {
  const p = players.find((pp) => pp.id === id);
  return p ? p.name : '؟';
}

function shuffleIds(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MATCH_WIN_POINTS = 3; // أول من يوصل لهذا العدد من النقاط يفوز فوراً بالمباراة
const MATCH_ROUNDS = 5; // أو بعد هذا العدد من الجولات: صاحب النتيجة الأعلى يفوز؛ تعادل = خروج الاثنين من الدوري

function buildRoundFromIds(ids) {
  const round = [];
  for (let i = 0; i < ids.length; i += 2) {
    if (i + 1 < ids.length) {
      round.push({
        p1: ids[i], p2: ids[i + 1], score1: 0, score2: 0, winner: null, resolved: false, isBye: false, roundsPlayed: 0,
      });
    } else {
      round.push({
        p1: ids[i], p2: null, score1: 0, score2: 0, winner: ids[i], resolved: true, isBye: true, roundsPlayed: 0,
      });
    }
  }
  return round;
}

function startTournament() {
  if (players.length < 2) {
    openModal('تنبيه', ['تحتاج لاعبَين على الأقل لبدء الدوري!']);
    return;
  }
  tournamentRounds.splice(0, tournamentRounds.length, buildRoundFromIds(shuffleIds(players.map((p) => p.id))));
  currentRoundIdx.value = 0;
  currentMatchIdx.value = 0;
  tournamentWildcardQueue.splice(0, tournamentWildcardQueue.length);
  tournamentChampionId.value = null;
  tournamentFinished.value = false;
  tournamentActive.value = true;
  currentRound.value = 0;
  advanceToNextPlayableMatch();
}

function advanceToNextPlayableMatch() {
  let round = tournamentRounds[currentRoundIdx.value];
  while (round) {
    while (currentMatchIdx.value < round.length && round[currentMatchIdx.value].resolved) {
      currentMatchIdx.value++;
    }
    if (currentMatchIdx.value < round.length) {
      prepareMatchDuel(round[currentMatchIdx.value]);
      return;
    }

    // نستبعد مباريات "الاثنين خسروا" (تعادل بعد 5 جولات) — ما حد يتأهل منها
    const roundWinners = round.map((m) => m.winner).filter((w) => w !== null);

    if (roundWinners.length === 0) {
      tournamentChampionId.value = null;
      tournamentFinished.value = true;
      tournamentActive.value = false;
      openModal('🤝 لا يوجد بطل', ['<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🤝 كل اللاعبين بهذا الدور خرجوا بالتعادل — لا يوجد بطل لهذا الدوري.</div>']);
      return;
    }

    if (roundWinners.length === 1) {
      tournamentChampionId.value = roundWinners[0];
      tournamentFinished.value = true;
      tournamentActive.value = false;
      playWinSound();
      openModal('🏆 بطل الدوري!', [`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 بطل دوري "رمعة نرد": <b>${escapeHtml(playerName(roundWinners[0]))}</b> 🏆</div>`]);
      return;
    }

    const pool = [...roundWinners];
    if (pool.length % 2 === 1 && tournamentWildcardQueue.length > 0) {
      pool.push(tournamentWildcardQueue.shift());
    }
    tournamentRounds.push(buildRoundFromIds(shuffleIds(pool)));
    currentRoundIdx.value++;
    currentMatchIdx.value = 0;
    round = tournamentRounds[currentRoundIdx.value];
  }
}

function prepareMatchDuel(match) {
  matchCards.splice(
    0,
    matchCards.length,
    {
      playerId: match.p1, name: playerName(match.p1), selected: null, conflictHint: '',
    },
    {
      playerId: match.p2, name: playerName(match.p2), selected: null, conflictHint: '',
    },
  );
  matchRoundActive.value = false;
  resetDiceDisplay();
  diceCaption.value = `⚔️ مباراة: ${playerName(match.p1)} ضد ${playerName(match.p2)} (${match.score1} - ${match.score2}) — أول من يوصل ${MATCH_WIN_POINTS} نقاط يفوز، أو الأعلى بعد ${MATCH_ROUNDS} جولات (تعادل = خروج الاثنين)`;
}

function toggleMatchNumber(card, num) {
  if (!matchRoundActive.value) return;
  const opponent = matchCards.find((c) => c !== card);
  if (opponent && opponent.selected === num) {
    card.conflictHint = '🚫 هذا الرقم اختاره خصمك، اختر رقماً غيره';
    return;
  }
  card.selected = card.selected === num ? null : num;
  card.conflictHint = '';
}

function registerMatchGuessFromComment(username, rawText) {
  if (!matchRoundActive.value) return;
  const card = matchCards.find((c) => c.name === username);
  if (!card) return;
  const nums = parseNumbersFromText(rawText, 1, 1, 6);
  if (nums.length !== 1) return;
  const opponent = matchCards.find((c) => c !== card);
  if (opponent && opponent.selected === nums[0]) return;
  card.selected = nums[0];
  card.conflictHint = '';
}

async function startMatchRound() {
  if (matchRoundActive.value || tournamentFinished.value || !currentMatch.value) return;
  matchCards.forEach((c) => { c.selected = null; c.conflictHint = ''; });
  roundDuration.value = getRoundDuration();
  roundToken++;
  currentRound.value++;
  resetDiceDisplay();
  diceCaption.value = `⏳ باب التوقعات مفتوح (${roundDuration.value} ثانية)... كل لاعب يختار رقم مختلف عن خصمه (1-6)`;
  matchRoundActive.value = true;
  startMatchTimer();
}

function startMatchTimer() {
  let timeLeft = roundDuration.value;
  timerDisplay.value = String(timeLeft);
  timerUrgent.value = false;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    timeLeft--;
    timerDisplay.value = String(Math.max(timeLeft, 0));
    if (timeLeft <= 5) timerUrgent.value = true;
    if (timeLeft <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      rollMatchDiceAndEvaluate();
    }
  }, 1000);
}

async function rollMatchDiceAndEvaluate() {
  if (!matchRoundActive.value) return;
  matchRoundActive.value = false;
  const myToken = roundToken;
  diceRolling.value = true;
  diceCaption.value = '🎲 جاري رمي النرد تلقائياً...';
  diceResultLabel.value = '';
  playDiceRollSound();

  await new Promise((resolve) => {
    let ticks = 0;
    rollAnimTimer = setInterval(() => {
      diceFace.value = DICE_FACES[Math.floor(Math.random() * 6)];
      ticks++;
      if (ticks >= 12) {
        clearInterval(rollAnimTimer);
        rollAnimTimer = null;
        resolve();
      }
    }, 100);
  });
  if (myToken !== roundToken) return;

  rolledValue.value = Math.floor(Math.random() * 6) + 1;
  diceRolling.value = false;
  diceFace.value = DICE_FACES[rolledValue.value - 1];
  diceResultLabel.value = `الرقم الفائز هو: ${rolledValue.value}`;
  diceCaption.value = 'نتيجة هذه الجولة:';

  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (myToken !== roundToken) return;

  evaluateMatchRound();
}

function evaluateMatchRound() {
  const match = currentMatch.value;
  if (!match) return;
  const logs = [`<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:8px;">🎲 الرقم الفائز هو: ${rolledValue.value}</div>`];

  let anyHit = false;
  matchCards.forEach((c) => {
    if (c.selected === rolledValue.value) {
      anyHit = true;
      if (c.playerId === match.p1) match.score1++; else match.score2++;
      logs.push(`<div class="log-item log-hit">🎯 <b>${escapeHtml(c.name)}</b> جاوب صح!</div>`);
    } else if (c.selected === null) {
      logs.push(`<div class="log-item" style="color:#8b93a3;">⏳ <b>${escapeHtml(c.name)}</b> ما اختار رقم هذه الجولة.</div>`);
    }
  });
  if (!anyHit) logs.push('<div class="log-item" style="color:#8b93a3;">لا أحد جاوب صح هذه الجولة، النتيجة كما هي.</div>');

  match.roundsPlayed = (match.roundsPlayed || 0) + 1;
  logs.push(`<div style="text-align:center; margin-top:8px; font-weight:bold;">📊 الجولة ${match.roundsPlayed}/${MATCH_ROUNDS}: ${escapeHtml(playerName(match.p1))} ${match.score1} - ${match.score2} ${escapeHtml(playerName(match.p2))}</div>`);

  if (match.score1 >= MATCH_WIN_POINTS || match.score2 >= MATCH_WIN_POINTS) {
    match.winner = match.score1 >= MATCH_WIN_POINTS ? match.p1 : match.p2;
    match.resolved = true;
  } else if (match.roundsPlayed >= MATCH_ROUNDS) {
    match.resolved = true;
    if (match.score1 !== match.score2) {
      match.winner = match.score1 > match.score2 ? match.p1 : match.p2;
    }
  }

  if (match.resolved) {
    if (match.winner !== null) {
      playWinSound();
      logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 فاز بالمباراة: <b>${escapeHtml(playerName(match.winner))}</b> (${match.score1} - ${match.score2}) 🏆</div>`);
    } else {
      playEliminationSound();
      logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#8A1538; padding:12px; border-radius:10px;">💀 تعادل بعد ${MATCH_ROUNDS} جولات (${match.score1} - ${match.score2})! كلا اللاعبين يخرجان من الدوري ولا أحد يتأهل من هذه المباراة.</div>`);
    }
  }

  diceCaption.value = 'اضغط "بدء الجولة" لفتح باب التوقعات';
  openModal('نتيجة الجولة', logs);
}

const minDiceNum = computed(() => (doubleDiceMode.value ? 2 : 1));
const maxDiceNum = computed(() => (doubleDiceMode.value ? 12 : 6));
const numberRangeArray = computed(() => {
  const arr = [];
  for (let i = minDiceNum.value; i <= maxDiceNum.value; i++) arr.push(i);
  return arr;
});
const selectedExtraNumberGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === extraNumberGift.value);
  return found ? found.label : '🎁 أي هدية';
});

function guessCountLabel() {
  return numbersToPick.value === 1 ? 'رقم واحد' : 'رقمين';
}
function guessExampleText() {
  if (numbersToPick.value === 1) return doubleDiceMode.value ? '7' : '3';
  return doubleDiceMode.value ? '7 و 9' : '1 3';
}

// ===== حالة اللاعبين =====
function loadFromStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  return null;
}

const players = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id), 0) + 1;
const tiktokJoinedUsers = new Set();

function saveToStorage() {
  // أسماء اللاعبين لا تُحفظ بين الجلسات
}

// ===== حالة اللعبة =====
const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const roundDurationInput = ref(15);
const roundDuration = ref(15);

const isRoundActive = ref(false);
const gameFinished = ref(false);
const winners = ref([]);
const currentRound = ref(0);
let roundToken = 0;

const diceFace = ref('🎲');
const diceFace2 = ref('🎲'); // للنرد الثاني عند تفعيل وضع "نرد مزدوج"
const diceRolling = ref(false);
const diceCaption = ref('اضغط "بدء الجولة" لفتح باب التوقعات');
const diceResultLabel = ref('');
const rolledValue = ref(null);

const timerDisplay = ref('--');
const timerUrgent = ref(false);
let countdownTimer = null;
let rollAnimTimer = null;

const roundInputsVisible = ref(false);
const roundCards = reactive([]); // { playerId, name, selected: [] }

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتائج الجولة');
const modalLogs = ref([]);

const namesHint = computed(() => (isRoundActive.value
  ? '🔒 مقفول أثناء الجولة النشطة — سيُفتح تلقائياً بعد انتهاء الجولة.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل أثناء الجولة النشطة.'));

const controlsDisabled = computed(() => isRoundActive.value);

function playerBadgeText(p) {
  if (gameFinished.value && winners.value.some((w) => w.id === p.id)) return '🏆 فائز!';
  if (p.score <= LOSE_SCORE) return '💀';
  return `${p.score} نقطة`;
}

function updateTextareaFromPlayers() {
  namesInput.value = players.map((p) => p.name).join('\n');
}

function syncTextareaToPlayers() {
  if (isRoundActive.value) return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];

  if (names.length === 0) {
    players.splice(0, players.length);
    saveToStorage();
    return;
  }

  const newList = names.map((name) => {
    const existing = players.find((p) => p.name === name);
    return existing || { id: playerIdCounter++, name, score: 0 };
  });
  players.splice(0, players.length, ...newList);
  saveToStorage();
}

function addPlayer(explicitTeam) {
  if (isRoundActive.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;

  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً في القائمة!`]);
    return;
  }

  players.push({
    id: playerIdCounter++, name, score: 0, team: tugOfWarEnabled.value ? (explicitTeam || assignTeam()) : null, tugContributions: 0,
  });
  newPlayerName.value = '';
  updateTextareaFromPlayers();
  saveToStorage();
}

function removePlayer(id) {
  if (isRoundActive.value) return;
  const idx = players.findIndex((p) => p.id === id);
  if (idx !== -1) players.splice(idx, 1);
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name, avatar, explicitTeam) {
  if (isRoundActive.value) return;
  if (gameFinished.value) return;
  if (!name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);

  if (players.some((p) => p.name === name)) return;

  players.push({
    id: playerIdCounter++,
    name,
    avatar: avatar || getUserAvatar(name),
    score: 0,
    team: tugOfWarEnabled.value ? (explicitTeam || assignTeam()) : null,
    tugContributions: 0,
  });
  updateTextareaFromPlayers();
  saveToStorage();
}

// يستخرج أول count رقم مختلف ضمن [minN, maxN] من نص الكومنت (يقبل الأرقام بالعربي الغربي والشرقي)
// نطاق حتى 9 (نرد عادي): قراءة رقم برقم، يدعم كتابة الأرقام ملتصقة مثل "13". نطاق فوق 9 (نرد مزدوج): قراءة أعداد كاملة.
function parseNumbersFromText(text, count, minN, maxN) {
  const normalized = normalizeDigits(text);
  const nums = [];
  if (maxN <= 9) {
    const tokens = normalized.split(/[^0-9]+/).filter((t) => t.length > 0);
    for (const t of tokens) {
      for (const ch of t) {
        const n = Number(ch);
        if (n >= minN && n <= maxN && !nums.includes(n)) nums.push(n);
        if (nums.length >= count) break;
      }
      if (nums.length >= count) break;
    }
  } else {
    const matches = normalized.match(/\d+/g) || [];
    for (const m of matches) {
      const n = Number(m);
      if (n >= minN && n <= maxN && !nums.includes(n)) nums.push(n);
      if (nums.length >= count) break;
    }
  }
  return nums.length === count ? nums : [];
}

function registerGuessFromComment(username, rawText) {
  if (!isRoundActive.value) return;
  if (!username || !rawText) return;

  const player = players.find((p) => p.name === username && p.score > LOSE_SCORE);
  if (!player) return;

  const card = roundCards.find((c) => c.playerId === player.id);
  if (!card) return;

  if (bettingEnabled.value) {
    // يقبل "رهان2"، "bet 2"، أو اختصار "ن2" بأي موقع من الكومنت
    const betMatch = normalizeDigits(rawText).match(/(?:رهان|bet|ن)\D*([1-3])/i);
    if (betMatch) {
      setBet(card, Number(betMatch[1]));
      return;
    }
  }

  const nums = parseNumbersFromText(rawText, card.requiredCount, minDiceNum.value, maxDiceNum.value);
  if (nums.length !== card.requiredCount) return;

  card.selected = nums;
  card.statusText = `✅ استلمنا توقعك من الدردشة: ${nums.join(' و ')}`;
  card.statusFilled = true;
}

function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 5) val = 5;
  if (val > 120) val = 120;
  roundDurationInput.value = val;
  return val;
}

async function startRound() {
  if (isRoundActive.value || gameFinished.value || tournamentModeEnabled.value) return;

  const activePlayers = players.filter((p) => p.score > LOSE_SCORE);
  if (activePlayers.length < 1) {
    const joinHint = joinViaGift.value ? 'يرسلون هدية' : `يكتبون "${getJoinWord()}"`;
    openModal('تنبيه', [`تحتاج إلى لاعب واحد على الأقل نشط للبدء! أضف لاعبين أو خل المشاهدين ${joinHint}.`]);
    return;
  }

  roundDuration.value = getRoundDuration();
  roundToken++;
  currentRound.value++;
  isGoldenRound.value = goldenRoundEnabled.value && Math.random() < 0.1;

  resetDiceDisplay();
  const goldenPrefix = isGoldenRound.value ? '🌟 جولة ذهبية! كل النقاط مضاعفة 🌟 — ' : '';
  diceCaption.value = `${goldenPrefix}⏳ باب التوقعات مفتوح (${roundDuration.value} ثانية)... اكتب ${guessCountLabel()} بالدردشة مثل "${guessExampleText()}"`;
  isRoundActive.value = true;

  prepareRoundInputs();
  startTimer();
}

function waitingStatusText(count) {
  return count === 1
    ? '🕓 بانتظار التوقع (اكتب رقم واحد بالدردشة أو اختر يدوياً)'
    : '🕓 بانتظار التوقع (اكتب رقمين بالدردشة أو اختر يدوياً)';
}

function prepareRoundInputs() {
  roundCards.splice(0, roundCards.length);
  const activePlayers = players.filter((p) => p.score > LOSE_SCORE);
  const baseCount = numbersToPick.value;
  activePlayers.forEach((p) => {
    roundCards.push({
      playerId: p.id,
      name: p.name,
      selected: [],
      baseCount,
      requiredCount: baseCount,
      bet: 1,
      statusText: waitingStatusText(baseCount),
      statusFilled: false,
    });
  });
  roundInputsVisible.value = true;
}

function toggleNumber(card, num) {
  const idx = card.selected.indexOf(num);
  if (idx !== -1) {
    card.selected.splice(idx, 1);
  } else {
    if (card.selected.length >= card.requiredCount) card.selected.shift();
    card.selected.push(num);
  }

  if (card.selected.length === card.requiredCount) {
    card.statusText = `✅ التوقع جاهز (يدوي): ${card.selected.join(' و ')}`;
    card.statusFilled = true;
  } else if (card.selected.length > 0) {
    card.statusText = `🕓 اخترت ${card.selected.length}/${card.requiredCount}، أكمل الباقي...`;
    card.statusFilled = false;
  } else {
    card.statusText = waitingStatusText(card.requiredCount);
    card.statusFilled = false;
  }
}

function setBet(card, amount) {
  card.bet = Math.min(3, Math.max(1, amount));
}

function grantExtraNumber(username) {
  if (!isRoundActive.value) return;
  const player = players.find((p) => p.name === username && p.score > LOSE_SCORE);
  if (!player) return;
  const card = roundCards.find((c) => c.playerId === player.id);
  if (!card) return;

  const cap = card.baseCount + 2; // سقف: رقمين إضافيين كحد أقصى لكل لاعب بالجولة
  if (card.requiredCount >= cap) return;
  card.requiredCount++;
  card.statusText = `🎁 هدية! رقم إضافي (${card.selected.length}/${card.requiredCount}) — أكمل توقعك`;
  card.statusFilled = card.selected.length === card.requiredCount;
}

function resetDiceDisplay() {
  diceFace.value = '🎲';
  diceFace2.value = '🎲';
  diceRolling.value = false;
  timerDisplay.value = '--';
  timerUrgent.value = false;
  diceCaption.value = 'اضغط "بدء الجولة" لفتح باب التوقعات';
  diceResultLabel.value = '';
}

function startTimer() {
  let timeLeft = roundDuration.value;
  timerDisplay.value = String(timeLeft);
  timerUrgent.value = false;

  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    timeLeft--;
    timerDisplay.value = String(Math.max(timeLeft, 0));
    if (timeLeft <= 5) timerUrgent.value = true;

    if (timeLeft <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      rollDiceAndEvaluate();
    }
  }, 1000);
}

async function rollDiceAndEvaluate() {
  if (!isRoundActive.value) return;

  isRoundActive.value = false;
  const myToken = roundToken;
  diceRolling.value = true;
  diceCaption.value = doubleDiceMode.value ? '🎲🎲 جاري رمي النردين تلقائياً...' : '🎲 جاري رمي النرد تلقائياً...';
  diceResultLabel.value = '';
  playDiceRollSound();

  await new Promise((resolve) => {
    let ticks = 0;
    rollAnimTimer = setInterval(() => {
      diceFace.value = DICE_FACES[Math.floor(Math.random() * 6)];
      if (doubleDiceMode.value) diceFace2.value = DICE_FACES[Math.floor(Math.random() * 6)];
      ticks++;
      if (ticks >= 12) {
        clearInterval(rollAnimTimer);
        rollAnimTimer = null;
        resolve();
      }
    }, 100);
  });

  if (myToken !== roundToken) return;

  if (doubleDiceMode.value) {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    diceFace.value = DICE_FACES[d1 - 1];
    diceFace2.value = DICE_FACES[d2 - 1];
    rolledValue.value = d1 + d2;
    diceResultLabel.value = `المجموع الفائز هو: ${rolledValue.value} (${d1} + ${d2})`;
  } else {
    rolledValue.value = Math.floor(Math.random() * 6) + 1;
    diceFace.value = DICE_FACES[rolledValue.value - 1];
    diceResultLabel.value = `الرقم الفائز هو: ${rolledValue.value}`;
  }
  diceRolling.value = false;
  diceCaption.value = 'نتيجة هذه الجولة:';

  // مهلة قصيرة عشان الرقم الفائز يبين واضح فوق النرد قبل ما تغطيه نافذة النتيجة
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (myToken !== roundToken) return;

  evaluateRound();
}

function buildScoreboardHtml() {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const items = sorted.map((p) => {
    const isWinner = gameFinished.value && winners.value.some((w) => w.id === p.id);
    const isEliminated = p.score <= LOSE_SCORE;
    const cls = `scoreboard-item${isWinner ? ' is-winner' : ''}${isEliminated ? ' is-eliminated' : ''}`;
    const badge = isWinner ? '🏆 فائز' : (isEliminated ? '💀 خرج' : `${p.score} نقطة`);
    return `<div class="${cls}"><span>${escapeHtml(p.name)}</span><span>${badge}</span></div>`;
  }).join('');
  return `<div class="scoreboard-title">📊 لوحة نقاط كل المتسابقين</div><div class="scoreboard-list">${items || '<div class="scoreboard-item">لا يوجد لاعبون بعد</div>'}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function evaluateRound() {
  const logs = [];
  const resultLine = doubleDiceMode.value
    ? `🎲🎲 المجموع الفائز هو: ${rolledValue.value}`
    : `🎲 الرقم الفائز هو: ${rolledValue.value}`;
  logs.push(`<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:8px;">${resultLine}</div>`);
  if (isGoldenRound.value) {
    logs.push('<div class="log-item" style="background:#f39c12; color:#1e1e2f; font-weight:bold; text-align:center;">🌟 جولة ذهبية! كل النقاط مضاعفة هذه الجولة 🌟</div>');
  }
  const goldenMultiplier = isGoldenRound.value ? 2 : 1;

  let allCorrect = true;
  let participatingCount = 0;
  const roundResults = [];

  roundCards.forEach((card) => {
    const player = players.find((p) => p.id === card.playerId);
    if (!player) return;

    if (card.selected.length !== card.requiredCount) {
      logs.push(`<div class="log-item" style="color:#8b93a3;">⏳ <b>${escapeHtml(player.name)}</b> ما شارك بتوقع كامل هذه الجولة.</div>`);
      return;
    }

    participatingCount++;
    const isCorrect = card.selected.includes(rolledValue.value);
    roundResults.push({ player, isCorrect, card });
    if (!isCorrect) allCorrect = false;
  });

  roundResults.forEach((res) => {
    const baseDelta = bettingEnabled.value
      ? (res.card.bet || 1)
      : (res.isCorrect && res.card.baseCount === 1 ? 2 : 1);
    const delta = baseDelta * goldenMultiplier;
    const betNote = bettingEnabled.value ? ` (رهان: ${res.card.bet || 1}${isGoldenRound.value ? ' × 2' : ''})` : '';

    if (res.isCorrect) {
      res.player.score += delta;
      logs.push(`<div class="log-item log-hit">🎯 <b>${escapeHtml(res.player.name)}</b> جاوب صح وكسب ${delta} نقطة${betNote} (+${delta}). الرصيد الآن: ${res.player.score}</div>`);
    } else {
      res.player.score -= delta;
      logs.push(`<div class="log-item log-miss">❌ <b>${escapeHtml(res.player.name)}</b> جاوب غلط وخسر ${delta} نقطة${betNote} (-${delta}). الرصيد الآن: ${res.player.score}</div>`);
    }
  });

  if (allCorrect && participatingCount > 0) {
    const bonus = 1 * goldenMultiplier;
    logs.push(`<div class="log-item" style="background:#27ae60; color:white; font-weight:bold; text-align:center; font-size:1rem; padding:10px;">🔥 ما شاء الله كل اللاعبين المشاركين جاوبوا صح! كل واحد منهم يكسب ${bonus} نقطة إضافية (+${bonus})!</div>`);
    roundResults.forEach((res) => { res.player.score += bonus; });
  }

  if (tugOfWarEnabled.value) {
    let pullA = 0; let pullB = 0;
    roundResults.forEach((res) => {
      if (!res.isCorrect) return;
      if (res.player.team === 'A') { pullA++; res.player.tugContributions = (res.player.tugContributions || 0) + 1; } else if (res.player.team === 'B') { pullB++; res.player.tugContributions = (res.player.tugContributions || 0) + 1; }
    });
    if (pullA !== 0 || pullB !== 0) {
      tugPosition.value += pullA - pullB;
      logs.push(`<div class="log-item" style="text-align:center; font-weight:bold;">🪢 سحب الحبل: ${escapeHtml(teamAName.value)} ${pullA} — ${pullB} ${escapeHtml(teamBName.value)} (الموقع الآن: ${tugPosition.value > 0 ? '+' : ''}${tugPosition.value})</div>`);
    }
    if (!tugWinnerTeam.value && Math.abs(tugPosition.value) >= tugTarget.value) {
      tugWinnerTeam.value = tugPosition.value > 0 ? 'A' : 'B';
      gameFinished.value = true;
      playWinSound();
      const winningTeamName = tugWinnerTeam.value === 'A' ? teamAName.value : teamBName.value;
      const mvps = players.filter((p) => p.team === tugWinnerTeam.value)
        .slice()
        .sort((a, b) => (b.tugContributions || 0) - (a.tugContributions || 0))
        .slice(0, 3);
      const mvpNames = mvps.length > 0
        ? mvps.map((p) => `<b>${escapeHtml(p.name)}</b> (${p.tugContributions || 0})`).join('، ')
        : 'لا يوجد';
      logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🪢🏆 فاز <b>${escapeHtml(winningTeamName)}</b> بشد الحبل! 🏆<br><span style="font-size:0.85rem; color:#ccd6e0;">أبرز المساهمين: ${mvpNames}</span></div>`);
    }
  }

  const newlyEliminated = players.filter((p) => p.score <= LOSE_SCORE);
  if (newlyEliminated.length > 0) playEliminationSound();
  newlyEliminated.forEach((p) => {
    logs.push(`<div class="log-item" style="background:#8A1538; color:white; font-weight:bold;">💀 ${escapeHtml(p.name)} وصل لـ ${LOSE_SCORE} وخرج من اللعبة!</div>`);
  });

  const newWinners = players.filter((p) => p.score >= winScore.value);
  if (newWinners.length > 0) {
    gameFinished.value = true;
    winners.value = newWinners;
    playWinSound();
    const names = newWinners.map((w) => escapeHtml(w.name)).join('، ');
    logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 وصل لـ ${winScore.value} نقاط وفاز باللعبة: <b>${names}</b> 🏆<br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "إعادة اللعبة" للبدء من جديد</span></div>`);
  } else {
    const remainingActive = players.filter((p) => p.score > LOSE_SCORE);
    if (players.length > 0 && remainingActive.length === 0) {
      gameFinished.value = true;
      logs.push('<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🤝 كل اللاعبين خرجوا — لا يوجد فائز! اضغط "إعادة اللعبة" لمحاولة جديدة.</div>');
    }
  }

  logs.push(buildScoreboardHtml());

  saveToStorage();
  roundInputsVisible.value = false;
  timerUrgent.value = false;
  diceCaption.value = gameFinished.value
    ? 'انتهت اللعبة — اضغط "إعادة اللعبة" للبدء من جديد'
    : 'اضغط "بدء الجولة" لفتح باب التوقعات';

  openModal('نتائج الجولة', logs);
}

function openModal(title, messagesArray) {
  modalTitle.value = title;
  modalLogs.value = messagesArray;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  if (tournamentActive.value && currentMatch.value) {
    const match = currentMatch.value;
    if (match.resolved) {
      currentMatchIdx.value++;
      advanceToNextPlayableMatch();
    } else {
      matchCards.forEach((c) => { c.selected = null; c.conflictHint = ''; });
      resetDiceDisplay();
      diceCaption.value = `⚔️ مباراة: ${playerName(match.p1)} ضد ${playerName(match.p2)} (${match.score1} - ${match.score2}) — الجولة ${match.roundsPlayed + 1}/${MATCH_ROUNDS}`;
    }
  }
}

function resetGame() {
  roundToken++;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (rollAnimTimer) { clearInterval(rollAnimTimer); rollAnimTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = false;
  winners.value = [];
  isGoldenRound.value = false;
  tiktokJoinedUsers.clear();
  stopRegistration();

  players.forEach((p) => { p.score = 0; p.tugContributions = 0; });
  currentRound.value = 0;
  roundInputsVisible.value = false;

  tugPosition.value = 0;
  tugWinnerTeam.value = null;

  tournamentActive.value = false;
  tournamentFinished.value = false;
  tournamentRounds.splice(0, tournamentRounds.length);
  tournamentWildcardQueue.splice(0, tournamentWildcardQueue.length);
  tournamentChampionId.value = null;
  currentRoundIdx.value = 0;
  currentMatchIdx.value = 0;
  matchCards.splice(0, matchCards.length);
  matchRoundActive.value = false;

  saveToStorage();
  resetDiceDisplay();
}

function goHome() {
  router.push('/');
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const activeElement = document.activeElement;
    if (activeElement && ['TEXTAREA', 'SELECT', 'INPUT'].includes(activeElement.tagName)) return;
    e.preventDefault();
    if (!isRoundActive.value && !gameFinished.value) startRound();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
const joinWordInput = ref('بلعب');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});

function getJoinWord() {
  return joinWordInput.value.trim() || 'بلعب';
}

// ===== شراء الرجوع للعبة بالهدايا (للاعبين الخارجين) =====
const buyReturnEnabled = ref(false);
const buyReturnGift = ref('');
const buyReturnMinValue = ref(null);
const selectedBuyReturnGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === buyReturnGift.value);
  return found ? found.label : '🎁 أي هدية';
});

function returnPlayerFromGift(username) {
  if (!username) return;

  if (tournamentModeEnabled.value) {
    if (!tournamentActive.value || tournamentFinished.value) return; // ما في رجوع بعد إعلان البطل
    const player = players.find((p) => p.name === username);
    if (!player) return;
    if (tournamentWildcardQueue.includes(player.id)) return;
    if (currentMatch.value && (currentMatch.value.p1 === player.id || currentMatch.value.p2 === player.id)) return;
    const stillInBracket = tournamentRounds.some((round) => round.some(
      (m) => (m.p1 === player.id || m.p2 === player.id) && !m.resolved,
    ));
    if (stillInBracket) return; // لسا داخل مباراة لم تُحسم
    tournamentWildcardQueue.push(player.id);
    return;
  }

  if (gameFinished.value) return;
  const player = players.find((p) => p.name === username && p.score <= LOSE_SCORE);
  if (!player) return;
  player.score = 0;
  saveToStorage();
}

// ===== هدية تمنح نقطة مباشرة =====
function grantPointFromGift(username) {
  if (!username || gameFinished.value) return;
  const player = players.find((p) => p.name === username && p.score > LOSE_SCORE);
  if (!player) return;
  player.score += 1;
  saveToStorage();
  checkImmediateWin(player);
}

function checkImmediateWin(player) {
  if (gameFinished.value) return;
  if (player.score < winScore.value) return;

  gameFinished.value = true;
  winners.value = [player];
  isRoundActive.value = false;
  roundInputsVisible.value = false;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  diceCaption.value = 'انتهت اللعبة — اضغط "إعادة اللعبة" للبدء من جديد';
  playWinSound();

  const logs = [
    `<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 وصل لـ ${winScore.value} نقاط بهدية وفاز باللعبة: <b>${escapeHtml(player.name)}</b> 🏆<br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "إعادة اللعبة" للبدء من جديد</span></div>`,
    buildScoreboardHtml(),
  ];
  openModal('🏆 فوز فوري بالهدايا!', logs);
}

const joinModeHint = computed(() => {
  if (joinViaGift.value) {
    return 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء البث ينضم تلقائياً كلاعب (يُوزَّع على فريق بالتوازن تلقائياً لو فزعة الفرق مفعّلة). حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.';
  }
  if (tugOfWarEnabled.value) {
    return `المشاهد يكتب "1" بالدردشة للانضمام لفريق "${teamAName.value}"، أو "2" للانضمام لفريق "${teamBName.value}". الاختيار نهائي وقت الانضمام قبل بدء اللعبة.`;
  }
  return `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم كلاعب. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال أي هدية بدل الكتابة.`;
});

const tiktokSectionLabel = computed(() => {
  if (joinViaGift.value) {
    return `🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً كلاعب، وأثناء الجولة يكتب توقعه ${guessCountLabel()} مثل "${guessExampleText()}"`;
  }
  if (tugOfWarEnabled.value) {
    return `🔴 ربط بث تيك توك لايف (اختياري): "1" للانضمام لفريق "${teamAName.value}"، "2" للانضمام لفريق "${teamBName.value}"، وأثناء الجولة يكتب توقعه ${guessCountLabel()} مثل "${guessExampleText()}"`;
  }
  return `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب، وأثناء الجولة يكتب توقعه ${guessCountLabel()} مثل "${guessExampleText()}"`;
});

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

// يحاول يعامل الكومنت كطلب انضمام (كلمة الانضمام العادية، أو 1/2 لاختيار فريق بوضع فزعة الفرق). يرجّع true لو تم الانضمام
function tryHandleJoinComment(username, avatar, text) {
  if (!registrationOpen.value || joinViaGift.value) return false;

  if (tugOfWarEnabled.value) {
    const normalized = normalizeDigits(text);
    if (normalized === '1') { addPlayerFromTikTok(username, avatar, 'A'); return true; }
    if (normalized === '2') { addPlayerFromTikTok(username, avatar, 'B'); return true; }
    return false;
  }

  if (normalizeDigits(text) === normalizeDigits(getJoinWord())) {
    addPlayerFromTikTok(username, avatar);
    return true;
  }
  return false;
}

function handleTiktokMessage(data) {
  if (data.comment) {
    const text = data.comment.trim();
    if (!tryHandleJoinComment(data.user, data.avatar, text)) {
      if (tournamentActive.value) {
        registerMatchGuessFromComment(data.user, text);
      } else {
        registerGuessFromComment(data.user, text);
      }
    }
  }
  if (isGiftEvent(data)) {
    if (registrationOpen.value && joinViaGift.value
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data), data.avatar);
    }
    if (buyReturnEnabled.value
      && giftPassesFilter(data, { nameFilter: buyReturnGift.value, minValue: buyReturnMinValue.value })) {
      returnPlayerFromGift(getGiftUser(data));
    }
    if (extraNumberGiftEnabled.value && isRoundActive.value
      && giftPassesFilter(data, { nameFilter: extraNumberGift.value, minValue: extraNumberGiftMinValue.value })) {
      grantExtraNumber(getGiftUser(data));
    }
    if (pointGiftEnabled.value
      && giftPassesFilter(data, { nameFilter: pointGift.value, minValue: pointGiftMinValue.value })) {
      grantPointFromGift(getGiftUser(data));
    }
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'dice', onMessage: handleTiktokMessage });
}

const barExpanded = ref(true);

const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

const advancedSettingsModalVisible = ref(false);
function openAdvancedSettingsModal() { advancedSettingsModalVisible.value = true; }
function closeAdvancedSettingsModal() { advancedSettingsModalVisible.value = false; }

// ===== شريط "الأقرب للفوز / للخروج" =====
const closestToWin = computed(() => players
  .filter((p) => p.score > LOSE_SCORE && !(gameFinished.value && winners.value.some((w) => w.id === p.id)))
  .slice()
  .sort((a, b) => b.score - a.score)
  .slice(0, 3));

const closestToLose = computed(() => players
  .filter((p) => p.score > LOSE_SCORE)
  .slice()
  .sort((a, b) => a.score - b.score)
  .slice(0, 3));

function winProgressPct(score) {
  return Math.max(0, Math.min(100, (score / winScore.value) * 100));
}
function losePct(score) {
  return Math.max(0, Math.min(100, ((winScore.value - score) / (winScore.value - LOSE_SCORE)) * 100));
}

onMounted(() => {
  nextTick(() => resetDiceDisplay());
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (rollAnimTimer) clearInterval(rollAnimTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🎲 رمعة نرد</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="rules-btn" @click="openAdvancedSettingsModal">⚙️ إعدادات متقدمة</button>
    <button class="rules-btn" @click="soundEnabled = !soundEnabled">{{ soundEnabled ? '🔊 الصوت' : '🔇 الصوت' }}</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <div v-if="players.length > 0 && !tournamentModeEnabled" class="closeness-bar">
    <div class="closeness-col">
      <div class="closeness-title">🏆 الأقرب للفوز</div>
      <div v-for="p in closestToWin" :key="'w' + p.id" class="closeness-row" :class="{ 'pulse-gold': p.score === winScore - 1 }">
        <span class="closeness-name">{{ p.name }}</span>
        <div class="closeness-track"><div class="closeness-fill win" :style="{ width: winProgressPct(p.score) + '%' }"></div></div>
        <span class="closeness-score">{{ p.score }}</span>
      </div>
      <div v-if="closestToWin.length === 0" class="field-hint" style="text-align:center; margin:0;">لا يوجد لاعبون نشطون بعد</div>
    </div>
    <div class="closeness-col">
      <div class="closeness-title">💀 الأقرب للخروج</div>
      <div v-for="p in closestToLose" :key="'l' + p.id" class="closeness-row" :class="{ 'pulse-red': p.score === LOSE_SCORE + 1 }">
        <span class="closeness-name">{{ p.name }}</span>
        <div class="closeness-track"><div class="closeness-fill lose" :style="{ width: losePct(p.score) + '%' }"></div></div>
        <span class="closeness-score">{{ p.score }}</span>
      </div>
      <div v-if="closestToLose.length === 0" class="field-hint" style="text-align:center; margin:0;">لا يوجد لاعبون نشطون بعد</div>
    </div>
  </div>

  <div class="top-names-section">
    <label for="roundDurationInput">⏱️ مدة كل جولة بالثواني (يحددها المستضيف):</label>
    <div class="round-time-row">
      <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="5" max="120">
      <div class="field-hint" style="margin-top:0;">بعد انتهاء هذا الوقت يُرمى النرد تلقائياً وتُحتسب النتائج.</div>
    </div>
    <label for="winScoreInput" style="margin-top:12px;">🏆 نقاط الفوز (يحددها المستضيف):</label>
    <div class="round-time-row">
      <input id="winScoreInput" v-model="winScoreInput" type="number" min="1" max="100">
      <div class="field-hint" style="margin-top:0;">أول لاعب يوصل لهذا العدد من النقاط يفوز فوراً باللعبة.</div>
    </div>
  </div>

  <div class="master-controls" style="margin-top:-5px;">
    <label class="join-gift-toggle" for="buyReturnCheckbox" style="margin:0;">
      <input id="buyReturnCheckbox" v-model="buyReturnEnabled" type="checkbox">
      🔄 شراء الرجوع للعبة بالهدايا (للاعبين الخارجين)
    </label>
    <template v-if="buyReturnEnabled">
      <CustomSelect v-model="buyReturnGift" :options="GIFT_OPTIONS" style="width:160px;" />
      <input v-model="buyReturnMinValue" type="number" min="0" placeholder="أقل قيمة (اختياري)" style="width:140px; padding:6px;">
    </template>
  </div>
  <div v-if="buyReturnEnabled" class="field-hint" style="text-align:center; width:100%; margin-top:-10px; margin-bottom:15px;">🎁 أي لاعب خارج يرسل <b>"{{ selectedBuyReturnGiftLabel }}"</b>{{ buyReturnMinValue ? ` (بقيمة ${buyReturnMinValue}+ كوينز)` : '' }} يرجع فوراً للعبة برصيد 0 نقطة.</div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="!isRoundActive && !tournamentModeEnabled" class="master-btn side-panel-btn" id="startBtn" :disabled="gameFinished" @click="startRound">🎲 بدء الجولة (فتح التوقعات)</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ players.length }}</span></button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : (tugOfWarEnabled ? '🅰️1 / 🅱️2 للانضمام' : `🎟️ رمز الانضمام: ${getJoinWord()}`) }}</button>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ players.length }})</h3>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="tugOfWarEnabled ? addPlayer('A') : addPlayer()">
        <button v-if="!tugOfWarEnabled" class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayer()">➕ إضافة</button>
        <template v-else>
          <button class="master-btn" style="margin:0; padding:10px 16px; background:#3498db;" @click="addPlayer('A')">➕ {{ teamAName }}</button>
          <button class="master-btn" style="margin:0; padding:10px 16px; background:#e74c3c;" @click="addPlayer('B')">➕ {{ teamBName }}</button>
        </template>
      </div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in players" :key="p.id" class="players-modal-item">
          <span class="players-modal-item-name">
            <img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">
            <span v-if="tugOfWarEnabled && p.team" class="team-dot" :class="p.team === 'A' ? 'team-a' : 'team-b'"></span>
            {{ p.name }}
          </span>
          <button type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️ حذف</button>
        </div>
      </div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
    </div>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ tiktokSectionLabel }}</label>
      <div class="join-settings-row" style="margin-top:0;">
        <label class="join-gift-toggle" for="joinViaGiftCheckboxModal">
          <input id="joinViaGiftCheckboxModal" v-model="joinViaGift" type="checkbox">
          🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
        </label>
      </div>
      <div v-if="!joinViaGift && !tugOfWarEnabled" class="join-settings-row">
        <input v-model="joinWordInput" type="text" placeholder="كلمة الانضمام (افتراضياً: بلعب)">
      </div>
      <div v-if="!joinViaGift && tugOfWarEnabled" class="field-hint" style="margin-top:8px; font-size:0.85rem;">
        🅰️ يكتب <b>1</b> للانضمام لفريق "<span class="team-a-text">{{ teamAName }}</span>" — 🅱️ يكتب <b>2</b> للانضمام لفريق "<span class="team-b-text">{{ teamBName }}</span>"
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div class="field-hint">{{ joinModeHint }}</div>
      <div class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
        <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div v-if="advancedSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeAdvancedSettingsModal">
    <div class="players-modal-card">
      <h3>⚙️ إعدادات اللعبة المتقدمة</h3>

      <label class="join-gift-toggle">
        <input type="checkbox" v-model="goldenRoundEnabled">
        🌟 الجولة الذهبية (فرصة 10% كل جولة تضاعف النقاط للفائز والخاسر)
      </label>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" :checked="tournamentModeEnabled" @change="toggleTournamentMode($event.target.checked)">
        🏆 وضع الدوري (مباريات 1 ضد 1 حتى نهائي واحد)
      </label>
      <div v-if="tournamentModeEnabled" class="field-hint">يستبدل وضع الدوري اللعب الفردي بالكامل: كل مباراة بين لاعبين، رقم واحد لكل واحد (نرد عادي 1-6)، ممنوع الاثنين يختارون نفس الرقم. بعد 5 جولات، صاحب النتيجة الأعلى يفوز بالمباراة ويتأهل (تعادل = جولة حاسمة إضافية)، حتى نهائي واحد. اللاعب الخارج يقدر يرجع بهدية "شراء الرجوع" لمباراة جديدة، إلا بعد إعلان بطل الدوري.</div>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" :checked="tugOfWarEnabled" @change="toggleTugOfWar($event.target.checked)">
        🪢 فزعة الفرق (تنافس جماعي بين فريقين)
      </label>
      <div v-if="tugOfWarEnabled" class="join-settings-row">
        <input v-model="teamAName" type="text" placeholder="اسم الفريق الأول">
        <input v-model="teamBName" type="text" placeholder="اسم الفريق الثاني">
      </div>
      <div v-if="tugOfWarEnabled" class="round-time-row">
        <span class="field-hint" style="margin:0;">🎯 نقاط السحب للفوز:</span>
        <input v-model="tugTargetInput" type="number" min="1" max="100">
      </div>
      <div v-if="tugOfWarEnabled" class="field-hint">كل لاعب ينضم يُوزَّع تلقائياً على أحد الفريقين. كل توقع صحيح بجولة عادية يسحب المؤشر نقطة لفريق صاحبه؛ أول فريق يوصل لعدد نقاط السحب المحدد يفوز، وتُعرض أبرز 3 مساهمين من فريقه.</div>

      <label class="join-settings-label" style="margin-top:14px; display:block;">🎯 وضع التوقع</label>
      <div class="join-settings-row" style="margin-top:0;">
        <label class="join-gift-toggle">
          <input type="radio" name="numbersToPick" :value="2" v-model.number="numbersToPick" :disabled="controlsDisabled">
          رقمين (عادي)
        </label>
        <label class="join-gift-toggle">
          <input type="radio" name="numbersToPick" :value="1" v-model.number="numbersToPick" :disabled="controlsDisabled">
          رقم واحد (مخاطرة أعلى، مكافأة أكبر)
        </label>
      </div>
      <div class="field-hint">توقع رقم واحد أصعب (احتمال أقل)، فمكافأة الإجابة الصحيحة تصير نقطتين بدل نقطة واحدة.</div>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" v-model="doubleDiceMode" :disabled="controlsDisabled">
        🎲🎲 نرد مزدوج (رمي نردين واحتساب مجموعهما)
      </label>
      <div class="field-hint">يوسّع نطاق التوقعات إلى 2-12 بدل 1-6.</div>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" v-model="bettingEnabled">
        🎯 تفعيل الرهان بالنقاط (1-3 لكل لاعب)
      </label>
      <div class="field-hint">كل لاعب يحدد رهانه يدوياً من أزرار البطاقة، أو بكتابة "رهان 2" أو اختصار "ن2" بأي مكان بالكومنت. الفوز = +الرهان، الخسارة = -الرهان (بدل نقطة ثابتة).</div>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" v-model="extraNumberGiftEnabled">
        🎁 هدية تمنح رقم توقع إضافي أثناء الجولة
      </label>
      <div v-if="extraNumberGiftEnabled" class="gift-filter-row">
        <CustomSelect v-model="extraNumberGift" :options="GIFT_OPTIONS" />
        <input v-model="extraNumberGiftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div v-if="extraNumberGiftEnabled" class="field-hint">أي لاعب داخل جولة نشطة يرسل "{{ selectedExtraNumberGiftLabel }}"{{ extraNumberGiftMinValue ? ` (بقيمة ${extraNumberGiftMinValue}+ كوينز)` : '' }} يحصل فوراً على رقم توقع إضافي (سقف: رقمين إضافيين لكل لاعب بالجولة).</div>

      <label class="join-gift-toggle" style="margin-top:14px;">
        <input type="checkbox" v-model="pointGiftEnabled">
        🎁 هدية تمنح نقطة مباشرة لأي لاعب نشط
      </label>
      <div v-if="pointGiftEnabled" class="gift-filter-row">
        <CustomSelect v-model="pointGift" :options="GIFT_OPTIONS" />
        <input v-model="pointGiftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
      </div>
      <div v-if="pointGiftEnabled" class="field-hint">أي لاعب نشط يرسل "{{ selectedPointGiftLabel }}"{{ pointGiftMinValue ? ` (بقيمة ${pointGiftMinValue}+ كوينز)` : '' }} يكسب نقطة فوراً (يعمل بأي وقت، حتى خارج الجولة). لو النقطة وصلت به لعدد نقاط الفوز يفوز فوراً باللعبة.</div>

      <div class="field-hint">🔊 يمكنك كتم/تفعيل أصوات اللعبة (رمي النرد، الخروج، الفوز) من زر "{{ soundEnabled ? '🔊 الصوت' : '🔇 الصوت' }}" أعلى الشاشة.</div>

      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeAdvancedSettingsModal">إغلاق</button>
    </div>
  </div>

  <div v-if="tournamentModeEnabled" class="layout-wrapper">
    <div class="panel">
      <h2>🏆 وضع الدوري</h2>

      <div v-if="!tournamentActive && !tournamentFinished" style="width:100%; text-align:center;">
        <div class="field-hint" style="margin-bottom:12px;">مباريات 1 ضد 1 (نرد عادي، رقم واحد لكل لاعب، ممنوع تكرار نفس الرقم بين الخصمين). أول من يوصل {{ MATCH_WIN_POINTS }} نقاط يفوز، أو صاحب النتيجة الأعلى بعد {{ MATCH_ROUNDS }} جولات — تعادل بعد {{ MATCH_ROUNDS }} جولات يعني خروج اللاعبين الاثنين من الدوري.</div>
        <button class="master-btn" @click="startTournament">🏆 بدء الدوري ({{ players.length }} لاعب)</button>
      </div>

      <div v-else-if="tournamentActive && currentMatch" style="width:100%;">
        <div class="field-hint" style="text-align:center;">الجولة {{ currentMatch.roundsPlayed + 1 }} من {{ MATCH_ROUNDS }} — أول من يوصل {{ MATCH_WIN_POINTS }} نقاط يفوز فوراً</div>
        <div class="game-arena">
          <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
          <div class="dice-wrap">
            <div class="dice-face" :class="{ rolling: diceRolling }">{{ diceFace }}</div>
          </div>
          <div class="dice-caption">{{ diceCaption }}</div>
          <div class="dice-result-label">{{ diceResultLabel }}</div>
        </div>
        <button v-if="!matchRoundActive" class="master-btn" style="width:100%; margin-top:12px;" @click="startMatchRound">🎲 بدء الجولة</button>
        <div v-if="tournamentWildcardQueue.length > 0" class="field-hint" style="text-align:center; margin-top:8px;">🎁 بانتظار الدخول لمباراة جديدة (رجعوا بهدية): {{ tournamentWildcardQueue.map(playerName).join('، ') }}</div>

        <div class="match-cards-row">
          <div v-for="card in matchCards" :key="card.playerId" class="player-input-card match-card">
            <div class="p-name">{{ card.name }}</div>
            <div class="number-boxes">
              <div
                v-for="n in 6"
                :key="n"
                class="num-box"
                :class="{ selected: card.selected === n }"
                @click="toggleMatchNumber(card, n)"
              >{{ n }}</div>
            </div>
            <div class="guess-status" :class="{ filled: card.selected !== null }">{{ card.conflictHint || (card.selected !== null ? `✅ اخترت: ${card.selected}` : '🕓 اختر رقمك (1-6)') }}</div>
          </div>
        </div>
      </div>

      <div v-else-if="tournamentFinished" style="width:100%; text-align:center;">
        <div style="font-size:18px; color:#f39c12; margin-bottom:12px;">🏆 بطل الدوري: <b>{{ tournamentChampionName }}</b></div>
        <button class="master-btn" @click="startTournament">🔁 دوري جديد</button>
      </div>
    </div>
  </div>

  <div v-else class="layout-wrapper">
    <div v-if="tugOfWarEnabled && players.length > 0" class="panel tug-panel">
      <h2>🪢 فزعة الفرق</h2>
      <div class="tug-teams-row">
        <span class="tug-team-name team-a">{{ teamAName }}</span>
        <span class="tug-team-name team-b">{{ teamBName }}</span>
      </div>
      <div class="tug-track">
        <div class="tug-center-line"></div>
        <div class="tug-marker" :style="{ left: tugMarkerPct + '%' }">🪢</div>
      </div>
      <div class="field-hint" style="text-align:center;">الوصول لـ {{ tugTarget }} نقطة سحب لصالح فريق يفوز به مباشرة</div>
    </div>

    <div class="panel" :class="{ 'golden-arena': isGoldenRound }">
      <h2>ساحة النرد</h2>
      <div class="game-arena">
        <div v-if="isGoldenRound" class="golden-badge">🌟 جولة ذهبية — النقاط مضاعفة 🌟</div>
        <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
        <div class="dice-wrap" :class="{ double: doubleDiceMode }">
          <div class="dice-face" :class="{ rolling: diceRolling }">{{ diceFace }}</div>
          <div v-if="doubleDiceMode" class="dice-face" :class="{ rolling: diceRolling }">{{ diceFace2 }}</div>
        </div>
        <div class="dice-caption">{{ diceCaption }}</div>
        <div class="dice-result-label">{{ diceResultLabel }}</div>
      </div>
    </div>

    <div v-if="roundInputsVisible" class="panel">
      <h3>توقعات اللاعبين ({{ guessCountLabel() }} لكل لاعب{{ doubleDiceMode ? ' — نرد مزدوج 2-12' : '' }})</h3>
      <div>
        <div v-for="card in roundCards" :key="card.playerId" class="player-input-card">
          <div class="p-name">{{ card.name }}</div>
          <div class="number-boxes">
            <div
              v-for="n in numberRangeArray"
              :key="n"
              class="num-box"
              :class="{ selected: card.selected.includes(n) }"
              @click="toggleNumber(card, n)"
            >{{ n }}</div>
          </div>
          <div class="guess-status" :class="{ filled: card.statusFilled }">{{ card.statusText }}</div>
          <div v-if="bettingEnabled" class="bet-row">
            <span class="bet-label">🎯 الرهان:</span>
            <button v-for="n in 3" :key="'bet' + n" type="button" class="bet-btn" :class="{ selected: card.bet === n }" @click="setBet(card, n)">{{ n }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون والنقاط</h3>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span>
            <img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">
            <span v-if="tugOfWarEnabled && p.team" class="team-dot" :class="p.team === 'A' ? 'team-a' : 'team-b'"></span>
            {{ p.name }} <span style="color:#ff4757; margin-right:5px;">{{ playerBadgeText(p) }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showModal" class="modal-overlay" style="display:flex;">
    <div class="modal-content">
      <h2>{{ modalTitle }}</h2>
      <div class="log-list">
        <div v-for="(log, i) in modalLogs" :key="i" v-html="log"></div>
      </div>
      <button class="master-btn" style="width:100%; padding:8px;" @click="closeModal">موافق</button>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة رمعة نرد 🎲</h2>
      <ul class="rules-list">
        <li>كل لاعب يبدأ من <b>0 نقطة</b> بالضبط</li>
        <li>للانضمام من بث التيك توك: يكتب المشاهد كلمة <b>"بلعب"</b> بالدردشة فيُضاف تلقائياً كلاعب</li>
        <li>المستضيف يحدد <b>مدة كل جولة بالثواني</b> قبل الضغط على "بدء الجولة"</li>
        <li>أثناء الوقت المحدد، كل لاعب يكتب توقعه بالدردشة على شكل <b>{{ guessCountLabel() }} من {{ minDiceNum }} إلى {{ maxDiceNum }}</b> مثل "{{ guessExampleText() }}" (ويمكن أيضاً الاختيار يدوياً من الشاشة)</li>
        <li>بمجرد انتهاء الوقت، يُرمى النرد <b>تلقائياً</b> وتُحتسب النتائج بدون أي تدخل من المستضيف</li>
        <li>لا يوجد هجمات بين اللاعبين:
          <br>- الرقم ضمن توقعك → مكسب نقطة (وبدون رهان: نقطتان لو وضع رقم واحد)
          <br>- الرقم مو ضمن توقعك → خسارة نقطة
          <br>- لو الكل جاوب صح بنفس الجولة → نقطة إضافية للجميع
        </li>
        <li>أول لاعب يوصل لـ <b>{{ winScore }} نقاط</b> (يحددها المستضيف) يفوز فوراً باللعبة 🏆</li>
        <li>أي لاعب يوصل لـ <b>-5 نقاط</b> يخرج من اللعبة 💀</li>
        <li>🔄 هدية "شراء الرجوع" ترجع اللاعب الخارج فوراً برصيد <b>0 نقطة</b></li>
        <li>🎁 هدية "منح نقطة" (اختيارية) تعطي أي لاعب نشط نقطة فوراً بأي وقت، حتى لو وصلته لنقاط الفوز يفوز فوراً بدون انتظار جولة</li>
        <li>⚙️ من "إعدادات متقدمة" يقدر المستضيف يفعّل: توقع رقم واحد بدل رقمين، نرد مزدوج (نطاق 2-12)، رهان بالنقاط (1-3، يُحدَّد بكتابة "رهان2" أو اختصار "ن2" بأي مكان بالكومنت)، هدية تمنح رقم توقع إضافي، وهدية تمنح نقطة مباشرة</li>
        <li>🏆💀 شريط أعلى الشاشة يعرض أقرب 3 لاعبين للفوز وأقرب 3 للخروج، وينبض باللون الذهبي/الأحمر لمن كان على بُعد نقطة واحدة فقط</li>
        <li>🌟 فرصة 10% كل جولة تتحول لـ"جولة ذهبية" تضاعف كل النقاط (مكسب وخسارة) — يقدر المستضيف يوقفها من الإعدادات المتقدمة</li>
        <li>🏆 "وضع الدوري" (اختياري، يستبدل اللعب الفردي بالكامل): مباريات 1 ضد 1، رقم واحد لكل لاعب. أول من يوصل 3 نقاط يفوز فوراً، وإلا يُحسم بعد 5 جولات لصاحب النتيجة الأعلى — لو تعادلوا بعد 5 جولات يخرج الاثنان من الدوري ولا أحد يتأهل من هذه المباراة</li>
        <li>🪢 "فزعة الفرق" (اختياري): قبل بدء اللعبة، أثناء التسجيل، المشاهد يكتب "1" للانضمام لفريقه الأول أو "2" للفريق الثاني (اختيار نهائي)، وكل توقع صحيح يسحب مؤشر الحبل لفريقه حتى يصل أحد الفريقين لهدف السحب الذي يحدده المستضيف</li>
        <li>🔊 أصوات مختلفة لرمي النرد، خروج لاعب، وفوز لاعب — يمكن كتمها من زر الصوت أعلى الشاشة</li>
        <li>بعد كل جولة تظهر نافذة فيها نتيجة الجولة + لوحة نقاط جميع المتسابقين</li>
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

textarea { height: 70px; resize: vertical; }
textarea:focus, input:focus, select:focus {
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

.gift-filter-row input,
.gift-filter-row select {
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

.master-btn { font-size: 1.1rem; padding: 12px 25px; }

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
  max-width: 420px;
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
  font-size: 0.95rem;
  line-height: 1.6;
}

.back-to-game-btn {
  display: block;
  width: 100%;
  max-width: 420px;
  margin-top: 18px;
  background: var(--success-color);
  box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
  font-size: 1.05rem;
  padding: 12px;
}

.rounds-badge { font-size: 0.95rem; padding: 8px 15px; }

.closeness-bar {
  display: flex;
  gap: 12px;
  width: 100%;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.closeness-col {
  flex: 1;
  min-width: 220px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.closeness-title {
  font-weight: bold;
  font-size: 0.9rem;
  margin-bottom: 8px;
  text-align: center;
  color: #ecf0f1;
}

.closeness-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.82rem;
}

.closeness-name {
  min-width: 60px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.closeness-track {
  flex: 1;
  height: 8px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 5px;
  overflow: hidden;
}

.closeness-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.3s;
}

.closeness-fill.win { background: var(--success-color); }
.closeness-fill.lose { background: var(--danger-color); }

.closeness-score { min-width: 22px; text-align: center; font-weight: bold; }

.bet-row {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-top: 8px;
}

.bet-label { font-size: 0.8rem; color: #8b93a3; }

.bet-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-weight: bold;
  cursor: pointer;
}

.bet-btn.selected {
  background: var(--primary-color);
  color: #000;
  border-color: #fff;
  box-shadow: 0 0 8px var(--primary-color);
}

.dice-wrap.double {
  width: 260px;
  gap: 10px;
}

.dice-wrap.double .dice-face { font-size: 60px; }

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

.game-arena {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  background: rgba(0,0,0,0.2);
  border-radius: 15px;
  padding: 20px 5px;
}

.timer-display {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 15px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}

.timer-display.urgent { color: #ff4757; }

.dice-wrap {
  width: 140px;
  height: 140px;
  margin: 5px auto 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  border-radius: 22px;
  border: 2px solid rgba(255,255,255,0.15);
  box-shadow: 0 6px 18px rgba(0,0,0,0.4);
}

.dice-face {
  font-size: 90px;
  line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));
}

.dice-face.rolling {
  animation: diceShake 0.15s infinite;
}

@keyframes diceShake {
  0% { transform: rotate(-10deg) scale(1); }
  50% { transform: rotate(10deg) scale(1.08); }
  100% { transform: rotate(-10deg) scale(1); }
}

.dice-caption {
  text-align: center;
  font-size: 0.9rem;
  color: #ccd6e0;
}

.dice-result-label {
  text-align: center;
  font-size: 1.05rem;
  font-weight: bold;
  color: var(--primary-color);
  margin-top: 6px;
  min-height: 1.4em;
}

.number-boxes {
  display: flex;
  gap: 5px;
  margin-bottom: 8px;
  justify-content: center;
}

.num-box {
  width: 35px;
  height: 35px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  cursor: pointer;
  transition: 0.2s;
  user-select: none;
}

.num-box.selected {
  background: var(--primary-color);
  color: #000;
  border-color: #fff;
  box-shadow: 0 0 8px var(--primary-color);
}

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
  max-width: 350px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-content h2 { margin-top: 0; color: var(--primary-color); font-size: 1.2rem; }
.log-list { text-align: right; margin: 15px 0; font-size: 0.9rem; line-height: 1.5; }
.log-list :deep(.log-item) { margin-bottom: 8px; padding: 8px; border-radius: 6px; background: #1e1e2f; }
.log-list :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.log-list :deep(.log-miss) { border-right: 4px solid var(--danger-color); }

.log-list :deep(.scoreboard-title) {
  margin-top: 18px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 12px;
}

.log-list :deep(.scoreboard-list) { display: flex; flex-direction: column; gap: 6px; }

.log-list :deep(.scoreboard-item) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #1e1e2f;
  border-radius: 6px;
  font-size: 0.88rem;
}

.log-list :deep(.scoreboard-item.is-winner) { background: #f39c12; color: #1e1e2f; font-weight: bold; }
.log-list :deep(.scoreboard-item.is-eliminated) { opacity: 0.6; }

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: #1e1e2f;
  border-radius: 6px;
  margin-bottom: 5px;
  font-size: 0.95rem;
}

.player-input-card {
  background: #1e1e2f;
  padding: 10px;
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
  margin-bottom: 10px;
  width: 100%;
}

.player-input-card .p-name { font-weight: bold; margin-bottom: 5px; color: #ffa502; font-size: 0.95rem; }

.guess-status {
  font-size: 0.78rem;
  color: #8b93a3;
  margin-top: 4px;
}

.guess-status.filled { color: #2ecc71; }

.footer-note { padding: 15px; font-size: 0.85rem; }

/* ===== الجولة الذهبية ===== */
.golden-arena {
  border: 2px solid #f39c12 !important;
  box-shadow: 0 0 20px rgba(243, 156, 18, 0.5);
}

.golden-badge {
  text-align: center;
  font-weight: bold;
  color: #f39c12;
  margin-bottom: 8px;
  animation: goldenPulse 1.2s ease-in-out infinite;
}

@keyframes goldenPulse {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}

/* ===== شريط التوتر (تنبيه بُعد نقطة واحدة) ===== */
@keyframes pulseGold {
  0%, 100% { box-shadow: 0 0 3px 0 rgba(243, 156, 18, 0.4); background: transparent; }
  50% { box-shadow: 0 0 14px 4px rgba(243, 156, 18, 0.8); background: rgba(243, 156, 18, 0.15); }
}

@keyframes pulseRed {
  0%, 100% { box-shadow: 0 0 3px 0 rgba(255, 71, 87, 0.4); background: transparent; }
  50% { box-shadow: 0 0 14px 4px rgba(255, 71, 87, 0.85); background: rgba(255, 71, 87, 0.15); }
}

.closeness-row.pulse-gold { animation: pulseGold 1s ease-in-out infinite; border-radius: 6px; padding: 2px 4px; }
.closeness-row.pulse-red { animation: pulseRed 1s ease-in-out infinite; border-radius: 6px; padding: 2px 4px; }

/* ===== وضع الدوري ===== */
.match-cards-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 15px;
  width: 100%;
}

.match-card { flex: 1; min-width: 140px; }

/* ===== فزعة الفرق ===== */
.tug-panel { gap: 10px; }

.tug-teams-row {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-weight: bold;
  font-size: 0.95rem;
}

.tug-team-name.team-a { color: #3498db; }
.tug-team-name.team-b { color: #e74c3c; }

.tug-track {
  position: relative;
  width: 100%;
  height: 14px;
  background: linear-gradient(90deg, #3498db, #2a2a40 45%, #2a2a40 55%, #e74c3c);
  border-radius: 8px;
  margin: 10px 0;
}

.tug-center-line {
  position: absolute;
  left: 50%;
  top: -4px;
  width: 2px;
  height: 22px;
  background: rgba(255, 255, 255, 0.5);
  transform: translateX(-50%);
}

.tug-marker {
  position: absolute;
  top: -9px;
  transform: translateX(-50%);
  font-size: 22px;
  transition: left 0.5s ease;
}

.team-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-left: 5px;
  vertical-align: middle;
}

.team-dot.team-a { background: #3498db; }
.team-dot.team-b { background: #e74c3c; }

.team-a-text { color: #3498db; font-weight: bold; }
.team-b-text { color: #e74c3c; font-weight: bold; }
</style>
