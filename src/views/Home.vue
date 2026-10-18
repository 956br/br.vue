<script setup>
import { useRoute } from 'vue-router';
import { games } from '../data/games';

// نفس الصفحة تُعرض كرئيسية للموقع الثاني على /2، وروابطها تفتح نسخ الألعاب برقم 2 (الشات روم)
const route = useRoute();
const suffix = route.meta.site2 ? '2' : '';
</script>

<template>
  <div class="header-container">
    <div class="platform-logo-space">
      <img src="/logo.png" alt="شعار المنصة">
    </div>
    <h1>بوابة التحديات</h1>
    <div class="subtitle">منصة تحديات 956BR</div>
  </div>

  <div class="games-grid">
    <router-link v-for="g in games" :id="`game-${g.slug}`" :key="g.slug" :to="`/${g.slug}${suffix}`" class="game-card">
      <div class="game-logo-space">
        <img :src="`/${g.img}`" :alt="`شعار ${g.title}`" @error="(e) => { e.target.onerror = null; e.target.src = '/default-logo.webp'; }">
      </div>
      <h2 class="game-title">{{ g.title }}</h2>
      <p class="game-desc">{{ g.desc }}</p>
      <div class="play-btn">🎲 الدخول للعبة</div>
    </router-link>

    <div class="game-card">
      <div class="game-logo-space">
        <img src="/soon.webp" alt="قريباً">
      </div>
      <h2 class="game-title">(قريباً)</h2>
      <p class="game-desc">قريباً.</p>
      <div class="play-btn disabled-btn">⚙️ جاري التطوير</div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
  </div>
</template>

<style scoped>
:global(body) { padding: 30px 20px; }

.header-container {
  width: 100%;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 40px;
  text-align: center;
}

.platform-logo-space {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  color: var(--primary-color);
  font-size: 0.9rem;
  text-align: center;
}

.platform-logo-space img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

h1 { font-size: 2.2rem; }
.subtitle { font-size: 1.1rem; }

.games-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 25px;
  width: 100%;
  max-width: 1050px;
  margin-bottom: 40px;
}

.game-card {
  background: var(--panel-bg);
  border-radius: 16px;
  padding: 20px;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.3s ease;
  text-decoration: none;
  color: white;
}

.game-card:hover {
  background: var(--card-hover-bg);
  transform: translateY(-8px);
  border-color: var(--primary-color);
  box-shadow: 0 10px 30px rgba(243, 156, 18, 0.2);
}

.game-logo-space {
  width: 100%;
  height: 160px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  background: rgba(0, 0, 0, 0.3);
  color: #8b93a3;
  font-size: 0.95rem;
  text-align: center;
  transition: border-color 0.3s ease, color 0.3s ease;
  overflow: hidden;
}

.game-logo-space img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.game-card:hover .game-logo-space {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.game-title {
  font-size: 1.4rem;
  margin-bottom: 10px;
  color: #ecf0f1;
  width: 100%;
  text-align: center;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 8px;
}

.game-desc {
  font-size: 0.95rem;
  color: #bdc3c7;
  text-align: center;
  line-height: 1.6;
  margin-bottom: 20px;
  flex-grow: 1;
}

.play-btn {
  background: #27ae60;
  box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
  border: none;
  padding: 12px 20px;
  font-size: 1.05rem;
  font-weight: bold;
  border-radius: 30px;
  cursor: pointer;
  transition: all 0.3s ease;
  color: white;
  width: 100%;
  text-align: center;
}

.game-card:hover .play-btn {
  background: #2ecc71;
}

.play-btn.disabled-btn {
  background: #3498db;
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

.footer-note {
  margin-top: auto;
  padding: 20px;
  font-size: 0.9rem;
  max-width: 1000px;
}
</style>
