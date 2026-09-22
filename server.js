// ============================================================
// Danik Assistant — прокси (GigaChat v1) с загрузкой файлов
// ============================================================

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

if (!GIGACHAT_CREDENTIALS) {
  console.error('[FATAL] GIGACHAT_CREDENTIALS не задан');
  process.exit(1);
}

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = 'https://api.giga.chat/v1/chat/completions';
const FILES_URL = 'https://api.giga.chat/v1/files';
const MODEL_BASE = 'GigaChat-2-Max';
const MODEL_ULTRA = 'GigaChat-3-Ultra';
const MAX_HISTORY = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
  console.log('[AUTH] Получен новый токен');
  return cachedToken;
}

async function handleUpload(body) {
  const { filename, mimetype, dataBase64 } = body;

  if (!filename || !dataBase64) {
    return { status: 400, data: { error: 'Не указано имя файла или данные' } };
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(dataBase64, 'base64');
  } catch (e) {
    return { status: 400, data: { error: 'Ошибка декодирования файла' } };
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    return { status: 413, data: { error: 'Файл больше 25 МБ' } };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return { status: 502, data: { error: 'Auth failed: ' + e.message } };
  }

  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimetype || 'application/octet-stream' });
    formData.append('file', blob, filename);
    formData.append('purpose', 'general');

    const response = await fetch(FILES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error('[UPLOAD ERROR]', response.status, rawText.slice(0, 500));
      return {
        status: 502,
        data: { error: 'GigaChat upload error', status: response.status, details: rawText.slice(0, 300) }
      };
    }

    const data = JSON.parse(rawText);
    const fileId = data.id || data.file_id;

    if (!fileId) {
      return { status: 502, data: { error: 'GigaChat не вернул id файла', raw: data } };
    }

    console.log('[UPLOAD OK]', filename, '→', fileId);
    return { status: 200, data: { file_id: fileId, filename } };
  } catch (e) {
    console.error('[UPLOAD EXCEPTION]', e.message);
    return { status: 502, data: { error: 'Upload failed: ' + e.message } };
  }
}

async function handleChat(body) {
  const { botId, message, history, modelType, blacklist, attachmentIds } = body;

  if (!botId || !SYSTEM_PROMPTS[botId]) {
    return { status: 400, data: { error: 'Invalid botId' } };
  }

  const hasAttachments = Array.isArray(attachmentIds) && attachmentIds.length > 0;

  if ((!message || !message.trim()) && !hasAttachments) {
    return { status: 400, data: { error: 'Empty message' } };
  }

  const messages = [];
  const systemPrompt = SYSTEM_PROMPTS[botId] + buildBlacklistPrompt(blacklist);
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

  // ===== КЛЮЧЕВОЕ: attachments кладём внутрь user-сообщения =====
  const userMessage = { role: 'user', content: userText };
  if (hasAttachments) {
    userMessage.attachments = attachmentIds.map(id => ({ file_id: id }));
  }
  messages.push(userMessage);

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return { status: 502, data: { error: 'Auth failed: ' + e.message } };
  }

  // Для картинок и файлов используем Max (умеет vision), для остального — по флагу
  const useUltra = modelType === 'ultra';
  let model;
  if (useUltra) {
    model = MODEL_ULTRA;
  } else {
    model = MODEL_BASE;
  }

  const gigachatBody = {
    model,
    messages,
    max_tokens: 4000
  };

  console.log('[REQ] model:', model, 'attachments:', hasAttachments ? attachmentIds.length : 0);

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
  console.log('[GIGACHAT RESPONSE]', gcResponse.status, rawText.slice(0, 800));

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
  if (!reply) {
    return { status: 502, data: { error: 'Empty reply', raw: gcData } };
  }

  return {
    status: 200,
    data: { reply, model: gcData.model || model, usage: gcData.usage || null }
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let rawBody = '';
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'danik-assistant-proxy', provider: 'gigachat', upload: true });
    return;
  }

  if (url.pathname === '/upload' && req.method === 'POST') {
    let rawBody;
    try { rawBody = await readBody(req); }
    catch (e) { sendJson(res, 413, { error: e.message }); return; }

    let body;
    try { body = JSON.parse(rawBody); }
    catch (e) { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

    const result = await handleUpload(body);
    sendJson(res, result.status, result.data);
    return;
  }

  if (url.pathname === '/chat' && req.method === 'POST') {
    let rawBody;
    try { rawBody = await readBody(req); }
    catch (e) { sendJson(res, 413, { error: e.message }); return; }

    let body;
    try { body = JSON.parse(rawBody); }
    catch (e) { sendJson(res, 400, { error: 'Invalid JSON' }); return; }

    const result = await handleChat(body);
    sendJson(res, result.status, result.data);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Прокси запущен на порту ${PORT}`);
  console.log(`[OK] Base: ${MODEL_BASE}`);
  console.log(`[OK] Ultra: ${MODEL_ULTRA}`);
  console.log(`[OK] Upload: включён (max 25 МБ)`);
});
