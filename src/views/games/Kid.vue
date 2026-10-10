<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { siteAdPaused } from '../../utils/siteAd';

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

function playCorrectSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, 0.25, 'triangle', i * 0.12, 0.18));
}

// نغمة هادية للغلط — بدون صوت مزعج يخوّف الطفل
function playWrongSound() {
  playTone(220, 0.25, 'sine', 0, 0.12);
}

// ===== عناصر اللعبة =====
const COLORS = [
  { id: 'red', name: 'أحمر', color: '#e74c3c' },
  { id: 'blue', name: 'أزرق', color: '#3498db' },
  { id: 'green', name: 'أخضر', color: '#2ecc71' },
  { id: 'yellow', name: 'أصفر', color: '#f1c40f' },
  { id: 'orange', name: 'برتقالي', color: '#e67e22' },
  { id: 'purple', name: 'بنفسجي', color: '#9b59b6' },
  { id: 'pink', name: 'وردي', color: '#ff6fae' },
  { id: 'brown', name: 'بني', color: '#8d5a2b' },
  { id: 'white', name: 'أبيض', color: '#ffffff' },
  { id: 'black', name: 'أسود', color: '#111111' },
  { id: 'gray', name: 'رمادي', color: '#95a5a6' },
  { id: 'maroon', name: 'عنابي', color: '#8a1538', group: 'red' },
  { id: 'beige', name: 'بيج', color: '#e8d5b0', group: 'white' },
];

const ANIMALS = [
  { id: 'cat', name: 'قطة', emoji: '🐱' },
  { id: 'dog', name: 'كلب', emoji: '🐶' },
  { id: 'cow', name: 'بقرة', emoji: '🐮' },
  { id: 'horse', name: 'حصان', emoji: '🐴' },
  { id: 'sheep', name: 'خروف', emoji: '🐑' },
  { id: 'lion', name: 'أسد', emoji: '🦁' },
  { id: 'tiger', name: 'نمر', emoji: '🐯' },
  { id: 'elephant', name: 'فيل', emoji: '🐘' },
  { id: 'giraffe', name: 'زرافة', emoji: '🦒' },
  { id: 'monkey', name: 'قرد', emoji: '🐵' },
  { id: 'bear', name: 'دب', emoji: '🐻' },
  { id: 'rabbit', name: 'أرنب', emoji: '🐰' },
  { id: 'duck', name: 'بطة', emoji: '🦆' },
  { id: 'chicken', name: 'دجاجة', emoji: '🐔', group: 'chicken' },
  { id: 'bird', name: 'عصفور', emoji: '🐦' },
  { id: 'fish', name: 'سمكة', emoji: '🐟' },
  { id: 'camel', name: 'جمل', emoji: '🐪' },
  { id: 'turtle', name: 'سلحفاة', emoji: '🐢' },
  { id: 'frog', name: 'ضفدع', emoji: '🐸' },
  { id: 'butterfly', name: 'فراشة', emoji: '🦋' },
  { id: 'mouse', name: 'فأر', emoji: '🐭' },
  { id: 'goat', name: 'ماعز', emoji: '🐐' },
  { id: 'rooster', name: 'ديك', emoji: '🐓', group: 'chicken' },
  { id: 'chick', name: 'كتكوت', emoji: '🐥', group: 'chicken' },
  { id: 'fox', name: 'ثعلب', emoji: '🦊' },
  { id: 'wolf', name: 'ذئب', emoji: '🐺' },
  { id: 'panda', name: 'باندا', emoji: '🐼' },
  { id: 'gorilla', name: 'غوريلا', emoji: '🦍' },
  { id: 'deer', name: 'غزال', emoji: '🦌' },
  { id: 'rhino', name: 'وحيد القرن', emoji: '🦏' },
  { id: 'hippo', name: 'فرس النهر', emoji: '🦛' },
  { id: 'kangaroo', name: 'كنغر', emoji: '🦘' },
  { id: 'crocodile', name: 'تمساح', emoji: '🐊' },
  { id: 'snake', name: 'ثعبان', emoji: '🐍' },
  { id: 'dinosaur', name: 'ديناصور', emoji: '🦖' },
  { id: 'hedgehog', name: 'قنفذ', emoji: '🦔' },
  { id: 'squirrel', name: 'سنجاب', emoji: '🐿️' },
  { id: 'bat', name: 'خفاش', emoji: '🦇' },
  { id: 'penguin', name: 'بطريق', emoji: '🐧' },
  { id: 'eagle', name: 'نسر', emoji: '🦅' },
  { id: 'parrot', name: 'ببغاء', emoji: '🦜' },
  { id: 'peacock', name: 'طاووس', emoji: '🦚' },
  { id: 'flamingo', name: 'فلامنغو', emoji: '🦩' },
  { id: 'whale', name: 'حوت', emoji: '🐳' },
  { id: 'dolphin', name: 'دلفين', emoji: '🐬' },
  { id: 'shark', name: 'قرش', emoji: '🦈' },
  { id: 'octopus', name: 'أخطبوط', emoji: '🐙' },
  { id: 'crab', name: 'قبقب', emoji: '🦀' },
  { id: 'bee', name: 'نحلة', emoji: '🐝' },
  { id: 'ant', name: 'نملة', emoji: '🐜' },
  { id: 'snail', name: 'حلزون', emoji: '🐌' },
  { id: 'spider', name: 'عنكبوت', emoji: '🕷️' },
];

// أصوات الحيوانات: الاسم هو الصوت اللي يقلده ولي الأمر، والطفل يختار الحيوان صاحب الصوت
const ANIMAL_SOUNDS = [
  { id: 'sound-cat', sound: 'cat', name: 'مياو', emoji: '🐱' },
  { id: 'sound-dog', sound: 'dog', name: 'هو هو', emoji: '🐶' },
  { id: 'sound-cow', sound: 'cow', name: 'مووو', emoji: '🐮' },
  { id: 'sound-sheep', sound: 'sheep', name: 'باااع', emoji: '🐑' },
  { id: 'sound-horse', sound: 'horse', name: 'هييييي', emoji: '🐴' },
  { id: 'sound-rooster', sound: 'rooster', name: 'كوكو كوكو', emoji: '🐓', group: 'chicken' },
  { id: 'sound-chicken', sound: 'chicken', name: 'بق بق بق', emoji: '🐔', group: 'chicken' },
  { id: 'sound-duck', sound: 'duck', name: 'واك واك', emoji: '🦆' },
  { id: 'sound-bird', sound: 'bird', name: 'صو صو', emoji: '🐦' },
  { id: 'sound-lion', sound: 'lion', name: 'رووور', emoji: '🦁' },
  { id: 'sound-wolf', sound: 'wolf', name: 'عوووو', emoji: '🐺' },
  { id: 'sound-monkey', sound: 'monkey', name: 'أو أو آ آ', emoji: '🐵' },
  { id: 'sound-frog', sound: 'frog', name: 'نق نق', emoji: '🐸' },
  { id: 'sound-snake', sound: 'snake', name: 'سسسسس', emoji: '🐍' },
  { id: 'sound-bee', sound: 'bee', name: 'ززززز', emoji: '🐝' },
  { id: 'sound-mouse', sound: 'mouse', name: 'ويك ويك', emoji: '🐭' },
];

const FRUITS = [
  { id: 'apple', name: 'تفاحة', emoji: '🍎' },
  { id: 'banana', name: 'موزة', emoji: '🍌' },
  { id: 'orange-fruit', name: 'برتقالة', emoji: '🍊' },
  { id: 'watermelon', name: 'بطيخ', emoji: '🍉' },
  { id: 'grapes', name: 'عنب', emoji: '🍇' },
  { id: 'strawberry', name: 'فراولة', emoji: '🍓' },
  { id: 'carrot', name: 'جزر', emoji: '🥕' },
  { id: 'tomato', name: 'طماطم', emoji: '🍅' },
  { id: 'cucumber', name: 'خيار', emoji: '🥒' },
  { id: 'corn', name: 'ذرة', emoji: '🌽' },
];

const VEHICLES = [
  { id: 'car', name: 'سيارة', emoji: '🚗' },
  { id: 'bus', name: 'باص', emoji: '🚌' },
  { id: 'truck', name: 'شاحنة', emoji: '🚚' },
  { id: 'fire-truck', name: 'سيارة إطفاء', emoji: '🚒' },
  { id: 'ambulance', name: 'إسعاف', emoji: '🚑' },
  { id: 'police', name: 'شرطة', emoji: '🚓' },
  { id: 'plane', name: 'طيارة', emoji: '✈️' },
  { id: 'helicopter', name: 'هليكوبتر', emoji: '🚁' },
  { id: 'train', name: 'قطار', emoji: '🚂' },
  { id: 'boat', name: 'قارب', emoji: '⛵' },
  { id: 'bicycle', name: 'دراجة', emoji: '🚲' },
];

const FOODS = [
  { id: 'bread', name: 'خبز', emoji: '🍞' },
  { id: 'milk', name: 'حليب', emoji: '🥛' },
  { id: 'egg', name: 'بيضة', emoji: '🥚' },
  { id: 'cheese', name: 'جبن', emoji: '🧀' },
  { id: 'rice', name: 'رز', emoji: '🍚' },
  { id: 'chicken-leg', name: 'دجاج', emoji: '🍗' },
  { id: 'cookie', name: 'بسكوت', emoji: '🍪' },
  { id: 'cake', name: 'كيك', emoji: '🍰' },
  { id: 'ice-cream', name: 'آيسكريم', emoji: '🍦' },
];

const HOME_ITEMS = [
  { id: 'bed', name: 'سرير', emoji: '🛏️' },
  { id: 'chair', name: 'كرسي', emoji: '🪑' },
  { id: 'door', name: 'باب', emoji: '🚪' },
  { id: 'key', name: 'مفتاح', emoji: '🔑' },
  { id: 'phone', name: 'جوال', emoji: '📱' },
  { id: 'tv', name: 'تلفزيون', emoji: '📺' },
  { id: 'clock', name: 'ساعة', emoji: '⏰' },
  { id: 'spoon', name: 'ملعقة', emoji: '🥄' },
  { id: 'teddy', name: 'دبدوب', emoji: '🧸' },
  { id: 'ball', name: 'كرة', emoji: '⚽' },
  { id: 'balloon', name: 'بالونة', emoji: '🎈' },
];

const CLOTHES = [
  { id: 'shirt', name: 'قميص', emoji: '👕' },
  { id: 'pants', name: 'بنطلون', emoji: '👖' },
  { id: 'dress', name: 'فستان', emoji: '👗' },
  { id: 'shoe', name: 'حذاء', emoji: '👟' },
  { id: 'socks', name: 'جوارب', emoji: '🧦' },
  { id: 'cap', name: 'قبعة', emoji: '🧢' },
  { id: 'gloves', name: 'قفازات', emoji: '🧤' },
  { id: 'glasses', name: 'نظارة', emoji: '👓' },
];

const NATURE = [
  { id: 'sun', name: 'شمس', emoji: '☀️' },
  { id: 'moon', name: 'قمر', emoji: '🌙' },
  { id: 'star', name: 'نجمة', emoji: '⭐' },
  { id: 'cloud', name: 'غيمة', emoji: '☁️' },
  { id: 'rain', name: 'مطر', emoji: '🌧️' },
  { id: 'tree', name: 'شجرة', emoji: '🌳' },
  { id: 'rose', name: 'وردة', emoji: '🌹' },
  { id: 'fire', name: 'نار', emoji: '🔥' },
];

const BODY_PARTS = [
  { id: 'eye', name: 'عين', emoji: '👁️' },
  { id: 'ear', name: 'أذن', emoji: '👂' },
  { id: 'nose', name: 'أنف', emoji: '👃' },
  { id: 'mouth', name: 'فم', emoji: '👄' },
  { id: 'hand', name: 'يد', emoji: '✋' },
  { id: 'foot', name: 'رجل', emoji: '🦶' },
  { id: 'tooth', name: 'سن', emoji: '🦷' },
];

// الأشكال مرسومة بالكود (مسار SVG داخل مربع 100×100) وكلها بنفس اللون عشان الطفل يفرّق بالشكل مو باللون
const SHAPES = [
  { id: 'shape-circle', name: 'دائرة', path: 'M50 5a45 45 0 1 0 0 90a45 45 0 1 0 0-90z' },
  { id: 'shape-square', name: 'مربع', path: 'M8 8h84v84h-84z' },
  { id: 'shape-triangle', name: 'مثلث', path: 'M50 8L94 90H6z' },
  { id: 'shape-star', name: 'نجمة', path: 'M50 6L61.2 36.6L93.7 37.8L68.1 57.9L77 89.2L50 71L23 89.2L31.9 57.9L6.3 37.8L38.8 36.6z' },
  { id: 'shape-heart', name: 'قلب', path: 'M50 88C20 66 6 48 6 32C6 18 17 10 28 10C38 10 46 16 50 24C54 16 62 10 72 10C83 10 94 18 94 32C94 48 80 66 50 88z' },
];

// الاسم يطلع كتابةً لولي الأمر (ثلاثة) والمربع فيه الرقم نفسه (3)
const NUMBERS = ['واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة']
  .map((name, i) => ({ id: `num-${i + 1}`, name, digit: String(i + 1) }));

// ask = الكلمة اللي تسبق الاسم بالسؤال
const CATEGORIES = [
  { value: 'colors', label: '🎨 ألوان', ask: 'وين اللون', items: COLORS },
  { value: 'animals', label: '🐾 حيوانات', ask: 'وين', items: ANIMALS },
  // مخفية مؤقتاً حتى إشعار آخر: { value: 'sounds', label: '📣 أصوات', ask: 'مين يقول', items: ANIMAL_SOUNDS },
  { value: 'fruits', label: '🍎 فواكه وخضار', ask: 'وين', items: FRUITS },
  { value: 'vehicles', label: '🚗 مركبات', ask: 'وين', items: VEHICLES },
  { value: 'foods', label: '🍞 أكل', ask: 'وين', items: FOODS },
  { value: 'home', label: '🏠 البيت', ask: 'وين', items: HOME_ITEMS },
  { value: 'clothes', label: '👕 ملابس', ask: 'وين', items: CLOTHES },
  { value: 'nature', label: '☀️ طبيعة', ask: 'وين', items: NATURE },
  { value: 'body', label: '✋ الجسم', ask: 'وين', items: BODY_PARTS },
  { value: 'shapes', label: '🔷 أشكال', ask: 'وين الشكل', items: SHAPES },
  { value: 'numbers', label: '🔢 أرقام', ask: 'وين الرقم', items: NUMBERS },
];
const MODES = [...CATEGORIES, { value: 'mixed', label: '🔀 الكل' }];
const CHOICE_COUNTS = [2, 3, 4];
const NEXT_DELAY = 1600; // مهلة الاحتفال قبل السؤال التالي
const CHEERS = ['🎉', '👏', '🌟', '🥳', '💯'];

const mode = ref('colors');
const choiceCount = ref(3);
const target = ref(null);
const choices = ref([]);
const wrongId = ref(null); // المربع اللي انضغط غلط الحين (يهتز ويطلع الوجه الباكي) — يرجع ينضغط عادي بعدها
const solved = ref(false);
const stars = ref(0);
const cheer = ref('🎉');
const SAD_DURATION = 1000;
let nextTimer = null;
let sadTimer = null;

const category = ref(CATEGORIES[0]); // قائمة السؤال الحالي (بنمط "الكل" تتغير كل سؤال)

// ===== أصوات الحيوانات المسموعة: ملفات public/kid-sounds/<sound>.mp3 =====
// لو ملف الصوت مو موجود أو ما اشتغل، يرجع السؤال مكتوب (مين يقول مياو؟) عشان ولي الأمر يقلده
const soundMissing = ref(false);
const soundPlayable = computed(() => Boolean(target.value && target.value.sound) && !soundMissing.value);
const promptLabel = computed(() => (soundPlayable.value ? 'مين صاحب هذا الصوت؟' : category.value.ask));
let animalAudio = null;

function stopAnimalSound() {
  if (!animalAudio) return;
  animalAudio.pause();
  animalAudio = null;
}

function playAnimalSound() {
  stopAnimalSound();
  if (!soundPlayable.value) return;
  const audio = new Audio(`/kid-sounds/${target.value.sound}.mp3`);
  animalAudio = audio;
  audio.onerror = () => { if (animalAudio === audio) soundMissing.value = true; };
  // المتصفح يمنع التشغيل التلقائي قبل أول لمسة — وقتها الصوت يشتغل من زر السماعة
  audio.play().catch(() => {});
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newRound() {
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
  // بنمط "الكل" كل سؤال يكون من قائمة وحدة (كله ألوان أو كله حيوانات...) عشان ما يتشتت الطفل
  category.value = mode.value === 'mixed'
    ? CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
    : CATEGORIES.find((c) => c.value === mode.value);
  const pool = category.value.items;

  // ما يتكرر نفس المطلوب مرتين ورا بعض
  const prevId = target.value ? target.value.id : null;
  // المتشابهين (نفس group، مثل أزرق وكحلي أو دجاجة وديك) ما يطلعون مع بعض بنفس السؤال
  const picked = [];
  const usedGroups = new Set();
  for (const item of shuffle(pool.filter((x) => x.id !== prevId))) {
    const group = item.group || item.id;
    if (usedGroups.has(group)) continue;
    usedGroups.add(group);
    picked.push(item);
    if (picked.length >= choiceCount.value) break;
  }
  target.value = picked[0];
  choices.value = shuffle(picked);
  clearSad();
  solved.value = false;
  soundMissing.value = false;
  if (soundEnabled.value) playAnimalSound();
  else stopAnimalSound();
}

function clearSad() {
  if (sadTimer) { clearTimeout(sadTimer); sadTimer = null; }
  wrongId.value = null;
}

// الفرص لا محدودة: الغلط يطلع وجه يبكي لحظة، وبعدها الطفل يحاول من جديد بنفس السؤال
function pick(item) {
  if (solved.value || wrongId.value) return;
  if (item.id !== target.value.id) {
    wrongId.value = item.id;
    playWrongSound();
    sadTimer = setTimeout(clearSad, SAD_DURATION);
    return;
  }
  solved.value = true;
  stars.value++;
  cheer.value = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  playCorrectSound();
  nextTimer = setTimeout(newRound, NEXT_DELAY);
}

function setMode(value) {
  if (mode.value === value) return;
  mode.value = value;
  newRound();
}

function setChoiceCount(n) {
  if (choiceCount.value === n) return;
  choiceCount.value = n;
  newRound();
}

function resetStars() {
  stars.value = 0;
  newRound();
}

function goHome() {
  router.push('/');
}

onMounted(() => {
  // صفحة أطفال: بدون إعلان عائم ممكن يضغطه الطفل بالغلط
  siteAdPaused.value = true;
});

onUnmounted(() => {
  siteAdPaused.value = false;
  if (nextTimer) clearTimeout(nextTimer);
  if (sadTimer) clearTimeout(sadTimer);
  stopAnimalSound();
});

newRound();
</script>

<template>
  <div class="kid-page">
    <div class="kid-topbar">
      <div class="kid-seg">
        <button
          v-for="m in MODES"
          :key="m.value"
          class="kid-seg-btn"
          :class="{ active: mode === m.value }"
          @click="setMode(m.value)"
        >{{ m.label }}</button>
      </div>
      <div class="kid-seg" title="عدد الخيارات">
        <button
          v-for="n in CHOICE_COUNTS"
          :key="n"
          class="kid-seg-btn"
          :class="{ active: choiceCount === n }"
          @click="setChoiceCount(n)"
        >{{ n }}</button>
      </div>
      <div class="kid-seg">
        <button class="kid-seg-btn" title="تصفير النجوم" @click="resetStars">⭐ {{ stars }}</button>
        <button class="kid-seg-btn" @click="soundEnabled = !soundEnabled">{{ soundEnabled ? '🔊' : '🔇' }}</button>
        <button class="kid-seg-btn" @click="newRound">⏭ التالي</button>
        <button class="kid-seg-btn" @click="goHome">🏠 الخروج</button>
      </div>
    </div>

    <div class="kid-prompt">
      <div class="kid-prompt-label">{{ promptLabel }}</div>
      <button v-if="soundPlayable" class="kid-play-btn" @click="playAnimalSound">🔊</button>
      <div v-else class="kid-prompt-name">{{ target.name }}؟</div>
    </div>

    <div class="kid-choices" :class="`n${choices.length}`">
      <button
        v-for="item in choices"
        :key="item.id"
        class="kid-tile"
        :class="{
          wrong: wrongId === item.id,
          correct: solved && item.id === target.id,
          faded: solved && item.id !== target.id,
        }"
        @click="pick(item)"
      >
        <span v-if="item.emoji" class="kid-emoji">{{ item.emoji }}</span>
        <span v-else-if="item.digit" class="kid-digit">{{ item.digit }}</span>
        <svg v-else-if="item.path" class="kid-shape" viewBox="0 0 100 100"><path :d="item.path" /></svg>
        <span v-else class="kid-color" :style="{ background: item.color }"></span>
      </button>
    </div>

    <div v-if="solved" class="kid-cheer">{{ cheer }}</div>
    <div v-else-if="wrongId" class="kid-cheer kid-sad">😭</div>
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.kid-page {
  width: 100%;
  max-width: 1100px;
  min-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* شريط ولي الأمر: أزرار صغيرة فوق بعيد عن يد الطفل */
.kid-topbar {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.kid-seg {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
}

.kid-seg-btn {
  padding: 6px 12px;
  font-size: 0.85rem;
  border-radius: 10px;
  background: transparent;
  color: #bdc3c7;
  white-space: nowrap;
}

.kid-seg-btn:hover { color: #fff; }

.kid-seg-btn.active {
  background: var(--primary-color);
  color: #1e1e2f;
}

.kid-prompt {
  text-align: center;
  line-height: 1.2;
}

.kid-prompt-label {
  font-size: clamp(1.1rem, 3vw, 1.6rem);
  color: #bdc3c7;
}

.kid-prompt-name {
  font-size: clamp(3rem, 12vw, 6.5rem);
  font-weight: bold;
  color: var(--primary-color);
  text-shadow: 0 0 20px var(--border-glow);
}

.kid-play-btn {
  margin-top: 10px;
  padding: 10px 40px;
  font-size: clamp(2.5rem, 9vw, 4.5rem);
  line-height: 1.2;
  background: #3498db;
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

.kid-play-btn:active { transform: scale(0.95); }

.kid-choices {
  flex: 1;
  width: 100%;
  display: grid;
  gap: clamp(12px, 3vw, 28px);
  align-content: center;
  justify-content: center;
  touch-action: manipulation;
}

.kid-choices.n2 { grid-template-columns: repeat(2, minmax(0, 320px)); }
.kid-choices.n3 { grid-template-columns: repeat(3, minmax(0, 280px)); }
.kid-choices.n4 { grid-template-columns: repeat(4, minmax(0, 240px)); }

@media (max-width: 700px) {
  .kid-choices.n3,
  .kid-choices.n4 { grid-template-columns: repeat(2, minmax(0, 240px)); }
}

.kid-tile {
  aspect-ratio: 1;
  padding: 12%;
  border-radius: 28px;
  background: var(--panel-bg);
  border: 3px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  container-type: inline-size;
  transition: transform 0.15s ease, opacity 0.3s ease, border-color 0.3s ease;
}

.kid-tile:active { transform: scale(0.95); }

.kid-emoji {
  font-size: 70cqw;
  line-height: 1;
}

.kid-digit {
  font-size: 75cqw;
  font-weight: bold;
  line-height: 1;
  color: #fff;
}

.kid-shape {
  width: 100%;
  height: 100%;
  fill: var(--primary-color);
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.4));
}

.kid-color {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 4px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.kid-tile.wrong {
  border-color: #e74c3c;
  animation: kid-shake 0.4s ease;
}

.kid-sad { animation-duration: 1s; }

.kid-tile.faded { opacity: 0.25; }

.kid-tile.correct {
  border-color: #2ecc71;
  box-shadow: 0 0 40px rgba(46, 204, 113, 0.6);
  animation: kid-bounce 0.6s ease infinite alternate;
}

.kid-cheer {
  position: fixed;
  top: 50%;
  left: 50%;
  font-size: clamp(6rem, 30vw, 14rem);
  line-height: 1;
  pointer-events: none;
  z-index: 50;
  animation: kid-pop 1.6s ease forwards;
}

@keyframes kid-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}

@keyframes kid-bounce {
  from { transform: scale(1); }
  to { transform: scale(1.08); }
}

@keyframes kid-pop {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
  25% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
  70% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
}
</style>
