const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const BAIDU_TRANSLATE_URL = 'https://aip.baidubce.com/rpc/2.0/mt/texttrans/v2';
const MAX_ITEMS = 100;
const MAX_ITEM_CHARS = 6000;
const MAX_TOTAL_CHARS = 80000;
const CONCURRENCY = 3;
let cachedAccessToken = '';
let accessTokenExpiresAt = 0;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function translateOne(env, item) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(`${BAIDU_TRANSLATE_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({ q: item.value, from: 'auto', to: 'zh' }),
  });
  const payload = await response.json().catch(() => ({}));
  const translated = payload?.result?.trans_result?.[0]?.dst ?? payload?.trans_result?.[0]?.dst;
  if (!response.ok || !translated) {
    const message = payload?.error_msg || payload?.error || '百度翻译服务返回异常';
    const code = payload?.error_code ?? payload?.error_code_str;
    throw new Error(code ? `百度翻译错误 ${code}: ${message}` : message);
  }
  return translated;
}

async function getAccessToken(env) {
  if (env.BAIDU_ACCESS_TOKEN) return env.BAIDU_ACCESS_TOKEN;
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;
  if (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY) throw new Error('翻译服务缺少 BAIDU_SECRET_KEY 配置');
  const url = new URL(BAIDU_TOKEN_URL);
  url.searchParams.set('grant_type', 'client_credentials');
  url.searchParams.set('client_id', env.BAIDU_API_KEY);
  url.searchParams.set('client_secret', env.BAIDU_SECRET_KEY);
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `百度鉴权失败（HTTP ${response.status}）`);
  }
  cachedAccessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 2592000) - 300) * 1000;
  return cachedAccessToken;
}

async function translateAll(env, items) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = [items[index].value, await translateOne(env, items[index])];
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/translate') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return json({ error: '仅支持 POST 请求' }, 405);
    if (!env.BAIDU_ACCESS_TOKEN && (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY)) return json({ error: '翻译服务尚未配置：请设置 BAIDU_ACCESS_TOKEN，或同时设置 BAIDU_API_KEY 和 BAIDU_SECRET_KEY' }, 503);
    try {
      const body = await request.json();
      const items = Array.isArray(body?.items) ? body.items : [];
      const totalChars = items.reduce((total, item) => total + (typeof item?.value === 'string' ? item.value.length : 0), 0);
      const valid = items.length > 0 && items.length <= MAX_ITEMS && totalChars <= MAX_TOTAL_CHARS && items.every((item) => typeof item?.value === 'string' && item.value.length > 0 && item.value.length <= MAX_ITEM_CHARS && typeof item.sourceLanguage === 'string');
      if (!valid) return json({ error: '翻译请求内容不符合限制' }, 400);
      return json({ results: await translateAll(env, items) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '翻译请求失败' }, 502);
    }
  },
};
