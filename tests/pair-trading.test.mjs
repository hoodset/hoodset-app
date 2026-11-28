import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import {openOceanPairInput,validateOpenOceanPair,reviewOpenOceanPair} from '../shared/openocean-pair.js';
import {openOceanInterface,OPENOCEAN_ROUTER} from '../shared/openocean.js';
import {createPairTrading,pairStamp,PAIR_PREVIEW_ACCOUNT} from '../client/pair-trading.js';
import {transactionKey} from '../client/transactions.js';
import {reviewKind} from '../client/review-refresh.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/openocean-pair.json',import.meta.url))),S=10n**18n,account=PAIR_PREVIEW_ACCOUNT;
const now=Date.parse(fixture.observedAt),references=at=>({NVDA:{at:new Date(at).toISOString(),bid18:String(149n*S),ask18:String(151n*S)},AMD:{at:new Date(at).toISOString(),bid18:String(427n*S),ask18:String(431n*S)}});
const input=(at=now)=>({sellSymbol:'NVDA',buySymbol:'AMD',taker:account,amount:fixture.request.amount,slippageBps:100,references:references(at)});
const raw=()=>({...structuredClone(fixture.result),data:{...structuredClone(fixture.result.data),rfqDeadline:0}});
test('a real observed NVDA/AMD route decodes through the same bounded spot executor checks',()=>{
  const p=openOceanPairInput(input(),now),q=validateOpenOceanPair(raw(),p,now);assert.equal(q.kind,'spot-pair');assert.equal(q.side,'pair');assert.equal(q.sellSymbol,'NVDA');assert.equal(q.buySymbol,'AMD');assert.equal(q.spendingCap,fixture.request.amount);assert.ok(BigInt(q.minBuyAmount)>0n);assert.doesNotThrow(()=>reviewOpenOceanPair(q,input(),now+1000));assert.equal(reviewKind({recovery:{kind:'pair.swap'}}),'pair');
});
test('pair inputs require owned-direction canonical tokens, exact positive spend and two fresh references',()=>{
  for(const patch of [{sellSymbol:'FAKE'},{buySymbol:'NVDA'},{amount:'0'},{amount:'-1'},{slippageBps:301},{taker:'0x0000000000000000000000000000000000000000'},{references:{NVDA:references(now).NVDA}},{references:references(now-120001)}])assert.throws(()=>openOceanPairInput({...input(),...patch},now));
});
test('pair payload mutations cannot alter wallet, router, assets, spend, recipient, minimum or flags',()=>{
  const p=openOceanPairInput(input(),now),q=validateOpenOceanPair(raw(),p,now);
  for(const patch of [{chainId:1},{to:'0x0000000000000000000000000000000000000001'},{from:'0x0000000000000000000000000000000000000001'},{inAmount:'1'},{value:'1'}]){const r=raw();Object.assign(r.data,patch);assert.throws(()=>validateOpenOceanPair(r,p,now));}
  for(const [index,value] of [[3,'0x0000000000000000000000000000000000000001'],[4,1n],[5,1n],[7,0n],[9,'0x11']]){
    const r=raw(),decoded=openOceanInterface.decodeFunctionData('swap',r.data.data),desc=[...decoded.desc];desc[index]=value;r.data.data=openOceanInterface.encodeFunctionData('swap',[decoded.caller,desc,decoded.calls.map(c=>[...c])]);assert.throws(()=>validateOpenOceanPair(r,p,now));
  }
  for(const patch of [{expiresAt:now},{spendingCap:'1'},{sellSymbol:'AMD'},{buySymbol:'NVDA'},{priceImpact:'5.01%'},{referenceDeviation:'0%'}])assert.throws(()=>reviewOpenOceanPair({...q,...patch},input(),now+1000));
});
test('both RH reference deviation and provider impact guard pair execution, including missing impact',()=>{
  const p=openOceanPairInput(input(),now),r=raw();delete r.data.price_impact;const q=validateOpenOceanPair(r,p,now);assert.equal(q.priceImpactSource,'RH pair reference deviation');assert.doesNotThrow(()=>reviewOpenOceanPair(q,input(),now+1000));
  r.data.price_impact='0%';const bad={...p,pairReferences:{...p.pairReferences,AMD:{...p.pairReferences.AMD,bid18:String(100n*S),ask18:String(101n*S)}}};assert.throws(()=>validateOpenOceanPair(r,bad,now),/5%/);
  r.data.price_impact='5.01%';assert.throws(()=>validateOpenOceanPair(r,p,now));
});
function desk(options={}){
  const at=Date.now(),refs=references(at),prices=Object.fromEntries(Object.entries(refs).map(([s,p])=>[s,{ok:true,at:p.at,bid18:BigInt(p.bid18),ask18:BigInt(p.ask18),mid18:(BigInt(p.bid18)+BigInt(p.ask18))/2n}]));
  const state={account,session:1,chain:4663,balanceComplete:true,balances:{NVDA:options.balance??S},prices},saved={activity:[],lastSwap:{untouched:true}},memory=new Map(),reviews=[],approvals=[],notices=[];
  const model={sellSymbol:'NVDA',buySymbol:'AMD',amount:'0.01',slippageBps:100};let allowance=options.allowance??S,lastQuote;
  const txs=new Map(),receipts=new Map();const reader={getCode:async()=> '0x6000',getTransaction:async h=>txs.get(h),getTransactionReceipt:async h=>receipts.get(h)||null,getBlock:async()=>({timestamp:Math.floor(Date.now()/1000)})};
  const deps={state,saved,input:()=>model,active:()=>true,esc:s=>String(s),otherQueue:()=>[],reader:()=>reader,refreshMarks:async()=>{},loadBalances:async()=>{},assertWallet:async expected=>{if(expected&&expected!==state.account)throw Error('wallet changed');return state.account;},token:()=>({balanceOf:async()=>state.balances.NVDA,allowance:async()=>allowance}),approveToken:async(...args)=>approvals.push(args),transactionReview:async(label,tx,details,cb,expiresAt,recovery)=>reviews.push({label,tx,details,onIncluded:cb,expiresAt,recovery,account:state.account,session:state.session,operationKey:transactionKey(tx)}),fetchQuote:async p=>{if(options.changeSession)state.session++;lastQuote=validateOpenOceanPair(raw(),p,Date.now());return lastQuote;},save:()=>{if(!options.storageFails)memory.set('test',JSON.stringify(saved));},render:()=>{},notify:s=>notices.push(s),storageKey:'test',storage:{getItem:k=>memory.get(k)||null},recoveryHash:()=>options.hash||''};
  return {ui:createPairTrading(deps),deps,state,saved,model,reviews,approvals,notices,txs,receipts,lastQuote:()=>lastQuote,setAllowance:n=>allowance=n};
}
test('public pair preview opens no wallet review, approval or transaction',async()=>{
  const t=desk();await t.ui.action('pairs-preview',{});assert.equal(t.reviews.length,0);assert.equal(t.approvals.length,0);assert.equal(t.ui.quote().preview,true);assert.equal(t.saved.activity.length,0);
});
test('wallet exchange checks input balance, uses exact approval, then creates a fresh bounded review',async()=>{
  const empty=desk({balance:0n});await empty.ui.action('pairs-prepare',{});assert.equal(empty.reviews.length,0);assert.equal(empty.approvals.length,0);assert.match(empty.ui.error(),/does not hold/);
  const t=desk({allowance:0n});await t.ui.action('pairs-prepare',{});assert.equal(t.approvals.length,1);assert.deepEqual(t.approvals[0].slice(0,3),['NVDA',OPENOCEAN_ROUTER,fixture.request.amount]);assert.equal(t.reviews.length,0);
  t.setAllowance(S);await t.ui.action('pairs-prepare',{});assert.equal(t.reviews.length,1);assert.equal(t.reviews[0].tx.value,0n);assert.equal(t.reviews[0].recovery.kind,'pair.swap');await assert.doesNotReject(t.ui.beforeSend(t.reviews[0]));assert.deepEqual(t.saved.lastSwap,{untouched:true});
});
test('input changes, stale references, pending transactions and wallet changes block pair sends',async()=>{
  const t=desk();await t.ui.action('pairs-prepare',{});const r=t.reviews[0];t.model.amount='0.02';await assert.rejects(t.ui.beforeSend(r),/inputs changed/);
  t.model.amount='0.01';t.state.prices.AMD.ok=false;await assert.rejects(t.ui.beforeSend(r),/fresh/);
  const pending=desk();pending.saved.activity=[{account,status:'Submitted',hash:'pending'}];await pending.ui.action('pairs-prepare',{});assert.equal(pending.reviews.length,0);assert.match(pending.ui.error(),/pending/);
  const changed=desk({changeSession:true});await changed.ui.action('pairs-prepare',{});assert.equal(changed.reviews.length,0);assert.match(changed.ui.error(),/changed/);
});
test('unknown wallet outcomes persist per address, block another send and clear only on definite rejection',async()=>{
  const t=desk();await t.ui.action('pairs-prepare',{});const r=t.reviews[0];t.ui.sending(r);assert.ok(t.ui.intent());assert.throws(()=>t.ui.noUnknown(),/Recover/);
  t.ui.rejected(r,Error('provider disconnected'),true,true);assert.ok(t.ui.intent());
  t.ui.rejected(r,{code:4001},true,true);assert.equal(t.ui.intent(),null);
  t.ui.sending(r);const row={label:r.label,operationKey:r.operationKey,account:r.account,target:r.tx.to,recovery:r.recovery,hash:'0x'+'1'.repeat(64),status:'Submitted'};t.saved.activity.push(row);t.ui.submitted(row);assert.equal(t.ui.intent(),null);assert.ok(t.saved.activity.some(x=>x.hash===row.hash));
});
test('pair send is refused before wallet access if its intent cannot be persisted',async()=>{
  const o={},t=desk(o);await t.ui.action('pairs-prepare',{});o.storageFails=true;assert.throws(()=>t.ui.sending(t.reviews[0]),/saved/);assert.equal(t.ui.intent(),null);
});
test('confirmed pair receipts reconcile actual token movements without replacing the USDG swap journal',async()=>{
  const t=desk();await t.ui.action('pairs-prepare',{});const r=t.reviews[0],q=r.recovery.quote,hash='0x'+'2'.repeat(64),event=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const transfer=(address,from,to,n)=>({address,...event.encodeEventLog(event.getEvent('Transfer'),[from,to,n])});
  const receipt={hash,from:account,to:OPENOCEAN_ROUTER,status:1,blockNumber:123,logs:[transfer(q.sellToken,account,OPENOCEAN_ROUTER,BigInt(q.sellAmount)),transfer(q.buyToken,OPENOCEAN_ROUTER,account,BigInt(q.grossBuyAmount))]};
  t.txs.set(hash,{...r.tx,from:account,hash});const row={...r,hash};await t.ui.recover(row,receipt);assert.equal(row.pairTrade.sellSymbol,'NVDA');assert.equal(row.pairTrade.buySymbol,'AMD');assert.equal(row.pairTrade.buyAmount,q.grossBuyAmount);assert.deepEqual(t.saved.lastSwap,{untouched:true});
  await assert.rejects(t.ui.recover(row,{...receipt,to:account}));await assert.rejects(t.ui.recover(row,{...receipt,logs:[]}));
});
test('unknown pair request recovery verifies the hash and preserves the existing journal row',async()=>{
  const hash='0x'+'3'.repeat(64),o={hash},t=desk(o);await t.ui.action('pairs-prepare',{});const r=t.reviews[0];t.ui.sending(r);
  t.txs.set(hash,{...r.tx,hash,from:account,nonce:7,blockNumber:null});
  const row={label:r.label,operationKey:r.operationKey,hash,account,target:r.tx.to,recovery:r.recovery,at:Date.now(),status:'Submitted'};t.saved.activity.push(row);
  await t.ui.action('pairs-recover',{});assert.equal(t.ui.intent(),null);assert.equal(t.saved.activity.length,1);assert.equal(t.saved.activity[0],row);
  const other=desk(o);await other.ui.action('pairs-prepare',{});other.ui.sending(other.reviews[0]);other.txs.set(hash,{...r.tx,hash,from:'0x0000000000000000000000000000000000000001',blockNumber:null});await other.ui.action('pairs-recover',{});assert.ok(other.ui.intent());assert.match(other.ui.error(),/does not match/);
});
test('refreshing a pair review fetches a new wallet quote and refuses changed inputs',async()=>{
  const t=desk();let calls=0;const original=t.deps.fetchQuote;t.deps.fetchQuote=async p=>{calls++;return original(p);};
  await t.ui.action('pairs-prepare',{});await t.ui.refreshReview(t.reviews[0].recovery);assert.equal(calls,2);assert.equal(t.reviews.length,2);
  t.model.amount='0.02';await assert.rejects(t.ui.refreshReview(t.reviews[0].recovery),/inputs changed/);assert.equal(calls,2);
});
test('a price move beyond the RH guard after review blocks the original pair send',async()=>{
  const t=desk();await t.ui.action('pairs-prepare',{});t.state.prices.AMD={...t.state.prices.AMD,bid18:100n*S,ask18:101n*S};
  await assert.rejects(t.ui.beforeSend(t.reviews[0]),/5%/);
});
