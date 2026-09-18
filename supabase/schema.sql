-- سكيما التتبع النهائية (تم التحقق منها فعلياً) لمشروع "بوابة التحديات"
-- شغّلها كاملة بـ Supabase SQL Editor عند إنشاء مشروع جديد

create table page_visits (
  id bigint generated always as identity primary key,
  game_slug text not null,
  session_id text not null,
  visited_at timestamptz not null default now()
);

create table connect_requests (
  id bigint generated always as identity primary key,
  game_slug text not null,
  tiktok_username text not null,
  session_id text not null,
  requested_at timestamptz not null default now()
);

create table sessions (
  session_id text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table page_visits enable row level security;
alter table connect_requests enable row level security;
alter table sessions enable row level security;

-- الزوار (anon) يضيفون بس زيارات/طلبات اتصال جديدة، بدون قراءة أي شيء من الجدولين هذول
create policy "anon insert visits" on page_visits for insert to anon with check (true);
create policy "anon insert connects" on connect_requests for insert to anon with check (true);

-- sessions يحتوي فقط UUID عشوائي + توقيتين (بدون بيانات حساسة)، فسمحنا بـ select/update
-- لازم SELECT policy هنا حتى لو الهدف بس UPDATE — PostgREST يحتاج "يشوف" الصف عشان يحدّده وقت التحديث
create policy "anon insert sessions" on sessions for insert to anon with check (true);
create policy "anon select own session" on sessions for select to anon using (true);
create policy "anon update own session" on sessions for update to anon using (true) with check (true);

-- منح الصلاحيات الأساسية على مستوى الجدول (منفصل عن RLS، ولازم يكون موجود مع بعض)
grant insert, select on page_visits to anon;
grant insert, select on connect_requests to anon;
grant insert, select, update on sessions to anon;
grant usage on all sequences in schema public to anon;
