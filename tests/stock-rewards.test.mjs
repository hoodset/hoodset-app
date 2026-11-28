import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEther} from 'ethers';
import {REWARDS_IFACE,REWARDS_ERC,REWARDS_HSET,REWARDS_RUNTIME,rewardsAmount,rewardsSymbols,rewardsTransaction,rewardsSettlement} from '../shared/stock-rewards.js';
import {ALLOWED} from '../worker/assets.js';
import {reviewKind} from '../client/review-refresh.js';
import {createStockRewards} from '../client/stock-rewards.js';
import {checkWalletQueue,transactionKey} from '../client/transactions.js';
const account='0x1111111111111111111111111111111111111111',pool='0x2222222222222222222222222222222222222222';
const log=(address,iface,name,args)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
const receipt=logs=>({status:1,from:account,to:pool,blockNumber:123,logs});
test('Stock Rewards: exact 18-decimal amounts, balance bounds and malformed inputs',()=>{
 assert.equal(rewardsAmount('0.000000000000000001'),1n);assert.equal(rewardsAmount('100',parseEther('100')),parseEther('100'));
 for(const value of ['0','-1','1e3','1.0000000000000000001','NaN',' 1','1,000','1.'])assert.throws(()=>rewardsAmount(value));assert.throws(()=>rewardsAmount('2',1n));
});
test('Stock Rewards: canonical reward symbols are distinct and HSET never counts as a reward',()=>{
 assert.deepEqual(rewardsSymbols([ALLOWED.NVDA,ALLOWED.AMD]),['NVDA','AMD']);
 for(const rows of [[],[REWARDS_HSET],[ALLOWED.NVDA,ALLOWED.NVDA],[account]])assert.throws(()=>rewardsSymbols(rows));
});
test('Stock Rewards: all unsigned requests have zero ETH value and fixed action encoding',()=>{
 for(const kind of ['rewards.stake','rewards.withdraw','rewards.fund','rewards.claim','rewards.checkpoint']){
  const tx=rewardsTransaction({kind,pool,index:0,amount:'1'});assert.equal(tx.to,pool);assert.equal(tx.value,0n);assert.ok(REWARDS_IFACE.parseTransaction({data:tx.data}));
 }
 const approval=rewardsTransaction({kind:'rewards.approval',pool,token:REWARDS_HSET,amount:'123'});const decoded=REWARDS_ERC.parseTransaction({data:approval.data});assert.equal(decoded.args[1],123n);
 assert.throws(()=>rewardsTransaction({kind:'arbitrary',pool}));assert.throws(()=>rewardsTransaction({kind:'rewards.stake',pool,amount:'0'}));assert.throws(()=>rewardsTransaction({kind:'rewards.claim',pool,index:12}));
});
test('Stock Rewards: stakes require both the exact accounting event and actual HSET transfer',()=>{
 const r={kind:'rewards.stake',pool,account,amount:'10',token:REWARDS_HSET};
 const logs=[log(pool,REWARDS_IFACE,'Staked',[account,10]),log(REWARDS_HSET,REWARDS_ERC,'Transfer',[account,pool,10])];assert.equal(rewardsSettlement(receipt(logs),r).amount,'10');
 assert.throws(()=>rewardsSettlement(receipt(logs.slice(0,1)),r));assert.throws(()=>rewardsSettlement(receipt([...logs.slice(0,1),log(REWARDS_HSET,REWARDS_ERC,'Transfer',[account,pool,9])]),r));assert.throws(()=>rewardsSettlement({...receipt(logs),from:pool},r));
});
test('Stock Rewards: funded rewards must match the selected stock and exact input',()=>{
 const r={kind:'rewards.fund',pool,account,index:0,amount:'11',token:ALLOWED.NVDA};
 const logs=[log(pool,REWARDS_IFACE,'RewardsFunded',[account,ALLOWED.NVDA,11,true]),log(ALLOWED.NVDA,REWARDS_ERC,'Transfer',[account,pool,11])];assert.equal(rewardsSettlement(receipt(logs),r).amount,'11');
 assert.throws(()=>rewardsSettlement(receipt(logs),{...r,token:ALLOWED.AMD}));assert.throws(()=>rewardsSettlement(receipt(logs),{...r,amount:'12'}));
});
test('Stock Rewards: claims verify actual payout, never reuse a stale estimated amount',()=>{
 const r={kind:'rewards.claim',pool,account,index:0,token:ALLOWED.AMD};const logs=[log(pool,REWARDS_IFACE,'RewardsClaimed',[account,ALLOWED.AMD,21]),log(ALLOWED.AMD,REWARDS_ERC,'Transfer',[pool,account,21])];assert.equal(rewardsSettlement(receipt(logs),r).amount,'21');assert.throws(()=>rewardsSettlement(receipt(logs.slice(0,1)),r));
});
test('Stock Rewards: approval receipt and request target are pinned',()=>{
 const r={kind:'rewards.approval',pool,account,token:REWARDS_HSET,amount:'42'};const logs=[log(REWARDS_HSET,REWARDS_ERC,'Approval',[account,pool,42])];assert.equal(rewardsSettlement({...receipt(logs),to:REWARDS_HSET},r).amount,'42');assert.throws(()=>rewardsSettlement(receipt(logs),r));
});
test('Stock Rewards: refresh re-simulates, while a submitted review can never be refreshed',()=>{
 assert.equal(reviewKind({recovery:{kind:'rewards.stake'}}),'simulation');assert.throws(()=>reviewKind({sentHash:'0x123',recovery:{kind:'rewards.stake'}}));assert.match(REWARDS_RUNTIME,/^0x[a-f0-9]{64}$/);
});
function controller({durable=true}={}){
 let disk=null;const saved={activity:[]},state={account,session:1};
 const c=createStockRewards({state,saved,save:()=>{if(durable)disk=JSON.stringify(saved);},storage:{getItem:()=>disk},storageKey:'test',render(){},notify(){}});
 return {c,state,saved};
}
test('Stock Rewards: an account change between preparation and wallet review blocks before any RPC/send',async()=>{
 const {c,state}=controller();const r={kind:'rewards.stake',pool,account,token:REWARDS_HSET,amount:'1'};
 await assert.rejects(()=>c.beforeSend({account:pool,recovery:r}),/wallet changed/);state.account=pool;await assert.rejects(()=>c.beforeSend({account,recovery:r}),/wallet changed/);
});
test('Stock Rewards: unknown outcomes survive timeout; only explicit rejection clears the intent',()=>{
 const {c,saved}=controller(),recovery={kind:'rewards.stake',pool,account,token:REWARDS_HSET,amount:'1'},tx=rewardsTransaction(recovery),review={account,tx,recovery,operationKey:transactionKey(tx),label:'Stake'};
 c.sending(review);assert.ok(c.intent());c.rejected(review,{code:'TIMEOUT'},true,true);assert.ok(c.intent());assert.throws(()=>c.noUnknown(account));c.rejected(review,{code:4001},true,true);assert.equal(c.intent(),null);assert.equal(Object.keys(saved.rewardsIntents).length,0);
});
test('Stock Rewards: non-durable intent storage refuses wallet sending; saved hash precedes intent deletion',()=>{
 const r={kind:'rewards.stake',pool,account,token:REWARDS_HSET,amount:'1'},tx=rewardsTransaction(r),review={account,tx,recovery:r,operationKey:transactionKey(tx),label:'Stake'};
 const bad=controller({durable:false});assert.throws(()=>bad.c.sending(review),/save rewards progress/);assert.equal(bad.c.intent(),null);
 const {c,saved}=controller();c.sending(review);const row={account,recovery:r,operationKey:review.operationKey,label:'Stake',hash:'0x'+'1'.repeat(64)};assert.throws(()=>c.submitted(row),/progress was not saved/);assert.ok(c.intent());saved.activity.push(row);c.submitted(row);assert.equal(c.intent(),null);
});
test('Stock Rewards: generic pending transactions cannot bypass the send queue with undefined run ID',async()=>{
 const pending=[{account,status:'Submitted',hash:'0x123',recovery:{kind:'rewards.stake'}}];
 await assert.rejects(()=>checkWalletQueue(pending,[],account,undefined,async()=>null),/still pending/);
 await assert.rejects(()=>checkWalletQueue(pending,[],account,'stock-rewards',async()=>null),/still pending/);
 await checkWalletQueue(pending,[],account,undefined,async()=>({status:1}));
});
