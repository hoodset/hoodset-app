import { EXISTING_VAULT } from './fixture-vault.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Interface } from 'ethers';
import { allocateFunding, mintAmounts, mintCapacity, vaultIdentity, fundingLedger, mintSettlement } from '../client/funding-math.js';
import { createFunding } from '../client/funding.js';
import { ALLOWED } from '../worker/assets.js';
import { OPENOCEAN_ROUTER, OPENOCEAN_CALLER, openOceanInput, validateOpenOcean, openOceanInterface } from '../shared/openocean.js';

const S=10n**18n,account='0x1111111111111111111111111111111111111111',zero='0x0000000000000000000000000000000000000000';
const v=()=>({address:EXISTING_VAULT,name:'Existing set',symbol:'MYCHIP',assets:[ALLOWED.NVDA,ALLOWED.AMD],symbols:['NVDA','AMD'],initial:[2n*S,S],weights:[5000n,5000n],available:[0n,0n],reserved:[99n*S,99n*S],supply:0n,max:100n*S});
const prices=()=>Object.fromEntries(['NVDA','AMD'].map(s=>[s,{ok:true,at:new Date().toISOString(),ask18:S}]));
test('USDG allocation uses immutable mint quantities, not template weights; 6 decimal rounding accounts for the entire budget',()=>{
  const a=allocateFunding(v(),'5',prices());assert.equal(a.budget,5000000n);assert.deepEqual(a.allocations,[3333333n,1666667n]);assert.equal(a.referenceShares,5000000n*10n**12n/3n);
  assert.throws(()=>allocateFunding(v(),'0',prices()));assert.throws(()=>allocateFunding(v(),'0.0000001',prices()));assert.throws(()=>allocateFunding(v(),'0.000001',prices()),/too small/);
});
test('missing, stale, paused and future price marks stop the entire basket allocation',()=>{
  for(const patch of [undefined,{ok:false},{ok:true,ask18:S,at:new Date(Date.now()-121000).toISOString()},{ok:true,ask18:0n,at:new Date().toISOString()},{ok:true,ask18:S,at:new Date(Date.now()+61000).toISOString()}]){
    assert.throws(()=>allocateFunding(v(),'5',{...prices(),AMD:patch}),/AMD/);
  }
});
test('capacity and ceil deposits match vault math, exclude reserved tokens, and cannot exceed acquired inventory or supply cap',()=>{
  for(let i=1n;i<120n;i++){
    const x={...v(),supply:7n*S,available:[11n*S,5n*S]},inventory=[i*S+19n,i*S/2n+7n];
    const q=mintCapacity(x,inventory),amounts=mintAmounts(x,q);
    assert.ok(amounts.every((n,j)=>n<=inventory[j]));
    if(q<x.max-x.supply)assert.ok(mintAmounts(x,q+1n).some((n,j)=>n>inventory[j]));
  }
  assert.equal(mintCapacity(v(),[1000n*S,1000n*S]),100n*S);
  assert.throws(()=>mintAmounts(v(),101n*S),/capacity/);
  assert.throws(()=>mintCapacity({...v(),supply:S,available:[0n,S]},[S,S]),/backing/);
});
test('reload ledger is idempotent, rejects duplicate component buys and over-budget receipt amounts',()=>{
  const p={account,budget:'5000000',rows:[{symbol:'NVDA',allocation:'3333333'},{symbol:'AMD',allocation:'1666667'}]};
  const s={hash:'0xone',account,step:0,symbol:'NVDA',side:'buy',sellAmount:'3333333',buyAmount:String(S)};
  const l=fundingLedger(p,[s,s]);assert.equal(l.total,3333333n);assert.deepEqual(l.bought,[S,0n]);
  assert.throws(()=>fundingLedger(p,[s,{...s,hash:'0xtwo'}]),/Duplicate/);
  assert.throws(()=>fundingLedger(p,[{...s,sellAmount:'3333334'}]),/allocation/);
  assert.throws(()=>fundingLedger(p,[{...s,account:zero}]),/match/);
});

const abi=new Interface(['function mintShares(uint256 shares,address receiver,uint256[] maxAmounts)','event SharesMinted(address indexed owner,address indexed receiver,uint256 shares,uint256[] amounts)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const log=(address,name,args)=>({address,...abi.encodeEventLog(abi.getEvent(name),args)});
function mintReceipt(p,shares,amounts,hash='0xmint'){
  return {hash,status:1,from:account,to:p.vault,blockNumber:12,logs:[log(p.vault,'SharesMinted',[account,account,shares,amounts]),log(p.vault,'Transfer',[zero,account,shares]),...p.assets.map((a,i)=>log(a,'Transfer',[account,p.vault,amounts[i]]))]};
}
test('Mint completion requires share issuance and every exact deposit in the real receipt, not status alone',()=>{
  const p={account,vault:EXISTING_VAULT,assets:v().assets},request={shares:String(S),amounts:[String(2n*S),String(S)]},r=mintReceipt(p,S,[2n*S,S]);
  const s=mintSettlement(r,p,request);assert.equal(s.shares,String(S));assert.deepEqual(s.amounts,request.amounts);
  for(const patch of [{status:0},{from:zero},{to:zero},{logs:r.logs.slice(1)},{logs:r.logs.slice(0,-1)}])assert.throws(()=>mintSettlement({...r,...patch},p,request));
  assert.throws(()=>mintSettlement(r,p,{...request,amounts:[String(S),String(S)]}),/deposits/);
});

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/openocean-buy.json',import.meta.url))).result;
function quote(input){
  const params=openOceanInput(input),d=structuredClone(fixture.data),decoded=openOceanInterface.decodeFunctionData('swap',d.data),desc=[...decoded.desc];
  const out=BigInt(input.amount)*10n**12n,min=out*99n/100n;
  desc[0]=params.sellToken;desc[1]=params.buyToken;desc[3]=account;desc[4]=BigInt(params.sellAmount);desc[5]=min;
  Object.assign(d,{from:account,inToken:{address:params.sellToken,decimals:6},outToken:{address:params.buyToken,decimals:18},inAmount:params.sellAmount,outAmount:String(out),minOutAmount:String(min),price_impact:'0.1%',rfqDeadline:0,data:openOceanInterface.encodeFunctionData('swap',[decoded.caller,desc,decoded.calls.map(c=>[...c])])});
  return validateOpenOcean({code:200,data:d},params);
}
function harness(){
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.document={querySelector:s=>s==='#fund-budget'?{value:'5'}:s==='#fund-slippage'?{value:'100'}:null};
  const state={account,session:1,chain:4663,prices:prices(),assets:[{tokenSymbol:'NVDA'},{tokenSymbol:'AMD'}],tokenChecks:{},balances:{NVDA:10n*S,AMD:10n*S},eth:S,usdg:5000000n,vaults:{[EXISTING_VAULT]:v()}},saved={vaults:[],fundingRuns:[]},receipts=new Map(),transactions=new Map(),reviews=[],approvals=[],quoteCalls=[];
  const d={state,saved,storageKey:'test',reader:()=>({getTransactionReceipt:async h=>receipts.get(h)||null,getTransaction:async h=>transactions.get(h),getCode:async()=> '0x1234'}),assertWallet:async expected=>{if(expected&&expected!==state.account)throw Error('account changed');return state.account;},loadVault:async()=>state.vaults[EXISTING_VAULT],loadBalances:async()=>{},token:()=>({allowance:async()=>2n**255n}),vault:()=>({interface:abi,previewMint:async q=>mintAmounts(state.vaults[EXISTING_VAULT],q)}),transactionReview:async(...r)=>reviews.push(r),approveToken:async(...r)=>approvals.push(r),save:()=>localStorage.setItem('test',JSON.stringify(saved)),esc:String,btn:()=>'',heading:t=>t,render:()=>{},expirePrices:()=>{},notify:()=>{},fail:e=>e.message,fetchQuote:async input=>{quoteCalls.push(input);return quote(input);}};
  const fund=createFunding(d),el={dataset:{vault:EXISTING_VAULT}};
  async function submitReview(hash,status=1){
    const r=reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};await fund.beforeSend(review);fund.sending(review);
    const row={hash,account,target:review.tx.to,label:review.label,recovery:review.recovery,status:'Submitted'};fund.submitted(row);
    const q=row.recovery.quote;
    const receipt=q?{hash,blockNumber:11,status,from:account,to:review.tx.to,logs:[log(q.sellToken,'Transfer',[account,OPENOCEAN_CALLER,BigInt(q.sellAmount)]),log(q.buyToken,'Transfer',[OPENOCEAN_CALLER,account,BigInt(q.minBuyAmount)+2n])]}:mintReceipt(saved.fundingRuns.at(-1),BigInt(row.recovery.shares),row.recovery.amounts.map(BigInt),hash);
    receipt.status=status;receipts.set(hash,receipt);transactions.set(hash,{from:account,to:review.tx.to,data:review.tx.data,value:0n});await fund.reconcile();return row;
  }
  return {fund,state,saved,d,el,receipts,transactions,reviews,approvals,quoteCalls,submitReview};
}
test('complete USDG basket flow reuses existing vault, verifies both swaps, mints from acquired amounts and resumes after reload',async()=>{
  const h=harness();await h.fund.action('fund-plan',h.el);assert.equal(h.saved.fundingRuns.length,1);assert.equal(h.quoteCalls.length,2);assert.equal(h.reviews.length,0);assert.equal(h.saved.fundingRuns[0].vault,EXISTING_VAULT);
  await h.fund.action('fund-next',h.el);assert.equal(h.reviews.at(-1)[5].kind,'funding.swap');await h.submitReview('0xfirst');
  // Reload from serialized storage: reconstruct progress from chain receipts.
  Object.assign(h.saved,JSON.parse(localStorage.getItem('test')));h.fund=createFunding(h.d);await h.fund.reconcile();
  await h.fund.action('fund-next',h.el);assert.equal(h.reviews.at(-1)[5].step,1);await h.submitReview('0xsecond');
  const requests=h.quoteCalls.length;await h.fund.action('fund-next',h.el);const r=h.reviews.at(-1);assert.equal(r[5].kind,'funding.mint');assert.equal(r[1].to,EXISTING_VAULT);assert.ok(BigInt(r[5].shares)<10n*S);await h.submitReview('0xfinal');
  await h.fund.action('fund-next',h.el);assert.equal(h.quoteCalls.length,requests);assert.match(h.fund.page(EXISTING_VAULT),/YOUR SET IS FUNDED/);assert.match(h.fund.page(EXISTING_VAULT),/5 USDG/);
});
test('an unavailable component route produces no saved purchase, approval, swap or deployment',async()=>{
  const h=harness();h.d.fetchQuote=async input=>{if(input.symbol==='AMD')throw Error('No executable route');return quote(input);};h.fund=createFunding(h.d);await h.fund.action('fund-plan',h.el);
  assert.equal(h.saved.fundingRuns.length,0);assert.equal(h.reviews.length,0);assert.equal(h.approvals.length,0);assert.match(h.fund.page(EXISTING_VAULT),/No executable route/);
});
test('pending receipt blocks the entire run even when a refreshed quote would have different calldata',async()=>{
  const h=harness();await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};h.fund.sending(review);h.fund.submitted({hash:'0xpending',account,target:review.tx.to,recovery:review.recovery});
  const calls=h.quoteCalls.length;await h.fund.action('fund-next',h.el);assert.equal(h.quoteCalls.length,calls);assert.match(h.fund.page(EXISTING_VAULT),/still pending/);
});
test('declines are retryable; an unknown broadcast outcome persists and blocks buying again',async()=>{
  const h=harness();await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};
  h.fund.sending(review);h.fund.rejected(review,{code:'ACTION_REJECTED'},true,true);assert.equal(h.saved.fundingRuns[0].intent,undefined);
  h.fund.sending(review);h.fund.rejected(review,{code:'NETWORK_ERROR'},true,true);assert.ok(h.saved.fundingRuns[0].intent);await h.fund.action('fund-next',h.el);assert.match(h.fund.page(EXISTING_VAULT),/unknown outcome/);
  h.fund.rejected(review,Error('guard blocked retry'),false,false);assert.ok(h.saved.fundingRuns[0].intent);
});
test('reverted swaps can be retried without counting spend; another account cannot resume the run',async()=>{
  const h=harness();await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);await h.submitReview('0xreverted',0);await h.fund.action('fund-next',h.el);assert.equal(h.reviews.at(-1)[5].step,0);
  h.state.account=zero;h.state.session++;const before=h.reviews.length;await h.fund.action('fund-next',h.el);assert.equal(h.reviews.length,before);
});
test('exact USDG and component approvals precede the corresponding swap or Mint',async()=>{
  const h=harness();h.d.token=()=>({allowance:async()=>0n});h.fund=createFunding(h.d);await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);
  assert.equal(h.reviews.length,0);assert.equal(h.approvals[0][0],'USDG');assert.equal(h.approvals[0][1],OPENOCEAN_ROUTER);assert.equal(h.approvals[0][2],3333333n);assert.equal(h.approvals[0][3].fund,h.saved.fundingRuns[0].id);
});
test('expired swap reviews and changed composition cannot reach the wallet send step',async()=>{
  const h=harness();await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]};
  review.recovery.quote.expiresAt=Date.now()-1;await assert.rejects(()=>h.fund.beforeSend(review),/fresh quote/);
  h.state.vaults[EXISTING_VAULT].initial[0]++;await assert.rejects(()=>h.fund.beforeSend(review),/does not match/);
});
test('malformed saved progress blocks a new purchase rather than silently forgetting spent funds',async()=>{
  const h=harness();h.saved.fundingRuns=[{budget:'broken'}];h.fund=createFunding(h.d);await h.fund.action('fund-plan',h.el);assert.equal(h.quoteCalls.length,0);assert.match(h.fund.page(EXISTING_VAULT),/CHECK SAVED PURCHASE DATA/);
});
test('a verified same-nonce speed-up or wallet cancellation resolves a pending step without an extra purchase',async()=>{
  for(const cancel of [false,true]){
    const h=harness();await h.fund.action('fund-plan',h.el);await h.fund.action('fund-next',h.el);
    const r=h.reviews.at(-1),review={tx:r[1],label:r[0],recovery:r[5]},oldHash='0x'+'1'.repeat(64),newHash='0x'+'2'.repeat(64);
    h.fund.sending(review);h.fund.submitted({hash:oldHash,account,target:review.tx.to,recovery:review.recovery,nonce:9});
    h.transactions.set(oldHash,{from:account,to:review.tx.to,data:review.tx.data,value:0n,nonce:9});await h.fund.reconcile();
    h.transactions.set(newHash,{hash:newHash,from:account,to:cancel?account:review.tx.to,data:cancel?'0x':review.tx.data,value:0n,nonce:9});
    const q=review.recovery.quote;h.receipts.set(newHash,{hash:newHash,status:1,from:account,to:cancel?account:review.tx.to,blockNumber:11,logs:cancel?[]:[log(q.sellToken,'Transfer',[account,OPENOCEAN_CALLER,BigInt(q.sellAmount)]),log(q.buyToken,'Transfer',[OPENOCEAN_CALLER,account,BigInt(q.minBuyAmount)])]});
    globalThis.document={querySelector:s=>s==='#fund-recovery-hash'?{value:newHash}:null};
    await h.fund.action('fund-recover',h.el);await h.fund.action('fund-next',h.el);
    assert.equal(h.reviews.at(-1)[5].step,cancel?0:1);assert.doesNotMatch(h.fund.page(EXISTING_VAULT),/still pending/);
  }
});
