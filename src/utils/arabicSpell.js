// فاحص إملائي عربي (قاموس Hunspell من مشروع Ayaspell — public/hunspell/ar.aff و ar.dic، رخصة GPL/LGPL/MPL)
// يتحمّل بس لما يحتاجه الأدمن (الملف حوالي 7MB) ويتكاش بعدها.
// nspell ما يدعم السوابق المركّبة (و+ب+ال...) اللي يدعمها Hunspell الأصلي، فنشيل السوابق بنفسنا ونجرب.

// السوابق تنشال بالترتيب: حرف عطف، بعده حرف جر أو سين الاستقبال، بعده "ال"
const CONJ = ['و', 'ف'];
const PREP = ['ب', 'ل', 'ك', 'س'];
const ARTICLE = ['ال', 'لل'];

// كل الأشكال المحتملة للكلمة بعد شيل السوابق (الأصل أول)
export function spellCandidates(word) {
  const out = new Set([word]);
  const stems = [word];
  const strip = (list) => {
    for (const s of stems.slice()) {
      for (const p of list) {
        // اللي يبقى لازم يكون 3 حروف أو أكثر عشان ما تنقبل كلمات غلط بالصدفة
        if (s.startsWith(p) && s.length - p.length >= 3) { stems.push(s.slice(p.length)); out.add(s.slice(p.length)); }
      }
    }
  };
  strip(CONJ);
  strip(PREP);
  strip(ARTICLE);
  // اللي يكتب الهاء بدل التاء المربوطة بآخر الكلمة (سياره = سيارة)
  for (const s of Array.from(out)) if (s.endsWith('ه')) out.add(`${s.slice(0, -1)}ة`);
  return Array.from(out);
}

export function isSpelledCorrectly(speller, word) {
  return spellCandidates(word).some((w) => speller.correct(w));
}

let spellerPromise = null;
export function loadArabicSpeller() {
  if (!spellerPromise) {
    spellerPromise = Promise.all([
      import('nspell'),
      fetch('/hunspell/ar.aff').then((r) => { if (!r.ok) throw new Error('aff'); return r.text(); }),
      fetch('/hunspell/ar.dic').then((r) => { if (!r.ok) throw new Error('dic'); return r.text(); }),
    ]).then(([mod, aff, dic]) => (mod.default || mod)({ aff, dic }))
      .catch((e) => { spellerPromise = null; throw e; });
  }
  return spellerPromise;
}
