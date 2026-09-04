import { downloadTranslationCache, loadTranslationCache, translationCacheKey, type TranslationCacheEntry } from './translation-cache';

type TranslationItem = { value: string; sourceLanguage: string };

type TranslationResponse = {
  results?: Array<[string, string]>;
  error?: string;
};

const ITEMS_PER_REQUEST = 50;
// 这些错误只影响当前请求中的文本，跳过后仍可继续处理其他词条。
const SKIPPABLE_ERROR_CODES = new Set(['20003', '58001', '59003']);
let activeController: AbortController | null = null;

export function cancelActiveTranslation() {
  activeController?.abort();
}

export async function translateViaBaidu(items: TranslationItem[], onProgress: (completed: number, total: number) => void, signal?: AbortSignal) {
  const controller = signal ? null : new AbortController();
  const activeSignal = signal ?? controller!.signal;
  activeController = controller;
  const translations = new Map<string, string>();
  const sessionEntries = new Map<string, TranslationCacheEntry>();
  let cache = new Map<string, TranslationCacheEntry>();
  try {
    cache = await loadTranslationCache();
  } catch {
    // 缓存文件不可用时仍可继续在线翻译。
  }
  const pending: TranslationItem[] = [];
  for (const item of items) {
    if (item.sourceLanguage === 'zho_Hans') {
      translations.set(item.value, item.value);
      continue;
    }
    const key = translationCacheKey(item.sourceLanguage, item.value);
    const cached = cache.get(key);
    if (cached) {
      translations.set(item.value, cached.translatedText);
      sessionEntries.set(key, cached);
    } else {
      pending.push(item);
    }
  }
  let completed = 0;
  const cacheHits = sessionEntries.size;
  onProgress(cacheHits, cacheHits + pending.length);
  try {
    for (let start = 0; start < pending.length; start += ITEMS_PER_REQUEST) {
      if (activeSignal.aborted) throw new DOMException('翻译已停止', 'AbortError');
      const batch = pending.slice(start, start + ITEMS_PER_REQUEST);
      const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: batch }), signal: activeSignal });
      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({} as TranslationResponse)) as TranslationResponse
        : {} as TranslationResponse;
      if (!response.ok) {
        if (payload.error) {
          const code = payload.error.match(/(?:错误|error)[：:\s]*(\d{5})/i)?.[1];
          if (code && SKIPPABLE_ERROR_CODES.has(code)) {
            // 批次失败时逐条重试，避免一个问题词条影响整批结果。
            for (const item of batch) {
              if (activeSignal.aborted) throw new DOMException('翻译已停止', 'AbortError');
              const singleResponse = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [item] }), signal: activeSignal });
              const singleType = singleResponse.headers.get('content-type') ?? '';
              const singlePayload = singleType.includes('application/json')
                ? await singleResponse.json().catch(() => ({} as TranslationResponse)) as TranslationResponse
                : {} as TranslationResponse;
              const singleError = singlePayload.error;
              if (!singleResponse.ok || !Array.isArray(singlePayload.results)) {
                const singleCode = singleError?.match(/(?:错误|error)[：:\s]*(\d{5})/i)?.[1];
                if (!(singleCode && SKIPPABLE_ERROR_CODES.has(singleCode))) {
                  throw new Error(singleError || `翻译接口请求失败（HTTP ${singleResponse.status}）`);
                }
                translations.set(item.value, item.value);
              } else {
                const [source, target] = singlePayload.results[0] ?? [];
                if (source && target) {
                  translations.set(source, target);
                  sessionEntries.set(translationCacheKey(item.sourceLanguage, source), { sourceLanguage: item.sourceLanguage, sourceText: source.trim(), translatedText: target });
                } else {
                  translations.set(item.value, item.value);
                }
              }
              completed += 1;
              onProgress(cacheHits + completed, cacheHits + pending.length);
            }
            continue;
          }
          throw new Error(payload.error);
        }
        throw new Error(`翻译接口请求失败（HTTP ${response.status}，返回 ${contentType || '非 JSON'}）`);
      }
      if (!Array.isArray(payload.results)) throw new Error(`翻译接口返回格式异常（HTTP ${response.status}）`);
      for (const [source, target] of payload.results) {
        const sourceLanguage = batch.find(item => item.value === source)?.sourceLanguage;
        if (!sourceLanguage) continue;
        translations.set(source, target);
        sessionEntries.set(translationCacheKey(sourceLanguage, source), { sourceLanguage, sourceText: source.trim(), translatedText: target });
      }
      completed += batch.length;
      onProgress(cacheHits + completed, cacheHits + pending.length);
    }
    return translations;
  } catch (error) {
    if (activeSignal.aborted) throw new Error('翻译已停止，已下载当前缓存 CSV');
    const message = error instanceof Error ? error.message : '翻译请求失败';
    throw new Error(`${message}；已下载当前缓存 CSV`);
  } finally {
    downloadTranslationCache([...sessionEntries.values()]);
    if (activeController === controller) activeController = null;
  }
}
