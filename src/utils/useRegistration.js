import { ref, reactive, computed } from 'vue';
import {
  normalizeDigits, isGiftEvent, giftPassesFilter, getGiftUser, GIFT_OPTIONS, defaultGift,
} from './tiktokBridge';
import { getUserAvatar, isChatMode } from './liveConnection';

// تسجيل اللاعبين المشترك بين الألعاب: قائمة الأسماء، طريقة الانضمام (كلمة بالدردشة أو هدية)،
// نافذة التسجيل المؤقتة، ونافذتي "إدارة اللاعبين" و"طريقة الانضمام".
// onDuplicate(name): تنادى لما المستضيف يضيف اسم موجود مسبقاً.
export function useRegistration({ onDuplicate } = {}) {
  const registrationLocked = ref(false);
  const masterPlayersList = reactive([]);
  let playerIdCounter = 1;
  const joinedUsers = new Set();
  const newPlayerName = ref('');

  // ===== طريقة الانضمام =====
  const joinKeyInput = ref('1');
  const joinViaGift = ref(false);
  const giftNameFilter = ref(defaultGift());
  const giftMinValue = ref(null);
  const selectedGiftLabel = computed(() => {
    const found = GIFT_OPTIONS.find((g) => g.value === giftNameFilter.value);
    return found ? found.label : '🎁 أي هدية';
  });
  function getJoinKey() { return joinKeyInput.value.trim() || '1'; }
  const joinKeyHint = computed(() => (joinViaGift.value
    ? 'الانضمام مفعّل عبر الهدايا: أي مشاهد يرسل الهدية المحددة أثناء فتح نافذة التسجيل ينضم تلقائياً كلاعب مسجَّل.'
    : `المشاهد يكتب "${getJoinKey()}" بالدردشة عشان ينضم كلاعب مسجَّل أثناء فتح نافذة التسجيل`));

  // ===== نافذة التسجيل =====
  const registrationOpen = ref(false);
  const registrationUnlimited = ref(false);
  const registrationTimeLeft = ref(0);
  const registrationDurationInput = ref(60);
  const extendSecondsInput = ref(30);
  let registrationTimer = null;

  const registrationStatusHint = computed(() => (registrationOpen.value
    ? `🟢 التسجيل مفتوح ${registrationUnlimited.value ? 'بدون وقت — يبقى مفتوح لين توقفه' : `— ${registrationTimeLeft.value} ثانية متبقية`}. أي انضمام عبر الدردشة/الهدايا يُحتسب الآن.`
    : '🔒 التسجيل مغلق — حدد المدة (أو فعّل "بدون وقت") واضغط "بدء التسجيل" لفتح باب الانضمام عبر الدردشة/الهدايا.'));

  function stopRegistration() {
    if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
    registrationOpen.value = false;
    registrationTimeLeft.value = 0;
  }
  function startRegistration() {
    if (registrationLocked.value || registrationOpen.value) return;
    let dur = parseInt(registrationDurationInput.value, 10);
    if (Number.isNaN(dur) || dur < 5) dur = 5;
    registrationDurationInput.value = dur;
    registrationTimeLeft.value = dur;
    registrationOpen.value = true;
    if (registrationTimer) clearInterval(registrationTimer);
    if (registrationUnlimited.value) { registrationTimeLeft.value = 0; return; }
    registrationTimer = setInterval(() => {
      registrationTimeLeft.value--;
      if (registrationTimeLeft.value <= 0) stopRegistration();
    }, 1000);
  }
  function extendRegistration() {
    if (!registrationOpen.value || registrationUnlimited.value) return;
    let add = parseInt(extendSecondsInput.value, 10);
    if (Number.isNaN(add) || add < 1) add = 30;
    registrationTimeLeft.value += add;
  }

  // ===== قائمة اللاعبين =====
  function addPlayer() {
    if (registrationLocked.value) return;
    const name = newPlayerName.value.trim();
    if (name === '') return;
    if (masterPlayersList.some((p) => p.name === name)) {
      if (onDuplicate) onDuplicate(name);
      return;
    }
    masterPlayersList.push({ id: playerIdCounter++, name });
    newPlayerName.value = '';
  }
  function removePlayer(id) {
    if (registrationLocked.value) return;
    const idx = masterPlayersList.findIndex((p) => p.id === id);
    if (idx !== -1) masterPlayersList.splice(idx, 1);
  }
  function clearPlayers() {
    if (registrationLocked.value) return;
    masterPlayersList.splice(0, masterPlayersList.length);
    joinedUsers.clear();
  }
  function addPlayerFromLive(name, avatar) {
    if (registrationLocked.value || (!registrationOpen.value && !isChatMode()) || !name) return;
    if (joinedUsers.has(name)) return;
    joinedUsers.add(name);
    if (masterPlayersList.some((p) => p.name === name)) return;
    masterPlayersList.push({ id: playerIdCounter++, name, avatar: avatar || getUserAvatar(name) });
  }
  // اللاعب كتب "خروج": ينشال من القائمة حتى بعد قفل التسجيل
  function removeFromList(name) {
    joinedUsers.delete(name);
    const idx = masterPlayersList.findIndex((p) => p.name === name);
    if (idx !== -1) masterPlayersList.splice(idx, 1);
  }
  const hasPlayer = (name) => masterPlayersList.some((p) => p.name === name);

  // يعالج رسالة البث: يضيف اللاعب لو كتب كلمة الانضمام أو أرسل الهدية المطلوبة، ويرجّع true لو كانت رسالة انضمام
  function handleJoinMessage(data) {
    if (!registrationOpen.value || registrationLocked.value) return false;
    if (!joinViaGift.value && data.comment && data.user
      && normalizeDigits(data.comment.trim()) === normalizeDigits(getJoinKey())) {
      addPlayerFromLive(data.user, data.avatar);
      return true;
    }
    if (joinViaGift.value && isGiftEvent(data)
      && giftPassesFilter(data, { nameFilter: giftNameFilter.value, minValue: giftMinValue.value })) {
      addPlayerFromLive(getGiftUser(data), data.avatar);
      return true;
    }
    return false;
  }

  // ===== النوافذ =====
  const playersModalVisible = ref(false);
  function openPlayersModal() { playersModalVisible.value = true; }
  function closePlayersModal() { playersModalVisible.value = false; }
  const joinSettingsModalVisible = ref(false);
  function openJoinSettingsModal() { joinSettingsModalVisible.value = true; }
  function closeJoinSettingsModal() { joinSettingsModalVisible.value = false; }

  // يفتح التسجيل من جديد ويبقي الأسماء بالقائمة
  function resetRegistration() {
    stopRegistration();
    registrationLocked.value = false;
    joinedUsers.clear();
  }
  function disposeRegistration() {
    if (registrationTimer) { clearInterval(registrationTimer); registrationTimer = null; }
  }

  return {
    registrationLocked,
    masterPlayersList,
    newPlayerName,
    joinKeyInput,
    joinViaGift,
    giftNameFilter,
    giftMinValue,
    selectedGiftLabel,
    getJoinKey,
    joinKeyHint,
    registrationOpen,
    registrationUnlimited,
    registrationTimeLeft,
    registrationDurationInput,
    extendSecondsInput,
    registrationStatusHint,
    startRegistration,
    extendRegistration,
    stopRegistration,
    addPlayer,
    removePlayer,
    clearPlayers,
    addPlayerFromLive,
    removeFromList,
    hasPlayer,
    handleJoinMessage,
    playersModalVisible,
    openPlayersModal,
    closePlayersModal,
    joinSettingsModalVisible,
    openJoinSettingsModal,
    closeJoinSettingsModal,
    resetRegistration,
    disposeRegistration,
  };
}
