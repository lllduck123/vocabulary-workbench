import assert from 'node:assert/strict';
import test from 'node:test';
import { containsWholeTermIgnoreCase } from '../src/whole-word-match.js';

test('matches complete words without regard to case', () => {
  assert.equal(containsWholeTermIgnoreCase('A RED Car.', 'car'), true);
  assert.equal(containsWholeTermIgnoreCase('car-seat', 'CAR'), true);
  assert.equal(containsWholeTermIgnoreCase('cart and scar', 'car'), false);
});

test('matches complete phrases and rejects partial words', () => {
  assert.equal(containsWholeTermIgnoreCase('The RED CAR is here', 'red car'), true);
  assert.equal(containsWholeTermIgnoreCase('infrared car', 'red car'), false);
  assert.equal(containsWholeTermIgnoreCase('red carpet', 'red car'), false);
});

test('supports Unicode words and regex punctuation', () => {
  assert.equal(containsWholeTermIgnoreCase('CAFÉ noir', 'café'), true);
  assert.equal(containsWholeTermIgnoreCase('cafétéria', 'café'), false);
  assert.equal(containsWholeTermIgnoreCase('use c++ today', 'c++'), true);
  assert.equal(containsWholeTermIgnoreCase('use c++guide today', 'c++'), false);
  assert.equal(containsWholeTermIgnoreCase('水晶 球', '水晶'), true);
  assert.equal(containsWholeTermIgnoreCase('水晶球', '水晶'), false);
});

test('does not match empty terms', () => {
  assert.equal(containsWholeTermIgnoreCase('anything', '   '), false);
});
