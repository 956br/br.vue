<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();
function goToWheel() {
  router.push('/wheel');
}
</script>

<template>
  <div class="header-section">
    <div class="title-area">
      <h1>عجلة الصامل</h1>
      <div class="subtitle">دليل القواعد ونظام اللعب التفاعلي</div>
    </div>
    <button class="back-btn" @click="goToWheel">🎮 العودة إلى اللعبة</button>
  </div>

  <div class="infographic-container">
    <div class="info-card">
      <div class="card-icon">🎯</div>
      <div class="card-title">آلية الجولة</div>
      <div class="card-desc">
        تعتمد اللعبة على الدوران المتزامن لعجلتين في كل جولة لتحديد مصير اللاعبين بسرعة وحماس:
        <br><br>
        <b style="color: var(--primary-color);">1. عجلة الأسماء:</b> تحدد اللاعب المستهدف.<br>
        <b style="color: var(--primary-color);">2. عجلة الأحكام:</b> تحدد العقوبة أو المكافأة المنطبقة عليه.
      </div>
    </div>

    <div class="info-card success">
      <div class="card-icon">⚖️</div>
      <div class="card-title">الأحكام السبعة للعبة</div>
      <ul class="rules-list">
        <li>يطرد شخص (يختار من يخرجه)</li>
        <li>حصانة (يكتسب حماية خاصة)</li>
        <li>ينطرد (يخرج من الجولة مباشرة)</li>
        <li>يهدي حصانة (يمنحها لغيره)</li>
        <li>يطلع ويطرد حد معاه (مزدوج)</li>
        <li>تخطي (ينجو بلا عقوبة)</li>
        <li>اختيار حر (يطرد أو يهدي)</li>
      </ul>
    </div>

    <div class="info-card secondary">
      <div class="card-icon">🛡️</div>
      <div class="card-title">نظام الحصانات الذكي</div>
      <div class="card-desc">
        - توزع الحصانات مبدئياً بنسبة تقارب 30% من عدد اللاعبين.<br>
        - تحمي الحصانة اللاعب <b>مرة واحدة فقط</b>؛ عند الطرد تنكسر وتعود للبنك.<br>
        - إذا كان البنك فارغاً وقت الإهداء، تُسحب حصانة من لاعب آخر وتُحَلّق نحو اللاعب الجديد تلقائياً.
      </div>
    </div>

    <div class="highlight-box">
      <div class="card-icon">🚨</div>
      <div class="card-title">نظام القنابل والإنذار المبكر</div>
      <div class="card-desc">
        في <b>الجولة 10</b> راح تفجير أول حصانة 💣، وبعدها بتدمير حصانة عشوائية (سواء من البنك أو من أحد اللاعبين)! 💣
      </div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.header-section {
  text-align: center;
  margin-bottom: 30px;
  width: 100%;
  max-width: 1400px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}

.title-area { text-align: right; }

h1 { font-size: 2.5rem; }
.subtitle { font-size: 1.1rem; }

.infographic-container {
  width: 100%;
  max-width: 1400px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 25px;
}

.info-card {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 25px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  position: relative;
  overflow: hidden;
  transition: transform 0.3s ease, border-color 0.3s ease;
}

.info-card:hover {
  transform: translateY(-5px);
  border-color: var(--primary-color);
}

.info-card::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  background: var(--primary-color);
}

.info-card.secondary::before { background: var(--secondary-color); }

.card-icon { font-size: 2.5rem; margin-bottom: 15px; }

.card-title {
  font-size: 1.5rem;
  color: #ecf0f1;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 8px;
}

.card-desc {
  font-size: 1.05rem;
  color: #bdc3c7;
  line-height: 1.7;
}

.rules-list { list-style: none; padding: 0; }

.rules-list li {
  position: relative;
  padding-right: 25px;
  margin-bottom: 10px;
  font-size: 1.05rem;
  color: #dcdde1;
}

.rules-list li::before {
  content: '📌';
  position: absolute;
  right: 0;
  font-size: 0.85rem;
}

.highlight-box {
  background: rgba(138, 21, 56, 0.15);
  border: 1px solid var(--danger-color);
  border-radius: 12px;
  padding: 20px;
  margin-top: 30px;
  width: 100%;
  max-width: 1400px;
  text-align: center;
  box-shadow: 0 0 20px rgba(138, 21, 56, 0.3);
}

.highlight-box .card-title { color: #ff6b6b; font-size: 1.4rem; }

.footer-note { margin-top: 40px; font-size: 0.95rem; }

@media (max-width: 768px) {
  .header-section { flex-direction: column; text-align: center; }
  .title-area { text-align: center; }
  h1 { font-size: 2rem; }
  .subtitle { font-size: 1.1rem; }
}
</style>
