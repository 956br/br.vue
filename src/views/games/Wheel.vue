<script setup>
import {
  ref, reactive, computed, onMounted, onUnmounted, nextTick,
} from 'vue';
import { useRouter } from 'vue-router';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, assignWheelColors,
} from '../../utils/tiktokBridge';
import {
  tiktokState, connect as tiktokConnect, setMessageHandler, clearMessageHandler, getUserAvatar,
} from '../../utils/tiktokConnectionManager';
import CustomSelect from '../../components/CustomSelect.vue';

const router = useRouter();

const OPTIONS_DATA = ['يطرد شخص', 'حصانة', 'ينطرد', 'يهدي حصانة', 'يطلع ويطرد حد معاه', 'تخطي', 'اختيار حر'];
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#16a085', '#d35400', '#e84393'];
const ANIMAL_SHIELDS_POOL = [
  { name: 'الأسد', emoji: '🦁' }, { name: 'النمر', emoji: '🐅' }, { name: 'الفيل', emoji: '🐘' },
  { name: 'الطاووس', emoji: '🦚' }, { name: 'الذيب', emoji: '🐺' }, { name: 'الارنب', emoji: '🐰' },
  { name: 'الدب', emoji: '🐻' }, { name: 'الباندا', emoji: '🐼' }, { name: 'النحلة', emoji: '🐝' }, { name: 'الحصان', emoji: '🐎' },
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
let gameStarted = false;
const currentRound = ref(0);
let nextExplosionRound = 0;
let removedNamesHistory = [];

const wheels = reactive({
  names: {
    items: [], angle: 0, isSpinning: false, type: 'names', lastWinner: null,
  },
  options: {
    items: OPTIONS_DATA, angle: 0, isSpinning: false, type: 'options', lastWinner: null,
  },
});

const renderType = ref('circle');

const namesCanvasRef = ref(null);
const optionsCanvasRef = ref(null);
const namesSquareText = ref('في انتظار البدء...');
const optionsSquareText = ref('الخيارات الجاهزة');
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
const primaryBtnVisible = ref(false);
const primaryBtnClass = ref('action-btn');
const primaryBtnText = ref('');
const secondaryBtnVisible = ref(false);
const secondaryBtnClass = ref('action-btn free');
const secondaryBtnText = ref('');

function getNamesFromInput() {
  return namesInput.value.split('\n').map((n) => n.trim()).filter((n) => n.length > 0).slice(0, 50);
}

function updatePlayerCount() {
  playerCountNum.value = getNamesFromInput().length;
}

// عجلة الخيارات كلاسيكية في وضعي "عجلة" و"دوائر"، وتتحول لعرض النتيجة فقط مع
// عجلة الأسماء في وضع "عرض النتيجة فقط"
const RENDER_TYPE_ORDER = ['circle', 'square', 'avatars'];
function toggleRenderType() {
  const currentIdx = RENDER_TYPE_ORDER.indexOf(renderType.value);
  const value = RENDER_TYPE_ORDER[(currentIdx + 1) % RENDER_TYPE_ORDER.length];
  renderType.value = value;
  nextTick(() => {
    if (value === 'square') {
      const namesItems = getNamesFromInput();
      namesSquareText.value = namesItems.length > 0 ? namesItems[0] : 'فارغ';
      optionsSquareText.value = OPTIONS_DATA.length > 0 ? OPTIONS_DATA[0] : 'فارغ';
    } else {
      if (value === 'circle') drawWheel('names');
      drawWheel('options');
    }
  });
}

// ===== وضع "دوائر الأفاتار" (لعجلة الأسماء فقط — الخيارات تبقى عجلة كلاسيكية دائماً):
// حلقة أفاتارات ثابتة المواقع (بدون دوران)، ويتنقل "شريط إضاءة" بينها بسرعة تتباطأ
// تدريجياً حتى يستقر على الفائز ويُبرزه بتوهج، بنفس أسلوب حلقة عجلة المربعات =====
function buildRingItems(items) {
  const n = items.length;
  if (n === 0) return [];
  const arcSize = (2 * Math.PI) / n;
  const radius = n <= 6 ? 105 : n <= 12 ? 100 : n <= 20 ? 92 : 82;
  const size = n <= 6 ? 54 : n <= 12 ? 46 : n <= 20 ? 38 : 30;
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
    wheel.items = getNamesFromInput();
    if (wheel.isSpinning || wheel.items.length === 0) { resolve(null); return; }

    wheel.isSpinning = true;
    winnerSpan.value = 'جاري الاختيار...';
    actionContainerVisible.value = false;
    namesResultShow.value = false;
    deleteWinnerVisible.value = false;
    namesRingWinnerIndex.value = -1;
    stopNamesRingChase();

    const n = wheel.items.length;
    const pickIndex = Math.floor(Math.random() * n);
    const durationMs = 4300;
    const totalLoops = 4;
    const totalDistance = n * totalLoops + pickIndex;
    const startTime = Date.now();
    const stepMs = 40;

    function tick() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const currentDistance = Math.floor(eased * totalDistance);
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
  const count = Math.max(1, Math.round(names.length * 0.3));
  const shuffled = [...ANIMAL_SHIELDS_POOL].sort(() => 0.5 - Math.random());
  availableShields.splice(0, availableShields.length, ...shuffled.slice(0, Math.min(count, shuffled.length)));
  Object.keys(playerShields).forEach((k) => delete playerShields[k]);
  names.forEach((name) => { playerShields[name] = []; });
  gameStarted = true;
  currentRound.value = 0;
  nextExplosionRound = 0;
  announcementVisible.value = false;
}

function showAnnouncement(msg) {
  announcementMsg.value = msg;
  announcementVisible.value = true;
}
function hideAnnouncement() {
  announcementVisible.value = false;
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
  return `💣💥 انفجار! تم تدمير حصانة (${destroyedShield.emoji} ${destroyedShield.name}) المملوكة للاعب ${chosenLoc.player}!`;
}

function checkShieldDestructionEvents() {
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
    return { value: name, label: `${name} (حصانات: ${shieldCount})` };
  });
  otherPlayerSelected.value = otherPlayerOptions.value[0].value;
}

function drawWheel(wheelKey) {
  const wheel = wheels[wheelKey];
  if (wheel.type === 'names') updatePlayerCount();
  if (effectiveRenderType(wheelKey) === 'square') return;
  if (wheel.type === 'names') wheel.items = getNamesFromInput();

  const canvas = wheelKey === 'names' ? namesCanvasRef.value : optionsCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { items } = wheel;
  const total = items.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (total === 0) {
    ctx.fillStyle = '#fff'; ctx.font = '14px Tahoma'; ctx.textAlign = 'center';
    ctx.fillText('أدخل بيانات', canvas.width / 2, canvas.height / 2);
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = canvas.width / 2 - 10;
  const arcSize = (2 * Math.PI) / total;
  const sliceColors = assignWheelColors(total, COLORS);
  ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(wheel.angle);

  for (let i = 0; i < total; i++) {
    const angle = i * arcSize;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, angle, angle + arcSize); ctx.closePath();
    ctx.fillStyle = sliceColors[i]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.save(); ctx.rotate(angle + arcSize / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    const fontSize = total > 20 ? 11 : 13;
    ctx.font = `bold ${fontSize}px Tahoma`;
    let text = items[i];
    let avatarUrl = null;
    if (wheel.type === 'names') {
      const pShields = playerShields[items[i]];
      if (pShields && pShields.length > 0) {
        const emojis = pShields.map((s) => s.emoji).join('');
        text = `${emojis} ${text}`;
      }
      avatarUrl = nameAvatars[items[i]] || getUserAvatar(items[i]) || null;
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
  winnerSpan.value = optionWinner ? `النتيجة: ${nameWinner} - ${optionWinner}` : `النتيجة: ${nameWinner}`;
}

function setupActionUI(option, winnerName) {
  actionContainerVisible.value = false;
  primaryBtnVisible.value = false;
  secondaryBtnVisible.value = false;

  if (!option || !winnerName) return;
  actionContainerVisible.value = true;

  switch (option) {
    case 'يطرد شخص':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = '🗑️ طرد اللاعب المختار';
      break;
    case 'حصانة':
      otherPlayerOptions.value = [];
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = `🛡️ أخذ حصانة لـ ${winnerName}`;
      break;
    case 'ينطرد':
      otherPlayerOptions.value = [];
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = `🗑️ طرد ${winnerName}`;
      break;
    case 'يهدي حصانة':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn shield';
      primaryBtnText.value = '🛡️ إهداء حصانة';
      break;
    case 'يطلع ويطرد حد معاه':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = `🗑️ طرد ${winnerName} واللاعب المختار`;
      break;
    case 'تخطي':
      actionContainerVisible.value = false;
      break;
    case 'اختيار حر':
      updatePlayerSelect('all_except', winnerName);
      primaryBtnVisible.value = true;
      primaryBtnClass.value = 'action-btn';
      primaryBtnText.value = '🗑️ طرد اللاعب المختار';
      secondaryBtnVisible.value = true;
      secondaryBtnClass.value = 'action-btn shield';
      secondaryBtnText.value = '🛡️ منح/إهداء حصانة للمختار';
      break;
    default:
      break;
  }
}

function appendWinnerSpan(text) {
  winnerSpan.value += text;
}

function forceRemovePlayer(playerName) {
  if (!playerName) return;

  if (playerShields[playerName] && playerShields[playerName].length > 0) {
    availableShields.push(...playerShields[playerName]);
    playerShields[playerName] = [];
  }

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

function removePlayerSafely(playerName) {
  if (!playerName) return;

  if (playerShields[playerName] && playerShields[playerName].length > 0) {
    const brokenShield = playerShields[playerName].pop();
    availableShields.push(brokenShield);
    appendWinnerSpan(` | 🛡️ ${playerName} كان محمياً بـ (${brokenShield.emoji} ${brokenShield.name})! تم كسر الحصانة وإعادتها للبنك ولم يُطرد.`);
    drawWheel('names');
    return;
  }

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
  winnerOverlayText.value = name ? `🏆 اللاعب الفائز هو: ${name} 🎉` : '⚠️ انتهت اللعبة ولم يتبقَ أي لاعب!';
  winnerOverlayVisible.value = true;
  spinAllDisabled.value = true;
}
function hideWinnerOverlay() {
  winnerOverlayVisible.value = false;
}

function deleteWinningPlayer() {
  const winner = wheels.names.lastWinner;
  if (!winner) return;
  const hadShield = playerShields[winner] && playerShields[winner].length > 0;
  forceRemovePlayer(winner);
  appendWinnerSpan(hadShield
    ? ` | 🗑️ تم حذف اللاعب ${winner} نهائياً وإرجاع حصانته للبنك.`
    : ` | 🗑️ تم حذف اللاعب: ${winner}`);
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
    if (wheel.type === 'names') wheel.items = getNamesFromInput();
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
        const winner = effType === 'circle'
          ? wheel.items[Math.floor(((2 * Math.PI - (wheel.angle % (2 * Math.PI))) % (2 * Math.PI)) / arcSize)]
          : wheel.items[Math.floor(Math.random() * total)];
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
          optionsResultText.value = `النتيجة: ${winner}`;
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

function executePrimaryAction() {
  const option = wheels.options.lastWinner;
  const winner = wheels.names.lastWinner;
  const target = otherPlayerSelected.value;

  if (!option || !winner) return;

  if (option === 'يطرد شخص') {
    removePlayerSafely(target);
    appendWinnerSpan(` | تم طرد اللاعب: ${target}`);
  } else if (option === 'حصانة') {
    if (availableShields.length > 0) {
      const shield = availableShields.shift();
      if (!playerShields[winner]) playerShields[winner] = [];
      playerShields[winner].push(shield);
      appendWinnerSpan(` | ${winner} أخذ حصانة (${shield.emoji} ${shield.name}) 🛡️`);
      drawWheel('names');
    } else {
      const playersWithShields = Object.keys(playerShields).filter((p) => playerShields[p] && playerShields[p].length > 0 && p !== winner);
      if (playersWithShields.length > 0) {
        const victim = playersWithShields[0];
        const stolen = playerShields[victim].pop();
        if (!playerShields[winner]) playerShields[winner] = [];
        playerShields[winner].push(stolen);
        appendWinnerSpan(` | البنك فارغ! تم سحب حصانة (${stolen.emoji}) من اللاعب ${victim} وإعطائها لـ ${winner} 🛡️`);
        drawWheel('names');
      } else {
        appendWinnerSpan(' | البنك فارغ ولا يوجد لاعب لديه حصانة للسحب (تم التخطي).');
      }
    }
  } else if (option === 'ينطرد') {
    removePlayerSafely(winner);
    appendWinnerSpan(` | تم طرد ${winner}`);
  } else if (option === 'يهدي حصانة') {
    if (availableShields.length > 0 && target) {
      const shield = availableShields.shift();
      if (!playerShields[target]) playerShields[target] = [];
      playerShields[target].push(shield);
      appendWinnerSpan(` | تم إهداء حصانة (${shield.emoji} ${shield.name}) لـ ${target} 🛡️`);
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
  } else if (option === 'يطلع ويطرد حد معاه') {
    removePlayerSafely(winner);
    removePlayerSafely(target);
    appendWinnerSpan(` | تم طرد ${winner} و ${target}`);
  } else if (option === 'اختيار حر') {
    removePlayerSafely(target);
    appendWinnerSpan(` | (اختيار حر) تم طرد: ${target}`);
  }

  actionContainerVisible.value = false;
}

function executeSecondaryAction() {
  const option = wheels.options.lastWinner;
  const target = otherPlayerSelected.value;

  if (option === 'اختيار حر' && target) {
    if (availableShields.length > 0) {
      const shield = availableShields.shift();
      if (!playerShields[target]) playerShields[target] = [];
      playerShields[target].push(shield);
      appendWinnerSpan(` | (اختيار حر) تم إهداء حصانة (${shield.emoji} ${shield.name}) لـ: ${target} 🛡️`);
      drawWheel('names');
      actionContainerVisible.value = false;
    } else {
      const owners = Object.keys(playerShields).filter((p) => playerShields[p] && playerShields[p].length > 0);
      if (owners.length > 0) {
        const donor = owners[0];
        const transShield = playerShields[donor].pop();
        if (!playerShields[target]) playerShields[target] = [];
        playerShields[target].push(transShield);
        appendWinnerSpan(` | (اختيار حر) البنك فارغ! تم نقل حصانة (${transShield.emoji}) من ${donor} إلى ${target} 🛡️`);
        drawWheel('names');
        actionContainerVisible.value = false;
      } else {
        window.alert('عذراً، البنك فارغ ولا توجد حصانات لتوزيعها!');
      }
    }
  }
}

async function spinBothWheels() {
  if (spinAllDisabled.value) return;
  spinAllDisabled.value = true;
  currentRound.value++;

  await Promise.all([
    renderType.value === 'avatars' ? spinNamesRing() : spinWheelPromise('names'),
    spinWheelPromise('options'),
  ]);

  checkShieldDestructionEvents();
  spinAllDisabled.value = false;
}

function resetGame() {
  const currentNames = getNamesFromInput();
  const restoredNames = [...new Set([...currentNames, ...removedNamesHistory])];
  namesInput.value = restoredNames.join('\n');
  removedNamesHistory = [];
  tiktokJoinedUsers.clear();
  stopRegistration();

  if (initialNamesSnapshot && !namesInput.value) {
    namesInput.value = initialNamesSnapshot;
  }

  gameStarted = false;
  currentRound.value = 0;
  nextExplosionRound = 0;
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
  if (current.includes(name) || current.length >= 50) {
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
    if (playersModalVisible.value || joinSettingsModalVisible.value) return;
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
const giftNameFilter = ref('');
const giftMinValue = ref(null);
const selectedGiftLabel = computed(() => {
  const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
  return found ? found.label : '🎁 أي هدية';
});
const tiktokJoinedUsers = new Set();

// ===== شراء الرجوع للعبة بالهدايا (للاعبين المطرودين) =====
const buyReturnEnabled = ref(false);
const buyReturnGift = ref('');
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
  if (joinViaGift.value) {
    joinModeHint.value = 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل هدية أثناء البث ينضم تلقائياً للعجلة. حدد اسم هدية معينة و/أو أقل قيمة إذا تبي تقيّد نوع الهدية المقبولة.';
    tiktokSectionLabel.value = '🔴 ربط بث تيك توك لايف (اختياري): من يرسل هدية ينضم تلقائياً للعجلة';
  } else {
    joinModeHint.value = `المشاهد يكتب "${getJoinWord()}" بالدردشة عشان ينضم للعجلة. غيّر الكلمة من الحقل، أو فعّل خيار الهدايا ليصير الانضمام بإرسال أي هدية بدل الكتابة.`;
    tiktokSectionLabel.value = `🔴 ربط بث تيك توك لايف (اختياري): من يكتب "${getJoinWord()}" بالدردشة ينضم تلقائياً للعجلة`;
  }
}

const nameAvatars = reactive({});

function joinUserToWheel(user, avatar) {
  if (!user) return;
  if (tiktokJoinedUsers.has(user)) return;
  tiktokJoinedUsers.add(user);

  const currentNames = getNamesFromInput();
  if (currentNames.includes(user)) return;

  nameAvatars[user] = avatar || getUserAvatar(user);
  currentNames.push(user);
  namesInput.value = currentNames.join('\n');
  drawWheel('names');
  updatePlayerCount();
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
const registrationTimeLeft = ref(0);
const registrationDurationInput = ref(60);
const extendSecondsInput = ref(30);
let registrationTimer = null;

const registrationStatusHint = ref('');
function updateRegistrationHint() {
  registrationStatusHint.value = registrationOpen.value
    ? `🟢 التسجيل مفتوح — ${registrationTimeLeft.value} ثانية متبقية. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
    : '🔒 التسجيل مغلق — حدد المدة واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.';
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
  registrationTimer = setInterval(() => {
    registrationTimeLeft.value--;
    if (registrationTimeLeft.value <= 0) stopRegistration();
    else updateRegistrationHint();
  }, 1000);
}

function extendRegistration() {
  if (!registrationOpen.value) return;
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

function handleTiktokMessage(data) {
  if (data.comment) {
    handleTikTokComment(data.comment, data.user, data.avatar);
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

onMounted(() => {
  updateJoinModeUI();
  updateRegistrationHint();
  document.addEventListener('keydown', handleGlobalKeydown);

  initialNamesSnapshot = namesInput.value;
  initializeShields();
  nextTick(() => {
    drawWheel('names');
    drawWheel('options');
  });
  setMessageHandler(handleTiktokMessage);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  stopNamesRingChase();
  clearMessageHandler();
});
</script>

<template>
  <h1>عجلة الصامل</h1>
  <div class="subtitle">منصة تحديات 956BR</div>

  <div class="master-controls">
    <div v-if="deleteWinnerVisible" class="floating-action-bar">
      <button class="action-btn" @click="deleteWinningPlayer">🗑️ حذف الفائز</button>
    </div>
    <button class="reset-btn" @click="resetGame">🔄 لعبة جديدة</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <router-link to="/wheel-rules" class="back-btn" target="_blank">🎮 دليل القواعد ونظام اللعب</router-link>
  </div>

  <div class="side-floating-panel">
    <button type="button" class="master-btn side-panel-toggle-btn" @click="barExpanded = !barExpanded">{{ barExpanded ? '➖' : '➕' }}</button>
    <template v-if="barExpanded">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)" class="side-panel-input">
      <button class="master-btn side-panel-btn" @click="connectTikTok">اتصال 🔗</button>
    </template>
    <p class="side-panel-status" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
    <button class="master-btn side-panel-btn" :disabled="spinAllDisabled" @click="spinBothWheels">🎲 دورها </button>
    <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openPlayersModal">👥 عدد اللاعبين: <span>{{ playerCountNum }}</span></button>
    <template v-if="barExpanded">
      <button type="button" class="player-count-badge side-panel-count player-count-btn" @click="openJoinSettingsModal">{{ joinViaGift ? `🎁 هدية الانضمام: "${selectedGiftLabel}"` : `🎟️ رمز الانضمام: ${getJoinWord()}` }}</button>
      <button
        :class="registrationOpen ? 'reset-btn' : 'master-btn'"
        class="side-panel-btn"
        @click="registrationOpen ? stopRegistration() : startRegistration()"
      >{{ registrationOpen ? '⛔ إيقاف التسجيل' : '🟢 بدء التسجيل' }}</button>
    </template>
  </div>

  <div v-if="announcementVisible" class="announcement-banner" style="display:block;">{{ announcementMsg }}</div>

  <div v-if="winnerOverlayVisible" class="winner-overlay" style="display:flex;">
    <div class="winner-overlay-card">
      <div class="winner-overlay-text">{{ winnerOverlayText }}</div>
      <button class="master-btn" @click="onWinnerNewGame">🆕 لعبة جديدة</button>
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
      <div v-else class="players-modal-list">
        <div v-for="name in getNamesFromInput()" :key="name" class="players-modal-item">
          <span class="players-modal-item-name"><img v-if="nameAvatars[name]" :src="nameAvatars[name]" class="player-avatar" alt="">{{ name }}</span>
          <button type="button" class="players-modal-remove-btn" @click="removePlayerFromModal(name)">🗑️ حذف</button>
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
          <input id="joinViaGiftCheckboxModal" v-model="joinViaGift" type="checkbox" @change="updateJoinModeUI">
          🎁 الانضمام بإرسال هدية بدل كتابة الكلمة
        </label>
      </div>
      <div v-if="!joinViaGift" class="join-settings-row">
        <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" @input="updateJoinModeUI">
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

  <div class="layout-wrapper">
    <div class="panel unified-panel">
      <div class="render-type-toggle">
        <button class="master-btn render-type-btn" @click="toggleRenderType">
          {{ renderType === 'circle' ? '🎡 عجلة' : renderType === 'avatars' ? '🖼️ دوائر' : '🟨 عرض النتيجة فقط' }}
          <span class="toggle-hint">— اضغط لتبديل شكل عجلة الأسماء (عجلة الخيارات تبقى كلاسيكية دائماً)</span>
        </button>

        <label class="join-gift-toggle buy-return-inline-toggle" for="buyReturnCheckboxInline">
          <input id="buyReturnCheckboxInline" v-model="buyReturnEnabled" type="checkbox">
          🔄 شراء الرجوع للعبة بالهدايا (للاعبين المطرودين)
        </label>
      </div>

      <div v-if="buyReturnEnabled" class="gift-filter-row buy-return-inline-filter">
        <CustomSelect v-model="buyReturnGift" :options="GIFT_OPTIONS" />
        <input v-model="buyReturnMinValue" type="number" min="0" placeholder="أقل قيمة/كوينز (اختياري)">
        <div class="field-hint" style="width:100%; text-align:center;">🎁 أي لاعب مطرود يرسل <b>"{{ selectedBuyReturnGiftLabel }}"</b>{{ buyReturnMinValue ? ` (بقيمة ${buyReturnMinValue}+ كوينز)` : '' }} يرجع فوراً للعبة.</div>
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
              </div>
            </div>

            <div class="result-box" :class="{ show: namesResultShow }">
              <span>{{ winnerSpan }}</span>
              <div v-if="actionContainerVisible" class="action-container" style="display:flex;">
                <div class="action-row">
                  <CustomSelect
                    v-if="otherPlayerOptions.length"
                    v-model="otherPlayerSelected"
                    :options="otherPlayerOptions"
                    class="action-select"
                  />
                  <button v-if="primaryBtnVisible" :class="primaryBtnClass" @click="executePrimaryAction">{{ primaryBtnText }}</button>
                </div>
                <div class="action-row">
                  <button v-if="secondaryBtnVisible" :class="secondaryBtnClass" @click="executeSecondaryAction">{{ secondaryBtnText }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="wheel-col">
          <div class="wheel-display">
            <div v-show="renderType !== 'square'" class="wheel-container">
              <div class="pointer"></div>
              <canvas ref="optionsCanvasRef" width="300" height="300"></canvas>
            </div>

            <div v-show="renderType === 'square'" class="square-wheel" style="display:flex;">
              <div class="square-item">{{ optionsSquareText }}</div>
            </div>

            <div class="result-box" :class="{ show: optionsResultShow }">{{ optionsResultText }}</div>
          </div>

          <div class="options-hint">📜 الخيارات المتاحة: يطرد شخص، حصانة، ينطرد، يهدي حصانة، يطلع ويطرد حد معاه، تخطي، اختيار حر.</div>
        </div>
      </div>

      <div class="shields-panel combined-shields-panel">
        <div class="shields-title">🛡️ بنك الحصانات وحالة اللاعبين:</div>
        <div>
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
                  - {{ player }}: [{{ shields.map(s => `${s.emoji} ${s.name}`).join(', ') }}]<br>
                </template>
              </template>
            </template>
            <template v-else>لا توجد حصانات مسجلة لدى اللاعبين حالياً</template>
          </div>
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
  width: 100%;
  max-width: 1600px;
  background: #c0392b;
  color: #fff;
  padding: 15px 20px;
  border-radius: 10px;
  text-align: center;
  font-weight: bold;
  font-size: 1.2rem;
  margin-bottom: 25px;
  box-shadow: 0 0 20px rgba(192, 57, 43, 0.5);
  animation: pulseBanner 1.5s infinite;
  white-space: pre-line;
}

@keyframes pulseBanner {
  0% { transform: scale(1); }
  50% { transform: scale(1.01); }
  100% { transform: scale(1); }
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

.options-hint {
  margin-top: 15px;
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 12px 15px;
  font-size: 0.85rem;
  color: #aaa;
  text-align: right;
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

.players-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 15px;
}

.players-modal-card {
  background: #2a2a40;
  padding: 20px;
  border-radius: 15px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
  border: 1px solid var(--primary-color);
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.players-modal-card h3 {
  margin: 0 0 15px;
  color: var(--primary-color);
  text-align: center;
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


@media (max-width: 768px) {
  h1 { font-size: 1.8rem; }
  .wheel-container { width: 260px; height: 260px; }
  .master-controls { flex-direction: column; gap: 15px; }
}
</style>
