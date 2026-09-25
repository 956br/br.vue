-- سكيما الشات روم الداخلي (نسخ الألعاب السرية wheel2 / dice2)
-- شغّلها كاملة بـ Supabase SQL Editor. كل الكتابة والقراءة من الجداول عن طريق السيرفر (api/chat-room.js بمفتاح service_role)
-- والمتصفحات بس "تسمع" على قناة Realtime خاصة (private) — ما تقدر ترسل عليها رسائل مباشرة.

create table chat_rooms (
  code text primary key,
  host_token text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table chat_participants (
  room_code text not null references chat_rooms(code) on delete cascade,
  client_id text not null,
  name text not null,
  joined_at timestamptz not null default now(),
  last_message_at timestamptz,
  primary key (room_code, client_id),
  unique (room_code, name)
);

create table chat_messages (
  id bigint generated always as identity primary key,
  room_code text not null references chat_rooms(code) on delete cascade,
  client_id text,              -- null = رسالة من المضيف
  name text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_room_idx on chat_messages (room_code, id desc);

-- RLS مفعّل بدون أي policy لـ anon = الجداول مقفولة تماماً عن المتصفح، السيرفر بس يوصلها
alter table chat_rooms enable row level security;
alter table chat_participants enable row level security;
alter table chat_messages enable row level security;

-- ===== صلاحيات Realtime للقنوات الخاصة =====
-- anon يستقبل البث (broadcast) على قنوات الشات روم بس، بدون إرسال
create policy "anon receive chatroom broadcast" on realtime.messages
  for select to anon
  using (realtime.topic() like 'chatroom:%' and realtime.messages.extension in ('broadcast', 'presence'));

-- anon يقدر يسجّل حضوره (presence) عشان المضيف يشوف عدد المتصلين، والعكس
create policy "anon track chatroom presence" on realtime.messages
  for insert to anon
  with check (realtime.topic() like 'chatroom:%' and realtime.messages.extension = 'presence');
