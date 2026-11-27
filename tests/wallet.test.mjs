import test from 'node:test';
import assert from 'node:assert/strict';
import { walletSession, observeWallet } from '../client/wallet.js';
const account = '0x1111111111111111111111111111111111111111';

test('restore reads existing authorization without requesting wallet access', async () => {
  const calls = [];
  const provider = { request: async ({ method }) => { calls.push(method); return method === 'eth_accounts' ? [account] : '0x1237'; } };
  assert.deepEqual(await walletSession(provider), { account, chain: 4663 });
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  assert.equal(await walletSession({ request: async () => [] }), null);
});

test('explicit connection requests access and rejects malformed wallet accounts', async () => {
  const calls = [];
  assert.deepEqual(await walletSession({ request: async ({ method }) => { calls.push(method); return method === 'eth_requestAccounts' ? [account] : '0x1'; } }, true), { account, chain: 1 });
  assert.equal(calls[0], 'eth_requestAccounts');
  await assert.rejects(() => walletSession({ request: async () => ['bad'] }), /valid account/);
});

test('wallet event subscriptions can all be removed when disconnecting or changing providers', () => {
  const listeners = new Map();
  const provider = { on: (k, v) => listeners.set(k, v), removeListener: (k, v) => { if (listeners.get(k) === v) listeners.delete(k); } };
  const dispose = observeWallet(provider, () => {}, () => {}, () => {});
  assert.equal(listeners.size, 3);
  dispose();
  assert.equal(listeners.size, 0);
});
