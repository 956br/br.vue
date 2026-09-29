import { createClient } from '@supabase/supabase-js';

// قائمة الهدايا المعتمدة المنشورة من /admin/gifts — تحمّلها كل الألعاب بدل القائمة الثابتة بالكود.
// عامة (بدون باسورد) لأنها بس أسماء هدايا، ومكاشة دقيقة بالـ CDN عشان ما تضرب القاعدة مع كل زائر.
export default async function handler(req, res) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('admin_settings').select('value').eq('key', 'gift_options').maybeSingle();

  let gifts = [];
  if (!error) {
    try {
      gifts = JSON.parse(data?.value || 'null')?.gifts || [];
    } catch { /* نرجع قائمة فاضية والموقع يكمل بالقائمة الافتراضية */ }
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json({ gifts: gifts.map(({ value, label, diamonds }) => ({ value, label, diamonds })) });
}
