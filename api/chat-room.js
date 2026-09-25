import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// سيرفر الشات روم الداخلي: المضيف ينشئ غرفة (السيرفر يولّد الكود + توكن المضيف)،
// واللاعبين يدخلون بالكود ويرسلون رسائلهم عن طريق هنا. السيرفر يتحقق، يحفظ الرسالة،
// ثم يبثها على قناة Realtime خاصة chatroom:<CODE> (المتصفحات بس تسمع عليها).

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 200;
const MAX_NAME = 24;
const MIN_MESSAGE_GAP_MS = 400;
const HISTORY_LIMIT = 50;
const HOST_NAME = '🎙️ المضيف';

function randomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function cleanCode(v) {
  return String(v || '').trim().toUpperCase().slice(0, 12);
}

function cleanText(v, max) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function broadcast(code, event, payload) {
  await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ topic: `chatroom:${code}`, event, payload, private: true }] }),
  });
}

function toClientMessage(row) {
  return {
    id: row.id, user: row.name, text: row.text, host: row.client_id === null, ts: row.created_at,
  };
}

async function loadOpenRoom(supabase, code) {
  if (!code) return null;
  const { data } = await supabase.from('chat_rooms').select('*').eq('code', code).maybeSingle();
  if (!data || data.closed_at) return null;
  if (Date.now() - new Date(data.created_at).getTime() > ROOM_TTL_MS) return null;
  return data;
}

async function loadHistory(supabase, code) {
  const { data } = await supabase.from('chat_messages')
    .select('id, client_id, name, text, created_at')
    .eq('room_code', code)
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT);
  return (data || []).reverse().map(toClientMessage);
}

// يرجّع اسم اللاعب المعتمد بالغرفة؛ لو الاسم مأخوذ من لاعب ثاني يضيف رقم (سارة 2، سارة 3...)
async function resolveParticipant(supabase, code, clientId, rawName) {
  const { data: existing } = await supabase.from('chat_participants')
    .select('name').eq('room_code', code).eq('client_id', clientId).maybeSingle();
  if (existing) return existing.name;

  const base = cleanText(rawName, MAX_NAME) || 'لاعب';
  for (let n = 1; n < 50; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (name === HOST_NAME) continue;
    const { error } = await supabase.from('chat_participants').insert({ room_code: code, client_id: clientId, name });
    if (!error) return name;
    if (error.code !== '23505') throw error;
    // تعارض: ممكن نفس الجهاز انضاف بطلب متزامن، نتأكد قبل نجرب اسم ثاني
    const { data: again } = await supabase.from('chat_participants')
      .select('name').eq('room_code', code).eq('client_id', clientId).maybeSingle();
    if (again) return again.name;
  }
  throw new Error('name exhausted');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const { action } = body;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ===== المضيف =====
    if (action === 'create') {
      const hostToken = randomUUID();
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        const { error } = await supabase.from('chat_rooms').insert({ code, host_token: hostToken });
        if (!error) {
          res.status(200).json({ code, hostToken });
          return;
        }
        if (error.code !== '23505') throw error;
      }
      res.status(500).json({ error: 'تعذّر توليد كود غرفة' });
      return;
    }

    const code = cleanCode(body.code);
    const room = await loadOpenRoom(supabase, code);

    if (action === 'resume' || action === 'host-send' || action === 'close') {
      if (!room || !body.hostToken || room.host_token !== body.hostToken) {
        res.status(404).json({ error: 'الغرفة غير موجودة أو انتهت' });
        return;
      }

      if (action === 'resume') {
        const { data: people } = await supabase.from('chat_participants')
          .select('name').eq('room_code', code);
        res.status(200).json({
          code,
          messages: await loadHistory(supabase, code),
          participants: (people || []).map((p) => p.name),
        });
        return;
      }

      if (action === 'close') {
        await supabase.from('chat_rooms').update({ closed_at: new Date().toISOString() }).eq('code', code);
        await broadcast(code, 'closed', {});
        res.status(200).json({ success: true });
        return;
      }

      const text = cleanText(body.text, MAX_TEXT);
      if (!text) { res.status(400).json({ error: 'رسالة فاضية' }); return; }
      const { data: row, error } = await supabase.from('chat_messages')
        .insert({ room_code: code, client_id: null, name: HOST_NAME, text })
        .select('id, client_id, name, text, created_at').single();
      if (error) throw error;
      const msg = toClientMessage(row);
      await broadcast(code, 'msg', msg);
      res.status(200).json({ message: msg });
      return;
    }

    // ===== اللاعب =====
    if (!room) {
      res.status(404).json({ error: 'الغرفة غير موجودة أو انتهت' });
      return;
    }

    const clientId = cleanText(body.clientId, 64);
    if (!clientId) { res.status(400).json({ error: 'clientId مطلوب' }); return; }

    if (action === 'join') {
      const name = await resolveParticipant(supabase, code, clientId, body.name);
      // المضيف يستقبله ويضيف اللاعب للعبة (دخول الغرفة = انضمام للعبة)
      await broadcast(code, 'join', { user: name });
      res.status(200).json({ name, messages: await loadHistory(supabase, code) });
      return;
    }

    if (action === 'send') {
      const text = cleanText(body.text, MAX_TEXT);
      if (!text) { res.status(400).json({ error: 'رسالة فاضية' }); return; }

      const { data: participant } = await supabase.from('chat_participants')
        .select('name, last_message_at').eq('room_code', code).eq('client_id', clientId).maybeSingle();
      if (!participant) { res.status(403).json({ error: 'لازم تدخل الغرفة أول' }); return; }

      const now = new Date();
      if (participant.last_message_at
        && now - new Date(participant.last_message_at) < MIN_MESSAGE_GAP_MS) {
        res.status(429).json({ error: 'على هونك 😅' });
        return;
      }
      await supabase.from('chat_participants')
        .update({ last_message_at: now.toISOString() }).eq('room_code', code).eq('client_id', clientId);

      const { data: row, error } = await supabase.from('chat_messages')
        .insert({ room_code: code, client_id: clientId, name: participant.name, text })
        .select('id, client_id, name, text, created_at').single();
      if (error) throw error;
      const msg = toClientMessage(row);
      await broadcast(code, 'msg', msg);
      res.status(200).json({ message: msg });
      return;
    }

    res.status(400).json({ error: 'action غير معروف' });
  } catch {
    res.status(500).json({ error: 'صار خطأ بالسيرفر' });
  }
}
