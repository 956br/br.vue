<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';

const router = useRouter();
const STORAGE_KEY = 'capitalsGame_players';

const COUNTRIES = [
  { c: 'السعودية', cap: 'الرياض', cont: 'آسيا' },
  { c: 'مصر', cap: 'القاهرة', cont: 'أفريقيا' },
  { c: 'الإمارات', cap: 'أبوظبي', cont: 'آسيا' },
  { c: 'قطر', cap: 'الدوحة', cont: 'آسيا' },
  { c: 'الكويت', cap: 'مدينة الكويت', cont: 'آسيا' },
  { c: 'البحرين', cap: 'المنامة', cont: 'آسيا' },
  { c: 'عُمان', cap: 'مسقط', cont: 'آسيا' },
  { c: 'الأردن', cap: 'عمّان', cont: 'آسيا' },
  { c: 'لبنان', cap: 'بيروت', cont: 'آسيا' },
  { c: 'العراق', cap: 'بغداد', cont: 'آسيا' },
  { c: 'سوريا', cap: 'دمشق', cont: 'آسيا' },
  { c: 'اليمن', cap: 'صنعاء', cont: 'آسيا' },
  { c: 'فلسطين', cap: 'القدس', cont: 'آسيا' },
  { c: 'المغرب', cap: 'الرباط', cont: 'أفريقيا' },
  { c: 'الجزائر', cap: 'الجزائر', cont: 'أفريقيا' },
  { c: 'تونس', cap: 'تونس', cont: 'أفريقيا' },
  { c: 'ليبيا', cap: 'طرابلس', cont: 'أفريقيا' },
  { c: 'السودان', cap: 'الخرطوم', cont: 'أفريقيا' },
  { c: 'موريتانيا', cap: 'نواكشوط', cont: 'أفريقيا' },
  { c: 'الصومال', cap: 'مقديشو', cont: 'أفريقيا' },
  { c: 'جيبوتي', cap: 'جيبوتي', cont: 'أفريقيا' },
  { c: 'جزر القمر', cap: 'موروني', cont: 'أفريقيا' },
  { c: 'تركيا', cap: 'أنقرة', cont: 'آسيا' },
  { c: 'إيران', cap: 'طهران', cont: 'آسيا' },
  { c: 'الصين', cap: 'بكين', cont: 'آسيا' },
  { c: 'اليابان', cap: 'طوكيو', cont: 'آسيا' },
  { c: 'كوريا الجنوبية', cap: 'سيول', cont: 'آسيا' },
  { c: 'كوريا الشمالية', cap: 'بيونغ يانغ', cont: 'آسيا' },
  { c: 'الهند', cap: 'نيودلهي', cont: 'آسيا' },
  { c: 'باكستان', cap: 'إسلام آباد', cont: 'آسيا' },
  { c: 'أفغانستان', cap: 'كابول', cont: 'آسيا' },
  { c: 'إندونيسيا', cap: 'جاكرتا', cont: 'آسيا' },
  { c: 'ماليزيا', cap: 'كوالالمبور', cont: 'آسيا' },
  { c: 'تايلاند', cap: 'بانكوك', cont: 'آسيا' },
  { c: 'الفلبين', cap: 'مانيلا', cont: 'آسيا' },
  { c: 'فيتنام', cap: 'هانوي', cont: 'آسيا' },
  { c: 'سنغافورة', cap: 'سنغافورة', cont: 'آسيا' },
  { c: 'بنغلاديش', cap: 'دكا', cont: 'آسيا' },
  { c: 'كازاخستان', cap: 'أستانا', cont: 'آسيا' },
  { c: 'أوزبكستان', cap: 'طشقند', cont: 'آسيا' },
  { c: 'نيبال', cap: 'كاتماندو', cont: 'آسيا' },
  { c: 'المملكة المتحدة', cap: 'لندن', cont: 'أوروبا' },
  { c: 'فرنسا', cap: 'باريس', cont: 'أوروبا' },
  { c: 'ألمانيا', cap: 'برلين', cont: 'أوروبا' },
  { c: 'إيطاليا', cap: 'روما', cont: 'أوروبا' },
  { c: 'إسبانيا', cap: 'مدريد', cont: 'أوروبا' },
  { c: 'البرتغال', cap: 'لشبونة', cont: 'أوروبا' },
  { c: 'هولندا', cap: 'أمستردام', cont: 'أوروبا' },
  { c: 'بلجيكا', cap: 'بروكسل', cont: 'أوروبا' },
  { c: 'سويسرا', cap: 'برن', cont: 'أوروبا' },
  { c: 'النمسا', cap: 'فيينا', cont: 'أوروبا' },
  { c: 'اليونان', cap: 'أثينا', cont: 'أوروبا' },
  { c: 'السويد', cap: 'ستوكهولم', cont: 'أوروبا' },
  { c: 'النرويج', cap: 'أوسلو', cont: 'أوروبا' },
  { c: 'الدنمارك', cap: 'كوبنهاغن', cont: 'أوروبا' },
  { c: 'فنلندا', cap: 'هلسنكي', cont: 'أوروبا' },
  { c: 'بولندا', cap: 'وارسو', cont: 'أوروبا' },
  { c: 'روسيا', cap: 'موسكو', cont: 'أوروبا' },
  { c: 'أوكرانيا', cap: 'كييف', cont: 'أوروبا' },
  { c: 'أيرلندا', cap: 'دبلن', cont: 'أوروبا' },
  { c: 'المجر', cap: 'بودابست', cont: 'أوروبا' },
  { c: 'التشيك', cap: 'براغ', cont: 'أوروبا' },
  { c: 'رومانيا', cap: 'بوخارست', cont: 'أوروبا' },
  { c: 'نيجيريا', cap: 'أبوجا', cont: 'أفريقيا' },
  { c: 'جنوب أفريقيا', cap: 'بريتوريا', cont: 'أفريقيا' },
  { c: 'كينيا', cap: 'نيروبي', cont: 'أفريقيا' },
  { c: 'إثيوبيا', cap: 'أديس أبابا', cont: 'أفريقيا' },
  { c: 'غانا', cap: 'أكرا', cont: 'أفريقيا' },
  { c: 'السنغال', cap: 'داكار', cont: 'أفريقيا' },
  { c: 'تنزانيا', cap: 'دودوما', cont: 'أفريقيا' },
  { c: 'أوغندا', cap: 'كمبالا', cont: 'أفريقيا' },
  { c: 'زيمبابوي', cap: 'هراري', cont: 'أفريقيا' },
  { c: 'الكاميرون', cap: 'ياوندي', cont: 'أفريقيا' },
  { c: 'الولايات المتحدة', cap: 'واشنطن', cont: 'أمريكا الشمالية' },
  { c: 'كندا', cap: 'أوتاوا', cont: 'أمريكا الشمالية' },
  { c: 'المكسيك', cap: 'مكسيكو سيتي', cont: 'أمريكا الشمالية' },
  { c: 'كوبا', cap: 'هافانا', cont: 'أمريكا الشمالية' },
  { c: 'جامايكا', cap: 'كينغستون', cont: 'أمريكا الشمالية' },
  { c: 'بنما', cap: 'مدينة بنما', cont: 'أمريكا الشمالية' },
  { c: 'غواتيمالا', cap: 'غواتيمالا سيتي', cont: 'أمريكا الشمالية' },
  { c: 'كوستاريكا', cap: 'سان خوسيه', cont: 'أمريكا الشمالية' },
  { c: 'البرازيل', cap: 'برازيليا', cont: 'أمريكا الجنوبية' },
  { c: 'الأرجنتين', cap: 'بوينس آيرس', cont: 'أمريكا الجنوبية' },
  { c: 'تشيلي', cap: 'سانتياغو', cont: 'أمريكا الجنوبية' },
  { c: 'كولومبيا', cap: 'بوغوتا', cont: 'أمريكا الجنوبية' },
  { c: 'بيرو', cap: 'ليما', cont: 'أمريكا الجنوبية' },
  { c: 'فنزويلا', cap: 'كاراكاس', cont: 'أمريكا الجنوبية' },
  { c: 'الإكوادور', cap: 'كيتو', cont: 'أمريكا الجنوبية' },
  { c: 'أوروغواي', cap: 'مونتيفيديو', cont: 'أمريكا الجنوبية' },
  { c: 'باراغواي', cap: 'أسونسيون', cont: 'أمريكا الجنوبية' },
  { c: 'أستراليا', cap: 'كانبرا', cont: 'أوقيانوسيا' },
  { c: 'نيوزيلندا', cap: 'ولينغتون', cont: 'أوقيانوسيا' },
  { c: 'فيجي', cap: 'سوفا', cont: 'أوقيانوسيا' },
  { c: 'بابوا غينيا الجديدة', cap: 'بورت مورسبي', cont: 'أوقيانوسيا' },
];
const CONTINENTS = ['آسيا', 'أفريقيا', 'أوروبا', 'أمريكا الشمالية', 'أمريكا الجنوبية', 'أوقيانوسيا'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) { return shuffle(arr).slice(0, n); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

const players = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id), 0) + 1;
const tiktokJoinedUsers = new Set();
const usedKeys = new Set();

function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(players)); } catch (e) { /* noop */ }
}

const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const roundDurationInput = ref(15);
const targetScoreInput = ref(10);
let roundDuration = 15;
let targetScore = 10;

const isRoundActive = ref(false);
const gameFinished = ref(false);
const winners = ref([]);
const currentRound = ref(0);
let roundToken = 0;

const currentQuestion = ref(null);
const revealCorrect = ref(false);
const timerDisplay = ref('--');
const timerUrgent = ref(false);
let countdownTimer = null;

const qTypeBadge = ref('اضغط "بدء الجولة"');
const qText = ref('استعدوا للسؤال القادم…');
const qCaption = ref('اكتب رقم إجابتك (1 إلى 4) بالدردشة أو اختر يدوياً من بطاقتك');

const roundInputsVisible = ref(false);
const roundCards = reactive([]); // { playerId, name, selected: null, statusText, statusFilled }

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتائج الجولة');
const modalLogs = ref([]);

const namesHint = computed(() => (isRoundActive.value
  ? '🔒 مقفول أثناء الجولة النشطة — سيُفتح تلقائياً بعد انتهاء الجولة.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل أثناء الجولة النشطة.'));
const controlsDisabled = computed(() => isRoundActive.value);
const startBtnVisible = computed(() => !gameFinished.value);

function playerBadgeText(p) {
  if (gameFinished.value && winners.value.some((w) => w.id === p.id)) return '🏆 فائز!';
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

function addPlayer() {
  if (isRoundActive.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً في القائمة!`]);
    return;
  }
  players.push({ id: playerIdCounter++, name, score: 0 });
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

function addPlayerFromTikTok(name) {
  if (isRoundActive.value || gameFinished.value || !name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);
  if (players.some((p) => p.name === name)) return;
  players.push({ id: playerIdCounter++, name, score: 0 });
  updateTextareaFromPlayers();
  saveToStorage();
}

function registerAnswerFromComment(username, rawText) {
  if (!isRoundActive.value || !username || !rawText) return;
  const player = players.find((p) => p.name === username);
  if (!player) return;

  const digits = normalizeDigits(rawText).match(/[1-4]/);
  if (!digits) return;
  const optIndex = Number(digits[0]) - 1;

  const card = roundCards.find((c) => c.playerId === player.id);
  if (!card) return;

  card.selected = optIndex;
  card.statusText = `✅ استلمنا إجابتك من الدردشة: رقم ${optIndex + 1}`;
  card.statusFilled = true;
}

function getRoundDuration() {
  let v = parseInt(roundDurationInput.value, 10);
  if (Number.isNaN(v) || v < 5) v = 5;
  if (v > 120) v = 120;
  roundDurationInput.value = v;
  return v;
}
function getTargetScore() {
  let v = parseInt(targetScoreInput.value, 10);
  if (Number.isNaN(v) || v < 3) v = 3;
  if (v > 100) v = 100;
  targetScoreInput.value = v;
  return v;
}

function buildQuestion() {
  const types = ['capital', 'country', 'continent'];
  let type; let item; let key; let tries = 0;
  do {
    type = types[Math.floor(Math.random() * types.length)];
    item = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    key = `${type}|${item.c}`;
    tries++;
  } while (usedKeys.has(key) && tries < 40);
  if (usedKeys.size > COUNTRIES.length) usedKeys.clear();
  usedKeys.add(key);

  let text; let correct; let pool;
  if (type === 'capital') {
    text = `ما هي عاصمة ${item.c}؟`;
    correct = item.cap;
    pool = COUNTRIES.filter((x) => x.cap !== item.cap).map((x) => x.cap);
  } else if (type === 'country') {
    text = `مدينة "${item.cap}" هي عاصمة أي دولة؟`;
    correct = item.c;
    pool = COUNTRIES.filter((x) => x.c !== item.c).map((x) => x.c);
  } else {
    text = `في أي قارة تقع ${item.c}؟`;
    correct = item.cont;
    pool = CONTINENTS.filter((x) => x !== item.cont);
  }

  const distractors = sample([...new Set(pool)], 3);
  const options = shuffle([correct, ...distractors]);
  return {
    type,
    typeLabel: type === 'capital' ? 'سؤال: عاصمة دولة' : (type === 'country' ? 'سؤال: صاحبة العاصمة' : 'سؤال: القارة'),
    text,
    options,
    correctIndex: options.indexOf(correct),
  };
}

async function startRound() {
  if (isRoundActive.value || gameFinished.value) return;

  if (players.length < 1) {
    const joinHint = joinViaGift.value ? 'يرسلون هدية' : `يكتبون "${getJoinWord()}"`;
    openModal('تنبيه', [`تحتاج إلى لاعب واحد على الأقل للبدء! أضف لاعبين أو خل المشاهدين ${joinHint}.`]);
    return;
  }

  roundDuration = getRoundDuration();
  targetScore = getTargetScore();
  roundToken++;
  currentRound.value++;

  currentQuestion.value = buildQuestion();
  revealCorrect.value = false;
  qTypeBadge.value = currentQuestion.value.typeLabel;
  qText.value = currentQuestion.value.text;
  qCaption.value = `⏳ باب الإجابات مفتوح (${roundDuration} ثانية)… اكتب رقم إجابتك من 1 إلى 4`;

  isRoundActive.value = true;
  prepareRoundInputs();
  startTimer();
}

function prepareRoundInputs() {
  roundCards.splice(0, roundCards.length);
  const q = currentQuestion.value;
  players.forEach((p) => {
    roundCards.push({
      playerId: p.id,
      name: p.name,
      options: q.options,
      selected: null,
      statusText: '🕓 بانتظار إجابتك (اكتب رقم 1 إلى 4 بالدردشة أو اختر يدوياً)',
      statusFilled: false,
    });
  });
  roundInputsVisible.value = true;
}

function pickOption(card, idx) {
  if (card.selected === idx) {
    card.selected = null;
    card.statusText = '🕓 بانتظار إجابتك (اكتب رقم 1 إلى 4 بالدردشة أو اختر يدوياً)';
    card.statusFilled = false;
    return;
  }
  card.selected = idx;
  card.statusText = `✅ التوقع جاهز (يدوي): رقم ${idx + 1}`;
  card.statusFilled = true;
}

function startTimer() {
  let timeLeft = roundDuration;
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

function buildScoreboardHtml() {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const items = sorted.map((p) => {
    const isWinner = gameFinished.value && winners.value.some((w) => w.id === p.id);
    const cls = `scoreboard-item${isWinner ? ' is-winner' : ''}`;
    const badge = isWinner ? '🏆 فائز' : `${p.score} نقطة`;
    return `<div class="${cls}"><span>${escapeHtml(p.name)}</span><span>${badge}</span></div>`;
  }).join('');
  return `<div class="scoreboard-title">📊 ترتيب كل المتسابقين</div><div class="scoreboard-list">${items || '<div class="scoreboard-item">لا يوجد لاعبون بعد</div>'}</div>`;
}

function evaluateRound() {
  if (!isRoundActive.value) return;
  isRoundActive.value = false;

  const q = currentQuestion.value;
  const correctText = q.options[q.correctIndex];
  revealCorrect.value = true;
  qCaption.value = 'انتهى الوقت — هذه نتيجة الجولة';

  const logs = [];
  logs.push(`<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:15px; margin-bottom:8px;">✅ الإجابة الصحيحة: ${escapeHtml(correctText)} (رقم ${q.correctIndex + 1})</div>`);

  roundCards.forEach((card) => {
    const player = players.find((p) => p.id === card.playerId);
    if (!player) return;

    if (card.selected === null) {
      logs.push(`<div class="log-item log-miss">⏳ <b>${escapeHtml(player.name)}</b> ما شارك بإجابة هذه الجولة. الرصيد: ${player.score}</div>`);
      return;
    }
    if (card.selected === q.correctIndex) {
      player.score += 1;
      logs.push(`<div class="log-item log-hit">🎯 <b>${escapeHtml(player.name)}</b> جاوب صح وكسب نقطة (+1). الرصيد الآن: ${player.score}</div>`);
    } else {
      logs.push(`<div class="log-item log-miss">❌ <b>${escapeHtml(player.name)}</b> جاوب غلط — بدون خصم. الرصيد: ${player.score}</div>`);
    }
  });

  const newWinners = players.filter((p) => p.score >= targetScore);
  if (newWinners.length > 0) {
    gameFinished.value = true;
    winners.value = newWinners;
    const names = newWinners.map((w) => escapeHtml(w.name)).join('، ');
    logs.push(`<div style="text-align:center; font-size:17px; color:#f39c12; margin-top:10px; background:#1e1e2f; padding:12px; border-radius:10px;">🏆 وصل إلى ${targetScore} نقطة وفاز باللعبة: <b>${names}</b><br><span style="font-size:0.85rem; color:#ccd6e0;">اضغط "إعادة اللعبة" للبدء من جديد</span></div>`);
  }

  logs.push(buildScoreboardHtml());

  saveToStorage();
  roundInputsVisible.value = false;
  timerUrgent.value = false;

  openModal(gameFinished.value ? 'انتهت اللعبة' : 'نتائج الجولة', logs);
}

function endGameShowRanking() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = true;

  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top = sorted.length ? sorted[0].score : 0;
  winners.value = sorted.filter((p) => p.score === top && top > 0);

  const logs = [];
  logs.push('<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:6px;">🏁 تم إنهاء اللعبة يدوياً</div>');
  if (winners.value.length > 0) {
    const names = winners.value.map((w) => escapeHtml(w.name)).join('، ');
    logs.push(`<div style="text-align:center; font-size:16px; color:#f39c12; margin:8px 0; background:#1e1e2f; padding:10px; border-radius:10px;">🏆 صاحب أعلى نقاط: <b>${names}</b> (${top} نقطة)</div>`);
  } else {
    logs.push('<div style="text-align:center; color:#ccd6e0;">لا توجد نقاط مسجلة بعد.</div>');
  }
  logs.push(buildScoreboardHtml());

  roundInputsVisible.value = false;
  resetArena();
  openModal('الترتيب النهائي', logs);
}

function resetArena() {
  timerDisplay.value = '--';
  qTypeBadge.value = 'اضغط "بدء الجولة"';
  qText.value = 'استعدوا للسؤال القادم…';
  currentQuestion.value = null;
  qCaption.value = 'اكتب رقم إجابتك (1 إلى 4) بالدردشة أو اختر يدوياً من بطاقتك';
}

function openModal(title, messagesArray) {
  modalTitle.value = title;
  modalLogs.value = messagesArray;
  showModal.value = true;
}
function closeModal() { showModal.value = false; }

function resetGame() {
  roundToken++;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  isRoundActive.value = false;
  gameFinished.value = false;
  winners.value = [];
  tiktokJoinedUsers.clear();
  stopRegistration();
  usedKeys.clear();

  players.forEach((p) => { p.score = 0; });
  currentRound.value = 0;
  roundInputsVisible.value = false;
  saveToStorage();
  resetArena();
}

function goHome() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (startBtnVisible.value && !isRoundActive.value) startRound();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordInput = ref('بلعب');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

function getJoinWord() {
  return joinWordInput.value.trim() || 'بلعب';
}

const joinModeHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء البث ينضم تلقائياً كلاعب. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.'
  : `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم كلاعب. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال أي هدية بدل الكتابة.`));

const tiktokSectionLabel = computed(() => (joinViaGift.value
  ? '🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً كلاعب، وأثناء الجولة يكتب رقم إجابته من 1 إلى 4'
  : `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب، وأثناء الجولة يكتب رقم إجابته من 1 إلى 4`));

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

function connectTikTok() {
  const username = tiktokUsername.value.trim();
  if (!username) {
    tiktokStatus.value = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokStatusColor.value = 'orange';
    return;
  }
  if (tiktokSocket) tiktokSocket.close();

  tiktokStatus.value = `⏳ جاري الاتصال بـ ${username} ...`;
  tiktokStatusColor.value = '#f1c40f';

  tiktokSocket = new WebSocket(`${BRIDGE_URL}?user=${username}`);

  tiktokSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokStatus.value = data.status; tiktokStatusColor.value = '#2ecc71'; }
    if (data.error) { tiktokStatus.value = data.error; tiktokStatusColor.value = '#e74c3c'; }
    if (data.comment) {
      const text = data.comment.trim();
      if (registrationOpen.value && !joinViaGift.value && text === getJoinWord()) {
        addPlayerFromTikTok(data.user);
      } else {
        registerAnswerFromComment(data.user, text);
      }
    }
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => { tiktokStatus.value = '❌ صار خطأ بالاتصال'; tiktokStatusColor.value = '#e74c3c'; };
  tiktokSocket.onclose = () => { tiktokStatus.value = '🔌 تم قطع الاتصال'; tiktokStatusColor.value = '#95a5a6'; };
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) { tiktokSocket.close(); tiktokSocket = null; }
});
</script>

<template>
  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="controlsDisabled" placeholder="اكتب اسم كل لاعب في سطر مستقل، أو خله فاضي وخل اللاعبين ينضمون من التيك توك" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">{{ tiktokSectionLabel }}</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordInput" type="text" placeholder="كلمة الانضمام (افتراضياً: بلعب)" :disabled="joinViaGift">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox">
        🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
      </label>
    </div>
    <div v-if="joinViaGift" class="gift-filter-row">
      <select v-model="giftNameFilter">
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
      <input v-model="giftMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
    </div>
    <div class="field-hint">{{ joinModeHint }}</div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div class="top-names-section">
    <label>⏱️ إعدادات الجولة (يحددها المستضيف):</label>
    <div class="round-time-row">
      <span style="font-size:0.9rem; color:#bdc3c7;">مدة الجولة (ثانية):</span>
      <input v-model="roundDurationInput" type="number" min="5" max="120">
      <span style="font-size:0.9rem; color:#bdc3c7;">نقاط الفوز:</span>
      <input v-model="targetScoreInput" type="number" min="3" max="100">
    </div>
    <div class="field-hint">بعد انتهاء الوقت تُكشف الإجابة الصحيحة وتُحتسب النقاط تلقائياً. أول لاعب يوصل لنقاط الفوز يكسب اللعبة.</div>
  </div>

  <h1>🌍 دول وعواصم</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button v-if="startBtnVisible" class="master-btn" id="startBtn" :disabled="isRoundActive" @click="startRound">🌍 بدء الجولة (فتح الإجابات)</button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="endGameShowRanking">🏁 إنهاء وعرض الترتيب</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>ساحة السؤال</h2>
      <div class="game-arena">
        <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
        <div class="q-type-badge">{{ qTypeBadge }}</div>
        <div class="q-text">{{ qText }}</div>
        <div class="q-options-display">
          <div
            v-for="(opt, i) in (currentQuestion ? currentQuestion.options : [])"
            :key="i"
            class="q-option-display"
            :class="{ 'reveal-correct': revealCorrect && i === currentQuestion.correctIndex }"
          ><span class="opt-key">{{ i + 1 }}</span>{{ opt }}</div>
        </div>
        <div class="dice-caption">{{ qCaption }}</div>
      </div>
    </div>

    <div v-if="roundInputsVisible" class="panel">
      <h3>إجابات اللاعبين (رقم واحد لكل لاعب)</h3>
      <div>
        <div v-for="card in roundCards" :key="card.playerId" class="player-input-card">
          <div class="p-name">{{ card.name }}</div>
          <div class="opt-boxes">
            <div
              v-for="(opt, i) in card.options"
              :key="i"
              class="opt-box"
              :class="{ selected: card.selected === i }"
              @click="pickOption(card, i)"
            ><span class="num">{{ i + 1 }}</span>{{ opt }}</div>
          </div>
          <div class="guess-status" :class="{ filled: card.statusFilled }">{{ card.statusText }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون والنقاط</h3>
      <div style="display: flex; gap: 5px; width: 100%; margin-bottom: 10px;">
        <input v-model="newPlayerName" type="text" placeholder="اسم اللاعب الجديد (Enter للإضافة)" style="flex:1;" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" @click="addPlayer">إضافة</button>
      </div>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span>{{ p.name }} <span style="color:#ffa502; margin-right:5px;">{{ playerBadgeText(p) }}</span></span>
          <button class="reset-btn" style="padding:4px 8px; font-size:0.8rem;" :disabled="isRoundActive" @click="removePlayer(p.id)">حذف</button>
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
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>

  <div v-if="showRulesOverlay" class="rules-overlay" style="display:flex;">
    <div class="rules-box">
      <h2>قوانين لعبة دول وعواصم 🌍</h2>
      <ul class="rules-list">
        <li>كل لاعب يبدأ من <b>0 نقطة</b>، والهدف جمع أكبر عدد من النقاط</li>
        <li>للانضمام من بث التيك توك: يكتب المشاهد كلمة <b>"بلعب"</b> بالدردشة فيُضاف تلقائياً كلاعب</li>
        <li>المستضيف يحدد <b>مدة كل جولة</b> و<b>نقاط الفوز</b> قبل الضغط على "بدء الجولة"</li>
        <li>كل جولة يظهر سؤال اختياري عن <b>عاصمة دولة</b>، أو <b>الدولة صاحبة عاصمة معيّنة</b>، أو <b>القارة</b> التي تقع فيها دولة</li>
        <li>خلال الوقت المحدد، كل لاعب يكتب <b>رقم إجابته من 1 إلى 4</b> بالدردشة (أو يختار يدوياً من بطاقته)</li>
        <li>بعد انتهاء الوقت تُكشف الإجابة الصحيحة وتُحتسب النتائج تلقائياً</li>
        <li>الإجابة الصحيحة = <b>+1 نقطة</b> — والإجابة الخاطئة أو عدم المشاركة <b>لا تنقص أي نقطة</b></li>
        <li>أول لاعب يوصل إلى <b>نقاط الفوز</b> المحددة يكسب اللعبة 🏆 (وإذا تعادل أكثر من لاعب يفوزون معاً)</li>
        <li>زر <b>"إنهاء وعرض الترتيب"</b> يوقف اللعبة ويعرض ترتيب الجميع في أي وقت</li>
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

#startBtn {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 150;
  width: calc(100% - 40px);
  max-width: 380px;
  padding: 16px 20px;
  font-size: 1.15rem;
  border-radius: 50px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: floatPulse 2.4s ease-in-out infinite;
}

@keyframes floatPulse {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(-4px); }
}

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
  margin-bottom: 10px;
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

.q-text {
  font-size: 1.5rem;
  font-weight: bold;
  text-align: center;
  color: #fff;
  line-height: 1.6;
  margin-bottom: 15px;
  min-height: 1.6em;
}

.q-options-display {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
  max-width: 520px;
}

.q-option-display {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 12px 10px;
  font-size: 1.05rem;
  font-weight: bold;
  text-align: center;
  color: #ecf0f1;
}

.q-option-display .opt-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.8em;
  height: 1.8em;
  margin-left: 8px;
  border-radius: 7px;
  background: rgba(243, 156, 18, 0.25);
  color: var(--primary-color);
}

.q-option-display.reveal-correct {
  background: rgba(39, 174, 96, 0.25);
  border-color: var(--success-color);
}

.dice-caption {
  text-align: center;
  font-size: 0.9rem;
  color: #ccd6e0;
  margin-top: 12px;
}

.player-input-card {
  background: #1e1e2f;
  padding: 10px;
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
  margin-bottom: 10px;
  width: 100%;
}

.player-input-card .p-name { font-weight: bold; margin-bottom: 8px; color: #ffa502; font-size: 0.95rem; }

.opt-boxes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.opt-box {
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 6px;
  padding: 8px 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: 0.15s;
  user-select: none;
  text-align: center;
}

.opt-box .num {
  display: inline-block;
  font-weight: bold;
  color: var(--primary-color);
  margin-left: 5px;
}

.opt-box.selected {
  background: var(--primary-color);
  color: #1e1e2f;
  border-color: #fff;
  box-shadow: 0 0 8px var(--primary-color);
}
.opt-box.selected .num { color: #1e1e2f; }

.guess-status {
  font-size: 0.78rem;
  color: #8b93a3;
  margin-top: 6px;
}
.guess-status.filled { color: #2ecc71; }

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
.log-list :deep(.log-miss) { border-right: 4px solid #7f8c8d; }
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
