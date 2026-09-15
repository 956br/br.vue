<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  BRIDGE_URL, normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser,
} from '../../utils/tiktokBridge';

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

// ===== حالة اللاعبين والخيارات =====
const namesInput = ref('أحمد\nمحمد\nعلي\nجاسم\nفاطمة');
let initialNamesSnapshot = '';
const topNamesVisible = ref(true);

const availableShields = reactive([]);
const playerShields = reactive({});
let gameStarted = false;
const currentRound = ref(0);
let nextExplosionRound = 0;
let removedNamesHistory = [];

const wheels = reactive({
  names: {
    items: [], angle: 0, isSpinning: false, type: 'names', lastWinner: null, renderType: 'circle',
  },
  options: {
    items: OPTIONS_DATA, angle: 0, isSpinning: false, type: 'options', lastWinner: null, renderType: 'circle',
  },
});

const namesCanvasRef = ref(null);
const optionsCanvasRef = ref(null);
const namesSquareText = ref('في انتظار البدء...');
const optionsSquareText = ref('الخيارات الجاهزة');
const playerCountNum = ref(0);

const namesHeaderResult = ref('');
const optionsHeaderResult = ref('');
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

function switchWheelType(wheelKey, value) {
  wheels[wheelKey].renderType = value;
  nextTick(() => {
    if (value === 'circle') drawWheel(wheelKey);
    else {
      const items = wheelKey === 'names' ? getNamesFromInput() : OPTIONS_DATA;
      const text = items.length > 0 ? items[0] : 'فارغ';
      if (wheelKey === 'names') namesSquareText.value = text;
      else optionsSquareText.value = text;
    }
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
  topNamesVisible.value = false;
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
  if (wheel.renderType === 'square') return;
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
  ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(wheel.angle);

  for (let i = 0; i < total; i++) {
    const angle = i * arcSize;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, angle, angle + arcSize); ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.save(); ctx.rotate(angle + arcSize / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    const fontSize = total > 20 ? 11 : 13;
    ctx.font = `bold ${fontSize}px Tahoma`;
    let text = items[i];
    if (wheel.type === 'names') {
      const pShields = playerShields[items[i]];
      if (pShields && pShields.length > 0) {
        const emojis = pShields.map((s) => s.emoji).join('');
        text = `${emojis} ${text}`;
      }
    }
    if (text.length > 18) text = `${text.substring(0, 15)}...`;
    ctx.fillText(text, radius - 15, 5);
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI); ctx.fillStyle = '#2c3e50'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
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

function spinWheelPromise(wheelKey) {
  return new Promise((resolve) => {
    if (!gameStarted && wheelKey === 'names') initializeShields();
    const wheel = wheels[wheelKey];
    if (wheel.type === 'names') wheel.items = getNamesFromInput();
    if (wheel.isSpinning || wheel.items.length === 0) { resolve(null); return; }

    wheel.isSpinning = true;

    if (wheel.type === 'names') {
      winnerSpan.value = 'جاري التدوير...';
      actionContainerVisible.value = false;
      namesResultShow.value = false;
      deleteWinnerVisible.value = false;
      namesHeaderResult.value = '⏳ جاري التدوير...';
    } else {
      optionsResultText.value = 'جاري التدوير...';
      optionsResultShow.value = false;
      optionsHeaderResult.value = '⏳ جاري التدوير...';
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

      if (wheel.renderType === 'square') {
        const randomIdx = Math.floor(Math.random() * total);
        if (wheelKey === 'names') namesSquareText.value = wheel.items[randomIdx];
        else optionsSquareText.value = wheel.items[randomIdx];
      }
      if (Math.abs(wheel.angle - lastTickAngle) > (arcSize / 2)) { playSpinTickSound(); lastTickAngle = wheel.angle; }
      if (wheel.renderType === 'circle') drawWheel(wheelKey);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        wheel.isSpinning = false;
        const winner = wheel.renderType === 'circle'
          ? wheel.items[Math.floor(((2 * Math.PI - (wheel.angle % (2 * Math.PI))) % (2 * Math.PI)) / arcSize)]
          : wheel.items[Math.floor(Math.random() * total)];
        if (wheel.renderType === 'square') {
          if (wheelKey === 'names') namesSquareText.value = winner;
          else optionsSquareText.value = winner;
        }

        wheel.lastWinner = winner;
        playWinSound();

        if (wheel.type === 'names') {
          winnerSpan.value = `النتيجة: ${winner}`;
          namesHeaderResult.value = `🎯 ${winner}`;
          namesResultShow.value = true;
          deleteWinnerVisible.value = true;
          const currentNames = getNamesFromInput();
          if (currentNames.length === 1) {
            showWinnerOverlay(currentNames[0]);
          } else {
            const currentOption = wheels.options.lastWinner;
            if (currentOption) setupActionUI(currentOption, winner);
          }
        } else {
          optionsResultText.value = `النتيجة: ${winner}`;
          optionsHeaderResult.value = `🎯 ${winner}`;
          optionsResultShow.value = true;
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
    spinWheelPromise('names'),
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
  topNamesVisible.value = true;
  drawWheel('names');
  winnerSpan.value = 'النتيجة: في انتظار التدوير';
  optionsResultText.value = 'النتيجة: في انتظار التدوير';
  namesResultShow.value = false;
  optionsResultShow.value = false;
  deleteWinnerVisible.value = false;
  namesHeaderResult.value = '';
  optionsHeaderResult.value = '';
  actionContainerVisible.value = false;
  hideWinnerOverlay();
  spinAllDisabled.value = false;
  wheels.names.lastWinner = null;
  wheels.options.lastWinner = null;
}

function onWinnerNewGame() {
  hideWinnerOverlay();
  resetGame();
}

function onNamesInputChanged() {
  gameStarted = false;
  drawWheel('names');
}

function goHome() {
  router.push('/');
}

function handleGlobalKeydown(event) {
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault();
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) return;
    spinBothWheels();
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
const tiktokJoinedUsers = new Set();
let tiktokSocket = null;

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

function joinUserToWheel(user) {
  if (!user) return;
  if (tiktokJoinedUsers.has(user)) return;
  tiktokJoinedUsers.add(user);

  const currentNames = getNamesFromInput();
  if (currentNames.includes(user)) return;

  currentNames.push(user);
  namesInput.value = currentNames.join('\n');
  drawWheel('names');
  updatePlayerCount();
}

function handleTikTokComment(comment, user) {
  if (!registrationOpen.value) return;
  if (joinViaGift.value) return;
  const text = normalizeDigits(comment).trim();
  if (text !== normalizeDigits(getJoinWord())) return;
  joinUserToWheel(user);
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
      handleTikTokComment(data.comment, data.user);
    }
    if (registrationOpen.value && joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      joinUserToWheel(getGiftUser(data));
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
  updateJoinModeUI();
  updateRegistrationHint();
  document.addEventListener('keydown', handleGlobalKeydown);

  initialNamesSnapshot = namesInput.value;
  initializeShields();
  nextTick(() => {
    drawWheel('names');
    drawWheel('options');
  });
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (registrationTimer) clearInterval(registrationTimer);
  if (tiktokSocket) {
    tiktokSocket.close();
    tiktokSocket = null;
  }
});
</script>

<template>
  <h1>عجلة الحظ</h1>
  <div class="subtitle">منصة تحديات بو راشد | @956br</div>

  <div class="master-controls">
    <div class="floating-action-bar">
      <button class="master-btn" :disabled="spinAllDisabled" @click="spinBothWheels">🎲 دورها </button>
      <button v-if="deleteWinnerVisible" class="action-btn" @click="deleteWinningPlayer">🗑️ حذف الفائز</button>
    </div>
    <button class="reset-btn" @click="resetGame">🔄 لعبة جديدة</button>
    <div class="rounds-badge">الجولة: {{ currentRound }}</div>
    <button class="home-btn" @click="goHome">🏠 الخروج</button>
    <router-link to="/wheel-rules" class="back-btn" target="_blank">🎮 دليل القواعد ونظام اللعب</router-link>
  </div>

  <div v-show="topNamesVisible" class="top-names-section">
    <label for="namesInput">📋 قائمة اللاعبين (كل اسم في سطر):</label>
    <textarea id="namesInput" v-model="namesInput" placeholder="أحمد&#10;محمد&#10;علي&#10;جاسم&#10;فاطمة" @input="onNamesInputChanged"></textarea>
  </div>

  <div class="top-names-section">
    <label for="tiktokUsername">{{ tiktokSectionLabel }}</label>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input id="tiktokUsername" v-model="tiktokUsername" type="text" placeholder="اسم حساب تيك توك (بدون @)"
        style="flex:1; min-width:200px; background: rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:white; padding:12px; font-size:1.05rem;">
      <button class="master-btn" style="padding:10px 25px; font-size:1rem; margin:0;" @click="connectTikTok">اتصال 🔗</button>
    </div>
    <div class="join-settings-row">
      <input v-model="joinWordInput" type="text" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" @input="updateJoinModeUI">
      <label class="join-gift-toggle" for="joinViaGiftCheckbox">
        <input id="joinViaGiftCheckbox" v-model="joinViaGift" type="checkbox" @change="updateJoinModeUI">
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
    <p style="margin-top:10px; font-weight:bold;" :style="{ color: tiktokStatusColor }">{{ tiktokStatus }}</p>
  </div>

  <div v-if="announcementVisible" class="announcement-banner" style="display:block;">{{ announcementMsg }}</div>

  <div v-if="winnerOverlayVisible" class="winner-overlay" style="display:flex;">
    <div class="winner-overlay-card">
      <div class="winner-overlay-text">{{ winnerOverlayText }}</div>
      <button class="master-btn" @click="onWinnerNewGame">🆕 لعبة جديدة</button>
    </div>
  </div>

  <div class="layout-wrapper">
    <div class="games-area">
      <div class="panel">
        <h2>عجلة الأسماء <span class="header-result">{{ namesHeaderResult }}</span></h2>
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:15px; width:100%;">
          <select class="action-select" style="margin:0;" :value="wheels.names.renderType" @change="switchWheelType('names', $event.target.value)">
            <option value="circle">دائرية (واقعية)</option>
            <option value="square">مربعة (متحركة)</option>
          </select>
        </div>

        <div class="player-count-badge">👥 عدد اللاعبين: <span>{{ playerCountNum }}</span></div>

        <div class="wheel-display">
          <div v-show="wheels.names.renderType === 'circle'" class="wheel-container">
            <div class="pointer"></div>
            <canvas ref="namesCanvasRef" width="300" height="300"></canvas>
          </div>

          <div v-show="wheels.names.renderType === 'square'" class="square-wheel" style="display:flex;">
            <div class="square-item">{{ namesSquareText }}</div>
          </div>

          <div class="result-box" :class="{ show: namesResultShow }">
            <span>{{ winnerSpan }}</span>
            <div v-if="actionContainerVisible" class="action-container" style="display:flex;">
              <div class="action-row">
                <select v-if="otherPlayerOptions.length" v-model="otherPlayerSelected" class="action-select">
                  <option v-for="opt in otherPlayerOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <button v-if="primaryBtnVisible" :class="primaryBtnClass" @click="executePrimaryAction">{{ primaryBtnText }}</button>
              </div>
              <div class="action-row">
                <button v-if="secondaryBtnVisible" :class="secondaryBtnClass" @click="executeSecondaryAction">{{ secondaryBtnText }}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="shields-panel">
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

      <div class="panel">
        <h2>عجلة الخيارات <span class="header-result">{{ optionsHeaderResult }}</span></h2>
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:15px; width:100%;">
          <select class="action-select" style="margin:0;" :value="wheels.options.renderType" @change="switchWheelType('options', $event.target.value)">
            <option value="circle">دائرية (واقعية)</option>
            <option value="square">مربعة (متحركة)</option>
          </select>
        </div>

        <div class="wheel-display">
          <div v-show="wheels.options.renderType === 'circle'" class="wheel-container">
            <div class="pointer"></div>
            <canvas ref="optionsCanvasRef" width="300" height="300"></canvas>
          </div>

          <div v-show="wheels.options.renderType === 'square'" class="square-wheel" style="display:flex;">
            <div class="square-item">{{ optionsSquareText }}</div>
          </div>

          <div class="result-box" :class="{ show: optionsResultShow }">{{ optionsResultText }}</div>
        </div>

        <div class="shields-panel" style="margin-top: 15px; background: rgba(0,0,0,0.2); border-color: rgba(255,255,255,0.1);">
          <div class="shields-title" style="color: #bdc3c7;">📜 الخيارات المتاحة:</div>
          <div style="font-size: 0.85rem; color: #aaa;">يطرد شخص، حصانة، ينطرد، يهدي حصانة، يطلع ويطرد حد معاه، تخطي، اختيار حر.</div>
        </div>
      </div>
    </div>

    <div class="video-ad-panel">
      <h3>مساحة إعلانية</h3>
      <div class="vertical-video-container">
        <video autoplay muted loop playsinline controls>
          <source src="/your-video-ad.mp4" type="video/mp4">
          متصفحك لا يدعم عرض الفيديو.
        </video>
      </div>
    </div>
  </div>

  <div class="footer-note" style="margin-top: 40px;">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
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
  bottom: 25px;
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
    bottom: 15px;
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
  grid-template-columns: 1fr 340px;
  gap: 30px;
  width: 100%;
  max-width: 1600px;
  align-items: start;
}

.games-area {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 30px;
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

.panel h2 {
  font-size: 1.5rem;
  margin-bottom: 15px;
  color: #ecf0f1;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 5px;
  width: 100%;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.video-ad-panel {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  position: sticky;
  top: 20px;
}

.video-ad-panel h3 {
  color: var(--secondary-color);
  margin-bottom: 15px;
  font-size: 1.1rem;
}

.vertical-video-container {
  width: 100%;
  aspect-ratio: 9 / 16;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.1);
  position: relative;
  box-shadow: 0 5px 15px rgba(0,0,0,0.5);
}

.vertical-video-container video {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  margin-bottom: 15px;
}

.header-result {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--secondary-color, #f39c12);
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 3px 12px;
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

@media (max-width: 1200px) {
  .layout-wrapper {
    grid-template-columns: 1fr;
  }
  .video-ad-panel {
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    position: static;
  }
}

@media (max-width: 768px) {
  h1 { font-size: 1.8rem; }
  .wheel-container { width: 260px; height: 260px; }
  .master-controls { flex-direction: column; gap: 15px; }
}
</style>
