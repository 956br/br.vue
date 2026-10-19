<script setup>
import { avatarOrLogo } from '../../utils/gameLogo';
import {
  ref, reactive, computed, watch, onMounted, onUnmounted, nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, GIFT_CHOICES, defaultGift, assignWheelColors, isLeaveComment,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
  displayName,
} from '../../utils/liveConnection';
import { siteAdPaused } from '../../utils/siteAd';
import CustomSelect from '../../components/CustomSelect.vue';
import { nameText } from '../../utils/nameHtml';

const router = useRouter();

// الأحكام مقسمة لأربع مجموعات تُختار من نافذة الأحكام قبل بداية اللعبة:
// القمع (penalty) إجباري حكم واحد على الأقل منه، وباقي المجموعات اختيارية
const RULES = [
  { id: 'selfOut', group: 'penalty', label: 'طرد', desc: 'اللاعب يخرج نفسه.' },
  { id: 'kick', group: 'penalty', label: 'يطرد حد', desc: 'يختار لاعبًا ويخرجه.' },
  { id: 'outAndKick', group: 'penalty', label: 'ينطرد ويطرد', desc: 'يخرج هو ولاعبًا آخر.' },
  { id: 'massKick', group: 'penalty', label: 'طرد بالجملة', desc: 'يطرد لاعبين حسب عدد اللاعبين: 2 (أقل من 30)، 3 (من 30)، 4 (من 50)، 5 (من 70).' },
  { id: 'forceKick', group: 'penalty', label: 'طرد برو ماكس', desc: 'يطرد لاعبًا حتى لو عنده حصانة.' },
  { id: 'takeShield', group: 'help', label: 'ياخذ حصانة', desc: 'يحمي نفسه من الطرد.' },
  { id: 'giftShield', group: 'help', label: 'يهدي حصانة', desc: 'يمنح لاعبًا آخر حصانة.' },
  { id: 'revive', group: 'help', label: 'يرجع لاعب', desc: 'يعيد لاعبًا خرج من الجولة.' },
  { id: 'freeze', group: 'extra', label: 'تجميد اكشن', desc: 'ممنوع يطبق الاكشن الجاي.' },
  { id: 'swapRule', group: 'extra', label: 'بدل الحكم', desc: 'ياخذ بطاقة يحتفظ فيها، ويستخدمها بجولة ثانية عشان يدور عجلة الاحكام بدون عجلة الاسماء.' },
  // maxShare: سقف مساحة الحكم في العجلة (ما له تكرار)
  { id: 'instantWin', group: 'win', label: 'فوز مباشر', desc: 'صاحب الحكم يفوز باللعبة مباشرة — فرصة ظهوره ما تتعدى 5%.', maxShare: 0.05 },
  { id: 'swapName', group: 'extra', label: 'بدل الاسم', desc: 'ياخذ بطاقة يحتفظ فيها، ويستخدمها بجولة ثانية عشان يدور عجلة الاسماء ويبقى الحكم.' },
  { id: 'kickOrShield', group: 'mixed', label: 'تطرد او تحصن', desc: 'يقدر يطرد لاعب او يهدي حصانة.' },
  { id: 'ruleOrName', group: 'mixed', label: 'احكام او اسماء', desc: 'يختار صاحب الحكم ياخذ بطاقة بدل الاسم او بدل الحكم، ويستخدمها بجولة ثانية.' },
];
const RULE_GROUPS = [
  { key: 'penalty', title: '🔻 القمع', icon: '🔻' },
  { key: 'help', title: '🛡️ المساعدات (غير إجباري)', icon: '🛡️' },
  { key: 'extra', title: '🎴 اكشنات اضافية (غير إجباري)', icon: '🎴' },
  { key: 'win', title: '🏆 فوز مباشر (غير إجباري)', icon: '🏆' },
  // "بين الاثنين" آخر شي ومطفية افتراضياً (راجع selectedRuleIds)
  { key: 'mixed', title: '⚖️ بين الاثنين (غير إجباري)', icon: '⚖️' },
];
function rulesOfGroup(group) {
  return RULES.filter((r) => r.group === group);
}
function ruleIdOf(label) {
  const found = RULES.find((r) => r.label === label);
  return found ? found.id : null;
}
// "طرد بالجملة": عدد اللي ينطردون يزيد مع عدد اللاعبين الحاليين (أول حد يتحقق من فوق)
const MASS_KICK_TIERS = [
  { minPlayers: 70, count: 5 },
  { minPlayers: 50, count: 4 },
  { minPlayers: 30, count: 3 },
  { minPlayers: 0, count: 2 },
];
function massKickCount(players) {
  return MASS_KICK_TIERS.find((t) => players >= t.minPlayers).count;
}
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#16a085', '#d35400', '#e84393'];
const ANIMAL_SHIELDS_POOL = [
  { name: 'الأسد', emoji: '🦁' }, { name: 'النمر', emoji: '🐅' }, { name: 'الفيل', emoji: '🐘' },
  { name: 'الطاووس', emoji: '🦚' }, { name: 'الذيب', emoji: '🐺' }, { name: 'الارنب', emoji: '🐰' },
  { name: 'الدب', emoji: '🐻' }, { name: 'الباندا', emoji: '🐼' }, { name: 'النحلة', emoji: '🐝' }, { name: 'الحصان', emoji: '🐎' },
  { name: 'الصقر', emoji: '🦅' }, { name: 'الثعلب', emoji: '🦊' }, { name: 'الجمل', emoji: '🐪' },
  { name: 'الغزال', emoji: '🦌' }, { name: 'القرش', emoji: '🦈' },
  { name: 'السلحفاة', emoji: '🐢' }, { name: 'الدلفين', emoji: '🐬' }, { name: 'التمساح', emoji: '🐊' }, { name: 'الزرافة', emoji: '🦒' },
];

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSpinTickSound() {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) { /* noop */ }
}

function playWinSound() {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.setValueAtTime(500, now + 0.1);
    osc.frequency.setValueAtTime(700, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch (e) { /* noop */ }
}

// ===== ذاكرة تخزين مؤقت لصور الأفاتار المستخدمة على العجلة (canvas يحتاج صورة محمّلة فعلاً قبل رسمها) =====
const avatarImageCache = new Map(); // url -> { img, loaded }
function getCachedAvatarImage(url, onLoad) {
  if (!url) return null;
  let entry = avatarImageCache.get(url);
  if (!entry) {
    const img = new Image();
    entry = { img, loaded: false };
    img.onload = () => { entry.loaded = true; if (onLoad) onLoad(); };
    img.onerror = () => { avatarImageCache.delete(url); };
    img.src = url;
    avatarImageCache.set(url, entry);
  }
  return entry.loaded ? entry.img : null;
}

// ===== حالة اللاعبين والخيارات =====
const namesInput = ref('');
let initialNamesSnapshot = '';

const availableShields = reactive([]);
const playerShields = reactive({});
// لاعبون مجمّدون (الحكم الجاي عليهم ما يتطبق) + بطاقات التدوير المحفوظة لكل لاعب { rule, name, fresh }
// fresh = بطاقات انأخذت بهالجولة (ما تنستخدم إلا من الجولة اللي بعدها)
const frozenPlayers = reactive({});
const playerChances = reactive({});
// امتيازات يعطيها المستضيف من نافذة اللاعبين وتمشي لجولة واحدة فقط { repeat, protect, skip, used }
// repeat = تكرار الاسم بالعجلة، protect = يصد طرد واحد (عادي أو برو ماكس)، skip = اسمه ما يطلع
// used = انحسبت على جولة (تنمسح مع بداية الجولة اللي بعدها)
const roundPerks = reactive({});
const MAX_NAME_REPEAT = 5;
let gameStarted = false;
const currentRound = ref(0);
let nextExplosionRound = 0;
let removedNamesHistory = [];

// رقم ثابت لكل لاعب (#1، #2 ...) ينعطى أول ما ينضم ويبقى معه طول اللعبة حتى لو انطرد
// (عشان "يرجع لاعب" يشتغل بالرقم). صاحب الحكم يكتب بالشات "#5" أو "#5 1" بدل منشن الاسم
const playerNumbers = reactive({});
let nextPlayerNumber = 1;
function assignPlayerNumbers(names) {
  names.forEach((name) => {
    if (!playerNumbers[name]) playerNumbers[name] = nextPlayerNumber++;
  });
}
function resetPlayerNumbers() {
  Object.keys(playerNumbers).forEach((name) => delete playerNumbers[name]);
  nextPlayerNumber = 1;
}
function playerTag(name) {
  return playerNumbers[name] ? `#${playerNumbers[name]}` : '';
}
function playerByNumber(num, candidates) {
  return candidates.find((name) => playerNumbers[name] === num) || null;
}

const wheels = reactive({
  names: {
    items: [], weights: [], angle: 0, isSpinning: false, type: 'names', lastWinner: null,
  },
  options: {
    items: RULES.map((r) => r.label), weights: [], angle: 0, isSpinning: false, type: 'options', lastWinner: null,
  },
});

// زوايا خانات العجلة: خانات متساوية إلا إذا للعجلة أوزان (تكرار الحكم يوسّع خانته)
function sliceArcs(wheel) {
  const n = wheel.items.length;
  const weights = wheel.weights && wheel.weights.length === n ? wheel.weights : null;
  const totalWeight = weights ? weights.reduce((sum, w) => sum + w, 0) : n;
  let start = 0;
  return wheel.items.map((_, i) => {
    const size = ((weights ? weights[i] : 1) / totalWeight) * 2 * Math.PI;
    const arc = { start, size };
    start += size;
    return arc;
  });
}
function sliceIndexAtAngle(arcs, angle) {
  const idx = arcs.findIndex((arc) => angle >= arc.start && angle < arc.start + arc.size);
  return idx === -1 ? arcs.length - 1 : idx;
}

// ===== امتيازات الجولة =====
function perkOf(name) {
  return roundPerks[name] || { repeat: 1, protect: false, skip: false };
}
function updatePerk(name, patch) {
  const perk = { ...perkOf(name), ...patch, used: false };
  if (perk.repeat <= 1 && !perk.protect && !perk.skip) delete roundPerks[name];
  else roundPerks[name] = perk;
  drawWheel('names');
}
function changeNameRepeat(name, delta) {
  const repeat = Math.min(MAX_NAME_REPEAT, Math.max(1, perkOf(name).repeat + delta));
  updatePerk(name, { repeat, skip: false });
}
function togglePerk(name, key) {
  const on = !perkOf(name)[key];
  // المستبعد ما له خانة بالعجلة، فالتكرار ما له معنى معه
  updatePerk(name, key === 'skip' && on ? { skip: true, repeat: 1 } : { [key]: on });
}
// بداية كل جولة: الاستبعاد حق الجولة اللي فاتت ينمسح، والجديد ينحسب على هالجولة.
// تكرار الاسم (زيادة الفرص) يبقى لين المستضيف يغيّره، والحماية تبقى لين تنكسر بطرد
function rollRoundPerks() {
  Object.keys(roundPerks).forEach((name) => {
    const perk = roundPerks[name];
    if (!perk.used) { perk.used = true; return; }
    if (perk.repeat > 1 || perk.protect) roundPerks[name] = { ...perk, skip: false };
    else delete roundPerks[name];
  });
}
function clearRoundPerks() {
  Object.keys(roundPerks).forEach((name) => delete roundPerks[name]);
}
// أسماء العجلة + أوزان خاناتها حسب الامتيازات (تكرار الاسم يوسّع الخانة، والمستبعد خانته صفر)
function syncNamesWheel() {
  const wheel = wheels.names;
  wheel.items = getNamesFromInput();
  const weights = wheel.items.map((name) => (perkOf(name).skip ? 0 : perkOf(name).repeat));
  // بدون امتيازات (أو الكل مستبعد): خانات متساوية
  wheel.weights = weights.every((w) => w === 1) || weights.every((w) => w === 0) ? [] : weights;
}

// ===== نافذة اختيار الأحكام: تطلع بعد التسجيل لما يضغط المستضيف "بدء اللعبة" =====
const rulesOverlayVisible = ref(false);
const rulesConfirmed = ref(false); // اللعبة بدأت
const rulesChosen = ref(false); // الأحكام انختارت (ممكن قبل تسجيل اللاعبين وقبل بدء اللعبة)
function startGame() {
  stopRegistration();
  // توزيع الحصانات من جديد بالعدد المحدد
  initializeShields();
  rulesConfirmed.value = true;
}
// زر "بدء اللعبة": لو الأحكام مختارة من قبل تبدأ اللعبة مباشرة، وإلا تطلع نافذة الأحكام أول
function openRulesOverlay() {
  if (rulesConfirmed.value) return;
  if (getNamesFromInput().length < 2) {
    window.alert('سجّل لاعبين اثنين على الأقل قبل بدء اللعبة.');
    return;
  }
  if (rulesChosen.value) { startGame(); return; }
  stopRegistration();
  rulesOverlayVisible.value = true;
}
const selectedRuleIds = ref(RULES.filter((r) => !r.maxShare && r.group !== 'mixed').map((r) => r.id));

// الضغط على عجلة الأحكام يفتح النافذة: قبل بدء اللعبة للاختيار المسبق (rulesPreselect)،
// وأثناء اللعبة للتعديل (rulesEditing). الإلغاء يرجّع الاختيارات مثل ما كانت
const rulesEditing = ref(false);
const rulesPreselect = ref(false);
let rulesEditSnapshot = null;
function editRules() {
  if (wheels.names.isSpinning || wheels.options.isSpinning || rulesOverlayVisible.value) return;
  rulesEditSnapshot = { ids: [...selectedRuleIds.value], repeats: { ...ruleRepeats }, shieldCount: manualShieldCount.value };
  if (rulesConfirmed.value) rulesEditing.value = true;
  else rulesPreselect.value = true;
  rulesOverlayVisible.value = true;
}
function cancelRulesOverlay() {
  if ((rulesEditing.value || rulesPreselect.value) && rulesEditSnapshot) {
    selectedRuleIds.value = rulesEditSnapshot.ids;
    Object.assign(ruleRepeats, rulesEditSnapshot.repeats);
    manualShieldCount.value = rulesEditSnapshot.shieldCount;
  }
  rulesEditing.value = false;
  rulesPreselect.value = false;
  rulesOverlayVisible.value = false;
}
function selectedCountOf(group) {
  return rulesOfGroup(group).filter((r) => selectedRuleIds.value.includes(r.id)).length;
}
const rulesSelectionValid = computed(() => selectedCountOf('penalty') >= 1);

// عدد الحصانات اللي يحدده المستضيف من نافذة الأحكام — 0 يعني آلي
const manualShieldCount = ref(0);
// السقف: عدد اللاعبين أو عدد الحصانات المتوفرة بالقائمة، أيهم أقل. قبل تسجيل اللاعبين
// (اختيار مسبق) السقف هو القائمة، وينقص تلقائياً لعدد اللاعبين عند التوزيع
const maxShieldCount = computed(() => {
  const players = getNamesFromInput().length;
  return players >= 2 ? Math.min(players, ANIMAL_SHIELDS_POOL.length) : ANIMAL_SHIELDS_POOL.length;
});
function changeShieldCount(delta) {
  manualShieldCount.value = Math.min(maxShieldCount.value, Math.max(0, manualShieldCount.value + delta));
}
const shieldRulesSelected = computed(() => selectedRuleIds.value.some((id) => SHIELD_RULE_IDS.includes(id)));

// مربع جنب عنوان كل فئة: يحدد القائمة كاملة أو يلغيها كلها
function isGroupAllSelected(group) {
  return selectedCountOf(group) === rulesOfGroup(group).length;
}
function toggleGroup(group) {
  const ids = rulesOfGroup(group).map((r) => r.id);
  const others = selectedRuleIds.value.filter((id) => !ids.includes(id));
  selectedRuleIds.value = isGroupAllSelected(group) ? others : [...others, ...ids];
}
// حكم واحد مختار: تختفي عجلة الأحكام ويتطبق الحكم مباشرة على اللي يطلع اسمه
const singleRule = computed(() => rulesChosen.value && wheels.options.items.length === 1);

// الحصانات شغّالة إذا في العجلة حكم يعطي حصانة (أو لاعب لسه ماسك حصانة بعد تعديل الأحكام)،
// وغير كذا ينخفي عرضها وتتوقف قنابل الحصانات
const SHIELD_RULE_IDS = ['takeShield', 'giftShield', 'kickOrShield'];
const shieldsInPlay = computed(() => wheels.options.items.some((label) => SHIELD_RULE_IDS.includes(ruleIdOf(label)))
  || Object.values(playerShields).some((s) => s && s.length > 0));
const hasFreezeOrCards = computed(() => Object.keys(frozenPlayers).length > 0
  || Object.values(playerChances).some((c) => c.rule > 0 || c.name > 0));

// تكرار الحكم: يوسّع مساحة خانة الحكم في العجلة (يزيد فرصة طلوعه)
const MAX_RULE_REPEAT = 5;
const ruleRepeats = reactive(Object.fromEntries(RULES.map((r) => [r.id, 1])));
function changeRuleRepeat(ruleId, delta) {
  ruleRepeats[ruleId] = Math.min(MAX_RULE_REPEAT, Math.max(1, ruleRepeats[ruleId] + delta));
}
// أوزان الأحكام المختارة: التكرار للأحكام العادية، والحكم اللي له سقف (maxShare) ينصغّر
// وزنه حتى ما تتعدى مساحته السقف من العجلة
function selectedRuleWeights() {
  const selected = RULES.filter((r) => selectedRuleIds.value.includes(r.id));
  const baseTotal = selected.filter((r) => !r.maxShare).reduce((sum, r) => sum + ruleRepeats[r.id], 0);
  return selected.map((r) => ({
    rule: r,
    weight: r.maxShare ? Math.min(1, (baseTotal * r.maxShare) / (1 - r.maxShare)) : ruleRepeats[r.id],
  }));
}
function groupSharePercent(group) {
  const weighted = selectedRuleWeights();
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (total === 0) return 0;
  const groupTotal = weighted.filter((w) => w.rule.group === group).reduce((sum, w) => sum + w.weight, 0);
  return Math.round((groupTotal / total) * 100);
}

function confirmRules() {
  if (!rulesSelectionValid.value) return;
  const weighted = selectedRuleWeights();
  wheels.options.items = weighted.map((w) => w.rule.label);
  wheels.options.weights = weighted.map((w) => w.weight);
  wheels.options.angle = 0;
  optionsSquareText.value = wheels.options.items[0];
  rulesOverlayVisible.value = false;
  rulesChosen.value = true;
  // النافذة انفتحت من زر "بدء اللعبة" (مو اختيار مسبق ولا تعديل أثناء اللعب): تبدأ اللعبة
  if (!rulesEditing.value && !rulesPreselect.value) startGame();
  rulesEditing.value = false;
  rulesPreselect.value = false;
  nextTick(() => drawWheel('options'));
}

const renderType = ref('circle');

const namesCanvasRef = ref(null);
const optionsCanvasRef = ref(null);
const namesSquareText = ref('في انتظار البدء...');
const optionsSquareText = ref('اختر الأحكام');
const playerCountNum = ref(0);

const winnerSpan = ref('النتيجة: بانتظار التدوير');
const optionsResultText = ref('النتيجة: بانتظار التدوير');
const namesResultShow = ref(false);
const optionsResultShow = ref(false);
const deleteWinnerVisible = ref(false);
const spinAllDisabled = ref(false);

const announcementMsg = ref('');
const announcementVisible = ref(false);

const winnerOverlayVisible = ref(false);
const winnerOverlayText = ref('🏆 لقد فاز!');

const actionContainerVisible = ref(false);
const otherPlayerOptions = ref([]);
const otherPlayerSelected = ref('');

// نافذة اختيار اللاعب بدل القائمة المنسدلة: الشبكة تنقسم أعمدة وصفوف حسب عدد الأسماء
// عشان كلها تبان بنفس الشاشة بدون تمرير، والخط يصغر كل ما زاد العدد
const targetPickerVisible = ref(false);

function shieldCountOf(name) {
  return playerShields[name] ? playerShields[name].length : 0;
}
function hasShield(name) {
  return shieldCountOf(name) > 0;
}
const targetOptions = computed(() => otherPlayerOptions.value.filter((o) => o.value));
const selectedTargetLabel = computed(() => {
  const opt = otherPlayerOptions.value.find((o) => o.value === otherPlayerSelected.value);
  return opt ? opt.label : (otherPlayerOptions.value[0]?.label || '');
});
const targetGridStyle = computed(() => {
  const n = Math.max(targetOptions.value.length, 1);
  // 6 أسماء بالسطر، والباقي ينزل سطور تحت — فوق 60 اسم يصير 8 بالسطر عشان الكل يبان بدون تمرير
  const cols = Math.min(n, n > 60 ? 8 : 6);
  const rows = Math.ceil(n / cols);
  const fontRem = rows <= 4 ? 1.05 : rows <= 6 ? 0.95 : rows <= 10 ? 0.85 : 0.72;
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    // الصف ياخذ ارتفاع محتواه (صورة + اسم سطرين + الرقم) عشان الاسم ما ينقص من فوق وتحت
    gridTemplateRows: `repeat(${rows}, auto)`,
    maxHeight: 'calc(100vh - 150px)',
    fontSize: `${fontRem}rem`,
  };
});

function openTargetPicker() {
  if (!targetOptions.value.length) return;
  targetPickerVisible.value = true;
}

function closeTargetPicker() {
  targetPickerVisible.value = false;
}

function pickTarget(value) {
  otherPlayerSelected.value = value;
  targetPickerVisible.value = false;
}

// لو انختار اللاعب أو نُفّذ الحكم من الشات والنافذة مفتوحة: نسكرها فعلياً،
// وإلا تختفي بصرياً وتبقى مفتوحة بالحالة فتعلّق المسافة (الدوران)
watch(actionContainerVisible, (v) => { if (!v) targetPickerVisible.value = false; });
watch(otherPlayerSelected, () => { targetPickerVisible.value = false; });

const mentionNote = ref('');
const primaryBtnVisible = ref(false);
const primaryBtnClass = ref('action-btn');
const primaryBtnText = ref('');
const secondaryBtnVisible = ref(false);
const secondaryBtnClass = ref('action-btn free');
const secondaryBtnText = ref('');

// الحد الأقصى للاعبين (خط أسماء العجلة يصغر كل ما زاد العدد عشان الخانات الرفيعة تبقى مقروءة)
const MAX_PLAYERS = 100;

function getNamesFromInput() {
  return namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0).slice(0, MAX_PLAYERS);
}

function isPlayersFull() {
  return getNamesFromInput().length >= MAX_PLAYERS;
}

let playersFullNotified = false;
function notifyPlayersFull() {
  // التنبيه يطلع مرة وحدة لين ينفضى مكان، عشان ما يتكرر مع كل محاولة انضمام
  if (playersFullNotified) return;
  playersFullNotified = true;
  showAnnouncement(`🚫 وصلنا ${MAX_PLAYERS} لاعب — لا يوجد خانات إضافية في العجلة.`);
}

function updatePlayerCount() {
  const names = getNamesFromInput();
  assignPlayerNumbers(names);
  playerCountNum.value = names.length;
}

// عجلة الخيارات كلاسيكية في وضعي "عجلة" و"دوائر"، وتتحول لعرض النتيجة فقط مع
// عجلة الأسماء في وضع "عرض النتيجة فقط"
// "grid" = مربعات الأسماء (نفس عجلة مهدي): يستخدم نفس شريط الإضاءة المتنقل حق الدوائر
const RENDER_TYPE_ORDER = ['circle', 'square', 'avatars', 'grid'];
const RENDER_TYPE_LABELS = {
  circle: '🎡 عجلة', square: '🟨 عرض النتيجة فقط', avatars: '🖼️ دوائر', grid: '🔲 مربعات',
};
const usesNamesChase = computed(() => renderType.value === 'avatars' || renderType.value === 'grid');
function toggleRenderType() {
  const currentIdx = RENDER_TYPE_ORDER.indexOf(renderType.value);
  const value = RENDER_TYPE_ORDER[(currentIdx + 1) % RENDER_TYPE_ORDER.length];
  renderType.value = value;
  nextTick(() => {
    if (value === 'square') {
      const namesItems = getNamesFromInput();
      namesSquareText.value = namesItems.length > 0 ? namesItems[0] : 'فارغ';
      optionsSquareText.value = rulesChosen.value ? wheels.options.items[0] : 'اختر الأحكام';
    } else {
      if (value === 'circle') drawWheel('names');
      drawWheel('options');
    }
  });
}

// ===== وضع "دوائر الأفاتار" (لعجلة الأسماء فقط — الخيارات تبقى عجلة كلاسيكية دائماً):
// حلقة أفاتارات ثابتة المواقع (بدون دوران)، ويتنقل "شريط إضاءة" بينها بسرعة تتباطأ
// تدريجياً حتى يستقر على الفائز ويُبرزه بتوهج، بنفس أسلوب حلقة عجلة مهدي =====
function buildRingItems(items) {
  const n = items.length;
  if (n === 0) return [];
  const arcSize = (2 * Math.PI) / n;
  const radius = n <= 6 ? 105 : n <= 12 ? 100 : n <= 20 ? 92 : n <= 50 ? 82 : 128;
  // فوق 50 الدوائر تتوزع على حافة أوسع وتصغر — العدد الكبير يبان أوضح بشكل المربعات
  const size = n <= 6 ? 54 : n <= 12 ? 46 : n <= 20 ? 38 : n <= 50 ? 30 : n <= 75 ? 13 : 9;
  return items.map((name, i) => {
    const centerRad = i * arcSize + arcSize / 2;
    const x = radius * Math.cos(centerRad);
    const y = radius * Math.sin(centerRad);
    const cleanName = String(name || '').trim();
    return {
      name: cleanName,
      avatar: nameAvatars[name] || getUserAvatar(name) || null,
      initial: cleanName.charAt(0).toUpperCase() || '?',
      size,
      style: `left: calc(50% + ${x}px); top: calc(50% + ${y}px); transform: translate(-50%, -50%);`,
    };
  });
}
const namesRingItems = computed(() => buildRingItems(wheels.names.items));

let namesRingChaseTimer = null;
const namesRingActiveIndex = ref(-1);
const namesRingWinnerIndex = ref(-1);

function stopNamesRingChase() {
  if (namesRingChaseTimer !== null) {
    clearTimeout(namesRingChaseTimer);
    namesRingChaseTimer = null;
  }
}

function finishNamesRingSpin(pickIndex, resolve) {
  const wheel = wheels.names;
  wheel.isSpinning = false;
  const winner = wheel.items[pickIndex];
  wheel.lastWinner = winner;
  playWinSound();
  namesResultShow.value = true;
  deleteWinnerVisible.value = true;
  updateCombinedNamesResult();
  const currentNames = getNamesFromInput();
  if (currentNames.length === 1) {
    showWinnerOverlay(currentNames[0]);
  } else {
    const currentOption = wheels.options.lastWinner;
    if (currentOption) setupActionUI(currentOption, winner);
  }
  resolve(winner);
}

function spinNamesRing() {
  return new Promise((resolve) => {
    if (!gameStarted) initializeShields();
    const wheel = wheels.names;
    syncNamesWheel();
    if (wheel.isSpinning || wheel.items.length === 0) { resolve(null); return; }

    wheel.isSpinning = true;
    winnerSpan.value = 'جاري الاختيار...';
    actionContainerVisible.value = false;
    namesResultShow.value = false;
    deleteWinnerVisible.value = false;
    namesRingWinnerIndex.value = -1;
    stopNamesRingChase();

    const n = wheel.items.length;
    // زاوية عشوائية على خانات العجلة حتى تنحسب أوزان الامتيازات
    const pickIndex = sliceIndexAtAngle(sliceArcs(wheel), Math.random() * 2 * Math.PI);
    const durationMs = 4300;
    const totalLoops = 4;
    const totalDistance = n * totalLoops + pickIndex;
    const startTime = Date.now();
    const stepMs = 40;

    function tick() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - t) ** 3;
      // ceil بدل floor: الذيل البطيء للتباطؤ يثبت على الفائز نفسه بدل اللي قبله
      const currentDistance = Math.ceil(eased * totalDistance);
      namesRingActiveIndex.value = currentDistance % n;
      if (t < 1) {
        namesRingChaseTimer = setTimeout(tick, stepMs);
      } else {
        namesRingChaseTimer = null;
        namesRingActiveIndex.value = pickIndex;
        namesRingWinnerIndex.value = pickIndex;
        finishNamesRingSpin(pickIndex, resolve);
      }
    }
    tick();
  });
}

function updateShieldsDisplay() {
  // مجرد إعادة رسم — الحالة نفسها (availableShields/playerShields) تفاعلية بالفعل
}

function initializeShields() {
  const names = getNamesFromInput();
  // عدد الحصانات: اللي حدده المستضيف، أو آلي (عشوائي كل لعبة بين 25% و40% من عدد اللاعبين)
  const ratio = 0.25 + Math.random() * 0.15;
  const count = manualShieldCount.value > 0 ? manualShieldCount.value : Math.max(1, Math.round(names.length * ratio));
  const shuffled = [...ANIMAL_SHIELDS_POOL].sort(() => 0.5 - Math.random());
  availableShields.splice(0, availableShields.length, ...shuffled.slice(0, Math.min(count, names.length, shuffled.length)));
  Object.keys(playerShields).forEach((k) => delete playerShields[k]);
  names.forEach((name) => { playerShields[name] = []; });
  Object.keys(frozenPlayers).forEach((k) => delete frozenPlayers[k]);
  Object.keys(playerChances).forEach((k) => delete playerChances[k]);
  pendingAuto = null;
  gameStarted = true;
  currentRound.value = 0;
  nextExplosionRound = 0;
  hideAnnouncement();
}

// إعلان الحصانات يطلع عائم تحت بمكان إعلان الموقع، ويوقف إعلان الموقع طول ما هو ظاهر
const ANNOUNCEMENT_DURATION = 10 * 1000;
let announcementTimer = null;

function showAnnouncement(msg) {
  announcementMsg.value = msg;
  announcementVisible.value = true;
  siteAdPaused.value = true;
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(hideAnnouncement, ANNOUNCEMENT_DURATION);
}
function hideAnnouncement() {
  clearTimeout(announcementTimer);
  announcementVisible.value = false;
  siteAdPaused.value = false;
}

function countTotalActiveShields() {
  let total = availableShields.length;
  Object.values(playerShields).forEach((s) => { if (s) total += s.length; });
  return total;
}

function destroyOneRandomShield() {
  const activeLocations = [];
  if (availableShields.length > 0) activeLocations.push({ type: 'bank' });
  Object.keys(playerShields).forEach((player) => {
    if (playerShields[player] && playerShields[player].length > 0) activeLocations.push({ type: 'player', player });
  });
  if (activeLocations.length === 0) return null;

  const chosenLoc = activeLocations[Math.floor(Math.random() * activeLocations.length)];
  let destroyedShield = null;

  if (chosenLoc.type === 'bank') {
    destroyedShield = availableShields.splice(Math.floor(Math.random() * availableShields.length), 1)[0];
    return `💣💥 انفجار! تم تدمير حصانة (${destroyedShield.emoji} ${destroyedShield.name}) من الحصانات المتاحة!`;
  }
  destroyedShield = playerShields[chosenLoc.player].splice(Math.floor(Math.random() * playerShields[chosenLoc.player].length), 1)[0];
  return `💣💥 انفجار! تم تدمير حصانة (${destroyedShield.emoji} ${destroyedShield.name}) المملوكة للاعب ${nameText(chosenLoc.player)}!`;
}

function checkShieldDestructionEvents() {
  if (!shieldsInPlay.value) { hideAnnouncement(); return; }
  const totalShields = countTotalActiveShields();
  if (totalShields <= 1) { hideAnnouncement(); return; }

  if (currentRound.value === 8) {
    nextExplosionRound = 10;
    showAnnouncement('🚨 تحذير عاجل من الجولة 8: انطلقت القنابل! سيحدث أول انفجار للحصانات في الجولة 10! 💣💥');
    return;
  }

  if (nextExplosionRound > 0 && currentRound.value === nextExplosionRound - 2) {
    showAnnouncement(`⚠️ تنبيه: القنبلة قادمة بشكل عشوائي بعد جولتين في الجولة (${nextExplosionRound})! استعدوا للانفجار 💣💥`);
    return;
  }

  if (nextExplosionRound > 0 && currentRound.value === nextExplosionRound) {
    const destroyMsg = destroyOneRandomShield();
    const remaining = countTotalActiveShields();
    if (destroyMsg) {
      drawWheel('names');
      if (remaining > 1) {
        const interval = Math.floor(Math.random() * 4) + 2;
        nextExplosionRound = currentRound.value + interval;
        showAnnouncement(`🔥 ${destroyMsg}\n✨ متبقي (${remaining}) حصانات. الانفجار القادم تم ضبطه عشوائياً! 💣`);
      } else {
        nextExplosionRound = 0;
        showAnnouncement(`🔥 ${destroyMsg}\n✨ تم تدمير الحصانات وتوقفت القنابل لتبقي حصانة واحدة فقط في اللعبة! 🛡️`);
      }
    }
  }
}

function updatePlayerSelect(filterType, excludeName = '') {
  const allNames = getNamesFromInput();
  let filteredNames = [];

  if (filterType === 'all_except') {
    filteredNames = allNames.filter((name) => name !== excludeName);
  } else if (filterType === 'has_shield') {
    filteredNames = allNames.filter((name) => playerShields[name] && playerShields[name].length > 0);
  } else if (filterType === 'no_shield') {
    filteredNames = allNames.filter((name) => !playerShields[name] || playerShields[name].length === 0);
  } else {
    filteredNames = allNames;
  }

  if (filteredNames.length === 0) {
    otherPlayerOptions.value = [{ value: '', label: 'لا توجد خيارات متاحة' }];
    otherPlayerSelected.value = '';
    return;
  }

  otherPlayerOptions.value = filteredNames.map((name) => {
    const shieldCount = playerShields[name] ? playerShields[name].length : 0;
    return { value: name, label: `${playerTag(name)} ${nameText(name)} (حصانات: ${shieldCount})` };
  });
  otherPlayerSelected.value = otherPlayerOptions.value[0].value;
}

function drawWheel(wheelKey) {
  const wheel = wheels[wheelKey];
  if (wheel.type === 'names') updatePlayerCount();
  if (effectiveRenderType(wheelKey) === 'square') return;
  if (wheel.type === 'names') syncNamesWheel();

  const canvas = wheelKey === 'names' ? namesCanvasRef.value : optionsCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { items } = wheel;
  const total = items.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // عجلة الأحكام تبقى فاضية (نفس شكل عجلة الأسماء الفاضية) لين يختار المستضيف الأحكام
  const awaitingRules = wheel.type === 'options' && !rulesChosen.value;
  if (total === 0 || awaitingRules) {
    ctx.fillStyle = '#fff'; ctx.font = '14px AppEmoji, Tahoma'; ctx.textAlign = 'center';
    ctx.fillText(awaitingRules ? 'اختر الأحكام' : 'أدخل بيانات', canvas.width / 2, canvas.height / 2);
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = canvas.width / 2 - 10;
  const arcs = sliceArcs(wheel);
  const sliceColors = assignWheelColors(total, COLORS);
  ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(wheel.angle);

  for (let i = 0; i < total; i++) {
    const angle = arcs[i].start;
    const arcSize = arcs[i].size;
    if (arcSize === 0) continue; // مستبعد من هالجولة
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, angle, angle + arcSize); ctx.closePath();
    ctx.fillStyle = sliceColors[i]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.save(); ctx.rotate(angle + arcSize / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    const fontSize = total > 70 ? 6 : total > 50 ? 7 : total > 35 ? 9 : total > 20 ? 11 : 13;
    ctx.font = `bold ${fontSize}px AppEmoji, Tahoma`;
    let text = displayName(items[i]);
    let avatarUrl = null;
    if (wheel.type === 'names') {
      const pShields = playerShields[items[i]];
      if (pShields && pShields.length > 0) {
        const emojis = pShields.map((s) => s.emoji).join('');
        text = `${emojis} ${text}`;
      }
      if (frozenPlayers[items[i]]) text = `🧊 ${text}`;
      if (perkOf(items[i]).protect) text = `🔰 ${text}`;
      if (playerTag(items[i])) text = `${playerTag(items[i])} ${text}`;
      avatarUrl = avatarOrLogo(nameAvatars[items[i]] || getUserAvatar(items[i]));
    }
    if (text.length > 18) text = `${text.substring(0, 15)}...`;

    if (avatarUrl) {
      const avatarR = Math.min(16, Math.max(9, radius * 0.09));
      const avatarCx = Math.max(radius * 0.32, avatarR + 6);
      const img = getCachedAvatarImage(avatarUrl, () => drawWheel(wheelKey));
      if (img) {
        ctx.save();
        ctx.translate(avatarCx, 0);
        ctx.rotate(-(wheel.angle + angle + arcSize / 2));
        ctx.beginPath();
        ctx.arc(0, 0, avatarR, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, -avatarR, -avatarR, avatarR * 2, avatarR * 2);
        ctx.restore();
        ctx.save();
        ctx.translate(avatarCx, 0);
        ctx.beginPath();
        ctx.arc(0, 0, avatarR, 0, 2 * Math.PI);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
    }

    ctx.fillText(text, radius - 15, 5);
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI); ctx.fillStyle = '#2c3e50'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
}

function updateCombinedNamesResult() {
  const nameWinner = wheels.names.lastWinner;
  if (!nameWinner) return;
  const optionWinner = wheels.options.lastWinner;
  winnerSpan.value = optionWinner ? `النتيجة: ${nameText(nameWinner)} - ${optionWinner}` : `النتيجة: ${nameText(nameWinner)}`;
}

// عدد مرات الطرد المتبقية لحكم "طرد بالجملة" في الدور الحالي
let multiKickRemaining = 0;
let multiKickTotal = 0;

// أحكام ما تحتاج اختيار لاعب (تجميد/بدل الحكم/بدل الاسم): تبقى معلّقة لين يأكدها المقدم أو تبدأ
// الجولة الجاية، حتى لو استخدم اللاعب بطاقة تبديل تنلغي وما تتطبق عليه
const AUTO_RULE_IDS = ['freeze', 'swapRule', 'swapName'];
let pendingAuto = null; // { id, player }

function applyPendingAuto() {
  const pending = pendingAuto;
  pendingAuto = null;
  if (!pending || !getNamesFromInput().includes(pending.player)) return;
  if (pending.id === 'freeze') {
    frozenPlayers[pending.player] = true;
    appendWinnerSpan(` | 🧊 تم تجميد الاكشن الجاي لـ ${pending.player}`);
    drawWheel('names');
  } else if (pending.id === 'swapRule') {
    addChance(pending.player, 'rule');
    appendWinnerSpan(` | 🎟️ ${pending.player} أخذ بطاقة "بدل الحكم" — يستخدمها بجولة ثانية`);
  } else if (pending.id === 'swapName') {
    addChance(pending.player, 'name');
    appendWinnerSpan(` | 🎟️ ${pending.player} أخذ بطاقة "بدل الاسم" — يستخدمها بجولة ثانية`);
  }
}

function addChance(playerName, type) {
  if (!playerChances[playerName]) playerChances[playerName] = { rule: 0, name: 0, fresh: { round: 0, rule: 0, name: 0 } };
  const chances = playerChances[playerName];
  if (chances.fresh.round !== currentRound.value) chances.fresh = { round: currentRound.value, rule: 0, name: 0 };
  chances[type]++;
  chances.fresh[type]++;
}

// البطاقات اللي يقدر يستخدمها الحين (بدون اللي أخذها بنفس الجولة)
function usableChances(chances, type) {
  if (!chances) return 0;
  const fresh = chances.fresh.round === currentRound.value ? chances.fresh[type] : 0;
  return chances[type] - fresh;
}

function clearPlayerState(playerName) {
  delete frozenPlayers[playerName];
  delete playerChances[playerName];
  delete roundPerks[playerName];
}

function setupActionUI(option, winnerName) {
  actionContainerVisible.value = false;
  primaryBtnVisible.value = false;
  secondaryBtnVisible.value = false;
  otherPlayerOptions.value = [];
  mentionNote.value = '';
  pendingAuto = null;

  if (!option || !winnerName) return;

  // اللاعب المجمّد: ينحرق التجميد وما يتطبق عليه الحكم (ولا يقدر يستخدم فرصه)
  if (frozenPlayers[winnerName]) {
    delete frozenPlayers[winnerName];
    appendWinnerSpan(` | 🧊 ${nameText(winnerName)} مجمّد — ممنوع يطبق هذا الحكم.`);
    drawWheel('names');
    return;
  }

  actionContainerVisible.value = true;

  switch (ruleIdOf(option)) {
    case 'selfOut':
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = `🗑️ طرد ${nameText(winnerName)}`;
      break;
    case 'kick':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = '🗑️ طرد اللاعب المختار';
      break;
    case 'outAndKick':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = `🗑️ طرد ${nameText(winnerName)} واللاعب المختار`;
      break;
    case 'massKick':
      multiKickTotal = massKickCount(getNamesFromInput().length);
      multiKickRemaining = multiKickTotal;
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = `🗑️ طرد اللاعب المختار (1 من ${multiKickTotal})`;
      break;
    case 'forceKick':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = '💥 طرد برو ماكس للاعب المختار';
      break;
    case 'instantWin':
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = `🏆 إعلان فوز ${nameText(winnerName)}`;
      break;
    case 'freeze':
      pendingAuto = { id: 'freeze', player: winnerName };
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn free';
      primaryBtnText.value = `🧊 تجميد الاكشن الجاي لـ ${nameText(winnerName)}`;
      break;
    case 'takeShield':
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = `🛡️ أخذ حصانة لـ ${nameText(winnerName)}`;
      break;
    case 'giftShield':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = '🛡️ إهداء حصانة';
      break;
    case 'revive':
      if (removedNamesHistory.length === 0) {
        appendWinnerSpan(' | لا يوجد لاعب لإرجاعه (تم التخطي).');
        break;
      }
      otherPlayerOptions.value = removedNamesHistory.map((name) => ({ value: name, label: `${playerTag(name)} ${nameText(name)}` }));
      otherPlayerSelected.value = otherPlayerOptions.value[0].value;
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = '↩️ إرجاع اللاعب المختار';
      break;
    case 'swapRule':
      pendingAuto = { id: 'swapRule', player: winnerName };
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn free';
      primaryBtnText.value = '🎟️ أخذ بطاقة بدل الحكم';
      break;
    case 'swapName':
      pendingAuto = { id: 'swapName', player: winnerName };
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn free';
      primaryBtnText.value = '🎟️ أخذ بطاقة بدل الاسم';
      break;
    case 'kickOrShield':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = '🗑️ طرد اللاعب المختار';
      secondaryBtnVisible.value = true;
      secondaryBtnClass.value = 'action-btn shield';
      secondaryBtnText.value = '🛡️ إهداء حصانة للمختار';
      break;
    case 'ruleOrName':
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn free';
      primaryBtnText.value = '🎟️ بطاقة بدل الحكم';
      secondaryBtnVisible.value = true;
      secondaryBtnClass.value = 'action-btn free';
      secondaryBtnText.value = '🎟️ بطاقة بدل الاسم';
      break;
    default:
      break;
  }
}

function appendWinnerSpan(text) {
  winnerSpan.value += text;
}

// بطاقات صاحب الدور الحالي الجاهزة للاستخدام (تظهر كأزرار يقدر يستخدمها قبل تطبيق الحكم)
const winnerChances = computed(() => {
  const chances = playerChances[wheels.names.lastWinner];
  // بطاقة بدل الحكم ما لها فايدة إذا في العجلة حكم واحد
  return { rule: singleRule.value ? 0 : usableChances(chances, 'rule'), name: usableChances(chances, 'name') };
});

// الأزرار الظاهرة حالياً بترتيبها على الشاشة — رقم كل زر هو ترتيبه بينها
const actionButtons = computed(() => {
  const list = [];
  if (primaryBtnVisible.value) list.push('primary');
  if (secondaryBtnVisible.value) list.push('secondary');
  if (winnerChances.value.rule > 0) list.push('cardRule');
  if (winnerChances.value.name > 0) list.push('cardName');
  return list;
});
function actionNum(key) {
  return actionButtons.value.indexOf(key) + 1;
}
function runActionButton(key) {
  if (key === 'primary') executePrimaryAction();
  else if (key === 'secondary') executeSecondaryAction();
  else if (key === 'cardRule') useChance('rule');
  else if (key === 'cardName') useChance('name');
}

async function useChance(type) {
  const winner = wheels.names.lastWinner;
  const chances = playerChances[winner];
  if (!winner || !wheels.options.lastWinner || usableChances(chances, type) <= 0) return;
  if (spinAllDisabled.value) return;

  chances[type]--;
  // البطاقة توقف الحكم الحالي: أي حكم معلّق (تجميد/فرصة) ينلغي
  pendingAuto = null;
  spinAllDisabled.value = true;
  actionContainerVisible.value = false;

  if (type === 'rule') await spinWheelPromise('options');
  else if (usesNamesChase.value) await spinNamesRing();
  else await spinWheelPromise('names');

  flushPendingLeaves();
  if (!winnerOverlayVisible.value) spinAllDisabled.value = false;
}

// keepName: طرد يتجاوز الحصانة لكن الاسم ينحفظ مع المطرودين (يرجع بحكم/هدية أو باللعبة الجاية)
function forceRemovePlayer(playerName, { keepName = false } = {}) {
  if (!playerName) return;
  clearPlayerState(playerName);
  if (keepName && !removedNamesHistory.includes(playerName)) removedNamesHistory.push(playerName);

  if (playerShields[playerName] && playerShields[playerName].length > 0) {
    availableShields.push(...playerShields[playerName]);
    playerShields[playerName] = [];
  }

  // المحذوف (بدون keepName) ما ينضاف لقائمة المطرودين، فما يرجع بحكم "يرجع لاعب" ولا بهدية الرجعة
  const currentNames = getNamesFromInput().filter((name) => name !== playerName);
  delete playerShields[playerName];

  namesInput.value = currentNames.join('\n');
  drawWheel('names');

  if (currentNames.length === 1) {
    showWinnerOverlay(currentNames[0]);
  } else if (currentNames.length === 0) {
    showWinnerOverlay(null);
  }
}

function removePlayerSafely(playerName) {
  if (!playerName) return;

  // حماية المستضيف: تصد طرد واحد (قبل ما تنكسر حصانته) ثم تنحرق
  if (perkOf(playerName).protect) {
    updatePerk(playerName, { protect: false });
    appendWinnerSpan(` | 🔰 ${nameText(playerName)} محمي من المستضيف — انصد الطرد وانحرقت الحماية.`);
    return;
  }

  if (playerShields[playerName] && playerShields[playerName].length > 0) {
    const brokenShield = playerShields[playerName].pop();
    availableShields.push(brokenShield);
    appendWinnerSpan(` | 🛡️ ${nameText(playerName)} كان محمياً بـ (${brokenShield.emoji} ${brokenShield.name})! تم كسر الحصانة وإعادتها للبنك ولم يُطرد.`);
    drawWheel('names');
    return;
  }

  clearPlayerState(playerName);
  removedNamesHistory.push(playerName);
  const currentNames = getNamesFromInput().filter((name) => name !== playerName);
  delete playerShields[playerName];

  namesInput.value = currentNames.join('\n');
  drawWheel('names');

  if (currentNames.length === 1) {
    showWinnerOverlay(currentNames[0]);
  } else if (currentNames.length === 0) {
    showWinnerOverlay(null);
  }
}

function showWinnerOverlay(name) {
  winnerOverlayText.value = name ? `🏆 اللاعب الفائز هو: ${nameText(name)} 🎉` : '⚠️ انتهت اللعبة ولم يتبقَ أي لاعب!';
  winnerOverlayVisible.value = true;
  spinAllDisabled.value = true;
}
function hideWinnerOverlay() {
  winnerOverlayVisible.value = false;
}

function deleteWinningPlayer() {
  trackKicks(runDeleteWinningPlayer, '🗑️ حذف الفائز', { byHost: true });
}

function runDeleteWinningPlayer() {
  const winner = wheels.names.lastWinner;
  if (!winner) return;
  const hadShield = playerShields[winner] && playerShields[winner].length > 0;
  forceRemovePlayer(winner);
  appendWinnerSpan(hadShield
    ? ` | 🗑️ تم حذف اللاعب ${nameText(winner)} نهائياً وإرجاع حصانته للبنك.`
    : ` | 🗑️ تم حذف اللاعب: ${nameText(winner)}`);
  deleteWinnerVisible.value = false;
  actionContainerVisible.value = false;
  wheels.names.lastWinner = null;

  const remaining = getNamesFromInput();
  if (remaining.length > 1) spinAllDisabled.value = false;
}

// الخيارات لا تملك مفهوم "أفاتار" (مو أشخاص)، فتبقى بوضع عرض النتيجة النصي حتى لو
// كان الوضع العام "دوائر" — عجلة الأسماء فقط تحصل على الحلقة (عبر spinNamesRing)
// عجلة الخيارات تبقى عجلة كلاسيكية (canvas) في وضعي "عجلة" و"دوائر أفاتار"، وتتحول
// لعرض النتيجة النصي فقط عندما تكون عجلة الأسماء بوضع "عرض النتيجة فقط"
function effectiveRenderType(wheelKey) {
  if (wheelKey === 'options') return renderType.value === 'square' ? 'square' : 'circle';
  return renderType.value;
}

function spinWheelPromise(wheelKey) {
  return new Promise((resolve) => {
    if (!gameStarted && wheelKey === 'names') initializeShields();
    const wheel = wheels[wheelKey];
    if (wheel.type === 'names') syncNamesWheel();
    if (wheel.isSpinning || wheel.items.length === 0) { resolve(null); return; }

    wheel.isSpinning = true;
    const effType = effectiveRenderType(wheelKey);

    if (wheel.type === 'names') {
      winnerSpan.value = 'جاري التدوير...';
      actionContainerVisible.value = false;
      namesResultShow.value = false;
      deleteWinnerVisible.value = false;
    } else {
      optionsResultText.value = 'جاري التدوير...';
      optionsResultShow.value = false;
    }

    const total = wheel.items.length;
    const arcSize = (2 * Math.PI) / total;
    const arcs = sliceArcs(wheel);
    const targetAngle = wheel.angle + ((Math.floor(Math.random() * 5) + 5) * 2 * Math.PI) + (Math.random() * (2 * Math.PI));
    const startAngle = wheel.angle;
    const startTime = performance.now();
    let lastTickAngle = startAngle;

    function animate(currentTime) {
      const progress = Math.min((currentTime - startTime) / 4000, 1);
      wheel.angle = startAngle + (targetAngle - startAngle) * (1 - (1 - progress) ** 3);

      if (effType === 'square') {
        const randomIdx = Math.floor(Math.random() * total);
        if (wheelKey === 'names') namesSquareText.value = wheel.items[randomIdx];
        else optionsSquareText.value = wheel.items[randomIdx];
      }
      if (Math.abs(wheel.angle - lastTickAngle) > (arcSize / 2)) { playSpinTickSound(); lastTickAngle = wheel.angle; }
      if (effType === 'circle') drawWheel(wheelKey);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        wheel.isSpinning = false;
        // وضع "عرض النتيجة فقط": زاوية عشوائية حتى تنحسب أوزان الخانات برضه
        const pointerAngle = effType === 'circle'
          ? (2 * Math.PI - (wheel.angle % (2 * Math.PI))) % (2 * Math.PI)
          : Math.random() * 2 * Math.PI;
        const winner = wheel.items[sliceIndexAtAngle(arcs, pointerAngle)];
        if (effType === 'square') {
          if (wheelKey === 'names') namesSquareText.value = winner;
          else optionsSquareText.value = winner;
        }

        wheel.lastWinner = winner;
        playWinSound();

        if (wheel.type === 'names') {
          namesResultShow.value = true;
          deleteWinnerVisible.value = true;
          updateCombinedNamesResult();
          const currentNames = getNamesFromInput();
          if (currentNames.length === 1) {
            showWinnerOverlay(currentNames[0]);
          } else {
            const currentOption = wheels.options.lastWinner;
            if (currentOption) setupActionUI(currentOption, winner);
          }
        } else {
          optionsResultText.value = `النتيجة: ${nameText(winner)}`;
          optionsResultShow.value = true;
          updateCombinedNamesResult();
          if (wheels.names.lastWinner) setupActionUI(winner, wheels.names.lastWinner);
        }
        resolve(winner);
      }
    }
    requestAnimationFrame(animate);
  });
}

// ===== سجل الطرد: كل ضغطة زر حكم (أو حذف الفائز) طلع منها طرد فعلي تنضاف للسجل،
// والمستضيف يقدر يلغي أي طرد منه. السجل ينمسح مع لعبة جديدة
const kickLog = ref([]); // { round, kicker, victim, rule }
const kickLogVisible = ref(false);

// يشغّل زر الحكم ويقارن الأسماء قبل وبعد: أي اسم اختفى = انطرد
// byHost: الطرد من المستضيف (حذف الفائز) — ينكتب بالسجل "المستضيف حذف" بدل اسم صاحب الحكم
function trackKicks(action, ruleLabel, { byHost = false } = {}) {
  const kicker = wheels.names.lastWinner;
  const namesBefore = getNamesFromInput();
  action();
  const namesAfter = new Set(getNamesFromInput());
  const kicked = namesBefore.filter((n) => !namesAfter.has(n));
  if (!kicked.length) return;
  kicked.forEach((victim) => {
    kickLog.value.push({
      round: currentRound.value, kicker, victim, rule: ruleLabel, byHost, cancelled: false,
    });
  });
}

// إلغاء طرد (أو حذف) من السجل: اللاعب يرجع للعجلة برقمه، والسطر ينعلّم "ملغي".
// الحصانات اللي رجعت للبنك وقت الطرد ما ترجع معه
function cancelKickFromLog(entry) {
  if (!entry || entry.cancelled) return;
  const name = entry.victim;
  const currentNames = getNamesFromInput();
  if (!currentNames.includes(name)) {
    if (currentNames.length >= MAX_PLAYERS) { notifyPlayersFull(); return; }
    removedNamesHistory = removedNamesHistory.filter((n) => n !== name);
    currentNames.push(name);
    namesInput.value = currentNames.join('\n');
    if (!playerShields[name]) playerShields[name] = [];
    drawWheel('names');
  }
  entry.cancelled = true;
  appendWinnerSpan(` | ↩️ المستضيف ألغى طرد ${nameText(name)} — رجع للعبة`);
  // الطرد كان منهي اللعبة: يرجع اللعب
  if (winnerOverlayVisible.value && getNamesFromInput().length > 1) {
    hideWinnerOverlay();
    spinAllDisabled.value = false;
  }
}

function executePrimaryAction() {
  trackKicks(runPrimaryAction, wheels.options.lastWinner);
}

function executeSecondaryAction() {
  trackKicks(runSecondaryAction, wheels.options.lastWinner);
}

function runPrimaryAction() {
  const option = wheels.options.lastWinner;
  const winner = wheels.names.lastWinner;
  const target = otherPlayerSelected.value;

  if (!option || !winner) return;
  const ruleId = ruleIdOf(option);

  if (ruleId === 'kick') {
    removePlayerSafely(target);
    appendWinnerSpan(` | تم طرد اللاعب: ${nameText(target)}`);
  } else if (ruleId === 'massKick') {
    removePlayerSafely(target);
    appendWinnerSpan(` | تم طرد اللاعب: ${nameText(target)}`);
    multiKickRemaining--;
    const others = getNamesFromInput().filter((name) => name !== winner);
    if (multiKickRemaining > 0 && others.length > 0 && !winnerOverlayVisible.value) {
      updatePlayerSelect('all_except', winner);
      mentionNote.value = '';
      primaryBtnText.value = `🗑️ طرد اللاعب المختار (${multiKickTotal - multiKickRemaining + 1} من ${multiKickTotal})`;
      return;
    }
  } else if (AUTO_RULE_IDS.includes(ruleId)) {
    applyPendingAuto();
  } else if (ruleId === 'instantWin') {
    appendWinnerSpan(` | 🏆 فوز مباشر لـ ${nameText(winner)}`);
    showWinnerOverlay(winner);
  } else if (ruleId === 'forceKick') {
    if (target && perkOf(target).protect) {
      // حماية المستضيف: تصد طرد واحد (عادي أو برو ماكس) ثم تنحرق
      updatePerk(target, { protect: false });
      appendWinnerSpan(` | 🔰 ${nameText(target)} محمي من المستضيف — انصد طرد برو ماكس وانحرقت الحماية.`);
    } else if (target) {
      forceRemovePlayer(target, { keepName: true });
      appendWinnerSpan(` | 💥 تم طرد ${nameText(target)} (الحصانة ما تحميه)`);
    }
  } else if (ruleId === 'revive') {
    if (target) {
      returnPlayerFromGift(target);
      appendWinnerSpan(` | ↩️ تم إرجاع اللاعب: ${nameText(target)}`);
    }
  } else if (ruleId === 'ruleOrName') {
    addChance(winner, 'rule');
    appendWinnerSpan(` | 🎟️ ${nameText(winner)} أخذ بطاقة "بدل الحكم" — يستخدمها بجولة ثانية`);
    primaryBtnVisible.value = false;
    secondaryBtnVisible.value = false;
    return;
  } else if (ruleId === 'takeShield') {
    if (availableShields.length > 0) {
      const shield = availableShields.shift();
      if (!playerShields[winner]) playerShields[winner] = [];
      playerShields[winner].push(shield);
      appendWinnerSpan(` | ${nameText(winner)} أخذ حصانة (${shield.emoji} ${shield.name}) 🛡️`);
      drawWheel('names');
    } else {
      const playersWithShields = Object.keys(playerShields).filter((p) => playerShields[p] && playerShields[p].length > 0 && p !== winner);
      if (playersWithShields.length > 0) {
        const victim = playersWithShields[0];
        const stolen = playerShields[victim].pop();
        if (!playerShields[winner]) playerShields[winner] = [];
        playerShields[winner].push(stolen);
        appendWinnerSpan(` | البنك فارغ! تم سحب حصانة (${stolen.emoji}) من اللاعب ${nameText(victim)} وإعطائها لـ ${nameText(winner)} 🛡️`);
        drawWheel('names');
      } else {
        appendWinnerSpan(' | البنك فارغ ولا يوجد لاعب لديه حصانة للسحب (تم التخطي).');
      }
    }
  } else if (ruleId === 'selfOut') {
    removePlayerSafely(winner);
    appendWinnerSpan(` | تم طرد ${nameText(winner)}`);
  } else if (ruleId === 'giftShield') {
    if (availableShields.length > 0 && target) {
      const shield = availableShields.shift();
      if (!playerShields[target]) playerShields[target] = [];
      playerShields[target].push(shield);
      appendWinnerSpan(` | تم إهداء حصانة (${shield.emoji} ${shield.name}) لـ ${nameText(target)} 🛡️`);
      drawWheel('names');
    } else {
      const owners = Object.keys(playerShields).filter((p) => playerShields[p] && playerShields[p].length > 0);
      if (owners.length > 0) {
        const donor = owners[0];
        const transShield = playerShields[donor].pop();
        const recipient = target && target !== winner ? target : Object.keys(playerShields).find((p) => p !== winner && p !== donor);
        if (recipient) {
          if (!playerShields[recipient]) playerShields[recipient] = [];
          playerShields[recipient].push(transShield);
          appendWinnerSpan(` | البنك فارغ! تم نقل حصانة (${transShield.emoji}) من ${donor} إلى ${recipient} 🛡️`);
        } else {
          playerShields[donor].push(transShield);
          appendWinnerSpan(' | البنك فارغ ولا يوجد مستلم صالح (تم التخطي).');
        }
        drawWheel('names');
      } else {
        appendWinnerSpan(' | البنك فارغ ولا توجد حصانات لدى أي لاعب (تم التخطي).');
      }
    }
  } else if (ruleId === 'outAndKick') {
    removePlayerSafely(winner);
    removePlayerSafely(target);
    appendWinnerSpan(` | تم طرد ${nameText(winner)} و ${nameText(target)}`);
  } else if (ruleId === 'kickOrShield') {
    removePlayerSafely(target);
    appendWinnerSpan(` | (تطرد او تحصن) تم طرد: ${nameText(target)}`);
  }

  actionContainerVisible.value = false;
}

function runSecondaryAction() {
  const option = wheels.options.lastWinner;
  const winner = wheels.names.lastWinner;
  const target = otherPlayerSelected.value;
  const ruleId = ruleIdOf(option);

  if (ruleId === 'ruleOrName' && winner) {
    addChance(winner, 'name');
    appendWinnerSpan(` | 🎟️ ${nameText(winner)} أخذ بطاقة "بدل الاسم" — يستخدمها بجولة ثانية`);
    primaryBtnVisible.value = false;
    secondaryBtnVisible.value = false;
    return;
  }

  if (ruleId === 'kickOrShield' && target) {
    if (availableShields.length > 0) {
      const shield = availableShields.shift();
      if (!playerShields[target]) playerShields[target] = [];
      playerShields[target].push(shield);
      appendWinnerSpan(` | (اختيار حر) تم إهداء حصانة (${shield.emoji} ${shield.name}) لـ: ${nameText(target)} 🛡️`);
      drawWheel('names');
      actionContainerVisible.value = false;
    } else {
      const owners = Object.keys(playerShields).filter((p) => playerShields[p] && playerShields[p].length > 0);
      if (owners.length > 0) {
        const donor = owners[0];
        const transShield = playerShields[donor].pop();
        if (!playerShields[target]) playerShields[target] = [];
        playerShields[target].push(transShield);
        appendWinnerSpan(` | (اختيار حر) البنك فارغ! تم نقل حصانة (${transShield.emoji}) من ${donor} إلى ${nameText(target)} 🛡️`);
        drawWheel('names');
        actionContainerVisible.value = false;
      } else {
        window.alert('عذراً، البنك فارغ ولا توجد حصانات لتوزيعها!');
      }
    }
  }
}

async function spinBothWheels() {
  if (spinAllDisabled.value || rulesOverlayVisible.value) return;
  if (!rulesConfirmed.value) { openRulesOverlay(); return; }
  spinAllDisabled.value = true;
  // قبل زيادة رقم الجولة: البطاقة المعلّقة تنحسب على الجولة اللي طلعت فيها
  applyPendingAuto();
  rollRoundPerks();
  currentRound.value++;
  // تصفير نتيجة الجولة السابقة حتى ما يتطبق الحكم إلا بعد توقف العجلتين معاً
  wheels.names.lastWinner = null;
  // حكم واحد فقط: ما في عجلة أحكام تدور، الحكم ثابت ويتطبق أول ما يطلع الاسم
  wheels.options.lastWinner = singleRule.value ? wheels.options.items[0] : null;

  await Promise.all([
    usesNamesChase.value ? spinNamesRing() : spinWheelPromise('names'),
    singleRule.value ? null : spinWheelPromise('options'),
  ]);

  flushPendingLeaves();
  checkShieldDestructionEvents();
  if (!winnerOverlayVisible.value) spinAllDisabled.value = false;
}

function resetGame() {
  kickLog.value = [];
  const currentNames = getNamesFromInput();
  const restoredNames = [...new Set([...currentNames, ...removedNamesHistory])];
  namesInput.value = restoredNames.join('\n');
  removedNamesHistory = [];
  tiktokJoinedUsers.clear();
  pendingLeaves.clear();
  stopRegistration();

  if (initialNamesSnapshot && !namesInput.value) {
    namesInput.value = initialNamesSnapshot;
  }

  gameStarted = false;
  currentRound.value = 0;
  nextExplosionRound = 0;
  clearRoundPerks();
  initializeShields();
  gameStarted = false;
  drawWheel('names');
  winnerSpan.value = 'النتيجة: في انتظار التدوير';
  optionsResultText.value = 'النتيجة: في انتظار التدوير';
  namesResultShow.value = false;
  optionsResultShow.value = false;
  deleteWinnerVisible.value = false;
  actionContainerVisible.value = false;
  hideWinnerOverlay();
  spinAllDisabled.value = false;
  wheels.names.lastWinner = null;
  wheels.options.lastWinner = null;
  stopNamesRingChase();
  namesRingActiveIndex.value = -1;
  namesRingWinnerIndex.value = -1;
  rulesOverlayVisible.value = false;
  rulesEditing.value = false;
  rulesPreselect.value = false;
  // الأحكام المختارة (rulesChosen) تبقى للعبة الجاية، وتتعدل بالضغط على عجلة الأحكام
  rulesConfirmed.value = false;
}

function onWinnerNewGame() {
  hideWinnerOverlay();
  resetGame();
}

const barExpanded = ref(true);

const playersModalVisible = ref(false);
const newPlayerNameModal = ref('');

function openPlayersModal() {
  playersModalVisible.value = true;
}

function closePlayersModal() {
  playersModalVisible.value = false;
  newPlayerNameModal.value = '';
}

function addPlayerFromModal() {
  const name = newPlayerNameModal.value.trim();
  if (!name) return;
  const current = getNamesFromInput();
  if (current.length >= MAX_PLAYERS) {
    notifyPlayersFull();
    return;
  }
  if (current.includes(name)) {
    newPlayerNameModal.value = '';
    return;
  }
  current.push(name);
  namesInput.value = current.join('\n');
  newPlayerNameModal.value = '';
  gameStarted = false;
  drawWheel('names');
}

function removePlayerFromModal(name) {
  const current = getNamesFromInput().filter((n) => n !== name);
  namesInput.value = current.join('\n');
  delete roundPerks[name];
  gameStarted = false;
  drawWheel('names');
}

function clearPlayersFromModal() {
  removedNamesHistory = [];
  resetPlayerNumbers();
  namesInput.value = '';
  tiktokJoinedUsers.clear();
  clearRoundPerks();
  gameStarted = false;
  drawWheel('names');
}

const joinSettingsModalVisible = ref(false);

function openJoinSettingsModal() {
  joinSettingsModalVisible.value = true;
}

function closeJoinSettingsModal() {
  joinSettingsModalVisible.value = false;
}

function goHome() {
  router.push('/');
}

function handleGlobalKeydown(event) {
  if (event.code === 'Space' || event.key === ' ') {
    const activeElement = document.activeElement;
    if (activeElement && ['TEXTAREA', 'SELECT', 'INPUT'].includes(activeElement.tagName)) return;
    if (playersModalVisible.value || joinSettingsModalVisible.value || rulesOverlayVisible.value || targetPickerVisible.value || kickLogVisible.value) return;
    event.preventDefault();
    spinBothWheels();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = computed({
  get: () => tiktokState.username,
  set: (v) => { tiktokState.username = v; },
});
const tiktokStatus = computed(() => tiktokState.status);
const tiktokStatusColor = computed(() => tiktokState.statusColor);
const joinWordInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref(defaultGift());
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});
const tiktokJoinedUsers = new Set();

// ===== شراء الرجوع للعبة بالهدايا (للاعبين المطرودين) =====
const buyReturnEnabled = ref(false);
const buyReturnGift = ref(defaultGift());
const buyReturnMinValue = ref(null);
const selectedBuyReturnGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === buyReturnGift.value);
  return found ? found.label : '🎁 أي هدية';
});

function returnPlayerFromGift(username) {
  if (!username) return;
  const idx = removedNamesHistory.indexOf(username);
  if (idx === -1) return;
  removedNamesHistory.splice(idx, 1);
  const currentNames = getNamesFromInput();
  if (currentNames.includes(username)) return;
  if (currentNames.length >= MAX_PLAYERS) { removedNamesHistory.splice(idx, 0, username); notifyPlayersFull(); return; }
  currentNames.push(username);
  namesInput.value = currentNames.join('\n');
  if (!playerShields[username]) playerShields[username] = [];
  drawWheel('names');
  if (winnerOverlayVisible.value && currentNames.length > 1) {
    hideWinnerOverlay();
    spinAllDisabled.value = false;
  }
}

function getJoinWord() {
  return joinWordInput.value.trim() || '1';
}

const joinModeHint = ref('');
const tiktokSectionLabel = ref('');
function updateJoinModeUI() {
  if (isChatMode()) {
    joinModeHint.value = `اللاعب يكتب "${getJoinWord()}" بالشات روم عشان ينضم للعجلة. غيّر الكلمة من الحقل.`;
    tiktokSectionLabel.value = `من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب.`;
  } else if (joinViaGift.value) {
    joinModeHint.value = 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل الهدية المحددة أثناء البث ينضم تلقائياً للعجلة.';
    tiktokSectionLabel.value = 'من يرسل هدية ينضم تلقائياً كلاعب.';
  } else {
    joinModeHint.value = `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم للعجلة. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال الهدية المحددة بدل الكتابة.`;
    tiktokSectionLabel.value = `من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب.`;
  }
}

const nameAvatars = reactive({});

function joinUserToWheel(user, avatar) {
  if (!user) return;
  if (tiktokJoinedUsers.has(user)) return;

  const currentNames = getNamesFromInput();
  if (currentNames.includes(user)) { tiktokJoinedUsers.add(user); return; }
  // العجلة مليانة: ما ينحسب منضم، عشان يقدر يحاول مرة ثانية لو انفضى مكان
  if (currentNames.length >= MAX_PLAYERS) { notifyPlayersFull(); return; }
  tiktokJoinedUsers.add(user);

  nameAvatars[user] = avatar || getUserAvatar(user);
  currentNames.push(user);
  namesInput.value = currentNames.join('\n');
  drawWheel('names');
  updatePlayerCount();
}

// اللاعب كتب "خروج" بالدردشة: ينحذف من العجلة نهائياً (ما يرجع بحكم ولا بهدية)، ويقدر ينضم من جديد.
// لو العجلة تدور يتأجل الحذف لين توقف، عشان ما يطلع اسمه فائز بعد ما انحذف
const pendingLeaves = new Set();

function leaveWheelFromChat(user) {
  if (!user) return;
  tiktokJoinedUsers.delete(user);
  const removedIdx = removedNamesHistory.indexOf(user);
  if (removedIdx !== -1) removedNamesHistory.splice(removedIdx, 1);
  if (!getNamesFromInput().includes(user)) return;
  if (wheels.names.isSpinning || wheels.options.isSpinning) {
    pendingLeaves.add(user);
    return;
  }
  applyLeave(user);
}

function applyLeave(user) {
  if (!getNamesFromInput().includes(user)) return;
  if (wheels.names.lastWinner === user) {
    // كان صاحب الدور: ينلغي حكمه
    pendingAuto = null;
    deleteWinnerVisible.value = false;
    actionContainerVisible.value = false;
    wheels.names.lastWinner = null;
  } else if (otherPlayerOptions.value.some((o) => o.value === user)) {
    const rest = otherPlayerOptions.value.filter((o) => o.value !== user);
    otherPlayerOptions.value = rest.length > 0 ? rest : [{ value: '', label: 'لا توجد خيارات متاحة' }];
    if (otherPlayerSelected.value === user) {
      otherPlayerSelected.value = otherPlayerOptions.value[0].value;
      mentionNote.value = '';
    }
  }
  forceRemovePlayer(user);
  delete nameAvatars[user];
  appendWinnerSpan(` | 🚪 ${nameText(user)} كتب "خروج" وانحذف من اللعبة`);
  updatePlayerCount();
}

function flushPendingLeaves() {
  const leavers = [...pendingLeaves];
  pendingLeaves.clear();
  leavers.forEach(applyLeave);
}

function handleTikTokComment(comment, user, avatar) {
  if (!registrationOpen.value) return;
  if (joinViaGift.value) return;
  const text = normalizeDigits(comment).trim();
  if (text !== normalizeDigits(getJoinWord())) return;
  joinUserToWheel(user, avatar);
}

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationUnlimited = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = ref('');
function updateRegistrationHint() {
  registrationStatusHint.value = registrationOpen.value
    ? `🟢 التسجيل مفتوح ${registrationUnlimited.value ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${registrationTimeLeft.value} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
    : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.';
}

function startRegistration() {
  if (registrationOpen.value) return;
  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 5;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;
  updateRegistrationHint();
  if (registrationTimer) clearInterval(registrationTimer);
  if (registrationUnlimited.value) { registrationTimeLeft.value = 0; return; }
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
    else updateRegistrationHint();
  }, 1000);
}

function extendRegistration() {
  if (!registrationOpen.value || registrationUnlimited.value) return;
  let add = parseInt(extendSecondsInput.value, 10);
  if (Number.isNaN(add) || add < 1) add = 30;
  registrationTimeLeft.value += add;
  updateRegistrationHint();
}

function stopRegistration() {
  if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  registrationOpen.value = false;
  registrationTimeLeft.value = 0;
  updateRegistrationHint();
}

// صاحب الحكم يختار اللاعب بالشات برقمه: "#5" (لو في زر واحد يتنفذ على طول)،
// أو "#5 1" / "#5 2" لو في أكثر من زر (مثلاً 2 = بطاقة بدل الاسم). الأزرار اللي ما تحتاج لاعب
// تنكتب برقمها بس ("1"). المنشن بالاسم (@الاسم 1) لسه شغّال
function handleWinnerMention(comment, user) {
  if (!actionContainerVisible.value || !user || user !== wheels.names.lastWinner) return;
  const candidates = otherPlayerOptions.value.map((o) => o.value).filter(Boolean);
  const needsTarget = candidates.length > 0;

  const raw = normalizeDigits(String(comment)).trim().toLowerCase().replace(/＃/g, '#');

  const tagMatch = raw.match(/#\s*(\d+)/);
  if (tagMatch) {
    const tagged = needsTarget ? playerByNumber(Number(tagMatch[1]), candidates) : null;
    if (needsTarget && !tagged) return; // رقم لاعب مو موجود بالقائمة
    if (tagged) {
      otherPlayerSelected.value = tagged;
      mentionNote.value = `📣 ${nameText(user)} اختار: ${playerTag(tagged)} ${nameText(tagged)}`;
    }
    const rest = raw.replace(tagMatch[0], ' ');
    const btnMatch = rest.match(/(?:^|\s)([1-4])(?:\s|$)/);
    let key = btnMatch ? actionButtons.value[Number(btnMatch[1]) - 1] : null;
    // بدون رقم زر: لو في زر واحد بس يتنفذ مباشرة، وإلا ينتظر رقم الزر
    if (!btnMatch && actionButtons.value.length === 1) key = actionButtons.value[0];
    if (key) runActionButton(key);
    return;
  }

  let text = raw.replace(/@/g, ' ').replace(/\s+/g, ' ').trim();
  const hasMention = raw.includes('@');
  // الأطول أولاً حتى ما يتلخبط اسم قصير مع اسم أطول يحتويه
  // المطابقة على الاسم المعروض (بدون يوزر تيك توك إلا وقت التكرار) لأنه اللي يشوفه ويكتبه صاحب الحكم
  const mentionKey = (name) => displayName(name).toLowerCase().replace(/@/g, ' ').replace(/\s+/g, ' ').trim();
  const target = candidates
    .filter((name) => {
      const lower = mentionKey(name);
      return hasMention ? text.includes(lower) : (text === lower || text.startsWith(`${lower} `));
    })
    .sort((a, b) => mentionKey(b).length - mentionKey(a).length)[0];

  if (target) {
    otherPlayerSelected.value = target;
    mentionNote.value = `📣 ${nameText(user)} منشن: ${nameText(target)}`;
    // شيل الاسم من النص حتى أرقام الاسم نفسه ما تنحسب رقم حكم
    text = text.replace(mentionKey(target), ' ');
  }

  // رقم الحكم بعد المنشن ينفّذ الزر المرقّم (لازم منشن أول إذا الحكم يحتاج لاعب)
  const numMatch = text.match(/(?:^|\s)([1-4])(?:\s|$)/);
  if (!numMatch) return;
  const key = actionButtons.value[Number(numMatch[1]) - 1];
  if (!key) return;
  const isRuleButton = key === 'primary' || key === 'secondary';
  if (isRuleButton && needsTarget && !mentionNote.value) return;
  runActionButton(key);
}

function handleTiktokMessage(data) {
  if (data.comment && isLeaveComment(data.comment)) {
    leaveWheelFromChat(data.user);
  } else if (data.comment) {
    handleTikTokComment(data.comment, data.user, data.avatar);
    handleWinnerMention(data.comment, data.user);
  }
  if (isGiftEvent(data)) {
    if (registrationOpen.value && joinViaGift.value
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      joinUserToWheel(getGiftUser(data), data.avatar);
    }
    if (buyReturnEnabled.value
      && giftPassesFilter(data, { nameFilter: buyReturnGift.value, minValue: buyReturnMinValue.value })) {
      returnPlayerFromGift(getGiftUser(data));
    }
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'wheel', onMessage: handleTiktokMessage });
}

watch(namesInput, () => {
  updatePlayerCount();
  if (!isPlayersFull()) playersFullNotified = false;
});

onMounted(() => {
  updateJoinModeUI();
  updateRegistrationHint();
  document.addEventListener('keydown', handleGlobalKeydown);

  updatePlayerCount();

  initialNamesSnapshot = namesInput.value;
  initializeShields();
  nextTick(() => {
    drawWheel('names');
    drawWheel('options');
  });
  setMessageHandler(handleTiktokMessage, (name) => getNamesFromInput().includes(name));
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => joinUserToWheel(name, ''));
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  stopNamesRingChase();
  hideAnnouncement();
  clearMessageHandler();
});
</script>

<template>
  <h1>عجلة الصامل</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <!-- الشريط العائم: حذف الفائز (وقت ما يكون متاح) + سجل الطرد دايم -->
    <div class="floating-action-bar">
      <button v-if="deleteWinnerVisible" class="action-btn" @click="deleteWinningPlayer">🗑️ حذف الفائز</button>
      <button class="action-btn kick-log-btn" @click="kickLogVisible = true">📜 سجل الطرد ({{ kickLog.length }})</button>
    </div>
    <button class="reset-btn" @click="resetGame">🔄 لعبة جديدة</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <GameDemoBtn />
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="!rulesConfirmed" class="master-btn side-panel-btn" @click="openRulesOverlay">🚀 بدء اللعبة</button>
    <button v-else class="master-btn side-panel-btn" :disabled="spinAllDisabled" @click="spinBothWheels">🎲 دورها </button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ playerCountNum }}</span></button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ كلمة الانضمام: ${getJoinWord()}` }}</button>
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? `⛔ إيقاف التسجيل${registrationUnlimited ? '' : ` (${registrationTimeLeft})`}` : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="announcementVisible" class="announcement-banner" style="display:block;">
    <button class="announcement-close-btn" @click="hideAnnouncement" aria-label="إغلاق الإعلان">✕</button>
    {{ announcementMsg }}
  </div>

  <div v-if="winnerOverlayVisible" class="winner-overlay" style="display:flex;">
    <div class="winner-overlay-card">
      <div class="winner-overlay-text">{{ winnerOverlayText }}</div>
      <button class="master-btn" @click="onWinnerNewGame">🆕 لعبة جديدة</button>    </div>
  </div>

  <div v-if="rulesOverlayVisible" class="rules-overlay">
    <div class="rules-overlay-card">
      <h3>{{ rulesEditing ? '⚖️ تعديل أحكام اللعبة' : '⚖️ اختر أحكام اللعبة' }}</h3>
      <p class="field-hint rules-overlay-hint">لازم تختار حكم واحد على الأقل من القمع — باقي الفئات غير إجبارية. التكرار (×) يوسّع مساحة الحكم في العجلة.</p>

      <div class="rules-columns">
        <div
          v-for="group in RULE_GROUPS.slice(0, 2)"
          :key="group.key"
          class="rules-group"
          :class="[group.key, { invalid: group.key === 'penalty' && selectedCountOf(group.key) === 0 }]"
        >
          <div class="rules-group-title">
            <label class="rules-group-all" title="تحديد/إلغاء القائمة كاملة">
              <input type="checkbox" :checked="isGroupAllSelected(group.key)" @change="toggleGroup(group.key)">
              {{ group.title }}
            </label>
            <span class="rules-group-count">{{ selectedCountOf(group.key) }} / {{ rulesOfGroup(group.key).length }} — فرصة الظهور {{ groupSharePercent(group.key) }}%</span>
          </div>
          <div v-for="rule in rulesOfGroup(group.key)" :key="rule.id" class="rule-item" :class="{ checked: selectedRuleIds.includes(rule.id) }">
            <label class="rule-item-label">
              <input v-model="selectedRuleIds" type="checkbox" :value="rule.id">
              <span>{{ group.icon }} <b>{{ rule.label }}</b> — {{ rule.desc }}<small v-if="rule.id === 'massKick' && playerCountNum > 0" class="rule-lock">حالياً: {{ massKickCount(playerCountNum) }}</small></span>
            </label>
            <div v-if="selectedRuleIds.includes(rule.id) && !rule.maxShare" class="rule-repeat" title="تكرار الحكم في العجلة">
              <button type="button" :disabled="ruleRepeats[rule.id] <= 1" @click="changeRuleRepeat(rule.id, -1)">−</button>
              <span>×{{ ruleRepeats[rule.id] }}</span>
              <button type="button" :disabled="ruleRepeats[rule.id] >= MAX_RULE_REPEAT" @click="changeRuleRepeat(rule.id, 1)">+</button>
            </div>
          </div>
        </div>
      </div>

      <div v-for="group in RULE_GROUPS.slice(2)" :key="group.key" class="rules-group" :class="group.key">
        <div class="rules-group-title">
          <label class="rules-group-all" title="تحديد/إلغاء القائمة كاملة">
              <input type="checkbox" :checked="isGroupAllSelected(group.key)" @change="toggleGroup(group.key)">
              {{ group.title }}
            </label>
          <span class="rules-group-count">{{ selectedCountOf(group.key) }} / {{ rulesOfGroup(group.key).length }} — فرصة الظهور {{ groupSharePercent(group.key) }}%</span>
        </div>
        <div v-for="rule in rulesOfGroup(group.key)" :key="rule.id" class="rule-item" :class="{ checked: selectedRuleIds.includes(rule.id) }">
          <label class="rule-item-label">
            <input v-model="selectedRuleIds" type="checkbox" :value="rule.id">
            <span>{{ group.icon }} <b>{{ rule.label }}</b> — {{ rule.desc }}<small v-if="rule.id === 'massKick' && playerCountNum > 0" class="rule-lock">حالياً: {{ massKickCount(playerCountNum) }}</small></span>
          </label>
          <div v-if="selectedRuleIds.includes(rule.id) && !rule.maxShare" class="rule-repeat" title="تكرار الحكم في العجلة">
            <button type="button" :disabled="ruleRepeats[rule.id] <= 1" @click="changeRuleRepeat(rule.id, -1)">−</button>
            <span>×{{ ruleRepeats[rule.id] }}</span>
            <button type="button" :disabled="ruleRepeats[rule.id] >= MAX_RULE_REPEAT" @click="changeRuleRepeat(rule.id, 1)">+</button>
          </div>
        </div>
      </div>

      <div v-if="!rulesEditing && shieldRulesSelected" class="shield-count-row">
        <span>🛡️ عدد الحصانات في اللعبة:</span>
        <div class="rule-repeat">
          <button type="button" :disabled="manualShieldCount <= 0" @click="changeShieldCount(-1)">−</button>
          <span class="shield-count-value">{{ manualShieldCount > 0 ? Math.min(manualShieldCount, maxShieldCount) : 'آلي' }}</span>
          <button type="button" :disabled="manualShieldCount >= maxShieldCount" @click="changeShieldCount(1)">+</button>
        </div>
        <button v-if="manualShieldCount > 0" type="button" class="shield-count-auto" @click="manualShieldCount = 0">↩️ آلي</button>      </div>

      <p v-if="!rulesEditing" class="rules-overlay-hint rules-edit-tip">💡 تقدر تعدّل الأحكام في أي وقت أثناء اللعبة بالضغط على عجلة الأحكام.</p>
      <button class="master-btn rules-start-btn" :disabled="!rulesSelectionValid" @click="confirmRules">{{ !rulesSelectionValid ? '⚠️ يجب أن يكون هناك اختيار قمع واحد على الأقل' : rulesEditing ? '💾 حفظ التعديل' : rulesPreselect ? '💾 حفظ الأحكام' : '▶️ ابدأ اللعبة' }}</button>
      <button class="reset-btn" style="width:100%; margin-top:10px;" @click="cancelRulesOverlay">{{ rulesEditing || rulesPreselect ? '✖️ إلغاء' : '🔙 رجوع للتسجيل' }}</button>
    </div>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ playerCountNum }})</h3>
      <div class="players-modal-add-row">
        <input
          v-model="newPlayerNameModal"
          type="text"
          placeholder="اسم لاعب جديد"
          @keydown.enter.prevent="addPlayerFromModal"
        >
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayerFromModal">➕ إضافة</button>
      </div>
      <div v-if="playerCountNum === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-if="playerCountNum > 0" class="field-hint" style="margin-top:10px;">✨ تكرار الاسم (فرصة أكبر) يبقى لين تغيّره · 🔰 يصد طرد واحد (عادي أو برو ماكس) ويبقى لين ينكسر · 🚫 اسمه ما يطلع لجولة واحدة</div>
      <div v-if="playerCountNum > 0" class="players-modal-list">
        <div v-for="name in getNamesFromInput()" :key="name" class="players-modal-item">
          <span class="players-modal-item-name"><span class="player-num">{{ playerTag(name) }}</span><img :src="avatarOrLogo(nameAvatars[name])" class="player-avatar" alt=""><bdi>{{ displayName(name) }}</bdi><span v-if="perkOf(name).protect" class="players-modal-shield host-protect" title="محمي من المستضيف — يصد طرد واحد">🔰 محمي</span><span v-if="hasShield(name)" class="players-modal-shield" :title="`عنده ${shieldCountOf(name)} حصانة`">🛡️{{ shieldCountOf(name) > 1 ? ` ×${shieldCountOf(name)}` : '' }}</span></span>
          <div class="players-modal-perks">
            <div class="rule-repeat" title="تكرار الاسم في العجلة (لجولة واحدة)">
              <button type="button" :disabled="perkOf(name).repeat <= 1" @click="changeNameRepeat(name, -1)">−</button>
              <span>×{{ perkOf(name).repeat }}</span>
              <button type="button" :disabled="perkOf(name).repeat >= MAX_NAME_REPEAT" @click="changeNameRepeat(name, 1)">+</button>
            </div>
            <button type="button" class="perk-toggle" :class="{ on: perkOf(name).protect }" title="حماية: تصد طرد واحد (عادي أو برو ماكس) وتبقى لين تنكسر" @click="togglePerk(name, 'protect')">🔰</button>
            <button type="button" class="perk-toggle" :class="{ on: perkOf(name).skip }" title="استبعاد: اسمه ما يطلع بهالجولة" @click="togglePerk(name, 'skip')">🚫</button>
            <button type="button" class="players-modal-remove-btn" @click="removePlayerFromModal(name)">🗑️ حذف</button>
          </div>
        </div>
      </div>
      <button v-if="playerCountNum > 0" class="reset-btn" style="width:100%; margin-top:10px;" @click="clearPlayersFromModal">🧹 مسح كل اللاعبين</button>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
    </div>
  </div>

  <!-- سجل الطرد: كل طرد بهاللعبة (مين طرد مين وبأي حكم)، الأحدث فوق -->
  <div v-if="kickLogVisible" class="target-picker-overlay" @click.self="kickLogVisible = false">
    <div class="target-picker-card kick-log-card">
      <h3>📜 سجل الطرد ({{ kickLog.length }})</h3>
      <div v-if="!kickLog.length" class="field-hint" style="text-align:center;">ما صار أي طرد بهاللعبة للحين.</div>
      <div v-else class="kick-log-list">
        <div v-for="(entry, i) in [...kickLog].reverse()" :key="i" class="kick-log-item" :class="{ cancelled: entry.cancelled }">
          <span class="kick-log-round">ج{{ entry.round }}</span>
          <span class="kick-log-text">
            <!-- اللي طلع له حكم يطرد نفسه (طرد / ينطرد ويطرد) ما ينكتب "فلان طرد فلان" -->
            <template v-if="entry.byHost">المستضيف حذف</template>
            <template v-else-if="entry.kicker === entry.victim">🎡 اللعبة طردت</template>
            <template v-else><b><bdi>{{ playerTag(entry.kicker) }} {{ displayName(entry.kicker) }}</bdi></b> طرد</template>
            <b class="kick-log-victim"><bdi>{{ playerTag(entry.victim) }} {{ displayName(entry.victim) }}</bdi></b>
          </span>
          <span class="kick-log-rule">{{ entry.rule }}</span>
          <span v-if="entry.cancelled" class="kick-log-cancelled">↩️ ملغي</span>
          <button v-else type="button" class="kick-log-cancel-btn" :title="`إرجاع ${displayName(entry.victim)} للعبة`" @click="cancelKickFromLog(entry)">↩️ {{ entry.byHost ? 'إلغاء الحذف' : 'إلغاء الطرد' }}</button>
        </div>
      </div>
      <button class="reset-btn target-picker-close" @click="kickLogVisible = false">إغلاق</button>
    </div>
  </div>

  <!-- نافذة اختيار اللاعب (بدل القائمة المنسدلة): كل الأسماء تبان مرة وحدة بشبكة تتقلص حسب العدد، بدون تمرير -->
  <div v-if="targetPickerVisible && actionContainerVisible" class="target-picker-overlay" @click.self="closeTargetPicker">
    <div class="target-picker-card">
      <h3>🎯 اختر اللاعب ({{ targetOptions.length }})</h3>
      <div class="target-picker-grid" :style="targetGridStyle">
        <button
          v-for="opt in targetOptions"
          :key="opt.value"
          type="button"
          class="target-picker-item"
          :class="{ selected: opt.value === otherPlayerSelected }"
          :title="opt.label"
          @click="pickTarget(opt.value)"
        >
          <img :src="avatarOrLogo(nameAvatars[opt.value])" class="target-picker-avatar" alt="">
          <span class="target-picker-name"><bdi>{{ displayName(opt.value) }}</bdi></span>
          <span class="player-num">{{ playerTag(opt.value) }}</span>
          <span v-if="hasShield(opt.value) || perkOf(opt.value).protect" class="target-picker-shields"><template v-if="perkOf(opt.value).protect">🔰</template><template v-if="hasShield(opt.value)">🛡️{{ shieldCountOf(opt.value) }}</template></span>
        </button>
      </div>
      <button class="reset-btn target-picker-close" @click="closeTargetPicker">إغلاق</button>
    </div>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <LionTap /><h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ tiktokSectionLabel }}</label>
      <div v-if="!isChatMode()" class="join-settings-row" style="margin-top:0;">
        <div class="join-mode-seg">
          <button type="button" class="join-mode-btn" :class="{ active: !joinViaGift }" @click="joinViaGift = false; updateJoinModeUI()">✍️ الانضمام بكتابة الكلمة</button>
          <button type="button" class="join-mode-btn" :class="{ active: joinViaGift }" @click="joinViaGift = true; updateJoinModeUI()">🎁 الانضمام بإرسال هدية</button>
        </div>
      </div>
      <div v-if="!joinViaGift" class="join-settings-row">
        <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" @input="updateJoinModeUI">
      </div>
      <div v-if="joinViaGift" class="gift-filter-row">
        <CustomSelect v-model="giftNameFilter" :options="GIFT_CHOICES" />
      </div>
      <div class="field-hint">{{ joinModeHint }}</div>
      <div class="registration-row">
        <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="registrationUnlimited">
        <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
        <label class="join-gift-toggle">
          <input v-model="registrationUnlimited" type="checkbox" :disabled="registrationOpen">
          ♾️ تسجيل مفتوح بدون وقت
        </label>
        <input v-if="registrationOpen && !registrationUnlimited" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
        <button v-if="registrationOpen && !registrationUnlimited" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
        <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div class="panel unified-panel">
      <div class="render-type-toggle">
        <button class="master-btn render-type-btn" @click="toggleRenderType">
          {{ RENDER_TYPE_LABELS[renderType] }}
          <span class="toggle-hint">— اضغط لتبديل شكل عجلة الأسماء</span>
        </button>
      </div>

      <div v-if="!isChatMode()" class="settings-row settings-panel" style="max-width:600px; margin:0 auto 20px;">
        <div class="setting-cell" :title="`أي لاعب مطرود يرسل &quot;${selectedBuyReturnGiftLabel}&quot; يرجع فوراً للعبة`">
          <span>🔄 شراء الرجوع بالهدايا</span>
          <button type="button" class="setting-btn" :class="{ active: buyReturnEnabled }" @click="buyReturnEnabled = !buyReturnEnabled">{{ buyReturnEnabled ? '✅ مفعّل' : 'معطّل' }}</button>
        </div>
        <template v-if="buyReturnEnabled">
          <div class="setting-cell wide" title="الهدية اللي ترجّع اللاعب المطرود للعبة">
            <span>🎁 الهدية</span>
            <CustomSelect v-model="buyReturnGift" :options="GIFT_CHOICES" />
          </div>
        </template>
      </div>

      <div class="wheels-grid">
        <div class="wheel-col">
          <div class="wheel-display">
            <div v-show="renderType === 'circle'" class="wheel-container">
              <div class="pointer"></div>
              <canvas ref="namesCanvasRef" width="300" height="300"></canvas>
            </div>

            <div v-show="renderType === 'square'" class="square-wheel" style="display:flex;">
              <div class="square-item">{{ namesSquareText }}</div>
            </div>

            <div v-show="renderType === 'avatars'" class="avatar-ring-wheel">
              <div v-for="(item, itemIdx) in namesRingItems" :key="itemIdx" class="wr-avatar-item" :style="item.style">
                <div
                  class="wr-avatar-circle"
                  :class="{ 'wr-avatar-active': itemIdx === namesRingActiveIndex, 'wr-avatar-winner': itemIdx === namesRingWinnerIndex }"
                  :style="{ width: item.size + 'px', height: item.size + 'px' }"
                  :title="item.name"
                >
                  <img v-if="item.avatar" :src="item.avatar" alt="">
                  <span v-else class="wr-avatar-fallback">{{ item.initial }}</span>
                </div>
                <span v-if="perkOf(item.name).protect" class="wr-avatar-protect" title="محمي من المستضيف">🔰</span>
              </div>
            </div>

            <div v-show="renderType === 'grid'" class="wb-square-picker">
              <div
                v-for="(item, itemIdx) in namesRingItems"
                :key="itemIdx"
                class="wb-square-cell"
                :class="{ 'wb-square-active': itemIdx === namesRingActiveIndex, 'wb-square-chosen': itemIdx === namesRingWinnerIndex }"
                :title="item.name"
              >
                <img :src="avatarOrLogo(item.avatar)" class="wb-square-avatar" alt="">
                <span class="wb-square-name"><bdi>{{ displayName(item.name) }}</bdi></span>
                <span class="player-num">{{ playerTag(item.name) }}</span>
                <span v-if="hasShield(item.name) || perkOf(item.name).protect" class="wb-square-shield"><template v-if="perkOf(item.name).protect">🔰</template><template v-if="hasShield(item.name)">🛡️</template></span>
              </div>
            </div>

            <div class="result-box" :class="{ show: namesResultShow }">
              <span>{{ winnerSpan }}</span>
              <div v-if="actionContainerVisible" class="action-container" style="display:flex;">
                <div v-if="otherPlayerOptions.length" class="action-row">
                  <button
                    type="button"
                    class="target-picker-btn"
                    :disabled="!otherPlayerOptions[0].value"
                    @click="openTargetPicker"
                  >🎯 {{ selectedTargetLabel }} <span class="target-picker-caret">▾</span></button>
                </div>
                <div v-if="primaryBtnVisible || secondaryBtnVisible" class="mention-note">
                  <template v-if="otherPlayerOptions.length && otherPlayerOptions[0].value">
                    {{ mentionNote ? `${mentionNote} — يكتب رقم الحكم للتنفيذ` : actionButtons.length === 1
                      ? `📣 ${nameText(wheels.names.lastWinner)} يكتب رقم اللاعب بالشات (مثال: #5)`
                      : `📣 ${nameText(wheels.names.lastWinner)} يكتب رقم اللاعب ثم رقم الحكم (مثال: #5 1)` }}
                  </template>
                  <template v-else>📣 <bdi>{{ displayName(wheels.names.lastWinner) }}</bdi> يكتب رقم الحكم بالشات للتنفيذ</template>
                </div>
                <div v-if="primaryBtnVisible || secondaryBtnVisible" class="action-row">
                  <button v-if="primaryBtnVisible" :class="primaryBtnClass" @click="executePrimaryAction"><b class="action-num">{{ actionNum('primary') }}</b> {{ primaryBtnText }}</button>
                  <button v-if="secondaryBtnVisible" :class="secondaryBtnClass" @click="executeSecondaryAction"><b class="action-num">{{ actionNum('secondary') }}</b> {{ secondaryBtnText }}</button>
                </div>
                <div v-if="winnerChances.rule > 0 || winnerChances.name > 0" class="action-row">
                  <button v-if="winnerChances.rule > 0" class="action-btn free" @click="useChance('rule')"><b class="action-num">{{ actionNum('cardRule') }}</b> 🎟️ استخدم بطاقة بدل الحكم ({{ winnerChances.rule }})</button>
                  <button v-if="winnerChances.name > 0" class="action-btn free" @click="useChance('name')"><b class="action-num">{{ actionNum('cardName') }}</b> 🎟️ استخدم بطاقة بدل الاسم ({{ winnerChances.name }})</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="wheel-col">
          <div v-if="singleRule" class="wheel-container">
            <div class="wheel-ghost">
              <button class="master-btn render-type-btn" @click="editRules">⚖️ تعديل الأحكام</button>
            </div>
          </div>
          <div v-show="!singleRule" class="wheel-display rules-wheel-clickable" title="اضغط لتعديل الأحكام" @click="editRules">
            <div v-show="renderType !== 'square'" class="wheel-container">
              <div class="pointer"></div>
              <canvas ref="optionsCanvasRef" width="300" height="300"></canvas>
            </div>

            <div v-show="renderType === 'square'" class="square-wheel" style="display:flex;">
              <div class="square-item">{{ optionsSquareText }}</div>
            </div>

            <div class="result-box" :class="{ show: optionsResultShow }">{{ optionsResultText }}</div>
          </div>
        </div>
      </div>

      <div v-if="shieldsInPlay || hasFreezeOrCards" class="shields-panel combined-shields-panel">
        <div class="shields-title">{{ shieldsInPlay ? '🛡️ بنك الحصانات وحالة اللاعبين:' : '🎴 حالة اللاعبين:' }}</div>
        <div>
          <template v-if="shieldsInPlay">
          <div>
            <strong>الحصانات المتاحة للالتقاط:</strong>
            <span v-if="availableShields.length === 0" style="color:#e74c3c;">لا توجد حصانات متاحة حالياً</span>
            <span v-else>{{ availableShields.map(s => `${s.emoji} ${s.name}`).join('، ') }}</span>
          </div>
          <hr style="border-color:rgba(255,255,255,0.1); margin: 6px 0;">
          <div>
            <strong>حصانات اللاعبين:</strong><br>
            <template v-if="Object.values(playerShields).some(s => s && s.length > 0)">
              <template v-for="(shields, player) in playerShields" :key="player">
                <template v-if="shields && shields.length > 0">
                  - <bdi>{{ displayName(player) }}</bdi>: [{{ shields.map(s => `${s.emoji} ${s.name}`).join(', ') }}]<br>
                </template>
              </template>
            </template>
            <template v-else>لا توجد حصانات مسجلة لدى اللاعبين حالياً</template>
          </div>
          </template>
          <template v-if="hasFreezeOrCards">
            <hr v-if="shieldsInPlay" style="border-color:rgba(255,255,255,0.1); margin: 6px 0;">
            <div>
              <strong>التجميد والبطاقات:</strong><br>
              <template v-for="(_, player) in frozenPlayers" :key="`f-${player}`">
                - 🧊 <bdi>{{ displayName(player) }}</bdi>: الاكشن الجاي مجمّد<br>
              </template>
              <template v-for="(chances, player) in playerChances" :key="`c-${player}`">
                <template v-if="chances.rule > 0 || chances.name > 0">
                  - 🎟️ <bdi>{{ displayName(player) }}</bdi>: بطاقة بدل الحكم ({{ chances.rule }})، بطاقة بدل الاسم ({{ chances.name }})<br>
                </template>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <div class="footer-note" style="margin-top: 40px;">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>
</template>

<style scoped>
:global(body) { padding: 20px; padding-bottom: 100px; }
h1 { font-size: 2.5rem; }
.subtitle { font-size: 1.2rem; margin-bottom: 25px; }

.top-names-section {
  width: 100%;
  max-width: 1600px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 15px 25px;
  margin-bottom: 20px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

.top-names-section label {
  display: block;
  margin-bottom: 10px;
  font-size: 1.05rem;
  color: #ecf0f1;
  font-weight: bold;
}

textarea {
  width: 100%;
  height: 90px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  padding: 12px;
  font-size: 1.05rem;
  resize: vertical;
  transition: 0.3s;
}

textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 10px var(--border-glow);
}

.field-hint {
  font-size: 0.8rem;
  color: #8b93a3;
  margin-top: 6px;
}

.join-settings-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}

.join-settings-row input[type="text"] {
  flex: 1;
  min-width: 140px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
}

.join-gift-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
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
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.gift-filter-row input,
.gift-filter-row select {
  flex: 1;
  min-width: 140px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
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
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.registration-row input[type="number"] {
  width: 90px;
  flex: none;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: white;
  padding: 10px;
  font-size: 0.95rem;
}

.registration-status { font-weight: bold; color: #f1c40f; }

.settings-panel {
  width: 100%;
  background: var(--panel-bg);
  border-radius: 12px;
  margin-bottom: 15px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

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
  font-weight: bold;
  color: #ecf0f1;
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
.settings-row .setting-cell input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  outline: none;
  text-align: center;
  padding: 8px;
}
.settings-row .setting-cell :deep(.custom-select) { width: 100%; flex: none; min-width: 0; }

.master-controls {
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 25px;
  width: 100%;
  max-width: 1600px;
}

.master-btn { font-size: 1.25rem; padding: 15px 40px; }
.rounds-badge { font-size: 1.1rem; padding: 10px 20px; }

.floating-action-bar {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 15px;
}
.floating-action-bar .master-btn,
.floating-action-bar .action-btn {
  box-shadow: 0 6px 25px rgba(0, 0, 0, 0.5);
  margin: 0;
}

@media (max-width: 768px) {
  .floating-action-bar {
    bottom: 75px;
    gap: 10px;
  }
  .floating-action-bar .master-btn {
    font-size: 1.1rem;
    padding: 12px 30px;
  }
  .floating-action-bar .action-btn {
    font-size: 0.95rem;
    padding: 10px 18px;
  }
}

.side-floating-panel {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 998;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  max-width: calc(100vw - 24px);
  overflow-x: auto;
  padding: 12px 18px;
  background: rgba(15, 17, 26, 0.92);
  border: 1px solid var(--border-glow);
  border-radius: 50px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  scrollbar-width: none;
}

.side-floating-panel::-webkit-scrollbar {
  display: none;
}

.side-panel-toggle-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 14px;
  font-size: 1rem;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.side-panel-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.side-floating-panel > * {
  flex-shrink: 0;
}

.side-panel-input {
  width: 170px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  padding: 10px 12px;
  font-size: 0.9rem;
}

.side-panel-btn {
  margin: 0;
  padding: 10px 16px;
  font-size: 0.9rem;
  white-space: nowrap;
}

.side-panel-status {
  font-weight: bold;
  font-size: 0.85rem;
  max-width: 140px;
}

.side-panel-count {
  white-space: nowrap;
}

@media (max-width: 768px) {
  .side-floating-panel {
    bottom: 10px;
    padding: 10px 12px;
    gap: 8px;
    border-radius: 20px;
  }
  .side-panel-input {
    width: 130px;
    padding: 8px 10px;
    font-size: 0.85rem;
  }
  .side-panel-btn {
    padding: 8px 12px;
    font-size: 0.85rem;
  }
}

.announcement-banner {
  position: fixed;
  left: 50%;
  /* فوق زر "حذف الفائز" العائم (bottom: 100px) */
  bottom: calc(165px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 120;
  width: calc(100% - 32px);
  max-width: 728px;
  background: #c0392b;
  color: #fff;
  padding: 15px 34px;
  border-radius: 12px;
  text-align: center;
  font-weight: bold;
  font-size: 1.2rem;
  box-shadow: 0 6px 25px rgba(0, 0, 0, 0.4), 0 0 20px rgba(192, 57, 43, 0.5);
  animation: pulseBanner 1.5s infinite;
  white-space: pre-line;
}

.announcement-close-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes pulseBanner {
  0% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.01); }
  100% { transform: translateX(-50%) scale(1); }
}

.layout-wrapper {
  display: grid;
  grid-template-columns: 1fr;
  gap: 30px;
  width: 100%;
  max-width: 1600px;
  align-items: start;
}

.unified-panel {
  width: 100%;
}

.buy-return-inline-filter {
  max-width: 600px;
  margin: -10px auto 20px;
  justify-content: center;
}

.render-type-toggle {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 20px;
}

.render-type-btn {
  font-size: 1.05rem;
  padding: 12px 28px;
}

.toggle-hint {
  font-size: 0.75rem;
  font-weight: normal;
  opacity: 0.75;
}

.wheels-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 30px;
  width: 100%;
}

.wheel-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1 1 320px;
  min-width: 280px;
}

.rules-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15px;
}

.rules-overlay-card {
  background: #2a2a40;
  border: 1px solid var(--primary-color);
  border-radius: 16px;
  padding: 20px;
  width: 100%;
  max-width: 820px;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rules-overlay-card h3 {
  margin: 0;
  color: var(--primary-color);
  text-align: center;
  font-size: 1.4rem;
}

.rules-overlay-hint {
  text-align: center;
  margin: 0;
  font-size: 0.9rem;
}

/* direction: rtl يضمن أن أول عمود (القمع) يمين والثاني (المساعدات) يسار */
/* كل الفئات بالعرض كامل (القمع ثم المساعدات تحته) بدل عمودين جنب بعض */
.rules-columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  direction: rtl;
}

.rules-group {
  direction: rtl;
  text-align: right;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rules-group.penalty { border-color: rgba(231, 76, 60, 0.6); }
.rules-group.help { border-color: rgba(52, 152, 219, 0.6); }
.rules-group.mixed { border-color: rgba(155, 89, 182, 0.6); }
.rules-group.extra { border-color: rgba(241, 196, 15, 0.6); }
.rules-wheel-clickable { cursor: pointer; }

.shield-count-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(52, 152, 219, 0.6);
  font-weight: bold;
  color: #ecf0f1;
}
.shield-count-value { min-width: 34px; text-align: center; }
.shield-count-auto {
  margin: 0;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 0.85rem;
  cursor: pointer;
}

.rules-group-all { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.rules-group-all input[type="checkbox"] { width: auto; accent-color: var(--primary-color); cursor: pointer; }

/* مكان عجلة الأحكام لما تكون مخفية (حكم واحد): نفس شكل العجلة الفاضية وفوقها زر التعديل */
.wheel-ghost {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 4px solid #2c3e50;
  box-shadow: 0 0 25px rgba(0,0,0,0.5), inset 0 0 15px rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wheel-ghost .master-btn { margin: 0; }
.rules-edit-tip { color: #f1c40f; font-weight: bold; font-size: 1rem; }

.action-num { font-weight: 900; font-size: 1.15em; margin-inline-end: 4px; }

.mention-note { font-size: 0.85rem; font-weight: normal; color: #f1c40f; }

.rules-group.win { border-color: rgba(46, 204, 113, 0.6); }
.rules-group.win .rules-group-title { color: #2ecc71; }
.rules-group.invalid { box-shadow: 0 0 12px rgba(231, 76, 60, 0.7); }

.rules-group-title {
  font-weight: bold;
  font-size: 1.1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.rules-group.penalty .rules-group-title { color: #ff6b6b; }
.rules-group.help .rules-group-title { color: #5dade2; }
.rules-group.mixed .rules-group-title { color: #bb8fce; }
.rules-group.extra .rules-group-title { color: #f1c40f; }

.rules-group-count {
  font-size: 0.8rem;
  color: #bdc3c7;
  font-weight: normal;
}

.rule-item-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  cursor: pointer;
}

.rule-repeat {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  direction: ltr;
  color: #f1c40f;
  font-weight: bold;
}

.rule-repeat button {
  width: 26px;
  height: 26px;
  padding: 0;
  margin: 0;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.rule-repeat button:disabled { opacity: 0.35; cursor: not-allowed; }

.rule-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  font-size: 0.92rem;
  color: #bdc3c7;
  line-height: 1.5;
  opacity: 0.6;
  transition: all 0.15s ease;
}

.rule-item.checked {
  opacity: 1;
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.25);
}

.rule-item input[type="checkbox"] {
  width: auto;
  margin-top: 4px;
  accent-color: var(--primary-color);
  cursor: pointer;
  flex-shrink: 0;
}

.rule-item b { color: #fff; }

.rules-start-btn { width: 100%; margin: 0; }
.rules-start-btn:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 600px) {
  .rules-columns { grid-template-columns: 1fr; }
}

.combined-shields-panel {
  margin-top: 25px;
}

.panel {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 25px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.wheel-container {
  position: relative;
  width: 300px;
  height: 300px;
  margin: 20px 0;
}

canvas {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 0 25px rgba(0,0,0,0.5), inset 0 0 15px rgba(0,0,0,0.5);
  border: 4px solid #2c3e50;
}

.pointer {
  position: absolute;
  top: 50%;
  right: -20px;
  transform: translateY(-50%) rotate(90deg);
  width: 0;
  height: 0;
  border-left: 15px solid transparent;
  border-right: 15px solid transparent;
  border-top: 30px solid var(--danger-color);
  z-index: 10;
  filter: drop-shadow(0 4px 4px rgba(0,0,0,0.5));
}

.square-wheel {
  width: 100%;
  background: rgba(0, 0, 0, 0.5);
  border: 2px dashed var(--primary-color);
  border-radius: 12px;
  margin: 20px 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 15px;
  min-height: 80px;
}

.square-item {
  font-size: 1.8rem;
  font-weight: bold;
  color: #f1c40f;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
}

.avatar-ring-wheel {
  position: relative;
  width: 300px;
  height: 300px;
  margin: 20px 0;
  border-radius: 50%;
  background: #1c1c2c;
  border: 4px solid #2c3e50;
  box-shadow: 0 0 25px rgba(0,0,0,0.5), inset 0 0 15px rgba(0,0,0,0.5);
}

.wr-avatar-item {
  position: absolute;
  z-index: 2;
}

.wr-avatar-circle {
  border-radius: 50%;
  border: 2px solid #3a3a55;
  background: #2a2a40;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: transform 0.08s, border-color 0.08s, box-shadow 0.08s;
}

.wr-avatar-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wr-avatar-fallback {
  color: #ccd6e0;
  font-weight: bold;
  font-size: 0.9rem;
}

.wr-avatar-active {
  border-color: var(--primary-color);
  transform: scale(1.15);
  box-shadow: 0 0 14px var(--primary-color);
}

.wr-avatar-winner {
  border-color: #f39c12;
  transform: scale(1.2);
  box-shadow: 0 0 20px #f39c12;
  animation: wr-avatar-pulse 0.8s ease-in-out infinite;
}

@keyframes wr-avatar-pulse {
  0%, 100% { transform: scale(1.1); }
  50% { transform: scale(1.2); }
}

.result-box {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 15px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
  border-radius: 16px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.15rem;
  border: 1px solid rgba(255,255,255,0.15);
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  z-index: 20;
  opacity: 0;
  transform: scale(0.95);
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.result-box.show {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

.wheel-display {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.player-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 6px 18px;
  font-size: 1rem;
  font-weight: bold;
  color: #ecf0f1;
}

.player-count-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-count-btn:hover {
  background: rgba(243, 156, 18, 0.2);
  border-color: var(--primary-color);
  transform: translateY(-2px);
}

.join-settings-label {
  display: block;
  font-size: 0.95rem;
  color: #ecf0f1;
  font-weight: bold;
}

.players-modal-add-row {
  display: flex;
  gap: 10px;
}

.players-modal-add-row input {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  padding: 10px 12px;
  font-size: 0.95rem;
}

.players-modal-list {
  margin-top: 15px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.players-modal-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 12px;
}

.players-modal-item-name {
  font-weight: bold;
  overflow-wrap: anywhere;
}

.players-modal-item { flex-wrap: wrap; }

.players-modal-perks {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-inline-start: auto;
}

.perk-toggle {
  width: 30px;
  height: 30px;
  padding: 0;
  margin: 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.1);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.45;
}

.perk-toggle.on {
  opacity: 1;
  border-color: #f1c40f;
  background: rgba(241, 196, 15, 0.25);
  box-shadow: 0 0 8px rgba(241, 196, 15, 0.5);
}

.players-modal-remove-btn {
  background: var(--danger-color);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.players-modal-remove-btn:hover {
  background: #6e102c;
}

.rule-lock {
  display: inline-block;
  margin-inline-start: 6px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 0.75rem;
  background: rgba(46, 204, 113, 0.2);
  color: #7be3a5;
  white-space: nowrap;
}

.players-modal-shield.host-protect {
  background: rgba(46, 204, 113, 0.25);
  border-color: rgba(46, 204, 113, 0.6);
}
.wr-avatar-protect {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 0.75rem;
  pointer-events: none;
}

.players-modal-shield {
  margin-inline-start: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(41, 128, 185, 0.3);
  border: 1px solid rgba(41, 128, 185, 0.6);
  font-size: 0.8rem;
  white-space: nowrap;
}

/* شكل "مربعات" لعجلة الأسماء: نفس مربعات عجلة مهدي */
.wb-square-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
  width: 100%;
  max-width: 420px;
  margin: 0 auto 16px;
}

.wb-square-cell {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: #2a2a40;
  border: 2px solid #3a3a55;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
  font-size: 0.7rem;
  padding: 4px;
  text-align: center;
  overflow: hidden;
  transition: transform 0.08s, background 0.08s, border-color 0.08s;
}

.wb-square-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.6);
}

.wb-square-name {
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  line-height: 1.15;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.wb-square-shield {
  position: absolute;
  top: 2px;
  inset-inline-end: 3px;
  font-size: 0.75rem;
}

.wb-square-active {
  background: var(--primary-color);
  border-color: #fff;
  color: #1e1e2f;
  transform: scale(1.08);
  box-shadow: 0 0 14px var(--primary-color);
}

.wb-square-chosen {
  background: #f39c12;
  border-color: #fff;
  color: #1e1e2f;
  transform: scale(1.12);
  box-shadow: 0 0 20px #f39c12;
  animation: wb-square-pulse 0.8s ease-in-out infinite;
}

@keyframes wb-square-pulse {
  0%, 100% { transform: scale(1.12); }
  50% { transform: scale(1.2); }
}

/* زر فتح نافذة اختيار اللاعب (مكان القائمة المنسدلة) */
.target-picker-btn {
  flex: 1;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 0.95rem;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.target-picker-btn:disabled { opacity: 0.6; cursor: default; }
.target-picker-caret { opacity: 0.8; }

.target-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.target-picker-card {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 18px;
  padding: 18px 20px;
  width: min(1000px, 100%);
  max-height: calc(100vh - 32px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
.target-picker-card h3 { margin: 0 0 12px; text-align: center; }

.target-picker-grid {
  display: grid;
  gap: 8px;
  overflow-y: auto;
}

.target-picker-item {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 6px;
  text-align: center;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: inherit;
  font-family: inherit;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.target-picker-item:hover { background: rgba(255, 255, 255, 0.14); transform: scale(1.03); }
.target-picker-item.selected { border-color: #f1c40f; background: rgba(241, 196, 15, 0.2); }

.target-picker-avatar {
  width: 1.5em;
  height: 1.5em;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
/* الاسم يبان كامل: ينكسر لسطرين بدل ما ينقص بنقاط */
.target-picker-name {
  flex-shrink: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  line-height: 1.15;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.target-picker-shields { flex-shrink: 0; font-size: 0.8em; opacity: 0.85; }

.target-picker-close { width: 100%; margin-top: 12px; }

/* رقم اللاعب الثابت (#5) اللي يكتبه صاحب الحكم بالشات */
.player-num {
  flex-shrink: 0;
  font-size: 0.8em;
  font-weight: bold;
  color: #f1c40f;
  direction: ltr;
  unicode-bidi: isolate;
}
.players-modal-item-name .player-num { margin-inline-end: 6px; }

.kick-log-card { width: min(560px, 100%); }
.kick-log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}
.kick-log-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  text-align: right;
}
.kick-log-round {
  flex-shrink: 0;
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
}
.kick-log-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.kick-log-victim { color: #ff7b6b; }
.kick-log-rule { flex-shrink: 0; font-size: 0.75rem; opacity: 0.75; }
.kick-log-item.cancelled { opacity: 0.55; }
.kick-log-item.cancelled .kick-log-text { text-decoration: line-through; }
.kick-log-cancelled { flex-shrink: 0; font-size: 0.75rem; color: #7be3a5; white-space: nowrap; }
.kick-log-cancel-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 8px;
  border: none;
  background: #2980b9;
  color: #fff;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.kick-log-cancel-btn:hover { background: #3498db; }

.winner-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  z-index: 2000;
  align-items: center;
  justify-content: center;
}

.winner-overlay-card {
  background: var(--panel-bg);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 20px;
  padding: 40px 50px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  max-width: 90%;
  animation: winnerPop 0.4s ease;
}

@keyframes winnerPop {
  0% { transform: scale(0.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.winner-overlay-text {
  font-size: 1.8rem;
  font-weight: bold;
  color: #f1c40f;
  margin-bottom: 25px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.6);
}

.shields-panel {
  margin-top: 20px;
  width: 100%;
  background: rgba(41, 128, 185, 0.1);
  border-radius: 10px;
  padding: 15px;
  font-size: 0.95rem;
  border: 1px solid rgba(41, 128, 185, 0.3);
  text-align: right;
  line-height: 1.6;
}

.shields-title { color: #3498db; font-weight: bold; margin-bottom: 8px; }

.action-container { width: 100%; margin-top: 15px; display: flex; flex-direction: column; gap: 10px; }
.action-row { display: flex; gap: 10px; width: 100%; }

select.action-select {
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  padding: 8px;
  font-size: 0.95rem;
  flex: 1;
}

.action-btn {
  background: #c0392b;
  font-size: 0.9rem;
  padding: 10px;
  border-radius: 8px;
  flex: 1;
  text-align: center;
  border: none;
  color: white;
  cursor: pointer;
}
.action-btn.shield { background: #2980b9; }
.action-btn.free { background: #8e44ad; }
/* زر سجل الطرد بلون الهوية الذهبي */
.action-btn.kick-log-btn { background: var(--primary-color); color: #1e1e2f; font-weight: bold; white-space: nowrap; }
.action-btn.kick-log-btn:hover { background: var(--secondary-color); }
.floating-action-bar .action-btn { white-space: nowrap; }


@media (max-width: 768px) {
  h1 { font-size: 1.8rem; }
  .wheel-container { width: 260px; height: 260px; }  .master-controls { flex-direction: column; gap: 15px; }
}
</style>
