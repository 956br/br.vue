<script setup>
import { ref } from 'vue';

const password = ref('');
const stats = ref(null);
const loading = ref(false);
const error = ref('');

async function login() {
  if (!password.value.trim()) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      error.value = data.error || 'تعذّر تسجيل الدخول';
      stats.value = null;
      return;
    }
    stats.value = await res.json();
  } catch {
    error.value = 'صار خطأ بالاتصال بالسيرفر';
  } finally {
    loading.value = false;
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} د ${s} ث`;
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

      <h2 class="section-title">أكثر اليوزر نيمات طلباً للاتصال</h2>
      <table class="admin-table">
        <thead>
          <tr>
            <th>يوزر نيم</th>
            <th>عدد الطلبات</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in stats.topUsernames" :key="u.username">
            <td>{{ u.username }}</td>
            <td>{{ u.count }}</td>
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
