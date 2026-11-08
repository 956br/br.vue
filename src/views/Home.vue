<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { games, categories } from '../data/games';

// نفس الصفحة تُعرض كرئيسية للموقع الثاني على /2، وروابطها تفتح نسخ الألعاب برقم 2 (الشات روم)
const route = useRoute();
const suffix = route.meta.site2 ? '2' : '';

// ===== المفضلة والأخيرة (محفوظة بمتصفح الستريمر فقط) =====
const FAV_KEY = '956br-favorites';
const RECENT_KEY = '956br-recent';
const RECENT_MAX = 4;

function readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* تخزين مقفل */ }
}

const PLAYS_KEY = '956br-plays';

const favorites = ref(readList(FAV_KEY));
const recent = ref(readList(RECENT_KEY));
// عدد مرات فتح كل لعبة من هالمتصفح { slug: count } — لترتيب "الأكثر لعباً"
const plays = ref((() => {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYS_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
})());
watch(favorites, (v) => writeList(FAV_KEY, v), { deep: true });

function isFav(slug) {
  return favorites.value.includes(slug);
}
function toggleFav(slug) {
  favorites.value = isFav(slug) ? favorites.value.filter((s) => s !== slug) : [...favorites.value, slug];
}
function rememberPlayed(slug) {
  recent.value = [slug, ...recent.value.filter((s) => s !== slug)].slice(0, RECENT_MAX);
  writeList(RECENT_KEY, recent.value);
  plays.value = { ...plays.value, [slug]: (plays.value[slug] || 0) + 1 };
  try { localStorage.setItem(PLAYS_KEY, JSON.stringify(plays.value)); } catch { /* تخزين مقفل */ }
}
const playedCount = computed(() => Object.values(plays.value).filter((n) => n > 0).length);

// ===== البحث والتصنيف =====
const search = ref('');
const activeCat = ref('all');

// تطبيع عربي بسيط عشان "اسم" تلقى "إسم"، و"لعبه" تلقى "لعبة"
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

const bySlug = Object.fromEntries(games.map((g) => [g.slug, g]));
const catLabel = Object.fromEntries(categories.map((c) => [c.id, c.label]));

const filtering = computed(() => search.value.trim() !== '' || activeCat.value !== 'all');

const filteredGames = computed(() => {
  const q = norm(search.value);
  const list = games.filter((g) => {
    if (activeCat.value === 'fav' && !isFav(g.slug)) return false;
    if (activeCat.value === 'top' && !plays.value[g.slug]) return false;
    if (!['all', 'fav', 'top'].includes(activeCat.value) && g.cat !== activeCat.value) return false;
    if (!q) return true;
    return norm(g.title).includes(q) || norm(g.desc).includes(q);
  });
  if (activeCat.value === 'top') list.sort((a, b) => (plays.value[b.slug] || 0) - (plays.value[a.slug] || 0));
  return list;
});

const recentGames = computed(() => recent.value.map((s) => bySlug[s]).filter(Boolean));

function clearFilters() {
  search.value = '';
  activeCat.value = 'all';
}

function onImgError(e) {
  e.target.onerror = null;
  e.target.src = '/default-logo.webp';
}
</script>

<template>
  <div class="header-container">
    <div class="platform-logo-space">
      <img src="/logo.png" alt="شعار المنصة">
    </div>
    <h1>بوابة التحديات</h1>
    <div class="subtitle">منصة تحديات 956BR</div>
  </div>

  <!-- آخر ألعاب انلعبت: وصول سريع -->
  <section v-if="recentGames.length && !filtering" class="recent-strip" aria-label="آخر الألعاب">
    <span class="recent-title">🕘 لعبتها مؤخراً</span>
    <router-link
      v-for="g in recentGames"
      :key="`r-${g.slug}`"
      :to="`/${g.slug}${suffix}`"
      class="recent-chip"
      @click="rememberPlayed(g.slug)"
    >
      <img :src="`/${g.img}`" alt="" @error="onImgError">
      <span>{{ g.title }}</span>
    </router-link>
  </section>

  <div class="home-toolbar">
    <div class="search-box">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input v-model="search" type="search" placeholder="دوّر على لعبة..." aria-label="بحث عن لعبة">
      <button v-if="search" type="button" class="search-clear" aria-label="مسح البحث" @click="search = ''">✕</button>
    </div>
    <div class="cat-chips" role="group" aria-label="تصنيف الألعاب">
      <button type="button" class="cat-chip" :class="{ active: activeCat === 'all' }" @click="activeCat = 'all'">الكل <small>{{ games.length }}</small></button>
      <button type="button" class="cat-chip" :class="{ active: activeCat === 'fav' }" @click="activeCat = 'fav'">⭐ المفضلة <small>{{ favorites.length }}</small></button>
      <button v-if="playedCount" type="button" class="cat-chip" :class="{ active: activeCat === 'top' }" @click="activeCat = 'top'">🔥 الأكثر لعباً</button>
      <button
        v-for="c in categories"
        :key="c.id"
        type="button"
        class="cat-chip"
        :class="{ active: activeCat === c.id }"
        @click="activeCat = c.id"
      >{{ c.label }}</button>
    </div>
  </div>

  <div class="games-grid">
    <router-link
      v-for="g in filteredGames"
      :id="`game-${g.slug}`"
      :key="g.slug"
      :to="`/${g.slug}${suffix}`"
      class="game-card"
      @click="rememberPlayed(g.slug)"
    >
      <div class="game-logo-space">
        <img :src="`/${g.img}`" :alt="`شعار ${g.title}`" @error="onImgError">
        <span v-if="g.isNew" class="game-badge badge-new">✨ جديد</span>
        <button
          type="button"
          class="fav-btn"
          :class="{ on: isFav(g.slug) }"
          :aria-label="isFav(g.slug) ? 'شيلها من المفضلة' : 'أضفها للمفضلة'"
          :title="isFav(g.slug) ? 'شيلها من المفضلة' : 'أضفها للمفضلة'"
          @click.prevent.stop="toggleFav(g.slug)"
        >{{ isFav(g.slug) ? '⭐' : '☆' }}</button>
      </div>
      <h2 class="game-title">{{ g.title }}</h2>
      <span v-if="activeCat === 'top'" class="game-plays">🎮 لعبتها {{ plays[g.slug] }} مرة</span>
      <span v-if="g.cat" class="game-cat">{{ catLabel[g.cat] }}</span>
      <p class="game-desc">{{ g.desc }}</p>
      <div class="play-btn">🎲 الدخول للعبة</div>
    </router-link>

    <div v-if="!filtering" class="game-card">
      <div class="game-logo-space">
        <img src="/soon.webp" alt="قريباً">
      </div>
      <h2 class="game-title">(قريباً)</h2>
      <p class="game-desc">قريباً.</p>
      <div class="play-btn disabled-btn">⚙️ جاري التطوير</div>
    </div>
  </div>

  <div v-if="filtering && !filteredGames.length" class="empty-state">
    <div class="empty-icon">{{ activeCat === 'fav' && !search ? '⭐' : '🔍' }}</div>
    <p v-if="activeCat === 'fav' && !search">ما عندك ألعاب بالمفضلة. اضغط ☆ على أي لعبة عشان تضيفها.</p>
    <p v-else>ما لقينا لعبة بهالاسم.</p>
    <button type="button" class="rules-btn" @click="clearFilters">عرض كل الألعاب</button>
  </div>

  <div class="footer-note">
    <span>جميع الحقوق محفوظة لمنصة 956BR - حساب التيك توك: <strong class="footer-handle">956br@</strong></span>
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
  margin-bottom: 30px;
  text-align: center;
}

.platform-logo-space {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
}

.platform-logo-space img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

h1 { font-size: 2.2rem; font-weight: 800; }
.subtitle { font-size: 1.1rem; }

/* ===== آخر الألعاب ===== */
.recent-strip {
  width: 100%;
  max-width: 1050px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.recent-title { color: var(--text-muted); font-weight: 700; margin-left: var(--space-2); }

.recent-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 14px 4px 4px;
  border-radius: var(--radius-pill);
  background: var(--panel-bg);
  border: 1px solid var(--border-subtle);
  color: var(--text-color);
  text-decoration: none;
  font-weight: 700;
  font-size: 0.95rem;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.recent-chip img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
.recent-chip:hover { border-color: var(--primary-color); background: var(--card-hover-bg); }

/* ===== البحث والتصنيفات ===== */
.home-toolbar {
  width: 100%;
  max-width: 1050px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-box input {
  width: 100%;
  padding: 14px 46px 14px 44px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 1.05rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.search-box input::-webkit-search-cancel-button { display: none; }
.search-box input:focus { border-color: var(--primary-color); box-shadow: 0 0 12px var(--border-glow); }
.search-icon { position: absolute; right: 16px; pointer-events: none; }

.search-clear {
  position: absolute;
  left: 8px;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.12);
}

.cat-chips {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.cat-chips::-webkit-scrollbar { display: none; }

.cat-chip {
  flex-shrink: 0;
  padding: 8px 16px;
  font-size: 0.95rem;
  border-radius: var(--radius-pill);
  background: var(--panel-bg);
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  white-space: nowrap;
}

.cat-chip small { opacity: 0.7; font-weight: 500; margin-right: 4px; }
.cat-chip:hover { border-color: var(--primary-color); color: #fff; }

.cat-chip.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: var(--ink-color);
}

/* ===== شبكة الألعاب ===== */
.games-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 25px;
  width: 100%;
  max-width: 1050px;
  margin-bottom: 40px;
}

@media (max-width: 360px) {
  .games-grid { grid-template-columns: 1fr; }
}

.game-card {
  background: var(--panel-bg);
  border-radius: var(--radius-lg);
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
  position: relative;
  width: 100%;
  height: 160px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  background: rgba(0, 0, 0, 0.3);
  transition: border-color 0.3s ease;
  overflow: hidden;
}

.game-logo-space img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.game-card:hover .game-logo-space { border-color: var(--primary-color); }

.game-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 0.8rem;
  font-weight: 800;
}

.badge-new { background: var(--gold-color); color: var(--ink-color); box-shadow: 0 2px 10px rgba(241, 196, 15, 0.5); }

.fav-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  font-size: 1.15rem;
  line-height: 1;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.fav-btn:hover { border-color: var(--gold-color); transform: scale(1.1); }
.fav-btn.on { border-color: var(--gold-color); }

.game-title {
  font-size: 1.4rem;
  font-weight: 800;
  margin-bottom: 8px;
  color: var(--text-color);
  width: 100%;
  text-align: center;
  border-bottom: 2px solid var(--primary-color);
  padding-bottom: 8px;
}

.game-cat {
  font-size: 0.8rem;
  color: var(--text-faint);
  margin-bottom: 8px;
}

.game-plays {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 6px;
}

.game-desc {
  font-size: 0.95rem;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 20px;
  flex-grow: 1;
}

.play-btn {
  background: var(--success-color);
  box-shadow: 0 4px 15px rgba(39, 174, 96, 0.4);
  border: none;
  padding: 12px 20px;
  font-size: 1.05rem;
  font-weight: bold;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all 0.3s ease;
  color: white;
  width: 100%;
  text-align: center;
}

.game-card:hover .play-btn { background: var(--success-light); }

.play-btn.disabled-btn {
  background: var(--info-color);
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: 30px 10px 50px;
}

.empty-icon { font-size: 2.6rem; margin-bottom: var(--space-2); }
.empty-state p { margin-bottom: var(--space-4); }

.footer-note {
  margin-top: auto;
  padding: 20px;
  font-size: 0.9rem;
  max-width: 1000px;
}

.footer-handle { color: var(--primary-color); }

@media (prefers-reduced-motion: reduce) {
  .game-card, .game-card:hover { transition: none; transform: none; }
}
</style>
