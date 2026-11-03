<script setup>
// نافذة "اللاعبون والتسجيل" الموحّدة لكل الألعاب: طريقة الانضمام + نافذة التسجيل المؤقتة + شبكة بطاقات اللاعبين.
// كل لعبة تمرر حالتها بالـ props/v-model، والأجزاء الخاصة (الفرق مثلاً) تجي عبر الـ slots.
import { computed } from 'vue';
import LionTap from './LionTap.vue';
import CustomSelect from './CustomSelect.vue';
import { GIFT_CHOICES } from '../utils/tiktokBridge';
import { isChatMode, getUserAvatar, displayName } from '../utils/liveConnection';
import { avatarOrLogo, onAvatarError } from '../utils/gameLogo';

const props = defineProps({
  title: { type: String, default: '👥 اللاعبون والتسجيل' },
  // يظهر قسم طريقة الانضمام والتسجيل (يختفي تلقائياً بوضع الدردشة)
  showJoin: { type: Boolean, default: true },
  // يقفل كل الحقول والإضافة والحذف (اللعبة شغالة / التسجيل مقفول)
  locked: { type: Boolean, default: false },
  lockHint: { type: String, default: '' },
  // يقفل طريقة الانضمام وزر بدء التسجيل (افتراضياً نفس locked)
  joinLocked: { type: Boolean, default: null },

  joinViaGift: { type: Boolean, default: false },
  joinKey: { type: String, default: '' },
  joinKeyMaxlength: { type: [Number, String], default: 20 },
  giftFilter: { type: [String, Number, null], default: null },
  // افتراضياً قائمة الهدايا العامة (GIFT_CHOICES)
  giftOptions: { type: Array, default: null },
  // سطر الشرح فوق الأزرار. joinHint ما عاد ينعرض (انحذف الشرح المكرر تحت الحقول) — باقي عشان الألعاب اللي تمرره
  joinLabel: { type: String, default: '' },
  joinHint: { type: String, default: '' },

  regOpen: { type: Boolean, default: false },
  regUnlimited: { type: Boolean, default: false },
  regTimeLeft: { type: Number, default: 0 },
  regDuration: { type: [Number, String], default: 60 },
  extendSeconds: { type: [Number, String], default: 30 },
  // يمنع بدء التسجيل (مثلاً كلمة الفريقين نفسها)
  startDisabled: { type: Boolean, default: false },

  players: { type: Array, default: () => [] },
  count: { type: Number, default: null },
  newName: { type: String, default: '' },
  showAdd: { type: Boolean, default: true },
  emptyText: { type: String, default: 'لا يوجد لاعبون حالياً — أضف أسماء أو خل المشاهدين ينضمون.' },
  canRemove: { type: Boolean, default: null },
  canClear: { type: Boolean, default: null },
  nameFn: { type: Function, default: displayName },
  cardClass: { type: Function, default: null },
  cardStyle: { type: Function, default: null },
});

const emit = defineEmits([
  'update:joinViaGift', 'update:joinKey', 'update:giftFilter',
  'update:regUnlimited', 'update:regDuration', 'update:extendSeconds', 'update:newName',
  'start', 'stop', 'extend', 'add', 'remove', 'clear', 'close',
]);

// GIFT_CHOICES قيمة computed، فلازم نقرأ .value بدل ما نمرر الـ ref نفسه للقائمة
const giftList = computed(() => props.giftOptions || GIFT_CHOICES.value);
const joinLockedEff =computed(() => (props.joinLocked ?? props.locked));
const joinVisible = computed(() => props.showJoin && !isChatMode());
const shownCount = computed(() => (props.count ?? props.players.length));
const removable = computed(() => (props.canRemove ?? !props.locked));
const clearable = computed(() => (props.canClear ?? !props.locked) && props.players.length > 0);

const joinWord = computed(() => (props.joinKey || '').trim() || '1');
const label = computed(() => props.joinLabel || (props.joinViaGift
  ? 'من يرسل هدية ينضم تلقائياً كلاعب.'
  : `من يكتب "${joinWord.value}" بالدردشة ينضم تلقائياً كلاعب.`));

const statusHint = computed(() => (props.regOpen
  ? `🟢 التسجيل مفتوح ${props.regUnlimited ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${props.regTimeLeft} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
  : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.'));
const toggleLabel = computed(() => (props.regOpen
  ? `⛔ إيقاف التسجيل${props.regUnlimited ? '' : ` (${props.regTimeLeft})`}`
  : '🟢 بدء التسجيل'));

function toggleRegistration() {
  emit(props.regOpen ? 'stop' : 'start');
}

// اللاعب ممكن يكون كائن {id, name, avatar} أو {user, avatar} أو اسم نصي فقط
function pName(p) { return typeof p === 'string' ? p : (p.name ?? p.user ?? ''); }
function pKey(p) { return typeof p === 'string' ? p : (p.id ?? p.user ?? p.name); }
function pAvatar(p) { return (typeof p === 'object' && p.avatar) || getUserAvatar(pName(p)); }
</script>

<template>
  <div class="players-modal-overlay" style="display:flex;" @click.self="emit('close')">
    <div class="players-modal-card reg-hub-card">
      <LionTap /><h3>{{ title }}</h3>

      <section v-if="joinVisible" class="reg-hub-section">
        <div class="reg-hub-section-title">🎟️ طريقة الانضمام</div>
        <label class="join-settings-label">{{ label }}</label>
        <div class="join-settings-row" style="margin-top:0;">
          <div class="join-mode-seg">
            <button type="button" class="join-mode-btn" :class="{ active: !joinViaGift }" :disabled="joinLockedEff" @click="emit('update:joinViaGift', false)">✍️ الانضمام بكتابة الكلمة</button>
            <button type="button" class="join-mode-btn" :class="{ active: joinViaGift }" :disabled="joinLockedEff" @click="emit('update:joinViaGift', true)">🎁 الانضمام بإرسال هدية</button>
          </div>
        </div>
        <slot name="join-inputs">
          <div v-if="!joinViaGift" class="join-settings-row">
            <input :value="joinKey" type="text" :maxlength="joinKeyMaxlength" placeholder="كلمة/رقم الانضمام (افتراضياً: 1)" :disabled="joinLockedEff" @input="emit('update:joinKey', $event.target.value)">
          </div>
          <div v-else class="gift-filter-row">
            <CustomSelect :model-value="giftFilter" :options="giftList" :disabled="joinLockedEff" @update:model-value="emit('update:giftFilter', $event)" />
          </div>
        </slot>
        <div class="registration-row">
          <template v-if="!regOpen">
            <input :value="regDuration" type="number" min="5" max="3600" title="مدة التسجيل بالثواني" :disabled="regUnlimited || joinLockedEff" @input="emit('update:regDuration', $event.target.value)">
            <span class="field-hint" style="margin:0;">ثانية</span>
            <label class="join-gift-toggle">
              <input :checked="regUnlimited" type="checkbox" @change="emit('update:regUnlimited', $event.target.checked)">
              ♾️ غير محدود
            </label>
          </template>
          <template v-else-if="!regUnlimited">
            <input :value="extendSeconds" type="number" min="5" max="600" title="مقدار التمديد بالثواني" @input="emit('update:extendSeconds', $event.target.value)">
            <button type="button" class="master-btn" style="padding:8px 16px; font-size:0.9rem; margin:0;" @click="emit('extend')">⏱️ تمديد</button>
          </template>
          <button
            type="button"
            :class="regOpen ? 'reset-btn' : 'master-btn'"
            class="reg-hub-toggle-btn"
            :disabled="!regOpen && (joinLockedEff || startDisabled)"
            @click="toggleRegistration"
          >{{ toggleLabel }}</button>
        </div>
        <div class="field-hint registration-status">{{ statusHint }}</div>
        <slot name="join-after" />
      </section>

      <section class="reg-hub-section">
        <div class="reg-hub-section-title">
          👥 اللاعبون المسجَّلون
          <span class="reg-hub-count" :class="{ live: regOpen }">{{ shownCount }}</span>
        </div>
        <div v-if="locked && lockHint" class="field-hint" style="margin:0 0 8px;">{{ lockHint }}</div>
        <div v-if="showAdd" class="players-modal-add-row">
          <input :value="newName" type="text" placeholder="اسم لاعب جديد" :disabled="locked" @input="emit('update:newName', $event.target.value)" @keydown.enter.prevent="emit('add')">
          <slot name="add-buttons">
            <button type="button" class="master-btn" style="margin:0; padding:10px 16px;" :disabled="locked" @click="emit('add')">➕ إضافة</button>
          </slot>
        </div>
        <slot name="add-after" />
        <div v-if="players.length === 0" class="reg-grid-empty">{{ emptyText }}</div>
        <slot v-else name="grid">
          <TransitionGroup tag="div" class="reg-grid" name="reg-card" appear appear-active-class="reg-card-appear-active">
            <div
              v-for="(p, i) in players"
              :key="pKey(p)"
              class="reg-card"
              :class="cardClass ? cardClass(p) : null"
              :style="{ '--i': Math.min(i, 20), ...(cardStyle ? cardStyle(p) : {}) }"
            >
              <span class="reg-card-num"><slot name="card-num" :player="p" :index="i">{{ i + 1 }}</slot></span>
              <button v-if="removable" type="button" class="reg-card-remove" title="حذف" @click="emit('remove', p)">✕</button>
              <img :src="avatarOrLogo(pAvatar(p))" class="reg-card-avatar" alt="" :style="cardStyle ? cardStyle(p) : null" @error="onAvatarError">
              <bdi class="reg-card-name">{{ nameFn(pName(p)) }}</bdi>
              <slot name="card-extra" :player="p" :index="i" />
            </div>
          </TransitionGroup>
        </slot>
      </section>

      <button v-if="clearable" type="button" class="reset-btn" style="width:100%; margin-top:10px;" @click="emit('clear')">🧹 مسح كل اللاعبين</button>
      <button type="button" class="master-btn" style="width:100%; margin-top:15px;" @click="emit('close')">إغلاق</button>
    </div>
  </div>
</template>
