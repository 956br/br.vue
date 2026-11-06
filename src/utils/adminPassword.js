import { ref } from 'vue';

// باسورد الأدمن مشترك بين صفحات /admin عشان التنقل بينها ما يطلب الدخول مرة ثانية.
// محفوظ بـ sessionStorage: يبقى مع تحديث الصفحة وينمسح لما يتسكّر التبويب.
const KEY = 'admin_password';

function read() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export const adminPassword = ref(read());

// بعد دخول ناجح
export function rememberAdminPassword() {
  try {
    sessionStorage.setItem(KEY, adminPassword.value);
  } catch {}
}

// بعد باسورد غلط، عشان الصفحة الجاية ما تحاول تدخل فيه
export function forgetAdminPassword() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function hasRememberedAdminPassword() {
  return !!read();
}
