<script setup>
import {
  ref, reactive, computed, nextTick, onMounted, onUnmounted,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();

// نسبة الخارجين كل جولة (أقل شي لاعب واحد)، وهدية "تضعيف الخارجين" تضيف نفس العدد مرة ثانية
const ELIM_RATIO = 0.05;
// أقصى عدد أسطر بالدفتر (4 أعمدة × 11 سطر)
const MAX_LINES = 44;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// توحيد الكتابة قبل المقارنة: أ إ آ ← ا، ة ← ه، ى ← ي، حذف التشكيل والتطويل والمسافات الزايدة
function normalizeText(raw) {
  return normalizeDigits(String(raw))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ===== فئة الأرقام: تقبل 3 و ٣ و "ثلاثة" (الكلمات مكتوبة هنا بعد التوحيد) =====
const NUMBER_WORDS = {
  صفر: 0,
  واحد: 1, واحده: 1, احد: 1, احدي: 1,
  اثنين: 2, اثنان: 2, اثنتين: 2, اتنين: 2, ثنين: 2, اثنا: 2, اثني: 2,
  ثلاث: 3, ثلاثه: 3, تلات: 3, تلاته: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
  ست: 6, سته: 6,
  سبع: 7, سبعه: 7,
  ثمان: 8, ثماني: 8, ثمانيه: 8, ثمنيه: 8, تمنيه: 8, تمان: 8,
  تسع: 9, تسعه: 9,
  حدعش: 11, احدعش: 11, اطنعش: 12, اثنعش: 12, ثلطعش: 13, تلتعش: 13, اربعطعش: 14, خمسطعش: 15,
  سطعش: 16, سبعطعش: 17, ثمنطعش: 18, تمنطعش: 18, تسعطعش: 19,
  عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30, تلاتين: 30, اربعين: 40, اربعون: 40,
  خمسين: 50, خمسون: 50, ستين: 60, ستون: 60, سبعين: 70, سبعون: 70,
  ثمانين: 80, ثمانون: 80, تمانين: 80, تسعين: 90, تسعون: 90,
  ميه: 100, مايه: 100, مائه: 100, مئه: 100,
};
const TEN_WORDS = new Set(['عشر', 'عشره']);

function parseArabicNumber(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const tokens = s.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  for (const raw of tokens) {
    let t = raw;
    if (!(t in NUMBER_WORDS) && !TEN_WORDS.has(t) && t.startsWith('و')) t = t.slice(1);
    if (TEN_WORDS.has(t)) total += 10;
    else if (t in NUMBER_WORDS) total += NUMBER_WORDS[t];
    else return null;
  }
  return total;
}

// ===== الفئات =====
const splitWords = (s) => s.split('،').map((w) => w.trim()).filter(Boolean);
const WORD_CATEGORIES = [
  { id: 'colors', title: 'ألوان', words: splitWords('أحمر، أزرق، أخضر، أصفر، أسود، أبيض، بني، رمادي، برتقالي، بنفسجي، وردي، ذهبي، فضي، سماوي، كحلي، زيتي، عنابي، بيج، تركوازي، ليموني، فوشي، نيلي، خمري، قرمزي، نحاسي، فيروزي، موف') },
  { id: 'arab-cities', title: 'مدن عربية', words: splitWords('الرياض، جدة، مكة، المدينة، الدمام، الخبر، الطائف، أبها، تبوك، حائل، بريدة، جازان، نجران، ينبع، القطيف، الأحساء، دبي، الشارقة، العين، عجمان، الفجيرة، الدوحة، الوكرة، المنامة، المحرق، الجهراء، مسقط، صلالة، صحار، نزوى، الزرقاء، إربد، العقبة، بيروت، صيدا، دمشق، حلب، حمص، اللاذقية، بغداد، البصرة، الموصل، أربيل، النجف، كربلاء، القاهرة، الإسكندرية، أسوان، الأقصر، طنطا، المنصورة، بورسعيد، الخرطوم، أم درمان، بورتسودان، صفاقس، سوسة، وهران، قسنطينة، الرباط، الدار البيضاء، مراكش، فاس، طنجة، أغادير، نواكشوط، صنعاء، عدن، تعز، المكلا، القدس، غزة، نابلس، الخليل، رام الله') },
  { id: 'countries', title: 'دول', words: splitWords('السعودية، الإمارات، الكويت، قطر، البحرين، عمان، اليمن، العراق، الأردن، سوريا، لبنان، فلسطين، مصر، السودان، ليبيا، تونس، الجزائر، المغرب، موريتانيا، الصومال، جيبوتي، تركيا، إيران، باكستان، الهند، الصين، اليابان، كوريا، إندونيسيا، ماليزيا، تايلاند، الفلبين، فيتنام، روسيا، أوكرانيا، ألمانيا، فرنسا، إيطاليا، إسبانيا، البرتغال، بريطانيا، هولندا، بلجيكا، سويسرا، النمسا، السويد، النرويج، الدنمارك، فنلندا، بولندا، اليونان، أمريكا، كندا، المكسيك، البرازيل، الأرجنتين، تشيلي، كولومبيا، بيرو، فنزويلا، كوبا، أستراليا، نيوزيلندا، نيجيريا، إثيوبيا، كينيا، غانا، السنغال، أفغانستان، بنغلاديش، سريلانكا، نيبال، أوزبكستان، كازاخستان، أذربيجان، جورجيا، إيرلندا، التشيك، المجر، رومانيا، كرواتيا، صربيا') },
  { id: 'capitals', title: 'عواصم', words: splitWords('الرياض، أبوظبي، الدوحة، المنامة، مسقط، صنعاء، بغداد، عمان، دمشق، بيروت، القدس، القاهرة، الخرطوم، طرابلس، تونس، الجزائر، الرباط، نواكشوط، مقديشو، أنقرة، طهران، إسلام آباد، نيودلهي، بكين، طوكيو، سيول، جاكرتا، كوالالمبور، بانكوك، مانيلا، هانوي، موسكو، كييف، برلين، باريس، روما، مدريد، لشبونة، لندن، أمستردام، بروكسل، برن، فيينا، ستوكهولم، أوسلو، كوبنهاغن، هلسنكي، وارسو، أثينا، واشنطن، أوتاوا، برازيليا، سانتياغو، بوغوتا، ليما، كانبيرا، أبوجا، نيروبي، داكار، كابل، دكا، باكو، دبلن، براغ، بودابست، بوخارست') },
  { id: 'fruits-veg', title: 'فواكه وخضروات', words: splitWords('تفاح، موز، برتقال، عنب، فراولة، مانجو، أناناس، بطيخ، شمام، خوخ، مشمش، كرز، رمان، تين، تمر، كيوي، جوافة، ليمون، يوسفي، أفوكادو، توت، كمثرى، برقوق، بابايا، ليتشي، جوز الهند، طماطم، خيار، جزر، بطاطس، بصل، ثوم، فلفل، خس، ملفوف، قرنبيط، بروكلي، باذنجان، كوسا، بامية، فاصوليا، بازلاء، سبانخ، بقدونس، كزبرة، نعناع، فجل، شمندر، ذرة، يقطين، كرفس، فطر، زنجبيل، لفت، ملوخية') },
  { id: 'dishes', title: 'أكلات', words: splitWords('كبسة، مندي، مظبي، مضغوط، جريش، قرصان، مرقوق، مطازيز، سليق، هريس، مجبوس، برياني، مقلوبة، منسف، كشري، محشي، فتة، شاورما، فلافل، حمص، متبل، تبولة، فتوش، كبة، ورق عنب، مسقعة، بيتزا، برجر، باستا، لازانيا، سوشي، رامن، تاكو، ستيك، سمبوسة، شوربة، فول، شكشوكة، كسكسي، طاجين، مسخن، معكرونة، كباب، كفتة، ناجتس، صيادية، فريكة، مطبق') },
  { id: 'sweets', title: 'حلويات', words: splitWords('كنافة، بسبوسة، قطايف، لقيمات، كيك، بقلاوة، معمول، أم علي، مهلبية، رز بلبن، كريم كراميل، تشيز كيك، دونات، كوكيز، براونيز، تيراميسو، آيسكريم، شوكولاتة، وافل، بان كيك، كريب، تشوروز، ماكرون، سينابون، حلاوة، عصيدة، خبيصة، بلاليط، غريبة، زلابية، عوامة، مشبك، كب كيك، مافن، جيلي، بودينغ، ترلتشة') },
  { id: 'drinks', title: 'مشروبات', words: splitWords('شاي، قهوة، حليب، عصير، ماء، لبن، كرك، موكا، لاتيه، كابتشينو، اسبريسو، ليموناضة، سحلب، تمر هندي، قمر الدين، جلاب، سوبيا، كركديه، عرقسوس، ينسون، بابونج، ميلك شيك، سموذي، موهيتو، كولا، ماتشا، قرفة، متة، فيمتو، شاي أخضر، كاكاو، زنجبيل') },
  { id: 'jobs', title: 'مهن', words: splitWords('طبيب، مهندس، معلم، طيار، شرطي، محامي، ممرض، صيدلي، نجار، حداد، سباك، كهربائي، خباز، طباخ، خياط، حلاق، مزارع، صياد، سائق، مبرمج، مصمم، محاسب، مذيع، صحفي، رسام، مصور، ممثل، مغني، قاضي، جندي، إطفائي، بائع، تاجر، مدير، دهان، ميكانيكي، بناء، حارس، جزار، ضابط، باحث، مترجم، مرشد، مضيف، بحار، كاتب، شاعر') },
  { id: 'sports', title: 'رياضات', words: splitWords('كرة القدم، كرة السلة، كرة الطائرة، كرة اليد، تنس، سباحة، ملاكمة، كاراتيه، تايكوندو، جودو، مصارعة، جمباز، فروسية، رماية، غوص، ركض، دراجات، تزلج، هوكي، بيسبول، غولف، بولينغ، بلياردو، سنوكر، شطرنج، ريشة، تنس الطاولة، رجبي، كريكيت، يوغا، تسلق، تجديف، سهام، بادل، سباق سيارات') },
  { id: 'names', title: 'أسماء أولاد وبنات', words: splitWords('محمد، أحمد، عبدالله، خالد، فهد، سعود، فيصل، سلطان، ناصر، عمر، علي، يوسف، إبراهيم، حمد، راشد، ماجد، سعد، تركي، بندر، نايف، مشعل، عبدالرحمن، زياد، ريان، مازن، حسن، حسين، طارق، وليد، هاني، سامي، ياسر، عادل، منصور، بدر، نواف، ثامر، مهند، أنس، عمار، فاطمة، عائشة، مريم، نورة، سارة، ريم، هند، لطيفة، منيرة، أمل، هيا، دانة، جود، لمى، رهف، شهد، غادة، أسماء، خديجة، زينب، ليلى، سلمى، رنا، دلال، العنود، الجوهرة، وعد، روان، لين، ميار، جنى، تالا، مها، نوف، أروى، بشرى، حصة، شيخة، منى') },
].map((cat) => {
  const seen = new Set();
  const entries = [];
  cat.words.forEach((word) => {
    const key = normalizeText(word);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ word, key });
  });
  return { id: cat.id, title: cat.title, entries };
});
const NUMBERS_CATEGORY = { id: 'numbers', title: 'أرقام', numeric: true };

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let lastCategoryId = null;
let lastRoundKeys = new Set();

function availableEntries(cat, count) {
  if (!cat.numeric) return cat.entries.filter((e) => !lastRoundKeys.has(e.key));
  const max = Math.min(999, Math.max(99, count * 3));
  const out = [];
  for (let n = 1; n <= max; n++) if (!lastRoundKeys.has(String(n))) out.push({ word: String(n), key: String(n) });
  return out;
}

// فئة عشوائية غير فئة الجولة اللي قبل، فيها كلمات تكفي، وبدون كلمات الجولة اللي قبل
function pickCategoryWords(count) {
  const all = [...WORD_CATEGORIES, NUMBERS_CATEGORY];
  const fits = (c) => availableEntries(c, count).length >= count;
  let candidates = all.filter((c) => c.id !== lastCategoryId && fits(c));
  if (candidates.length === 0) candidates = all.filter(fits);
  const category = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : NUMBERS_CATEGORY;
  const entries = shuffle(availableEntries(category, count)).slice(0, count);
  return { category, entries };
}

// ===== اللاعبون =====
const players = reactive([]); // { id, name, avatar, alive, revived, lineIdx, outRound }
let playerIdCounter = 1;
const newPlayerName = ref('');

const alivePlayers = computed(() => players.filter((p) => p.alive));
function findPlayerByName(name) { return players.find((p) => p.name === name); }

function addPlayer(name, avatar = '') {
  if (phase.value !== 'setup' || !name) return false;
  if (findPlayerByName(name)) return false;
  players.push({
    id: playerIdCounter++, name, avatar: avatar || getUserAvatar(name), alive: true, revived: false, lineIdx: null, outRound: null,
  });
  return true;
}
function addPlayerManual() {
  const name = newPlayerName.value.trim();
  if (name && addPlayer(name)) newPlayerName.value = '';
}
function removePlayer(id) {
  if (phase.value !== 'setup') return;
  const idx = players.findIndex((p) => p.id === id);
  if (idx !== -1) players.splice(idx, 1);
}
function clearPlayers() {
  if (phase.value !== 'setup') return;
  players.splice(0, players.length);
}

// ===== حالة اللعبة =====
const phase = ref('setup'); // setup | writing | racing | result | ended
const roundNumber = ref(0);
const revealMode = ref('all'); // all = اليد تكتب والقائمة تطلع مرة وحدة | sequential = الأسطر تطلع بالتوالي
const roundMode = ref('all');
const roundDurationInput = ref(30);
const timeLeft = ref(0);
const timerRunning = ref(false);
let timerInterval = null;
let roundToken = 0;

const currentCategory = ref(null);
const lines = reactive([]); // { idx, word, key, owner: {id,name,avatar}|null, drawn, crossed }
let claimMap = new Map();
const wordsShown = ref(false);
const raceOpen = ref(false);
const writeMs = ref(400);
const roundPlan = reactive({ lines: 0, out: 0 });
const winner = ref(null);
const eventLog = ref([]);

const gameInProgress = computed(() => ['writing', 'racing', 'result'].includes(phase.value));
// عدد الأعمدة حسب عرض الشاشة: عمودين بالجوال، 3 بالمتوسط، 4 بالشاشات الكبيرة
const viewportWidth = ref(window.innerWidth);
function onResize() { viewportWidth.value = window.innerWidth; }
const maxCols = computed(() => {
  if (viewportWidth.value < 640) return 2;
  if (viewportWidth.value < 1000) return 3;
  return 4;
});
const gridCols = computed(() => Math.max(1, Math.min(maxCols.value, lines.length)));
const gridRows = computed(() => Math.max(1, Math.ceil(lines.length / gridCols.value)));

function getRoundDuration() {
  let v = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(v) || v < 5) v = 5;
  if (v > 300) v = 300;
  roundDurationInput.value = v;
  return v;
}

function appendLog(html) {
  eventLog.value.push(html);
  if (eventLog.value.length > 80) eventLog.value.shift();
}
const eventLogReversed = computed(() => eventLog.value.slice().reverse());

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ===== اليد =====
const stageRef = ref(null);
const hand = reactive({ visible: false, x: 0, y: 0, dur: 0 });

function moveHandTo(el, edge, dur) {
  const stage = stageRef.value;
  if (!stage || !el) return;
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let x = r.left - s.left + r.width / 2;
  if (edge === 'start') x = r.right - s.left - 6;
  else if (edge === 'end') x = r.left - s.left + 6;
  hand.dur = dur;
  hand.x = x;
  hand.y = r.top - s.top + r.height * 0.75;
  hand.visible = true;
}

async function writeLines(token) {
  await nextTick();
  for (const line of lines) {
    if (token !== roundToken) return;
    const el = stageRef.value?.querySelector(`[data-line="${line.idx}"]`);
    moveHandTo(el, 'start', 90);
    await sleep(90);
    if (token !== roundToken) return;
    line.drawn = true;
    moveHandTo(el, 'end', writeMs.value);
    await sleep(writeMs.value);
  }
  hand.visible = false;
}

// ===== الجولات =====
function startGame() {
  if (phase.value !== 'setup') return;
  if (players.length < 2) {
    appendLog('<div class="log-item log-out">⚠️ تحتاج لاعبين اثنين على الأقل للبدء</div>');
    return;
  }
  stopRegistration();
  players.forEach((p) => { p.alive = true; p.revived = false; p.lineIdx = null; p.outRound = null; });
  roundNumber.value = 0;
  winner.value = null;
  lastCategoryId = null;
  lastRoundKeys = new Set();
  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">🚀 بدأت اللعبة بـ ${players.length} لاعب</div>`);
  startRound();
}

async function startRound() {
  const token = ++roundToken;
  const { doubles, noLine } = applyPendingGifts();

  roundNumber.value++;
  players.forEach((p) => { p.lineIdx = null; });
  const alive = alivePlayers.value.length;
  const base = Math.max(1, Math.round(alive * ELIM_RATIO));
  const count = Math.min(MAX_LINES, Math.max(1, alive - (base * (1 + doubles) + noLine)));
  roundPlan.lines = count;
  roundPlan.out = alive - count;

  const { category, entries } = pickCategoryWords(count);
  currentCategory.value = category;
  lastCategoryId = category.id;
  lastRoundKeys = new Set(entries.map((e) => e.key));

  lines.splice(0, lines.length, ...entries.map((e, i) => ({
    idx: i, word: e.word, key: e.key, owner: null, drawn: false, crossed: false,
  })));
  claimMap = new Map(lines.map((l) => [l.key, l]));

  roundMode.value = revealMode.value;
  wordsShown.value = false;
  raceOpen.value = roundMode.value === 'sequential';
  timerRunning.value = false;
  timeLeft.value = getRoundDuration();
  writeMs.value = roundMode.value === 'sequential'
    ? Math.max(200, Math.min(900, Math.floor(15000 / count)))
    : Math.max(110, Math.min(600, Math.floor(7000 / count)));
  phase.value = 'writing';

  appendLog(`<div class="log-item" style="text-align:center; color:#3498db;">📓 الجولة ${roundNumber.value} — ${escapeHtml(category.title)}: ${count} سطر لـ ${alive} لاعب (يطلع ${alive - count})</div>`);

  await writeLines(token);
  if (token !== roundToken) return;

  if (roundMode.value === 'all') {
    wordsShown.value = true;
    await sleep(350);
    if (token !== roundToken) return;
    raceOpen.value = true;
  }
  phase.value = 'racing';
  startTimer();
  checkAllClaimed();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerRunning.value = true;
  timerInterval = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      timeLeft.value = 0;
      endRound();
    }
  }, 1000);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerRunning.value = false;
}

function tryClaim(username, text) {
  if (!raceOpen.value || !username || !text) return;
  const player = findPlayerByName(username);
  if (!player || !player.alive || player.lineIdx !== null) return;
  let key = normalizeText(text);
  if (currentCategory.value?.numeric) {
    const n = parseArabicNumber(key);
    if (n === null) return;
    key = String(n);
  }
  const line = claimMap.get(key);
  if (!line || line.owner || !line.drawn) return;
  if (roundMode.value === 'all' && !wordsShown.value) return;
  line.owner = { id: player.id, name: player.name, avatar: player.avatar };
  player.lineIdx = line.idx;
  checkAllClaimed();
}

function checkAllClaimed() {
  if (phase.value !== 'racing') return;
  if (lines.every((l) => l.owner)) endRound();
}

async function endRound() {
  if (phase.value !== 'racing') return;
  stopTimer();
  raceOpen.value = false;
  phase.value = 'result';
  const token = roundToken;

  const claimed = lines.filter((l) => l.owner);
  if (claimed.length === 0) {
    lines.forEach((l) => { l.crossed = true; });
    appendLog('<div class="log-item log-out">😶 ما أحد كتب ولا سطر — الجولة ملغية وما طلع أحد</div>');
    return;
  }

  lines.filter((l) => !l.owner).forEach((l) => { l.crossed = true; });
  const losers = alivePlayers.value.filter((p) => p.lineIdx === null);
  await scribblePlayers(losers, token);
  if (token !== roundToken) return;

  if (losers.length) {
    appendLog(`<div class="log-item log-out">✏️ انشطبوا: ${losers.map((p) => escapeHtml(p.name)).join('، ')}</div>`);
  }

  const survivors = alivePlayers.value;
  if (survivors.length === 1) {
    winner.value = survivors[0];
    phase.value = 'ended';
    discardPendingGifts('انتهت اللعبة');
    appendLog(`<div class="log-item log-win">🏆 الفائز: <b>${escapeHtml(survivors[0].name)}</b></div>`);
  } else if (survivors.length === 2) {
    appendLog('<div class="log-item" style="color:#f39c12;">⚔️ الجولة الجاية هي الأخيرة — هدايا الرجعة مقفلة</div>');
  }
}

// اليد تمر على أسماء الخارجين وتشخبطها (أول 12 بالتوالي، والباقي مرة وحدة)
async function scribblePlayers(losers, token) {
  const hopped = losers.slice(0, 12);
  for (const p of hopped) {
    if (token !== roundToken) return;
    const el = stageRef.value?.querySelector(`[data-pid="${p.id}"]`);
    moveHandTo(el, 'center', 260);
    await sleep(260);
    p.alive = false;
    p.outRound = roundNumber.value;
    await sleep(140);
  }
  losers.slice(12).forEach((p) => { p.alive = false; p.outRound = roundNumber.value; });
  hand.visible = false;
}

function nextRound() {
  if (phase.value !== 'result') return;
  startRound();
}

function resetGame() {
  roundToken++;
  stopTimer();
  stopRegistration();
  phase.value = 'setup';
  roundNumber.value = 0;
  lines.splice(0, lines.length);
  claimMap = new Map();
  currentCategory.value = null;
  wordsShown.value = false;
  raceOpen.value = false;
  hand.visible = false;
  winner.value = null;
  lastCategoryId = null;
  lastRoundKeys = new Set();
  pending.reviveLine.splice(0);
  pending.reviveNoLine.splice(0);
  pending.doubles = 0;
  players.forEach((p) => { p.alive = true; p.revived = false; p.lineIdx = null; p.outRound = null; });
  eventLog.value = [];
}

// ===== الهدايا: كلها تنحفظ وتتطبق ببداية الجولة الجاية =====
const pending = reactive({ reviveLine: [], reviveNoLine: [], doubles: 0 });
const pendingCount = computed(() => pending.reviveLine.length + pending.reviveNoLine.length + pending.doubles);
const pendingSummary = computed(() => {
  const parts = [];
  if (pending.reviveLine.length) parts.push(`↩️ رجعة بسطر ×${pending.reviveLine.length}`);
  if (pending.reviveNoLine.length) parts.push(`🔙 رجعة بدون سطر ×${pending.reviveNoLine.length}`);
  if (pending.doubles) parts.push(`✖️ تضعيف الخارجين ×${pending.doubles}`);
  return parts.join(' · ');
});

function isQueued(id) { return pending.reviveLine.includes(id) || pending.reviveNoLine.includes(id); }
const finalReached = computed(() => alivePlayers.value.length <= 2);

function queueRevive(player, withLine) {
  if (!gameInProgress.value || !player) return;
  if (player.alive || player.revived || isQueued(player.id)) return;
  if (finalReached.value) {
    appendLog(`<div class="log-item log-out">⛔ رجعة ${escapeHtml(player.name)} ما تنفع — الجولة الأخيرة</div>`);
    return;
  }
  (withLine ? pending.reviveLine : pending.reviveNoLine).push(player.id);
  appendLog(`<div class="log-item log-gift">🎁 ${escapeHtml(player.name)} بيرجع الجولة الجاية ${withLine ? 'مع سطر جديد' : 'بدون سطر (يطلع واحد زيادة)'}</div>`);
}

function queueDouble(fromName) {
  if (!gameInProgress.value) return;
  if (finalReached.value) {
    appendLog('<div class="log-item log-out">⛔ تضعيف الخارجين ما ينفع بالجولة الأخيرة</div>');
    return;
  }
  pending.doubles++;
  appendLog(`<div class="log-item log-gift">🎁 ${fromName ? `${escapeHtml(fromName)}: ` : ''}تضعيف الخارجين بالجولة الجاية (×${pending.doubles})</div>`);
}

function discardPendingGifts(reason) {
  if (pendingCount.value === 0) return;
  appendLog(`<div class="log-item log-out">🗑️ انلغت الهدايا المنتظرة (${escapeHtml(reason)})</div>`);
  pending.reviveLine.splice(0);
  pending.reviveNoLine.splice(0);
  pending.doubles = 0;
}

function applyPendingGifts() {
  if (alivePlayers.value.length <= 2) {
    discardPendingGifts('الجولة الأخيرة');
    return { doubles: 0, noLine: 0 };
  }
  const revive = (id) => {
    const p = players.find((x) => x.id === id);
    if (!p || p.alive) return false;
    p.alive = true;
    p.revived = true;
    p.outRound = null;
    return true;
  };
  pending.reviveLine.forEach(revive);
  const noLine = pending.reviveNoLine.filter(revive).length;
  const { doubles } = pending;
  pending.reviveLine.splice(0);
  pending.reviveNoLine.splice(0);
  pending.doubles = 0;
  return { doubles, noLine };
}

const giftActions = reactive([
  { id: 'reviveLine', label: '↩️ رجعة بسطر', desc: 'يرجع اللاعب المستبعد اللي أرسلها، ومعه سطر جديد', enabled: false, gift: '', min: null },
  { id: 'reviveNoLine', label: '🔙 رجعة بدون سطر', desc: 'يرجع المرسل بدون سطر — يطلع لاعب زيادة بالجولة الجاية', enabled: false, gift: '', min: null },
  { id: 'double', label: '✖️ تضعيف الخارجين', desc: 'من أي مشاهد: عدد الخارجين يتضاعف بالجولة الجاية (1 يصير 2)', enabled: false, gift: '', min: null },
]);

function runGiftAction(id, username) {
  if (id === 'double') queueDouble(username);
  else queueRevive(findPlayerByName(username), id === 'reviveLine');
}

// ===== تحكم يدوي بالهدايا (للشات روم أو التجربة) =====
const manualReviveId = ref(null);
const revivableOptions = computed(() => players
  .filter((p) => !p.alive && !p.revived && !isQueued(p.id))
  .map((p) => ({ value: p.id, label: p.name })));
function manualRevive(withLine) {
  queueRevive(players.find((p) => p.id === manualReviveId.value), withLine);
  manualReviveId.value = null;
}

// ===== الانضمام والتسجيل =====
const joinWordInput = ref('دخول');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const registrationOpen = ref(false);
function getJoinWord() { return joinWordInput.value.trim() || 'دخول'; }
function startRegistration() { if (phase.value === 'setup') registrationOpen.value = true; }
function stopRegistration() { registrationOpen.value = false; }
const selectedGiftLabel = computed(() => (GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value) || {}).label || '🎁 أي هدية');

function handleComment(user, text, avatar) {
  const t = String(text || '').trim();
  if (!user || !t) return;
  if (phase.value === 'setup') {
    if (registrationOpen.value && !joinViaGift.value && normalizeText(t) === normalizeText(getJoinWord())) addPlayer(user, avatar);
    return;
  }
  tryClaim(user, t);
}

function handleTiktokMessage(data) {
  if (data.comment) handleComment(data.user, data.comment, data.avatar);
  if (!isGiftEvent(data)) return;
  const user = getGiftUser(data);
  if (phase.value === 'setup') {
    if (registrationOpen.value && joinViaGift.value
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) addPlayer(user, data.avatar);
    return;
  }
  const action = giftActions.find((g) => g.enabled && giftPassesFilter(data, { nameFilter: g.gift, minValue: g.min }));
  if (action) runGiftAction(action.id, user);
}

// ===== ربط تيك توك =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'notebook', onMessage: handleTiktokMessage });
}

// ===== نصوص الواجهة =====
const phaseLabel = computed(() => {
  if (phase.value === 'setup') return players.length ? `👥 ${players.length} لاعب جاهز — اضغط "بدء اللعبة"` : 'سجّلوا بالدخول عشان تنكتب أسماءكم بالدفتر';
  if (phase.value === 'writing') return roundMode.value === 'all' ? '✍️ عبود يكتب الأسطر... استعدوا!' : '✍️ الأسطر تنكتب — اكتب الكلمة أول ما تطلع!';
  if (phase.value === 'racing') return '⚡ اكتب كلمة سطر فاضي بالشات — كل واحد سطر واحد بس!';
  if (phase.value === 'result') return finalReached.value ? '⚔️ باقي لاعبين اثنين — الجولة الجاية أخيرة' : '📝 انتهت الجولة — اضغط "الجولة التالية"';
  return '🏆 انتهت اللعبة';
});
const timerText = computed(() => (timerRunning.value || phase.value === 'result' ? String(timeLeft.value) : '--'));
const timerUrgent = computed(() => timerRunning.value && timeLeft.value <= 5);
const claimedCount = computed(() => lines.filter((l) => l.owner).length);
const settingsLocked = computed(() => phase.value === 'writing' || phase.value === 'racing');

function toggleRevealMode() {
  if (settingsLocked.value) return;
  revealMode.value = revealMode.value === 'all' ? 'sequential' : 'all';
}

function chipState(p) {
  if (!p.alive) return 'out';
  if (p.lineIdx !== null) return 'has-line';
  if (raceOpen.value) return 'waiting';
  return '';
}

// ===== النوافذ =====
const barExpanded = ref(true);
const showRules = ref(false);
const playersModal = ref(false);
const joinModal = ref(false);
const giftsModal = ref(false);

function goHome() { router.push('/'); }

function handleGlobalKeydown(e) {
  if (e.code !== 'Space') return;
  const el = document.activeElement;
  if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
  e.preventDefault();
  if (showRules.value || playersModal.value || joinModal.value || giftsModal.value) return;
  if (phase.value === 'setup') startGame();
  else if (phase.value === 'result') nextRound();
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('resize', onResize);
  setMessageHandler(handleTiktokMessage);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً
  setJoinHandler((name) => addPlayer(name, ''));
});
onUnmounted(() => {
  roundToken++;
  document.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('resize', onResize);
  stopTimer();
  clearMessageHandler();
});
</script>

<template>
  <h1>📓 دفتر عبود</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRules = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ roundNumber }}</div>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="barExpanded && !isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>

    <button v-if="phase === 'setup'" class="master-btn side-panel-btn" @click="startGame">🚀 بدء اللعبة</button>
    <button v-if="phase === 'racing'" class="master-btn side-panel-btn" style="background:#3498db;" @click="endRound">⏹️ إنهاء الجولة الآن</button>
    <button v-if="phase === 'result'" class="master-btn side-panel-btn" @click="nextRound">📝 الجولة التالية</button>
    <button v-if="phase === 'ended'" class="master-btn side-panel-btn" @click="resetGame">🔄 لعبة جديدة</button>

    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="playersModal = true">👥 اللاعبين: <span>{{ alivePlayers.length }}/{{ players.length }}</span></button>
    <template v-if="barExpanded && phase === 'setup'">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="joinModal = true">{{ joinViaGift ? `🎁 الانضمام: ${selectedGiftLabel}` : `🎟️ كلمة الدخول: ${getJoinWord()}` }}</button>
      <button v-if="!isChatMode()" :class="registrationOpen ? 'reset-btn' : 'master-btn'" class="side-panel-btn" @click="registrationOpen ? stopRegistration() : startRegistration()">{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div class="game-toolbar">
    <label class="tb-item">
      <span>⏱️ وقت الجولة</span>
      <input v-model.number="roundDurationInput" type="number" min="5" max="300" class="tb-input" :disabled="settingsLocked" @change="getRoundDuration">
      <span>ث</span>
    </label>
    <button type="button" class="tb-item" :disabled="settingsLocked" @click="toggleRevealMode">
      {{ revealMode === 'all' ? '📋 القائمة تطلع مرة وحدة' : '✍️ الأسطر تطلع بالتوالي' }}
    </button>
    <button type="button" class="tb-item" @click="giftsModal = true">🎁 الهدايا{{ pendingCount ? ` (${pendingCount} منتظرة)` : '' }}</button>
  </div>

  <div ref="stageRef" class="stage">
    <div class="notebook">
      <div class="nb-holes"><span v-for="n in 8" :key="n"></span></div>
      <div class="nb-header">
        <div class="nb-title">
          <template v-if="currentCategory">الجولة {{ roundNumber }} — {{ currentCategory.title }}</template>
          <template v-else>دفتر عبود</template>
        </div>
        <div class="nb-timer" :class="{ urgent: timerUrgent }">{{ timerText }}</div>
      </div>
      <div class="nb-phase">{{ phaseLabel }}</div>
      <div v-if="lines.length" class="nb-meta">📝 {{ claimedCount }}/{{ roundPlan.lines }} سطر محجوز · ✏️ يطلع {{ roundPlan.out }}</div>

      <div v-if="winner" class="nb-winner">
        <img v-if="winner.avatar" :src="winner.avatar" alt="">
        <span>🏆 الفائز: {{ winner.name }}</span>
      </div>

      <div v-if="lines.length" class="nb-grid" :style="{ '--cols': gridCols, '--rows': gridRows, '--ldur': `${writeMs}ms` }">
        <div
          v-for="line in lines"
          :key="line.idx"
          class="nb-line"
          :data-line="line.idx"
          :class="{ drawn: line.drawn, claimed: !!line.owner, crossed: line.crossed }"
        >
          <span class="nb-num">{{ line.idx + 1 }}</span>
          <span class="nb-word" :class="{ shown: line.drawn && (roundMode === 'sequential' || wordsShown) }">{{ line.word }}</span>
          <span v-if="line.owner" class="nb-owner">
            <img v-if="line.owner.avatar" :src="line.owner.avatar" alt="">
            <span>{{ line.owner.name }}</span>
          </span>
          <span class="nb-rule"></span>
          <svg v-if="line.crossed" class="nb-strike" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M98 6 L2 4" pathLength="100" /></svg>
        </div>
      </div>
      <div v-else class="nb-empty">الصفحة فاضية... عبود بيبدأ يكتب أول ما تبدأ اللعبة ✍️</div>
    </div>

    <div class="participants">
      <div class="pp-title">👥 المشاركين ({{ alivePlayers.length }} باقي من {{ players.length }})</div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center;">ما فيه مشاركين للحين</div>
      <div class="pp-grid">
        <div v-for="p in players" :key="p.id" class="pp-chip" :class="chipState(p)" :data-pid="p.id">
          <img v-if="p.avatar" :src="p.avatar" class="pp-avatar" alt="">
          <span v-else class="pp-avatar pp-initial">{{ p.name.charAt(0) }}</span>
          <span class="pp-name">{{ p.name }}</span>
          <span v-if="p.alive && p.lineIdx !== null" class="pp-line">✍️{{ p.lineIdx + 1 }}</span>
          <span v-if="p.revived && p.alive" class="pp-line">↩️</span>
          <svg v-if="!p.alive" class="pp-scribble" viewBox="0 0 100 30" preserveAspectRatio="none">
            <path d="M2 18 L12 8 L20 22 L30 6 L38 24 L48 7 L56 23 L66 6 L74 22 L84 8 L92 21 L98 12" pathLength="100" />
          </svg>
        </div>
      </div>
    </div>

    <div v-if="hand.visible" class="hand" :style="{ left: `${hand.x}px`, top: `${hand.y}px`, transitionDuration: `${hand.dur}ms` }">✍️</div>
  </div>

  <div v-if="pendingCount" class="pending-bar">⏭️ الجولة الجاية: {{ pendingSummary }}</div>

  <div class="layout-wrapper">
    <div class="panel">
      <h3>📜 سجل الأحداث</h3>
      <div class="event-log-panel">
        <div v-if="eventLogReversed.length === 0" class="field-hint">لا توجد أحداث بعد</div>
        <div v-for="(log, i) in eventLogReversed" :key="i" v-html="log"></div>
      </div>
    </div>
  </div>

  <div v-if="playersModal" class="players-modal-overlay" style="display:flex;" @click.self="playersModal = false">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ players.length }})</h3>
      <div v-if="phase === 'setup'" class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="addPlayerManual">
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayerManual">➕ إضافة</button>
      </div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً</div>
      <div v-else class="players-modal-list">
        <div v-for="p in players" :key="p.id" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }} {{ p.alive ? '' : '✏️' }}</span>
          <button v-if="phase === 'setup'" type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️ حذف</button>
        </div>
      </div>
      <button v-if="phase === 'setup' && players.length" class="reset-btn" style="width:100%; margin-top:10px;" @click="clearPlayers">🧹 مسح كل اللاعبين</button>
      <button class="master-btn" style="width:100%; margin-top:10px;" @click="playersModal = false">إغلاق</button>
    </div>
  </div>

  <div v-if="joinModal" class="players-modal-overlay" style="display:flex;" @click.self="joinModal = false">
    <div class="players-modal-card">
      <h3>🎟️ طريقة الانضمام</h3>
      <label class="gift-toggle">
        <input v-model="joinViaGift" type="checkbox">
        🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
      </label>
      <input v-if="!joinViaGift" v-model="joinWordInput" type="text" placeholder="كلمة الدخول (افتراضياً: دخول)" style="margin-top:8px;">
      <div v-else class="gift-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_OPTIONS" />
        <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة (اختياري)">
      </div>
      <div class="field-hint">الانضمام يشتغل بس والتسجيل مفتوح وقبل بدء اللعبة.</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="joinModal = false">إغلاق</button>
    </div>
  </div>

  <div v-if="giftsModal" class="players-modal-overlay" style="display:flex;" @click.self="giftsModal = false">
    <div class="players-modal-card">
      <h3>🎁 هدايا اللعبة</h3>
      <template v-if="!isChatMode()">
        <div v-for="g in giftActions" :key="g.id" class="gift-block">
          <label class="gift-toggle">
            <input v-model="g.enabled" type="checkbox">
            {{ g.label }}
          </label>
          <div class="field-hint" style="margin-top:2px;">{{ g.desc }}</div>
          <div v-if="g.enabled" class="gift-row">
            <CustomSelect v-model="g.gift" :options="GIFT_OPTIONS" />
            <input v-model="g.min" type="number" min="0" placeholder="أقل قيمة (اختياري)">
          </div>
        </div>
        <div class="field-hint">لا تختار نفس الهدية لأكثر من خيار — إذا تطابقت، ينفذ الخيار الأول بس.</div>
      </template>

      <div class="gift-block">
        <div class="gift-toggle">🛠️ تنفيذ يدوي</div>
        <div class="gift-row">
          <CustomSelect v-model="manualReviveId" :options="revivableOptions" placeholder="اختر لاعب مستبعد" />
        </div>
        <div class="gift-row">
          <button class="master-btn" :disabled="!manualReviveId || !gameInProgress" @click="manualRevive(true)">↩️ رجعة بسطر</button>
          <button class="master-btn" :disabled="!manualReviveId || !gameInProgress" @click="manualRevive(false)">🔙 بدون سطر</button>
          <button class="master-btn" style="background:#8e44ad;" :disabled="!gameInProgress" @click="queueDouble('')">✖️ تضعيف</button>
        </div>
      </div>

      <div class="field-hint">
        • أي هدية توصل تنحفظ وتتطبق ببداية الجولة الجاية.<br>
        • اللاعب ما يرجع أكثر من مرة باللعبة.<br>
        • لما يبقى لاعبين اثنين (الجولة الأخيرة) الهدايا تنقفل.
      </div>
      <div v-if="pendingCount" class="field-hint" style="color:#f1c40f;">⏭️ منتظرة: {{ pendingSummary }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="giftsModal = false">إغلاق</button>
    </div>
  </div>

  <div v-if="showRules" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين دفتر عبود 📓</h2>
      <ul class="rules-list">
        <li><b>الدخول:</b> قبل البداية يكتب المشاهد "{{ getJoinWord() }}" بالشات عشان ينكتب اسمه بالمشاركين</li>
        <li><b>الأسطر:</b> كل جولة يكتب عبود أسطر من فئة عشوائية، عددها أقل من اللاعبين بـ 5% تقريباً (أقل شي يطلع لاعب واحد)، وأقصى عدد بالدفتر 44 سطر</li>
        <li><b>الظهور:</b> إما القائمة كلها تطلع مرة وحدة بعد ما تخلص اليد، أو الأسطر تطلع بالتوالي — حسب اختيار المستضيف</li>
        <li><b>الحجز:</b> اكتب كلمة السطر كاملة بالشات، وأول واحد يكتبها ياخذ السطر وينكتب اسمه جنبه. كل لاعب سطر واحد بس</li>
        <li><b>الكتابة:</b> ما يفرق أ/إ/آ/ا ولا ة/ه ولا ى/ي ولا التشكيل. بالأرقام يتقبل 3 و ٣ و ثلاثة</li>
        <li><b>الخروج:</b> اللي يخلص الوقت ({{ roundDurationInput }} ث) وهو بدون سطر تشخبط اليد على اسمه</li>
        <li><b>الهدايا:</b> رجعة بسطر، رجعة بدون سطر (يطلع واحد زيادة)، وتضعيف الخارجين — كلها تتطبق بالجولة الجاية وتنقفل بالجولة الأخيرة</li>
        <li><b>الفوز:</b> آخر لاعب يبقى بالدفتر هو الفائز 🏆</li>
      </ul>
      <button class="master-btn back-to-game-btn" @click="showRules = false">🔙 رجوع للعبة</button>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Mirza:wght@400;600;700&display=swap');
</style>

<style scoped>
:global(body) { padding: 10px; padding-bottom: 40px; }
h1 { font-size: 2rem; text-align: center; }
.subtitle { font-size: 1rem; margin-bottom: 15px; text-align: center; }

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

.field-hint { font-size: 0.75rem; color: #8b93a3; margin-top: 4px; line-height: 1.6; }

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
input:focus { border-color: var(--primary-color); box-shadow: 0 0 10px var(--border-glow); }
input:disabled, button:disabled { opacity: 0.5; cursor: not-allowed; }

.game-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  width: 100%;
  margin-bottom: 12px;
}
.tb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 7px 14px;
  font-size: 0.9rem;
  color: #ecf0f1;
  cursor: pointer;
}
.tb-item:hover:not(:disabled) { border-color: var(--primary-color); }
.tb-input {
  width: 54px;
  flex: none;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 0.85rem;
  text-align: center;
}

/* ===== المسرح: الدفتر + المشاركين + اليد ===== */
.stage {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.notebook {
  position: relative;
  width: 100%;
  background: #fbf7ea;
  background-image: linear-gradient(to left, transparent 44px, #e57373 44px, #e57373 46px, transparent 46px);
  color: #23304d;
  border-radius: 8px 16px 16px 8px;
  padding: 18px 60px 22px 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), inset -6px 0 12px rgba(0, 0, 0, 0.06);
  min-height: 260px;
}

.nb-holes {
  position: absolute;
  top: 20px;
  bottom: 20px;
  right: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}
.nb-holes span {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #2a2a40;
  box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
}

.nb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  border-bottom: 2px solid #7ea3d6;
  padding-bottom: 6px;
  margin-bottom: 6px;
}
.nb-title { font-family: 'Mirza', serif; font-size: 1.7rem; font-weight: 700; color: #1d2f5c; }
.nb-timer { font-size: 2rem; font-weight: bold; color: #c0392b; min-width: 60px; text-align: center; }
.nb-timer.urgent { animation: tick 0.5s ease-in-out infinite alternate; }
@keyframes tick { to { transform: scale(1.18); } }
.nb-phase { font-weight: bold; color: #b9770e; text-align: center; margin: 4px 0; }
.nb-meta { font-size: 0.85rem; color: #5d6d7e; text-align: center; margin-bottom: 8px; }
.nb-empty { font-family: 'Mirza', serif; font-size: 1.3rem; color: #8a93a6; text-align: center; padding: 50px 10px; }

.nb-winner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-family: 'Mirza', serif;
  font-size: 2rem;
  color: #b9770e;
  margin: 8px 0 14px;
}
.nb-winner img { width: 54px; height: 54px; border-radius: 50%; object-fit: cover; border: 3px solid #f39c12; }

.nb-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), auto);
  grid-auto-flow: column;
  column-gap: 22px;
}

.nb-line {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 48px;
  padding: 0 2px 4px;
  min-width: 0;
}
.nb-num { font-size: 0.75rem; color: #9aa7bd; min-width: 18px; flex: none; }
.nb-word {
  font-family: 'Mirza', serif;
  font-size: 1.35rem;
  line-height: 1.5;
  padding: 0 4px;
  color: #1f2d4d;
  white-space: nowrap;
  clip-path: inset(-60% -30% -60% 100%);
  flex: none;
}
/* ميلان خفيف مختلف لكل سطر عشان يبين مكتوب باليد */
.nb-line:nth-child(3n+1) .nb-word { transform: rotate(-1.5deg) translateY(-1px); }
.nb-line:nth-child(3n+2) .nb-word { transform: rotate(1deg); }
.nb-line:nth-child(3n) .nb-word { transform: rotate(-0.5deg) translateY(1px); }
.nb-word.shown { animation: ink-reveal var(--ldur) linear forwards; }
/* قيم سالبة عشان حروف الرقعة اللي تطلع برا حدود الكلمة (النقاط والذيول) ما تنقص */
@keyframes ink-reveal {
  from { clip-path: inset(-60% -30% -60% 100%); }
  to { clip-path: inset(-60% -30% -60% -30%); }
}
.nb-line.claimed .nb-word { color: #7f8c8d; }

.nb-owner {
  margin-inline-start: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Mirza', serif;
  font-size: 1.05rem;
  line-height: 1;
  color: #1d4ed8;
  min-width: 0;
  animation: ink-reveal 0.45s linear forwards;
}
.nb-owner span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-owner img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: none; }

.nb-rule {
  position: absolute;
  bottom: 3px;
  right: 0;
  left: 0;
  height: 2px;
  background: #7ea3d6;
  transform: scaleX(0);
  transform-origin: right;
}
.nb-line.drawn .nb-rule { transform: scaleX(1); transition: transform var(--ldur) linear; }

.nb-strike {
  position: absolute;
  inset: 8px 0 6px;
  width: 100%;
  height: calc(100% - 14px);
  overflow: visible;
  pointer-events: none;
}
.nb-strike path {
  fill: none;
  stroke: #c0392b;
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: draw-stroke 0.4s ease-out forwards;
}
@keyframes draw-stroke { to { stroke-dashoffset: 0; } }

/* ===== المشاركين ===== */
.participants {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 12px;
}
.pp-title { font-weight: bold; color: var(--primary-color); text-align: center; margin-bottom: 10px; }
.pp-grid { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.pp-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1e1e2f;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  padding: 4px 10px 4px 6px;
  font-size: 0.85rem;
  max-width: 190px;
}
.pp-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex: none; }
.pp-initial { display: flex; align-items: center; justify-content: center; background: #34495e; font-weight: bold; }
.pp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-line { font-size: 0.75rem; color: #2ecc71; flex: none; }
.pp-chip.has-line { border-color: #27ae60; background: rgba(39, 174, 96, 0.15); }
.pp-chip.waiting { animation: wait-glow 1.4s ease-in-out infinite; }
@keyframes wait-glow { 50% { border-color: var(--primary-color); box-shadow: 0 0 10px rgba(243, 156, 18, 0.5); } }
.pp-chip.out { opacity: 0.55; }
.pp-scribble {
  position: absolute;
  inset: 2px 4px;
  width: calc(100% - 8px);
  height: calc(100% - 4px);
  pointer-events: none;
}
.pp-scribble path {
  fill: none;
  stroke: #e74c3c;
  stroke-width: 3;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: draw-scribble 0.35s ease-out forwards;
}
@keyframes draw-scribble { to { stroke-dashoffset: 0; } }

.hand {
  position: absolute;
  z-index: 20;
  font-size: 44px;
  line-height: 1;
  pointer-events: none;
  transform: translate(-15%, -85%);
  transition-property: left, top;
  transition-timing-function: linear;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35));
}

.pending-bar {
  width: 100%;
  text-align: center;
  background: rgba(241, 196, 15, 0.15);
  border: 1px dashed #f1c40f;
  color: #f1c40f;
  border-radius: 10px;
  padding: 8px;
  margin-bottom: 16px;
  font-weight: bold;
}

/* ===== اللوحات والنوافذ ===== */
.layout-wrapper { display: flex; flex-direction: column; gap: 20px; width: 100%; }
.panel {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 15px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  width: 100%;
}
.panel h3 {
  font-size: 1.2rem;
  margin-bottom: 12px;
  color: #ecf0f1;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px;
  text-align: center;
}

.event-log-panel { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.event-log-panel :deep(.log-item) { padding: 8px 10px; border-radius: 6px; background: #1e1e2f; font-size: 0.85rem; line-height: 1.5; }
.event-log-panel :deep(.log-out) { border-right: 4px solid var(--danger-color); }
.event-log-panel :deep(.log-gift) { border-right: 4px solid #8e44ad; }
.event-log-panel :deep(.log-win) { border-right: 4px solid var(--primary-color); color: #f39c12; font-weight: bold; }

.gift-block { border-top: 1px dashed rgba(255, 255, 255, 0.12); padding-top: 10px; margin-top: 10px; }
.gift-toggle { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; color: #ecf0f1; cursor: pointer; font-weight: bold; }
.gift-toggle input { width: auto; accent-color: var(--primary-color); }
.gift-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.gift-row > * { flex: 1; min-width: 120px; }
.gift-row .master-btn { padding: 8px 10px; font-size: 0.85rem; margin: 0; }

.rules-overlay {
  position: fixed;
  inset: 0;
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
  margin-top: 18px;
  background: var(--success-color);
  font-size: 1.05rem;
  padding: 12px;
}

.footer-note { padding: 15px; font-size: 0.85rem; }

@media (max-width: 600px) {
  .notebook {
    padding: 12px 34px 16px 8px;
    background-image: linear-gradient(to left, transparent 26px, #e57373 26px, #e57373 28px, transparent 28px);
  }
  .nb-holes { right: 6px; }
  .nb-holes span { width: 12px; height: 12px; }
  .nb-grid { column-gap: 12px; }
  .nb-line { height: 52px; gap: 4px; }
  .nb-num { min-width: 14px; }
  .nb-word { font-size: 1.45rem; font-weight: 600; padding: 0 2px; }
  .nb-owner { font-size: 0.95rem; }
  .nb-owner img { display: none; }
  .nb-title { font-size: 1.35rem; }
  .nb-timer { font-size: 1.7rem; }
}
</style>
