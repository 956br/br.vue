// بديل داخلي لاتصال تيك توك: شات روم خاص بالمنصة.
// السيرفر (api/chat-room.js) هو اللي ينشئ الغرف ويولّد أكوادها، ويستقبل كل رسالة ويتحقق منها ويحفظها،
// ثم يبثها على قناة Supabase Realtime خاصة chatroom:<CODE> — المتصفحات هنا بس تسمع عليها.
// الرسائل توصل للعبة بنفس شكل رسائل جسر تيك توك { user, comment, avatar } عشان منطق اللعبة ما يتغير.

import { reactive } from 'vue';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const HOST_ROOM_KEY = 'chat_room_host';
const MAX_MESSAGES = 150;

let supabase = null;
function getClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

async function api(action, payload = {}) {
  const res = await fetch('/api/chat-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'خطأ'), { status: res.status });
  return data;
}

function safeGet(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function safeSet(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }

export function roomLink(code) {
  return `${window.location.origin}/room/${code}`;
}

// يشترك بقناة الغرفة (خاصة، استقبال فقط) ويسجل الحضور تحت presenceKey.
// presenceKey يشوفه كل اللي بالغرفة، فلازم ما يكون clientId (هذا سر اللاعب اللي يرسل فيه رسائله).
function subscribeRoom(code, presenceKey, {
  onMsg, onJoin, onClosed, onPresence, onStatus, presence = {},
}) {
  const client = getClient();
  if (!client) { onStatus('⚠️ إعدادات Supabase ناقصة', '#e74c3c'); return null; }
  const channel = client.channel(`chatroom:${code}`, {
    config: { private: true, presence: { key: presenceKey } },
  });
  channel.on('broadcast', { event: 'msg' }, ({ payload }) => payload && onMsg(payload));
  channel.on('broadcast', { event: 'join' }, ({ payload }) => payload?.user && onJoin?.(payload.user));
  channel.on('broadcast', { event: 'closed' }, () => onClosed?.());
  channel.on('presence', { event: 'sync' }, () => onPresence?.(channel.presenceState()));
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      onStatus(null);
      await channel.track({ ...presence, at: Date.now() });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onStatus('❌ صار خطأ بالاتصال', '#e74c3c');
    } else if (status === 'CLOSED') {
      onStatus('🔌 انقطع الاتصال', '#95a5a6');
    }
  });
  return channel;
}

function pushUnique(list, msg) {
  if (list.some((m) => m.id === msg.id)) return false;
  list.push(msg);
  if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
  return true;
}

// ===== جهة المضيف (صفحة اللعبة) =====

export const roomState = reactive({
  code: '',
  status: '',
  statusColor: '',
  messages: [],
  onlineCount: 0,
  busy: false,
  canJoinPlayers: false, // اللعبة الحالية تدعم إدخال لاعبي الغرفة (فيه joinHandler)
});

let hostToken = '';
let hostChannel = null;
let messageHandler = null;

export function setMessageHandler(fn) { messageHandler = fn; }
export function clearMessageHandler() { messageHandler = null; }
// الشات الداخلي ما فيه صور، نخليها متوافقة مع واجهة tiktokConnectionManager
export function getUserAvatar() { return ''; }

function setStatus(s, c) { roomState.status = s; roomState.statusColor = c; }

// ===== دخول الغرفة = انضمام للعبة =====
// participants: أسماء معتمدة من السيرفر (من دخل الغرفة فعلاً)، onlineNames: الموجودين الحين (من presence).
// نضيف للعبة بس اللي بالقائمتين، عشان أحد ما يقدر يزوّر اسم عن طريق presence.
const participants = new Set();
let onlineNames = new Set();
let joinHandler = null;
const handedToGame = new Set(); // أسماء انرسلت للعبة الحالية، عشان ما نعيد إضافة لاعب شاله المضيف

function handToGame(name) {
  if (!joinHandler || handedToGame.has(name)) return;
  handedToGame.add(name);
  joinHandler(name);
}

function joinOnlineParticipants() {
  participants.forEach((name) => { if (onlineNames.has(name)) handToGame(name); });
}

export function setJoinHandler(fn) {
  joinHandler = fn;
  handedToGame.clear();
  roomState.canJoinPlayers = true;
  joinOnlineParticipants();
}

export function clearJoinHandler() {
  joinHandler = null;
  handedToGame.clear();
  roomState.canJoinPlayers = false;
}

// زر "إدخال المتصلين": بعد "لعبة جديدة" مثلاً، يرجّع كل الموجودين بالغرفة للعبة
export function rejoinOnlinePlayers() {
  handedToGame.clear();
  joinOnlineParticipants();
}

function attachHost(code, messages, knownParticipants = []) {
  if (hostChannel) { getClient()?.removeChannel(hostChannel); hostChannel = null; }
  roomState.code = code;
  roomState.messages = messages;
  roomState.onlineCount = 0;
  participants.clear();
  knownParticipants.forEach((n) => participants.add(n));
  onlineNames = new Set();
  handedToGame.clear();
  hostChannel = subscribeRoom(code, 'host', {
    onMsg: (msg) => {
      if (!pushUnique(roomState.messages, msg)) return;
      // رسائل المضيف نفسه ما تنحسب كتعليقات باللعبة
      if (!msg.host && messageHandler) messageHandler({ user: msg.user, comment: msg.text, avatar: '' });
    },
    // يوصل من السيرفر لما لاعب يدخل الغرفة (موثوق) — اللاعب متصل أكيد، فنضيفه للعبة فوراً
    onJoin: (name) => {
      participants.add(name);
      onlineNames.add(name);
      handToGame(name);
    },
    onPresence: (st) => {
      const names = new Set();
      Object.entries(st).forEach(([key, metas]) => {
        if (key === 'host') return;
        metas.forEach((m) => { if (m.name) names.add(m.name); });
      });
      onlineNames = names;
      roomState.onlineCount = names.size;
      joinOnlineParticipants();
    },
    onStatus: (s, c) => (s ? setStatus(s, c) : setStatus(`🟢 الغرفة ${code} مفتوحة`, '#2ecc71')),
  });
}

// يفتح الغرفة المحفوظة (لو لسا شغالة بالسيرفر) وإلا يطلب من السيرفر غرفة جديدة
export async function openRoom({ onMessage, newRoom = false } = {}) {
  if (onMessage) messageHandler = onMessage;
  if (roomState.busy) return;
  if (hostChannel && !newRoom) return;
  roomState.busy = true;
  try {
    if (!newRoom) {
      let saved = null;
      try { saved = JSON.parse(safeGet(HOST_ROOM_KEY) || 'null'); } catch { saved = null; }
      if (saved?.code && saved?.hostToken) {
        setStatus(`⏳ جاري استرجاع الغرفة ${saved.code} ...`, '#f1c40f');
        try {
          const { messages, participants: known = [] } = await api('resume', saved);
          hostToken = saved.hostToken;
          attachHost(saved.code, messages, known);
          return;
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
    } else if (roomState.code && hostToken) {
      await api('close', { code: roomState.code, hostToken }).catch(() => {});
    }

    setStatus('⏳ جاري إنشاء غرفة ...', '#f1c40f');
    const created = await api('create');
    hostToken = created.hostToken;
    safeSet(HOST_ROOM_KEY, JSON.stringify(created));
    attachHost(created.code, []);
  } catch (e) {
    setStatus(`❌ ${e.message || 'تعذّر فتح الغرفة'}`, '#e74c3c');
  } finally {
    roomState.busy = false;
  }
}

// رسالة من المضيف تنعرض لكل اللاعبين (ما تنحسب كتعليق باللعبة)
export async function sendHostMessage(text) {
  const t = String(text || '').trim();
  if (!t || !roomState.code || !hostToken) return;
  try {
    const { message } = await api('host-send', { code: roomState.code, hostToken, text: t });
    pushUnique(roomState.messages, message);
  } catch (e) {
    setStatus(`❌ ${e.message}`, '#e74c3c');
  }
}

// ===== جهة اللاعب (صفحة /room/:code) =====

// يدخل اللاعب الغرفة عن طريق السيرفر (يتأكد إن الكود موجود ويعتمد اسمه)، ثم يسمع على القناة
export async function joinRoomAsPlayer(code, {
  clientId, name, onEvent, onStatus, onHostOnline, onClosed,
}) {
  onStatus('⏳ جاري الدخول للغرفة ...', '#f1c40f');
  let joined;
  try {
    joined = await api('join', { code, clientId, name });
  } catch (e) {
    onStatus(`❌ ${e.message}`, '#e74c3c');
    return null;
  }
  joined.messages.forEach(onEvent);

  const channel = subscribeRoom(code, `p-${crypto.randomUUID()}`, {
    presence: { name: joined.name },
    onMsg: onEvent,
    onClosed,
    onPresence: (st) => onHostOnline?.(!!st.host),
    onStatus: (s, c) => (s ? onStatus(s, c) : onStatus('🟢 متصل', '#2ecc71')),
  });

  return {
    name: joined.name,
    async send(text) {
      const t = String(text || '').trim();
      if (!t) return;
      try {
        const { message } = await api('send', { code, clientId, text: t });
        onEvent(message);
      } catch (e) {
        onStatus(`⚠️ ${e.message}`, '#e67e22');
      }
    },
    leave() { if (channel) getClient()?.removeChannel(channel); },
  };
}
