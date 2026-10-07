<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsOverlay from '../../components/SettingsOverlay.vue';
import { useSettingsOverlay } from '../../utils/useSettingsOverlay';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, GIFT_CHOICES, defaultGift, isLeaveComment,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
  isChatMode, setJoinHandler,
} from '../../utils/liveConnection';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();
const STORAGE_KEY = 'capitalsGame_players';

const COUNTRIES = [
  { c: 'السعودية', cap: 'الرياض', cont: 'آسيا', cities: ['جدة', 'الطائف', 'نجران', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'أبها', 'تبوك'] },
  { c: 'مصر', cap: 'القاهرة', cont: 'أفريقيا', cities: ['الإسكندرية', 'الجيزة', 'الأقصر', 'أسوان', 'بورسعيد', 'السويس', 'المنصورة'] },
  { c: 'الإمارات', cap: 'أبوظبي', cont: 'آسيا', cities: ['دبي', 'الشارقة', 'العين', 'عجمان', 'رأس الخيمة', 'الفجيرة', 'أم القيوين'] },
  { c: 'قطر', cap: 'الدوحة', cont: 'آسيا', cities: ['الريان', 'الوكرة', 'الخور', 'أم صلال', 'الشحانية'] },
  { c: 'الكويت', cap: 'مدينة الكويت', cont: 'آسيا', cities: ['الجهراء', 'حولي', 'الفروانية', 'الأحمدي', 'مبارك الكبير'] },
  { c: 'البحرين', cap: 'المنامة', cont: 'آسيا', cities: ['المحرق', 'الرفاع', 'مدينة عيسى', 'سترة', 'مدينة حمد'] },
  { c: 'عُمان', cap: 'مسقط', cont: 'آسيا', cities: ['صلالة', 'صحار', 'نزوى', 'صور', 'البريمي'] },
  { c: 'الأردن', cap: 'عمّان', cont: 'آسيا', cities: ['إربد', 'الزرقاء', 'العقبة', 'السلط', 'الكرك'] },
  { c: 'لبنان', cap: 'بيروت', cont: 'آسيا', cities: ['طرابلس', 'صيدا', 'صور', 'زحلة', 'جونيه'] },
  { c: 'العراق', cap: 'بغداد', cont: 'آسيا', cities: ['البصرة', 'الموصل', 'أربيل', 'النجف', 'كربلاء'] },
  { c: 'سوريا', cap: 'دمشق', cont: 'آسيا', cities: ['حلب', 'حمص', 'حماة', 'اللاذقية', 'دير الزور'] },
  { c: 'اليمن', cap: 'صنعاء', cont: 'آسيا', cities: ['عدن', 'تعز', 'الحديدة', 'إب', 'المكلا'] },
  { c: 'فلسطين', cap: 'القدس', cont: 'آسيا', cities: ['غزة', 'رام الله', 'نابلس', 'الخليل', 'بيت لحم'] },
  { c: 'المغرب', cap: 'الرباط', cont: 'أفريقيا', cities: ['الدار البيضاء', 'مراكش', 'فاس', 'طنجة', 'أكادير'] },
  { c: 'الجزائر', cap: 'الجزائر', cont: 'أفريقيا', cities: ['وهران', 'قسنطينة', 'عنابة', 'سطيف', 'باتنة'] },
  { c: 'تونس', cap: 'تونس', cont: 'أفريقيا', cities: ['صفاقس', 'سوسة', 'القيروان', 'بنزرت', 'قابس'] },
  { c: 'ليبيا', cap: 'طرابلس', cont: 'أفريقيا', cities: ['بنغازي', 'مصراتة', 'سبها', 'الزاوية', 'طبرق'] },
  { c: 'السودان', cap: 'الخرطوم', cont: 'أفريقيا', cities: ['أم درمان', 'بورتسودان', 'كسلا', 'الأبيض', 'نيالا'] },
  { c: 'موريتانيا', cap: 'نواكشوط', cont: 'أفريقيا', cities: ['نواذيبو', 'كيفة', 'روصو', 'كيهيدي'] },
  { c: 'الصومال', cap: 'مقديشو', cont: 'أفريقيا', cities: ['هرجيسا', 'بوصاصو', 'كسمايو', 'مركا'] },
  { c: 'جيبوتي', cap: 'جيبوتي', cont: 'أفريقيا', cities: ['علي صبيح', 'تاجوره', 'ديخيل', 'أوبوك'] },
  { c: 'جزر القمر', cap: 'موروني', cont: 'أفريقيا', cities: ['موتسامودو', 'فومبوني', 'دوموني'] },
  { c: 'تركيا', cap: 'أنقرة', cont: 'آسيا', cities: ['إسطنبول', 'إزمير', 'أنطاكيا', 'بورصة', 'أضنة'] },
  { c: 'إيران', cap: 'طهران', cont: 'آسيا', cities: ['مشهد', 'أصفهان', 'شيراز', 'تبريز', 'قم'] },
  { c: 'الصين', cap: 'بكين', cont: 'آسيا', cities: ['شنغهاي', 'قوانغتشو', 'شنتشن', 'هونغ كونغ', 'تشنغدو'] },
  { c: 'اليابان', cap: 'طوكيو', cont: 'آسيا', cities: ['أوساكا', 'يوكوهاما', 'ناغويا', 'كيوتو', 'سابورو'] },
  { c: 'كوريا الجنوبية', cap: 'سيول', cont: 'آسيا', cities: ['بوسان', 'إنتشون', 'دايغو', 'غوانغجو', 'دايجون'] },
  { c: 'كوريا الشمالية', cap: 'بيونغ يانغ', cont: 'آسيا', cities: ['هامهونغ', 'تشونغجين', 'ناجين', 'وونسان'] },
  { c: 'الهند', cap: 'نيودلهي', cont: 'آسيا', cities: ['مومباي', 'بنغالور', 'تشيناي', 'كولكاتا', 'حيدر آباد'] },
  { c: 'باكستان', cap: 'إسلام آباد', cont: 'آسيا', cities: ['كراتشي', 'لاهور', 'فيصل آباد', 'راولبندي', 'ملتان'] },
  { c: 'أفغانستان', cap: 'كابول', cont: 'آسيا', cities: ['قندهار', 'هرات', 'مزار شريف', 'جلال آباد'] },
  { c: 'إندونيسيا', cap: 'جاكرتا', cont: 'آسيا', cities: ['سورابايا', 'باندونغ', 'ميدان', 'سيمارانغ'] },
  { c: 'ماليزيا', cap: 'كوالالمبور', cont: 'آسيا', cities: ['جورج تاون', 'إيبوه', 'جوهور بهرو', 'ملقا'] },
  { c: 'تايلاند', cap: 'بانكوك', cont: 'آسيا', cities: ['تشيانغ ماي', 'فوكيت', 'بتايا', 'نونتابوري'] },
  { c: 'الفلبين', cap: 'مانيلا', cont: 'آسيا', cities: ['كيزون سيتي', 'سيبو', 'دافاو', 'ماكاتي'] },
  { c: 'فيتنام', cap: 'هانوي', cont: 'آسيا', cities: ['هوشي منه', 'هاي فونغ', 'دا نانغ', 'كان ثو'] },
  { c: 'سنغافورة', cap: 'سنغافورة', cont: 'آسيا', cities: [] },
  { c: 'بنغلاديش', cap: 'دكا', cont: 'آسيا', cities: ['شيتاغونغ', 'خُلنا', 'راجشاهي', 'سيلهت'] },
  { c: 'كازاخستان', cap: 'أستانا', cont: 'آسيا', cities: ['ألماتي', 'شيمكنت', 'كاراغاندي', 'أكتوبي'] },
  { c: 'أوزبكستان', cap: 'طشقند', cont: 'آسيا', cities: ['سمرقند', 'بخارى', 'نمنغان', 'أندجان'] },
  { c: 'نيبال', cap: 'كاتماندو', cont: 'آسيا', cities: ['بوخارا', 'لاليتبور', 'بهارتبور', 'بيرغونج'] },
  { c: 'المملكة المتحدة', cap: 'لندن', cont: 'أوروبا', cities: ['مانشستر', 'برمنغهام', 'ليفربول', 'غلاسكو', 'إدنبرة'] },
  { c: 'فرنسا', cap: 'باريس', cont: 'أوروبا', cities: ['مرسيليا', 'ليون', 'تولوز', 'نيس', 'بوردو'] },
  { c: 'ألمانيا', cap: 'برلين', cont: 'أوروبا', cities: ['هامبورغ', 'ميونخ', 'كولونيا', 'فرانكفورت', 'شتوتغارت'] },
  { c: 'إيطاليا', cap: 'روما', cont: 'أوروبا', cities: ['ميلانو', 'نابولي', 'تورينو', 'فلورنسا', 'البندقية'] },
  { c: 'إسبانيا', cap: 'مدريد', cont: 'أوروبا', cities: ['برشلونة', 'فالنسيا', 'إشبيلية', 'بلباو', 'سرقسطة'] },
  { c: 'البرتغال', cap: 'لشبونة', cont: 'أوروبا', cities: ['بورتو', 'براغا', 'كويمبرا', 'فارو'] },
  { c: 'هولندا', cap: 'أمستردام', cont: 'أوروبا', cities: ['روتردام', 'لاهاي', 'أوتريخت', 'آيندهوفن'] },
  { c: 'بلجيكا', cap: 'بروكسل', cont: 'أوروبا', cities: ['أنتويرب', 'غنت', 'شارلروا', 'بروج'] },
  { c: 'سويسرا', cap: 'برن', cont: 'أوروبا', cities: ['زيورخ', 'جنيف', 'بازل', 'لوزان'] },
  { c: 'النمسا', cap: 'فيينا', cont: 'أوروبا', cities: ['غراتس', 'لينز', 'سالزبورغ', 'إنسبروك'] },
  { c: 'اليونان', cap: 'أثينا', cont: 'أوروبا', cities: ['سالونيك', 'باتراس', 'هيراكليون', 'لاريسا'] },
  { c: 'السويد', cap: 'ستوكهولم', cont: 'أوروبا', cities: ['غوتنبرغ', 'مالمو', 'أوبسالا'] },
  { c: 'النرويج', cap: 'أوسلو', cont: 'أوروبا', cities: ['بيرغن', 'تروندهايم', 'ستافانغر'] },
  { c: 'الدنمارك', cap: 'كوبنهاغن', cont: 'أوروبا', cities: ['آرهوس', 'أودنسه', 'ألبورغ'] },
  { c: 'فنلندا', cap: 'هلسنكي', cont: 'أوروبا', cities: ['إسبو', 'تامبيري', 'توركو'] },
  { c: 'بولندا', cap: 'وارسو', cont: 'أوروبا', cities: ['كراكوف', 'ووتش', 'فروتسواف', 'بوزنان'] },
  { c: 'روسيا', cap: 'موسكو', cont: 'أوروبا', cities: ['سانت بطرسبرغ', 'نوفوسيبيرسك', 'يكاترينبورغ', 'قازان'] },
  { c: 'أوكرانيا', cap: 'كييف', cont: 'أوروبا', cities: ['خاركيف', 'أوديسا', 'دنيبرو', 'لفيف'] },
  { c: 'أيرلندا', cap: 'دبلن', cont: 'أوروبا', cities: ['كورك', 'غالواي', 'ليمريك'] },
  { c: 'المجر', cap: 'بودابست', cont: 'أوروبا', cities: ['ديبريتسن', 'سيغد', 'ميشكولتس'] },
  { c: 'التشيك', cap: 'براغ', cont: 'أوروبا', cities: ['برنو', 'أوسترافا', 'بلزن'] },
  { c: 'رومانيا', cap: 'بوخارست', cont: 'أوروبا', cities: ['كلوج نابوكا', 'تيميشوارا', 'ياش'] },
  { c: 'نيجيريا', cap: 'أبوجا', cont: 'أفريقيا', cities: ['لاغوس', 'كانو', 'إيبادان', 'بورت هاركورت'] },
  { c: 'جنوب أفريقيا', cap: 'بريتوريا', cont: 'أفريقيا', cities: ['جوهانسبرغ', 'كيب تاون', 'ديربان'] },
  { c: 'كينيا', cap: 'نيروبي', cont: 'أفريقيا', cities: ['مومباسا', 'كيسومو', 'ناكورو'] },
  { c: 'إثيوبيا', cap: 'أديس أبابا', cont: 'أفريقيا', cities: ['دائر داوا', 'مكلي', 'غوندار'] },
  { c: 'غانا', cap: 'أكرا', cont: 'أفريقيا', cities: ['كوماسي', 'تامالي', 'سيكوندي تاكورادي'] },
  { c: 'السنغال', cap: 'داكار', cont: 'أفريقيا', cities: ['تييس', 'كاولاك', 'زيغينشور'] },
  { c: 'تنزانيا', cap: 'دودوما', cont: 'أفريقيا', cities: ['دار السلام', 'مبيا', 'أروشا'] },
  { c: 'أوغندا', cap: 'كمبالا', cont: 'أفريقيا', cities: ['جينجا', 'مباراره', 'غولو'] },
  { c: 'زيمبابوي', cap: 'هراري', cont: 'أفريقيا', cities: ['بولاوايو', 'موتاري', 'غويرو'] },
  { c: 'الكاميرون', cap: 'ياوندي', cont: 'أفريقيا', cities: ['دوالا', 'غاروا', 'باميندا'] },
  { c: 'الولايات المتحدة', cap: 'واشنطن', cont: 'أمريكا الشمالية', cities: ['نيويورك', 'لوس أنجلوس', 'شيكاغو', 'هيوستن'] },
  { c: 'كندا', cap: 'أوتاوا', cont: 'أمريكا الشمالية', cities: ['تورنتو', 'مونتريال', 'فانكوفر', 'كالغاري'] },
  { c: 'المكسيك', cap: 'مكسيكو سيتي', cont: 'أمريكا الشمالية', cities: ['غوادالاخارا', 'مونتيري', 'بويبلا'] },
  { c: 'كوبا', cap: 'هافانا', cont: 'أمريكا الشمالية', cities: ['سانتياغو دي كوبا', 'كاماغوي', 'هولغين'] },
  { c: 'جامايكا', cap: 'كينغستون', cont: 'أمريكا الشمالية', cities: ['مونتيغو باي', 'سبانيش تاون', 'بورتمور'] },
  { c: 'بنما', cap: 'مدينة بنما', cont: 'أمريكا الشمالية', cities: ['كولون', 'ديفيد', 'سانتياغو'] },
  { c: 'غواتيمالا', cap: 'غواتيمالا سيتي', cont: 'أمريكا الشمالية', cities: ['كيتزالتينانغو', 'إسكوينتلا', 'أنتيغوا غواتيمالا'] },
  { c: 'كوستاريكا', cap: 'سان خوسيه', cont: 'أمريكا الشمالية', cities: ['ليمون', 'ألاخويلا', 'كارتاغو'] },
  { c: 'البرازيل', cap: 'برازيليا', cont: 'أمريكا الجنوبية', cities: ['ساو باولو', 'ريو دي جانيرو', 'سلفادور', 'فورتاليزا'] },
  { c: 'الأرجنتين', cap: 'بوينس آيرس', cont: 'أمريكا الجنوبية', cities: ['قرطبة', 'روساريو', 'مندوزا'] },
  { c: 'تشيلي', cap: 'سانتياغو', cont: 'أمريكا الجنوبية', cities: ['فالبارايسو', 'كونسبسيون', 'أنتوفاغاستا'] },
  { c: 'كولومبيا', cap: 'بوغوتا', cont: 'أمريكا الجنوبية', cities: ['ميديلين', 'كالي', 'بارانكيا'] },
  { c: 'بيرو', cap: 'ليما', cont: 'أمريكا الجنوبية', cities: ['أريكيبا', 'تروخيو', 'تشيكلايو'] },
  { c: 'فنزويلا', cap: 'كاراكاس', cont: 'أمريكا الجنوبية', cities: ['ماراكايبو', 'فالنسيا', 'باركيسيميتو'] },
  { c: 'الإكوادور', cap: 'كيتو', cont: 'أمريكا الجنوبية', cities: ['غواياكيل', 'كوينكا', 'سانتو دومينغو'] },
  { c: 'أوروغواي', cap: 'مونتيفيديو', cont: 'أمريكا الجنوبية', cities: ['سلطو', 'باي سوليس', 'مالدونادو'] },
  { c: 'باراغواي', cap: 'أسونسيون', cont: 'أمريكا الجنوبية', cities: ['سيوداد ديل إستي', 'إنكارناسيون', 'بيدرو خوان كاباييرو'] },
  { c: 'أستراليا', cap: 'كانبرا', cont: 'أوقيانوسيا', cities: ['سيدني', 'ملبورن', 'بريزبن', 'بيرث'] },
  { c: 'نيوزيلندا', cap: 'ولينغتون', cont: 'أوقيانوسيا', cities: ['أوكلاند', 'كرايستشيرش', 'هاميلتون'] },
  { c: 'فيجي', cap: 'سوفا', cont: 'أوقيانوسيا', cities: ['نادي', 'لاوتوكا', 'لاباسا'] },
  { c: 'بابوا غينيا الجديدة', cap: 'بورت مورسبي', cont: 'أوقيانوسيا', cities: ['لاي', 'ماونت هاغن', 'مادانغ'] },
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
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  return null;
}

const players = reactive(loadFromStorage() || []);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id), 0) + 1;
const tiktokJoinedUsers = new Set();
const usedKeys = new Set();

function saveToStorage() {
  // أسماء اللاعبين لا تُحفظ بين الجلسات
}

const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
const roundDurationInput = ref(30);
const targetScoreInput = ref(10);
let roundDuration = 30;
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

function clearPlayers() {
  if (isRoundActive.value) return;
  players.splice(0, players.length);
  tiktokJoinedUsers.clear();
  updateTextareaFromPlayers();
  saveToStorage();
}

function addPlayerFromTikTok(name, avatar) {
  if (isRoundActive.value || gameFinished.value || !name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);
  if (players.some((p) => p.name === name)) return;
  players.push({
    id: playerIdCounter++, name, avatar: avatar || getUserAvatar(name), score: 0,
  });
  updateTextareaFromPlayers();
  saveToStorage();
}

// اللاعب كتب "خروج" بالدردشة: ينحذف من اللعبة بأي وقت (حتى وسط الجولة)، ويقدر ينضم من جديد
function leavePlayerFromChat(name) {
  const idx = players.findIndex((p) => p.name === name);
  tiktokJoinedUsers.delete(name);
  if (idx === -1) return;
  const [removed] = players.splice(idx, 1);
  const cardIdx = roundCards.findIndex((c) => c.playerId === removed.id);
  if (cardIdx !== -1) roundCards.splice(cardIdx, 1);
  winners.value = winners.value.filter((w) => w.id !== removed.id);
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
    pool = (item.cities && item.cities.length >= 3)
      ? item.cities
      : COUNTRIES.filter((x) => x.cap !== item.cap).map((x) => x.cap);
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
      avatar: p.avatar,
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

function endAndResetGame() {
  endGameShowRanking();
  resetGame();
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
  resetSettingsConfirm();
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
  router.push('/');
}

const {
  settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
} = useSettingsOverlay(startRound);

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const el = document.activeElement;
    if (el && ['TEXTAREA', 'SELECT', 'INPUT'].includes(el.tagName)) return;
    e.preventDefault();
    if (settingsVisible.value) return;
    if (startBtnVisible.value && !isRoundActive.value) requestStart();
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

function getJoinWord() {
  return joinWordInput.value.trim() || '1';
}

const joinModeHint = computed(() => (joinViaGift.value
  ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل الهدية المحددة أثناء البث ينضم تلقائياً كلاعب.'
  : `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم كلاعب. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال الهدية المحددة بدل الكتابة.`));

// ===== نافذة التسجيل =====
const registrationOpen = ref(false);
const registrationUnlimited = ref(false);
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = computed(() => (registrationOpen.value
  ? `🟢 التسجيل مفتوح ${registrationUnlimited.value ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${registrationTimeLeft.value} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
  : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.'));

function startRegistration() {
  if (registrationOpen.value) return;
  let dur = parseInt(registrationDurationInput.value, 10);
  if (Number.isNaN(dur) || dur < 5) dur = 5;
  registrationDurationInput.value = dur;
  registrationTimeLeft.value = dur;
  registrationOpen.value = true;
  if (registrationTimer) clearInterval(registrationTimer);
  if (registrationUnlimited.value) { registrationTimeLeft.value = 0; return; }
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

function handleTiktokMessage(data) {
  if (data.comment) {
    const text = data.comment.trim();
    if (isLeaveComment(text)) {
      leavePlayerFromChat(data.user);
    } else if (registrationOpen.value && !joinViaGift.value && !players.some((p) => p.name === data.user) && normalizeDigits(text) === normalizeDigits(getJoinWord())) {
      addPlayerFromTikTok(data.user, data.avatar);
    } else {
      registerAnswerFromComment(data.user, text);
    }
  }
  if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
    && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
    addPlayerFromTikTok(getGiftUser(data), data.avatar);
  }
}

function connectTikTok() {
  tiktokConnect(tiktokUsername.value, { gameSlug: 'capitals', onMessage: handleTiktokMessage });
}

const barExpanded = ref(true);

const playersModalVisible = ref(false);
function openPlayersModal() { playersModalVisible.value = true; }
function closePlayersModal() { playersModalVisible.value = false; }

const joinSettingsModalVisible = ref(false);
function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  setMessageHandler(handleTiktokMessage);
  // الشات روم: كل من يدخل الغرفة ينضم للعبة تلقائياً (بدون كلمة انضمام أو فتح تسجيل)
  setJoinHandler((name) => addPlayerFromTikTok(name, ''));
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  clearMessageHandler();
});
</script>

<template>
  <h1>🌍 دول وعواصم</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <button class="reset-btn" @click="endAndResetGame">🏁 إنهاء اللعبة وعرض النتائج</button>
    <button class="rules-btn" @click="openSettings">⚙️ الإعدادات</button>
    <GameDemoBtn />
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <SettingsOverlay v-if="settingsVisible" :for-start="settingsForStart" start-label="🌍 بدء الجولة (فتح الإجابات)" @start="confirmSettingsAndStart" @close="closeSettings">
    <div class="adv-group basics">
      <div class="adv-group-title">⚙️ أساسيات اللعبة</div>

      <div class="adv-columns">
        <label class="adv-item">
          <span>⏱️ <b>مدة الجولة</b> — بالثواني، وبعدها تُكشف الإجابة الصحيحة وتُحتسب النقاط تلقائياً.</span>
          <input v-model="roundDurationInput" type="number" min="5" max="120">
        </label>
        <label class="adv-item">
          <span>🏆 <b>نقاط الفوز</b> — أول لاعب يوصلها يكسب اللعبة.</span>
          <input v-model="targetScoreInput" type="number" min="3" max="100">
        </label>
      </div>
    </div>
  </SettingsOverlay>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input v-if="!isChatMode()" id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button v-if="!isChatMode()" class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p v-if="!isChatMode()" class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button v-if="startBtnVisible" class="master-btn side-panel-btn" id="startBtn" :disabled="isRoundActive" @click="requestStart">🌍 بدء الجولة (فتح الإجابات)</button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ players.length }}</span></button>
    <template v-if="barExpanded">
      <button v-if="!isChatMode()" type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ كلمة الانضمام: ${getJoinWord()}` }}</button>
      <button v-if="!isChatMode()"
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? `⛔ إيقاف التسجيل${registrationUnlimited ? '' : ` (${registrationTimeLeft})`}` : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="playersModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closePlayersModal">
    <div class="players-modal-card">
      <h3>👥 إدارة اللاعبين ({{ players.length }})</h3>
      <div class="players-modal-add-row">
        <input v-model="newPlayerName" type="text" placeholder="اسم لاعب جديد" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="margin:0; padding:10px 16px;" @click="addPlayer">➕ إضافة</button>
      </div>
      <div v-if="players.length === 0" class="field-hint" style="text-align:center; margin-top:10px;">لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.</div>
      <div v-else class="players-modal-list">
        <div v-for="p in players" :key="p.id" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }}</span>
          <button type="button" class="players-modal-remove-btn" @click="removePlayer(p.id)">🗑️ حذف</button>
        </div>
      </div>
      <button v-if="!(isRoundActive) && players.length" class="reset-btn" style="width:100%; margin-top:10px;" @click="clearPlayers">🧹 مسح كل اللاعبين</button>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closePlayersModal">إغلاق</button>
    </div>
  </div>

  <div v-if="joinSettingsModalVisible" class="players-modal-overlay" style="display:flex;" @click.self="closeJoinSettingsModal">
    <div class="players-modal-card">
      <h3>🎟️ إدارة طريقة الانضمام</h3>
      <label class="join-settings-label">{{ joinViaGift ? 'من يرسل هدية ينضم تلقائياً كلاعب.' : `من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً كلاعب.` }}</label>
      <div v-if="!isChatMode()" class="join-settings-row" style="margin-top:0;">
        <div class="join-mode-seg">
          <button type="button" class="join-mode-btn" :class="{ active: !joinViaGift }" @click="joinViaGift = false">✍️ الانضمام بكتابة الكلمة</button>
          <button type="button" class="join-mode-btn" :class="{ active: joinViaGift }" @click="joinViaGift = true">🎁 الانضمام بإرسال هدية</button>
        </div>
      </div>
      <div v-if="!joinViaGift" class="join-settings-row">
        <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)">
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
      </div>
      <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
      <button class="master-btn" style="width:100%; margin-top:15px;" @click="closeJoinSettingsModal">إغلاق</button>
    </div>
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
            >
              <span class="num">{{ i + 1 }}</span>{{ opt }}
              <img v-if="card.selected === i && card.avatar" :src="card.avatar" class="opt-box-avatar player-avatar" alt="">
            </div>
          </div>
          <div class="guess-status" :class="{ filled: card.statusFilled }">{{ card.statusText }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون والنقاط</h3>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span><img v-if="p.avatar" :src="p.avatar" class="player-avatar" alt="">{{ p.name }} <span style="color:#ffa502; margin-right:5px;">{{ playerBadgeText(p) }}</span></span>
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
.settings-row .setting-cell input { text-align: center; padding: 8px; }
.settings-row .setting-cell :deep(.custom-select) { width: 100%; flex: none; min-width: 0; }

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

.opt-box-avatar {
  display: block;
  margin: 6px auto 0;
  width: 28px;
  height: 28px;
  border: 2px solid #1e1e2f;
}

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
