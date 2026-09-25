<script setup>
import { useRoute } from 'vue-router';

// نفس الصفحة تُعرض كرئيسية للموقع الثاني على /2، وروابطها تفتح نسخ الألعاب برقم 2 (الشات روم)
const route = useRoute();
const suffix = route.meta.site2 ? '2' : '';

const games = [
  { slug: 'wheel', title: 'عجلة الصامل', img: 'wheel.png', desc: 'عجلة تلف وتختار واحد بس، مين بيكون "الضحية" هالمرة؟' },
  { slug: 'dice', title: 'رمعة نرد', img: 'dice.png', desc: 'النرد بيده، وحظك بيدك، خمّن الرقم واجمع النقاط.' },
  { slug: 'card', title: 'معركة الأرقام', img: 'card.png', desc: 'هجمة ودرع وتخطي، بس واحد يبقى بالآخر.' },
  { slug: 'ships-mines', title: 'المراكب والألغام', img: 'ships-mines.png', desc: 'مراكبكم تمشي وسط الألغام، ياخذكم الحظ لبر الأمان لو لا؟' },
  { slug: 'capitals', title: 'دول وعواصم', img: 'capitals.png', desc: 'عاصمة وحدة وأربع خيارات، تعرفها ولا تتوه؟' },
  { slug: 'islands', title: 'جزر البقاء', img: 'islands.png', desc: 'كل جولة تغرق جزر، وين بتوقف قبل ما يجيك الدور؟' },
  // مخفية مؤقتاً حتى إشعار آخر (استُبدلت بالنسخة الجماعية المرتبطة بالبث): { slug: 'memory-game', title: 'تحدي الذاكرة', img: 'memory-game.png', desc: 'لعبة ثنائية محلية: تطابق الصور المتشابهة واحتلال المربعات بلونك. كل لاعب يختار اسمه ولونه، ومن يجمع أكبر عدد من الأزواج يفوز!' },
  { slug: 'memory-live', title: 'الذاكرة', img: 'memory-game.png', desc: 'قلّب البطاقات ولقط المتشابه قبل خصمك.' },
  { slug: 'word-game', title: 'الكلمة المخفية', img: 'word-game.png', desc: 'كل حرف تصويت، والكلمة تنكشف شوي شوي لين تنعرف.' },
  { slug: 'apple', title: 'التقط التفاح', img: 'apple.png', desc: 'كلكم تحركون شخصية وحدة، وشلون بتوصلون للتفاحة سوا؟' },
  { slug: 'apple-solo', title: 'التقط التفاح الفردي', img: 'apple-solo.png', desc: 'كل واحد بروحه وبشخصيته، مين يلقط تفاح أكثر؟' },
  { slug: 'dish', title: 'شنو الطبق؟', img: 'dish.png', desc: 'مكونات تنكشف وحدة وحدة، خمّن اسم الطبق قبل الكل.' },
  { slug: 'luggage', title: 'وزن الشنطة', img: 'luggage.png', desc: 'قرّب رقمك من وزن الشنطة الحقيقي واكسب.' },
  { slug: 'maze', title: 'المتاهة', img: 'maze.png', desc: 'ارسم مسارك واطلع من المتاهة قبل ما الوقت يخلص.' },
  { slug: 'radar', title: 'رادار الإقصاء', img: 'radar.png', desc: 'اندس، والرادار ما يرحم.' },
  { slug: 'tug', title: 'شد الحبل', img: 'tug.png', desc: 'كل فريق يسحب لجهته، مين يغلب بالنهاية؟' },
  { slug: 'unique', title: 'الكلمة الفريدة', img: 'unique.png', desc: 'جاوب بشي ما حد فكر فيه، والفوز لك.' },
  { slug: 'vault', title: 'الخزنة', img: 'vault.png', desc: 'عطيناك المفتاح، افتحها قبل غيرك يفتحها.' },
  { slug: 'wb', title: 'عجلة المربعات', img: 'wb.png', desc: 'ندسك والعجلة تصيدك، حاول ما تطرد نفسك.' },
  { slug: 'dark-room', title: 'كشف المخبأ', img: 'dark-room.png', desc: 'دوّر على الرقم السري بالشبكة قبل ما يفوتك.' },
  { slug: 'pipe-race', title: 'سباق الأنابيب', img: 'pipe-race.webp', desc: 'تتبع الأنابيب المتشابكة واختر الصح قبل ما الوقت يخلص.' },
  // مخفية مؤقتاً حتى إشعار آخر: { slug: 'identity-reveal', title: 'كشف الهوية', img: 'soon.webp', desc: 'مرتبطة ببث تيك توك لايف: سجّل بكتابة إجاباتك الخمس بتعليق واحد، ثم خمّن صاحب التلميحات التي تظهر تباعاً قبل غيرك لتفوز وتكشف هويته!' },
];
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
    <router-link v-for="g in games" :key="g.slug" :to="`/${g.slug}${suffix}`" class="game-card">
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
