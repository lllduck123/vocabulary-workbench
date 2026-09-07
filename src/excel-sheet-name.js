const INVALID_SHEET_NAME_CHARACTERS = /[\u0000-\u001f\\/?*\[\]:：／＼？＊［］]/g;

function sheetNameKey(name) {
  return name.normalize('NFKC').toLocaleLowerCase();
}

function truncateSheetName(name, maxLength) {
  return Array.from(name).slice(0, maxLength).join('');
}

/**
 * Return an Excel-compatible, workbook-unique worksheet name.
 * Excel rejects both ASCII and full-width variants of its reserved characters.
 *
 * @param {string} name
 * @param {Set<string>} used
 */
export function cleanSheetName(name, used) {
  let base = name
    .replace(INVALID_SHEET_NAME_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '');
  base = truncateSheetName(base, 31).trim().replace(/^'+|'+$/g, '') || '未命名';

  const usedKeys = new Set([...used].map(sheetNameKey));
  let out = base;
  let suffixNumber = 2;
  while (usedKeys.has(sheetNameKey(out))) {
    const suffix = `_${suffixNumber++}`;
    out = truncateSheetName(base, 31 - suffix.length) + suffix;
  }

  used.add(out);
  return out;
}
