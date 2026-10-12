// مدير اتصال تيك توك المشترك على مستوى الموقع كامل.
// السوكيت لا يتبع دورة حياة أي صفحة لعبة بعينها؛ فقط App.vue يجدول قطعه (بعد مهلة)
// عند اختفاء التبويب، ويلغي الجدولة عند رجوعه — راجع src/App.vue.

import { reactive, shallowRef } from 'vue';
import { BRIDGE_URL, isGiftEvent, getGiftName, getGiftUnitValue, getGiftImage } from './tiktokBridge';
import { trackConnectRequest, reportGift } from './analytics';

export const tiktokState = reactive({
  username: '',
  status: '',
  statusColor: '',
});

let socket = null;
let messageHandler = null;
let disconnectTimer = null;

// آخر صورة أفاتار وصلت لكل مستخدم (من رسائل الشات، اللي هي الوحيدة اللي تحمل صورة).
// تستخدمها كل الألعاب عشان تعرض الصورة جنب الاسم بقائمة التسجيل حتى لو انضم المستخدم عبر هدية بدون تعليق.
// reactive عشان أي لعبة تقرأ منها مباشرة بالقالب (getUserAvatar) تتحدث تلقائياً لما توصل الصورة لاحقاً.
const avatarByUser = reactive(new Map());

export function getUserAvatar(username) {
  return avatarByUser.get(username) || '';
}

// حسابات مختلفة ممكن يكون لها نفس النك نيم، والألعاب كلها تعرّف اللاعب بالاسم (data.user).
// فالاسم اللي يوصل للعبة دايماً "النك نيم @اليوزر" عشان يكون فريد وثابت لكل حساب،
// والعرض يمر على displayName: يخفي اليوزر إلا لو فيه أكثر من حساب بنفس النك نيم (ساعتها يطلع للكل).
const accountsByNickname = reactive(new Map()); // nickname -> Set(uniqueId)

function resolveUniqueName(nickname, uniqueId) {
  if (!uniqueId) return nickname;
  if (!accountsByNickname.has(nickname)) accountsByNickname.set(nickname, new Set());
  accountsByNickname.get(nickname).add(uniqueId);
  return `${nickname} @${uniqueId}`;
}

// reactive: لو استُخدمت بالقالب، الأسماء تتحدث تلقائياً أول ما يظهر حساب ثاني بنفس النك نيم.
// الأسماء المضافة يدوياً (بدون يوزر) ترجع مثل ما هي.
// isNameTaken(nickname): فحص اللعبة المفتوحة (تسجله مع setMessageHandler) عشان اليوزر يطلع كذلك
// لو فيه لاعب مضاف يدوياً بنفس النك نيم. shallowRef عشان القوالب تتحدث أول ما اللعبة تسجله.
const nameTakenCheck = shallowRef(null);

export function setNameTakenCheck(fn) {
  nameTakenCheck.value = fn || null;
}

export function displayName(name, isNameTaken = nameTakenCheck.value) {
  const match = /^(.*) @([\w.]+)$/.exec(String(name ?? ''));
  if (!match) return name;
  const accounts = accountsByNickname.get(match[1]);
  if (accounts && accounts.size > 1) return name;
  return isNameTaken && isNameTaken(match[1]) ? name : match[1];
}

export function setMessageHandler(fn) {
  messageHandler = fn;
}

export function clearMessageHandler() {
  messageHandler = null;
}

export function cancelScheduledDisconnect() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

export function scheduleDisconnect(delayMs = 5 * 60 * 1000) {
  if (disconnectTimer || !socket) return;
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (socket) { socket.close(); socket = null; }
  }, delayMs);
}

export function connect(username, { gameSlug, onMessage } = {}) {
  const trimmed = String(username || '').trim();
  if (!trimmed) {
    tiktokState.status = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokState.statusColor = 'orange';
    return;
  }

  cancelScheduledDisconnect();

  const reusable = socket
    && tiktokState.username === trimmed
    && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);

  if (reusable) {
    messageHandler = onMessage;
    return;
  }

  if (socket) socket.close();
  messageHandler = onMessage;
  tiktokState.username = trimmed;
  trackConnectRequest(gameSlug, trimmed);

  tiktokState.status = `⏳ جاري الاتصال بـ ${trimmed} ...`;
  tiktokState.statusColor = '#f1c40f';

  socket = new WebSocket(`${BRIDGE_URL}?user=${trimmed}`);

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status) { tiktokState.status = data.status; tiktokState.statusColor = '#2ecc71'; }
    if (data.error) { tiktokState.status = data.error; tiktokState.statusColor = '#e74c3c'; }
    if (data.user) data.user = resolveUniqueName(data.user, data.uniqueId);
    if (data.user && data.avatar) avatarByUser.set(data.user, data.avatar);
    if (isGiftEvent(data)) {
      reportGift({ name: getGiftName(data), value: getGiftUnitValue(data), image: getGiftImage(data), giftId: data.giftId });
    }
    if (messageHandler) messageHandler(data);
  };

  socket.onerror = () => {
    tiktokState.status = '❌ صار خطأ بالاتصال';
    tiktokState.statusColor = '#e74c3c';
  };

  socket.onclose = () => {
    tiktokState.status = '🔌 تم قطع الاتصال';
    tiktokState.statusColor = '#95a5a6';
  };
}
