<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, getGiftName, getGiftValue, GIFT_OPTIONS,
} from '../../utils/tiktokBridge';
import { trackConnectRequest } from '../../utils/analytics';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();
const LEADERBOARD_KEY = 'wordGame_leaderboard';

const CATEGORIES = {
  animals: { label: '🐾 حيوانات', words: ['أسد', 'نمر', 'فيل', 'قرد', 'حصان', 'جمل', 'ثعلب', 'دب', 'نسر', 'بطة', 'غزال', 'زرافة', 'تمساح', 'دجاجة', 'حمار', 'قطة', 'كلب', 'حوت', 'دولفين', 'نعامة'] },
  food: { label: '🍎 فواكه وخضروات', words: ['تفاح', 'موز', 'برتقال', 'عنب', 'فراولة', 'بطيخ', 'مانجو', 'أناناس', 'خيار', 'طماطم', 'بطاطس', 'جزر', 'باذنجان', 'ليمون', 'رمان', 'كيوي', 'خوخ', 'تين'] },
  jobs: { label: '👷 مهن', words: ['طبيب', 'مهندس', 'معلم', 'شرطي', 'طباخ', 'نجار', 'حداد', 'مزارع', 'محامي', 'صياد', 'خياط', 'سائق', 'ممرضة', 'مصور', 'كهربائي'] },
  countries: { label: '🌍 دول عربية', words: ['السعودية', 'مصر', 'الإمارات', 'قطر', 'موريتانيا', 'الجزائر', 'جيبوتي', 'الصومال', 'الكويت', 'البحرين', 'عمان', 'الأردن', 'لبنان', 'العراق', 'سوريا', 'اليمن', 'المغرب', 'الجزائر', 'تونس', 'ليبيا', 'السودان'] },
  home: { label: '🏠 أدوات منزلية', words: ['ثلاجة', 'غسالة', 'فرن', 'مروحة', 'سرير', 'طاولة', 'مقص', 'ملعقة', 'صحن', 'كوب', 'مكنسة', 'مرآة', 'ساعة', 'مصباح', 'وسادة'] },
  sports: { label: '⚽ رياضات', words: ['كرة القدم', 'كرة السلة', 'السباحة', 'الجري', 'التنس', 'الملاكمة', 'الجودو', 'الغطس', 'الدراجة', 'الرماية'] },
  transport: { label: '🚗 وسائل نقل', words: ['سيارة', 'طائرة', 'قطار', 'دراجة', 'سفينة', 'حافلة', 'مترو', 'تاكسي', 'قارب', 'شاحنة'] },
  colors: { label: '🎨 ألوان', words: ['أحمر', 'أزرق', 'أخضر', 'أصفر', 'أسود', 'أبيض', 'بنفسجي', 'برتقالي', 'وردي', 'رمادي'] },
};

const AR_LETTERS = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];
const LETTER_VARIANTS_SET = new Set([...AR_LETTERS, 'ا', 'إ', 'آ', 'ئ', 'ء', 'ى', 'ة', 'ؤ']);

function stripDiacritics(str) {
  return String(str).replace(/[ً-ْٰـ]/g, '').trim();
}
function groupLetter(ch) {
  if (ch === 'ا' || ch === 'إ' || ch === 'آ' || ch === 'ئ' || ch === 'ء' || ch === 'ى') return 'أ';
  if (ch === 'ة') return 'ت';
  if (ch === 'ؤ') return 'و';
  return ch;
}
function isLetterChar(ch) { return LETTER_VARIANTS_SET.has(ch); }
function extractVoteLetter(rawText) {
  const stripped = stripDiacritics(rawText).trim();
  if (stripped.length !== 1) return null;
  return isLetterChar(stripped) ? groupLetter(stripped) : null;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadLeaderboard() {
  try {
    const data = localStorage.getItem(LEADERBOARD_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const leaderboard = reactive(loadLeaderboard() || []);
function saveLeaderboard() {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard)); } catch (e) { /* noop */ }
}

const categorySelect = ref('random');
const categoryOptions = [
  { value: 'random', label: 'فئة عشوائية (كل الفئات)' },
  ...Object.entries(CATEGORIES).map(([key, cat]) => ({ value: key, label: cat.label })),
];
const customWordInput = ref('');
const roundDurationInput = ref(15);
const livesInput = ref(5);

const isRoundActive = ref(false);
const currentRound = ref(0);
const currentWord = ref(null);
const currentCategoryLabel = ref('');
const maxHearts = ref(5);
const hearts = ref(5);
let guessedLetters = new Set();
let wrongLetters = new Set();
const gameFinished = ref(false);
const wordWon = ref(false);
let lastBrokenHeartIndex = null;

let roundVotes = new Map();
let testVoterCounter = 1;
const giftVotingEnabled = ref(true);
const giftTotals = new Map(); // username -> مجموع قيمة الهدايا المرسلة هذه الجولة

const timerDisplay = ref('--');
const timerUrgent = ref(false);
let countdownTimer = null;

const qTypeBadge = ref('اضغط "بدء اللعبة"');
const qCaption = ref('استعدوا... اضغط "بدء اللعبة" لاختيار كلمة جديدة');
const startBtnVisible = ref(true);
const startBtnText = ref('🎬 بدء اللعبة (اختيار كلمة)');
const controlsDisabled = ref(false);
const giftFeedText = ref('');
let giftFeedTimeout = null;

const heartsRender = ref([]); // ['❤️'|'💔', ...]
const letterBoxesRender = ref([]); // { text, cls }
const keyboardRender = ref([]); // { letter, cls, voteCount }

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتيجة الجولة');
const modalLogs = ref([]);
const barExpanded = ref(true);
const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

function renderHearts() {
  const arr = [];
  for (let i = 0; i < maxHearts.value; i++) {
    const lost = i >= hearts.value;
    arr.push({ text: lost ? '💔' : '❤️', lost, justBroken: lastBrokenHeartIndex === i });
  }
  heartsRender.value = arr;
  lastBrokenHeartIndex = null;
}

function renderLetterBoxes() {
  if (!currentWord.value) { letterBoxesRender.value = []; return; }
  letterBoxesRender.value = [...currentWord.value].map((ch) => {
    if (ch === ' ') return { text: '', cls: 'gap' };
    if (!isLetterChar(ch)) return { text: ch, cls: 'revealed' };
    if (guessedLetters.has(groupLetter(ch))) return { text: ch, cls: 'revealed' };
    return { text: '', cls: '' };
  });
}

function computeTally() {
  const counts = new Map();
  for (const { letter, weight } of roundVotes.values()) {
    counts.set(letter, (counts.get(letter) || 0) + weight);
  }
  return counts;
}
function pickWinningLetter(counts) {
  let best = null;
  let bestCount = -1;
  for (const [letter, count] of counts) {
    if (count > bestCount) { best = letter; bestCount = count; }
  }
  return { letter: best, count: bestCount };
}

function renderVoteTally() {
  const counts = computeTally();
  const { letter: leadingLetter } = counts.size ? pickWinningLetter(counts) : { letter: null };
  keyboardRender.value.forEach((tile) => {
    if (tile.disabled) { tile.voteCount = 0; tile.leading = false; return; }
    const count = counts.get(tile.letter) || 0;
    tile.voteCount = count;
    tile.leading = count > 0 && tile.letter === leadingLetter;
  });
}

function renderKeyboard() {
  keyboardRender.value = AR_LETTERS.map((letter) => {
    let cls = '';
    let disabled = false;
    if (guessedLetters.has(letter)) { cls = 'correct disabled-tile'; disabled = true; } else if (wrongLetters.has(letter)) { cls = 'wrong disabled-tile'; disabled = true; }
    return {
      letter, cls, disabled, voteCount: 0, leading: false,
    };
  });
  renderVoteTally();
}

function resetArena() {
  timerDisplay.value = '--';
  qTypeBadge.value = 'اضغط "بدء اللعبة"';
  heartsRender.value = [];
  letterBoxesRender.value = [];
  keyboardRender.value = [];
  qCaption.value = 'استعدوا... اضغط "بدء اللعبة" لاختيار كلمة جديدة';
  giftFeedText.value = '';
}

function getRoundDuration() {
  let v = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(v) || v < 5) v = 5;
  if (v > 60) v = 60;
  roundDurationInput.value = v;
  return v;
}
function getLivesConfig() {
  let v = parseInt(livesInput.value, 10);
  if (Number.isNaN(v) || v < 1) v = 1;
  if (v > 10) v = 10;
  livesInput.value = v;
  return v;
}

function pickWord() {
  const customVal = customWordInput.value.trim();
  if (customVal) {
    customWordInput.value = '';
    return { word: stripDiacritics(customVal), category: 'كلمة مخصصة من المضيف' };
  }
  let catKey = categorySelect.value;
  if (catKey === 'random') {
    const keys = Object.keys(CATEGORIES);
    catKey = keys[Math.floor(Math.random() * keys.length)];
  }
  const cat = CATEGORIES[catKey] || CATEGORIES[Object.keys(CATEGORIES)[0]];
  const raw = cat.words[Math.floor(Math.random() * cat.words.length)];
  return { word: stripDiacritics(raw), category: cat.label };
}

function beginNewWord() {
  const picked = pickWord();
  currentWord.value = picked.word;
  currentCategoryLabel.value = picked.category;
  maxHearts.value = getLivesConfig();
  hearts.value = maxHearts.value;
  guessedLetters = new Set();
  wrongLetters = new Set();
  gameFinished.value = false;
  wordWon.value = false;
}

function isWordSolved() {
  if (!currentWord.value) return false;
  return [...currentWord.value].filter(isLetterChar).every((c) => guessedLetters.has(groupLetter(c)));
}

async function startRound() {
  if (isRoundActive.value) return;

  if (!currentWord.value || gameFinished.value) {
    beginNewWord();
    controlsDisabled.value = true;
  }

  roundVotes = new Map();
  testVoterCounter = 1;
  giftTotals.clear();
  currentRound.value++;
  startBtnVisible.value = false;

  qTypeBadge.value = currentCategoryLabel.value;
  renderHearts();
  renderLetterBoxes();
  renderKeyboard();

  const dur = getRoundDuration();
  qCaption.value = `⏳ باب التصويت على الحرف مفتوح (${dur} ثانية)… اكتب حرفاً واحداً فقط بالدردشة`;

  isRoundActive.value = true;
  startTimer(dur);
}

function startTimer(duration) {
  let timeLeft = duration;
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
      evaluateRound();
    }
  }, 1000);
}

function addTestVote(letter, tile) {
  if (!isRoundActive.value) return;
  if (tile.disabled) return;
  const voterId = `test_${testVoterCounter++}`;
  roundVotes.set(voterId, { letter, weight: 1 });
  renderVoteTally();
}

function registerVoteFromComment(username, rawText) {
  if (!isRoundActive.value || !username || !rawText) return;
  const letter = extractVoteLetter(rawText);
  if (!letter) return;
  if (guessedLetters.has(letter) || wrongLetters.has(letter)) return;
  const weight = giftVotingEnabled.value ? (giftTotals.get(username) || 1) : 1;
  roundVotes.set(username, { letter, weight });
  renderVoteTally();
}

function registerGift(username, giftValue) {
  if (!username || !giftVotingEnabled.value) return;
  const total = (giftTotals.get(username) || 0) + giftValue;
  giftTotals.set(username, total);
  const existingVote = roundVotes.get(username);
  if (existingVote) {
    existingVote.weight = total;
    renderVoteTally();
  }
  showGiftFeed(username, total);
}

function showGiftFeed(username, total) {
  giftFeedText.value = `🎁 ${username} أرسل هدية! إجمالي هداياه هذه الجولة ${total} — صوته الآن يساوي ${total} صوت 🔥`;
  if (giftFeedTimeout) clearTimeout(giftFeedTimeout);
  giftFeedTimeout = setTimeout(() => { giftFeedText.value = ''; }, 6000);
}

function addLeaderboardPoint(username) {
  let entry = leaderboard.find((p) => p.name === username);
  if (!entry) {
    entry = { name: username, score: 0 };
    leaderboard.push(entry);
  }
  entry.score += 1;
  saveLeaderboard();
}

const leaderboardSorted = computed(() => [...leaderboard].sort((a, b) => b.score - a.score).slice(0, 15));

function buildScoreboardHtml() {
  const sorted = [...leaderboard].sort((a, b) => b.score - a.score).slice(0, 10);
  const top = sorted.length ? sorted[0].score : 0;
  const items = sorted.map((p) => {
    const isWinner = top > 0 && p.score === top;
    const cls = `scoreboard-item${isWinner ? ' is-winner' : ''}`;
    return `<div class="${cls}"><span>${escapeHtml(p.name)}</span><span>${p.score} نقطة</span></div>`;
  }).join('');
  return `<div class="scoreboard-title">📊 أفضل المصوّتين</div><div class="scoreboard-list">${items || '<div class="scoreboard-item">لا توجد أصوات مسجلة بعد</div>'}</div>`;
}

function evaluateRound() {
  if (!isRoundActive.value) return;
  isRoundActive.value = false;

  const counts = computeTally();
  const logs = [];

  if (counts.size === 0) {
    logs.push('<div style="text-align:center; color:#ccd6e0;">🤷 ما وصل أي صوت هذه الجولة — نفس القلوب ونفس الكلمة، جربوا مرة ثانية!</div>');
    renderVoteTally();
    startBtnVisible.value = true;
    startBtnText.value = '▶️ إعادة فتح التصويت';
    qCaption.value = 'لم يصل أي تصويت — اضغط لإعادة المحاولة';
    timerUrgent.value = false;
    openModal('لا توجد أصوات', logs);
    return;
  }

  const { letter, count } = pickWinningLetter(counts);
  const occurrences = [...currentWord.value].filter((c) => isLetterChar(c) && groupLetter(c) === letter).length;

  if (occurrences > 0) {
    guessedLetters.add(letter);
    const creditedNames = [];
    for (const [voterId, voteData] of roundVotes) {
      if (voteData.letter === letter && !String(voterId).startsWith('test_')) {
        addLeaderboardPoint(voterId);
        creditedNames.push(voterId);
      }
    }
    logs.push(`<div class="log-item log-hit">🎯 الحرف الفائز بالتصويت (${count} صوت): <b>${escapeHtml(letter)}</b> — موجود بالكلمة! تم كشف ${occurrences} مكان.</div>`);
    if (creditedNames.length) {
      logs.push(`<div class="log-item">✅ حصل على نقطة: ${creditedNames.map((n) => escapeHtml(n)).join('، ')}</div>`);
    }
    if (isWordSolved()) {
      gameFinished.value = true;
      wordWon.value = true;
      logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🎉 اكتشف المتابعون الكلمة كاملة: <b>${escapeHtml(currentWord.value)}</b><br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "بدء اللعبة" لكلمة جديدة</span></div>`);
    }
  } else {
    wrongLetters.add(letter);
    hearts.value--;
    lastBrokenHeartIndex = hearts.value;
    logs.push(`<div class="log-item log-miss">💔 الحرف الفائز بالتصويت (${count} صوت): <b>${escapeHtml(letter)}</b> — غير موجود بالكلمة! خسر الجميع قلباً واحداً.</div>`);
    if (hearts.value <= 0) {
      gameFinished.value = true;
      wordWon.value = false;
      logs.push(`<div style="text-align:center; font-size:17px; color:#ff4757; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">💀 نفدت القلوب! الكلمة كانت: <b>${escapeHtml(currentWord.value)}</b><br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "بدء اللعبة" لكلمة جديدة</span></div>`);
    }
  }

  renderHearts();
  renderLetterBoxes();
  renderKeyboard();
  timerUrgent.value = false;

  if (gameFinished.value) {
    qCaption.value = wordWon.value ? '🎉 فاز الجميع بهذه الكلمة!' : '💀 انتهت المحاولات لهذه الكلمة.';
    qTypeBadge.value = `الكلمة: ${currentWord.value}`;
    startBtnText.value = '🎬 كلمة جديدة';
    controlsDisabled.value = false;
    logs.push(buildScoreboardHtml());
  } else {
    qCaption.value = 'استعدوا للحرف التالي…';
    startBtnText.value = '▶️ الجولة التالية (تصويت على حرف جديد)';
  }
  startBtnVisible.value = true;

  openModal(gameFinished.value ? (wordWon.value ? 'فاز الجميع! 🎉' : 'انتهت القلوب 💀') : 'نتيجة التصويت', logs);
}

function endGameShowRanking() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = true;

  const logs = [];
  logs.push('<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:6px;">🏁 تم إنهاء اللعبة يدوياً</div>');
  if (currentWord.value) {
    logs.push(`<div style="text-align:center; color:#ccd6e0;">الكلمة كانت: <b>${escapeHtml(currentWord.value)}</b></div>`);
  }
  logs.push(buildScoreboardHtml());

  controlsDisabled.value = false;
  startBtnText.value = '🎬 كلمة جديدة';
  startBtnVisible.value = true;
  resetArena();
  openModal('الترتيب النهائي', logs);
}

function openModal(title, messagesArray) {
  modalTitle.value = title;
  modalLogs.value = messagesArray;
  showModal.value = true;
}
function closeModal() { showModal.value = false; }

function resetGame() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = false;
  wordWon.value = false;
  currentWord.value = null;
  currentRound.value = 0;
  hearts.value = 0;
  maxHearts.value = 0;
  guessedLetters = new Set();
  wrongLetters = new Set();
  roundVotes = new Map();
  giftTotals.clear();
  leaderboard.splice(0, leaderboard.length);
  saveLeaderboard();

  customWordInput.value = '';
  startBtnText.value = '🎬 بدء اللعبة (اختيار كلمة)';
  startBtnVisible.value = true;
  controlsDisabled.value = false;
  resetArena();
}

function goHome() {
  try { localStorage.removeItem(LEADERBOARD_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const giftNameFilter = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

function giftPassesFilter(data) {
  const nameFilter = giftNameFilter.value.trim().toLowerCase();
  if (nameFilter && !getGiftName(data).toLowerCase().includes(nameFilter)) return false;
  const minValue = Number(giftMinValue.value) || 0;
  if (minValue > 0 && getGiftValue(data) < minValue) return false;
  return true;
}

function connectTikTok() {
  const username = tiktokUsername.value.trim();
  if (!username) {
    tiktokStatus.value = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokStatusColor.value = 'orange';
    return;
  }
  if (tiktokSocket) tiktokSocket.close();
  trackConnectRequest('word-game', username);

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment) registerVoteFromComment(data.user, data.comment.trim());
    if ((data.gift || data.giftName || data.giftId || data.type === 'gift') && giftPassesFilter(data)) {
      const giftUser = data.user || data.uniqueId || data.username;
      const giftValue = getGiftValue(data) || 1;
      registerGift(giftUser, giftValue);
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (showRulesOverlay.value || showModal.value) return;
    if (startBtnVisible.value) startRound();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (giftFeedTimeout) clearTimeout(giftFeedTimeout);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <h1>🔤 الكلمة المخفية</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="endGameShowRanking">🏁 إنهاء وعرض الترتيب</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">جولات التصويت: {{ currentRound }}</div>
  </div>

  <div class="top-names-section">
    <label for="categorySelect">🎯 فئة الكلمة:</label>
    <CustomSelect v-model="categorySelect" :options="categoryOptions" :disabled="controlsDisabled" />
    <div class="field-hint">اكتب كلمة مخصصة إذا تبي تحدد الكلمة بنفسك (تظهر لك فقط، والمتابعون يشوفون فراغات):</div>
    <input v-model="customWordInput" type="text" placeholder="مثال: تفاح — اتركه فاضي لاختيار كلمة عشوائية من الفئة" style="margin-top:6px;" :disabled="controlsDisabled">
  </div>

  <div class="top-names-section">
    <label>⏱️ إعدادات اللعبة (يحددها المستضيف):</label>
    <div class="round-time-row">
      <span style="font-size:0.9rem; color:#bdc3c7;">مدة التصويت (ثانية):</span>
      <input v-model="roundDurationInput" type="number" min="5" max="60" :disabled="controlsDisabled">
      <span style="font-size:0.9rem; color:#bdc3c7;">عدد القلوب:</span>
      <input v-model="livesInput" type="number" min="1" max="10" :disabled="controlsDisabled">
    </div>
    <div class="field-hint">بعد انتهاء وقت التصويت يُكشف الحرف الأكثر تصويتاً تلقائياً. حرف خاطئ = خسارة قلب واحد.</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startBtn" @click="startRound">{{ startBtnText }}</button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">🎁 إعدادات التصويت بالهدية</button>
    </template>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎁 إعدادات التصويت بالهدية</h3>
      <label class="join-settings-label">🔴 ربط بث تيك توك لايف (اختياري): من يكتب حرفاً واحداً فقط بالدردشة (مثل "س") يُحتسب صوته لهذا الحرف أثناء فتح التصويت</label>
      <label class="join-gift-toggle" for="giftVotingEnabledCheckbox" style="margin-top:12px;">
        <input id="giftVotingEnabledCheckbox" v-model="giftVotingEnabled" type="checkbox">
        🎁 تفعيل احتساب صوت الداعم بمجموع الهدايا المرسلة أثناء الجولة
      </label>
      <div class="gift-filter-row" style="margin-top:10px;" :class="{ 'gift-row-disabled': !giftVotingEnabled }">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" :disabled="!giftVotingEnabled" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)" :disabled="!giftVotingEnabled">
      </div>
      <div class="field-hint">🎁 عند التفعيل: كل هدية تطابق الاسم/القيمة المحددة أعلاه (أو أي هدية إذا تركتهما فاضيين) تُضاف إلى مجموع هدايا الداعم بهذه الجولة، ويُحتسب صوته بعدد يساوي هذا المجموع بدل صوت واحد.</div>
      <button type="button" class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>ساحة الكلمة</h2>
      <div class="game-arena">
        <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
        <div class="q-type-badge">{{ qTypeBadge }}</div>
        <div class="hearts-row">
          <span v-for="(h, i) in heartsRender" :key="i" class="heart" :class="{ lost: h.lost, 'just-broken': h.justBroken }">{{ h.text }}</span>
        </div>
        <div class="letter-boxes">
          <div v-for="(box, i) in letterBoxesRender" :key="i" class="letter-box" :class="box.cls">{{ box.text }}</div>
        </div>
        <div class="dice-caption">{{ qCaption }}</div>

        <div class="keyboard-grid">
          <div
            v-for="tile in keyboardRender"
            :key="tile.letter"
            class="kb-tile"
            :class="[tile.cls, { leading: tile.leading }]"
            @click="addTestVote(tile.letter, tile)"
          >
            {{ tile.letter }}
            <span v-if="tile.voteCount > 0" class="vote-count" style="display:flex;">{{ tile.voteCount }}</span>
          </div>
        </div>
        <div class="vote-hint">اكتب الحرف فقط بدون كلمات إضافية بالدردشة عشان يُحتسب صوتك — أو اضغط على الحرف يدوياً لتجربة اللعبة</div>
        <div class="vote-hint" style="color:#f39c12; font-weight:bold; min-height:1.1rem;">{{ giftFeedText }}</div>
      </div>
    </div>

    <div class="panel">
      <h3>🏆 أفضل المصوّتين (النقاط)</h3>
      <div style="width: 100%;">
        <div v-if="leaderboardSorted.length === 0" class="player-item">
          <span>لا يوجد مصوّتون بعد — انتظروا أول جولة!</span>
        </div>
        <div v-for="p in leaderboardSorted" :key="p.name" class="player-item">
          <span>{{ p.name }}</span><span style="color:#ffa502;">{{ p.score }} نقطة</span>
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
      <h2>قوانين لعبة الكلمة المخفية 🔤</h2>
      <ul class="rules-list">
        <li>يختار المستضيف <b>فئة الكلمة</b> (أو يكتب كلمة مخصصة بنفسه) ويحدد <b>عدد القلوب</b> و<b>مدة التصويت</b> لكل حرف</li>
        <li>تظهر الكلمة السرية على شكل <b>فراغات</b> بعدد أحرفها ليعرف المتابعون طولها</li>
        <li>عند فتح باب التصويت، يكتب كل متابع في الدردشة <b>حرفاً واحداً فقط</b> (مثل "س") يقترحه — بدون أي كلمات إضافية عشان يُحتسب صوته</li>
        <li>🎁 يمكن للمستضيف تفعيل/إيقاف "التصويت بالهدايا" من الإعدادات — عند التفعيل، من يرسل <b>هدية/هدايا</b> أثناء الجولة يُصبح صوته يساوي <b>مجموع قيمة الهدايا</b> التي أرسلها بدلاً من صوت واحد</li>
        <li>تظهر لوحة الأحرف وتتحدث لحظياً بعدد الأصوات، ويمكن أيضاً الاختيار يدوياً بالضغط على الحرف لتجربة اللعبة بدون بث</li>
        <li>بعد انتهاء وقت التصويت، يُعتمد <b>الحرف الأكثر تصويتاً</b> تلقائياً</li>
        <li>إذا كان الحرف <b>موجوداً</b> بالكلمة: تُكشف كل أماكنه فوراً، ويكسب كل من صوّت له <b>+1 نقطة</b> باللوحة</li>
        <li>إذا كان الحرف <b>غير موجود</b>: يخسر الجميع <b>قلباً واحداً</b> من إجمالي القلوب المتاحة، مع تأثير بصري لكسر القلب 💔</li>
        <li><b>الفوز:</b> إذا اكتُشفت كل أحرف الكلمة قبل نفاد القلوب، يفوز الجميع ويُحتسب من صوّت صح</li>
        <li><b>الخسارة:</b> إذا نفدت كل القلوب قبل إكمال الكلمة، تنتهي الجولة وتُكشف الكلمة السرية كاملة</li>
        <li>زر <b>"إنهاء وعرض الترتيب"</b> يوقف اللعبة ويعرض ترتيب أفضل المصوّتين في أي وقت</li>
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

.gift-row-disabled { opacity: 0.5; }

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
  padding: 18px 10px;
}

.timer-display {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 8px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}
.timer-display.urgent { color: #ff4757; }

.q-type-badge {
  display: inline-block;
  font-size: 0.85rem;
  font-weight: bold;
  color: var(--primary-color);
  background: rgba(243, 156, 18, 0.15);
  border: 1px solid var(--border-glow);
  border-radius: 20px;
  padding: 4px 14px;
  margin-bottom: 12px;
}

.hearts-row {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-bottom: 12px;
  font-size: 1.7rem;
  min-height: 2rem;
}
.heart { transition: opacity .3s, filter .3s; }
.heart.lost { opacity: 0.25; filter: grayscale(1); }
.heart.just-broken { animation: heartBreak 0.6s ease; }
@keyframes heartBreak {
  0% { transform: scale(1) rotate(0); }
  25% { transform: scale(1.5) rotate(-18deg); }
  55% { transform: scale(0.55) rotate(12deg); opacity: 0.5; }
  100% { transform: scale(1) rotate(0); opacity: 0.25; }
}

.letter-boxes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 10px 0 18px;
  min-height: 46px;
}
.letter-box {
  min-width: 32px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
  font-weight: bold;
  border-bottom: 3px solid var(--primary-color);
  background: rgba(255,255,255,0.05);
  border-radius: 6px 6px 0 0;
  color: #fff;
}
.letter-box.gap { border: none; background: transparent; min-width: 14px; }
.letter-box.revealed {
  animation: flipIn 0.4s ease;
  border-color: var(--success-color);
  background: rgba(39,174,96,0.15);
}
@keyframes flipIn {
  from { transform: rotateX(90deg); opacity: 0; }
  to { transform: rotateX(0); opacity: 1; }
}

.dice-caption {
  text-align: center;
  font-size: 0.9rem;
  color: #ccd6e0;
  margin-top: 4px;
}

.keyboard-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  width: 100%;
  max-width: 460px;
  margin: 8px auto 0;
}
.kb-tile {
  position: relative;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  padding: 10px 4px;
  text-align: center;
  font-size: 1.05rem;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
  transition: 0.15s;
  color: #ecf0f1;
}
.kb-tile:hover { border-color: var(--primary-color); }
.kb-tile.correct { background: rgba(39,174,96,0.3); border-color: var(--success-color); cursor: default; }
.kb-tile.wrong { background: rgba(138,21,56,0.4); border-color: var(--danger-color); cursor: default; opacity: 0.55; }
.kb-tile.leading { box-shadow: 0 0 10px var(--primary-color); border-color: var(--primary-color); }
.kb-tile.disabled-tile { pointer-events: none; }
.kb-tile .vote-count {
  position: absolute;
  top: -8px;
  left: -6px;
  background: var(--primary-color);
  color: #1e1e2f;
  font-size: 0.68rem;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
}

.vote-hint {
  text-align: center;
  font-size: 0.8rem;
  color: #8b93a3;
  margin-top: 8px;
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
  max-width: 360px;
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

.footer-note { padding: 15px; font-size: 0.85rem; }

@media (min-width: 720px) {
  .layout-wrapper { max-width: 680px; margin: 0 auto; }
}
</style>
