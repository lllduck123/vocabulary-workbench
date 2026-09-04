export type TranslationCacheEntry = {
  sourceLanguage: string;
  sourceText: string;
  translatedText: string;
};

export function translationCacheKey(sourceLanguage: string, sourceText: string) {
  return `${sourceLanguage}\u0000${sourceText.trim().toLocaleLowerCase()}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseTranslationCache(text: string): TranslationCacheEntry[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!rows.length) return [];
  const headers = rows[0].map(value => value.trim());
  const sourceLanguageIndex = headers.indexOf('source_language');
  const sourceTextIndex = headers.indexOf('source_text');
  const translatedTextIndex = headers.indexOf('translated_text');
  if (sourceLanguageIndex < 0 || sourceTextIndex < 0 || translatedTextIndex < 0) return [];
  return rows.slice(1).flatMap(row => {
    const sourceLanguage = row[sourceLanguageIndex]?.trim();
    const sourceText = row[sourceTextIndex]?.trim();
    const translatedText = row[translatedTextIndex]?.trim();
    return sourceLanguage && sourceText && translatedText ? [{ sourceLanguage, sourceText, translatedText }] : [];
  });
}

export function serializeTranslationCache(entries: TranslationCacheEntry[]) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `\uFEFFsource_language,source_text,translated_text\r\n${entries.map(entry => [entry.sourceLanguage, entry.sourceText, entry.translatedText].map(quote).join(',')).join('\r\n')}\r\n`;
}

export async function loadTranslationCache() {
  const response = await fetch('/translation-cache/manifest.json', { cache: 'no-store' });
  if (!response.ok) return new Map<string, TranslationCacheEntry>();
  const files = await response.json().catch(() => [] as unknown);
  if (!Array.isArray(files)) return new Map<string, TranslationCacheEntry>();
  const texts = await Promise.all(files.filter((file): file is string => typeof file === 'string').map(async file => {
    const cacheResponse = await fetch(file, { cache: 'no-store' });
    return cacheResponse.ok ? cacheResponse.text() : '';
  }));
  const cache = new Map<string, TranslationCacheEntry>();
  for (const entry of texts.flatMap(parseTranslationCache)) {
    const key = translationCacheKey(entry.sourceLanguage, entry.sourceText);
    if (!cache.has(key)) cache.set(key, entry);
  }
  return cache;
}

export function downloadTranslationCache(entries: TranslationCacheEntry[]) {
  if (!entries.length) return;
  const blob = new Blob([serializeTranslationCache(entries)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = URL.createObjectURL(blob);
  link.download = `翻译缓存_${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
