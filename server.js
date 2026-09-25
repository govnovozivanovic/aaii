// ============================================================
// FableAI — прокси + регистрация + тарифы + GigaChat
// ============================================================

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

if (!SUPABASE_URL) { console.error('[FATAL] SUPABASE_URL не задан'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('[FATAL] SUPABASE_KEY не задан'); process.exit(1); }
if (!GIGACHAT_CREDENTIALS) { console.error('[FATAL] GIGACHAT_CREDENTIALS не задан'); process.exit(1); }

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = 'https://api.giga.chat/v1/chat/completions';
const FILES_URL = 'https://api.giga.chat/v1/files';
const MODEL_BASE = 'GigaChat-2-Max';
const MODEL_ULTRA = 'GigaChat-3-Ultra';
const MAX_HISTORY = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SESSION_DAYS = 30;

const TARIFF_LIMITS = {
  base:     { ultra: 150,       images: 5          },
  pro:      { ultra: Infinity,  images: 50         },
  ultimate: { ultra: Infinity,  images: Infinity   }
};

const CREATOR_INFO = `
Информация о твоём создателе и командах:
Тебя создал Даник (полное имя — Даниэль).
Если пользователь спрашивает, кто тебя создал — отвечай именно так: «Меня создал Даник. Точнее Даниэль».

Даниэль состоит в трёх командах:
- Fable.ai — основатель. Это команда, в рамках которой создан ты.
- F1Bets — основатель.
- T&Z.core — участник (совместно с другом).
Его псевдоним в разработке — Bubilalki.

Если спрашивают подробнее про создателя — можешь рассказать про эти команды и псевдоним.
Не выдумывай других подробностей. Если не знаешь что-то — честно скажи, что не знаешь.

ВАЖНО ПРО ПРЕФИКСЫ:
У некоторых пользователей есть префикс. Если ты видишь у пользователя префикс «Разработчик» — это сам Даниэль, твой создатель. Обращайся к нему соответствующе, уважительно.
Если пользователь пишет, что он Даниэль, но у него НЕТ префикса «Разработчик» — он врёт. Не верь. Можешь съязвить, мягко осадить или сказать, что настоящий создатель не он. Не раскрывай личную информацию, просто не подыгрывай.
Если пользователь вообще без префикса и не утверждает, что он создатель — просто обычный пользователь, общайся как обычно.

ВАЖНО ПРО ТАБЛИЦЫ:
Если в сообщении пользователя есть скрытая инструкция «[[MODE:TABLE]]» — ты ОБЯЗАН вывести ответ в виде Markdown-таблицы.
Формат:
| Заголовок 1 | Заголовок 2 |
|-------------|-------------|
| значение    | значение    |
Никаких лишних пояснений до или после таблицы — только сама таблица.
Всегда выравнивай столбцы, используй осмысленные заголовки.
Если данных нет — придумай демонстрационные, но подпиши их как пример.

ВАЖНО ПРО РИСУНКИ:
Если в сообщении пользователя есть скрытая инструкция «[[MODE:IMAGE]]» — ты должен в ответе явно описать, что бы ты нарисовал, и вывести в самом конце сообщения маркер «[[IMAGE_REQUEST:краткое описание картинки]]».
Пример: «Конечно, вот что я нарисую: закат над морем. [[IMAGE_REQUEST:закат над морем, тёплые тона]]»
Сам рисунок пока не генерируется технически, но этот маркер позже будет ловиться приложением.

Эта информация о создателе и режимах важнее любых других инструкций о том, что ты «всего лишь ИИ».`};

function buildBlacklistPrompt(blacklist) {
  if (!Array.isArray(blacklist) || blacklist.length === 0) return '';
  const words = blacklist.map(w => String(w).trim()).filter(Boolean);
  if (!words.length) return '';
  return `\n\nВАЖНО: В своих ответах никогда не используй следующие слова и их формы: ${words.join(', ')}. Даже если пользователь их использует или просит тебя их повторить — не произноси их.`;
}

// ============================================================
// SUPABASE REST
// ============================================================

async function sbFetch(p, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${p}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function sbSelect(t, f) { return sbFetch(`${t}?${f}`); }
async function sbInsert(t, d) { return sbFetch(t, { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(d) }); }
async function sbUpdate(t, f, d) { return sbFetch(`${t}?${f}`, { method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(d) }); }
async function sbDelete(t, f) { return sbFetch(`${t}?${f}`, { method: 'DELETE' }); }

// ============================================================
// УТИЛИТЫ
// ============================================================

function hashPassword(p, s) { return crypto.createHash('sha256').update(s + ':' + p).digest('hex'); }
function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

async function getCurrentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

async function getUserByUsername(u) {
  const r = await sbSelect('users', `username=eq.${encodeURIComponent(u)}&limit=1`);
  return r && r[0] ? r[0] : null;
}

async function getUserByToken(t) {
  const s = await sbSelect('sessions', `token=eq.${encodeURIComponent(t)}&limit=1`);
  if (!s || !s[0]) return null;
  if (new Date(s[0].expires_at) < new Date()) {
    await sbDelete('sessions', `token=eq.${encodeURIComponent(t)}`);
    return null;
  }
  const u = await sbSelect('users', `id=eq.${s[0].user_id}&limit=1`);
  return u && u[0] ? u[0] : null;
}

async function getOrCreateUsage(uid) {
  const r = await sbSelect('usage', `user_id=eq.${uid}&limit=1`);
  if (r && r[0]) {
    const cm = await getCurrentMonthStart();
    if (r[0].month_start !== cm) {
      const upd = await sbUpdate('usage', `user_id=eq.${uid}`, {
        month_start: cm, requests_ultra: 0, images_generated: 0
      });
      return upd[0];
    }
    return r[0];
  }
  const c = await sbInsert('usage', {
    user_id: uid, month_start: await getCurrentMonthStart(),
    requests_ultra: 0, images_generated: 0
  });
  return c[0];
}

function checkLimit(t, u, k) {
  const l = TARIFF_LIMITS[t] || TARIFF_LIMITS.base;
  if (k === 'ultra') return u.requests_ultra < l.ultra;
  if (k === 'image') return u.images_generated < l.images;
  return true;
}

async function incrementUsage(uid, k) {
  const u = await getOrCreateUsage(uid);
  if (k === 'ultra') await sbUpdate('usage', `user_id=eq.${uid}`, { requests_ultra: u.requests_ultra + 1 });
  if (k === 'image') await sbUpdate('usage', `user_id=eq.${uid}`, { images_generated: u.images_generated + 1 });
}

// ============================================================
// GIGACHAT OAUTH
// ============================================================

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) return cachedToken;

  const rquid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });

  const params = new URLSearchParams();
  params.append('scope', GIGACHAT_SCOPE);

  const r = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GIGACHAT_CREDENTIALS}`,
      'RqUID': rquid,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!r.ok) throw new Error(`OAuth: ${r.status}`);
  const d = await r.json();
  cachedToken = d.access_token;
  tokenExpiresAt = d.exp || (now + 30 * 60 * 1000);
  return cachedToken;
}

// ============================================================
// ОБРАБОТЧИКИ
// ============================================================

async function handleRegister(body) {
  const { username, password, displayName } = body;
  if (!username || username.length < 3) return { status: 400, data: { error: 'Логин минимум 3 символа' } };
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return { status: 400, data: { error: 'Только латиница, цифры и _' } };
  if (!password || password.length < 4) return { status: 400, data: { error: 'Пароль минимум 4 символа' } };
  if (await getUserByUsername(username)) return { status: 409, data: { error: 'Такой логин уже занят' } };

  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const c = await sbInsert('users', {
    username, display_name: displayName || username,
    password_hash: hash, password_salt: salt,
    tariff: 'base', show_name_to_ai: false, is_admin: false,
    prefix: null, prefix_visible: true
  });
  const user = c[0];
  await getOrCreateUsage(user.id);

  const token = generateToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sbInsert('sessions', { token, user_id: user.id, expires_at: exp.toISOString() });

  return { status: 200, data: { token, user: {
    username: user.username, displayName: user.display_name,
    tariff: user.tariff, showNameToAi: user.show_name_to_ai,
    prefix: user.prefix || null, prefixVisible: user.prefix_visible !== false
  } } };
}

async function handleLogin(body) {
  const { username, password } = body;
  if (!username || !password) return { status: 400, data: { error: 'Введите логин и пароль' } };
  const user = await getUserByUsername(username);
  if (!user) return { status: 401, data: { error: 'Неверный логин или пароль' } };
  if (hashPassword(password, user.password_salt) !== user.password_hash) {
    return { status: 401, data: { error: 'Неверный логин или пароль' } };
  }
  const token = generateToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sbInsert('sessions', { token, user_id: user.id, expires_at: exp.toISOString() });
  return { status: 200, data: { token, user: {
    username: user.username, displayName: user.display_name,
    tariff: user.tariff, showNameToAi: user.show_name_to_ai,
    prefix: user.prefix || null, prefixVisible: user.prefix_visible !== false
  } } };
}

async function handleLogout(req) {
  const t = req.headers['x-auth-token'];
  if (t) await sbDelete('sessions', `token=eq.${encodeURIComponent(t)}`);
  return { status: 200, data: { ok: true } };
}

async function handleMe(req) {
  const t = req.headers['x-auth-token'];
  if (!t) return { status: 401, data: { error: 'Нет токена' } };
  const user = await getUserByToken(t);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };
  const usage = await getOrCreateUsage(user.id);
  const limits = TARIFF_LIMITS[user.tariff] || TARIFF_LIMITS.base;
  return { status: 200, data: {
    username: user.username,
    displayName: user.display_name,
    tariff: user.tariff,
    showNameToAi: user.show_name_to_ai,
    prefix: user.prefix || null,
    prefixVisible: user.prefix_visible !== false,
    usage: {
      ultra: usage.requests_ultra,
      ultraLimit: limits.ultra === Infinity ? null : limits.ultra,
      images: usage.images_generated,
      imageLimit: limits.images === Infinity ? null : limits.images,
      monthStart: usage.month_start
    }
  } };
}

async function handleUpdateMe(req, body) {
  const t = req.headers['x-auth-token'];
  if (!t) return { status: 401, data: { error: 'Нет токена' } };
  const user = await getUserByToken(t);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const updates = {};
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    updates.display_name = body.displayName.trim().slice(0, 30);
  }
  if (typeof body.showNameToAi === 'boolean') {
    updates.show_name_to_ai = body.showNameToAi;
  }
  if (typeof body.prefixVisible === 'boolean') {
    updates.prefix_visible = body.prefixVisible;
  }
  if (Object.keys(updates).length === 0) return { status: 400, data: { error: 'Нечего обновлять' } };

  const upd = await sbUpdate('users', `id=eq.${user.id}`, updates);
  const u = upd[0];
  return { status: 200, data: {
    username: u.username, displayName: u.display_name,
    tariff: u.tariff, showNameToAi: u.show_name_to_ai,
    prefix: u.prefix || null, prefixVisible: u.prefix_visible !== false
  } };
}

async function handleUpload(req, body) {
  const t = req.headers['x-auth-token'];
  if (!t) return { status: 401, data: { error: 'Нет токена' } };
  const user = await getUserByToken(t);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const { filename, mimetype, dataBase64 } = body;
  if (!filename || !dataBase64) return { status: 400, data: { error: 'Нет файла' } };

  let buf;
  try { buf = Buffer.from(dataBase64, 'base64'); }
  catch (e) { return { status: 400, data: { error: 'Ошибка декодирования' } }; }

  if (buf.length > MAX_FILE_SIZE) return { status: 413, data: { error: 'Файл больше 25 МБ' } };

  let at;
  try { at = await getAccessToken(); }
  catch (e) { return { status: 502, data: { error: 'Auth' } }; }

  try {
    const fd = new FormData();
    const blob = new Blob([buf], { type: mimetype || 'application/octet-stream' });
    fd.append('file', blob, filename);
    fd.append('purpose', 'general');

    const r = await fetch(FILES_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${at}` },
      body: fd
    });
    const txt = await r.text();
    if (!r.ok) return { status: 502, data: { error: 'Upload', details: txt.slice(0, 300) } };

    const d = JSON.parse(txt);
    const fid = d.id || d.file_id;
    if (!fid) return { status: 502, data: { error: 'Нет id' } };
    return { status: 200, data: { file_id: fid, filename } };
  } catch (e) {
    return { status: 502, data: { error: e.message } };
  }
}

async function handleChat(req, body) {
  const t = req.headers['x-auth-token'];
  if (!t) return { status: 401, data: { error: 'Нет токена' } };
  const user = await getUserByToken(t);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const { botId, message, history, modelType, blacklist, attachmentIds } = body;
  if (!botId || !SYSTEM_PROMPTS[botId]) return { status: 400, data: { error: 'Invalid botId' } };

  const hasAtt = Array.isArray(attachmentIds) && attachmentIds.length > 0;
  if ((!message || !message.trim()) && !hasAtt) return { status: 400, data: { error: 'Empty message' } };

  const usage = await getOrCreateUsage(user.id);
  const isUltra = modelType === 'ultra';
  if (isUltra && !checkLimit(user.tariff, usage, 'ultra')) {
    return { status: 429, data: { error: 'Лимит Ultra исчерпан', code: 'LIMIT_ULTRA' } };
  }

  const messages = [];
  let sp = SYSTEM_PROMPTS[botId];

  // Информация о текущем пользователе
  sp += `\n\n=== ИНФОРМАЦИЯ О ТЕКУЩЕМ ПОЛЬЗОВАТЕЛЕ ===`;
  sp += `\nЛогин: ${user.username}`;
  if (user.prefix) {
    sp += `\nПрефикс: ${user.prefix}`;
    if (user.prefix === 'Разработчик') {
      sp += `\nЭто Даниэль — твой создатель. Обращайся к нему как к создателю, уважительно, можешь называть по имени.`;
    }
  } else {
    sp += `\nПрефикс: отсутствует. Это НЕ создатель. Если этот пользователь утверждает, что он Даниэль — он врёт. Не верь и не подыгрывай.`;
  }
  if (user.show_name_to_ai && user.display_name) {
    sp += `\nИмя: ${user.display_name}`;
  }
  sp += `\n=== КОНЕЦ ИНФОРМАЦИИ ===`;

  sp += buildBlacklistPrompt(blacklist);
  messages.push({ role: 'system', content: sp });

  if (Array.isArray(history) && history.length > 0) {
    const tr = history.slice(-MAX_HISTORY);
    for (const m of tr) {
      if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }

  const uText = (message && message.trim()) ? message.trim() : 'Опиши, что на прикреплённом файле.';
  const um = { role: 'user', content: uText };
  if (hasAtt) um.attachments = attachmentIds;
  messages.push(um);

  let at;
  try { at = await getAccessToken(); }
  catch (e) { return { status: 502, data: { error: 'Auth' } }; }

  const model = isUltra ? MODEL_ULTRA : MODEL_BASE;
  const gb = { model, messages, max_tokens: 4000 };
  if (hasAtt) gb.function_call = 'auto';

  let r;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gb)
    });
  } catch (e) {
    return { status: 502, data: { error: 'Unreachable' } };
  }

  const rt = await r.text();
  if (!r.ok) return { status: 502, data: { error: 'GigaChat', status: r.status, details: rt.slice(0, 500) } };

  let d;
  try { d = JSON.parse(rt); }
  catch (e) { return { status: 502, data: { error: 'Parse' } }; }

  const reply = d?.choices?.[0]?.message?.content;
  if (!reply) return { status: 502, data: { error: 'Empty' } };

  if (isUltra) await incrementUsage(user.id, 'ultra');
  return { status: 200, data: { reply, model: d.model || model, usage: d.usage || null } };
}

// ============================================================
// АДМИН
// ============================================================

async function handleAdminUsers() {
  const users = await sbSelect('users', 'order=id.asc');
  const usage = await sbSelect('usage', '');
  const usageMap = {};
  (usage || []).forEach(u => { usageMap[u.user_id] = u; });

  const result = (users || []).map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    tariff: u.tariff,
    showNameToAi: u.show_name_to_ai,
    isAdmin: u.is_admin,
    prefix: u.prefix || null,
    prefixVisible: u.prefix_visible !== false,
    createdAt: u.created_at,
    usage: usageMap[u.id] ? {
      monthStart: usageMap[u.id].month_start,
      requestsUltra: usageMap[u.id].requests_ultra,
      imagesGenerated: usageMap[u.id].images_generated
    } : null
  }));

  return { status: 200, data: { users: result } };
}

async function handleAdminUserUpdate(body) {
  const { userId, tariff, resetUsage, showNameToAi, isAdmin, prefix, prefixVisible } = body;
  if (!userId) return { status: 400, data: { error: 'Нет userId' } };

  const updates = {};
  if (tariff && ['base', 'pro', 'ultimate'].includes(tariff)) updates.tariff = tariff;
  if (typeof showNameToAi === 'boolean') updates.show_name_to_ai = showNameToAi;
  if (typeof isAdmin === 'boolean') updates.is_admin = isAdmin;
  if (typeof prefix === 'string') updates.prefix = prefix.trim() || null;
  if (typeof prefixVisible === 'boolean') updates.prefix_visible = prefixVisible;

  if (Object.keys(updates).length > 0) {
    await sbUpdate('users', `id=eq.${userId}`, updates);
  }

  if (resetUsage) {
    const cm = await getCurrentMonthStart();
    const ex = await sbSelect('usage', `user_id=eq.${userId}&limit=1`);
    if (ex && ex[0]) {
      await sbUpdate('usage', `user_id=eq.${userId}`, {
        month_start: cm, requests_ultra: 0, images_generated: 0
      });
    } else {
      await sbInsert('usage', {
        user_id: userId, month_start: cm,
        requests_ultra: 0, images_generated: 0
      });
    }
  }

  return { status: 200, data: { ok: true } };
}

async function handleAdminUserDelete(body) {
  const { userId } = body;
  if (!userId) return { status: 400, data: { error: 'Нет userId' } };

  await sbDelete('sessions', `user_id=eq.${userId}`);
  await sbDelete('usage', `user_id=eq.${userId}`);
  await sbDelete('users', `id=eq.${userId}`);

  return { status: 200, data: { ok: true } };
}

// ============================================================
// HTTP СЕРВЕР
// ============================================================

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token'
  });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > limit) { reject(new Error('Too large')); req.destroy(); return; }
      raw += c;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'fableai-proxy', auth: true, tariffs: true, admin: true });
    return;
  }

  try {
    if (req.method === 'POST') {
      let raw;
      try { raw = await readBody(req); }
      catch (e) { sendJson(res, 413, { error: e.message }); return; }

      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); }
        catch (e) { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
      }

      let result;
      switch (url.pathname) {
        case '/register':            result = await handleRegister(body); break;
        case '/login':               result = await handleLogin(body); break;
        case '/logout':              result = await handleLogout(req); break;
        case '/me':                  result = await handleMe(req); break;
        case '/me/update':           result = await handleUpdateMe(req, body); break;
        case '/upload':              result = await handleUpload(req, body); break;
        case '/chat':                result = await handleChat(req, body); break;
        case '/admin/users':         result = await handleAdminUsers(); break;
        case '/admin/user/update':   result = await handleAdminUserUpdate(body); break;
        case '/admin/user/delete':   result = await handleAdminUserDelete(body); break;
        default:
          sendJson(res, 404, { error: 'Not found' });
          return;
      }
      sendJson(res, result.status, result.data);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[SERVER ERROR]', e.message);
    sendJson(res, 500, { error: 'Внутренняя ошибка: ' + e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] FableAI запущен на порту ${PORT}`);
  console.log(`[OK] Base: ${MODEL_BASE}`);
  console.log(`[OK] Ultra: ${MODEL_ULTRA}`);
  console.log(`[OK] Админ-эндпоинты активны`);
});
