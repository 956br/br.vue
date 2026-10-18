<script setup>
import { avatarOrLogo } from '../../utils/gameLogo';
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import { useSettingsOverlay } from '../../utils/useSettingsOverlay';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode,
  displayName,
} from '../../utils/liveConnection';
import { normalizeDigits, isLeaveComment } from '../../utils/tiktokBridge';
import questionsText from '../../data/uniqueQuestions.txt?raw';
import { nameHtml, nameText } from '../../utils/nameHtml';
import { topScorerNames } from '../../utils/gameWin';

const router = useRouter();
const SCORES_KEY = 'uniqueWordGame_scores';

// مكتبة الأسئلة: كل سطر في src/data/uniqueQuestions.txt سؤال مستقل (السطر اللي يبدأ بـ # يُتجاهل)
const QUESTION_LIBRARY = questionsText.split(/\r?\n/).map((q) => q.trim()).filter((q) => q && !q.startsWith('#'));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function normalizeAnswer(raw) {
  let s = normalizeDigits(String(raw)).trim().replace(/\s+/g, ' ');
  s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  s = s.replace(/^ال/, '');
  return s.trim();
}

// السجل ما يُحفظ بين الجلسات: الخروج من اللعبة يمسح النقاط
function loadScores() {
  try { localStorage.removeItem(SCORES_KEY); } catch (e) { /* noop */ }
  return null;
}

const playersScores = reactive(new Map((loadScores() || []).map((p) => [p.name, p])));
function saveScores() {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(Array.from(playersScores.values()))); } catch (e) { /* noop */ }
}
function getOrCreatePlayer(name) {
  if (!playersScores.has(name)) playersScores.set(name, reactive({ name, score: 0, avatar: getUserAvatar(name) }));
  const player = playersScores.get(name);
  if (!player.avatar) player.avatar = getUserAvatar(name);
  return player;
}

const hasGameStarted = ref(false);
const gamePhase = ref('idle'); // idle | collecting | sorting
const roundNumber = ref(0);
let roundDuration = 30;
const timeLeft = ref(0);
let collectingCountdown = null;
const currentRoundAnswers = new Map(); // name -> {name, rawAnswer, normalizedAnswer}
const excludedKeys = reactive(new Set());
const mergedInto = reactive(new Map()); // دمج يدوي: مفتاح إجابة -> مفتاح البطاقة اللي انضمّت لها
const mergeSourceKey = ref(null); // البطاقة المختارة للدمج بانتظار اختيار البطاقة الهدف
const eventLog = ref([]);
let currentQuestion = '';
const usedQuestionIndices = new Set();
const answersVersion = ref(0); // يُستخدم لإجبار إعادة حساب المجموعات عند تغيّر الإجابات

const answerPrefixInput = ref('ج');
const winScoreInput = ref(30);
const uniquePointsInput = ref(5);
const roundDurationInput = ref(30);
const questionInput = ref('');
const extendSecondsInput = ref(15);
const manualNameInput = ref('');
const manualAnswerInput = ref('');

const gameSettingsLocked = computed(() => hasGameStarted.value);
const roundControlsDisabled = computed(() => gamePhase.value !== 'idle');

function getAnswerPrefix() { return answerPrefixInput.value.trim() || 'ج'; }

// أسئلة الحروف: أي سؤال بالمكتبة فيه " " (علامتي تنصيص بينهم مسافة) يتعبّى بحرف عشوائي عند اختياره،
// ويرجع السؤال بعدد حروفه (كل مرة بحرف جديد) قبل ما يُحسب مستخدماً
// أسئلة الألوان (فيها كلمة لون) نفس الفكرة لكن تتعبّى بلون بدل الحرف
const ALL_LETTERS = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const COMMON_LETTERS = 'ابتجحخدرزسشصطعفقكلمنهوي'; // بدون ث ذ ض ظ غ لندرة إجاباتها
const COUNTRY_LETTERS = 'ابتجدرزسشصطعغفقكلمنهوي'; // بدون ح خ (ما فيه دولة تبدأ فيهم) ومع غ (غانا، غينيا، غابون)
const DEFAULT_COLORS = ['أحمر', 'أخضر', 'أصفر', 'أزرق', 'أبيض', 'أسود', 'بني', 'رمادي', 'برتقالي', 'بنفسجي', 'وردي'];
// فئات قائمتي الحروف والألوان (تظهر للمستضيف في إعدادات الجولة)، والسؤال يتبع أول فئة يطابقها
const LETTER_CATEGORIES = [
  { key: 'boy', label: 'اسم ولد', re: /اسم ولد/ },
  { key: 'girl', label: 'اسم بنت', re: /اسم بنت/ },
  { key: 'plant', label: 'نبات', re: /نبات/ },
  { key: 'country', label: 'دولة', re: /دولة/ },
  { key: 'region', label: 'منطقة', re: /منطقة/ },
  { key: 'object', label: 'جماد', re: /جماد/ },
  { key: 'home', label: 'شيء في البيت', re: /البيت/ },
  { key: 'verb', label: 'فعل', re: /فعل/ },
];
const COLOR_CATEGORIES = [
  { key: 'flag', label: 'علم دولة', re: /علم/, colors: ['أحمر', 'أخضر', 'أبيض', 'أسود', 'أزرق', 'أصفر'] },
  { key: 'produce', label: 'خضار وفواكه', re: /خضار|فاكهة/, colors: ['أحمر', 'أخضر', 'أصفر', 'برتقالي', 'بنفسجي', 'أبيض', 'أسود', 'بني'] },
  { key: 'club', label: 'شعار نادي', re: /نادي/, colors: ['أحمر', 'أبيض', 'أزرق', 'أصفر', 'أسود', 'أخضر'] },
  { key: 'company', label: 'شعار شركة', re: /شركة/, colors: ['أحمر', 'أخضر', 'أصفر', 'أزرق', 'أبيض', 'أسود', 'برتقالي', 'بنفسجي'] },
  { key: 'team', label: 'قميص منتخب', re: /منتخب/, colors: ['أحمر', 'أبيض', 'أزرق', 'أصفر', 'أخضر', 'برتقالي', 'أسود'] },
  { key: 'app', label: 'أيقونة تطبيق', re: /تطبيق/, colors: ['أحمر', 'أخضر', 'أصفر', 'أزرق', 'أبيض', 'أسود', 'برتقالي', 'بنفسجي', 'وردي'] },
];
// قائمة الأماكن: أسئلتها تنتهي بـ في " " وتتعبّى بمكان، والمستضيف يختار الأماكن نفسها كفئات
const PLACE_CATEGORIES = ['المطبخ', 'المدرسة', 'المستشفى', 'البحر', 'المطار', 'الحديقة', 'الملعب', 'المكتب', 'البر', 'المطعم']
  .map((place, i) => ({ key: `place${i}`, label: place }));
const LETTER_SLOT = /"\s+"/g;
const usedLettersByIndex = new Map(); // رقم السؤال -> الحروف/الألوان/الأماكن اللي طلعت له
function isColorQuestion(question) { return /لون/.test(question); }
function isPlaceQuestion(question) { return /في\s+"\s+"/.test(question); }
// تصنيف السؤال: general | letters | colors | places مع فئته (null لو ما طابق فئة، والأماكن دايماً null)
function classifyQuestion(question) {
  if (!/"\s+"/.test(question)) return { list: 'general', category: null };
  if (isColorQuestion(question)) return { list: 'colors', category: COLOR_CATEGORIES.find((c) => c.re.test(question)) || null };
  if (isPlaceQuestion(question)) return { list: 'places', category: null };
  return { list: 'letters', category: LETTER_CATEGORIES.find((c) => c.re.test(question)) || null };
}
function lettersFor(question) {
  const { list, category } = classifyQuestion(question);
  if (list === 'colors') return category ? category.colors : DEFAULT_COLORS;
  if (list === 'places') {
    const places = PLACE_CATEGORIES.filter((c) => selectedCategoryKeys.value.includes(c.key));
    return (places.length > 0 ? places : PLACE_CATEGORIES).map((c) => c.label);
  }
  if (category?.key === 'country') return COUNTRY_LETTERS;
  return /اسم (ولد|بنت)/.test(question) ? ALL_LETTERS : COMMON_LETTERS;
}
function useQuestion(index) {
  const question = QUESTION_LIBRARY[index];
  if (!question.match(LETTER_SLOT)) {
    usedQuestionIndices.add(index);
    return question;
  }
  const letters = Array.from(lettersFor(question));
  if (!usedLettersByIndex.has(index)) usedLettersByIndex.set(index, new Set());
  const used = usedLettersByIndex.get(index);
  // الأماكن المختارة ممكن تتغير من الإعدادات، فالباقي يتحسب من القائمة الحالية مو من عدد المستخدم
  let remaining = letters.filter((l) => !used.has(l));
  if (remaining.length === 0) { used.clear(); remaining = letters; }
  const letter = remaining[Math.floor(Math.random() * remaining.length)];
  used.add(letter);
  if (letters.every((l) => used.has(l))) usedQuestionIndices.add(index);
  return question.replace(LETTER_SLOT, `"${letter}"`);
}

// خيار المستضيف: الزر العشوائي والمكتبة يقتصرون على القوائم والفئات المفعّلة
// (نفس فكرة نافذة أحكام عجلة الصامل: كل قائمة لها مربع تحديد/إلغاء الكل وتحتها فئاتها)
const generalEnabled = ref(true);
const selectedCategoryKeys = ref([...LETTER_CATEGORIES, ...COLOR_CATEGORIES, ...PLACE_CATEGORIES].map((c) => c.key));
const CATEGORY_GROUPS = [
  { key: 'letters', title: '🔤 قائمة الحروف', cls: 'guess', categories: LETTER_CATEGORIES },
  { key: 'colors', title: '🎨 قائمة الألوان', cls: 'modes', categories: COLOR_CATEGORIES },
  { key: 'places', title: '📍 قائمة الأماكن', cls: 'gifts', categories: PLACE_CATEGORIES },
];
function selectedCountOf(group) { return group.categories.filter((c) => selectedCategoryKeys.value.includes(c.key)).length; }
function isGroupAllSelected(group) { return selectedCountOf(group) === group.categories.length; }
function toggleGroup(group) {
  const keys = group.categories.map((c) => c.key);
  const others = selectedCategoryKeys.value.filter((k) => !keys.includes(k));
  selectedCategoryKeys.value = isGroupAllSelected(group) ? others : [...others, ...keys];
}
const QUESTION_CLASSES = QUESTION_LIBRARY.map(classifyQuestion);
function questionPool() {
  const selected = selectedCategoryKeys.value;
  return QUESTION_LIBRARY.map((q, i) => i).filter((i) => {
    const { list, category } = QUESTION_CLASSES[i];
    if (list === 'general') return generalEnabled.value;
    if (category) return selected.includes(category.key);
    // سؤال حروف/ألوان بدون فئة معروفة: يطلع لو قائمته فيها فئة مفعّلة
    return selectedCountOf(CATEGORY_GROUPS.find((g) => g.key === list)) > 0;
  });
}

function pickRandomQuestion() {
  if (gamePhase.value !== 'idle') return;
  const pool = questionPool();
  if (pool.length === 0) {
    openModal('تنبيه', ['<div class="log-item">فعّل قائمة أو فئة وحدة على الأقل من ⚙️ الإعدادات</div>']);
    return;
  }
  if (pool.every((i) => usedQuestionIndices.has(i))) {
    pool.forEach((i) => { usedQuestionIndices.delete(i); usedLettersByIndex.delete(i); });
    appendLog('<div class="log-item" style="color:#8b93a3;">📚 تم استخدام كل أسئلة المكتبة — بدأت الدورة من جديد</div>');
  }
  const available = pool.filter((i) => !usedQuestionIndices.has(i));
  const index = available[Math.floor(Math.random() * available.length)];
  questionInput.value = useQuestion(index);
}

const showLibraryOverlay = ref(false);
function openLibrary() {
  if (gamePhase.value !== 'idle') return;
  showLibraryOverlay.value = true;
}
function closeLibrary() { showLibraryOverlay.value = false; }
function selectLibraryQuestion(index) {
  questionInput.value = useQuestion(index);
  closeLibrary();
}
const libraryItems = computed(() => questionPool().map((i) => ({ text: QUESTION_LIBRARY[i], index: i, isUsed: usedQuestionIndices.has(i) })));

function getWinScore() {
  let val = parseInt(winScoreInput.value, 10);
  if (Number.isNaN(val) || val < 20) val = 20;
  return val;
}
// التصحيح يصير بعد ما يخلص المستضيف الكتابة، عشان الحد الأدنى ما يقاطعه وهو يكتب الرقم
function clampWinScore() { winScoreInput.value = getWinScore(); }
function getUniquePoints() {
  let val = parseInt(uniquePointsInput.value, 10);
  if (Number.isNaN(val) || val < 1) val = 5;
  if (val > 5) val = 5;
  return val;
}
function clampUniquePoints() { uniquePointsInput.value = getUniquePoints(); }
function getRoundDuration() {
  let val = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(val) || val < 10) val = 10;
  if (val > 180) val = 180;
  roundDurationInput.value = val;
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
  if (gamePhase.value !== 'idle') return;
  if (blockIfGameOver()) return;
  const question = questionInput.value.trim();
  if (question === '') {
    openModal('تنبيه', ['<div class="log-item">لازم تكتب سؤال الجولة أول!</div>']);
    return;
  }

  if (!hasGameStarted.value) hasGameStarted.value = true;

  roundNumber.value++;
  currentQuestion = question;
  roundMultiplier.value = doubleNextRound.value ? 2 : 1;
  doubleNextRound.value = false;
  roundDuration = getRoundDuration();
  timeLeft.value = roundDuration;
  currentRoundAnswers.clear();
  excludedKeys.clear();
  autoExcludedKeys.clear();
  clearMerges();
  gamePhase.value = 'collecting';
  answersVersion.value++;

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 الجولة ${roundNumber.value}: فُتح باب الإجابات (${roundDuration} ثانية) — السؤال: ${escapeHtml(question)}${roundMultiplier.value > 1 ? ' — 🔥 سؤال مضاعف ×2' : ''}</div>`);

  startCollectingTimer();
}

function extendRound() {
  if (gamePhase.value !== 'collecting') return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 15;
  timeLeft.value += add;
  appendLog(`<div class="log-item" style="text-align:center; color:#8e44ad;">⏱️ مُدِّد وقت الجمع ${add} ثانية إضافية</div>`);
}

function startCollectingTimer() {
  if (collectingCountdown) clearInterval(collectingCountdown);
  collectingCountdown = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(collectingCountdown);
      collectingCountdown = null;
      endCollecting();
    }
  }, 1000);
}

function registerAnswer(name, rawAnswer) {
  if (gamePhase.value !== 'collecting') return false;
  if (!name) return false;
  const normalized = normalizeAnswer(rawAnswer);
  if (normalized === '') return false;
  currentRoundAnswers.set(name, { name, rawAnswer: rawAnswer.trim(), normalizedAnswer: normalized });
  answersVersion.value++;
  return true;
}

function registerAnswerFromComment(username, rawComment) {
  if (gamePhase.value !== 'collecting' || !username || !rawComment) return;
  const prefix = getAnswerPrefix();
  const text = rawComment.trim();
  if (!text.startsWith(prefix)) return;
  const answerPart = text.slice(prefix.length).trim();
  if (answerPart === '') return;
  registerAnswer(username, answerPart);
}

function manualAddAnswer() {
  if (gamePhase.value !== 'collecting') return;
  const name = manualNameInput.value.trim();
  const answer = manualAnswerInput.value.trim();
  if (name === '' || answer === '') return;
  registerAnswer(name, answer);
  manualAnswerInput.value = '';
}

function endCollecting() {
  if (gamePhase.value !== 'collecting') return;
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  sortingQuestion.value = currentQuestion;
  gamePhase.value = 'sorting';
  autoExcludeWrongLetter();

  const totalAnswers = currentRoundAnswers.size;
  const groupCount = activeGroups.value.length;
  appendLog(`<div class="log-item" style="text-align:center;">⏳ انتهى وقت الجمع — استلمنا ${totalAnswers} إجابة، مجمّعة في ${groupCount} بطاقة</div>`);
  if (autoExcludedKeys.size > 0) {
    appendLog(`<div class="log-item" style="text-align:center; color:#8b93a3;">🔤 استُبعدت ${autoExcludedKeys.size} إجابة تلقائياً لأنها ما تبدأ بحرف "${escapeHtml(roundLetter.value)}" (تقدر تسترجعها)</div>`);
  }
}

// أسئلة الحروف: الحرف المطلوب ينقرى من نص السؤال (بحرف "س")، والإجابة اللي ما تبدأ فيه تنستبعد تلقائياً
// عند الفرز. أل التعريف ما تنحسب (الأردن تقبل بحرف أ)، والهمزات كلها تعتبر ألف
const roundLetter = ref('');
const autoExcludedKeys = reactive(new Set());
function normalizeLetter(ch) { return String(ch).replace(/[أإآ]/g, 'ا'); }
function letterOfQuestion(question) {
  const m = question.match(/بحرف\s*["«]\s*([ء-ي])\s*["»]/);
  return m ? normalizeLetter(m[1]) : '';
}
function startsWithLetter(rawAnswer, letter) {
  const s = normalizeLetter(normalizeDigits(String(rawAnswer)).trim());
  return s.startsWith(letter) || s.replace(/^ال/, '').startsWith(letter);
}
function autoExcludeWrongLetter() {
  roundLetter.value = letterOfQuestion(currentQuestion);
  if (!roundLetter.value) return;
  currentRoundAnswers.forEach((entry) => {
    if (startsWithLetter(entry.rawAnswer, roundLetter.value)) return;
    const key = groupKeyOf(entry.normalizedAnswer);
    excludedKeys.add(key);
    autoExcludedKeys.add(key);
  });
  answersVersion.value++;
}

function groupKeyOf(normalized) {
  let key = normalized;
  while (mergedInto.has(key)) key = mergedInto.get(key);
  return key;
}
function clearMerges() {
  mergedInto.clear();
  mergeSourceKey.value = null;
}

function buildGroupsFrom(predicate) {
  const groups = new Map();
  currentRoundAnswers.forEach((entry) => {
    const key = groupKeyOf(entry.normalizedAnswer);
    if (!predicate(key)) return;
    if (!groups.has(key)) {
      groups.set(key, { key, answer: key, players: [], mergedAnswers: [] });
    }
    const group = groups.get(key);
    group.players.push(entry.name);
    if (entry.normalizedAnswer !== key && !group.mergedAnswers.includes(entry.normalizedAnswer)) {
      group.mergedAnswers.push(entry.normalizedAnswer);
    }
  });
  return Array.from(groups.values());
}

const activeGroups = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return buildGroupsFrom((key) => !excludedKeys.has(key))
    .sort((a, b) => b.players.length - a.players.length || a.answer.localeCompare(b.answer, 'ar'));
});
const excludedGroups = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return buildGroupsFrom((key) => excludedKeys.has(key));
});

function excludeGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  excludedKeys.add(key);
  if (mergeSourceKey.value === key) mergeSourceKey.value = null;
  answersVersion.value++;
}
function restoreGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  excludedKeys.delete(key);
  autoExcludedKeys.delete(key);
  answersVersion.value++;
}

// الدمج اليدوي: اضغط 🔗 على البطاقة اللي تبي تدمجها، ثم اضغط البطاقة اللي تنضم لها (واسمها هو اللي يبقى)
function toggleMergeSource(key) {
  if (gamePhase.value !== 'sorting') return;
  mergeSourceKey.value = mergeSourceKey.value === key ? null : key;
}
function onCardClick(targetKey) {
  if (gamePhase.value !== 'sorting') return;
  const sourceKey = mergeSourceKey.value;
  if (sourceKey === null || sourceKey === targetKey) return;
  mergedInto.set(sourceKey, targetKey);
  mergeSourceKey.value = null;
  answersVersion.value++;
}
// الدمج بالسحب: اسحب بطاقة وأفلتها فوق البطاقة اللي تنضم لها (التأجيل عشان تعديل البطاقة ما يلغي السحب)
function onCardDragStart(key) {
  if (gamePhase.value !== 'sorting') return;
  setTimeout(() => { mergeSourceKey.value = key; }, 0);
}
function onCardDragEnd() { mergeSourceKey.value = null; }

const sortingQuestion = ref('');
const hidePlayerNames = ref(true);

function unmergeGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  const toDelete = Array.from(mergedInto.keys()).filter((k) => groupKeyOf(k) === key);
  toDelete.forEach((k) => mergedInto.delete(k));
  answersVersion.value++;
}

// اقتراح دمج: الإجابات القريبة من بعض (بطيخ / بطيخه / بتيخ) تتلوّن، والأقل لاعبين يطلع عليها زر "ادمج مع"
// المقارنة بعد توحيد الحروف اللي تنكتب غلط كثير، والفرق المسموح حرف وحدة (وحرفين للكلمات الطويلة)
function similarityForm(answer) {
  return answer.replace(/\s+/g, '').replace(/ى/g, 'ي').replace(/[ؤئ]/g, 'ء').replace(/ط/g, 'ت').replace(/ظ/g, 'ض').replace(/ه$/, '');
}
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (v, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
// مفتاح البطاقة -> { target, distance } للبطاقة اللي يُقترح دمجها، ومجموعة كل البطاقات المتشابهة للتلوين
const similarSuggestions = computed(() => {
  const groups = activeGroups.value.map((g) => ({ g, form: similarityForm(g.answer) }));
  const suggestions = new Map();
  const similarKeys = new Set();
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const minLen = Math.min(a.form.length, b.form.length);
      if (minLen < 3) continue;
      const max = minLen >= 6 ? 2 : 1;
      const distance = editDistance(a.form, b.form, max);
      if (distance > max) continue;
      // البطاقة الأقل لاعبين تنضم للأكثر (activeGroups مرتبة من الأكثر، فـ b هي الأقل أو المساوية)
      const prevSuggestion = suggestions.get(b.g.key);
      if (!prevSuggestion || distance < prevSuggestion.distance) suggestions.set(b.g.key, { target: a.g.key, distance });
      similarKeys.add(a.g.key);
      similarKeys.add(b.g.key);
    }
  }
  return { suggestions, similarKeys };
});
function acceptSuggestion(sourceKey) {
  const suggestion = similarSuggestions.value.suggestions.get(sourceKey);
  if (!suggestion || gamePhase.value !== 'sorting') return;
  mergedInto.set(sourceKey, suggestion.target);
  answersVersion.value++;
}

function confirmScoring() {
  if (gamePhase.value !== 'sorting') return;
  const groups = activeGroups.value;
  const logs = [];
  const newWinners = [];
  const winScore = getWinScore();

  groups.forEach((group) => {
    const points = (group.players.length > 1 ? 1 : getUniquePoints()) * roundMultiplier.value;
    const badge = group.players.length > 1 ? '🔁 مكررة' : '🌟 فريدة';
    group.players.forEach((name) => {
      const player = getOrCreatePlayer(name);
      const wasWinnerAlready = player.score >= winScore;
      player.score += points;
      if (!wasWinnerAlready && player.score >= winScore) newWinners.push(player.name);
    });
    logs.push(`<div class="log-item ${group.players.length > 1 ? 'log-hit' : 'log-star'}">${badge}: <b>${nameHtml(group.answer)}</b> (${group.players.length} لاعب) — كل واحد +${points} نقطة: ${group.players.map((n) => nameHtml(n)).join('، ')}</div>`);
  });

  if (groups.length === 0) {
    logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي إجابة معتمدة بهذي الجولة.</div>');
  }

  // أكثر من لاعب تجاوز نقاط الفوز بنفس الجولة: الأعلى يفوز، وعند التعادل يتشاركون المركز
  if (newWinners.length > 0) {
    const topWinners = topScorerNames(newWinners.map((n) => getOrCreatePlayer(n)));
    topWinners.forEach((n) => gameWinnerNames.add(n));
    gameOver.value = true;
    logs.push(`<div style="text-align:center; font-size:16px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px; margin-top:6px;">🏆 تجاوز نقاط الفوز (${winScore}) وفاز: <b>${topWinners.map((n) => nameHtml(n)).join('، ')}</b> 🏆</div>`);
  }

  logs.forEach((l) => appendLog(l));
  saveScores();

  gamePhase.value = 'idle';
  currentRoundAnswers.clear();
  excludedKeys.clear();
  autoExcludedKeys.clear();
  clearMerges();
  answersVersion.value++;
  questionInput.value = '';

  openModal(`نتائج التوزيع - الجولة ${roundNumber.value}`, logs);
}

function resetGame() {
  resetSettingsConfirm();
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  playersScores.clear();
  gameWinnerNames.clear();
  gameOver.value = false;
  saveScores();
  hasGameStarted.value = false;
  gamePhase.value = 'idle';
  roundNumber.value = 0;
  currentRoundAnswers.clear();
  excludedKeys.clear();
  autoExcludedKeys.clear();
  clearMerges();
  answersVersion.value++;
  eventLog.value = [];
  usedQuestionIndices.clear();
  usedLettersByIndex.clear();
  doubleNextRound.value = false;
  roundMultiplier.value = 1;
  questionInput.value = '';
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 60) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

// السؤال المضاعف: المستضيف يفعّله قبل الجولة، ونقاط الجولة كلها (الفريدة والمكررة) ×2
const doubleNextRound = ref(false);
const roundMultiplier = ref(1);

// شاشة العرض: الخانة اللي بين علامتي التنصيص تتلوّن — اللون بلونه الحقيقي، والحرف بخط أكبر
const COLOR_HEX = {
  أحمر: ['#e74c3c', '#fff'], أخضر: ['#27ae60', '#fff'], أصفر: ['#f1c40f', '#1e1e2f'], أزرق: ['#2e86de', '#fff'],
  أبيض: ['#ffffff', '#1e1e2f'], أسود: ['#000000', '#fff'], بني: ['#8e5a2b', '#fff'], رمادي: ['#95a5a6', '#1e1e2f'],
  برتقالي: ['#e67e22', '#fff'], بنفسجي: ['#8e44ad', '#fff'], وردي: ['#ff7eb6', '#1e1e2f'],
};
function slotHtml(value) {
  const color = COLOR_HEX[value];
  if (color) return `<span class="q-slot q-color" style="background:${color[0]}; color:${color[1]};">${escapeHtml(value)}</span>`;
  if (value.length === 1) return `<span class="q-slot q-letter">${escapeHtml(value)}</span>`;
  return `<span class="q-slot q-place">${escapeHtml(value)}</span>`;
}
function questionHtml(question) {
  return question.split(/"([^"]+)"/).map((part, i) => (i % 2 === 0 ? escapeHtml(part) : slotHtml(part.trim()))).join('');
}
const stageQuestionHtml = computed(() => {
  if (gamePhase.value === 'collecting') return questionHtml(currentQuestion);
  return escapeHtml(hasGameStarted.value ? 'استعدوا... السؤال القادم بعد شوي!' : 'اضغط "بدء الجولة" لعرض السؤال هنا');
});
const stageTimerText = computed(() => {
  if (gamePhase.value === 'collecting') return String(timeLeft.value);
  if (gamePhase.value === 'sorting') return '🗂️';
  return '--';
});
const stageTimerUrgent = computed(() => gamePhase.value === 'collecting' && timeLeft.value <= 5);
const stageStatusText = computed(() => {
  if (gamePhase.value === 'idle') return 'جاهز لبدء جولة جديدة';
  if (gamePhase.value === 'collecting') return `✍️ باب الإجابات مفتوح — اكتب إجابتك بالدردشة تبدأ بـ "${getAnswerPrefix()}"`;
  return 'المستضيف يفرز الإجابات الآن...';
});

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }
const currentWinScore = computed(() => getWinScore());
// الفائزين المعلنين فقط (لو تجاوز أكثر من لاعب بنفس الجولة يفوز الأعلى)
const gameWinnerNames = reactive(new Set());
// الفوز ينهي اللعبة: ما تبدأ جولة جديدة لين "إعادة اللعبة"
const gameOver = ref(false);
function blockIfGameOver() {
  if (!gameOver.value) return false;
  openModal('🏆 انتهت اللعبة', ['<div class="log-item" style="text-align:center;">🏆 انتهت اللعبة بفوز لاعب — اضغط "🔄 إعادة اللعبة بالكامل" للبدء من جديد.</div>']);
  return true;
}

function cardBadge(group) {
  const isUnique = group.players.length === 1;
  const points = (isUnique ? getUniquePoints() : 1) * roundMultiplier.value;
  return isUnique ? `🌟 فريدة +${points}` : `🔁 ${group.players.length} لاعبين +${points}`;
}

const manualPanelVisible = computed(() => gamePhase.value === 'collecting');
const sortingPanelVisible = computed(() => gamePhase.value === 'sorting');
const startBtnVisible = computed(() => gamePhase.value === 'idle');
const collectingBtnsVisible = computed(() => gamePhase.value === 'collecting');
const confirmBtnVisible = computed(() => gamePhase.value === 'sorting');

const barExpanded = ref(true);
function goHome() {
  try { localStorage.removeItem(SCORES_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function handleTiktokMessage(data) {
  // اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة (إجابته ونقاطه) بأي وقت
  if (data.user && isLeaveComment(data.comment)) {
    if (currentRoundAnswers.delete(data.user)) answersVersion.value++;
    if (playersScores.delete(data.user)) saveScores();
    return;
  }
  if (data.comment && data.user) registerAnswerFromComment(data.user, data.comment);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'unique', onMessage: handleTiktokMessage });
}

// الإعدادات (ومنها قوائم الأسئلة) لازم تتأكد أول: أول ضغطة على بدء الجولة أو 🎲 أو 📚 تفتح النافذة،
// وزرها يحفظ ويكمّل نفس الخطوة اللي انضغطت
let afterSettings = startRound;
const settingsStartLabel = ref('');
const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(() => afterSettings());
function requestAfterSettings(action, label) {
  if (gamePhase.value !== 'idle') return;
  afterSettings = action;
  settingsStartLabel.value = label;
  requestStart();
}
function requestStartRound() { requestAfterSettings(startRound, '🚀 بدء الجولة (فتح باب الإجابات)'); }
function requestRandomQuestion() { requestAfterSettings(pickRandomQuestion, '🎲 حفظ واختيار سؤال عشوائي'); }
function requestLibrary() { requestAfterSettings(openLibrary, '📚 حفظ وتصفح المكتبة'); }
// زر المسافة: لو ما فيه سؤال مكتوب يختار سؤال عشوائي، وبعدها يبدأ الجولة مباشرة
function randomQuestionAndStart() {
  if (questionInput.value.trim() === '') pickRandomQuestion();
  if (questionInput.value.trim() !== '') startRound();
}
function requestRandomAndStart() { requestAfterSettings(randomQuestionAndStart, '🚀 حفظ وبدء الجولة بسؤال عشوائي'); }
const noQuestionListSelected = computed(() => !generalEnabled.value && selectedCategoryKeys.value.length === 0);

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (settingsVisible.value) return;
    if (showLibraryOverlay.value || showModal_.value) return;
    if (startBtnVisible.value) requestRandomAndStart();
    else if (collectingBtnsVisible.value) endCollecting();
    else if (confirmBtnVisible.value) confirmScoring();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage, (name) => playersScores.has(name));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (collectingCountdown) clearInterval(collectingCountdown);
  clearMessageHandler();
});
</script>

<template>
  <h1>🧩 الجواب الفريد "ج"</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" :start-label="settingsStartLabel" :start-disabled="noQuestionListSelected" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>

      <div class="adv-columns">
        <label class="adv-item" :class="{ disabled: gameSettingsLocked }">
          <span>🔑 <b>مفتاح الإجابة</b> — النظام يتجاهل أي تعليق ما يبدأ بهذا المفتاح.</span>
          <input v-model="answerPrefixInput" type="text" maxlength="5" :disabled="gameSettingsLocked">
        </label>
        <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>⏱️ <b>مدة الجولة</b> — مدة جمع الإجابات بالثواني، وبعدها تظهر شاشة الفرز.</span>
          <input v-model="roundDurationInput" type="number" min="10" max="180" :disabled="roundControlsDisabled">
        </label>
        <label class="adv-item" :class="{ disabled: gameSettingsLocked }">
          <span>🏆 <b>نقاط الفوز</b> — تتحدد قبل أول جولة وتنقفل بعدها، وأول لاعب يوصلها يفوز.</span>
          <input v-model="winScoreInput" type="number" min="20" :disabled="gameSettingsLocked" @change="clampWinScore">
        </label>
        <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>🌟 <b>نقاط الإجابة الفريدة</b> — اللي جاوب بشي ما حد غيره قاله ياخذ هالنقاط، والمكررة تاخذ نقطة وحدة.</span>
          <input v-model="uniquePointsInput" type="number" min="1" max="5" :disabled="roundControlsDisabled" @change="clampUniquePoints">
        </label>
      </div>
    </div>

    <!-- قوائم الأسئلة: نفس شكل نافذة أحكام عجلة الصامل (مربع تحديد/إلغاء الكل + فئات القائمة) -->
    <div class="adv-group basics q-list-group">
      <div class="q-list-title">
        <label class="q-list-all">
          <input v-model="generalEnabled" type="checkbox" :disabled="roundControlsDisabled">
          📋 القائمة العامة
        </label>
        <span class="q-list-count">أسئلة مفتوحة بدون حرف أو لون</span>
      </div>
    </div>
    <div v-for="group in CATEGORY_GROUPS" :key="group.key" class="adv-group q-list-group" :class="group.cls">
      <div class="q-list-title">
        <label class="q-list-all" title="تحديد/إلغاء القائمة كاملة">
          <input type="checkbox" :checked="isGroupAllSelected(group)" :disabled="roundControlsDisabled" @change="toggleGroup(group)">
          {{ group.title }}
        </label>
        <span class="q-list-count">{{ selectedCountOf(group) }} / {{ group.categories.length }}</span>
      </div>
      <div class="adv-columns">
        <div
          v-for="cat in group.categories"
          :key="cat.key"
          class="adv-item"
          :class="{ checked: selectedCategoryKeys.includes(cat.key), disabled: roundControlsDisabled }"
        >
          <label class="adv-item-label">
            <input v-model="selectedCategoryKeys" type="checkbox" :value="cat.key" :disabled="roundControlsDisabled">
            <span><b>{{ cat.label }}</b></span>
          </label>
        </div>
      </div>
    </div>
    <p v-if="noQuestionListSelected" class="q-list-warning">⚠️ لازم تختار قائمة أو فئة وحدة على الأقل</p>
  </SettingsOverlay>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" @click="requestStartRound">🚀 بدء الجولة (فتح باب الإجابات)</button>
    <input v-if="collectingBtnsVisible" v-model="extendSecondsInput" type="number" min="5" max="600" style="width:70px; flex:none;" title="مقدار التمديد بالثواني">
    <button v-if="collectingBtnsVisible" class="master-btn side-panel-btn" style="background:#8e44ad;" @click="extendRound">⏱️ تمديد</button>
    <button v-if="collectingBtnsVisible" class="master-btn side-panel-btn" style="background:#3498db;" @click="endCollecting">⏹️ إنهاء الجمع الآن</button>
    <button v-if="confirmBtnVisible" class="master-btn side-panel-btn" @click="confirmScoring">✅ اعتماد وتوزيع النقاط</button>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>{{ gamePhase === 'idle' ? '❓ سؤال هذه الجولة' : '🎥 شاشة العرض للجمهور' }}</h2>
      <!-- العرضين فوق بعض بنفس الخانة عشان التبديل بينهم ما يحرّك الصفحة -->
      <div class="stage-switch">
        <div class="stage-view" :class="{ 'is-hidden': gamePhase !== 'idle' }">
          <textarea id="questionInput" v-model="questionInput" :disabled="roundControlsDisabled" placeholder="اكتب سؤالاً مفتوحاً... مثال: اذكر اسم فاكهة"></textarea>
          <div style="display:flex; gap:5px; width:100%; margin-top:10px; flex-wrap:wrap;">
            <button class="master-btn" style="padding:8px 15px; font-size:0.9rem; flex:1; min-width:160px; margin:0;" :disabled="roundControlsDisabled" @click="requestRandomQuestion">🎲 سؤال عشوائي من المكتبة</button>
            <button class="master-btn" style="padding:8px 15px; font-size:0.9rem; background:#3498db; flex:1; min-width:160px; margin:0;" :disabled="roundControlsDisabled" @click="requestLibrary">📚 تصفح المكتبة</button>
          </div>
          <button
            class="double-toggle-btn"
            :class="{ active: doubleNextRound }"
            :disabled="roundControlsDisabled"
            @click="doubleNextRound = !doubleNextRound"
          >{{ doubleNextRound ? '🔥 الجولة الجاية مضاعفة ×2 (اضغط للإلغاء)' : '🔥 سؤال مضاعف ×2' }}</button>
          <div class="field-hint">اضغط 🎲 لسؤال عشوائي جديد، أو 📚 لتصفح كل أسئلة المكتبة واختيار واحد يدوياً</div>
        </div>
        <div class="stage-view stage-live" :class="{ 'is-hidden': gamePhase === 'idle' }">
          <div v-if="gamePhase !== 'idle' && roundMultiplier > 1" class="stage-double">🔥 سؤال مضاعف — النقاط ×2</div>
          <div class="stage-question" v-html="stageQuestionHtml"></div>
          <div class="stage-timer" :class="{ urgent: stageTimerUrgent }">{{ stageTimerText }}</div>
          <div class="stage-status">{{ stageStatusText }}</div>
        </div>
      </div>
      <div class="scoreboard-title">🏆 لوحة الصدارة</div>
      <div class="leaderboard-list">
        <div v-if="leaderboardSorted.length === 0" class="field-hint">لا يوجد لاعبون سجّلوا نقاطاً بعد</div>
        <div v-for="(p, i) in leaderboardSorted" :key="p.name" class="leaderboard-item" :class="{ 'is-winner': gameWinnerNames.has(p.name) }">
          <span><span class="lb-rank">{{ rankFor(i) }}</span><img :src="avatarOrLogo(p.avatar)" class="player-avatar" alt=""><bdi>{{ displayName(p.name) }}</bdi>{{ gameWinnerNames.has(p.name) ? ' 🏆' : '' }}</span>
          <span>{{ p.score }} نقطة</span>
        </div>
      </div>
    </div>

    <div v-if="manualPanelVisible" class="panel" style="display:flex;">
      <h3>✍️ إضافة إجابة يدوياً (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualAnswerInput" type="text" placeholder="الإجابة" @keydown.enter.prevent="manualAddAnswer">
        <button class="master-btn" @click="manualAddAnswer">إضافة</button>
      </div>
    </div>

    <div v-if="sortingPanelVisible" class="sorting-overlay">
     <div class="panel sorting-panel">
      <h3>🗂️ فرز الإجابات</h3>
      <div class="sorting-question"><span v-html="questionHtml(sortingQuestion)"></span><span v-if="roundMultiplier > 1"> — 🔥 ×2</span></div>
      <label class="letters-only-toggle hide-names-toggle">
        <input v-model="hidePlayerNames" type="checkbox">
        🙈 إخفاء أسماء اللاعبين
      </label>
      <div class="field-hint merge-hint" :class="{ 'is-active': mergeSourceKey !== null }">
        {{ mergeSourceKey !== null
          ? `🔗 اختر البطاقة اللي تبي تدمج "${mergeSourceKey}" معها`
          : 'للدمج: اسحب بطاقة وأفلتها فوق الثانية، أو اضغط "دمج" ثم اختر البطاقة الثانية' }}
      </div>
      <div class="answer-cards-grid">
        <div v-if="activeGroups.length === 0" class="field-hint">ما فيه أي إجابة وصلت هذي الجولة</div>
        <div
          v-for="g in activeGroups"
          :key="g.key"
          class="answer-card"
          draggable="true"
          :class="{
            'is-unique': g.players.length === 1,
            'is-merge-source': mergeSourceKey === g.key,
            'is-merge-target': mergeSourceKey !== null && mergeSourceKey !== g.key,
            'is-similar': mergeSourceKey === null && similarSuggestions.similarKeys.has(g.key),
          }"
          @click="onCardClick(g.key)"
          @dragstart="onCardDragStart(g.key)"
          @dragend="onCardDragEnd"
          @dragover.prevent
          @drop.prevent="onCardClick(g.key)"
        >
          <div class="answer-badge">{{ cardBadge(g) }}</div>
          <div class="answer-text">{{ g.answer }}</div>
          <div v-if="!hidePlayerNames" class="answer-meta">{{ g.players.map(nameText).join('، ') }}</div>
          <div v-if="g.mergedAnswers.length > 0" class="answer-merged">
            مدموج معها: {{ g.mergedAnswers.join('، ') }}
            <button class="unmerge-btn" title="فك الدمج" @click.stop="unmergeGroup(g.key)">فك الدمج</button>
          </div>
          <button
            v-if="mergeSourceKey === null && similarSuggestions.suggestions.has(g.key)"
            class="suggest-merge-btn"
            @click.stop="acceptSuggestion(g.key)"
          >🔗 ادمج مع "{{ similarSuggestions.suggestions.get(g.key).target }}"؟</button>
          <div class="card-actions">
            <template v-if="mergeSourceKey === null">
              <button class="card-btn merge-btn" @click.stop="toggleMergeSource(g.key)">🔗 دمج</button>
              <button class="card-btn remove-btn" @click.stop="excludeGroup(g.key)">❌ استبعاد</button>
            </template>
            <button v-else-if="mergeSourceKey === g.key" class="card-btn cancel-btn" @click.stop="toggleMergeSource(g.key)">✖️ إلغاء الدمج</button>
            <button v-else class="card-btn target-btn" @click.stop="onCardClick(g.key)">⬅️ ادمج هنا</button>
          </div>
        </div>
      </div>
      <div v-if="excludedGroups.length > 0" class="excluded-wrap" style="display:block;">
        <div class="scoreboard-title">🗑️ إجابات مستبعدة</div>
        <div class="answer-cards-grid">
          <div v-for="g in excludedGroups" :key="g.key" class="answer-card is-excluded">
            <div class="answer-text">{{ g.answer }}</div>
            <div v-if="autoExcludedKeys.has(g.key)" class="answer-merged">🔤 ما تبدأ بحرف "{{ roundLetter }}"</div>
            <div v-if="!hidePlayerNames" class="answer-meta">{{ g.players.map(nameText).join('، ') }}</div>
            <div v-if="g.mergedAnswers.length > 0" class="answer-merged">مدموج معها: {{ g.mergedAnswers.join('، ') }}</div>
            <div class="card-actions">
              <button class="card-btn restore-btn" @click="restoreGroup(g.key)">↩️ استرجاع</button>
            </div>
          </div>
        </div>
      </div>
      <button class="master-btn sorting-confirm-btn" @click="confirmScoring">✅ اعتماد وتوزيع النقاط</button>
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

  <div v-if="showLibraryOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>📚 مكتبة الأسئلة</h2>
      <ul class="rules-list" style="max-height: 60vh; overflow-y: auto;">
        <li
          v-for="item in libraryItems"
          :key="item.index"
          class="library-item"
          :class="{ 'is-used': item.isUsed }"
          @click="selectLibraryQuestion(item.index)"
        >
          <span>{{ item.text }}</span>
          <span v-if="item.isUsed" class="lib-used-badge">✅ استُخدم</span>
        </li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="closeLibrary">🔙 رجوع للعبة</button>
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

textarea { height: 60px; resize: vertical; }
textarea:focus, input:focus, select:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.letters-only-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 0;
  font-weight: normal;
  cursor: pointer;
}

.letters-only-toggle input { width: auto; flex: none; }

/* قوائم الأسئلة في نافذة الإعدادات: نفس عنوان مجموعات أحكام عجلة الصامل */
.q-list-title {
  font-weight: bold;
  font-size: 1.1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.q-list-group.basics .q-list-title { color: #2ecc71; }
.q-list-group.guess .q-list-title { color: #5dade2; }
.q-list-group.modes .q-list-title { color: #bb8fce; }
.q-list-group.gifts .q-list-title { color: #f1c40f; }
.q-list-all { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
.q-list-all input[type="checkbox"] { width: auto; flex: none; accent-color: var(--primary-color); cursor: pointer; }
.q-list-count { font-size: 0.85rem; font-weight: normal; color: #bdc3c7; }
.q-list-warning { margin: 0; text-align: center; color: #ff6b6b; font-weight: bold; }

.setting-btn {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  font-size: 0.95rem;
  cursor: pointer;
}

.setting-btn:hover { border-color: var(--primary-color); }

.settings-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
}

.settings-row .setting-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.85rem;
  text-align: center;
}

/* السطر السفلي موزون: الحقول تلصق بأسفل الخانة وبنفس الارتفاع حتى لو العنوان نزل لسطرين */
.settings-row .setting-cell { justify-content: flex-end; }
/* الصف يتكيّف مع حجم الشاشة: الخانات تتمدد وتنزل لسطر جديد لو ضاقت المساحة */
.settings-row .setting-cell { flex: 1 1 110px; min-width: 0; }
.settings-row .setting-cell.wide { flex: 2 1 220px; }
.settings-row .setting-cell :deep(.custom-select-trigger > span:first-child) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.settings-row .setting-btn.active { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.2); }
.settings-row .setting-cell input,
.settings-row .setting-cell .setting-btn,
.settings-row .setting-cell :deep(.custom-select-trigger) { height: 40px; }
.settings-row .setting-cell input { text-align: center; padding: 8px; }

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

.library-item {
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.library-item:hover { background: #2a2a40; }
.library-item.is-used { opacity: 0.5; border-right-color: #8b93a3; }
.library-item .lib-used-badge { font-size: 0.75rem; color: #2ecc71; white-space: nowrap; }

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

.stage-question {
  font-size: 1.5rem;
  font-weight: bold;
  text-align: center;
  color: #fff;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 14px;
  min-height: 2.4em;
  line-height: 1.45;
  width: 100%;
}

.stage-timer {
  font-size: 42px;
  font-weight: bold;
  text-align: center;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 6px;
}

.stage-timer.urgent { color: #ff4757; }

.stage-question :deep(.q-slot),
.sorting-question :deep(.q-slot) { display: inline-block; margin: 0 4px; vertical-align: middle; }
.stage-question :deep(.q-letter),
.sorting-question :deep(.q-letter) {
  font-size: 2.2em;
  line-height: 1;
  color: var(--primary-color);
  text-shadow: 0 0 14px var(--border-glow);
}
.stage-question :deep(.q-color),
.sorting-question :deep(.q-color) {
  padding: 2px 14px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
}
.stage-question :deep(.q-place),
.sorting-question :deep(.q-place) { color: #f1c40f; font-size: 1.15em; }

.stage-double {
  text-align: center;
  font-weight: bold;
  font-size: 1.1rem;
  color: #1e1e2f;
  background: linear-gradient(90deg, #f39c12, #e74c3c);
  border-radius: 10px;
  padding: 6px 10px;
  margin-bottom: 10px;
}
.double-toggle-btn {
  width: 100%;
  margin: 8px 0 0;
  padding: 8px 15px;
  border: 1px dashed rgba(243, 156, 18, 0.7);
  border-radius: 8px;
  background: rgba(243, 156, 18, 0.1);
  color: #f5c16c;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
}
.double-toggle-btn.active { background: linear-gradient(90deg, #f39c12, #e74c3c); border-style: solid; color: #1e1e2f; }
.double-toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.stage-status {
  text-align: center;
  color: #ccd6e0;
  font-size: 0.92rem;
  margin-bottom: 14px;
  min-height: 1.3em;
}

.scoreboard-title {
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: bold;
  color: var(--primary-color);
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.15);
  padding-top: 10px;
  width: 100%;
}

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
.leaderboard-item.is-winner { background: #f39c12; color: #1e1e2f; font-weight: bold; }

.manual-add-row { display: flex; gap: 5px; width: 100%; flex-wrap: wrap; }
.manual-add-row input { flex: 1; min-width: 120px; }
.manual-add-row button { flex: none; padding: 8px 15px; font-size: 0.9rem; }

/* شاشة الفرز تغطي الصفحة كاملة، وشريط التحكم العائم (زر الاعتماد) يبقى ظاهر فوقها */
.sorting-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: var(--bg-gradient);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 90;
  padding: 20px 15px;
  overflow-y: auto;
}

.sorting-panel { max-width: 1100px; flex-shrink: 0; }

.stage-switch { display: grid; width: 100%; }
.stage-view { grid-area: 1 / 1; min-width: 0; }
.stage-view.is-hidden { visibility: hidden; pointer-events: none; }
.stage-live { display: flex; flex-direction: column; justify-content: center; }
.stage-live .stage-status { margin-bottom: 0; }

.sorting-question {
  width: 100%;
  text-align: center;
  font-size: 1.25rem;
  font-weight: bold;
  background: rgba(0,0,0,0.25);
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 10px;
}

.hide-names-toggle { margin: 0 0 8px; font-size: 0.9rem; }

.answer-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
  width: 100%;
}

.answer-card {
  background: #1e1e2f;
  border: 2px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: grab;
}

.answer-card.is-merge-source {
  border-style: dashed;
  border-color: #3498db;
  box-shadow: 0 0 12px rgba(52, 152, 219, 0.6);
}

.answer-card.is-merge-target { cursor: pointer; border-color: rgba(52, 152, 219, 0.55); }
.answer-card.is-merge-target:hover { border-color: #3498db; background: #25304a; }

.merge-hint { margin: 0 0 10px; text-align: center; font-size: 0.85rem; }
.merge-hint.is-active { color: #5dade2; font-weight: bold; }

.answer-card .answer-merged { font-size: 0.75rem; color: #5dade2; margin-top: 4px; word-break: break-word; }

.answer-card .unmerge-btn {
  display: block;
  margin: 4px auto 0;
  padding: 3px 10px;
  font-size: 0.75rem;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  background: transparent;
  color: #ccd6e0;
  cursor: pointer;
}

.answer-card.is-unique {
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.answer-card.is-excluded { opacity: 0.6; cursor: default; }

.answer-card .answer-text {
  font-size: 1.3rem;
  font-weight: bold;
  margin: 6px 0 4px;
  word-break: break-word;
}

.answer-card .answer-meta {
  font-size: 0.78rem;
  color: #bdc3c7;
  word-break: break-word;
  max-height: 3.2em;
  overflow: hidden;
}

.answer-card .answer-badge {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 10px;
  background: rgba(52, 152, 219, 0.25);
  color: #eaf4ff;
}

.answer-card.is-unique .answer-badge {
  background: rgba(243, 156, 18, 0.3);
  color: #ffe6b3;
}

.answer-card .card-actions { display: flex; gap: 6px; width: 100%; margin-top: auto; padding-top: 10px; }

.answer-card .card-btn {
  flex: 1;
  margin: 0;
  padding: 9px 6px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: bold;
  color: white;
  cursor: pointer;
}

.answer-card .remove-btn { background: #8A1538; }
.answer-card .merge-btn { background: #2980b9; }
.answer-card .target-btn { background: #2980b9; }
.answer-card .cancel-btn { background: #555c6b; }
.answer-card .restore-btn { background: #27ae60; }

/* إجابات متشابهة: إطار بنفسجي + زر اقتراح الدمج */
.answer-card.is-similar { border-color: #9b59b6; box-shadow: 0 0 10px rgba(155, 89, 182, 0.55); }
.answer-card .suggest-merge-btn {
  margin: 8px 0 0;
  padding: 6px 10px;
  width: 100%;
  border: 1px dashed #bb8fce;
  border-radius: 8px;
  background: rgba(155, 89, 182, 0.2);
  color: #e8d5f2;
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  word-break: break-word;
}
.answer-card .suggest-merge-btn:hover { background: rgba(155, 89, 182, 0.4); }

.sorting-confirm-btn { width: 100%; margin-top: 18px; padding: 14px; font-size: 1.15rem; }

.excluded-wrap {
  width: 100%;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255,255,255,0.15);
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
.event-log-panel :deep(.log-star) { border-right: 4px solid var(--primary-color); }

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
  max-width: 400px;
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
