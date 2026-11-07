<script setup>
import { ref, computed, onMounted } from 'vue';
import { adminPassword as password, rememberAdminPassword, forgetAdminPassword, hasRememberedAdminPassword } from '../utils/adminPassword';
import { loadArabicSpeller, isSpelledCorrectly } from '../utils/arabicSpell';

// قاموس "كوّن كلمة": الكلمات اللي انعتمدت بالجولات ومب بالقاموس الأساسي توصل هنا "بانتظار".
// المعتمدة تنضاف لقاموس اللعبة (تظهر خلال دقيقة)، والمرفوضة ما ترجع للانتظار لو انكتبت مرة ثانية.
const TABS = [
  { key: 'pending', label: '⏳ بانتظار المراجعة' },
  { key: 'approved', label: '✅ معتمدة' },
  { key: 'rejected', label: '🚫 مرفوضة' },
];

const words = ref(null);
const counts = ref({ pending: 0, approved: 0, rejected: 0 });
const tab = ref('pending');
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');
const search = ref('');
const selected = ref(new Set());

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
  loading.value = true;
  error.value = '';
  try {
    const data = await callApi('dictWords', { status: tab.value });
    words.value = data.words || [];
    counts.value = data.counts || counts.value;
    selected.value = new Set();
    rememberAdminPassword();
    loadSpeller();
  } catch (e) {
    error.value = e.message || 'تعذّر تسجيل الدخول';
    if (!words.value) forgetAdminPassword();
  } finally {
    loading.value = false;
  }
}

function switchTab(key) {
  if (tab.value === key) return;
  tab.value = key;
  message.value = '';
  load();
}

onMounted(() => {
  if (hasRememberedAdminPassword()) load();
});

const visible = computed(() => {
  const term = search.value.trim();
  return (words.value || []).filter((w) => !term || w.display.includes(term) || w.word.includes(term));
});
const allVisibleSelected = computed(() => visible.value.length > 0 && visible.value.every((w) => selected.value.has(w.word)));

function toggleSelect(word) {
  const next = new Set(selected.value);
  if (next.has(word)) next.delete(word);
  else next.add(word);
  selected.value = next;
}
function toggleSelectAll() {
  selected.value = allVisibleSelected.value ? new Set() : new Set(visible.value.map((w) => w.word));
}

const STATUS_MSG = { approved: 'انضافت للقاموس ✅', rejected: 'انرفضت 🚫', pending: 'رجعت للانتظار ⏳' };
async function setStatus(list, status) {
  if (list.length === 0) return;
  busy.value = true;
  try {
    await callApi('setDictWordStatus', { words: list, status });
    const moved = new Set(list);
    words.value = words.value.filter((w) => !moved.has(w.word));
    counts.value = { ...counts.value, [tab.value]: counts.value[tab.value] - list.length, [status]: counts.value[status] + list.length };
    selected.value = new Set();
    message.value = `${list.length} كلمة ${STATUS_MSG[status]}`;
  } catch (e) {
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function deleteWords(list) {
  if (list.length === 0) return;
  if (!window.confirm(`تحذف ${list.length} كلمة نهائياً؟ لو انكتبت مرة ثانية بترجع للانتظار.`)) return;
  busy.value = true;
  try {
    await callApi('deleteDictWords', { words: list });
    const gone = new Set(list);
    words.value = words.value.filter((w) => !gone.has(w.word));
    counts.value = { ...counts.value, [tab.value]: counts.value[tab.value] - list.length };
    selected.value = new Set();
    message.value = `انحذفت ${list.length} كلمة`;
  } catch (e) {
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}
const selectedList = computed(() => Array.from(selected.value));

// ===== الفحص الإملائي (قاموس Hunspell) =====
// الكلمة الصحيحة إملائياً يطلع عليها إطار ذهبي بكل التبويبات، وبالانتظار فيه زر يعتمدها كلها مرة وحدة
const speller = ref(null);
const spellState = ref('idle'); // idle | loading | ready | error
async function loadSpeller() {
  if (spellState.value === 'loading' || spellState.value === 'ready') return;
  spellState.value = 'loading';
  try {
    speller.value = await loadArabicSpeller();
    spellState.value = 'ready';
  } catch (e) {
    spellState.value = 'error';
  }
}
const spellCache = new Map();
function isSpellOk(w) {
  if (!speller.value) return false;
  if (!spellCache.has(w.display)) spellCache.set(w.display, isSpelledCorrectly(speller.value, w.display));
  return spellCache.get(w.display);
}
const spellOkVisible = computed(() => (speller.value ? visible.value.filter(isSpellOk) : []));
function approveSpellOk() {
  const list = spellOkVisible.value.map((w) => w.word);
  if (list.length === 0) return;
  if (!window.confirm(`تعتمد ${list.length} كلمة صحيحة إملائياً؟ (المؤطرة بالذهبي)`)) return;
  setStatus(list, 'approved');
}
</script>

<template>
  <div class="dict-page">
    <h1>📖 قاموس كوّن كلمة</h1>

    <div v-if="!words" class="login-panel">
      <input v-model="password" type="password" placeholder="الباسورد" @keyup.enter="load">
      <button class="master-btn" :disabled="loading" @click="load">
        {{ loading ? 'جاري الدخول...' : 'دخول' }}
      </button>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>

    <div v-else class="dashboard">
      <p class="hint-msg">
        الكلمات اللي انعتمدت بجولات "كوّن كلمة" ومب موجودة بالقاموس توصل هنا. اعتمدها عشان تنضاف للقاموس
        (تظهر باللعبة خلال دقيقة)، أو ارفضها عشان ما ترجع للانتظار.
      </p>

      <div class="toolbar">
        <button v-for="t in TABS" :key="t.key" class="tab-btn" :class="{ active: tab === t.key }" @click="switchTab(t.key)">
          {{ t.label }} ({{ counts[t.key] }})
        </button>
        <input v-model="search" type="text" placeholder="بحث..." class="filter-input">
      </div>

      <div class="toolbar bulk-bar">
        <label class="select-all">
          <input type="checkbox" :checked="allVisibleSelected" @change="toggleSelectAll">
          تحديد الكل ({{ selected.size }} / {{ visible.length }})
        </label>
        <template v-if="tab !== 'approved'">
          <button class="master-btn small-btn approve" :disabled="busy || !selected.size" @click="setStatus(selectedList, 'approved')">✅ اعتماد المحدد</button>
        </template>
        <template v-if="tab !== 'rejected'">
          <button class="master-btn small-btn reject" :disabled="busy || !selected.size" @click="setStatus(selectedList, 'rejected')">🚫 رفض المحدد</button>
        </template>
        <button class="master-btn small-btn delete" :disabled="busy || !selected.size" @click="deleteWords(selectedList)">🗑️ حذف</button>
      </div>
      <div class="toolbar spell-bar">
        <span>📖 <b>الفحص الإملائي</b> — الكلمة الصحيحة إملائياً (حسب قاموس Hunspell) يطلع عليها إطار ذهبي.</span>
        <span v-if="spellState === 'loading'" class="hint-msg">جاري تحميل القاموس الإملائي...</span>
        <span v-else-if="spellState === 'error'" class="hint-msg">
          تعذّر تحميل القاموس الإملائي <button class="icon-btn" @click="loadSpeller">🔄</button>
        </span>
        <button
          v-else-if="tab === 'pending'"
          class="master-btn small-btn spell-approve"
          :disabled="busy || !spellOkVisible.length"
          @click="approveSpellOk"
        >✨ اعتماد الصحيحة إملائياً ({{ spellOkVisible.length }})</button>
        <span v-else class="hint-msg">{{ spellOkVisible.length }} كلمة صحيحة إملائياً هنا</span>
      </div>
      <p v-if="message" class="action-msg">{{ message }}</p>
      <p v-if="loading" class="hint-msg">جاري التحميل...</p>

      <div class="word-grid">
        <div v-for="w in visible" :key="w.word" class="word-card" :class="{ selected: selected.has(w.word), 'spell-ok': isSpellOk(w) }" @click="toggleSelect(w.word)">
          <div class="word-text">{{ w.display }}</div>
          <div v-if="isSpellOk(w)" class="spell-badge">✨ صحيحة إملائياً</div>
          <div class="word-meta">انكتبت {{ w.times_seen }} {{ w.times_seen === 1 ? 'مرة' : 'مرات' }}</div>
          <div class="word-actions" @click.stop>
            <button v-if="tab !== 'approved'" class="icon-btn approve" title="اعتماد" :disabled="busy" @click="setStatus([w.word], 'approved')">✅</button>
            <button v-if="tab !== 'rejected'" class="icon-btn reject" title="رفض" :disabled="busy" @click="setStatus([w.word], 'rejected')">🚫</button>
            <button v-if="tab !== 'pending'" class="icon-btn" title="رجوع للانتظار" :disabled="busy" @click="setStatus([w.word], 'pending')">⏳</button>
          </div>
        </div>
      </div>
      <p v-if="!loading && !visible.length" class="hint-msg">ما فيه كلمات هنا</p>

      <router-link to="/admin" class="back-btn home-btn">⬅️ لوحة الأدمن</router-link>
    </div>
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.dict-page { width: 100%; max-width: 1000px; display: flex; flex-direction: column; align-items: center; }

.login-panel, .toolbar {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
}
.login-panel { padding: 30px; display: flex; flex-direction: column; gap: 15px; width: 100%; max-width: 340px; align-items: center; }
.login-panel input, .filter-input {
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 0.95rem;
  font-family: inherit;
}
.login-panel input { width: 100%; text-align: center; }
.filter-input { flex: 1; min-width: 160px; }

.error-msg { color: var(--danger-color); text-align: center; margin: 0; }
.hint-msg { color: #bdc3c7; font-size: 0.85rem; text-align: center; margin: 0; line-height: 1.6; }
.action-msg { color: var(--primary-color); text-align: center; margin: 0; }

.dashboard { width: 100%; display: flex; flex-direction: column; gap: 15px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 18px; }

.tab-btn {
  padding: 8px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
}
.tab-btn.active { background: var(--primary-color); color: #000; font-weight: bold; }

.select-all { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-inline-end: auto; }
.select-all input { width: auto; accent-color: var(--primary-color); }
.small-btn { padding: 8px 14px; font-size: 0.85rem; margin: 0; }
.small-btn.approve { background: #27ae60; }
.small-btn.reject { background: #8A1538; }
.small-btn.delete { background: #555c6b; }

.word-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.word-card {
  background: var(--panel-bg);
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 10px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}
.word-card.spell-ok { border-color: #f1c40f; box-shadow: 0 0 10px rgba(241, 196, 15, 0.35); }
.word-card.selected { border-color: var(--primary-color); background: rgba(243, 156, 18, 0.12); }
.word-card.spell-ok.selected { border-color: #f1c40f; outline: 2px solid var(--primary-color); outline-offset: 2px; }
.spell-badge { font-size: 0.7rem; color: #f1c40f; }
.spell-bar { font-size: 0.85rem; justify-content: space-between; }
.small-btn.spell-approve { background: #b7950b; }
.word-text { font-size: 1.3rem; font-weight: bold; word-break: break-word; text-align: center; }
.word-meta { font-size: 0.75rem; color: #bdc3c7; }
.word-actions { display: flex; gap: 6px; margin-top: 4px; }
.icon-btn {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.95rem;
}
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.back-btn { margin: 20px auto 0; }
</style>
