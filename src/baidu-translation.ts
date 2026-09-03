type TranslationItem = { value: string; sourceLanguage: string };

type TranslationResponse = {
  results?: Array<[string, string]>;
  error?: string;
};

const ITEMS_PER_REQUEST = 50;

export async function translateViaBaidu(items: TranslationItem[], onProgress: (completed: number, total: number) => void) {
  const translations = new Map<string, string>();
  let completed = 0;
  for (let start = 0; start < items.length; start += ITEMS_PER_REQUEST) {
    const batch = items.slice(start, start + ITEMS_PER_REQUEST);
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: batch }) });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({} as TranslationResponse)) as TranslationResponse
      : {} as TranslationResponse;
    if (!response.ok) {
      if (payload.error) throw new Error(payload.error);
      throw new Error(`翻译接口请求失败（HTTP ${response.status}，返回 ${contentType || '非 JSON'}）`);
    }
    if (!Array.isArray(payload.results)) throw new Error(`翻译接口返回格式异常（HTTP ${response.status}）`);
    for (const [source, target] of payload.results) translations.set(source, target);
    completed += batch.length;
    onProgress(completed, items.length);
  }
  return translations;
}
