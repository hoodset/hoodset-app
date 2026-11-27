import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceBasket } from '../client/reference.js';
const S = 10n ** 18n;
const theme = { assets: ['A', 'B'], weights: [50, 50] };
const prices = { A: { ok: true, mid18: 10n * S }, B: { ok: true, mid18: 20n * S } };

test('reference chart keeps recorded quantities when prices move and after serialization', () => {
  const first = referenceBasket(theme, null, prices, 1000);
  assert.deepEqual(first.base.amounts, [String(5n * S), String(25n * S / 10n)]);
  const later = referenceBasket(theme, JSON.parse(JSON.stringify(first.base)), { ...prices, A: { ok: true, mid18: 20n * S } }, 2000);
  assert.equal(later.value, 150n * S);
  assert.deepEqual(later.base, first.base);
  assert.deepEqual(first.currentWeightsBps, [5000, 5000]);
  assert.deepEqual(later.currentWeightsBps, [6667, 3333]);
  assert.equal(later.currentWeightsBps.reduce((sum, n) => sum + n, 0), 10000);
});
test('a missing mark stops the whole reference valuation without changing the fixed set', () => {
  const first = referenceBasket(theme, null, prices, 1000);
  const later = referenceBasket(theme, first.base, { ...prices, B: { ok: false } }, 2000);
  assert.equal(later.value, null);
  assert.equal(later.currentWeightsBps, null);
  assert.deepEqual(later.base, first.base);
  assert.throws(() => referenceBasket(theme, null, { ...prices, B: { ok: false } }, 2000));
});
test('changed allocations or malformed stored quantities start a new valid reference', () => {
  const old = referenceBasket(theme, null, prices, 1000).base;
  const changed = referenceBasket({ ...theme, weights: [60, 40] }, old, prices, 2000);
  assert.equal(changed.base.at, 2000);
  assert.deepEqual(changed.base.amounts, [String(6n * S), String(2n * S)]);
  assert.equal(referenceBasket(theme, { ...old, amounts: ['-1', '0'] }, prices, 2000).base.at, 2000);
});
