<script setup>
// لوحة الشات روم للمضيف: كود الغرفة ورابطها، الرسائل الواصلة، وخانة يرسل منها المضيف للاعبين
import { ref, computed, watch, nextTick } from 'vue';
import QRCode from 'qrcode';
import {
  roomState, roomLink, openRoom, sendHostMessage, rejoinOnlinePlayers,
} from '../utils/chatRoomManager';

const expanded = ref(true);
const draft = ref('');
const copied = ref(false);
const listEl = ref(null);

const link = computed(() => (roomState.code ? roomLink(roomState.code) : ''));

// QR للرابط يتولّد داخل المتصفح (بدون أي خدمة خارجية)، اللاعب يمسحه بكاميرا الجوال ويفتح الغرفة
const qrVisible = ref(false);
const qrDataUrl = ref('');
const isLocalhost = computed(() => ['localhost', '127.0.0.1'].includes(window.location.hostname));

watch(link, async (url) => {
  qrDataUrl.value = url
    ? await QRCode.toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: 'M' }).catch(() => '')
    : '';
}, { immediate: true });

function copyLink() {
  if (!link.value) return;
  navigator.clipboard?.writeText(link.value).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  }).catch(() => {});
}

function newRoom() {
  if (!confirm('تسكير الغرفة الحالية وفتح غرفة جديدة بكود جديد؟ اللاعبين لازم يدخلون من الرابط الجديد.')) return;
  openRoom({ newRoom: true });
}

function send() {
  sendHostMessage(draft.value);
  draft.value = '';
}

watch(() => roomState.messages.length, () => {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight; });
});
</script>

<template>
  <div class="chat-room-panel" :class="{ collapsed: !expanded }">
    <div class="crp-header" @click="expanded = !expanded">
      <span>💬 الشات روم <b v-if="roomState.code">{{ roomState.code }}</b></span>
      <span class="crp-online">👥 {{ roomState.onlineCount }}</span>
      <span>{{ expanded ? '➖' : '➕' }}</span>
    </div>
    <template v-if="expanded">
      <p class="crp-status" :style="{ color: roomState.statusColor }">{{ roomState.status }}</p>
      <button v-if="!roomState.code" class="crp-btn crp-open" :disabled="roomState.busy" @click="openRoom()">فتح غرفة 💬</button>
      <div v-if="link" class="crp-link-row">
        <input :value="link" readonly class="crp-link" @focus="$event.target.select()">
        <button class="crp-btn" @click="copyLink">{{ copied ? '✅' : '📋' }}</button>
        <button class="crp-btn" title="عرض QR" :disabled="!qrDataUrl" @click="qrVisible = true">📱</button>
        <button class="crp-btn" title="غرفة جديدة" :disabled="roomState.busy" @click="newRoom">🔄</button>
      </div>
      <button
        v-if="roomState.code && roomState.canJoinPlayers"
        class="crp-btn crp-open"
        title="يدخل كل الموجودين بالغرفة للعبة (مفيد بعد لعبة جديدة، أو لو أحد دخل وقت جولة شغالة)"
        @click="rejoinOnlinePlayers"
      >➕ إدخال المتصلين للعبة ({{ roomState.onlineCount }})</button>
      <div ref="listEl" class="crp-messages">
        <div v-if="!roomState.messages.length" class="crp-empty">ما فيه رسائل للحين — شارك الرابط مع اللاعبين</div>
        <div v-for="m in roomState.messages" :key="m.id" class="crp-msg" :class="{ host: m.host }">
          <b>{{ m.user }}:</b> {{ m.text }}
        </div>
      </div>
      <form class="crp-send" @submit.prevent="send">
        <input v-model="draft" maxlength="200" placeholder="رسالة للاعبين..." class="crp-input">
        <button class="crp-btn" type="submit">➤</button>
      </form>
    </template>
  </div>

  <div v-if="qrVisible && qrDataUrl" class="crp-qr-overlay" @click.self="qrVisible = false">
    <div class="crp-qr-card">
      <h3>📱 امسح الكود بكاميرا جوالك للدخول</h3>
      <img :src="qrDataUrl" alt="QR" class="crp-qr-img">
      <div class="crp-qr-code">{{ roomState.code }}</div>
      <div class="crp-qr-link">{{ link }}</div>
      <p v-if="isLocalhost" class="crp-qr-warn">⚠️ الرابط على localhost ما يفتح من الجوال — جرّب الـ QR بعد الرفع على الموقع</p>
      <button class="crp-btn crp-qr-close" @click="qrVisible = false">إغلاق</button>
    </div>
  </div>
</template>

<style scoped>
.chat-room-panel {
  position: fixed;
  top: 90px;
  left: 16px;
  z-index: 997;
  width: 300px;
  max-width: calc(100vw - 32px);
  background: rgba(15, 17, 26, 0.92);
  border: 1px solid var(--border-glow);
  border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  direction: rtl;
}
.crp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  color: var(--primary-color);
  font-weight: bold;
  user-select: none;
}
.crp-online { color: #ccd6e0; font-size: 0.85rem; }
.crp-status { padding: 0 12px 6px; font-size: 0.85rem; }
.crp-link-row, .crp-send { display: flex; gap: 6px; padding: 0 12px 8px; }
.crp-link, .crp-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 0.85rem;
}
.crp-link { direction: ltr; }
.crp-btn {
  padding: 6px 10px;
  border-radius: 8px;
  border: none;
  background: var(--success-color);
  color: #fff;
  cursor: pointer;
}
.crp-messages {
  height: 260px;
  overflow-y: auto;
  margin: 0 12px 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.crp-open { margin: 0 12px 8px; padding: 8px; }
.crp-qr-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.crp-qr-card {
  background: #1a1e2f;
  border: 1px solid var(--border-glow);
  border-radius: 18px;
  padding: 22px;
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  direction: rtl;
}
.crp-qr-card h3 { color: var(--primary-color); }
.crp-qr-img {
  width: 100%;
  max-width: 340px;
  aspect-ratio: 1;
  background: #fff;
  border-radius: 12px;
  image-rendering: pixelated;
}
.crp-qr-code { font-size: 2rem; font-weight: bold; letter-spacing: 6px; color: #fff; direction: ltr; }
.crp-qr-link { font-size: 0.85rem; color: #bdc3c7; direction: ltr; word-break: break-all; }
.crp-qr-warn { font-size: 0.85rem; color: #e67e22; }
.crp-qr-close { padding: 10px 28px; font-size: 1rem; }
.crp-msg { word-break: break-word; }
.crp-msg b { color: var(--primary-color); }
.crp-msg.host b { color: #3498db; }
.crp-empty { color: #95a5a6; text-align: center; margin: auto; font-size: 0.85rem; }
</style>
