import { Interface } from 'ethers';
import { ALLOWED, USDG } from '../worker/assets.js';

export const OPENOCEAN_ROUTER = '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64';
// Pin the executor observed in this release; a provider change needs a new review.
export const OPENOCEAN_CALLER = '0x018fEADD83a8f2ad4d2508469a3a3215483C4377';
export const OPENOCEAN_ABI = ['function swap(address caller,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 guaranteedAmount,uint256 flags,address referrer,bytes permit) desc,(uint256 target,uint256 gasLimit,uint256 value,bytes data)[] calls) payable returns(uint256 returnAmount)'];
export const openOceanInterface = new Interface(OPENOCEAN_ABI);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const uint = value => {
  if (!/^[1-9][0-9]{0,76}$/.test(String(value)) || BigInt(value) >= 2n ** 256n) throw Error('Invalid positive token amount.');
  return BigInt(value);
};

export function openOceanInput(input) {
  if (!input || !ADDRESS.test(input.taker || '') || BigInt(input.taker) === 0n) throw Error('Connect a valid RH wallet.');
  if (!Object.hasOwn(ALLOWED, input.symbol)) throw Error('Asset is not in the canonical allowlist.');
  if (!['buy', 'sell'].includes(input.side)) throw Error('Choose buy or sell.');
  uint(input.amount);
  const slippageBps = Number(input.slippageBps ?? 100);
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 300) throw Error('Slippage must be from 0.10% to 3%.');
  return { chainId: 4663, taker: input.taker.toLowerCase(), symbol: input.symbol, side: input.side, sellToken: input.side === 'buy' ? USDG : ALLOWED[input.symbol], buyToken: input.side === 'buy' ? ALLOWED[input.symbol] : USDG, sellDecimals: input.side === 'buy' ? 6 : 18, buyDecimals: input.side === 'buy' ? 18 : 6, sellAmount: String(input.amount), slippageBps };
}

export function validateOpenOcean(result, params, now = Date.now()) {
  if (result?.code !== 200 || !result.data) throw Error(result?.message || result?.error || 'No executable OpenOcean route.');
  const d = result.data;
  if (Number(d.chainId) !== 4663 || !same(d.to, OPENOCEAN_ROUTER) || !same(d.from, params.taker)) throw Error('Swap chain, router or sender mismatch.');
  if (!same(d.inToken?.address, params.sellToken) || !same(d.outToken?.address, params.buyToken) || d.inToken.decimals !== params.sellDecimals || d.outToken.decimals !== params.buyDecimals) throw Error('Swap asset or decimals mismatch.');
  if (uint(d.inAmount) !== BigInt(params.sellAmount) || BigInt(d.value ?? 0) !== 0n) throw Error('Swap spending amount mismatch.');
  const grossOutput = uint(d.outAmount), minOutput = uint(d.minOutAmount);
  // Public fees can be up to 0.5%; the minimum must still respect the user's slippage budget.
  if (minOutput > grossOutput || minOutput < grossOutput * BigInt(10000 - params.slippageBps - 50) / 10000n) throw Error('Minimum output exceeds the allowed fee/slippage bounds.');
  const impact = String(d.price_impact ?? '');
  if (!/^[+-]?[0-9]+(?:\.[0-9]+)?%$/.test(impact) || Math.abs(Number(impact.slice(0, -1))) > 5) throw Error('Price impact is unavailable or exceeds 5%. Reduce the trade size.');
  if (!/^0x(?:[0-9a-fA-F]{2}){4,50000}$/.test(d.data || '')) throw Error('Invalid swap calldata.');
  let decoded;
  try { decoded = openOceanInterface.decodeFunctionData('swap', d.data); } catch { throw Error('Unrecognized swap function.'); }
  const desc = decoded.desc;
  if (!same(decoded.caller, OPENOCEAN_CALLER) || !same(desc.srcReceiver, OPENOCEAN_CALLER)) throw Error('Unrecognized OpenOcean executor.');
  if (!same(desc.srcToken, params.sellToken) || !same(desc.dstToken, params.buyToken) || desc.amount !== BigInt(params.sellAmount)) throw Error('Encoded token or spending amount mismatch.');
  if (!same(desc.dstReceiver, params.taker) && BigInt(desc.dstReceiver) !== 0n) throw Error('Encoded recipient mismatch.');
  if (desc.minReturnAmount !== minOutput || desc.flags !== 2n || desc.permit !== '0x') throw Error('Encoded minimum, flags or permit mismatch.');
  if (!decoded.calls.length || decoded.calls.length > 64 || decoded.calls.some(call => call.value !== 0n)) throw Error('Unsupported executor calls.');
  const deadline = Number(d.rfqDeadline || 0);
  if (!Number.isSafeInteger(deadline) || deadline < 0) throw Error('Invalid quote deadline.');
  const expiresAt = Math.min(now + 30000, deadline ? deadline * 1000 - 2000 : Infinity);
  if (expiresAt <= now + 3000) throw Error('Quote already expired. Request a fresh route.');
  return { provider: 'OpenOcean', chainId: 4663, taker: params.taker, recipient: params.taker, symbol: params.symbol, side: params.side, sellToken: params.sellToken, buyToken: params.buyToken, sellAmount: params.sellAmount, spendingCap: params.sellAmount, grossBuyAmount: String(grossOutput), minBuyAmount: String(minOutput), approvalSpender: OPENOCEAN_ROUTER, transaction: { to: OPENOCEAN_ROUTER, data: d.data, value: '0' }, priceImpact: impact, maxProviderFeeBps: 50, slippageBps: params.slippageBps, requestedAt: now, expiresAt };
}

export function reviewOpenOcean(q, input, now = Date.now()) {
  const p = openOceanInput(input);
  if (!q || !Number.isSafeInteger(q.requestedAt) || !Number.isSafeInteger(q.expiresAt) || !same(q.recipient,p.taker) || q.provider !== 'OpenOcean' || q.expiresAt <= now || q.expiresAt > q.requestedAt + 30000 || q.requestedAt > now + 1000 || !same(q.approvalSpender, OPENOCEAN_ROUTER) || String(q.spendingCap) !== p.sellAmount || q.symbol !== p.symbol || q.side !== p.side || q.slippageBps !== p.slippageBps) throw Error('Request a fresh quote for this wallet and amount.');
  validateOpenOcean({ code: 200, data: { chainId: q.chainId, from: q.taker, to: q.transaction?.to, inToken: { address: q.sellToken, decimals: p.sellDecimals }, outToken: { address: q.buyToken, decimals: p.buyDecimals }, inAmount: q.sellAmount, outAmount: q.grossBuyAmount, minOutAmount: q.minBuyAmount, value: q.transaction?.value, data: q.transaction?.data, price_impact: q.priceImpact } }, p, now);
  return q;
}
