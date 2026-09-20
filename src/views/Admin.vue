<script setup>
import { ref, computed } from 'vue';
import * as XLSX from 'xlsx';
import UserDetailModal from '../components/UserDetailModal.vue';

const password = ref('');
const stats = ref(null);
const loading = ref(false);
const error = ref('');
const actionBusy = ref(false);
const actionMessage = ref('');
const usernameFilter = ref('');
const selectedUser = ref(null);

const filteredUsernames = computed(() => {
  const q = usernameFilter.value.trim().toLowerCase();
  const list = stats.value?.topUsernames || [];
  if (!q) return list;
  return list.filter((u) => u.username.toLowerCase().includes(q));
});

const DATE_KEYS = new Set(['firstSeen', 'lastSeen', 'lastRequestAt']);

function toggleSort(sortRef, key) {
  if (sortRef.value.key === key) {
    sortRef.value = { key, dir: sortRef.value.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    sortRef.value = { key, dir: 'asc' };
  }
}

function sortArrow(sortRef, key) {
  if (sortRef.key !== key) return '';
  return sortRef.dir === 'asc' ? '▲' : '▼';
}

function sortRows(rows, { key, dir }) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (DATE_KEYS.has(key)) {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    }
    if (typeof av === 'string' && typeof bv === 'string') return mul * av.localeCompare(bv, 'ar');
    return mul * ((av ?? 0) - (bv ?? 0));
  });
}

const gamesSort = ref({ key: 'total', dir: 'desc' });
const usersSort = ref({ key: 'total', dir: 'desc' });
const sessionsSort = ref({ key: 'firstSeen', dir: 'desc' });

// دوال مخصصة لكل جدول (بدل تمرير الـ ref نفسه من داخل القالب) عشان نضمن إن toggleSort
// يعدّل الـ ref الفعلي — تمرير gamesSort.value داخل تعبير بالقالب يرجع القيمة العادية بعد فك التغليف التلقائي.
function toggleGamesSort(key) {
  toggleSort(gamesSort, key);
}
function toggleUsersSort(key) {
  toggleSort(usersSort, key);
}
function toggleSessionsSort(key) {
  toggleSort(sessionsSort, key);
}

const sortedGames = computed(() => sortRows(stats.value?.gamesStats || [], gamesSort.value));
const sortedUsers = computed(() => sortRows(filteredUsernames.value, usersSort.value));

const SESSIONS_DISPLAY_LIMIT = 200;
const visibleSessions = computed(() => sortRows(stats.value?.sessionsList || [], sessionsSort.value).slice(0, SESSIONS_DISPLAY_LIMIT));

async function callAdminApi(action) {
  const res = await fetch('/api/admin-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password.value, action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'صار خطأ');
  }
  return res.json();
}

async function login() {
  if (!password.value.trim()) return;
  loading.value = true;
  error.value = '';
  try {
    stats.value = await callAdminApi('stats');
  } catch (e) {
    error.value = e.message || 'تعذّر تسجيل الدخول';
    stats.value = null;
  } finally {
    loading.value = false;
  }
}

async function refreshStats() {
  actionBusy.value = true;
  actionMessage.value = '';
  try {
    stats.value = await callAdminApi('stats');
  } catch (e) {
    actionMessage.value = e.message || 'تعذّر تحديث الإحصائيات';
  } finally {
    actionBusy.value = false;
  }
}

async function exportExcel() {
  actionBusy.value = true;
  actionMessage.value = '';
  try {
    const raw = await callAdminApi('export');
    const wb = XLSX.utils.book_new();

    const summaryRows = [
      ['عدد الزوار', stats.value.totalVisitors],
      ['متوسط مدة البقاء (ثانية)', stats.value.avgSessionSeconds],
      ['وسيط مدة البقاء (ثانية)', stats.value.medianSessionSeconds],
      ['جلسات مستبعدة (شاذة)', stats.value.excludedOutlierSessions],
      ['زيارات اليوم', stats.value.sessionsToday],
      ['إجمالي مرات التصفح', stats.value.totalPageViews],
      ['متوسط عدد الألعاب لكل زائر', stats.value.avgGamesPerSession],
      ['إجمالي طلبات الاتصال', stats.value.totalConnectRequests],
      ['يوزر نيمات فريدة', stats.value.uniqueUsernames],
      ['تاريخ التصدير', new Date().toLocaleString('ar-SA-u-ca-gregory')],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'ملخص');

    const gamesRows = [
      ['اللعبة', 'إجمالي الزيارات', 'آخر 30 يوم'],
      ...stats.value.gamesStats.map((g) => [g.title, g.total, g.last30d]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gamesRows), 'الألعاب');

    const usersRows = [
      ['يوزر نيم', 'إجمالي الطلبات', 'آخر 30 يوم', 'آخر 24 ساعة', 'آخر ساعة', 'وقت آخر طلب', 'الوقت المقدّر (دقيقة)', 'الألعاب المستخدمة'],
      ...(stats.value.allUsernames || []).map((u) => [
        u.username,
        u.total,
        u.last30d,
        u.last24h,
        u.last1h,
        formatDate(u.lastRequestAt),
        Math.round(u.totalSeconds / 60),
        u.games.map((g) => g.title).join('، '),
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(usersRows), 'المستخدمين');

    const sessionsRows = [
      ['وقت البداية', 'وقت آخر نشاط', 'المدة (ثانية)', 'شاذة؟'],
      ...(stats.value.sessionsList || []).map((s) => [
        formatDate(s.firstSeen),
        formatDate(s.lastSeen),
        s.durationSeconds,
        s.isOutlier ? 'نعم' : 'لا',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sessionsRows), 'الجلسات');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw.page_visits || []), 'زيارات خام');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw.connect_requests || []), 'طلبات اتصال خام');

    XLSX.writeFile(wb, `analytics-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    actionMessage.value = e.message || 'تعذّر تصدير البيانات';
  } finally {
    actionBusy.value = false;
  }
}

async function resetData() {
  const confirmed = window.confirm('متأكد تبي تصفّر كل بيانات الزيارات وطلبات الاتصال والجلسات؟ هذا الإجراء ما يُرجع.');
  if (!confirmed) return;
  actionBusy.value = true;
  actionMessage.value = '';
  try {
    await callAdminApi('reset');
    await refreshStats();
    actionMessage.value = 'تم تصفير الإحصائيات.';
  } catch (e) {
    actionMessage.value = e.message || 'تعذّر تصفير البيانات';
  } finally {
    actionBusy.value = false;
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} د ${s} ث`;
}

function formatDate(iso, fallback = '—') {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
}
</script>

<template>
  <div class="admin-page">
    <h1>لوحة تحكم الأدمن</h1>

    <div v-if="!stats" class="login-panel">
      <input
        v-model="password"
        type="password"
        placeholder="الباسورد"
        @keyup.enter="login"
      >
      <button class="master-btn" :disabled="loading" @click="login">
        {{ loading ? 'جاري الدخول...' : 'دخول' }}
      </button>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>

    <div v-else class="dashboard">
      <div class="toolbar">
        <button class="rules-btn" :disabled="actionBusy" @click="refreshStats">🔄 تحديث البيانات</button>
        <button class="rules-btn" :disabled="actionBusy" @click="exportExcel">📊 تصدير Excel</button>
        <button class="reset-btn" :disabled="actionBusy" @click="resetData">🗑️ إعادة ضبط الإحصائيات</button>
        <span class="reset-date">آخر إعادة ضبط: {{ formatDate(stats.lastResetAt, 'ما صار تصفير بعد') }}</span>
      </div>
      <p v-if="actionMessage" class="action-msg">{{ actionMessage }}</p>

      <div class="cards-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalVisitors }}</div>
          <div class="stat-label">عدد الزوار</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatDuration(stats.avgSessionSeconds) }}</div>
          <div class="stat-label">متوسط مدة البقاء</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalConnectRequests }}</div>
          <div class="stat-label">إجمالي طلبات الاتصال (المشاركات)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.uniqueUsernames }}</div>
          <div class="stat-label">يوزر نيمات فريدة (المشاركين دون تكرار)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatDuration(stats.medianSessionSeconds) }}</div>
          <div class="stat-label">وسيط مدة البقاء</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.sessionsToday }}</div>
          <div class="stat-label">زيارات اليوم</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.totalPageViews }}</div>
          <div class="stat-label">إجمالي مرات التصفح</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.avgGamesPerSession }}</div>
          <div class="stat-label">متوسط عدد الألعاب لكل زائر</div>
        </div>
      </div>
      <p v-if="stats.excludedOutlierSessions" class="hint-msg">
        ({{ stats.excludedOutlierSessions }}) جلسة قديمة استُبعدت من حساب المتوسط/الوسيط لأنها بيانات من قبل إصلاح تتبّع الجلسات — اضغط
        "إعادة ضبط الإحصائيات" لبداية عد نظيفة.
      </p>

      <h2 class="section-title">الزيارات لكل لعبة</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th class="sortable-th" @click="toggleGamesSort('title')">اللعبة {{ sortArrow(gamesSort, 'title') }}</th>
            <th class="sortable-th" @click="toggleGamesSort('total')">إجمالي الزيارات {{ sortArrow(gamesSort, 'total') }}</th>
            <th class="sortable-th" @click="toggleGamesSort('last30d')">آخر 30 يوم {{ sortArrow(gamesSort, 'last30d') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in sortedGames" :key="g.slug">
            <td>{{ g.title }}</td>
            <td>{{ g.total }}</td>
            <td>{{ g.last30d }}</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-title">طلبات الاتصال لكل يوزر نيم</h2>
      <input
        v-model="usernameFilter"
        type="text"
        placeholder="بحث عن يوزر نيم..."
        class="filter-input"
      >
      <table class="admin-table">
        <thead>
          <tr>
            <th class="sortable-th" @click="toggleUsersSort('username')">يوزر نيم {{ sortArrow(usersSort, 'username') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('total')">إجمالي {{ sortArrow(usersSort, 'total') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('last30d')">آخر 30 يوم {{ sortArrow(usersSort, 'last30d') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('last24h')">آخر 24 ساعة {{ sortArrow(usersSort, 'last24h') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('last1h')">آخر ساعة {{ sortArrow(usersSort, 'last1h') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('totalSeconds')">الوقت المقدّر {{ sortArrow(usersSort, 'totalSeconds') }}</th>
            <th class="sortable-th" @click="toggleUsersSort('lastRequestAt')">وقت آخر طلب {{ sortArrow(usersSort, 'lastRequestAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in sortedUsers"
            :key="u.username"
            class="clickable-row"
            @click="selectedUser = u"
          >
            <td>{{ u.username }}</td>
            <td>{{ u.total }}</td>
            <td>{{ u.last30d }}</td>
            <td>{{ u.last24h }}</td>
            <td>{{ u.last1h }}</td>
            <td>{{ formatDuration(u.totalSeconds) }}</td>
            <td>{{ formatDate(u.lastRequestAt) }}</td>
          </tr>
          <tr v-if="!sortedUsers.length">
            <td colspan="7">ما فيه نتائج مطابقة</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-title">سجل الجلسات (متى وكم استمرت)</h2>
      <p class="hint-msg">
        يعرض {{ Math.min(stats.sessionsList.length, SESSIONS_DISPLAY_LIMIT) }} من أصل {{ stats.sessionsList.length }} جلسة (حسب الترتيب المختار).
        كل الجلسات موجودة بملف Excel المصدَّر. المدة محسوبة من الأوقات الفعلية لزيارات الصفحات وطلبات الاتصال.
      </p>
      <table class="admin-table">
        <thead>
          <tr>
            <th class="sortable-th" @click="toggleSessionsSort('firstSeen')">وقت البداية {{ sortArrow(sessionsSort, 'firstSeen') }}</th>
            <th class="sortable-th" @click="toggleSessionsSort('lastSeen')">وقت آخر نشاط {{ sortArrow(sessionsSort, 'lastSeen') }}</th>
            <th class="sortable-th" @click="toggleSessionsSort('durationSeconds')">المدة {{ sortArrow(sessionsSort, 'durationSeconds') }}</th>
            <th>ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in visibleSessions" :key="s.sessionId">
            <td>{{ formatDate(s.firstSeen) }}</td>
            <td>{{ formatDate(s.lastSeen) }}</td>
            <td>{{ formatDuration(s.durationSeconds) }}</td>
            <td>{{ s.isOutlier ? 'شاذة — مستبعدة من المتوسط' : '—' }}</td>
          </tr>
          <tr v-if="!visibleSessions.length">
            <td colspan="4">ما فيه جلسات مسجّلة</td>
          </tr>
        </tbody>
      </table>

      <router-link to="/" class="back-btn home-btn">🏠 الرئيسية</router-link>
    </div>

    <UserDetailModal v-if="selectedUser" :user="selectedUser" @close="selectedUser = null" />
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.admin-page {
  width: 100%;
  max-width: 1000px;
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

.login-panel input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 1rem;
  text-align: center;
}

.error-msg {
  color: var(--danger-color);
  text-align: center;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 15px;
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 15px 20px;
}

.toolbar button {
  padding: 10px 20px;
  font-size: 0.95rem;
}

.reset-date {
  color: #bdc3c7;
  font-size: 0.9rem;
  margin-inline-start: auto;
}

.action-msg {
  color: var(--primary-color);
  text-align: center;
}

.hint-msg {
  color: #bdc3c7;
  font-size: 0.85rem;
  text-align: center;
  margin: 0;
}

.filter-input {
  padding: 10px 16px;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 0.95rem;
  width: 100%;
  max-width: 300px;
}

.clickable-row {
  cursor: pointer;
}

.clickable-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.dashboard {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 10px;
}

.stat-card {
  background: var(--panel-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 2rem;
  font-weight: bold;
  color: var(--primary-color);
}

.stat-label {
  color: #bdc3c7;
  margin-top: 8px;
}

.section-title {
  color: var(--primary-color);
  margin-top: 20px;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 8px;
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
  padding: 12px 16px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.admin-table th {
  background: rgba(0, 0, 0, 0.3);
  color: var(--primary-color);
}

.sortable-th {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.sortable-th:hover {
  background: rgba(0, 0, 0, 0.45);
}

.back-btn {
  margin: 20px auto 0;
}
</style>
