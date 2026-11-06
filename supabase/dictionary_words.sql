-- قاموس لعبة "كوّن كلمة": الكلمات المعتمدة بالجولات اللي مب بالقاموس الأساسي تنحفظ هنا "بانتظار"،
-- والأدمن يعتمدها أو يرفضها من /admin/dictionary. المعتمدة تنضاف لقاموس اللعبة (عبر /api/word-dict).
-- شغّله مرة وحدة بـ Supabase SQL Editor.

create table if not exists dictionary_words (
  -- الكلمة موحّدة بنفس توحيد اللعبة (بدون "ال"، ة = ه، الهمزات ألف) وهي المفتاح
  word text primary key,
  -- الكلمة مثل ما كتبها أول لاعب (للعرض بصفحة الأدمن)
  display text not null,
  -- 'pending' | 'approved' | 'rejected'
  status text not null default 'pending',
  -- كم مرة انعتمدت بجولة قبل ما يراجعها الأدمن
  times_seen integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dictionary_words_status_idx on dictionary_words (status);

alter table dictionary_words enable row level security;
-- بدون أي policy لـ anon: الإضافة والقراءة عبر /api/word-dict، والمراجعة عبر /api/admin-stats (service_role) بس

-- إضافة دفعة كلمات من اللعبة: الجديدة تنضاف "بانتظار"، والموجودة بانتظار يزيد عدادها، والمعتمدة/المرفوضة ما تتغير
create or replace function submit_dictionary_words(words jsonb)
returns void
language sql
as $$
  insert into dictionary_words (word, display)
  select distinct on (w->>'key') w->>'key', w->>'display'
  from jsonb_array_elements(words) as w
  on conflict (word) do update
    set times_seen = dictionary_words.times_seen + 1, updated_at = now()
    where dictionary_words.status = 'pending';
$$;

notify pgrst, 'reload schema';
