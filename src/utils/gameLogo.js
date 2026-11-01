// لاعب بدون أفتار (مضاف يدوياً مثلاً): صورته شعار الموقع
export function avatarOrLogo(avatar) {
  return avatar || '/logo.png';
}

// رابط صورة تيك توك انتهت صلاحيته أو انرفض: بدل الصورة المكسورة يطلع الشعار (@error على <img>)
export function onAvatarError(event) {
  const img = event.target;
  if (!img.src.endsWith('/logo.png')) img.src = '/logo.png';
}
