import { createClient } from '@supabase/supabase-js';

// قاموس "كوّن كلمة":
// GET  → الكلمات اللي اعتمدها الأدمن (تنضاف فوق القاموس الأساسي باللعبة)، مكاشة دقيقة بالـ CDN
// POST → { words: [{ key, display }] } كلمات انعتمدت بجولة ومب بالقاموس، تنحفظ "بانتظار" لين يراجعها الأدمن

const MAX_WORDS = 200;
// كلمة عربية وحدة بس، والمفتاح موحّد (بدون همزات/تاء مربوطة/ى) مثل اللعبة
const KEY_RE = /^[ا-ي]{2,15}$/;
const DISPLAY_RE = /^[ء-يٱ]{2,20}$/;

export default async function handler(req, res) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === 'GET') {
    const words = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('dictionary_words').select('word').eq('status', 'approved').order('word').range(from, from + PAGE - 1);
      if (error) {
        res.status(200).json({ words: [] });
        return;
      }
      words.push(...data.map((r) => r.word));
      if (data.length < PAGE) break;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ words });
    return;
  }

  if (req.method === 'POST') {
    const input = Array.isArray(req.body?.words) ? req.body.words.slice(0, MAX_WORDS) : [];
    const words = input
      .map((w) => ({ key: String(w?.key || '').trim(), display: String(w?.display || '').trim() }))
      .filter((w) => KEY_RE.test(w.key) && DISPLAY_RE.test(w.display));
    if (words.length === 0) {
      res.status(200).json({ success: true, added: 0 });
      return;
    }
    const { error } = await supabase.rpc('submit_dictionary_words', { words });
    if (error) {
      res.status(500).json({ error: 'فشل الحفظ (تأكد إنك شغّلت supabase/dictionary_words.sql)' });
      return;
    }
    res.status(200).json({ success: true, added: words.length });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
