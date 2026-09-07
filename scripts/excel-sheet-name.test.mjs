import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSheetName } from '../src/excel-sheet-name.js';

test('removes the full-width colon that caused Excel repair prompts', () => {
  assert.equal(cleanSheetName('Kristall（译文：水晶）', new Set()), 'Kristall（译文 水晶）');
});

test('removes ASCII and full-width Excel-reserved characters', () => {
  assert.equal(cleanSheetName('a:b/c\\d?e*f[g]：／＼？＊［］', new Set()), 'a b c d e f g');
});

test('deduplicates worksheet names case-insensitively', () => {
  const used = new Set(['Sheet']);
  assert.equal(cleanSheetName('sheet', used), 'sheet_2');
});

test('keeps names within 31 Unicode characters without splitting emoji', () => {
  const result = cleanSheetName(`${'a'.repeat(30)}😀x`, new Set());
  assert.equal(Array.from(result).length, 31);
  assert.equal(result.endsWith('😀'), true);
});

test('falls back to a valid name when the input contains only invalid characters', () => {
  assert.equal(cleanSheetName('：/?*[]', new Set()), '未命名');
});
