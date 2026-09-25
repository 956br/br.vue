// مصدر رسائل الألعاب: نفس واجهة tiktokConnectionManager، لكن يختار المصدر حسب الرابط.
// الروابط العادية (/wheel) = تيك توك، والنسخ السرية (/wheel2) اللي عليها meta.chatRoom = الشات روم الداخلي.
// كذا كل لعبة ملف واحد يشتغل بالوضعين، بدل نسخة مكررة لكل لعبة.

import router from '../router';
import * as tiktok from './tiktokConnectionManager';

export const { tiktokState } = tiktok;

// الشات روم (ومكتبة Supabase) يتحمّل بس لما نحتاجه، عشان الألعاب العادية تبقى خفيفة مثل قبل
let chatRoom = null;
function loadChatRoom() {
  return import('./chatRoomManager').then((m) => { chatRoom = m; return m; });
}

export function isChatMode() {
  return !!router.currentRoute.value.meta.chatRoom;
}

// آخر معالج طلبته اللعبة بوضع الشات؛ لو اللعبة طلعت قبل ما يخلص التحميل ما نربطه
let pendingChatHandler = null;
function openChatRoom(fn) {
  pendingChatHandler = fn;
  loadChatRoom().then((m) => {
    if (pendingChatHandler === fn) m.openRoom({ onMessage: fn });
  });
}

export function setMessageHandler(fn) {
  if (isChatMode()) {
    // نفصل تيك توك عن اللعبة عشان رسائل بث قديم مفتوح ما تختلط برسائل الغرفة
    tiktok.clearMessageHandler();
    openChatRoom(fn);
  } else {
    chatRoom?.clearMessageHandler();
    tiktok.setMessageHandler(fn);
  }
}

// بوضع الشات روم فقط: fn(name) تنادى لكل لاعب داخل الغرفة (الموجودين الحين، واللي يدخلون بعدين)
// عشان دخول الغرفة يكون هو الانضمام للعبة. بوضع تيك توك ما تسوي شي.
let pendingJoinHandler = null;
export function setJoinHandler(fn) {
  if (!isChatMode()) return;
  pendingJoinHandler = fn;
  loadChatRoom().then((m) => {
    if (pendingJoinHandler === fn) m.setJoinHandler(fn);
  });
}

export function clearMessageHandler() {
  pendingChatHandler = null;
  pendingJoinHandler = null;
  tiktok.clearMessageHandler();
  chatRoom?.clearMessageHandler();
  chatRoom?.clearJoinHandler();
}

export function connect(username, options = {}) {
  if (isChatMode()) openChatRoom(options.onMessage);
  else tiktok.connect(username, options);
}

export function getUserAvatar(username) {
  // الشات الداخلي ما فيه صور
  return isChatMode() ? '' : tiktok.getUserAvatar(username);
}
