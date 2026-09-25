<script setup>
// صفحة اللاعب بالشات روم الداخلي: يكتب اسمه، يدخل الغرفة، ويكتب بالشات (كلمة الانضمام، التوقعات...)
import {
  ref, computed, onUnmounted, nextTick,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { joinRoomAsPlayer } from '../utils/chatRoomManager';

const NAME_KEY = 'chat_room_name';
const CLIENT_KEY = 'chat_room_client';

const route = useRoute();
const router = useRouter();
const code = computed(() => String(route.params.code || '').trim().toUpperCase());
const codeInput = ref('');

function goToCode() {
  const c = codeInput.value.trim().toUpperCase();
  if (c) router.push(`/room/${c}`);
}

function safeGet(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function safeSet(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }

const nameInput = ref(safeGet(NAME_KEY));
const joinedName = ref('');
const status = ref('');
const statusColor = ref('');
const hostOnline = ref(false);
const messages = ref([]);
const draft = ref('');
const listEl = ref(null);
let conn = null;

function getClientId(name) {
  // نفس الاسم على نفس الجهاز = نفس اللاعب؛ تغيير الاسم يعتبر لاعب جديد
  let saved = null;
  try { saved = JSON.parse(safeGet(CLIENT_KEY) || 'null'); } catch { saved = null; }
  if (saved && saved.name === name && saved.id) return saved.id;
  const id = crypto.randomUUID();
  safeSet(CLIENT_KEY, JSON.stringify({ name, id }));
  return id;
}

const joining = ref(false);
const roomClosed = ref(false);

async function enter() {
  const name = nameInput.value.trim().slice(0, 24);
  if (!name || joining.value) return;
  safeSet(NAME_KEY, name);
  joining.value = true;
  const result = await joinRoomAsPlayer(code.value, {
    clientId: getClientId(name),
    name,
    onEvent: (m) => {
      if (!m || !m.text || messages.value.some((x) => x.id === m.id)) return;
      messages.value.push(m);
      if (messages.value.length > 150) messages.value.splice(0, messages.value.length - 150);
      nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; });
    },
    onStatus: (s, c) => { status.value = s; statusColor.value = c; },
    onHostOnline: (v) => { hostOnline.value = v; },
    onClosed: () => { roomClosed.value = true; },
  });
  joining.value = false;
  if (!result) return;
  conn = result;
  // الاسم المعتمد من السيرفر (ممكن ينضاف له رقم لو الاسم مأخوذ)
  joinedName.value = result.name;
}

function changeName() {
  conn?.leave();
  conn = null;
  joinedName.value = '';
  messages.value = [];
  hostOnline.value = false;
  status.value = '';
}

function send() {
  conn?.send(draft.value);
  draft.value = '';
}

onUnmounted(() => conn?.leave());
</script>

<template>
  <div class="room-page">
    <h1>💬 الشات روم</h1>
    <div class="subtitle">منصة تحديات 956BR<template v-if="code"> — غرفة <b>{{ code }}</b></template></div>

    <form v-if="!code" class="room-card" @submit.prevent="goToCode">
      <label>اكتب كود الغرفة اللي عطاك إياه المضيف</label>
      <input v-model="codeInput" maxlength="12" placeholder="مثلاً K7QX2" class="room-input code-input" autofocus>
      <button type="submit" class="master-btn" :disabled="!codeInput.trim()">متابعة ➜</button>
    </form>

    <form v-else-if="!joinedName" class="room-card" @submit.prevent="enter">
      <label>اكتب اسمك عشان تدخل الغرفة</label>
      <input v-model="nameInput" maxlength="24" placeholder="اسمك" class="room-input" autofocus>
      <button type="submit" class="master-btn" :disabled="!nameInput.trim() || joining">دخول 🚪</button>
      <p v-if="status" :style="{ color: statusColor }">{{ status }}</p>
    </form>

    <div v-else class="room-card chat">
      <div class="room-top">
        <span>👤 {{ joinedName }}</span>
        <span :style="{ color: statusColor }">{{ status }}</span>
        <span :class="hostOnline ? 'host-on' : 'host-off'">{{ hostOnline ? '🎙️ المضيف موجود' : '⏸️ المضيف غير متصل' }}</span>
        <button type="button" class="link-btn" @click="changeName">تغيير الاسم</button>
      </div>
      <div ref="listEl" class="room-messages">
        <div v-if="!messages.length" class="room-empty">اكتب بالشات حسب تعليمات المضيف (مثلاً كلمة الانضمام)</div>
        <div v-for="m in messages" :key="m.id" class="room-msg" :class="{ host: m.host, mine: !m.host && m.user === joinedName }">
          <b>{{ m.user }}:</b> {{ m.text }}
        </div>
      </div>
      <p v-if="roomClosed" class="host-off">🔒 المضيف سكّر هذي الغرفة</p>
      <form v-else class="room-send" @submit.prevent="send">
        <input v-model="draft" maxlength="200" placeholder="اكتب رسالتك..." class="room-input" enterkeyhint="send">
        <button type="submit" class="master-btn">إرسال ➤</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.room-page {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  direction: rtl;
  text-align: center;
}
.room-card {
  width: 100%;
  background: var(--panel-bg);
  border: 1px solid var(--border-glow);
  border-radius: 16px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.room-input {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 1rem;
}
.code-input { direction: ltr; text-align: center; letter-spacing: 4px; text-transform: uppercase; }
.room-top {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
}
.host-on { color: #2ecc71; }
.host-off { color: #95a5a6; }
.link-btn {
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  text-decoration: underline;
}
.room-messages {
  height: min(60vh, 480px);
  overflow-y: auto;
  padding: 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.room-msg { word-break: break-word; }
.room-msg b { color: var(--primary-color); }
.room-msg.mine b { color: #2ecc71; }
.room-msg.host b { color: #3498db; }
.room-empty { color: #95a5a6; margin: auto; text-align: center; }
.room-send { display: flex; gap: 8px; }
</style>
