import { initialAmounts, completeValue } from './finance.js';

export function currentWeights(symbols, amounts, prices) {
  const total = completeValue(symbols, amounts, prices);
  if (total === null || total <= 0n) return null;
  const numerators = symbols.map((s, i) => BigInt(amounts[i]) * prices[s].mid18 / (10n ** 18n) * 10000n);
  const rounded = numerators.map(n => Number(n / total));
  const order = numerators.map((n, i) => ({ i, remainder: n % total }))
    .sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.i - b.i);
  const missing = 10000 - rounded.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < missing; i++) rounded[order[i].i]++;
  return rounded;
}

// A reference template is an observed fixed set, never an issued basket share.
export function referenceBasket(theme, stored, prices, now = Date.now()) {
  const signature = JSON.stringify([theme.assets, theme.weights]);
  let base = stored;
  try {
    if (base?.signature !== signature || !Number.isFinite(base.at) || base.at > now ||
        !Array.isArray(base.amounts) || base.amounts.length !== theme.assets.length ||
        !base.amounts.every(a => /^\d+$/.test(a) && BigInt(a) > 0n && BigInt(a) < 2n ** 256n)) base = null;
  } catch { base = null; }
  if (!base) {
    const seed = initialAmounts(theme.assets.map((symbol, i) => ({ symbol, weight: String(theme.weights[i]) })), prices);
    base = { signature, amounts: seed.amounts.map(String), at: now };
  }
  return { base, value: completeValue(theme.assets, base.amounts, prices), currentWeightsBps: currentWeights(theme.assets, base.amounts, prices) };
}
