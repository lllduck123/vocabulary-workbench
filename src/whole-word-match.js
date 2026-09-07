const WORD_CHARACTERS = '\\p{L}\\p{N}\\p{M}_';
const matcherCache = new Map();

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a complete word or phrase inside text, without regard to case.
 * Unicode letters, numbers, combining marks, and underscores count as word
 * characters, so a term cannot match only part of a longer word.
 */
export function containsWholeTermIgnoreCase(text, term) {
  const candidate = String(term ?? '').trim();
  if (!candidate) return false;

  let matcher = matcherCache.get(candidate);
  if (!matcher) {
    const escaped = escapeRegularExpression(candidate);
    matcher = new RegExp(`(?:^|[^${WORD_CHARACTERS}])${escaped}(?=$|[^${WORD_CHARACTERS}])`, 'iu');
    matcherCache.set(candidate, matcher);
  }

  return matcher.test(String(text ?? ''));
}
