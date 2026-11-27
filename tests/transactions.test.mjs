import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionKey, checkPending, reconcileActivity, checkWalletQueue } from '../client/transactions.js';

test('a broadcast without a receipt blocks the same operation across a reload', async () => {
  const key = transactionKey({ to: '0xABCD', data: '0x12345678', value: 0 });
  const rows = JSON.parse(JSON.stringify([{ account: 'owner', operationKey: key, status: 'Submitted', hash: '0xpending' }]));
  await assert.rejects(() => checkPending(rows, 'owner', key, async () => null), /already submitted/);
  assert.equal(rows[0].status, 'Submitted');
});

test('actual included and reverted receipts resolve pending status', async () => {
  for (const status of [0, 1]) {
    const rows = [{ account: 'owner', operationKey: 'key', status: 'Submitted', hash: '0xhash' }];
    await checkPending(rows, 'owner', 'key', async () => ({ status }));
    assert.equal(rows[0].status, status ? 'Included in RH block' : 'Reverted');
  }
});

test('the pending guard is bound to account, calldata, target and native value', async () => {
  const tx = { to: '0xABCD', data: '0x12345678', value: 0 };
  assert.notEqual(transactionKey(tx), transactionKey({ ...tx, value: 1 }));
  assert.notEqual(transactionKey(tx), transactionKey({ ...tx, data: '0x12345679' }));
  assert.notEqual(transactionKey(tx), transactionKey({ ...tx, to: '0xDCBA' }));
  const rows = [{ account: 'other', operationKey: transactionKey(tx), status: 'Submitted', hash: '0xhash' }];
  await checkPending(rows, 'owner', transactionKey(tx), async () => { throw Error('Must not read another account'); });
});

test('reload recovery waits for actual receipts, isolates errors and does not process other wallets', async () => {
  const rows = ['pending', 'done', 'revert', 'wrong'].map(hash => ({ hash, account: 'owner', target: 'router', status: 'Submitted' }));
  rows.push({ hash: 'other', account: 'other', status: 'Submitted' });
  const recovered = [];
  const errors = await reconcileActivity(rows, 'owner', async hash => hash === 'pending' ? null : { hash, from: hash === 'wrong' ? 'attacker' : 'owner', to: 'router', status: hash === 'revert' ? 0 : 1, blockNumber: 42 }, async row => recovered.push(row.hash));
  assert.deepEqual(recovered, ['done']);
  assert.equal(rows[0].status, 'Submitted');
  assert.equal(rows[1].recoveryComplete, true);
  assert.equal(rows[2].status, 'Reverted');
  assert.equal(rows[3].status, 'Submitted');
  assert.equal(rows[4].status, 'Submitted');
  assert.equal(errors.length, 1);
});

test('failed settlement recovery retries without resending or marking it verified', async () => {
  const row = { hash: 'hash', account: 'owner', status: 'Submitted' };
  const receipt = { hash: 'hash', from: 'owner', status: 1 };
  await reconcileActivity([row], 'owner', async () => receipt, async () => { throw Error('RPC unavailable'); });
  assert.equal(row.status, 'Included in RH block');
  assert.equal(row.recoveryComplete, undefined);
  await reconcileActivity([row], 'owner', async () => receipt, async () => {});
  assert.equal(row.recoveryComplete, true);
  assert.equal(row.recoveryError, undefined);
});


test('basket operations wait for other wallet broadcasts and unknown run outcomes', async()=>{
 const plans=[{id:'buy',account:'owner',intent:{}}];
 await assert.rejects(()=>checkWalletQueue([],plans,'owner','sale',async()=>null),/unknown wallet outcome/);
 await assert.rejects(()=>checkWalletQueue([{account:'owner',status:'Submitted',hash:'pending'}],[],'owner','sale',async()=>null),/still pending/);
 await checkWalletQueue([{account:'owner',status:'Submitted',hash:'done'}],[],'owner','sale',async()=>({status:1}));
 await checkWalletQueue([],plans,'owner','buy',async()=>null);
 await checkWalletQueue([],plans,'another','sale',async()=>null);
});
