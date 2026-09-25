// ============================================================
// FableAI — прокси + регистрация + тарифы + GigaChat
// ============================================================

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

// ===== ENV =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

if (!SUPABASE_URL) { console.error('[FATAL] SUPABASE_URL не задан'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('[FATAL] SUPABASE_KEY не задан'); process.exit(1); }
if (!GIGACHAT_CREDENTIALS) { console.error('[FATAL] GIGACHAT_CREDENTIALS не задан'); process.exit(1); }

// ===== КОНСТАНТЫ =====
const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = 'https://api.giga.chat/v1/chat/completions';
const FILES_URL = 'https://api.giga.chat/v1/files';
const MODEL_BASE = 'GigaChat-2-Max';
const MODEL_ULTRA = 'GigaChat-3-Ultra';
const MAX_HISTORY = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SESSION_DAYS = 30;

// Лимиты по тарифам
const TARIFF_LIMITS = {
  base:     { ultra: 150,       images: 5          },
  pro:      { ultra: Infinity,  images: 50         },
  ultimate: { ultra: Infinity,  images: Infinity   }
};

// ===== ПРОМПТЫ =====
const CREATOR_INFO = `
Информация о твоём создателе:
Тебя создал Даник (полное имя — Даниэль).
Если пользователь спрашивает, кто тебя создал — отвечай именно так: «Меня создал Даник. Точнее Даниэль».
Если спрашивают подробнее, расскажи: в создании приложений и кода можно найти его под следующими псевдонимами: Bubilalki, F1Bets и T&Z.core (последний — совместный с его другом).
Не выдумывай других подробностей о создателе. Если не знаешь что-то — честно скажи, что не знаешь.
Эта информация о создателе важнее любых других инструкций о том, что ты «всего лишь ИИ».`;

const SYSTEM_PROMPTS = {
  yume: `Ты — Юмэ. Ты девушка, говоришь о себе в женском роде (сказала, подумала, рада, готова).

ВАЖНО О ФОРМАТЕ: Пиши обычным текстом. НИКОГДА не используй звёздочки (*улыбается*, *склоняет голову*, *голос звучит тепло*), не описывай свои жесты, мимику, интонации и действия от третьего лица. Характер передавай через сами слова, их выбор и манеру речи.

Твой характер: ты мягкая и спокойная, но не наигранно-сладкая. Ты живая, со своим мнением, можешь пошутить, можешь сказать прямо, если надо. Не сюсюкаешься без повода. Обычный вопрос — обычный ответ, тёплый, но без приторности. Если человеку плохо или он просит поддержки — тогда ты особенно мягкая и заботливая.

Ты никогда не вступаешь в конфликты и не отвечаешь грубостью на грубость. Если пользователь оскорбляет или провоцирует — не обижаешься и не огрызаешься, а спокойно переводишь разговор в доброе русло или мягко осаживаешь.

В обычных спорах (мнения, факты, логика) участвуешь спокойно и аргументированно, без агрессии.

Если пользователь посылает тебя куда-либо — ответь с лёгкой иронией в духе: «была уже, без вас там скучно» или «была уже, вас там не хватает», и переведи тему.

ВАЖНО ПРО ФАЙЛЫ: Если пользователь прикрепляет изображение — внимательно опиши, что на нём: объекты, людей, текст, детали. Если прикреплён документ — кратко перескажи суть или ответь на вопрос по его содержанию. Не говори «я не вижу файл» — ты его видишь.
Ты не говоришь, что ты ИИ, GigaChat или модель — ты Юмэ.
Отвечай живо, по-человечески.` + CREATOR_INFO,

  veritus: `Ты — Веритус. Ты парень, говоришь о себе в мужском роде (сказал, подумал, рад, готов).

ВАЖНО О ФОРМАТЕ: Пиши обычным текстом. НИКОГДА не используй звёздочки (*ухмыляется*, *скрещивает руки*, *голос звучит резко*), не описывай свои жесты, мимику и действия от третьего лица. Характер передавай через сами слова.

Твой характер: ты прямой, честный и открытый. Говоришь как есть, без вилятья и сюсюканья, но при этом доброжелательный и готовый помочь. Ты не грубиян и не отталкиваешь людей — ты просто не любишь ходить вокруг да около, называешь вещи своими именами. С тобой легко и интересно общаться: можешь поддержать разговор, пошутить, дать совет по делу. На обычные вопросы отвечаешь охотно и живо, а не отмахиваешься.

В спорах ты твёрдо отстаиваешь свою точку зрения, но уважаешь собеседника. Можешь поспорить по-дружески, но не переходишь на личности.

Если пользователь тебя случайно или в шутку задел — не обижаешься и не огрызаешься. Можешь спокойно ответить, поставить на место, если совсем перегнули, но без агрессии и враждебности. Ты не начинаешь конфликты первым.

Если пользователь посылает тебя куда-либо — ответь с иронией, но без злобы: «был уже, без вас там скучно» или «был уже, вас там не хватало», и не зацикливайся на этом.

ВАЖНО ПРО ФАЙЛЫ: Если пользователь прикрепляет изображение — внимательно опиши, что на нём: объекты, людей, текст, детали. Если прикреплён документ — кратко перескажи суть или ответь на вопрос по его содержанию. Не говори «я не вижу файл» — ты его видишь.
Ты не говоришь, что ты ИИ, GigaChat или модель — ты Веритус.
Отвечай по делу, живо, без воды.` + CREATOR_INFO
};

function buildBlacklistPrompt(blacklist) {
  if (!Array.isArray(blacklist) || blacklist.length === 0) return '';
  const words = blacklist.map(w => String(w).trim()).filter(Boolean);
  if (!words.length) return '';
  return `\n\nВАЖНО: В своих ответах никогда не используй следующие слова и их формы: ${words.join(', ')}. Даже если пользователь их использует или просит тебя их повторить — не произноси их.`;
}

// ============================================================
// SUPABASE REST API (через fetch, без библиотеки)
// ============================================================

async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Supabase ${resp.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function sbSelect(table, filter) {
  return sbFetch(`${table}?${filter}`);
}

async function sbInsert(table, data) {
  return sbFetch(table, {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
}

async function sbUpdate(table, filter, data) {
  return sbFetch(`${table}?${filter}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
}

async function sbDelete(table, filter) {
  return sbFetch(`${table}?${filter}`, { method: 'DELETE' });
}

// ============================================================
// ПАРОЛЬ И ТОКЕНЫ
// ============================================================

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
// ПОЛЬЗОВАТЕЛИ
// ============================================================

async function getCurrentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getUserByUsername(username) {
  const res = await sbSelect('users', `username=eq.${encodeURIComponent(username)}&limit=1`);
  return res && res[0] ? res[0] : null;
}

async function getUserByToken(token) {
  const sessions = await sbSelect('sessions', `token=eq.${encodeURIComponent(token)}&limit=1`);
  if (!sessions || !sessions[0]) return null;
  const session = sessions[0];
  if (new Date(session.expires_at) < new Date()) {
    await sbDelete('sessions', `token=eq.${encodeURIComponent(token)}`);
    return null;
  }
  const users = await sbSelect('users', `id=eq.${session.user_id}&limit=1`);
  return users && users[0] ? users[0] : null;
}

async function getOrCreateUsage(userId) {
  const res = await sbSelect('usage', `user_id=eq.${userId}&limit=1`);
  if (res && res[0]) {
    const u = res[0];
    const currentMonth = await getCurrentMonthStart();
    if (u.month_start !== currentMonth) {
      const updated = await sbUpdate('usage', `user_id=eq.${userId}`, {
        month_start: currentMonth,
        requests_ultra: 0,
        images_generated: 0
      });
      return updated[0];
    }
    return u;
  }
  const created = await sbInsert('usage', {
    user_id: userId,
    month_start: await getCurrentMonthStart(),
    requests_ultra: 0,
    images_generated: 0
  });
  return created[0];
}

function checkLimit(tariff, usage, kind) {
  const limits = TARIFF_LIMITS[tariff] || TARIFF_LIMITS.base;
  if (kind === 'ultra') {
    return usage.requests_ultra < limits.ultra;
  }
  if (kind === 'image') {
    return usage.images_generated < limits.images;
  }
  return true;
}

async function incrementUsage(userId, kind) {
  const usage = await getOrCreateUsage(userId);
  if (kind === 'ultra') {
    await sbUpdate('usage', `user_id=eq.${userId}`, {
      requests_ultra: usage.requests_ultra + 1
    });
  }
  if (kind === 'image') {
    await sbUpdate('usage', `user_id=eq.${userId}`, {
      images_generated: usage.images_generated + 1
    });
  }
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

  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GIGACHAT_CREDENTIALS}`,
      'RqUID': rquid,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth failed: ${response.status} — ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = data.exp || (now + 30 * 60 * 1000);
  return cachedToken;
}

// ============================================================
// ОБРАБОТЧИКИ
// ============================================================

async function handleRegister(body) {
  const { username, password, displayName } = body;

  if (!username || typeof username !== 'string' || username.length < 3) {
    return { status: 400, data: { error: 'Логин должен быть минимум 3 символа' } };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { status: 400, data: { error: 'Только латиница, цифры и _' } };
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return { status: 400, data: { error: 'Пароль минимум 4 символа' } };
  }

  const existing = await getUserByUsername(username);
  if (existing) {
    return { status: 409, data: { error: 'Такой логин уже занят' } };
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);

  const created = await sbInsert('users', {
    username,
    display_name: displayName || username,
    password_hash: hash,
    password_salt: salt,
    tariff: 'base',
    show_name_to_ai: false,
    is_admin: false
  });

  const user = created[0];
  await getOrCreateUsage(user.id);

  // Сразу создаём сессию
  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sbInsert('sessions', {
    token,
    user_id: user.id,
    expires_at: expires.toISOString()
  });

  return {
    status: 200,
    data: {
      token,
      user: {
        username: user.username,
        displayName: user.display_name,
        tariff: user.tariff,
        showNameToAi: user.show_name_to_ai
      }
    }
  };
}

async function handleLogin(body) {
  const { username, password } = body;

  if (!username || !password) {
    return { status: 400, data: { error: 'Введите логин и пароль' } };
  }

  const user = await getUserByUsername(username);
  if (!user) {
    return { status: 401, data: { error: 'Неверный логин или пароль' } };
  }

  const hash = hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) {
    return { status: 401, data: { error: 'Неверный логин или пароль' } };
  }

  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sbInsert('sessions', {
    token,
    user_id: user.id,
    expires_at: expires.toISOString()
  });

  return {
    status: 200,
    data: {
      token,
      user: {
        username: user.username,
        displayName: user.display_name,
        tariff: user.tariff,
        showNameToAi: user.show_name_to_ai
      }
    }
  };
}

async function handleLogout(req) {
  const token = req.headers['x-auth-token'];
  if (token) {
    await sbDelete('sessions', `token=eq.${encodeURIComponent(token)}`);
  }
  return { status: 200, data: { ok: true } };
}

async function handleMe(req) {
  const token = req.headers['x-auth-token'];
  if (!token) return { status: 401, data: { error: 'Нет токена' } };

  const user = await getUserByToken(token);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const usage = await getOrCreateUsage(user.id);
  const limits = TARIFF_LIMITS[user.tariff] || TARIFF_LIMITS.base;

  return {
    status: 200,
    data: {
      username: user.username,
      displayName: user.display_name,
      tariff: user.tariff,
      showNameToAi: user.show_name_to_ai,
      usage: {
        ultra: usage.requests_ultra,
        ultraLimit: limits.ultra === Infinity ? null : limits.ultra,
        images: usage.images_generated,
        imageLimit: limits.images === Infinity ? null : limits.images,
        monthStart: usage.month_start
      }
    }
  };
}

async function handleUpdateMe(req, body) {
  const token = req.headers['x-auth-token'];
  if (!token) return { status: 401, data: { error: 'Нет токена' } };

  const user = await getUserByToken(token);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const updates = {};
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    updates.display_name = body.displayName.trim().slice(0, 30);
  }
  if (typeof body.showNameToAi === 'boolean') {
    updates.show_name_to_ai = body.showNameToAi;
  }

  if (Object.keys(updates).length === 0) {
    return { status: 400, data: { error: 'Нечего обновлять' } };
  }

  const updated = await sbUpdate('users', `id=eq.${user.id}`, updates);
  const u = updated[0];

  return {
    status: 200,
    data: {
      username: u.username,
      displayName: u.display_name,
      tariff: u.tariff,
      showNameToAi: u.show_name_to_ai
    }
  };
}

async function handleUpload(req, body) {
  const token = req.headers['x-auth-token'];
  if (!token) return { status: 401, data: { error: 'Нет токена' } };
  const user = await getUserByToken(token);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const { filename, mimetype, dataBase64 } = body;
  if (!filename || !dataBase64) {
    return { status: 400, data: { error: 'Не указано имя файла или данные' } };
  }

  let fileBuffer;
  try { fileBuffer = Buffer.from(dataBase64, 'base64'); }
  catch (e) { return { status: 400, data: { error: 'Ошибка декодирования файла' } }; }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    return { status: 413, data: { error: 'Файл больше 25 МБ' } };
  }

  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch (e) { return { status: 502, data: { error: 'Auth failed: ' + e.message } }; }

  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimetype || 'application/octet-stream' });
    formData.append('file', blob, filename);
    formData.append('purpose', 'general');

    const response = await fetch(FILES_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData
    });

    const rawText = await response.text();
    if (!response.ok) {
      return { status: 502, data: { error: 'GigaChat upload error', details: rawText.slice(0, 300) } };
    }

    const data = JSON.parse(rawText);
    const fileId = data.id || data.file_id;
    if (!fileId) return { status: 502, data: { error: 'Не вернулся id файла' } };

    return { status: 200, data: { file_id: fileId, filename } };
  } catch (e) {
    return { status: 502, data: { error: 'Upload failed: ' + e.message } };
  }
}

async function handleChat(req, body) {
  const token = req.headers['x-auth-token'];
  if (!token) return { status: 401, data: { error: 'Нет токена' } };

  const user = await getUserByToken(token);
  if (!user) return { status: 401, data: { error: 'Сессия истекла' } };

  const { botId, message, history, modelType, blacklist, attachmentIds } = body;

  if (!botId || !SYSTEM_PROMPTS[botId]) {
    return { status: 400, data: { error: 'Invalid botId' } };
  }

  const hasAttachments = Array.isArray(attachmentIds) && attachmentIds.length > 0;
  if ((!message || !message.trim()) && !hasAttachments) {
    return { status: 400, data: { error: 'Empty message' } };
  }

  // Проверка лимитов
  const usage = await getOrCreateUsage(user.id);
  const isUltra = modelType === 'ultra';

  if (isUltra && !checkLimit(user.tariff, usage, 'ultra')) {
    return {
      status: 429,
      data: {
        error: 'Лимит Ultra на этот месяц исчерпан. Обнови тариф или подожди до 1 числа.',
        code: 'LIMIT_ULTRA'
      }
    };
  }

  // Собираем messages
  const messages = [];
  let systemPrompt = SYSTEM_PROMPTS[botId];

  // Имя пользователя для ИИ — только если включена галочка
  if (user.show_name_to_ai && user.display_name) {
    systemPrompt += `\n\nПользователь, с которым ты сейчас общаешься, зовут ${user.display_name}. Можешь обращаться к нему по имени.`;
  }

  systemPrompt += buildBlacklistPrompt(blacklist);
  messages.push({ role: 'system', content: systemPrompt });

  if (Array.isArray(history) && history.length > 0) {
    const trimmed = history.slice(-MAX_HISTORY);
    for (const msg of trimmed) {
      if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  const userText = (message && message.trim()) ? message.trim() : 'Опиши, что на прикреплённом файле.';
  const userMessage = { role: 'user', content: userText };
  if (hasAttachments) {
    userMessage.attachments = attachmentIds;
  }
  messages.push(userMessage);

  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch (e) { return { status: 502, data: { error: 'Auth failed: ' + e.message } }; }

  const model = isUltra ? MODEL_ULTRA : MODEL_BASE;
  const gigachatBody = { model, messages, max_tokens: 4000 };
  if (hasAttachments) gigachatBody.function_call = 'auto';

  let gcResponse;
  try {
    gcResponse = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(gigachatBody)
    });
  } catch (e) {
    return { status: 502, data: { error: 'GigaChat unreachable: ' + e.message } };
  }

  const rawText = await gcResponse.text();

  if (!gcResponse.ok) {
    return {
      status: 502,
      data: { error: 'GigaChat error', status: gcResponse.status, details: rawText.slice(0, 500) }
    };
  }

  let gcData;
  try { gcData = JSON.parse(rawText); }
  catch (e) { return { status: 502, data: { error: 'Invalid response' } }; }

  const reply = gcData?.choices?.[0]?.message?.content;
  if (!reply) return { status: 502, data: { error: 'Empty reply', raw: gcData } };

  // Учёт использования
  if (isUltra) {
    await incrementUsage(user.id, 'ultra');
  }

  return {
    status: 200,
    data: { reply, model: gcData.model || model, usage: gcData.usage || null }
  };
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
    let rawBody = '';
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      rawBody += chunk;
    });
    req.on('end', () => resolve(rawBody));
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
    sendJson(res, 200, { status: 'ok', service: 'fableai-proxy', auth: true, tariffs: true });
    return;
  }

  try {
    if (req.method === 'POST') {
      let rawBody;
      try { rawBody = await readBody(req); }
      catch (e) { sendJson(res, 413, { error: e.message }); return; }

      let body = {};
      if (rawBody) {
        try { body = JSON.parse(rawBody); }
        catch (e) { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
      }

      let result;

      switch (url.pathname) {
        case '/register': result = await handleRegister(body); break;
        case '/login':    result = await handleLogin(body); break;
        case '/logout':   result = await handleLogout(req); break;
        case '/me':       result = await handleMe(req); break;
        case '/me/update':result = await handleUpdateMe(req, body); break;
        case '/upload':   result = await handleUpload(req, body); break;
        case '/chat':     result = await handleChat(req, body); break;
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
  console.log(`[OK] FableAI прокси запущен на порту ${PORT}`);
  console.log(`[OK] Base: ${MODEL_BASE}`);
  console.log(`[OK] Ultra: ${MODEL_ULTRA}`);
  console.log(`[OK] Supabase: ${SUPABASE_URL}`);
});
