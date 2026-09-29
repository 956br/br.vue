<script setup>
import { ref, reactive, computed, onUnmounted } from 'vue';

// سجل الهدايا الفريدة اللي مرّت بأي بث متصل بالموقع (كل متصفح متصل يبلّغ عنها — راجع reportGift بـ utils/analytics.js).
// الأدمن يحط لكل هدية اسمها العربي وهل هي رئيسية ويعتمدها، والمعتمدة تطلع كقائمة جاهزة للنسخ.

const password = ref('');
const gifts = ref(null);
const loading = ref(false);
const error = ref('');
const message = ref('');
const search = ref('');
const view = ref('all');
// تعديلات الأدمن اللي لسا ما انحفظت، عشان التحديث التلقائي ما يمسح اللي يكتبه
const drafts = reactive({});
const rowStatus = reactive({});

const REFRESH_MS = 30 * 1000;
let refreshTimer = null;

async function callApi(action, extra = {}) {
  const res = await fetch('/api/admin-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password.value, action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'صار خطأ');
  return data;
}

async function load() {
  const data = await callApi('gifts');
  gifts.value = data.gifts || [];
}

async function login() {
  if (!password.value.trim()) return;
  loading.value = true;
  error.value = '';
  try {
    await load();
    refreshTimer = setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, REFRESH_MS);
  } catch (e) {
    error.value = e.message || 'تعذّر تسجيل الدخول';
    gifts.value = null;
  } finally {
    loading.value = false;
  }
}

async function refresh() {
  message.value = '';
  try {
    await load();
  } catch (e) {
    message.value = e.message;
  }
}

onUnmounted(() => clearInterval(refreshTimer));

function fieldsOf(g) {
  return drafts[g.gift_name] || { arabicName: g.arabic_name || '', isMain: g.is_main, approved: g.approved };
}

function editDraft(g, patch) {
  drafts[g.gift_name] = { ...fieldsOf(g), ...patch };
  rowStatus[g.gift_name] = 'dirty';
}

async function saveGift(g) {
  const d = drafts[g.gift_name];
  if (!d) return;
  rowStatus[g.gift_name] = 'saving';
  try {
    const { gift } = await callApi('updateGift', { giftName: g.gift_name, ...d });
    const idx = gifts.value.findIndex((x) => x.gift_name === g.gift_name);
    if (idx !== -1) gifts.value[idx] = gift;
    // لو الأدمن عدّل مرة ثانية أثناء الحفظ نخلي المسودة الجديدة
    if (drafts[g.gift_name] === d) delete drafts[g.gift_name];
    rowStatus[g.gift_name] = 'saved';
  } catch (e) {
    rowStatus[g.gift_name] = 'error';
    message.value = e.message;
  }
}

// كتابة اسم عربي لهدية جديدة = اعتمادها تلقائياً (يقدر الأدمن يشيل الصح بعدين)
function onArabicInput(g, value) {
  const current = fieldsOf(g);
  const autoApprove = !g.approved && !current.approved && value.trim() && !g.arabic_name;
  editDraft(g, { arabicName: value, ...(autoApprove ? { approved: true } : {}) });
}

function toggleField(g, key) {
  editDraft(g, { [key]: !fieldsOf(g)[key] });
  saveGift(g);
}

async function deleteGift(g) {
  if (!window.confirm(`تحذف "${g.gift_name}" من السجل؟ لو انرسلت ببث مرة ثانية بترجع تنضاف.`)) return;
  try {
    await callApi('deleteGift', { giftName: g.gift_name });
    gifts.value = gifts.value.filter((x) => x.gift_name !== g.gift_name);
    delete drafts[g.gift_name];
  } catch (e) {
    message.value = e.message;
  }
}

const counts = computed(() => {
  const list = gifts.value || [];
  return {
    all: list.length,
    new: list.filter((g) => !g.approved).length,
    approved: list.filter((g) => g.approved).length,
    main: list.filter((g) => g.approved && g.is_main).length,
  };
});

const visibleGifts = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (gifts.value || []).filter((g) => {
    if (view.value === 'new' && g.approved) return false;
    if (view.value === 'approved' && !g.approved) return false;
    if (view.value === 'main' && !(g.approved && g.is_main)) return false;
    if (!q) return true;
    return g.gift_name.toLowerCase().includes(q) || (g.arabic_name || '').includes(q);
  });
});

const TABS = [
  { key: 'all', label: 'الكل' },
  { key: 'new', label: '🆕 غير معتمدة' },
  { key: 'approved', label: '✅ المعتمدة' },
  { key: 'main', label: '⭐ الرئيسية' },
];

async function copyApprovedList() {
  const list = (gifts.value || [])
    .filter((g) => g.approved)
    .map((g) => ({
      value: g.gift_name,
      label: g.arabic_name || g.gift_name,
      diamonds: g.diamond_value,
      main: g.is_main,
    }));
  const text = `export const APPROVED_GIFTS = ${JSON.stringify(list, null, 2)};\n`;
  try {
    await navigator.clipboard.writeText(text);
    message.value = `تم نسخ ${list.length} هدية معتمدة ✅`;
  } catch {
    message.value = 'تعذّر النسخ — المتصفح منع الوصول للحافظة';
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_LABELS = { dirty: '✏️', saving: '⏳', saved: '✔️', error: '❌' };
</script>

<template>
  <div class="gifts-page">
    <h1>🎁 سجل الهدايا</h1>

    <div v-if="!gifts" class="login-panel">
      <input v-model="password" type="password" placeholder="الباسورد" @keyup.enter="login">
      <button class="master-btn" :disabled="loading" @click="login">
        {{ loading ? 'جاري الدخول...' : 'دخول' }}
      </button>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>

    <div v-else class="dashboard">
      <p class="hint-msg">
        كل هدية تنرسل بأي بث متصل بالموقع تنضاف هنا تلقائياً (تتحدث كل 30 ثانية).
        اكتب الاسم العربي وحدد إذا كانت رئيسية — الحفظ يصير لحاله.
      </p>

      <div class="toolbar">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab-btn"
          :class="{ active: view === t.key }"
          @click="view = t.key"
        >
          {{ t.label }} ({{ counts[t.key] }})
        </button>
        <input v-model="search" type="text" placeholder="بحث..." class="filter-input">
        <button class="rules-btn" @click="refresh">🔄 تحديث</button>
        <button class="rules-btn" @click="copyApprovedList">📋 نسخ القائمة المعتمدة</button>
      </div>
      <p v-if="message" class="action-msg">{{ message }}</p>

      <table class="admin-table">
        <thead>
          <tr>
            <th></th>
            <th>الاسم بتيك توك</th>
            <th>💎 القيمة</th>
            <th>الاسم بالعربي</th>
            <th>رئيسية</th>
            <th>معتمدة</th>
            <th>مرات الظهور</th>
            <th>آخر ظهور</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in visibleGifts" :key="g.gift_name" :class="{ 'row-new': !g.approved }">
            <td class="img-cell">
              <img v-if="g.image_url" :src="g.image_url" alt="" class="gift-img">
            </td>
            <td class="name-cell">{{ g.gift_name }}</td>
            <td>{{ g.diamond_value }}</td>
            <td>
              <input
                :value="fieldsOf(g).arabicName"
                type="text"
                class="ar-input"
                placeholder="—"
                @input="onArabicInput(g, $event.target.value)"
                @blur="saveGift(g)"
                @keyup.enter="$event.target.blur()"
              >
            </td>
            <td>
              <button class="check-btn" :class="{ on: fieldsOf(g).isMain }" @click="toggleField(g, 'isMain')">
                {{ fieldsOf(g).isMain ? '⭐' : '☆' }}
              </button>
            </td>
            <td>
              <button class="check-btn" :class="{ on: fieldsOf(g).approved }" @click="toggleField(g, 'approved')">
                {{ fieldsOf(g).approved ? '✅' : '⬜' }}
              </button>
            </td>
            <td>{{ g.times_seen }}</td>
            <td class="date-cell">{{ formatDate(g.last_seen) }}</td>
            <td class="actions-cell">
              <span class="row-status">{{ STATUS_LABELS[rowStatus[g.gift_name]] || '' }}</span>
              <button class="del-btn" title="حذف" @click="deleteGift(g)">🗑️</button>
            </td>
          </tr>
          <tr v-if="!visibleGifts.length">
            <td colspan="9">ما فيه هدايا هنا بعد</td>
          </tr>
        </tbody>
      </table>

      <router-link to="/admin" class="back-btn home-btn">⬅️ لوحة الأدمن</router-link>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.gifts-page {
  width: 100%;
  max-width: 1100px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-panel {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;
  max-width: 340px;
  align-items: center;
}

.login-panel input,
.filter-input,
.ar-input {
  padding: 10px 16px;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 0.95rem;
}

.login-panel input {
  width: 100%;
  text-align: center;
}

.filter-input {
  width: 100%;
  max-width: 200px;
}

.ar-input {
  width: 100%;
  min-width: 120px;
  text-align: center;
  border-radius: 10px;
  padding: 8px 10px;
}

.error-msg {
  color: var(--danger-color);
  text-align: center;
}

.hint-msg {
  color: #bdc3c7;
  font-size: 0.85rem;
  text-align: center;
  margin: 0;
}

.action-msg {
  color: var(--primary-color);
  text-align: center;
  margin: 0;
}

.dashboard {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 15px 20px;
}

.toolbar .rules-btn {
  padding: 10px 18px;
  font-size: 0.9rem;
}

.tab-btn {
  padding: 8px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
}

.tab-btn.active {
  background: var(--primary-color);
  color: #000;
  font-weight: bold;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel-bg);
  border-radius: 12px;
  overflow: hidden;
}

.admin-table th,
.admin-table td {
  padding: 10px 12px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.admin-table th {
  background: rgba(0, 0, 0, 0.3);
  color: var(--primary-color);
  white-space: nowrap;
}

.row-new {
  background: rgba(241, 196, 15, 0.06);
}

.gift-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.name-cell {
  direction: ltr;
  font-weight: bold;
}

.date-cell {
  font-size: 0.8rem;
  color: #bdc3c7;
  white-space: nowrap;
}

.check-btn,
.del-btn {
  background: transparent;
  border: none;
  font-size: 1.3rem;
  cursor: pointer;
  color: #7f8c8d;
}

.check-btn.on {
  color: #f1c40f;
}

.del-btn {
  font-size: 1rem;
  opacity: 0.6;
}

.del-btn:hover {
  opacity: 1;
}

.actions-cell {
  white-space: nowrap;
}

.row-status {
  display: inline-block;
  width: 1.4em;
}

.back-btn {
  margin: 20px auto 0;
}

@media (max-width: 700px) {
  .admin-table { display: block; overflow-x: auto; }
}
</style>
