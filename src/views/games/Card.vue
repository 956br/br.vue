<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, getGiftName, getGiftValue, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';

const router = useRouter();
const STORAGE_KEY = 'cardGame_players';
const DURATION_KEY = 'cardGame_roundDuration';

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

const players = reactive(loadFromStorage() || [
  { id: 1, name: 'أحمد', hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false },
  { id: 2, name: 'محمد', hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false },
  { id: 3, name: 'علي', hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false },
  { id: 4, name: 'جاسم', hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false },
]);
let playerIdCounter = Math.max(0, ...players.map((p) => p.id)) + 1;
const tiktokJoinedUsers = new Set();

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  } catch (e) { /* noop */ }
}

const namesInput = ref(players.map((p) => p.name).join('\n'));
const newPlayerName = ref('');
let savedDuration = null;
try { savedDuration = localStorage.getItem(DURATION_KEY); } catch (e) { /* noop */ }
const roundDurationInput = ref(savedDuration ? Number(savedDuration) : 15);

const isRoundActive = ref(false);
const currentRound = ref(0);
let roundToken = 0;

const CARDS_DATA = [1, 2, 3, 4, 5, 6];
const cards = reactive(CARDS_DATA.map((val, i) => ({
  value: val,
  left: (i % 3) * 105 + 10,
  top: Math.floor(i / 3) * 145 + 10,
  flipped: false,
})));
const pointer = reactive({ left: 0, top: 0, opacity: 0 });
let pointedCardValue = null;

const timerDisplay = ref('15');
const timerUrgent = ref(false);
let countdownTimer = null;

const startBtnVisible = ref(true);
const submitBtnVisible = ref(false);
const roundInputsVisible = ref(false);
const roundCards = reactive([]); // { playerId, name, selected: [], target: '', skipping, hasShield, shieldUsed, statusText, statusFilled, victimOptions }

const showRulesOverlay = ref(false);
const showModal = ref(false);
const modalTitle = ref('نتائج الجولة');
const modalLogs = ref([]);

const namesHint = computed(() => (isRoundActive.value
  ? '🔒 مقفول أثناء الجولة النشطة — سيُفتح تلقائياً بعد انتهاء الجولة.'
  : 'التعديل يُطبَّق تلقائياً عند الخروج من الحقل. يُقفَل الحقل أثناء الجولة النشطة.'));
const controlsDisabled = computed(() => isRoundActive.value);

function updateTextareaFromPlayers() {
  namesInput.value = players.map((p) => p.name).join('\n');
}

function syncTextareaToPlayers() {
  if (isRoundActive.value) return;
  const names = [...new Set(namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0))];
  if (names.length === 0) { updateTextareaFromPlayers(); return; }

  const newList = names.map((name) => {
    const existing = players.find((p) => p.name === name);
    return existing || {
      id: playerIdCounter++, name, hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false,
    };
  });
  players.splice(0, players.length, ...newList);
  saveToStorage();
}

function onRoundDurationChange() {
  let val = Math.min(300, Math.max(5, parseInt(roundDurationInput.value, 10) || 15));
  roundDurationInput.value = val;
  try { localStorage.setItem(DURATION_KEY, String(val)); } catch (e) { /* noop */ }
}

function heartsText(p) {
  return p.hearts > 0 ? `${'❤️'.repeat(p.hearts)} (تخطي: ${p.skips})` : '💀';
}

function addPlayer() {
  if (isRoundActive.value) return;
  const name = newPlayerName.value.trim();
  if (name === '') return;
  if (players.some((p) => p.name === name)) {
    openModal('تنبيه', [`الاسم "${name}" موجود مسبقاً في القائمة!`]);
    return;
  }
  players.push({
    id: playerIdCounter++, name, hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false,
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

function addPlayerFromTikTok(name) {
  if (isRoundActive.value) return;
  if (!name) return;
  if (tiktokJoinedUsers.has(name)) return;
  tiktokJoinedUsers.add(name);
  if (players.some((p) => p.name === name)) return;
  players.push({
    id: playerIdCounter++, name, hearts: 3, skips: 3, hasShield: false, shieldUsed: false, isSkipping: false,
  });
  updateTextareaFromPlayers();
  saveToStorage();
}

function parseTwoNumbers(text) {
  const clean = normalizeDigits(text);
  const nums = [];
  for (const ch of clean) {
    const n = Number(ch);
    if (n >= 1 && n <= 6 && !nums.includes(n)) nums.push(n);
    if (nums.length >= 2) break;
  }
  return nums.length === 2 ? nums : [];
}

function toggleShieldFor(player, card) {
  if (player.shieldUsed && !player.hasShield) {
    openModal('تنبيه', ['لقد استخدمت الدرع مسبقاً في هذه اللعبة!']);
    return;
  }
  player.hasShield = !player.hasShield;
  if (card) card.hasShield = player.hasShield;
}

function toggleSkipFor(player, card) {
  if (!player.isSkipping) {
    if (player.skips <= 0) {
      openModal('تنبيه', ['لقد نفذت جميع محاولات التخطي (3 مرات)!']);
      return;
    }
    player.skips--;
    player.isSkipping = true;
    if (card) { card.skipping = true; card.selected = []; }
  } else {
    player.skips++;
    player.isSkipping = false;
    if (card) card.skipping = false;
  }
}

function registerPlayFromComment(username, rawText) {
  if (!isRoundActive.value || !username || !rawText) return;
  const player = players.find((p) => p.name === username && p.hearts > 0);
  if (!player) return;
  const card = roundCards.find((c) => c.playerId === player.id);
  if (!card) return;

  let text = String(rawText).trim();
  let shieldActivated = false;

  if (text.includes('درع')) {
    if (!player.hasShield && !player.shieldUsed) {
      toggleShieldFor(player, card);
      shieldActivated = true;
    }
    text = text.replace(/درع/g, '').trim();
  }

  if (text.includes('تخطي') || text.includes('تخطى')) {
    if (!player.isSkipping && player.skips > 0) {
      toggleSkipFor(player, card);
      card.statusText = '⏭️ فعّلت التخطي من الدردشة';
      card.statusFilled = true;
    }
    return;
  }

  if (card.skipping) {
    if (shieldActivated) { card.statusText = '🛡️ فعّلت الدرع من الدردشة'; card.statusFilled = true; }
    return;
  }

  let victimId = '';
  let numsSource = text;
  if (text.startsWith('@')) {
    const afterAt = text.slice(1);
    let bestLen = 0;
    let matchedName = '';
    players.filter((p) => p.hearts > 0 && p.id !== player.id).forEach((p) => {
      if (afterAt.startsWith(p.name) && p.name.length > bestLen) {
        bestLen = p.name.length;
        matchedName = p.name;
        victimId = String(p.id);
      }
    });
    if (matchedName) numsSource = afterAt.slice(matchedName.length);
  }
  if (victimId) card.target = victimId;

  const nums = parseTwoNumbers(numsSource);
  if (nums.length === 2) card.selected = nums;

  const victimName = victimId ? (players.find((p) => String(p.id) === victimId) || {}).name : '';
  const shieldPrefix = shieldActivated ? '🛡️ فعّلت الدرع + ' : '';
  if (card.selected.length === 2 && victimName) {
    card.statusText = `${shieldPrefix}✅ استلمنا توقعك: ${card.selected.join(' و ')} ← ضد ${victimName}`;
    card.statusFilled = true;
  } else if (card.selected.length === 2) {
    card.statusText = `${shieldPrefix}🕓 استلمنا الرقمين (${card.selected.join(' و ')}) — ناقص اسم الضحية`;
    card.statusFilled = false;
  } else if (victimName) {
    card.statusText = `${shieldPrefix}🕓 استلمنا الضحية (${victimName}) — ناقص رقمين من 1 إلى 6`;
    card.statusFilled = false;
  } else if (shieldActivated) {
    card.statusText = '🛡️ فعّلت الدرع من الدردشة';
    card.statusFilled = true;
  }
}

function createCards() {
  cards.forEach((c, i) => {
    c.value = CARDS_DATA[i];
    c.left = (i % 3) * 105 + 10;
    c.top = Math.floor(i / 3) * 145 + 10;
    c.flipped = false;
  });
  pointer.opacity = 0;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function startGame() {
  if (isRoundActive.value) return;

  const activePlayers = players.filter((p) => p.hearts > 0);
  if (activePlayers.length < 2) {
    openModal('تنبيه', ['تحتاج إلى لاعبين اثنين على الأقل بقلوب نشطة للبدء!']);
    return;
  }

  roundToken++;
  const myToken = roundToken;
  currentRound.value++;

  startBtnVisible.value = false;
  submitBtnVisible.value = false;
  roundInputsVisible.value = false;
  isRoundActive.value = true;

  createCards();
  await sleep(1500);
  if (myToken !== roundToken) return;

  cards.forEach((c) => { c.flipped = true; });
  await sleep(800);
  if (myToken !== roundToken) return;

  for (let j = 0; j < 5; j++) {
    const idx1 = Math.floor(Math.random() * 6);
    const idx2 = Math.floor(Math.random() * 6);
    if (idx1 !== idx2) {
      const tempLeft = cards[idx1].left;
      const tempTop = cards[idx1].top;
      cards[idx1].left = cards[idx2].left;
      cards[idx1].top = cards[idx2].top;
      cards[idx2].left = tempLeft;
      cards[idx2].top = tempTop;
    }
    await sleep(600);
    if (myToken !== roundToken) return;
  }

  const targetIndex = Math.floor(Math.random() * 6);
  const targetCard = cards[targetIndex];
  pointedCardValue = targetCard.value;

  pointer.left = targetCard.left + 25;
  pointer.top = targetCard.top - 45;
  pointer.opacity = 1;

  prepareRoundInputs();
  startTimer();
}

function prepareRoundInputs() {
  roundCards.splice(0, roundCards.length);
  const activePlayers = players.filter((p) => p.hearts > 0);
  activePlayers.forEach((p) => {
    roundCards.push({
      playerId: p.id,
      name: p.name,
      selected: [],
      target: '',
      skipping: p.isSkipping,
      hasShield: p.hasShield,
      shieldUsed: p.shieldUsed,
      statusText: '🕓 بانتظار توقعك من الدردشة (رقمين + اسم الضحية) أو اختر يدوياً',
      statusFilled: false,
      victimOptions: activePlayers.filter((t) => t.id !== p.id).map((t) => ({ value: t.id, label: t.name })),
    });
  });
  roundInputsVisible.value = true;
}

function toggleNumber(card, num) {
  if (card.skipping) return;
  const idx = card.selected.indexOf(num);
  if (idx !== -1) {
    card.selected.splice(idx, 1);
  } else {
    if (card.selected.length >= 2) card.selected.shift();
    card.selected.push(num);
  }
}

function toggleShieldClick(card) {
  const player = players.find((p) => p.id === card.playerId);
  if (!player) return;
  toggleShieldFor(player, card);
}

function toggleSkipClick(card) {
  const player = players.find((p) => p.id === card.playerId);
  if (!player) return;
  toggleSkipFor(player, card);
}

function startTimer() {
  let timeLeft = Math.min(300, Math.max(5, parseInt(roundDurationInput.value, 10) || 15));
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
      submitBtnVisible.value = true;
      startBtnVisible.value = false;
    }
  }, 1000);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function submitAllGuesses() {
  if (!isRoundActive.value) return;

  const incompletePlayers = [];
  roundCards.forEach((card) => {
    const player = players.find((p) => p.id === card.playerId);
    if (!player) return;
    if (!player.isSkipping && (card.selected.length < 2 || !card.target)) {
      incompletePlayers.push(player.name);
    }
  });

  if (incompletePlayers.length > 0) {
    openModal('تنبيه ناقص', [`اللاعبون التاليون لم يكملوا توقعاتهم واختياراتهم:<br>- ${incompletePlayers.map((n) => escapeHtml(n)).join('<br>- ')}`]);
    return;
  }

  isRoundActive.value = false;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  const logs = [];
  let allCorrect = true;
  let participatingCount = 0;

  const targetCard = cards.find((c) => c.value === pointedCardValue);
  if (targetCard) targetCard.flipped = false;
  logs.push(`<div style="text-align:center; font-weight:bold; color:#f39c12; font-size:16px; margin-bottom:8px;">البطاقة الفائزة هي: ${pointedCardValue}</div>`);

  const roundResults = [];
  const skippedNames = [];

  roundCards.forEach((card) => {
    const attacker = players.find((p) => p.id === card.playerId);
    if (!attacker) return;

    if (attacker.isSkipping) {
      skippedNames.push({ name: attacker.name });
      attacker.isSkipping = false;
      return;
    }

    participatingCount++;
    const target = players.find((p) => p.id === Number(card.target));
    if (!target) return;

    const isCorrect = card.selected.includes(pointedCardValue);
    roundResults.push({ attacker, target, isCorrect });
    if (!isCorrect) allCorrect = false;
  });

  skippedNames.forEach((s) => {
    logs.push(`<div class="log-item" style="color:#9b59b6;">⏭️ <b>${escapeHtml(s.name)}</b> استعمل ميزة التخطي ولن يؤثر أو يتأثر في هذه الجولة.</div>`);
  });

  const activePlayers = players.filter((p) => p.hearts > 0);

  if (allCorrect && participatingCount > 0) {
    logs.push('<div class="log-item" style="background:#27ae60; color:white; font-weight:bold; text-align:center; font-size:1rem; padding:10px;">🔥 ما شاء الله تركيز عالي ومصحصحين! كل اللاعبين المشاركين جاوبوا صح، وبناءً عليه يكسب كل واحد منهم قلباً إضافياً (+1 ❤️)!</div>');
    roundResults.forEach((res) => { res.attacker.hearts += 1; });
  } else {
    const damageRecord = {};
    activePlayers.forEach((p) => { damageRecord[p.id] = { hits: 0, attackers: [], selfMiss: 0 }; });

    roundResults.forEach((res) => {
      if (res.isCorrect) {
        damageRecord[res.target.id].hits += 1;
        damageRecord[res.target.id].attackers.push(res.attacker.name);
      } else {
        damageRecord[res.attacker.id].selfMiss += 1;
      }
    });

    activePlayers.forEach((p) => {
      const record = damageRecord[p.id];
      if (!record) return;

      if (record.selfMiss) {
        p.hearts -= record.selfMiss;
        logs.push(`<div class="log-item log-miss">❌ <b>${escapeHtml(p.name)}</b> أخطأ التخمين وخسر قلباً.</div>`);
      }

      if (record.hits > 0) {
        if (p.hasShield) {
          p.hasShield = false;
          p.shieldUsed = true;
          logs.push(`<div class="log-item" style="color:#3498db;">🛡️ <b>${escapeHtml(p.name)}</b> كان محمياً بالدرع، وتم صد جميع هجمات هذه الجولة (${record.hits}) عنه بنجاح، واستهلك الدرع نهائياً لهذه اللعبة.</div>`);
        } else {
          p.hearts -= record.hits;
          record.attackers.forEach((attName) => {
            logs.push(`<div class="log-item log-hit">🎯 <b>${escapeHtml(attName)}</b> أصاب التخمين ووجه ضربة لـ <b>${escapeHtml(p.name)}</b>.</div>`);
          });
        }
      }
    });
  }

  activePlayers.forEach((p) => {
    if (p.hasShield) p.shieldUsed = true;
    p.hasShield = false;
  });

  const newlyEliminated = activePlayers.filter((p) => p.hearts <= 0);
  newlyEliminated.forEach((p) => {
    logs.push(`<div class="log-item" style="background:#8A1538; color:white; font-weight:bold;">💀 ${escapeHtml(p.name)} خسر كل قلوبه وخرج من اللعبة!</div>`);
  });

  const remainingActive = players.filter((p) => p.hearts > 0);
  if (remainingActive.length === 1) {
    logs.push(`<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🏆 الفائز بالبطولة: ${escapeHtml(remainingActive[0].name)} 🏆</div>`);
  } else if (remainingActive.length === 0) {
    logs.push('<div style="text-align:center; font-size:18px; color:#f39c12; margin-top:10px;">🤝 تعادل جماعي — لا يوجد لاعبون متبقّون بقلوب!</div>');
  }

  saveToStorage();
  submitBtnVisible.value = false;
  startBtnVisible.value = true;
  roundInputsVisible.value = false;
  timerUrgent.value = false;

  openModal('نتائج الجولة', logs);
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
  tiktokJoinedUsers.clear();
  stopRegistration();

  players.forEach((p) => {
    p.hearts = 3;
    p.skips = 3;
    p.hasShield = false;
    p.shieldUsed = false;
    p.isSkipping = false;
  });
  currentRound.value = 0;
  roundInputsVisible.value = false;
  submitBtnVisible.value = false;
  startBtnVisible.value = true;
  timerDisplay.value = String(roundDurationInput.value || 15);
  timerUrgent.value = false;
  saveToStorage();
  createCards();
}

function goHome() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  router.push('/');
}

function handleGlobalKeydown(e) {
  if (e.code === 'Space') {
    const activeElement = document.activeElement;
    if (activeElement && ['TEXTAREA', 'SELECT', 'INPUT'].includes(activeElement.tagName)) return;
    e.preventDefault();
    if (startBtnVisible.value && !isRoundActive.value) startGame();
    else if (submitBtnVisible.value) submitAllGuesses();
  }
}

// ===== ربط تيك توك لايف =====
const tiktokUsername = ref('');
const tiktokStatus = ref('');
const tiktokStatusColor = ref('');
const joinWordInput = ref('1');
const joinViaGift = ref(false);
const giftNameFilter = ref('');
const giftMinValue = ref(null);
let tiktokSocket = null;

function getJoinWord() {
  return joinWordInput.value.trim() || '1';
}

const joinModeHint = computed(() => (joinViaGift.value
  ? '🎁 الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء البث يُضاف لاعباً (مرة واحدة لكل شخص). حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.<br>⌨️ أثناء الجولة: يمنشن الضحية في بداية تعليقه ثم يكتب رقمين من 1 إلى 6، مثل <b>"@محمد 3 5"</b>، أو كلمة <b>"درع"</b> لتفعيل الدرع، أو <b>"تخطي"</b> لتفعيل التخطي.'
  : `🎯 الانضمام: المشاهد يكتب <b>"${getJoinWord()}"</b> بالدردشة فيُضاف لاعباً (مرة واحدة لكل شخص).<br>⌨️ أثناء الجولة: يمنشن الضحية في بداية تعليقه ثم يكتب رقمين من 1 إلى 6، مثل <b>"@محمد 3 5"</b>، أو كلمة <b>"درع"</b> لتفعيل الدرع، أو <b>"تخطي"</b> لتفعيل التخطي.`));

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

    if (data.status) {
      tiktokStatus.value = data.status;
      tiktokStatusColor.value = '#2ecc71';
    }
    if (data.error) {
      tiktokStatus.value = data.error;
      tiktokStatusColor.value = '#e74c3c';
    }
    if (data.comment) {
      const text = data.comment.trim();
      if (registrationOpen.value && !joinViaGift.value && normalizeDigits(text) === normalizeDigits(getJoinWord())) {
        addPlayerFromTikTok(data.user);
      } else {
        registerPlayFromComment(data.user, text);
      }
    }
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromTikTok(getGiftUser(data));
    }
  };

  tiktokSocket.onerror = () => {
    tiktokStatus.value = '❌ صار خطأ بالاتصال';
    tiktokStatusColor.value = '#e74c3c';
  };

  tiktokSocket.onclose = () => {
    tiktokStatus.value = '🔌 تم قطع الاتصال';
    tiktokStatusColor.value = '#95a5a6';
  };
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown);
  createCards();
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (countdownTimer) clearInterval(countdownTimer);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) {
    tiktokSocket.close();
    tiktokSocket = null;
  }
});
</script>

<template>
  <div class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر — يمكن التعديل هنا مباشرة):</label>
    <textarea id="namesInput" v-model="namesInput" :disabled="controlsDisabled" @change="syncTextareaToPlayers"></textarea>
    <div class="field-hint">{{ namesHint }}</div>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">🔴 ربط بث تيك توك لايف (اختياري)</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" style="flex:1; min-width:180px;">
      <button class="master-btn" style="padding:10px 20px; font-size:0.95rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)">
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
    <p style="margin-top:8px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <div class="field-hint" v-html="joinModeHint"></div>
    <div class="registration-row">
      <input v-if="!registrationOpen" v-model="registrationDurationInput" type="number" min="5" max="3600" title="مدة التسجيل بالثواني">
      <span v-if="!registrationOpen" class="field-hint" style="margin:0;">ثانية</span>
      <button v-if="!registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="startRegistration">🟢 بدء التسجيل</button>
      <input v-if="registrationOpen" v-model="extendSecondsInput" type="number" min="5" max="600" title="مقدار التمديد بالثواني">
      <button v-if="registrationOpen" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="extendRegistration">⏱️ تمديد</button>
      <button v-if="registrationOpen" class="reset-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="stopRegistration">⛔ إيقاف التسجيل</button>
    </div>
    <div class="field-hint registration-status">{{ registrationStatusHint }}</div>
  </div>

  <h1>لعبة خمن الرقم</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <button v-if="startBtnVisible" class="master-btn" id="startBtn" @click="startGame">🎲 بدء الجولة </button>
    <button v-if="submitBtnVisible" class="master-btn" id="submitBtn" style="background:var(--success-color);" @click="submitAllGuesses">⚔️ تنفيذ الهجمات </button>
    <button class="reset-btn" @click="resetGame">🔄 إعادة اللعبة</button>
    <button class="rules-btn" @click="showRulesOverlay = true">📜 قوانين اللعبة</button>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
  </div>

  <div class="master-controls" style="margin-top:-5px;">
    <label for="roundDurationInput" style="color:#ecf0f1; font-size:0.9rem;">⏱️ مدة التصويت (ثانية):</label>
    <input id="roundDurationInput" v-model="roundDurationInput" type="number" min="5" max="300" step="1" style="width:80px; padding:6px; text-align:center;" @change="onRoundDurationChange">
  </div>

  <div class="layout-wrapper">
    <div class="panel">
      <h2>ساحة البطاقات</h2>
      <div class="game-arena">
        <div class="timer-display" :class="{ urgent: timerUrgent }">{{ timerDisplay }}</div>
        <div class="board">
          <div class="pointer" :style="{ left: pointer.left + 'px', top: pointer.top + 'px', opacity: pointer.opacity }">👇</div>
          <div
            v-for="(c, i) in cards"
            :key="i"
            class="card"
            :class="{ flipped: c.flipped }"
            :style="{ left: c.left + 'px', top: c.top + 'px' }"
          >
            <div class="card-inner">
              <div class="card-front">{{ c.value }}</div>
              <div class="card-back"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="roundInputsVisible" class="panel">
      <h3>اختر رقمين والضحية لكل لاعب</h3>
      <div>
        <div
          v-for="card in roundCards"
          :key="card.playerId"
          class="player-input-card"
          :class="{ 'auto-skipped': card.skipping }"
        >
          <div class="p-name">{{ card.name }}</div>
          <div class="number-boxes">
            <div
              v-for="n in 6"
              :key="n"
              class="num-box"
              :class="{ selected: card.selected.includes(n) }"
              @click="toggleNumber(card, n)"
            >{{ n }}</div>
          </div>
          <select v-model="card.target" style="margin-top:5px;">
            <option value="">اختر الضحية...</option>
            <option v-for="opt in card.victimOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <div class="action-badges">
            <button
              type="button"
              class="badge-btn"
              :class="{ 'active-shield': card.hasShield }"
              :disabled="card.shieldUsed && !card.hasShield"
              @click="toggleShieldClick(card)"
            >{{ card.hasShield ? '🛡️ درع مفعل' : (card.shieldUsed ? '🛡️ لا يوجد درع متبقي' : '🛡️ تفعيل الدرع') }}</button>
            <button
              type="button"
              class="badge-btn"
              :class="{ 'active-skip': card.skipping }"
              @click="toggleSkipClick(card)"
            >⏭️ تخطي ({{ (players.find(p => p.id === card.playerId) || {}).skips }})</button>
          </div>
          <div class="guess-status" :class="{ filled: card.statusFilled }">{{ card.statusText }}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اللاعبون والقلوب ❤️</h3>
      <div style="display: flex; gap: 5px; width: 100%; margin-bottom: 10px;">
        <input v-model="newPlayerName" type="text" placeholder="اسم اللاعب الجديد (Enter للإضافة)" style="flex:1;" @keydown.enter.prevent="addPlayer">
        <button class="master-btn" style="padding: 8px 15px; font-size: 0.9rem;" @click="addPlayer">إضافة</button>
      </div>
      <div style="width: 100%;">
        <div v-for="p in players" :key="p.id" class="player-item">
          <span>{{ p.name }} <span style="color:#ff4757; margin-right:5px;">{{ heartsText(p) }}</span></span>
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
      <h2>قوانين لعبة البطاقات والقلوب 🎴❤️</h2>
      <ul class="rules-list">
        <li>كل لاعب يبدأ بـ 3 قلوب ❤️❤️❤️ و3 محاولات تخطي ⏭️</li>
        <li>تُعرض 6 بطاقات مرقمة (1-6)، تُخلط، ثم يشير المؤشر 👇 لبطاقة واحدة سرّية</li>
        <li>كل لاعب يختار <b>رقمين</b> يتوقع أنهما البطاقة الفائزة + يحدد <b>لاعب ضحية</b> يوجّه له الهجوم</li>
        <li>بعد كشف البطاقة:
          <br>- إذا <b>الكل</b> خمّن صح → الجميع يكسب قلب إضافي +1 ❤️
          <br>- إذا خمّنت صح → توجّه ضربة (خصم قلب) للاعب اللي اخترته كضحية
          <br>- إذا خمّنت غلط → تخسر أنت قلب
        </li>
        <li><b>الدرع 🛡️</b>: يُستخدم مرة وحدة بكل اللعبة، يحمي صاحبه من كل الضربات الموجهة له بتلك الجولة فقط</li>
        <li><b>التخطي ⏭️</b>: يعطّل مشاركتك بالجولة (ما تهاجم وما تتأذى)، عندك 3 محاولات بس</li>
        <li>يخرج اللاعب من اللعبة إذا وصلت قلوبه لصفر 💀</li>
        <li>آخر لاعب باقي بقلوب هو الفائز 🏆</li>
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

#startBtn, #submitBtn {
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

#submitBtn {
  box-shadow: 0 8px 24px rgba(39, 174, 96, 0.5);
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

.panel h2 {
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
  padding: 15px 5px;
}

.timer-display {
  font-size: 38px;
  font-weight: bold;
  color: #ffa502;
  margin-bottom: 15px;
  text-shadow: 0 0 15px rgba(255,165,2,0.5);
}

.timer-display.urgent { color: #ff4757; }

.board {
  position: relative;
  width: 100%;
  max-width: 350px;
  height: 320px;
  margin: 0 auto;
}

.card {
  position: absolute;
  width: 90px;
  height: 130px;
  perspective: 1000px;
  transition: top 0.6s ease-in-out, left 0.6s ease-in-out;
}

.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s;
  transform-style: preserve-3d;
}

.card.flipped .card-inner { transform: rotateY(180deg); }

.card-front, .card-back {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  font-weight: bold;
  border-radius: 10px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}

.card-front { background: white; color: #333; }
.card-back { background: repeating-linear-gradient(45deg, #2f3542, #2f3542 10px, #1e1e2f 10px, #1e1e2f 20px); border: 2px solid #57606f; transform: rotateY(180deg); }

.pointer {
  position: absolute;
  font-size: 40px;
  transition: all 0.5s;
  opacity: 0;
  z-index: 10;
  pointer-events: none;
  filter: drop-shadow(0 4px 4px rgba(0,0,0,0.5));
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

.player-input-card.auto-skipped {
  opacity: 0.55;
}

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
}

.player-input-card .p-name { font-weight: bold; margin-bottom: 5px; color: #ffa502; font-size: 0.95rem; }

.player-input-card .guess-status {
  font-size: 0.78rem;
  color: #8b93a3;
  margin-top: 6px;
}
.player-input-card .guess-status.filled { color: #2ecc71; }

.action-badges {
  display: flex;
  gap: 5px;
  margin-top: 5px;
}

.badge-btn {
  padding: 4px 8px;
  font-size: 0.75rem;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.2);
  background: #333;
  color: #fff;
}

.badge-btn.active-shield { background: #3498db; border-color: #fff; }
.badge-btn.active-skip { background: #9b59b6; border-color: #fff; }

.footer-note { padding: 15px; font-size: 0.85rem; }
</style>
