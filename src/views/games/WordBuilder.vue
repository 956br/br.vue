<script setup>
import { useFloatingBar } from '../../utils/useFloatingBar';
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
import { isLeaveComment } from '../../utils/tiktokBridge';
import { nameHtml, nameText } from '../../utils/nameHtml';
import { topScorerNames } from '../../utils/gameWin';
// القاموس والكلمات الذهبية ينبنون من نصوص الموقع: node scripts/build-word-dict.mjs
import dictText from '../../data/wordBuilderDict.txt?raw';
import goldText from '../../data/wordBuilderGold.txt?raw';

// كوّن كلمة: تطلع حروف بالجولة، والمتابعين يكتبون كلمات من هالحروف (كلها أو بعضها، والحرف يتكرر عادي).
// كل كلمة: أول واحد كتبها ياخذ نقاط "الأول"، واللي بعده ياخذون نقطة. الفرز نفس الجواب الفريد "ج":
// الكلمة اللي فيها حرف مب من حروف الجولة تنستبعد نهائياً (تظهر بالمستبعدة بدون استرجاع)، والمستضيف يستبعد/يسترجع الباقي يدوياً.
// إضافات: القاموس يعلّم الكلمات المعروفة عشان المستضيف يراجع الباقي بس، وكل جولة فيها كلمة ذهبية (كلمة مختارة
// من الحروف — كل من يكتبها ياخذ مكافأة) وحرف ذهبي (كل من يكتب كلمة فيها الحرف ياخذ نقاط إضافية).

const router = useRouter();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ===== توحيد الحروف =====
// التشكيل والتطويل ينشالون، وكل الهمزات تعتبر ألف (أ إ آ ء)، ؤ = و، ئ و ى = ي.
// التاء المربوطة تبقى بالكلمة، وتنقبل لو حروف الجولة فيها ه أو ت.
const ARABIC_TOKEN = /^[ء-يٱ]+$/;
function cleanWord(raw) {
  return String(raw).replace(/[ً-ْٰـ]/g, '').trim();
}
function normalizeWord(raw) {
  return cleanWord(raw)
    .replace(/[أإآٱء]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}
// مفتاح المقارنة: "ال" التعريف ما تفرق (الباب = باب)، والتاء المربوطة = ه
function groupKeyOf(word) {
  return word.replace(/ة/g, 'ه').replace(/^ال(?=\S\S)/, '');
}
function isFromLetters(word, letterSet) {
  for (const ch of word) {
    if (letterSet.has(ch)) continue;
    if (ch === 'ة' && (letterSet.has('ه') || letterSet.has('ت'))) continue;
    return false;
  }
  return true;
}

// ===== توليد حروف الجولة =====
// المستضيف يختار عدد أو أكثر من أعداد الحروف، وكل جولة تاخذ واحد منها عشوائياً
const LETTER_COUNTS = [3, 4, 5, 6, 7, 8];
const selectedCounts = ref([4, 5, 6]);
const selectedCountsText = computed(() => selectedCounts.value.slice().sort((a, b) => a - b).join('، '));

// ===== القاموس والكلمات الذهبية =====
// مفاتيح القاموس بنفس توحيد groupKeyOf (بدون "ال"، ة = ه، الهمزات ألف)
const DICTIONARY = new Set(dictText.split(/\r?\n/).filter(Boolean));
const dictVersion = ref(0); // يزيد لما تنضاف كلمات اعتمدها الأدمن (عشان أقسام الفرز تنحسب من جديد)
function inDictionary(key) { return DICTIONARY.has(key); }

// كلمات اعتمدها الأدمن من /admin/dictionary تنضاف فوق قاموس الملف (كاش دقيقة بالـ API)
async function loadApprovedWords() {
  try {
    const res = await fetch('/api/word-dict');
    if (!res.ok) return;
    const { words } = await res.json();
    (words || []).forEach((w) => DICTIONARY.add(w));
    dictVersion.value++;
  } catch (e) { /* بدون نت: القاموس الأساسي يكفي */ }
}
// الكلمات المعتمدة بالجولة اللي مب بالقاموس تنرسل للأدمن يراجعها ويضيفها
function submitUnknownWords(groups) {
  const words = groups.filter((g) => !inDictionary(g.key)).map((g) => ({ key: g.key, display: g.answer }));
  if (words.length === 0) return;
  fetch('/api/word-dict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  }).catch(() => { /* ما تأثر على اللعبة */ });
}
// الكلمات الذهبية: { display: الكتابة الأصلية, key, letters: حروفها المختلفة }
const GOLD_WORDS = goldText.split(/\r?\n/).filter(Boolean).map((display) => {
  const key = groupKeyOf(normalizeWord(display));
  return { display, key, letters: Array.from(new Set(Array.from(key))) };
}).filter((g) => g.letters.length >= 3 && g.letters.every((ch) => /[ا-ي]/.test(ch)));

// الحروف اللي تنضاف لتكملة العدد: الأكثر استخداماً بالكلمات أول (مكررة عشان تطلع أكثر)
const FILL_LETTERS = 'اااوووييللممننررتتببسسههددككععققففححججشصطخزغضثذظ';
// البذرة: حروف كلمة ذهبية، عشان الجولة يكون فيها كلمة ذهبية أكيدة
// إعداد خفي (ما يطلع بالإعدادات): أزواج حروف ما تجتمع بجولة وحدة أبد
const FORBIDDEN_PAIRS = [['ز', 'ب'], ['ك', 'س']];
function breaksPair(letters, extra) {
  const set = new Set(letters);
  if (extra) set.add(extra);
  return FORBIDDEN_PAIRS.some(([a, b]) => set.has(a) && set.has(b));
}
const SEED_SETS = GOLD_WORDS.map((g) => g.letters).filter((s) => !breaksPair(s));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateLetters(count) {
  // نفضّل كلمة بذرة حروفها قريبة من العدد المطلوب، عشان أغلب الحروف تنفع مع بعض
  const fits = SEED_SETS.filter((s) => s.length <= count);
  const close = fits.filter((s) => s.length >= count - 2);
  const pool = close.length > 0 ? close : fits;
  const letters = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)].slice() : [];
  let guard = 0;
  while (letters.length < count && guard++ < 500) {
    const ch = FILL_LETTERS[Math.floor(Math.random() * FILL_LETTERS.length)];
    if (!letters.includes(ch) && !breaksPair(letters, ch)) letters.push(ch);
  }
  return shuffle(letters);
}

// حروف الجولة تنختار عشوائياً لحظة بدايتها (عدد من الأعداد المختارة بالإعدادات)
function randomRoundLetters() {
  const counts = selectedCounts.value.length > 0 ? selectedCounts.value : [5];
  return generateLetters(counts[Math.floor(Math.random() * counts.length)]);
}
// الكلمة الذهبية: أطول كلمة ذهبية تنكتب من حروف الجولة (لو أكثر من وحدة بنفس الطول تنختار عشوائياً)
function pickGoldenWord(letters) {
  const set = new Set(letters);
  const fits = GOLD_WORDS.filter((g) => g.key.length >= 3 && g.letters.every((ch) => set.has(ch)));
  if (fits.length === 0) return null;
  const maxLen = Math.max(...fits.map((g) => g.key.length));
  const longest = fits.filter((g) => g.key.length === maxLen);
  return longest[Math.floor(Math.random() * longest.length)];
}
// الحرف الذهبي: حرف عشوائي من حروف الجولة. التاء المربوطة تنحسب له لو كان ه أو ت
function hasGoldenLetter(word) {
  const gl = goldenLetter.value;
  if (!gl) return false;
  return word.includes(gl) || (word.includes('ة') && (gl === 'ه' || gl === 'ت'));
}

// ===== حالة اللعبة =====
const playersScores = reactive(new Map());
function getOrCreatePlayer(name) {
  if (!playersScores.has(name)) playersScores.set(name, reactive({ name, score: 0, avatar: getUserAvatar(name) }));
  const player = playersScores.get(name);
  if (!player.avatar) player.avatar = getUserAvatar(name);
  return player;
}

const hasGameStarted = ref(false);
const gamePhase = ref('idle'); // idle | collecting | sorting
const roundNumber = ref(0);
let roundDuration = 60;
const timeLeft = ref(0);
let collectingCountdown = null;
const roundLetters = ref([]);
const roundLetterSet = computed(() => new Set(roundLetters.value));
const goldenWord = ref(null); // { display, key, letters }
const goldenLetter = ref('');
const goldenFinder = ref(''); // أول من كتب الكلمة الذهبية وقت الجمع (للإعلان على الشاشة)
let roundStartedAt = 0;
let entrySeq = 0;
const roundEntries = []; // { seq, name, raw, word, key, ms } بترتيب الوصول (ms: من بداية الجولة)
const validKeysSeen = new Set(); // كلمات صحيحة مختلفة وصلت (للجولة الممتدة والعداد)
const playerWordKeys = new Set(); // name|key: نفس اللاعب ما تنحسب له نفس الكلمة مرتين
const excludedKeys = reactive(new Set());
const autoExcludedReasons = reactive(new Map()); // key -> سبب الاستبعاد التلقائي
const lockedKeys = reactive(new Set()); // كلمات حروفها مب من الجولة: مستبعدة نهائياً بدون استرجاع
const answersVersion = ref(0);
const eventLog = ref([]);

const answerPrefixInput = ref('');
const winScoreInput = ref(50);
const firstPointsInput = ref(5);
const otherPointsInput = ref(1);
const minLengthInput = ref(2);
const roundDurationInput = ref(60);
const extendSecondsInput = ref(15);
const goldenWordBonusInput = ref(5);
const goldenLetterBonusInput = ref(3);
// خصم الكلمات المرفوضة: اللي يستبعدها المستضيف بالفرز تنقص من كل من كتبها (عشان توقف الكتابة العشوائية)
const penaltyEnabled = ref(true);
const penaltyInput = ref(1);
// الذهبيات تنشغّل وتنطفي من الإعدادات (القاموس والإحصائيات دايماً شغالة)
const goldenWordEnabled = ref(true);
const goldenLetterEnabled = ref(true);
// الجولة الممتدة: تبدأ بوقت قصير، وكل كلمة جديدة موجودة بالقاموس تمدد الوقت
const roundMode = ref('normal'); // normal | extended
const extendedBaseInput = ref(30);
const extendedAddInput = ref(3);
const manualNameInput = ref('');
const manualAnswerInput = ref('');

const gameSettingsLocked = computed(() => hasGameStarted.value);
const roundControlsDisabled = computed(() => gamePhase.value !== 'idle');

function clampInt(raw, min, max, fallback) {
  let val = parseInt(raw, 10);
  if (Number.isNaN(val)) val = fallback;
  return Math.min(max, Math.max(min, val));
}
function getWinScore() { return clampInt(winScoreInput.value, 20, 100000, 50); }
function clampWinScore() { winScoreInput.value = getWinScore(); }
function getFirstPoints() { return clampInt(firstPointsInput.value, 1, 20, 5); }
function clampFirstPoints() { firstPointsInput.value = getFirstPoints(); }
function getOtherPoints() { return clampInt(otherPointsInput.value, 0, 20, 1); }
function clampOtherPoints() { otherPointsInput.value = getOtherPoints(); }
function getMinLength() { return clampInt(minLengthInput.value, 2, 8, 2); }
function clampMinLength() { minLengthInput.value = getMinLength(); }
function getRoundDuration() {
  const val = clampInt(roundDurationInput.value, 25, 300, 60);
  roundDurationInput.value = val;
  return val;
}
function getAnswerPrefix() { return answerPrefixInput.value.trim(); }
function getGoldenWordBonus() { return clampInt(goldenWordBonusInput.value, 0, 50, 5); }
function clampGoldenWordBonus() { goldenWordBonusInput.value = getGoldenWordBonus(); }
function getGoldenLetterBonus() { return clampInt(goldenLetterBonusInput.value, 0, 20, 3); }
function clampGoldenLetterBonus() { goldenLetterBonusInput.value = getGoldenLetterBonus(); }
function getPenalty() { return penaltyEnabled.value ? clampInt(penaltyInput.value, 0, 10, 1) : 0; }
function clampPenalty() { penaltyInput.value = clampInt(penaltyInput.value, 0, 10, 1); }
function getExtendedBase() { return clampInt(extendedBaseInput.value, 25, 300, 30); }
function clampExtendedBase() { extendedBaseInput.value = getExtendedBase(); }
function getExtendedAdd() { return clampInt(extendedAddInput.value, 1, 30, 3); }
function clampExtendedAdd() { extendedAddInput.value = getExtendedAdd(); }
const isExtendedRound = ref(false); // نوع الجولة الحالية (الإعداد ممكن يتغير بين الجولات)

const showModal_ = ref(false);
const modalTitle = ref('نتائج');
const modalLogs = ref([]);
function openModal(title, logsArray) {
  modalTitle.value = title;
  modalLogs.value = logsArray;
  showModal_.value = true;
}
function closeModal() { showModal_.value = false; }

// السؤال المضاعف: المستضيف يفعّله قبل الجولة، ونقاط الجولة كلها ×2
const doubleNextRound = ref(false);
const roundMultiplier = ref(1);

function startRound() {
  if (gamePhase.value !== 'idle') return;
  if (blockIfGameOver()) return;

  if (!hasGameStarted.value) hasGameStarted.value = true;
  roundNumber.value++;
  roundLetters.value = randomRoundLetters();
  goldenWord.value = goldenWordEnabled.value ? pickGoldenWord(roundLetters.value) : null;
  goldenLetter.value = goldenLetterEnabled.value ? roundLetters.value[Math.floor(Math.random() * roundLetters.value.length)] : '';
  roundMultiplier.value = doubleNextRound.value ? 2 : 1;
  doubleNextRound.value = false;
  isExtendedRound.value = roundMode.value === 'extended';
  roundDuration = isExtendedRound.value ? getExtendedBase() : getRoundDuration();
  timeLeft.value = roundDuration;
  clearRound();
  roundStartedAt = Date.now();
  gamePhase.value = 'collecting';

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 الجولة ${roundNumber.value}: الحروف ( ${roundLetters.value.join(' ')} ) — ${isExtendedRound.value ? `⏳ ممتدة ${roundDuration} ثانية (+${getExtendedAdd()} لكل كلمة جديدة)` : `${roundDuration} ثانية`}${roundMultiplier.value > 1 ? ' — 🔥 مضاعفة ×2' : ''}</div>`);
  startCollectingTimer();
}

function clearRound() {
  roundEntries.length = 0;
  playerWordKeys.clear();
  validKeysSeen.clear();
  goldenFinder.value = '';
  excludedKeys.clear();
  autoExcludedReasons.clear();
  lockedKeys.clear();
  showExcluded.value = false;
  answersVersion.value++;
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

// تسجيل كلمة لاعب (الفحص بالحروف يصير عند نهاية الجمع، راجع endCollecting)
function registerWord(name, rawToken) {
  const raw = cleanWord(rawToken);
  if (!raw || !ARABIC_TOKEN.test(raw)) return false;
  const word = normalizeWord(raw);
  const key = groupKeyOf(word);
  if (key.length < 2) return false;
  const dedupe = `${name}|${key}`;
  if (playerWordKeys.has(dedupe)) return false;
  playerWordKeys.add(dedupe);
  roundEntries.push({ seq: ++entrySeq, name, raw, word, key, ms: Date.now() - roundStartedAt });
  if (!invalidReason(word) && !validKeysSeen.has(key)) {
    validKeysSeen.add(key);
    // الجولة الممتدة: بس الكلمة الجديدة الموجودة بالقاموس تزيد الوقت (اللي مب بالقاموس ممكن تنحذف بالفرز)
    if (isExtendedRound.value && inDictionary(key)) timeLeft.value += getExtendedAdd();
    if (goldenWord.value && key === goldenWord.value.key) goldenFinder.value = name;
  }
  answersVersion.value++;
  return true;
}
function registerComment(name, rawComment) {
  if (gamePhase.value !== 'collecting' || !name || !rawComment) return;
  let text = String(rawComment).trim();
  const prefix = getAnswerPrefix();
  if (prefix) {
    if (!text.startsWith(prefix)) return;
    text = text.slice(prefix.length).trim(); // المسافة بين المفتاح والكلمة مسموحة
  }
  // التعليق لازم يكون كلمة وحدة: أي مسافة بعد الكلمة (كلام عادي أو أكثر من كلمة) يتجاهل التعليق كامل
  if (/\s/.test(text)) return;
  registerWord(name, text);
}

function manualAddAnswer() {
  if (gamePhase.value !== 'collecting') return;
  const name = manualNameInput.value.trim();
  const answer = manualAnswerInput.value.trim();
  if (name === '' || answer === '' || /\s/.test(answer)) return;
  registerWord(name, answer);
  manualAnswerInput.value = '';
}

// سبب الاستبعاد التلقائي لكلمة (أو '' لو سليمة)
function invalidReason(word) {
  if (!isFromLetters(word, roundLetterSet.value)) return 'فيها حرف مب من حروف الجولة';
  if (groupKeyOf(word).length < getMinLength()) return `أقصر من ${getMinLength()} حروف`;
  return '';
}

function endCollecting() {
  if (gamePhase.value !== 'collecting') return;
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  gamePhase.value = 'sorting';
  allGroups.value.forEach((g) => {
    const reason = invalidReason(g.word);
    if (!reason) return;
    excludedKeys.add(g.key);
    autoExcludedReasons.set(g.key, reason);
    // حرف مب من حروف الجولة: تظهر بالمستبعدة بس ما تنسترجع
    if (!isFromLetters(g.word, roundLetterSet.value)) lockedKeys.add(g.key);
  });
  answersVersion.value++;
  appendLog(`<div class="log-item" style="text-align:center;">⏳ انتهى وقت الجمع — ${allGroups.value.length} كلمة مختلفة، استُبعد منها تلقائياً ${autoExcludedReasons.size}</div>`);
}

// البطاقات: كل كلمة بطاقة، واللاعبين بترتيب وصولهم (الأول هو صاحب النقاط الكبيرة)
const allGroups = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  const groups = new Map();
  roundEntries.forEach((e) => {
    if (!groups.has(e.key)) groups.set(e.key, { key: e.key, answer: e.raw, word: e.word, entries: [] });
    const group = groups.get(e.key);
    group.entries.push(e);
    // "باب" و"الباب" نفس البطاقة: تنعرض وتنفحص بالكتابة الأقصر (بدون ال)
    if (e.word.length < group.word.length) { group.word = e.word; group.answer = e.raw; }
  });
  return Array.from(groups.values());
});
const activeGroups = computed(() => allGroups.value
  .filter((g) => !excludedKeys.has(g.key))
  .sort((a, b) => b.word.length - a.word.length || a.entries[0].seq - b.entries[0].seq));
const excludedGroups = computed(() => allGroups.value.filter((g) => excludedKeys.has(g.key)));
const showExcluded = ref(false);
// عرض مباشر على الشاشة: عدد الكلمات الصحيحة (بالحروف) بدون ما تنكشف الكلمات نفسها
const liveValidCount = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return gamePhase.value === 'collecting' ? validKeysSeen.size : 0;
});
// الفرز: الكلمات اللي مب بالقاموس فوق (تحتاج مراجعة)، والمعروفة تحت
const reviewGroups = computed(() => {
  dictVersion.value; // eslint-disable-line no-unused-expressions
  return activeGroups.value.filter((g) => !inDictionary(g.key));
});
const dictGroups = computed(() => {
  dictVersion.value; // eslint-disable-line no-unused-expressions
  return activeGroups.value.filter((g) => inDictionary(g.key));
});
const sortingSections = computed(() => [
  { key: 'review', title: `❓ تحتاج مراجعة — مب بالقاموس (${reviewGroups.value.length})`, groups: reviewGroups.value },
  { key: 'dict', title: `📖 موجودة بالقاموس (${dictGroups.value.length})`, groups: dictGroups.value },
]);
function excludeAllUnknown() {
  if (gamePhase.value !== 'sorting') return;
  reviewGroups.value.forEach((g) => excludedKeys.add(g.key));
  answersVersion.value++;
}
function isGoldenGroup(group) { return !!goldenWord.value && group.key === goldenWord.value.key; }
const livePlayersCount = computed(() => {
  answersVersion.value; // eslint-disable-line no-unused-expressions
  return new Set(roundEntries.map((e) => e.name)).size;
});

function usesAllLetters(word) {
  const used = new Set(Array.from(word.replace(/ة/g, 'ه')));
  return roundLetters.value.every((l) => used.has(l));
}

function excludeGroup(key) {
  if (gamePhase.value !== 'sorting') return;
  excludedKeys.add(key);
  answersVersion.value++;
}
function restoreGroup(key) {
  if (gamePhase.value !== 'sorting' || lockedKeys.has(key)) return;
  excludedKeys.delete(key);
  autoExcludedReasons.delete(key);
  answersVersion.value++;
}
// المرفوضة = اللي استبعدها المستضيف بنفسه (مب الاستبعاد التلقائي بالحروف أو الطول) — هذي بس عليها خصم
function isRejectedByHost(group) { return excludedKeys.has(group.key) && !autoExcludedReasons.has(group.key); }
const rejectedGroups = computed(() => excludedGroups.value.filter(isRejectedByHost));

const hidePlayerNames = ref(false);

// مكافآت الذهبيات تنعطى لكل من كتب الكلمة (الأول والبقية): الحرف الذهبي + الكلمة الذهبية
function goldenBonusOf(group) {
  let pts = 0;
  if (hasGoldenLetter(group.word)) pts += getGoldenLetterBonus();
  if (isGoldenGroup(group)) pts += getGoldenWordBonus();
  return pts;
}
// نقاط أول من كتب الكلمة: الأساسية + الذهبيات (× المضاعف)
function firstPointsOf(group) {
  return (getFirstPoints() + goldenBonusOf(group)) * roundMultiplier.value;
}
// نقاط البقية: الأساسية + الذهبيات (× المضاعف)
function otherPointsOf(group) {
  return (getOtherPoints() + goldenBonusOf(group)) * roundMultiplier.value;
}
function cardPoints(group) {
  const first = firstPointsOf(group);
  const others = group.entries.length - 1;
  return others > 0 ? `🥇 +${first} · البقية +${otherPointsOf(group)} (${others})` : `🥇 +${first}`;
}

// إحصائيات الجولة: تنعرض بنافذة بعد الاعتماد (للجمهور)
const roundStats = ref(null);
function formatSeconds(ms) { return `${(ms / 1000).toFixed(1)} ث`; }

function confirmScoring() {
  if (gamePhase.value !== 'sorting') return;
  const winScore = getWinScore();
  const gains = new Map(); // name -> { points, words, firsts, rejected }
  const newWinners = [];
  const groups = activeGroups.value;
  const gainOf = (name) => {
    if (!gains.has(name)) gains.set(name, { points: 0, words: 0, firsts: 0, rejected: 0 });
    return gains.get(name);
  };

  groups.forEach((group) => {
    const firstPts = firstPointsOf(group);
    const otherPts = otherPointsOf(group);
    group.entries.forEach((entry, i) => {
      const g = gainOf(entry.name);
      g.points += i === 0 ? firstPts : otherPts;
      g.words++;
      if (i === 0) g.firsts++;
    });
  });
  // خصم الكلمات اللي رفضها المستضيف: كل من كتبها ينقص (والنقاط ممكن تنزل تحت الصفر)
  const penalty = getPenalty();
  const rejected = rejectedGroups.value;
  if (penalty > 0) {
    rejected.forEach((group) => group.entries.forEach((entry) => {
      const g = gainOf(entry.name);
      g.points -= penalty;
      g.rejected++;
    }));
  }

  submitUnknownWords(groups);

  // ===== الإحصائيات =====
  const sortedGains = Array.from(gains.entries()).sort((a, b) => b[1].points - a[1].points);
  const scorers = sortedGains.filter(([, g]) => g.words > 0);
  const longest = groups.slice().sort((a, b) => b.key.length - a.key.length || a.entries[0].seq - b.entries[0].seq)[0];
  const firstEntry = groups.map((g) => g.entries[0]).sort((a, b) => a.seq - b.seq)[0];
  const mostWords = Array.from(gains.entries()).sort((a, b) => b[1].words - a[1].words)[0];
  const goldenGroup = groups.find(isGoldenGroup);
  roundStats.value = {
    round: roundNumber.value,
    letters: roundLetters.value.slice(),
    goldenLetter: goldenLetter.value,
    totalSent: roundEntries.length,
    accepted: groups.length,
    rejected: penalty > 0 ? rejected.length : 0,
    players: scorers.length,
    longest: longest ? { word: longest.answer, name: longest.entries[0].name } : null,
    fastest: firstEntry ? { word: firstEntry.raw, name: firstEntry.name, time: formatSeconds(firstEntry.ms) } : null,
    mostWords: mostWords ? { name: mostWords[0], count: mostWords[1].words } : null,
    goldenWord: goldenWord.value?.display || '',
    goldenFinder: goldenGroup ? goldenGroup.entries[0].name : '',
    goldenLetterWords: groups.filter((g) => hasGoldenLetter(g.word)).length,
    top: scorers.slice(0, 5).map(([name, g]) => ({ name, ...g })),
    winners: [],
  };

  gains.forEach((g, name) => {
    const player = getOrCreatePlayer(name);
    const wasWinner = player.score >= winScore;
    player.score += g.points;
    if (!wasWinner && player.score >= winScore) newWinners.push(name);
  });

  const logs = [];
  if (sortedGains.length === 0) {
    logs.push('<div class="log-item" style="color:#8b93a3;">ما فيه أي كلمة معتمدة بهذي الجولة.</div>');
  } else {
    logs.push(`<div class="log-item" style="text-align:center;">✅ ${groups.length} كلمة معتمدة من الحروف ( ${roundLetters.value.join(' ')} )${penalty > 0 && rejected.length > 0 ? ` — ❌ ${rejected.length} مرفوضة (-${penalty} لكل من كتبها)` : ''}</div>`);
    sortedGains.forEach(([name, g]) => {
      const sign = g.points >= 0 ? '+' : '';
      const details = [
        g.words > 0 ? `${g.words} كلمة` : '',
        g.firsts > 0 ? `🥇 أول من كتب ${g.firsts}` : '',
        g.rejected > 0 ? `❌ ${g.rejected} مرفوضة` : '',
      ].filter(Boolean).join(' · ');
      logs.push(`<div class="log-item ${g.firsts > 0 ? 'log-star' : 'log-hit'}"><b>${nameHtml(name)}</b> ${sign}${g.points} نقطة — ${details}</div>`);
    });
  }
  if (goldenWord.value) {
    logs.push(`<div class="log-item log-star">🏅 الكلمة الذهبية: <b>${escapeHtml(goldenWord.value.display)}</b> — ${goldenGroup ? `لقاها ${nameHtml(goldenGroup.entries[0].name)}` : 'ما أحد لقاها'}</div>`);
  }

  if (newWinners.length > 0) {
    const topWinners = topScorerNames(newWinners.map((n) => getOrCreatePlayer(n)));
    topWinners.forEach((n) => gameWinnerNames.add(n));
    gameOver.value = true;
    roundStats.value.winners = topWinners;
    logs.push(`<div style="text-align:center; font-size:16px; color:#f39c12; background:#1e1e2f; padding:12px; border-radius:10px; margin-top:6px;">🏆 تجاوز نقاط الفوز (${winScore}) وفاز: <b>${topWinners.map((n) => nameHtml(n)).join('، ')}</b> 🏆</div>`);
  }

  logs.forEach((l) => appendLog(l));
  gamePhase.value = 'idle';
  clearRound();
}
function closeStats() { roundStats.value = null; }

function resetGame() {
  resetSettingsConfirm();
  if (collectingCountdown) { clearInterval(collectingCountdown); collectingCountdown = null; }
  playersScores.clear();
  gameWinnerNames.clear();
  gameOver.value = false;
  hasGameStarted.value = false;
  gamePhase.value = 'idle';
  roundNumber.value = 0;
  roundLetters.value = [];
  goldenWord.value = null;
  goldenLetter.value = '';
  roundStats.value = null;
  clearRound();
  eventLog.value = [];
  doubleNextRound.value = false;
  roundMultiplier.value = 1;
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 80) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const stageTimerText = computed(() => {
  if (gamePhase.value === 'collecting') return String(timeLeft.value);
  if (gamePhase.value === 'sorting') return '🗂️';
  return '--';
});
const stageTimerUrgent = computed(() => gamePhase.value === 'collecting' && timeLeft.value <= 5);
const stageStatusText = computed(() => {
  if (gamePhase.value === 'idle') return 'جاهز لبدء جولة جديدة';
  if (gamePhase.value === 'collecting') {
    const prefix = getAnswerPrefix();
    return prefix
      ? `✍️ اكتب كلمة وحدة بكل تعليق تبدأ بـ "${prefix}" — من هالحروف بس (الحرف يتكرر عادي)`
      : '✍️ اكتب كلمة وحدة بكل تعليق — من هالحروف بس (الحرف يتكرر عادي)';
  }
  return 'المستضيف يفرز الكلمات الآن...';
});

const leaderboardSorted = computed(() => Array.from(playersScores.values()).sort((a, b) => b.score - a.score));
const MEDALS = ['🥇', '🥈', '🥉'];
function rankFor(i) { return MEDALS[i] || `${i + 1}.`; }
const gameWinnerNames = reactive(new Set());
const gameOver = ref(false);
function blockIfGameOver() {
  if (!gameOver.value) return false;
  openModal('🏆 انتهت اللعبة', ['<div class="log-item" style="text-align:center;">🏆 انتهت اللعبة بفوز لاعب — اضغط "🔄 إعادة اللعبة بالكامل" للبدء من جديد.</div>']);
  return true;
}

const manualPanelVisible = computed(() => gamePhase.value === 'collecting');
const sortingPanelVisible = computed(() => gamePhase.value === 'sorting');
const startBtnVisible = computed(() => gamePhase.value === 'idle');
const collectingBtnsVisible = computed(() => gamePhase.value === 'collecting');
const confirmBtnVisible = computed(() => gamePhase.value === 'sorting');

const barExpanded = useFloatingBar();
function goHome() { router.push('/'); }

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);

function handleTiktokMessage(data) {
  // "خروج" بالدردشة: اللاعب ينحذف (كلماته بالجولة ونقاطه)
  if (data.user && isLeaveComment(data.comment)) {
    const before = roundEntries.length;
    for (let i = roundEntries.length - 1; i >= 0; i--) {
      if (roundEntries[i].name === data.user) roundEntries.splice(i, 1);
    }
    Array.from(playerWordKeys).forEach((k) => { if (k.startsWith(`${data.user}|`)) playerWordKeys.delete(k); });
    if (roundEntries.length !== before) answersVersion.value++;
    playersScores.delete(data.user);
    return;
  }
  if (data.comment && data.user) registerComment(data.user, data.comment);
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'word-builder', onMessage: handleTiktokMessage });
}

// أول ضغطة على بدء الجولة تفتح الإعدادات (المستوى والنقاط)، وزرها يحفظ ويبدأ
const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(() => startRound());
// تفعيل/إلغاء عدد حروف (لازم يبقى عدد واحد على الأقل)
function toggleCount(count) {
  if (roundControlsDisabled.value) return;
  const has = selectedCounts.value.includes(count);
  if (has && selectedCounts.value.length === 1) return;
  selectedCounts.value = has ? selectedCounts.value.filter((c) => c !== count) : [...selectedCounts.value, count];
}
function requestStartRound() {
  if (gamePhase.value !== 'idle') return;
  requestStart();
}

function handleGlobalKeydown(e) {
  if (e.code !== 'Space') return;
  const el = document.activeElement;
  if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
  e.preventDefault();
  if (settingsVisible.value || showModal_.value) return;
  if (roundStats.value) { closeStats(); return; }
  if (startBtnVisible.value) requestStartRound();
  else if (collectingBtnsVisible.value) endCollecting();
  else if (confirmBtnVisible.value) confirmScoring();
}

onMounted(() => {
  loadApprovedWords();
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
  <h1>🔠 كوّن كلمة</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة بالكامل</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" start-label="🚀 حفظ وبدء الجولة" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group basics">
      <div class="adv-group-title">🔤 عدد حروف الجولة — اختر واحد أو أكثر، وكل جولة تاخذ واحد منها عشوائياً</div>
      <div class="level-row">
        <button
          v-for="count in LETTER_COUNTS"
          :key="count"
          type="button"
          class="level-btn"
          :class="{ active: selectedCounts.includes(count) }"
          :disabled="roundControlsDisabled"
          @click="toggleCount(count)"
        >
          <b>{{ count }} حروف</b>
        </button>
      </div>
    </div>

    <div class="adv-group basics">
      <div class="adv-group-title">⏱️ نوع الجولة</div>
      <div class="level-row">
        <button type="button" class="level-btn" :class="{ active: roundMode === 'normal' }" :disabled="roundControlsDisabled" @click="roundMode = 'normal'">
          <b>⏱️ عادية</b>
          <small>وقت ثابت</small>
        </button>
        <button type="button" class="level-btn" :class="{ active: roundMode === 'extended' }" :disabled="roundControlsDisabled" @click="roundMode = 'extended'">
          <b>⏳ الجولة الممتدة</b>
          <small>كل كلمة جديدة تمدد الوقت</small>
        </button>
      </div>
      <div class="adv-columns">
        <label v-if="roundMode === 'normal'" class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>⏱️ <b>مدة الجولة</b> — بالثواني.</span>
          <input v-model="roundDurationInput" type="number" min="25" max="300" :disabled="roundControlsDisabled">
        </label>
        <template v-else>
          <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
            <span>⏳ <b>وقت البداية</b> — بالثواني.</span>
            <input v-model="extendedBaseInput" type="number" min="25" max="300" :disabled="roundControlsDisabled" @change="clampExtendedBase">
          </label>
          <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
            <span>➕ <b>التمديد لكل كلمة جديدة</b> — ثواني تنضاف أول ما تنكتب كلمة صحيحة موجودة بالقاموس وما انكتبت قبل.</span>
            <input v-model="extendedAddInput" type="number" min="1" max="30" :disabled="roundControlsDisabled" @change="clampExtendedAdd">
          </label>
        </template>
      </div>
    </div>

    <div class="adv-group basics">
      <div class="adv-group-title">🧩 الخصائص — فعّل أو اطفي أي وحدة</div>
      <div class="adv-columns">
        <div class="adv-item" :class="{ checked: goldenWordEnabled, disabled: roundControlsDisabled }">
          <label class="adv-item-label">
            <input v-model="goldenWordEnabled" type="checkbox" :disabled="roundControlsDisabled">
            <span>🏅 <b>الكلمة الذهبية</b> — كلمة مختارة من الحروف، وكل من يكتبها ياخذ هالنقاط زيادة.</span>
          </label>
          <input v-model="goldenWordBonusInput" type="number" min="0" max="50" :disabled="roundControlsDisabled || !goldenWordEnabled" @change="clampGoldenWordBonus">
        </div>
        <div class="adv-item" :class="{ checked: goldenLetterEnabled, disabled: roundControlsDisabled }">
          <label class="adv-item-label">
            <input v-model="goldenLetterEnabled" type="checkbox" :disabled="roundControlsDisabled">
            <span>✨ <b>الحرف الذهبي</b> — كل من يكتب كلمة فيها الحرف الذهبي ياخذ هالنقاط زيادة.</span>
          </label>
          <input v-model="goldenLetterBonusInput" type="number" min="0" max="20" :disabled="roundControlsDisabled || !goldenLetterEnabled" @change="clampGoldenLetterBonus">
        </div>
        <div class="adv-item" :class="{ checked: penaltyEnabled, disabled: roundControlsDisabled }">
          <label class="adv-item-label">
            <input v-model="penaltyEnabled" type="checkbox" :disabled="roundControlsDisabled">
            <span>➖ <b>خصم الكلمات المرفوضة</b> — الكلمة اللي تستبعدها بالفرز تنقص هالنقاط من كل من كتبها، عشان توقف الكلمات العشوائية.</span>
          </label>
          <input v-model="penaltyInput" type="number" min="0" max="10" :disabled="roundControlsDisabled || !penaltyEnabled" @change="clampPenalty">
        </div>
      </div>
    </div>

    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>
      <div class="adv-columns">
        <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>🥇 <b>نقاط أول من يكتب الكلمة</b></span>
          <input v-model="firstPointsInput" type="number" min="1" max="20" :disabled="roundControlsDisabled" @change="clampFirstPoints">
        </label>
        <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>👥 <b>نقاط البقية</b> — لكل واحد كتب نفس الكلمة بعد الأول.</span>
          <input v-model="otherPointsInput" type="number" min="0" max="20" :disabled="roundControlsDisabled" @change="clampOtherPoints">
        </label>
        <label class="adv-item" :class="{ disabled: roundControlsDisabled }">
          <span>📏 <b>أقل طول للكلمة</b> — الأقصر تنستبعد تلقائياً.</span>
          <input v-model="minLengthInput" type="number" min="2" max="8" :disabled="roundControlsDisabled" @change="clampMinLength">
        </label>
        <label class="adv-item" :class="{ disabled: gameSettingsLocked }">
          <span>🏆 <b>نقاط الفوز</b> — تنقفل بعد أول جولة.</span>
          <input v-model="winScoreInput" type="number" min="20" :disabled="gameSettingsLocked" @change="clampWinScore">
        </label>
        <label class="adv-item" :class="{ disabled: gameSettingsLocked }">
          <span>🔑 <b>مفتاح الإجابة (اختياري)</b> — لو كتبته، التعليق اللي ما يبدأ فيه يتجاهل. فاضي = كل التعليقات.</span>
          <input v-model="answerPrefixInput" type="text" maxlength="5" placeholder="بدون" :disabled="gameSettingsLocked">
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
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" @click="requestStartRound">🚀 بدء الجولة</button>
    <input v-if="collectingBtnsVisible" v-model="extendSecondsInput" type="number" min="5" max="600" style="width:70px; flex:none;" title="مقدار التمديد بالثواني">
    <button v-if="collectingBtnsVisible" class="master-btn side-panel-btn" style="background:#8e44ad;" @click="extendRound">⏱️ تمديد</button>
    <button v-if="collectingBtnsVisible" class="master-btn side-panel-btn" style="background:#3498db;" @click="endCollecting">⏹️ إنهاء الجمع الآن</button>
    <button v-if="confirmBtnVisible" class="master-btn side-panel-btn" @click="confirmScoring">✅ اعتماد وتوزيع النقاط</button>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>{{ gamePhase === 'idle' ? '🔤 حروف الجولة' : '🎥 شاشة العرض للجمهور' }}</h2>
      <div class="stage-switch">
        <div class="stage-view" :class="{ 'is-hidden': gamePhase !== 'idle' }">
          <!-- الحروف ما تنكشف قبل بداية الجولة: تنختار عشوائياً أول ما تبدأ -->
          <div class="letter-tiles empty">
            <span class="field-hint">الحروف تطلع مع بداية الجولة</span>
          </div>
          <div class="field-hint">أعداد الحروف المختارة: {{ selectedCountsText }} — تتغير من ⚙️ الإعدادات</div>
          <button
            class="double-toggle-btn"
            :class="{ active: doubleNextRound }"
            :disabled="roundControlsDisabled"
            @click="doubleNextRound = !doubleNextRound"
          >{{ doubleNextRound ? '🔥 الجولة الجاية مضاعفة ×2 (اضغط للإلغاء)' : '🔥 جولة مضاعفة ×2' }}</button>
        </div>
        <div class="stage-view stage-live" :class="{ 'is-hidden': gamePhase === 'idle' }">
          <div v-if="gamePhase !== 'idle' && roundMultiplier > 1" class="stage-double">🔥 جولة مضاعفة — النقاط ×2</div>
          <div class="letter-tiles">
            <span v-for="(l, i) in roundLetters" :key="`${i}-${l}`" class="letter-tile big" :class="{ golden: l === goldenLetter }">{{ l }}</span>
          </div>
          <div v-if="goldenLetter || goldenWord" class="golden-row">
            <span v-if="goldenLetter" class="golden-chip">✨ الحرف الذهبي "{{ goldenLetter }}" +{{ getGoldenLetterBonus() * roundMultiplier }}</span>
            <span v-if="goldenWord" class="golden-chip">🏅 كلمة ذهبية من {{ goldenWord.key.length }} حروف +{{ getGoldenWordBonus() * roundMultiplier }}</span>
          </div>
          <div v-if="goldenFinder && gamePhase === 'collecting'" class="golden-found">🏅 انلقت الكلمة الذهبية! لقاها <bdi>{{ displayName(goldenFinder) }}</bdi></div>
          <div class="stage-timer" :class="{ urgent: stageTimerUrgent }">{{ stageTimerText }}</div>
          <div v-if="gamePhase === 'collecting' && isExtendedRound" class="stage-extended">⏳ جولة ممتدة — كل كلمة جديدة +{{ getExtendedAdd() }} ثواني</div>
          <div v-if="gamePhase === 'collecting'" class="stage-counts">
            <span>📝 {{ liveValidCount }} كلمة</span>
            <span>👥 {{ livePlayersCount }} مشارك</span>
          </div>
          <div class="stage-status">{{ stageStatusText }}</div>
          <div class="stage-rule">🥇 أول من يكتب الكلمة +{{ getFirstPoints() * roundMultiplier }} · البقية +{{ getOtherPoints() * roundMultiplier }}</div>
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
      <h3>✍️ إضافة كلمة يدوياً (اختبار بدون تيك توك)</h3>
      <div class="manual-add-row">
        <input v-model="manualNameInput" type="text" placeholder="اسم اللاعب">
        <input v-model="manualAnswerInput" type="text" placeholder="الكلمة" @keydown.enter.prevent="manualAddAnswer">
        <button class="master-btn" @click="manualAddAnswer">إضافة</button>
      </div>
    </div>

    <div v-if="sortingPanelVisible" class="sorting-overlay">
      <div class="panel sorting-panel">
        <h3>🗂️ فرز الكلمات</h3>
        <div class="letter-tiles small">
          <span v-for="(l, i) in roundLetters" :key="`${i}-${l}`" class="letter-tile" :class="{ golden: l === goldenLetter }">{{ l }}</span>
          <span v-if="roundMultiplier > 1" class="sorting-double">🔥 ×2</span>
        </div>
        <div v-if="goldenWord || goldenLetter" class="field-hint golden-hint">
          <span v-if="goldenWord">🏅 الكلمة الذهبية: <b>{{ goldenWord.display }}</b></span>
          <span v-if="goldenWord && goldenLetter"> · </span>
          <span v-if="goldenLetter">✨ الحرف الذهبي: <b>{{ goldenLetter }}</b></span>
        </div>
        <label class="hide-names-toggle">
          <input v-model="hidePlayerNames" type="checkbox">
          🙈 إخفاء أسماء اللاعبين
        </label>
        <div class="field-hint" style="text-align:center; margin-bottom:10px;">
          الكلمات اللي فيها حرف مب من حروف الجولة استُبعدت تلقائياً وما تنسترجع. راجع الكلمات اللي مب بالقاموس واستبعد اللي ما لها معنى.
          <template v-if="getPenalty() > 0"><br>➖ الكلمة اللي تستبعدها بنفسك تنقص {{ getPenalty() }} من كل من كتبها.</template>
        </div>
        <div v-if="activeGroups.length === 0" class="field-hint">ما فيه أي كلمة صحيحة وصلت هذي الجولة</div>
        <template v-for="section in sortingSections" :key="section.key">
          <div v-if="section.groups.length > 0" class="section-head" :class="section.key">
            <span>{{ section.title }}</span>
            <button v-if="section.key === 'review'" type="button" class="section-btn" @click="excludeAllUnknown">❌ استبعاد الكل</button>
          </div>
          <div v-if="section.groups.length > 0" class="answer-cards-grid">
            <div
              v-for="g in section.groups"
              :key="g.key"
              class="answer-card"
              :class="{ 'is-full': usesAllLetters(g.word), 'is-golden': isGoldenGroup(g), 'is-review': section.key === 'review' }"
            >
              <div class="answer-badge">{{ cardPoints(g) }}</div>
              <div class="answer-text">{{ g.answer }}</div>
              <div v-if="isGoldenGroup(g)" class="answer-full">🏅 الكلمة الذهبية</div>
              <div v-else-if="usesAllLetters(g.word)" class="answer-full">🌟 استخدمت كل الحروف</div>
              <div v-if="hasGoldenLetter(g.word)" class="answer-gold-letter">✨ فيها الحرف الذهبي</div>
              <div v-if="!hidePlayerNames" class="answer-meta">
                <span class="first-name">🥇 {{ nameText(g.entries[0].name) }}</span>
                <template v-if="g.entries.length > 1">، {{ g.entries.slice(1).map((e) => nameText(e.name)).join('، ') }}</template>
              </div>
              <div class="card-actions">
                <button class="card-btn remove-btn" @click="excludeGroup(g.key)">❌ استبعاد</button>
              </div>
            </div>
          </div>
        </template>
        <div v-if="excludedGroups.length > 0" class="excluded-wrap">
          <button type="button" class="excluded-toggle" @click="showExcluded = !showExcluded">
            🗑️ كلمات مستبعدة ({{ excludedGroups.length }}) {{ showExcluded ? '▲' : '▼' }}
          </button>
          <div v-if="showExcluded" class="answer-cards-grid">
            <div v-for="g in excludedGroups" :key="g.key" class="answer-card is-excluded">
              <div class="answer-text">{{ g.answer }}</div>
              <div v-if="autoExcludedReasons.has(g.key)" class="answer-reason">🔤 {{ autoExcludedReasons.get(g.key) }}</div>
              <div v-else-if="getPenalty() > 0" class="answer-reason">➖ مرفوضة: -{{ getPenalty() }} لكل من كتبها</div>
              <div v-if="!hidePlayerNames" class="answer-meta">{{ g.entries.map((e) => nameText(e.name)).join('، ') }}</div>
              <div class="card-actions">
                <button v-if="!lockedKeys.has(g.key)" class="card-btn restore-btn" @click="restoreGroup(g.key)">↩️ استرجاع</button>
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

  <!-- إحصائيات الجولة: تطلع بعد الاعتماد، والمسافة أو الزر يقفلها -->
  <div v-if="roundStats" class="stats-overlay" @click.self="closeStats">
    <div class="stats-box">
      <h2>📊 إحصائيات الجولة {{ roundStats.round }}</h2>
      <div class="letter-tiles small">
        <span v-for="(l, i) in roundStats.letters" :key="`${i}-${l}`" class="letter-tile" :class="{ golden: l === roundStats.goldenLetter }">{{ l }}</span>
      </div>
      <div v-if="roundStats.winners.length > 0" class="stats-winner">🏆 فاز باللعبة: <bdi>{{ roundStats.winners.map(displayName).join('، ') }}</bdi> 🏆</div>
      <div class="stats-numbers">
        <div><b>{{ roundStats.accepted }}</b><span>كلمة معتمدة</span></div>
        <div><b>{{ roundStats.totalSent }}</b><span>كلمة وصلت</span></div>
        <div><b>{{ roundStats.players }}</b><span>لاعب سجّل نقاط</span></div>
        <div v-if="roundStats.goldenLetter"><b>{{ roundStats.goldenLetterWords }}</b><span>كلمة بالحرف الذهبي</span></div>
        <div v-if="roundStats.rejected > 0"><b class="stats-bad">{{ roundStats.rejected }}</b><span>كلمة مرفوضة</span></div>
      </div>
      <div class="stats-cards">
        <div v-if="roundStats.goldenWord" class="stats-card gold">
          <span class="stats-label">🏅 الكلمة الذهبية</span>
          <b>{{ roundStats.goldenWord || '—' }}</b>
          <small>{{ roundStats.goldenFinder ? `لقاها ${displayName(roundStats.goldenFinder)}` : 'ما أحد لقاها' }}</small>
        </div>
        <div v-if="roundStats.longest" class="stats-card">
          <span class="stats-label">📏 أطول كلمة</span>
          <b>{{ roundStats.longest.word }}</b>
          <small>{{ displayName(roundStats.longest.name) }}</small>
        </div>
        <div v-if="roundStats.fastest" class="stats-card">
          <span class="stats-label">⚡ أسرع كلمة</span>
          <b>{{ roundStats.fastest.word }}</b>
          <small>{{ displayName(roundStats.fastest.name) }} · {{ roundStats.fastest.time }}</small>
        </div>
        <div v-if="roundStats.mostWords" class="stats-card">
          <span class="stats-label">📝 أكثر كلمات</span>
          <b>{{ roundStats.mostWords.count }} كلمة</b>
          <small>{{ displayName(roundStats.mostWords.name) }}</small>
        </div>
      </div>
      <div v-if="roundStats.top.length > 0" class="stats-top">
        <div class="stats-top-title">🔝 أعلى نقاط هالجولة</div>
        <div v-for="(p, i) in roundStats.top" :key="p.name" class="stats-top-row">
          <span><span class="lb-rank">{{ rankFor(i) }}</span><bdi>{{ displayName(p.name) }}</bdi></span>
          <span>+{{ p.points }} · {{ p.words }} كلمة</span>
        </div>
      </div>
      <div v-else class="field-hint" style="text-align:center;">ما فيه أي كلمة معتمدة بهذي الجولة</div>
      <button class="master-btn stats-close" @click="closeStats">متابعة</button>
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
:global(body) { padding: 10px; padding-bottom: 30px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 15px; text-align: center; }

.field-hint { font-size: 0.75rem; color: #8b93a3; margin-top: 4px; }

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
input:disabled, button:disabled { opacity: 0.5; cursor: not-allowed; }
input:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }

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

/* أزرار المستوى بنافذة الإعدادات */
.level-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px 12px; }
.level-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.3);
  color: white;
  font-family: inherit;
  cursor: pointer;
}
.level-btn small { color: #bdc3c7; font-size: 0.78rem; }
.level-btn.active { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.2); box-shadow: 0 0 10px var(--border-glow); }

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

/* بلاطات الحروف */
.letter-tiles {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 8px;
  margin-bottom: 12px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 14px;
  direction: rtl;
}
.letter-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 12px;
  background: linear-gradient(160deg, #fdf3dc, #f5c16c);
  color: #1e1e2f;
  font-size: 1.9rem;
  font-weight: bold;
  box-shadow: 0 4px 0 #b9832f, 0 6px 14px rgba(0, 0, 0, 0.45);
}
.letter-tile.big { width: clamp(52px, 11vw, 84px); height: clamp(52px, 11vw, 84px); font-size: clamp(1.9rem, 5.5vw, 3rem); }
.letter-tiles.small { padding: 8px; gap: 6px; margin-bottom: 8px; }
.letter-tiles.small .letter-tile { width: 40px; height: 40px; font-size: 1.4rem; }
.sorting-double { font-weight: bold; color: #f39c12; margin-inline-start: 8px; }

/* الحرف الذهبي */
.letter-tile.golden {
  background: linear-gradient(160deg, #fff4b0, #f1c40f 55%, #d4a017);
  box-shadow: 0 4px 0 #9a7209, 0 0 18px rgba(241, 196, 15, 0.85);
  outline: 2px solid #fff3b0;
}
.golden-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 8px; }
.golden-chip {
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(241, 196, 15, 0.15);
  border: 1px solid rgba(241, 196, 15, 0.6);
  color: #ffe08a;
  font-weight: bold;
  font-size: 0.9rem;
}
.golden-found {
  text-align: center;
  font-weight: bold;
  color: #1e1e2f;
  background: linear-gradient(90deg, #f1c40f, #f39c12);
  border-radius: 10px;
  padding: 6px 10px;
  margin-bottom: 8px;
}
.golden-hint { text-align: center; margin: 0 0 8px; font-size: 0.85rem; color: #ffe08a; }
.stage-extended { text-align: center; color: #bb8fce; font-weight: bold; margin-bottom: 6px; }

/* أقسام الفرز: تحتاج مراجعة / بالقاموس */
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 14px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  font-weight: bold;
}
.section-head.review { color: #f5b041; }
.section-head.dict { color: #58d68d; }
.section-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 8px;
  background: #8A1538;
  color: white;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: bold;
  cursor: pointer;
}
.answer-card.is-review { border-color: rgba(245, 176, 65, 0.6); }
.answer-card.is-golden { border-color: #f1c40f; box-shadow: 0 0 14px rgba(241, 196, 15, 0.7); }
.answer-card .answer-gold-letter { font-size: 0.75rem; color: #ffe08a; margin-bottom: 4px; }

/* إحصائيات الجولة */
.stats-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 110;
  padding: 15px;
}
.stats-box {
  width: 100%;
  max-width: 560px;
  max-height: 92vh;
  overflow-y: auto;
  background: #2a2a40;
  border: 1px solid var(--primary-color);
  border-radius: 16px;
  padding: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
}
.stats-box h2 { text-align: center; color: var(--primary-color); margin: 0 0 10px; font-size: 1.3rem; }
.stats-winner { text-align: center; font-weight: bold; color: #1e1e2f; background: #f39c12; border-radius: 10px; padding: 8px; margin-bottom: 10px; }
.stats-numbers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
.stats-numbers div { display: flex; flex-direction: column; align-items: center; background: #1e1e2f; border-radius: 10px; padding: 8px 4px; text-align: center; }
.stats-numbers b { font-size: 1.5rem; color: #2ecc71; }
.stats-numbers span { font-size: 0.72rem; color: #bdc3c7; }
.stats-numbers b.stats-bad { color: #ff6b6b; }
.stats-numbers { grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); }
.stats-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 10px; }
.stats-card { display: flex; flex-direction: column; align-items: center; gap: 2px; background: #1e1e2f; border-radius: 10px; padding: 10px 6px; text-align: center; word-break: break-word; }
.stats-card.gold { border: 1px solid #f1c40f; box-shadow: 0 0 10px rgba(241, 196, 15, 0.4); }
.stats-card .stats-label { font-size: 0.78rem; color: #bdc3c7; }
.stats-card b { font-size: 1.25rem; color: #fff; }
.stats-card.gold b { color: #f1c40f; }
.stats-card small { font-size: 0.78rem; color: #f5c16c; }
.stats-top { background: #1e1e2f; border-radius: 10px; padding: 10px; }
.stats-top-title { font-weight: bold; color: var(--primary-color); text-align: center; margin-bottom: 6px; }
.stats-top-row { display: flex; justify-content: space-between; padding: 5px 4px; border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 0.92rem; }
.stats-top-row .lb-rank { font-weight: bold; color: var(--primary-color); margin-left: 8px; }
.stats-close { width: 100%; margin-top: 12px; padding: 12px; }
@media (max-width: 480px) {
  .stats-numbers { grid-template-columns: repeat(2, 1fr); }
}

.letter-tiles.empty { min-height: 82px; border: 2px dashed rgba(255, 255, 255, 0.15); }
.letter-tiles.empty .field-hint { margin: 0; font-size: 0.9rem; }

.stage-timer {
  font-size: 42px;
  font-weight: bold;
  text-align: center;
  color: #ffa502;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
  margin-bottom: 6px;
}
.stage-timer.urgent { color: #ff4757; }
.stage-counts { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; font-weight: bold; color: #2ecc71; margin-bottom: 6px; }
.stage-status { text-align: center; color: #ccd6e0; font-size: 0.92rem; min-height: 1.3em; }
.stage-rule { text-align: center; color: #f5c16c; font-size: 0.85rem; margin-top: 6px; }

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

.stage-switch { display: grid; width: 100%; }
.stage-view { grid-area: 1 / 1; min-width: 0; }
.stage-view.is-hidden { visibility: hidden; pointer-events: none; }
.stage-live { display: flex; flex-direction: column; justify-content: center; }

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
.hide-names-toggle { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 0.9rem; cursor: pointer; }
.hide-names-toggle input { width: auto; flex: none; }

.answer-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
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
}
.answer-card.is-full { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }
.answer-card.is-excluded { opacity: 0.6; }
.answer-card .answer-text { font-size: 1.35rem; font-weight: bold; margin: 6px 0 4px; word-break: break-word; }
.answer-card .answer-full { font-size: 0.78rem; color: #f5c16c; margin-bottom: 4px; }
.answer-card .answer-reason { font-size: 0.75rem; color: #ff8a8a; margin-bottom: 4px; }
.answer-card .answer-meta { font-size: 0.78rem; color: #bdc3c7; word-break: break-word; max-height: 3.2em; overflow: hidden; }
.answer-card .first-name { color: #f5c16c; font-weight: bold; }
.answer-card .answer-badge {
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: 10px;
  background: rgba(243, 156, 18, 0.25);
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
.answer-card .restore-btn { background: #27ae60; }

.excluded-wrap { width: 100%; margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(255,255,255,0.15); }
.excluded-toggle {
  display: block;
  width: 100%;
  margin-bottom: 10px;
  padding: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  background: rgba(0,0,0,0.25);
  color: #ccd6e0;
  font-family: inherit;
  font-weight: bold;
  cursor: pointer;
}
.sorting-confirm-btn { width: 100%; margin-top: 18px; padding: 14px; font-size: 1.15rem; }

.event-log-panel { width: 100%; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
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
.modal-logs :deep(.log-hit) { border-right: 4px solid var(--success-color); }
.modal-logs :deep(.log-star) { border-right: 4px solid var(--primary-color); }
</style>
