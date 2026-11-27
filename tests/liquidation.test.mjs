import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Interface } from 'ethers';
import { redemptionAmounts,redemptionSettlement,liquidationLedger } from '../client/liquidation-math.js';
import { createLiquidation } from '../client/liquidation.js';
import { EXISTING_VAULT } from './fixture-vault.mjs';
import { ALLOWED,USDG } from '../worker/assets.js';
import { OPENOCEAN_ROUTER,OPENOCEAN_CALLER,openOceanInput,validateOpenOcean,openOceanInterface } from '../shared/openocean.js';

const S=10n**18n,account='0x1111111111111111111111111111111111111111',zero='0x0000000000000000000000000000000000000000';
const abi=new Interface(['function redeem(uint256 shares,address receiver,uint256[] minAmounts)','event AssetsRedeemed(address indexed owner,address indexed receiver,uint256 shares,uint256[] amounts)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const erc=new Interface(['function approve(address spender,uint256 amount) returns(bool)']);
const log=(address,name,args)=>({address,...abi.encodeEventLog(abi.getEvent(name),args)});
function v(symbols=['NVDA','AMD']){return {address:EXISTING_VAULT,name:'Existing set',symbol:'MYCHIP',symbols,assets:symbols.map(s=>ALLOWED[s]),initial:symbols.map((_,i)=>BigInt(i+2)*S),supply:10n*S,max:100n*S,owned:2n*S,available:symbols.map((_,i)=>BigInt(i+2)*10n*S),reserved:symbols.map(()=>99n*S)};}
function redeemReceipt(plan,amounts,hash='0xredemption'){
  return {hash,status:1,from:account,to:plan.vault,blockNumber:12,logs:[log(plan.vault,'AssetsRedeemed',[account,account,BigInt(plan.shares),amounts]),log(plan.vault,'Transfer',[account,zero,BigInt(plan.shares)]),...plan.assets.map((a,i)=>log(a,'Transfer',[plan.vault,account,amounts[i]]))]};
}
test('redemption uses active backing and floor rounding, never reserves or more than owned shares',()=>{
  const x={...v(),supply:7n*S,available:[11n*S,5n*S]};
  assert.deepEqual(redemptionAmounts(x,S+3n),x.available.map(n=>n*(S+3n)/(7n*S)));
  for(const shares of [0n,-1n,3n*S,11n*S])assert.throws(()=>redemptionAmounts(v(),shares),/available/);
  assert.throws(()=>redemptionAmounts({...v(),available:[1n,1n]},1n),/rounds a component to zero/);
});
test('a successful receipt cannot establish redemption without the share burn and every exact component credit',()=>{
  const p={account,vault:EXISTING_VAULT,shares:String(S),assets:v().assets},request={shares:p.shares,amounts:[String(2n*S),String(3n*S)]},r=redeemReceipt(p,[2n*S,3n*S]);
  const proof=redemptionSettlement(r,p,request);assert.equal(proof.shares,p.shares);assert.deepEqual(proof.amounts,request.amounts);
  for(const patch of [{status:0},{from:zero},{to:zero},{logs:r.logs.slice(1)},{logs:r.logs.filter((_,i)=>i!==1)},{logs:r.logs.slice(0,-1)}])assert.throws(()=>redemptionSettlement({...r,...patch},p,request));
  assert.throws(()=>redemptionSettlement(r,p,{...request,amounts:[String(2n*S+1n),String(3n*S)]}),/bounds/);
  const donated=redemptionSettlement(redeemReceipt(p,[2n*S+1n,3n*S+2n]),p,request);assert.equal(donated.amounts[0],String(2n*S+1n));
});
const p={account,shares:String(S),rows:[{symbol:'NVDA'},{symbol:'AMD'}]},redemption={kind:'redemption',hash:'0xredeem',shares:String(S),amounts:[String(2n*S),String(3n*S)],nonce:4};
const sale=(step,amount,nonce)=>({hash:'0xsale'+nonce,account,step,symbol:p.rows[step].symbol,side:'sell',sellAmount:String(amount),requestedAmount:String(amount),buyAmount:'1234567',nonce});
test('exit ledger is idempotent and only counts redeemed quantities and actual USDG sale deltas',()=>{
  const a=sale(0,2n*S,5),b=sale(1,3n*S,6),l=liquidationLedger(p,[redemption,a,b,a]);
  assert.equal(l.total,2469134n);assert.equal(l.done,true);assert.deepEqual(l.remaining,[0n,0n]);
  assert.throws(()=>liquidationLedger(p,[a]),/verified redemption/);
  assert.throws(()=>liquidationLedger(p,[redemption,{...a,sellAmount:String(2n*S+1n)}]),/exceeds/);
  assert.throws(()=>liquidationLedger(p,[redemption,a,{...a,hash:'0xagain',nonce:7}]),/remaining/);
  assert.throws(()=>liquidationLedger(p,[redemption,{...a,nonce:3}]),/verified redemption/);
  assert.throws(()=>liquidationLedger(p,[redemption,{...redemption,hash:'0xsecondburn'}]),/More than one redemption/);
});
test('a refunded remainder including one token wei is never silently marked sold',()=>{
  const first={...sale(0,2n*S,5),sellAmount:String(2n*S-1n)},l=liquidationLedger(p,[redemption,first,sale(1,3n*S,6)]);
  assert.equal(l.done,false);assert.deepEqual(l.remaining,[1n,0n]);
  const done=liquidationLedger(p,[redemption,first,sale(1,3n*S,6),{...sale(0,1n,7),buyAmount:'1'}]);assert.equal(done.done,true);
});

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/openocean-sell.json',import.meta.url))).result;
function quote(input){
  const params=openOceanInput(input),d=structuredClone(fixture.data),decoded=openOceanInterface.decodeFunctionData('swap',d.data),desc=[...decoded.desc],out=BigInt(input.amount)*100n/10n**12n,min=out*99n/100n;
  desc[0]=params.sellToken;desc[1]=params.buyToken;desc[3]=input.taker;desc[4]=BigInt(input.amount);desc[5]=min;
  Object.assign(d,{from:input.taker,inToken:{address:params.sellToken,decimals:18},outToken:{address:params.buyToken,decimals:6},inAmount:input.amount,outAmount:String(out),minOutAmount:String(min),price_impact:'0.1%',rfqDeadline:0,data:openOceanInterface.encodeFunctionData('swap',[decoded.caller,desc,decoded.calls.map(c=>[...c])])});
  return validateOpenOcean({code:200,data:d},params);
}
function harness(symbols=['NVDA','AMD']){
  const storage=new Map(),fields={'#exit-shares':'1','#exit-slippage':'100'};
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.document={querySelector:s=>s in fields?{value:fields[s]}:null};
  const state={account,chain:4663,session:1,prices:Object.fromEntries(symbols.map(s=>[s,{ok:true,at:new Date().toISOString()}])),assets:symbols.map(s=>({tokenSymbol:s})),tokenChecks:{},balances:Object.fromEntries(symbols.map(s=>[s,1000n*S])),eth:S,usdg:999000000n,vaults:{[EXISTING_VAULT]:v(symbols)}},saved={vaults:[],liquidationRuns:[],activity:[]},receipts=new Map(),transactions=new Map(),allowances=new Map(),reviews=[],approvals=[],quoteCalls=[];
  let nonce=10;
  const d={state,saved,storageKey:'test',reader:()=>({getTransactionReceipt:async h=>receipts.get(h)||null,getTransaction:async h=>transactions.get(h),getBlock:async()=>({timestamp:Math.floor(Date.now()/1000)}),getCode:async()=> '0x1234'}),assertWallet:async expected=>{if(state.chain!==4663||!state.account||expected&&expected!==state.account)throw Error('Wallet account or chain changed');return state.account;},loadVault:async()=>state.vaults[EXISTING_VAULT],loadBalances:async()=>{},token:s=>({allowance:async()=>allowances.get(s)||0n}),vault:()=>({interface:abi,previewRedeem:async q=>redemptionAmounts(state.vaults[EXISTING_VAULT],q)}),transactionReview:async(...r)=>reviews.push(r),approveToken:async(s,spender,amount,recovery)=>{
    approvals.push({symbol:s,spender,amount});const value=(allowances.get(s)||0n)>0n?0n:amount;
    reviews.push(['APPROVE '+s,{to:ALLOWED[s],data:erc.encodeFunctionData('approve',[spender,value]),value:0n},'',null,Date.now()+90000,{...recovery,symbol:s,spender,amount:String(value)}]);
  },save:()=>localStorage.setItem('test',JSON.stringify(saved)),esc:String,btn:()=>'',heading:t=>t,render:()=>{},expirePrices:()=>{},notify:()=>{},fail:e=>e.message,fetchQuote:async input=>{quoteCalls.push(input);return quote(input);}};
  let exit=createLiquidation(d);const el={dataset:{vault:EXISTING_VAULT}};
  async function submit({status=1,refund=0n,extra=0n,missingOutput=false}={}){
    const r=reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};await exit.beforeSend(review);exit.sending(review);
    const hash='0x'+String(nonce).padStart(64,'0'),n=nonce++,row={hash,account,target:review.tx.to,label:review.label,recovery:review.recovery,status:'Submitted',nonce:n};
    saved.activity.push(row);exit.submitted(row);
    let receipt={hash,blockNumber:12,status,from:account,to:review.tx.to,logs:[]};
    if(status===1){
      if(review.recovery.kind==='liquidation.redeem'){
        const amounts=review.recovery.amounts.map(a=>BigInt(a)+extra),p=saved.liquidationRuns.at(-1);receipt=redeemReceipt(p,amounts,hash);
        const x=state.vaults[EXISTING_VAULT];x.supply-=BigInt(p.shares);x.owned-=BigInt(p.shares);x.available=x.available.map((a,i)=>a-amounts[i]);x.symbols.forEach((s,i)=>state.balances[s]+=amounts[i]);
      }else if(review.recovery.kind==='liquidation.swap'){
        const q=review.recovery.quote,spent=BigInt(q.sellAmount)-refund,out=BigInt(q.minBuyAmount)+3n;
        receipt.logs=[log(q.sellToken,'Transfer',[account,OPENOCEAN_CALLER,spent]),...(!missingOutput?[log(q.buyToken,'Transfer',[OPENOCEAN_CALLER,account,out])]:[])];state.balances[q.symbol]-=spent;state.usdg+=out;
      }else allowances.set(review.recovery.symbol,BigInt(review.recovery.amount));
    }
    receipts.set(hash,receipt);transactions.set(hash,{hash,from:account,to:review.tx.to,data:review.tx.data,value:0n,nonce:n});await exit.reconcile();return {row,receipt};
  }
  return {get exit(){return exit;},state,saved,d,el,receipts,transactions,reviews,approvals,quoteCalls,allowances,fields,submit,reload(){Object.assign(saved,JSON.parse(localStorage.getItem('test')));exit=createLiquidation(d);return exit.reconcile();}};
}
test('complete seven-component exit: preflight, one burn, exact approvals, all sales, reload and actual USDG total',async()=>{
  const h=harness(['NVDA','AMD','AVGO','MSFT','GOOGL','AMZN','PLTR']);await h.exit.action('exit-plan',h.el);
  assert.equal(h.quoteCalls.length,7);assert.equal(h.reviews.length,0);assert.equal(h.saved.liquidationRuns[0].vault,EXISTING_VAULT);
  await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].kind,'liquidation.redeem');await h.submit({extra:7n});await h.reload();
  let expected=0n;
  for(let i=0;i<7;i++){
    await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].kind,'liquidation.approval');assert.equal(h.approvals[i].amount,BigInt(i+2)*S+7n);await h.submit();
    await h.exit.action('exit-next',h.el);const r=h.reviews.at(-1);assert.equal(r[5].kind,'liquidation.swap');assert.equal(r[5].amount,String(BigInt(i+2)*S+7n));expected+=BigInt(r[5].quote.minBuyAmount)+3n;await h.submit();
    if(i===2)await h.reload();
  }
  assert.match(h.exit.page(EXISTING_VAULT),/YOUR EXIT IS COMPLETE/);assert.equal(h.state.usdg,999000000n+expected);assert.equal(h.state.vaults[EXISTING_VAULT].owned,S);
  for(const n of Object.values(h.state.balances))assert.equal(n,1000n*S);
  const calls=h.quoteCalls.length,reviews=h.reviews.length;await h.exit.action('exit-next',h.el);assert.equal(h.quoteCalls.length,calls);assert.equal(h.reviews.length,reviews);
});
test('one missing route prevents a share burn, including after the initial plan check',async()=>{
  const h=harness();h.d.fetchQuote=async input=>{if(input.symbol==='AMD')throw Error('No sell liquidity');return quote(input);};let exit=createLiquidation(h.d);
  await exit.action('exit-plan',h.el);assert.equal(h.saved.liquidationRuns.length,0);assert.equal(h.reviews.length,0);assert.match(exit.page(EXISTING_VAULT),/No sell liquidity/);
  const j=harness();await j.exit.action('exit-plan',j.el);j.d.fetchQuote=async()=>{throw Error('Route disappeared');};exit=createLiquidation(j.d);await exit.action('exit-next',j.el);assert.equal(j.reviews.length,0);
});
test('overselling shares, dust rounding, missing prices, no ETH, wrong network and wallet changes fail without a transaction',async()=>{
  for(const condition of ['oversell','dust','stale','gas','chain','wallet']){
    const h=harness();if(condition==='oversell')h.fields['#exit-shares']='3';if(condition==='dust')h.state.vaults[EXISTING_VAULT].available=[1n,1n];if(condition==='stale')h.state.prices.AMD.ok=false;if(condition==='gas')h.state.eth=0n;if(condition==='chain')h.state.chain=1;
    if(condition==='wallet'){h.d.fetchQuote=async input=>{h.state.session++;h.state.account=zero;return quote(input);};}
    const exit=createLiquidation(h.d);await exit.action('exit-plan',h.el);assert.equal(h.saved.liquidationRuns.length,0,condition);assert.equal(h.reviews.length,0,condition);
  }
});
test('a pending redemption blocks a duplicate burn across reload; rejection is retryable and unknown broadcast blocks resending',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};
  h.exit.sending(review);h.exit.rejected(review,{code:'ACTION_REJECTED'},true,true);assert.equal(h.saved.liquidationRuns[0].intent,undefined);
  h.exit.sending(review);h.exit.rejected(review,{code:'NETWORK_ERROR'},true,true);const calls=h.quoteCalls.length;await h.exit.action('exit-next',h.el);assert.equal(h.quoteCalls.length,calls);assert.match(h.exit.page(EXISTING_VAULT),/unknown outcome/);
  h.exit.submitted({hash:'0xpending',account,target:review.tx.to,recovery:review.recovery,nonce:10});await h.reload();await h.exit.action('exit-next',h.el);assert.equal(h.quoteCalls.length,calls);assert.match(h.exit.page(EXISTING_VAULT),/still pending/);
});
test('a refund remains queued, a revert counts no spend, and a missing output receipt cannot complete a sale',async()=>{
  const h=harness();h.allowances.set('NVDA',100n*S);await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);await h.submit();
  await h.exit.action('exit-next',h.el);await h.submit({status:0});await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].step,0);
  await h.submit({refund:S/10n});await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].amount,String(S/10n));assert.doesNotMatch(h.exit.page(EXISTING_VAULT),/YOUR EXIT IS COMPLETE/);
  await assert.rejects(()=>h.submit({missingOutput:true}),/token transfers/);
});
test('nonzero insufficient allowance resets to zero; final approvals never cover unrelated wallet holdings',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);await h.submit();h.allowances.set('NVDA',1n);
  await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].amount,'0');await h.submit();await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].amount,String(2n*S));assert.equal(h.approvals.at(-1).spender,OPENOCEAN_ROUTER);
});
test('expired sell quotes, missing token balances and a changed immutable vault identity block the send guard',async()=>{
  const h=harness();h.allowances.set('NVDA',100n*S);await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);await h.submit();await h.exit.action('exit-next',h.el);
  const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]},expires=review.recovery.quote.expiresAt;review.recovery.quote.expiresAt=Date.now()-1;await assert.rejects(()=>h.exit.beforeSend(review),/fresh quote/);review.recovery.quote.expiresAt=expires;
  h.state.balances.NVDA=0n;await assert.rejects(()=>h.exit.beforeSend(review),/missing/);h.state.balances.NVDA=100n*S;h.state.vaults[EXISTING_VAULT].initial[0]++;await assert.rejects(()=>h.exit.beforeSend(review),/does not match/);
});
test('an exit can change its amount before redemption, but cannot forget a verified burn',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-reset',h.el);assert.equal(h.saved.liquidationRuns[0].archived,true);
  await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);await h.submit();await h.exit.action('exit-reset',h.el);assert.notEqual(h.saved.liquidationRuns[1].archived,true);assert.match(h.exit.page(EXISTING_VAULT),/Finish or recover/);
});
test('malformed persisted exit data fails closed instead of allowing another redemption',async()=>{
  const h=harness();h.saved.liquidationRuns=[null];const exit=createLiquidation(h.d);await exit.action('exit-plan',h.el);assert.equal(h.quoteCalls.length,0);assert.match(exit.page(EXISTING_VAULT),/CHECK SAVED EXIT DATA/);
});
test('retrying an unknown broadcast must not clear the original unresolved intent',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],recovery:r[5]};
  h.exit.sending(review);h.exit.rejected(review,{code:'NETWORK_ERROR'},true,true);const intent=h.saved.liquidationRuns[0].intent;
  await assert.rejects(()=>h.exit.beforeSend(review),/unknown outcome/);h.exit.rejected(review,Error('unknown outcome'),false,false);
  assert.equal(h.saved.liquidationRuns[0].intent,intent);await assert.rejects(()=>h.exit.beforeSend(review),/unknown outcome/);
});
test('same-nonce speed-up and confirmed self-cancellation recover a pending redemption without a duplicate burn',async()=>{
  for(const cancel of [false,true]){
    const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],recovery:r[5]},oldHash='0x'+'a'.repeat(64),newHash='0x'+'b'.repeat(64);
    h.exit.sending(review);const row={hash:oldHash,account,target:review.tx.to,recovery:review.recovery,nonce:10,status:'Submitted'};h.saved.activity.push(row);h.exit.submitted(row);h.transactions.set(oldHash,{from:account,to:review.tx.to,data:review.tx.data,value:0n,nonce:10});await h.exit.reconcile();
    h.transactions.set(newHash,{hash:newHash,from:account,to:cancel?account:review.tx.to,data:cancel?'0x':review.tx.data,value:0n,nonce:10});
    h.receipts.set(newHash,cancel?{hash:newHash,status:1,from:account,to:account,logs:[]}:redeemReceipt(h.saved.liquidationRuns[0],review.recovery.amounts.map(BigInt),newHash));
    h.fields['#exit-recovery-hash']=newHash;await h.exit.action('exit-recover',h.el);await h.exit.action('exit-next',h.el);
    assert.equal(h.reviews.at(-1)[5].kind,cancel?'liquidation.redeem':'liquidation.approval');assert.match(h.saved.activity[0].status,cancel?/Cancelled/:/Replaced/);
  }
});
test('recovery of an unknown hash binds to the request time, calldata, sender and target',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],recovery:r[5]},hash='0x'+'c'.repeat(64);h.exit.sending(review);
  h.transactions.set(hash,{hash,from:account,to:review.tx.to,data:review.tx.data,value:0n,nonce:10,blockNumber:12});h.receipts.set(hash,redeemReceipt(h.saved.liquidationRuns[0],review.recovery.amounts.map(BigInt),hash));h.fields['#exit-recovery-hash']=hash;
  const original=h.d.reader;h.d.reader=()=>({...original(),getBlock:async()=>({timestamp:Math.floor(Date.now()/1000)-1000})});await h.exit.action('exit-recover',h.el);assert.ok(h.saved.liquidationRuns[0].intent);
  h.d.reader=original;await h.exit.action('exit-recover',h.el);assert.equal(h.saved.liquidationRuns[0].intent,undefined);await h.exit.action('exit-next',h.el);assert.equal(h.reviews.at(-1)[5].kind,'liquidation.approval');
});
test('unsigned redemption, approval and sale calldata are checked before asking the wallet',async()=>{
  const h=harness();await h.exit.action('exit-plan',h.el);await h.exit.action('exit-next',h.el);let r=h.reviews.at(-1),review={tx:{...r[1],data:abi.encodeFunctionData('redeem',[S,zero,r[5].amounts])},recovery:r[5]};
  await assert.rejects(()=>h.exit.beforeSend(review),/receiver/);await h.submit();await h.exit.action('exit-next',h.el);r=h.reviews.at(-1);review={tx:{...r[1],data:erc.encodeFunctionData('approve',[zero,2n*S])},recovery:r[5]};await assert.rejects(()=>h.exit.beforeSend(review),/approval/);
  await h.submit();await h.exit.action('exit-next',h.el);r=h.reviews.at(-1);review={tx:{...r[1],to:zero},recovery:r[5]};await assert.rejects(()=>h.exit.beforeSend(review),/router/);
});
