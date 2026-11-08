// نوافذ التأكيد والتنبيه والإشعارات الموحّدة (بدل alert/confirm حق المتصفح اللي شكلها ما يشبه المنصة)
// المكوّن اللي يعرضها: components/AppDialog.vue (مركّب مرة وحدة في App.vue)
//
// الاستخدام:
//   if (!(await showConfirm('تحذف السؤال؟'))) return;
//   await showAlert('سجّل لاعبين اثنين على الأقل');
//   toast('تم الحفظ ✅');
import { reactive } from 'vue';

export const dialogState = reactive({
  open: false,
  kind: 'alert',      // 'alert' | 'confirm'
  message: '',
  okText: 'تمام',
  cancelText: 'إلغاء',
  danger: false,
  resolve: null,
});

export const toasts = reactive([]);

function openDialog(kind, message, opts = {}) {
  // لو فيه نافذة مفتوحة نسكّرها كإلغاء قبل ما نفتح الجديدة
  if (dialogState.open && dialogState.resolve) dialogState.resolve(false);
  return new Promise((resolve) => {
    Object.assign(dialogState, {
      open: true,
      kind,
      message,
      okText: opts.okText || (kind === 'confirm' ? 'تأكيد' : 'تمام'),
      cancelText: opts.cancelText || 'إلغاء',
      danger: !!opts.danger,
      resolve,
    });
  });
}

export function showConfirm(message, opts) {
  return openDialog('confirm', message, opts);
}

export function showAlert(message, opts) {
  return openDialog('alert', message, opts).then(() => undefined);
}

export function closeDialog(result) {
  const r = dialogState.resolve;
  dialogState.open = false;
  dialogState.resolve = null;
  if (r) r(result);
}

let toastId = 0;
export function toast(message, { type = 'info', duration = 2800 } = {}) {
  const id = ++toastId;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  }, duration);
}
