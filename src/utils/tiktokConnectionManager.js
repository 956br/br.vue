// مدير اتصال تيك توك المشترك على مستوى الموقع كامل.
// السوكيت لا يتبع دورة حياة أي صفحة لعبة بعينها؛ فقط App.vue يجدول قطعه (بعد مهلة)
// عند اختفاء التبويب، ويلغي الجدولة عند رجوعه — راجع src/App.vue.

import { reactive, shallowRef } from 'vue';
import { BRIDGE_URL, isGiftEvent, getGiftName, getGiftUnitValue, getGiftImage } from './tiktokBridge';
import { trackConnectRequest, reportGift } from './analytics';

// username مربوط بخانة الإدخال (v-model) فيتغير مع الكتابة؛ connectedUser هو الحساب اللي السوكيت الحالي متصل فيه فعلاً.
// failed: السوكيت الحالي طلع خطأ (من السيرفر أو من الشبكة)، فالضغط مرة ثانية يعيد المحاولة بدل ما يقطع.
export const tiktokState = reactive({
  username: '',
  status: '',
  statusColor: '',
  connectedUser: '',
  failed: false,
  // live: السيرفر أكّد الاتصال (وصلت أول رسالة status) — يصير false عند الخطأ أو القطع
  live: false,
  // نص زر الاتصال: يصير "قطع" لما يكون فيه اتصال سليم بنفس الاسم المكتوب
  get connectLabel() {
    const active = this.connectedUser && !this.failed && this.connectedUser === String(this.username || '').trim();
    return active ? 'قطع الاتصال ✂️' : 'اتصال 🔗';
  },
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
    disconnect();
  }, delayMs);
}

// يقفل السوكيت الحالي. نصفّر socket قبل close عشان onclose حقه (يوصل متأخر) ما يكتب فوق حالة اتصال جديد.
function closeSocket() {
  if (!socket) return;
  const old = socket;
  socket = null;
  old.close();
  tiktokState.connectedUser = '';
  tiktokState.failed = false;
  tiktokState.live = false;
}

export function disconnect() {
  if (!socket) return;
  closeSocket();
  tiktokState.status = '🔌 تم قطع الاتصال';
  tiktokState.statusColor = '#95a5a6';
}

export function connect(username, { gameSlug, onMessage } = {}) {
  const trimmed = String(username || '').trim();
  if (!trimmed) {
    tiktokState.status = '⚠️ لازم تكتب اسم الحساب أول';
    tiktokState.statusColor = 'orange';
    return;
  }

  cancelScheduledDisconnect();

  // اتصال سليم بنفس الاسم: الزر يقطع الاتصال. لو فيه خطأ أو الاسم تغيّر نكمل ونعيد الاتصال.
  if (socket && !tiktokState.failed && tiktokState.connectedUser === trimmed) {
    disconnect();
    return;
  }

  closeSocket();
  messageHandler = onMessage;
  tiktokState.username = trimmed;
  tiktokState.connectedUser = trimmed;
  tiktokState.failed = false;
  trackConnectRequest(gameSlug, trimmed);

  tiktokState.status = `⏳ جاري الاتصال بـ ${trimmed} ...`;
  tiktokState.statusColor = '#f1c40f';

  const ws = new WebSocket(`${BRIDGE_URL}?user=${trimmed}`);
  socket = ws;

  ws.onmessage = (event) => {
    if (ws !== socket) return;
    const data = JSON.parse(event.data);
    if (data.status) { tiktokState.status = data.status; tiktokState.statusColor = '#2ecc71'; tiktokState.failed = false; tiktokState.live = true; }
    if (data.error) { tiktokState.status = data.error; tiktokState.statusColor = '#e74c3c'; tiktokState.failed = true; tiktokState.live = false; }
    if (data.user) data.user = resolveUniqueName(data.user, data.uniqueId);
    // الصورة ممكن توصل بأكثر من اسم حقل حسب نوع الحدث (نفس اللي كانت تقراه الصفحات القديمة بمجلد legacy)
    const avatar = [data.avatar, data.profilePictureUrl, data.profilePicture, data.userAvatar].find((v) => typeof v === 'string' && v);
    if (avatar) data.avatar = avatar;
    if (data.user && data.avatar) avatarByUser.set(data.user, data.avatar);
    if (isGiftEvent(data)) {
      reportGift({ name: getGiftName(data), value: getGiftUnitValue(data), image: getGiftImage(data), giftId: data.giftId });
    }
    if (messageHandler) messageHandler(data);
  };

  ws.onerror = () => {
    if (ws !== socket) return;
    tiktokState.status = '❌ صار خطأ بالاتصال';
    tiktokState.statusColor = '#e74c3c';
    tiktokState.failed = true;
    tiktokState.live = false;
  };

  // انقطع من جهة السيرفر/الشبكة: نخلي رسالة الخطأ لو كانت موجودة، والضغط الجاي يعيد الاتصال
  ws.onclose = () => {
    if (ws !== socket) return;
    socket = null;
    tiktokState.connectedUser = '';
    tiktokState.live = false;
    if (!tiktokState.failed) {
      tiktokState.status = '🔌 تم قطع الاتصال';
      tiktokState.statusColor = '#95a5a6';
    }
    tiktokState.failed = false;
  };
}
