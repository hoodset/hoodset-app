import {Interface} from 'ethers';
import {ALLOWED} from '../worker/assets.js';
import {OPENOCEAN_ROUTER,OPENOCEAN_CALLER} from '../shared/openocean.js';
import {openOceanPairInput,validateOpenOceanPair,reviewOpenOceanPair,pairReferenceDeviation} from '../shared/openocean-pair.js';
import {fetchOpenOcean,browserOpenOceanJson} from '../shared/openocean-api.js';
import {swapSettlement} from '../shared/settlement.js';
import {transactionKey,checkWalletQueue} from './transactions.js';
import {freshMark,pairInput} from './market-analysis.js';
import {decimal,units,short} from './finance.js';
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const approval=new Interface(['function approve(address spender,uint256 amount) returns(bool)']);
export const PAIR_PREVIEW_ACCOUNT='0x1111111111111111111111111111111111111111';
export const pairStamp=input=>JSON.stringify([input.sellSymbol,input.buySymbol,input.amount,input.slippageBps]);

export function createPairTrading(d){
  const {state,saved,save,render,notify,esc}=d;
  let quoted=null,working=false,error='';
  const belongs=r=>r?.recovery?.kind?.startsWith('pair.');
  const intent=()=>saved.pairIntents?.[state.account?.toLowerCase()]||null;
  function persist(){save();const storage=d.storage||localStorage,copy=JSON.parse(storage.getItem(d.storageKey)||'{}');if(JSON.stringify(copy.pairIntents||{})!==JSON.stringify(saved.pairIntents||{}))throw Error('Pair progress could not be saved. Allow browser storage before signing.');return copy;}
  function refs(sell,buy){return Object.fromEntries([sell,buy].map(s=>{const p=freshMark(s,state.prices);return [s,{at:p.at,bid18:String(p.bid18),ask18:String(p.ask18)}];}));}
  function request(input,account){pairInput(input.sellSymbol,input.buySymbol);return {sellSymbol:input.sellSymbol,buySymbol:input.buySymbol,taker:account,amount:String(decimal(input.amount,18)),slippageBps:input.slippageBps,references:refs(input.sellSymbol,input.buySymbol)};}
  function noUnknown(account=state.account){if(saved.pairIntents?.[account?.toLowerCase()])throw Error('Recover the last pair wallet request before starting another transaction.');}
  async function pending(account){noUnknown(account);await checkWalletQueue(saved.activity||[],[...(saved.fundingRuns||[]),...(saved.liquidationRuns||[]),...d.otherQueue()],account,'direct-stock-pair',hash=>d.reader().getTransactionReceipt(hash));}
  function liveContext(stamp,account,session){if(pairStamp(d.input())!==stamp||state.account!==account||state.session!==session||!d.active())throw Error('Pair inputs, wallet or page changed. Review the pair again.');}
  async function fetchQuote(params){return (d.fetchQuote||((p)=>fetchOpenOcean(p,browserOpenOceanJson,Date.now(),validateOpenOceanPair)))(params);}
  async function preview(){
    const input=structuredClone(d.input()),stamp=pairStamp(input);await d.refreshMarks([input.sellSymbol,input.buySymbol]);
    const q=await fetchQuote(openOceanPairInput(request(input,PAIR_PREVIEW_ACCOUNT)));
    if(pairStamp(d.input())!==stamp||!d.active())throw Error('Pair inputs or page changed. Check the new route.');
    quoted={...q,preview:true};return q;
  }
  async function prepare(refreshOnly=false){
    const account=await d.assertWallet(),session=state.session,input=structuredClone(d.input()),stamp=pairStamp(input);await pending(account);
    await d.loadBalances();liveContext(stamp,account,session);await d.refreshMarks([input.sellSymbol,input.buySymbol]);liveContext(stamp,account,session);
    const p=openOceanPairInput(request(input,account));
    if(!state.balanceComplete||typeof state.balances[input.sellSymbol]!=='bigint'||state.balances[input.sellSymbol]<BigInt(p.sellAmount))throw Error('The connected wallet does not hold the exact '+input.sellSymbol+' amount. This spot exchange cannot open a short.');
    const t=d.token(input.sellSymbol),allowance=await t.allowance(account,OPENOCEAN_ROUTER);liveContext(stamp,account,session);
    if(allowance<BigInt(p.sellAmount)){
      if(refreshOnly)throw Error('Token permission changed. Close this review and check the exact approval first.');
      await d.approveToken(input.sellSymbol,OPENOCEAN_ROUTER,p.sellAmount,{kind:'pair.approval',stamp});return;
    }
    const [router,caller]=await Promise.all([d.reader().getCode(OPENOCEAN_ROUTER),d.reader().getCode(OPENOCEAN_CALLER)]);if(router==='0x'||caller==='0x')throw Error('Verified spot exchange infrastructure is unavailable.');
    const q=await fetchQuote(p);liveContext(stamp,account,session);reviewOpenOceanPair(q,request(input,account));quoted={...q,preview:false};
    const details=`<p>Exchange tokens already in your wallet. No borrowing, leverage or short position is created.</p><div class="meta-pair"><span>Exact ${esc(q.sellSymbol)} spend</span><strong>${units(BigInt(q.sellAmount),18,18)}</strong></div><div class="meta-pair"><span>Minimum ${esc(q.buySymbol)} received</span><strong>${units(BigInt(q.minBuyAmount),18,18)}</strong></div><div class="meta-pair"><span>Quote price protection</span><strong>${esc(q.priceImpact)} / ${esc(q.priceImpactSource)}</strong></div><div class="meta-pair"><span>Gross deviation from RH references</span><strong>${esc(q.referenceDeviation)}</strong></div><p class="footnote">Stock Token quantities, not underlying share counts. Minimum output includes the route's fee/slippage bounds. ETH gas is separate.</p>`;
    await d.transactionReview('EXCHANGE '+q.sellSymbol+' FOR '+q.buySymbol,{to:q.transaction.to,data:q.transaction.data,value:0n},details,async()=>{quoted=null;},q.expiresAt,{kind:'pair.swap',quote:q,stamp,pairId:'direct-stock-pair'});
  }
  async function refreshReview(r){if(r.kind!=='pair.swap'||r.stamp!==pairStamp(d.input()))throw Error('Pair inputs changed. Close the review and request the new route.');await prepare(true);}
  async function beforeSend(r){
    if(!belongs(r))return;await pending(r.account);
    if(r.recovery.stamp!==pairStamp(d.input()))throw Error('Pair inputs changed after review. Close it and review again.');
    if(r.recovery.kind==='pair.approval'){
      const p=approval.decodeFunctionData('approve',r.tx.data);
      if(!ALLOWED[r.recovery.symbol]||!same(r.tx.to,ALLOWED[r.recovery.symbol])||!same(p.spender,OPENOCEAN_ROUTER)||p.amount!==BigInt(r.recovery.amount)||BigInt(r.tx.value||0)!==0n)throw Error('Pair approval changed.');return;
    }
    const q=r.recovery.quote;reviewOpenOceanPair(q,{sellSymbol:q.sellSymbol,buySymbol:q.buySymbol,taker:r.account,amount:q.sellAmount,slippageBps:q.slippageBps,references:q.pairReferences});
    await d.refreshMarks([q.sellSymbol,q.buySymbol]);
    freshMark(q.sellSymbol,state.prices);freshMark(q.buySymbol,state.prices);
    // Recheck current marks without extending the original route/review expiry.
    pairReferenceDeviation(openOceanPairInput(request(d.input(),r.account)),q.grossBuyAmount);
    const [balance,allowance]=await Promise.all([d.token(q.sellSymbol).balanceOf(r.account),d.token(q.sellSymbol).allowance(r.account,OPENOCEAN_ROUTER)]);
    if(balance<BigInt(q.sellAmount)||allowance<BigInt(q.sellAmount))throw Error('Pair balance or exact token permission changed.');
  }
  function sending(r){
    if(!belongs(r))return;noUnknown(r.account);saved.pairIntents||={};
    saved.pairIntents[r.account]={account:r.account,target:r.tx.to,data:r.tx.data,value:String(r.tx.value||0),operationKey:r.operationKey,label:r.label,recovery:r.recovery,at:Date.now()};
    try{persist();}catch(e){delete saved.pairIntents[r.account];throw e;}
  }
  function submitted(row){
    if(!belongs(row))return;const copy=persist();if(!copy.activity?.some(r=>same(r.hash,row.hash)))throw Error('Keep the wallet hash. Pair progress could not be persisted.');
    const previous=saved.pairIntents?.[row.account];delete saved.pairIntents?.[row.account];try{persist();}catch(e){if(previous)saved.pairIntents[row.account]=previous;throw e;}
  }
  function rejected(r,e,requested,started){if(!belongs(r)||r.sentHash||!started)return;if(!requested||e.code===4001||e.code==='ACTION_REJECTED'||e.info?.error?.code===4001){delete saved.pairIntents?.[r.account];persist();}}
  async function recover(row,receipt){
    const tx=await d.reader().getTransaction(row.hash);
    if(!tx||!same(tx.from,row.account)||!same(receipt.from,row.account)||!same(receipt.hash,row.hash)||!same(receipt.to,tx.to)||receipt.status!==1||transactionKey(tx)!==row.operationKey)throw Error('Pair receipt does not match the reviewed wallet request.');
    if(row.recovery.kind==='pair.swap'){
      const q=row.recovery.quote;reviewOpenOceanPair(q,{sellSymbol:q.sellSymbol,buySymbol:q.buySymbol,taker:row.account,amount:q.sellAmount,slippageBps:q.slippageBps,references:q.pairReferences},q.requestedAt);
      row.pairTrade={...swapSettlement(receipt,q),sellSymbol:q.sellSymbol,buySymbol:q.buySymbol};quoted=null;
    }
  }
  async function recoverHash(hash){
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash||''))throw Error('Enter the transaction hash from wallet Activity.');const p=intent();if(!p)throw Error('No unknown pair wallet request exists.');
    const account=await d.assertWallet(),session=state.session,tx=await d.reader().getTransaction(hash);
    if(!tx||!same(tx.from,account)||transactionKey(tx)!==p.operationKey)throw Error('Hash does not match the original pair request.');
    if(tx.blockNumber!==null){const b=await d.reader().getBlock(tx.blockNumber);if(!b||b.timestamp*1000<p.at-10000)throw Error('This transaction predates the wallet request.');}
    if(state.account!==account||state.session!==session)throw Error('Wallet changed while recovering the pair request.');
    let row=saved.activity.find(r=>same(r.hash,tx.hash));if(row&&(!same(row.account,account)||row.operationKey!==p.operationKey))throw Error('Existing journal entry does not match this pair request.');
    if(!row){row={label:p.label,operationKey:p.operationKey,hash:tx.hash,account,target:p.target,nonce:tx.nonce,recovery:p.recovery,at:p.at,status:'Submitted'};saved.activity.unshift(row);}submitted(row);
    const receipt=await d.reader().getTransactionReceipt(hash);if(receipt){row.status=receipt.status===1?'Included in RH block':'Reverted';if(receipt.status===1){await recover(row,receipt);row.recoveryComplete=true;}save();}
    notify('Pair transaction recovered. Refresh receipts before continuing.');
  }
  async function action(action,el){
    if(working)return;working=true;error='';render();
    try{if(action==='pairs-preview')await preview();else if(action==='pairs-prepare')await prepare();else if(action==='pairs-recover')await recoverHash(d.recoveryHash());}
    catch(e){error=String(e.shortMessage||e.message||e).slice(0,280);}
    finally{working=false;render();}
  }
  return {action,refreshReview,beforeSend,sending,submitted,rejected,recover,noUnknown,intent,quote:()=>quoted,working:()=>working,error:()=>error,invalidate:()=>{quoted=null;error='';},queue:()=>Object.values(saved.pairIntents||{}).map(p=>({id:'pair-unknown',account:p.account,intent:p}))};
}
