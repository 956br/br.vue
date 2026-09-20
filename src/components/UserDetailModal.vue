<script setup>
defineProps({
  user: { type: Object, required: true },
});
defineEmits(['close']);

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
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-panel">
      <button class="close-btn" @click="$emit('close')">✕</button>
      <h2 class="modal-title">{{ user.username }}</h2>

      <div class="modal-cards">
        <div class="modal-stat">
          <div class="modal-stat-value">{{ formatDuration(user.totalSeconds) }}</div>
          <div class="modal-stat-label">الوقت المقدّر الكلي</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-value">{{ user.sessionsCount }}</div>
          <div class="modal-stat-label">عدد الجلسات المرتبطة</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-value">{{ user.total }}</div>
          <div class="modal-stat-label">إجمالي طلبات الاتصال</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-value">{{ formatDate(user.lastRequestAt) }}</div>
          <div class="modal-stat-label">وقت آخر طلب</div>
        </div>
      </div>

      <h3 class="modal-section-title">الألعاب اللي استخدمها</h3>
      <table class="modal-table">
        <thead>
          <tr>
            <th>اللعبة</th>
            <th>عدد مرات الاتصال</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in user.games" :key="g.slug">
            <td>{{ g.title }}</td>
            <td>{{ g.count }}</td>
          </tr>
          <tr v-if="!user.games.length">
            <td colspan="2">ما فيه ألعاب مسجّلة لهذا اليوزر</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}

.modal-panel {
  background: var(--panel-bg, #1c1c28);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 25px;
  width: 100%;
  max-width: 560px;
  max-height: 85vh;
  overflow-y: auto;
  position: relative;
}

.close-btn {
  position: absolute;
  top: 12px;
  inset-inline-end: 12px;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 6px 10px;
}

.modal-title {
  text-align: center;
  color: var(--primary-color);
  margin-bottom: 20px;
  word-break: break-word;
}

.modal-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.modal-stat {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 12px;
  padding: 14px;
  text-align: center;
}

.modal-stat-value {
  font-size: 1.2rem;
  font-weight: bold;
  color: var(--primary-color);
}

.modal-stat-label {
  color: #bdc3c7;
  font-size: 0.85rem;
  margin-top: 6px;
}

.modal-section-title {
  color: var(--primary-color);
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 6px;
  margin-bottom: 10px;
}

.modal-table {
  width: 100%;
  border-collapse: collapse;
}

.modal-table th,
.modal-table td {
  padding: 10px 12px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-table th {
  background: rgba(0, 0, 0, 0.3);
  color: var(--primary-color);
}
</style>
