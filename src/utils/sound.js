// الصوت الموحّد للمنصة: كتم عام + مستوى صوت عام + مؤثرات مشتركة (بداية جولة، تكّة آخر الثواني، فوز...)
//
// الكتم العام يشتغل على كل الألعاب بدون تعديلها: نغيّر "destination" لأي AudioContext عشان يرجّع
// عقدة صوت رئيسية (GainNode) موصولة بالسماعات، فكل صوت تشغّله أي لعبة يمر منها ونتحكم فيه من مكان واحد.
// ويُستورد مرة وحدة في main.js قبل ما تشتغل أي لعبة.
import { ref, watch } from 'vue';

const STORAGE_KEY = '956br-sound';

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { muted: !!p.muted, volume: typeof p.volume === 'number' ? p.volume : 1 };
  } catch {
    return { muted: false, volume: 1 };
  }
}

const prefs = readPrefs();
export const soundMuted = ref(prefs.muted);
export const soundVolume = ref(prefs.volume);

const masters = new Set();
const mediaEls = new Set();

function effectiveGain() {
  return soundMuted.value ? 0 : soundVolume.value;
}

function applyGain() {
  const g = effectiveGain();
  masters.forEach((node) => {
    try { node.gain.setValueAtTime(g, node.context.currentTime); } catch { node.gain.value = g; }
  });
  mediaEls.forEach((el) => { el.muted = soundMuted.value; el.volume = Math.min(1, soundVolume.value); });
}

watch([soundMuted, soundVolume], () => {
  applyGain();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: soundMuted.value, volume: soundVolume.value })); } catch { /* تخزين مقفل */ }
});

export function toggleMute() {
  soundMuted.value = !soundMuted.value;
}

// ===== تركيب العقدة الرئيسية على كل AudioContext =====
(function installMasterGain() {
  const Base = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
  if (!Base || !Base.prototype) return;
  const desc = Object.getOwnPropertyDescriptor(Base.prototype, 'destination');
  if (!desc || !desc.get || desc.get.__956br) return;
  const realDestination = desc.get;
  const getter = function () {
    if (!this.__masterGain) {
      const real = realDestination.call(this);
      // OfflineAudioContext (تسجيل/تحليل) نخليه على الأصل
      if (typeof OfflineAudioContext !== 'undefined' && this instanceof OfflineAudioContext) return real;
      const node = this.createGain();
      node.gain.value = effectiveGain();
      node.connect(real);
      this.__masterGain = node;
      masters.add(node);
    }
    return this.__masterGain;
  };
  getter.__956br = true;
  Object.defineProperty(Base.prototype, 'destination', { ...desc, get: getter });
})();

// ملفات الصوت (new Audio) — تسجّل نفسها عشان تتبع الكتم
export function trackMedia(el) {
  mediaEls.add(el);
  el.muted = soundMuted.value;
  el.volume = Math.min(1, soundVolume.value);
  el.addEventListener('ended', () => mediaEls.delete(el), { once: true });
  return el;
}

// ===== مؤثرات مشتركة (مولّدة، بدون ملفات) =====
let ctx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.25 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const EFFECTS = {
  // بداية جولة: صعود سريع
  start: () => { tone(523, 0, 0.12); tone(659, 0.1, 0.12); tone(784, 0.2, 0.22); },
  // تكّة آخر الثواني
  tick: () => tone(880, 0, 0.08, { type: 'square', vol: 0.12 }),
  // انتهى الوقت
  timeup: () => { tone(440, 0, 0.18, { type: 'sawtooth', vol: 0.15 }); tone(330, 0.18, 0.3, { type: 'sawtooth', vol: 0.15 }); },
  // صح / نقطة
  correct: () => { tone(660, 0, 0.1); tone(990, 0.08, 0.16); },
  // غلط / إقصاء
  wrong: () => tone(196, 0, 0.3, { type: 'triangle', vol: 0.3 }),
  // فوز: لحن قصير
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, i === 3 ? 0.5 : 0.14, { type: 'triangle', vol: 0.3 })),
  // انضمام لاعب
  join: () => tone(1200, 0, 0.07, { vol: 0.1 }),
};

export function sfx(name) {
  if (soundMuted.value) return;
  try { EFFECTS[name]?.(); } catch { /* الصوت مو مدعوم */ }
}
