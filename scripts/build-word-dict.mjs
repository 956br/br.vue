// يبني قاموس لعبة "كوّن كلمة" من نصوص الموقع نفسها (بنوك الأسئلة والأطباق والرسمات...).
// التشغيل: node scripts/build-word-dict.mjs  ← يكتب src/data/wordBuilderDict.txt و src/data/wordBuilderGold.txt
// القاموس: كل كلمة عربية انكتبت بأي نص بالموقع (تنقبل تلقائياً بالفرز).
// الذهبية: أسماء نظيفة (خيارات عشرة على عشرة، الأطباق، الرسمات، أجوبة الحروف، كلمات البذرة) — منها تنختار الكلمة الذهبية.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const load = (f) => import(pathToFileURL(join(dataDir, f)).href);

// نفس توحيد اللعبة (راجع WordBuilder.vue): بدون تشكيل، الهمزات ألف، ى ئ = ي، ؤ = و، ة = ه
function norm(w) {
  return w.replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱء]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه');
}
const stripAl = (w) => w.replace(/^ال(?=\S\S)/, '');
const TOKEN = /[ء-يٱ]+/g;
const tokens = (text) => (String(text).replace(/[ً-ْٰـ]/g, '').match(TOKEN) || []);

const dict = new Set();
const gold = new Map(); // مفتاح موحّد -> الكلمة بكتابتها الأصلية (للعرض)
function addDict(w) {
  const k = stripAl(norm(w));
  if (k.length >= 2 && k.length <= 12) dict.add(k);
}
function addGold(phrase) {
  // الذهبية كلمة وحدة بس (العبارات من أكثر من كلمة تنتجاهل)
  const t = tokens(phrase);
  if (t.length !== 1) return;
  const original = stripAl(t[0]);
  const k = norm(original);
  if (k.length >= 3 && k.length <= 9 && !gold.has(k)) { gold.set(k, original); dict.add(k); }
}

// 1) كل النصوص العربية بملفات البيانات
for (const f of readdirSync(dataDir)) {
  if (!/\.(js|json|txt)$/.test(f) || f.startsWith('wordBuilder')) continue;
  tokens(readFileSync(join(dataDir, f), 'utf8')).forEach(addDict);
}

// 1ب) أشهر 50 ألف كلمة عربية (أفعال وصيغ وعامية) — scripts/sources/ar_50k.txt
// المصدر: github.com/hermitdave/FrequencyWords (content/2018/ar/ar_50k.txt) — رخصة CC-BY-SA 4.0
// كل سطر: "الكلمة التكرار". ناخذ بس الكلمات اللي حروفها عربية كلها.
const freqFile = join(root, 'scripts', 'sources', 'ar_50k.txt');
let freqCount = 0;
try {
  for (const line of readFileSync(freqFile, 'utf8').split(/\r?\n/)) {
    const w = line.split(' ')[0].replace(/[ً-ْٰـ]/g, '');
    if (/^[ء-يٱ]+$/.test(w)) { addDict(w); freqCount++; }
  }
} catch { console.warn('ما لقيت scripts/sources/ar_50k.txt — القاموس بيكون من نصوص الموقع بس'); }

// 2) الأسماء النظيفة للكلمة الذهبية
const { NAME_TEN_QUESTIONS } = await load('nameTenQuestions.js');
NAME_TEN_QUESTIONS.forEach((q) => q.options.forEach((o) => o.split('|').forEach(addGold)));
const { DISHES } = await load('dishes.js');
DISHES.forEach((d) => { addGold(d.name); (d.ingredients || []).forEach(addGold); });
const { LINE_DRAWINGS, PIXEL_DRAWINGS } = await load('drawings.js');
[...LINE_DRAWINGS, ...PIXEL_DRAWINGS].forEach((d) => (d.answers || []).forEach(addGold));
JSON.parse(readFileSync(join(dataDir, 'letterQuestions.json'), 'utf8')).forEach((q) => addGold(q.answer));
const { SEED_WORDS } = await load('wordBuilderSeeds.js');
SEED_WORDS.forEach(addGold);

const sortAr = (s) => Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
writeFileSync(join(dataDir, 'wordBuilderDict.txt'), sortAr(dict).join('\n') + '\n');
writeFileSync(join(dataDir, 'wordBuilderGold.txt'), sortAr(gold.values()).join('\n') + '\n');
console.log(`dict: ${dict.size} words (${freqCount} from frequency list), gold: ${gold.size} words`);
