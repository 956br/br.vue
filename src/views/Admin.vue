<script setup>
import { ref } from 'vue';

const password = ref('');
const stats = ref(null);
const loading = ref(false);
const error = ref('');
const actionBusy = ref(false);
const actionMessage = ref('');

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

async function exportData() {
  actionBusy.value = true;
  actionMessage.value = '';
  try {
    const data = await callAdminApi('export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

function formatDate(iso) {
  if (!iso) return 'ما صار تصفير بعد';
  return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
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
        <button class="rules-btn" :disabled="actionBusy" @click="exportData">📥 تصدير البيانات</button>
        <button class="reset-btn" :disabled="actionBusy" @click="resetData">🗑️ إعادة ضبط الإحصائيات</button>
        <span class="reset-date">آخر إعادة ضبط: {{ formatDate(stats.lastResetAt) }}</span>
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
      </div>

      <h2 class="section-title">الزيارات لكل لعبة</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>اللعبة</th>
            <th>إجمالي الزيارات</th>
            <th>آخر 30 يوم</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in stats.gamesStats" :key="g.slug">
            <td>{{ g.title }}</td>
            <td>{{ g.total }}</td>
            <td>{{ g.last30d }}</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section-title">طلبات الاتصال لكل يوزر نيم</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>يوزر نيم</th>
            <th>إجمالي</th>
            <th>آخر 30 يوم</th>
            <th>آخر 24 ساعة</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in stats.topUsernames" :key="u.username">
            <td>{{ u.username }}</td>
            <td>{{ u.total }}</td>
            <td>{{ u.last30d }}</td>
            <td>{{ u.last24h }}</td>
          </tr>
        </tbody>
      </table>

      <router-link to="/" class="back-btn home-btn">🏠 الرئيسية</router-link>
    </div>
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

.back-btn {
  margin: 20px auto 0;
}
</style>
