export type TranslationLanguage = 'zho_Hans' | 'eng_Latn' | 'deu_Latn' | 'fra_Latn';
export type NonChineseTranslationLanguage = Exclude<TranslationLanguage, 'zho_Hans'>;
export type TranslationSourceLanguage = 'auto' | NonChineseTranslationLanguage;

type TranslationLanguageDetection = { language: TranslationLanguage; confident: boolean };

const LANGUAGE_SIGNAL_WORDS: Record<NonChineseTranslationLanguage, Set<string>> = {
  eng_Latn: new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'from', 'without', 'of', 'to', 'in', 'on', 'is', 'are', 'this', 'that', 'these', 'those', 'my', 'your']),
  deu_Latn: new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'und', 'oder', 'aber', 'für', 'mit', 'von', 'auf', 'aus', 'bei', 'ohne', 'über', 'unter', 'im', 'zum', 'zur', 'ist', 'sind', 'nicht', 'mein', 'dein']),
  fra_Latn: new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', 'de', 'et', 'ou', 'mais', 'dans', 'en', 'par', 'pour', 'sans', 'sous', 'sur', 'avec', 'est', 'sont', 'mon', 'ton', 'notre', 'votre']),
};

const LANGUAGE_STRONG_WORDS: Record<NonChineseTranslationLanguage, Set<string>> = {
  eng_Latn: new Set(['shirt', 'tshirt', 'tea', 'coffee', 'cup', 'mug', 'gift', 'calendar', 'christmas', 'black', 'white', 'green', 'blue', 'red', 'large', 'small', 'men', 'women', 'kids', 'boys', 'girls']),
  deu_Latn: new Set(['kaffee', 'tasse', 'becher', 'geschenk', 'kalender', 'weihnachten', 'schwarz', 'weiß', 'grün', 'blau', 'rot', 'groß', 'klein', 'damen', 'herren', 'kinder', 'jungen', 'mädchen']),
  fra_Latn: new Set(['café', 'thé', 'tasse', 'cadeau', 'calendrier', 'noël', 'noir', 'blanc', 'verte', 'vert', 'bleu', 'rouge', 'grand', 'petit', 'hommes', 'femmes', 'enfants']),
};

const GERMAN_COMPOUND_PARTS = ['kaffee', 'tasse', 'becher', 'geschenk', 'kalender', 'weihnacht', 'kinder', 'damen', 'herren'];

export const TRANSLATION_LANGUAGE_NAMES: Record<NonChineseTranslationLanguage, string> = { eng_Latn: '英语', deu_Latn: '德语', fra_Latn: '法语' };

export function detectTranslationLanguage(value: string): TranslationLanguageDetection {
  const compact = value.replace(/\s/g, '');
  const chinese = (compact.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chinese && chinese >= compact.length * 0.35) return { language: 'zho_Hans', confident: true };
  const words = value.toLocaleLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? [];
  const scores: Record<NonChineseTranslationLanguage, number> = { eng_Latn: 0, deu_Latn: 0, fra_Latn: 0 };
  (Object.keys(scores) as NonChineseTranslationLanguage[]).forEach(language => {
    words.forEach(word => {
      if (LANGUAGE_SIGNAL_WORDS[language].has(word)) scores[language] += 1;
      if (LANGUAGE_STRONG_WORDS[language].has(word)) scores[language] += 2;
    });
  });
  if (/[äöüß]/i.test(value)) scores.deu_Latn += 4;
  if (/[àâçéèêëîïôûùÿœ]/i.test(value)) scores.fra_Latn += 3;
  words.forEach(word => {
    if (GERMAN_COMPOUND_PARTS.some(part => word.length > part.length && word.includes(part))) scores.deu_Latn += 2;
    if (/(ung|keit|heit|schaft|chen|lein|zeug|schutz)$/i.test(word)) scores.deu_Latn += 1;
    if (/(ing|ness|less|tion|ment|able|ful)$/i.test(word)) scores.eng_Latn += 1;
    if (/(ique|eux|euse|ette|aux|eau)$/i.test(word)) scores.fra_Latn += 1;
  });
  const ranked = (Object.entries(scores) as Array<[NonChineseTranslationLanguage, number]>).sort((left, right) => right[1] - left[1]);
  const [bestLanguage, bestScore] = ranked[0];
  const secondScore = ranked[1][1];
  return { language: bestLanguage, confident: bestScore >= 2 && bestScore > secondScore };
}

export function detectDominantTranslationLanguage(values: string[]): NonChineseTranslationLanguage {
  const counts: Record<NonChineseTranslationLanguage, number> = { eng_Latn: 0, deu_Latn: 0, fra_Latn: 0 };
  values.forEach(value => {
    const detected = detectTranslationLanguage(value);
    if (detected.confident && detected.language !== 'zho_Hans') counts[detected.language] += 1;
  });
  return (Object.entries(counts) as Array<[NonChineseTranslationLanguage, number]>).sort((left, right) => right[1] - left[1])[0][0];
}

export function resolveTranslationLanguage(value: string, sourceLanguage: TranslationSourceLanguage, automaticFallback: NonChineseTranslationLanguage = 'eng_Latn'): TranslationLanguage {
  const detected = detectTranslationLanguage(value);
  if (detected.language === 'zho_Hans') return detected.language;
  if (sourceLanguage !== 'auto') return sourceLanguage;
  return detected.confident ? detected.language : automaticFallback;
}
