const BAIDU_TRANSLATE_URL = 'https://fanyi-api.baidu.com/ait/api/aiTextTranslate';
const MAX_ITEMS = 100;
const MAX_ITEM_CHARS = 6000;
const MAX_TOTAL_CHARS = 80000;
const CONCURRENCY = 3;
const sourceLanguages = { zho_Hans: 'zh', eng_Latn: 'en', deu_Latn: 'de', fra_Latn: 'fr' };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function translateOne(env, item) {
  const sourceLanguage = sourceLanguages[item.sourceLanguage];
  if (!sourceLanguage) throw new Error('不支持的源语言');
  if (sourceLanguage === 'zh') return item.value;
  const response = await fetch(BAIDU_TRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BAIDU_API_KEY}` },
    body: JSON.stringify({ appid: env.BAIDU_APP_ID, q: item.value, from: sourceLanguage, to: 'zh', model_type: 'llm' }),
  });
  const payload = await response.json().catch(() => ({}));
  const translated = payload?.trans_result?.[0]?.dst;
  if (!response.ok || !translated) {
    const message = payload?.error_msg || '百度翻译服务返回异常';
    const code = payload?.error_code;
    throw new Error(code ? `百度翻译错误 ${code}: ${message}` : message);
  }
  return translated;
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
    if (!env.BAIDU_APP_ID || !env.BAIDU_API_KEY) return json({ error: '翻译服务尚未配置' }, 503);
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
