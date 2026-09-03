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
    const payload = await response.json().catch(() => ({} as TranslationResponse)) as TranslationResponse;
    if (!response.ok) throw new Error(payload.error || '在线翻译服务暂时不可用');
    for (const [source, target] of payload.results ?? []) translations.set(source, target);
    completed += batch.length;
    onProgress(completed, items.length);
  }
  return translations;
}
