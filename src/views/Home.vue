<script setup>
const games = [
  { slug: 'wheel', title: 'عجلة الحظ', img: 'wheel.png', desc: 'مرتبطة ببث تيك توك لايف: من يكتب "1" بالدردشة ينضم تلقائياً للعجلة. أدر العجلة وشاهد من سيكون الضحية التالية!' },
  { slug: 'dice', title: 'توقع النرد', img: 'dice.png', desc: 'مرتبطة ببث تيك توك لايف: يكتب المشاهد "بلعب" للانضمام، وأثناء الجولة يكتب توقعه رقمين مثل "1 3". اجمع النقاط واكسب.' },
  { slug: 'card', title: 'لعبة خمن الرقم', img: 'card.png', desc: 'مرتبطة ببث تيك توك لايف: "1" للانضمام، وأثناء الجولة يكتب المشاهد "رقمين + اسم الضحية" أو "درع"/"تخطي". تبادل الهجمات وابقَ حياً.' },
  { slug: 'ships-mines', title: 'المراكب وقنابل', img: 'ships-mines.png', desc: 'مرتبطة ببث تيك توك لايف: "1" أو "2" لاختيار الفريق، ووقت دور فريقك تصوّت بكتابة رقم المربع. دوّر المراكب وتجنب القنابل.' },
  { slug: 'capitals', title: 'دول وعواصم', img: 'capitals.png', desc: 'مرتبطة ببث تيك توك لايف: يكتب المشاهد "بلعب" للانضمام، ووقت السؤال يصوّت أعضاء الفريق على الإجابة بكتابة رقمها (1-4).' },
  { slug: 'islands', title: 'جزر البقاء', img: 'islands.png', desc: 'مرتبطة ببث تيك توك لايف: "1" للانضمام، ثم يكتب كل لاعب رقم جزيرته. تغرق نسبة عشوائية من الجزر كل جولة حتى يبقى الصامد الأخير!' },
  { slug: 'memory-game', title: 'تحدي الذاكرة', img: 'memory-game.png', desc: 'لعبة ثنائية محلية: تطابق الصور المتشابهة واحتلال المربعات بلونك. كل لاعب يختار اسمه ولونه، ومن يجمع أكبر عدد من الأزواج يفوز!' },
  { slug: 'word-game', title: 'الكلمة المخفية', img: 'word-game.png', desc: 'مرتبطة ببث تيك توك لايف: يكتب المشاهد حرفاً واحداً بالدردشة للتصويت. الحرف الأكثر تصويتاً يُكشف أو يُكلّف الجميع قلباً — اكتشفوا الكلمة قبل نفاد القلوب!' },
  { slug: 'apple', title: 'التقط التفاح', img: 'apple.png', desc: 'مرتبطة ببث تيك توك لايف: يكتب المشاهدون "فوق"/"تحت"/"يمين"/"يسار" بالدردشة لتحريك الشخصية جماعياً نحو التفاحة المشتركة والتقاطها معاً.' },
  { slug: 'apple-solo', title: 'التقط التفاح — فردي', img: 'apple-solo.png', desc: 'مرتبطة ببث تيك توك لايف: اكتب "1" أو أرسل هدية للانضمام، ثم تحكم بشخصيتك الخاصة بكتابة "فوق/تحت/يمين/يسار" لالتقاط أكبر عدد من التفاح في نسختك الفردية.' },
  { slug: 'dish', title: 'شنو الطبق؟', img: 'dish.png', desc: 'مرتبطة ببث تيك توك لايف: تُكشف مكوّنات الطبق تدريجياً كتلميحات، ويكتب المشاهدون اسم الطبق بالدردشة للتخمين حتى يجيب 3 أشخاص بشكل صحيح.' },
  { slug: 'luggage', title: 'تحدي وزن الشنطة', img: 'luggage.png', desc: 'مرتبطة ببث تيك توك لايف: أثناء العد التنازلي يكتب كل مشاهد رقماً كتوقع لوزن الشنطة، وآخر رقم يكتبه هو المعتمد. الأقرب للوزن الفعلي يفوز.' },
  { slug: 'maze', title: 'تحدي المتاهة', img: 'maze.png', desc: 'مرتبطة ببث تيك توك لايف: سجّل بكتابة مفتاح الانضمام قبل إغلاق التسجيل، ثم اكتب مسار حركتك الكامل نحو أحد الأبواب الأربعة بتعليق واحد لاجتياز المتاهة.' },
  { slug: 'radar', title: 'رادار الإقصاء', img: 'radar.png', desc: 'مرتبطة ببث تيك توك لايف: اكتب "بلعب" للانضمام، ثم اختر رقم مربع تختبئ فيه سرّاً. تُقصف المربعات تباعاً — من يصمد حتى النهاية يفوز!' },
  { slug: 'tug', title: 'شد الحبل', img: 'tug.png', desc: 'مرتبطة ببث تيك توك لايف: اكتب إيموجي فريقك (أحمر/أزرق) بالدردشة لإضافة نقطة سحب، وإرسال هدية فريقك يمنح نقاط بونص. أول فريق يصل لعدد النقاط المطلوب يفوز فوراً.' },
  { slug: 'unique', title: 'الكلمة الفريدة', img: 'unique.png', desc: 'مرتبطة ببث تيك توك لايف: اكتب إجابتك مسبوقة بمفتاح الالتقاط المحدد، والفكرة أن تكون إجابتك فريدة ولم يسبق لأحد كتابتها لتفوز.' },
  { slug: 'vault', title: 'لعبة الخزنة', img: 'vault.png', desc: 'مرتبطة ببث تيك توك لايف: بدون تسجيل مسبق، حاول فتح الخزنة بكتابة تسلسل الرموز/الأرقام الصحيح بالدردشة قبل غيرك.' },
  { slug: 'wb', title: 'عجلة والمربعات', img: 'wb.png', desc: 'مرتبطة ببث تيك توك لايف: اكتب مفتاح الانضمام أو أرسل هدية قبل إغلاق التسجيل، ثم أدر العجلة لاختيار لاعب يكتب رقم مربع فينفتح ويكشف جائزة أو إقصاء.' },
  // مخفية مؤقتاً حتى إشعار آخر: { slug: 'identity-reveal', title: 'كشف الهوية', img: 'soon.png', desc: 'مرتبطة ببث تيك توك لايف: سجّل بكتابة إجاباتك الخمس بتعليق واحد، ثم خمّن صاحب التلميحات التي تظهر تباعاً قبل غيرك لتفوز وتكشف هويته!' },
];
</script>

<template>
  <div class="header-container">
    <div class="platform-logo-space">
      <img src="/logo.png" alt="شعار المنصة">
    </div>
    <h1>بوابة التحديات</h1>
    <div class="subtitle">منصة تحديات بو راشد | @956br</div>
  </div>

  <div class="games-grid">
    <router-link v-for="g in games" :key="g.slug" :to="`/${g.slug}`" class="game-card">
      <div class="game-logo-space">
        <img :src="`/${g.img}`" :alt="`شعار ${g.title}`">
      </div>
      <h2 class="game-title">{{ g.title }}</h2>
      <p class="game-desc">{{ g.desc }}</p>
      <div class="play-btn">🎲 الدخول للعبة</div>
    </router-link>

    <div class="game-card">
      <div class="game-logo-space">
        <img src="/soon.png" alt="قريباً">
      </div>
      <h2 class="game-title">(قريباً)</h2>
      <p class="game-desc">قريباً.</p>
      <div class="play-btn disabled-btn">⚙️ جاري التطوير</div>
    </div>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لبو راشد - حساب التيك توك: <strong style="color: #f39c12;">956br@</strong></span>
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
