import { ref } from 'vue';

// نافذة إعدادات اللعبة (نفس رمعة نرد): تنفتح من زر "الإعدادات"، أو من زر البداية وزرها يأكد ويبدأ.
// بعد أول تأكيد زر البداية يبدأ مباشرة، لين تنعاد اللعبة (resetSettingsConfirm).
// always: النافذة تنفتح مع كل بداية (للألعاب اللي إعداداتها تتغير كل جولة).
export function useSettingsOverlay(start, { always = false } = {}) {
  const settingsVisible = ref(false);
  const settingsForStart = ref(false);
  let confirmed = false;

  function openSettings() {
    settingsForStart.value = false;
    settingsVisible.value = true;
  }
  function closeSettings() {
    settingsVisible.value = false;
    settingsForStart.value = false;
  }
  function requestStart() {
    if (settingsVisible.value) return;
    if (confirmed) { start(); return; }
    settingsForStart.value = true;
    settingsVisible.value = true;
  }
  function confirmSettingsAndStart() {
    confirmed = !always;
    closeSettings();
    start();
  }
  function resetSettingsConfirm() { confirmed = false; }

  return {
    settingsVisible, settingsForStart, openSettings, closeSettings, requestStart, confirmSettingsAndStart, resetSettingsConfirm,
  };
}
