-- سجل الهدايا الفريدة اللي تمر بالبثوث المتصلة بالموقع + القائمة المعتمدة (اسم عربي / رئيسية)
-- شغّله مرة وحدة بـ Supabase SQL Editor

create table seen_gifts (
  gift_name text primary key,
  gift_id text,
  diamond_value integer not null default 0,
  image_url text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  times_seen integer not null default 1,
  -- حقول يعبيها الأدمن من صفحة /admin/gifts
  arabic_name text,
  is_main boolean not null default false,
  approved boolean not null default false
);

alter table seen_gifts enable row level security;
-- بدون أي policy لـ anon: الزوار ما يقرون ولا يعدلون الجدول مباشرة، بس عبر الدالة تحت

-- كل متصفح متصل ببث يبلّغ عن الهدية أول ما يشوفها. الدالة security definer
-- عشان anon يقدر يضيف/يحدّث الصف بدون صلاحية select على الجدول، وما تلمس حقول الأدمن أبداً.
create or replace function report_gift(p_name text, p_value integer, p_image text, p_gift_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into seen_gifts (gift_name, diamond_value, image_url, gift_id)
  values (left(trim(p_name), 100), greatest(coalesce(p_value, 0), 0), left(p_image, 500), left(p_gift_id, 50))
  on conflict (gift_name) do update set
    last_seen = now(),
    times_seen = seen_gifts.times_seen + 1,
    diamond_value = case when excluded.diamond_value > 0 then excluded.diamond_value else seen_gifts.diamond_value end,
    image_url = coalesce(excluded.image_url, seen_gifts.image_url),
    gift_id = coalesce(excluded.gift_id, seen_gifts.gift_id);
$$;

revoke all on function report_gift(text, integer, text, text) from public;
grant execute on function report_gift(text, integer, text, text) to anon;
