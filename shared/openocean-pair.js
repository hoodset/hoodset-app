import {ALLOWED} from '../worker/assets.js';
import {openOceanInput,validateOpenOcean,OPENOCEAN_ROUTER} from './openocean.js';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const uint=n=>/^[1-9][0-9]{0,76}$/.test(String(n))&&BigInt(n)<2n**256n;
export function openOceanPairInput(input,now=Date.now()){
  if(!Object.hasOwn(ALLOWED,input?.sellSymbol)||!Object.hasOwn(ALLOWED,input?.buySymbol)||input.sellSymbol===input.buySymbol)throw Error('Choose two different canonical Stock Tokens.');
  // Reuse the wallet, spend and slippage checks from the production spot path.
  const p=openOceanInput({taker:input.taker,symbol:input.sellSymbol,side:'sell',amount:input.amount,slippageBps:input.slippageBps});
  const refs={};for(const symbol of [input.sellSymbol,input.buySymbol]){const r=input.references?.[symbol],age=now-Date.parse(r?.at);if(!r||!Number.isFinite(age)||age>120000||age< -60000||!uint(r.bid18)||!uint(r.ask18)||BigInt(r.ask18)<BigInt(r.bid18))throw Error('Fresh token-adjusted references are required for both pair legs.');refs[symbol]={at:r.at,bid18:String(r.bid18),ask18:String(r.ask18)};}
  return {...p,side:'pair',symbol:input.buySymbol,sellSymbol:input.sellSymbol,buySymbol:input.buySymbol,buyToken:ALLOWED[input.buySymbol],buyDecimals:18,pairReferences:refs};
}
export function pairReferenceDeviation(params,output){
  if(!uint(output))throw Error('Positive pair output is required.');
  const refs=params.pairReferences,inputValue=BigInt(params.sellAmount)*BigInt(refs[params.sellSymbol].bid18)/10n**18n,outputValue=BigInt(output)*BigInt(refs[params.buySymbol].ask18)/10n**18n;
  const diff=outputValue-inputValue,abs=diff<0n?-diff:diff;
  if(inputValue<=0n||outputValue<=0n||abs*10000n>inputValue*500n)throw Error('Pair route differs from fresh RH references by more than 5%.');
  return (Number(diff*10000n/inputValue)/100).toFixed(2)+'%';
}
export function validateOpenOceanPair(result,params,now=Date.now()){
  const refs=params.pairReferences;if(!refs)throw Error('Pair references are missing.');
  const p=openOceanPairInput({taker:params.taker,sellSymbol:params.sellSymbol,buySymbol:params.buySymbol,amount:params.sellAmount,slippageBps:params.slippageBps,references:refs},now);
  const raw=result?.data;if(result?.code!==200||!raw)throw Error(result?.message||'No direct Stock Token route.');
  const referenceDeviation=pairReferenceDeviation(p,raw.outAmount);
  // The existing decoder validates sender, canonical amounts, executor, recipient,
  // flags, minimum output and zero ETH. The synthetic impact is explicitly labelled.
  const q=validateOpenOcean({...result,data:{...raw,price_impact:raw.price_impact||referenceDeviation}},p,now);
  return {...q,kind:'spot-pair',sellSymbol:p.sellSymbol,buySymbol:p.buySymbol,pairReferences:refs,referenceDeviation,...(!raw.price_impact?{priceImpactSource:'RH pair reference deviation'}:{})};
}
export function reviewOpenOceanPair(q,input,now=Date.now()){
  const p=openOceanPairInput(input,now);
  if(q?.kind!=='spot-pair'||q.side!=='pair'||q.provider!=='OpenOcean'||q.symbol!==p.buySymbol||q.sellSymbol!==p.sellSymbol||q.buySymbol!==p.buySymbol||!same(q.recipient,p.taker)||!same(q.taker,p.taker)||!same(q.approvalSpender,OPENOCEAN_ROUTER)||q.spendingCap!==p.sellAmount||q.sellAmount!==p.sellAmount||q.slippageBps!==p.slippageBps||!Number.isSafeInteger(q.requestedAt)||!Number.isSafeInteger(q.expiresAt)||q.requestedAt>now+1000||q.expiresAt<=now||q.expiresAt>q.requestedAt+30000)throw Error('Refresh the pair quote for this wallet and exact amount.');
  if(JSON.stringify(q.pairReferences)!==JSON.stringify(p.pairReferences))throw Error('Pair reference changed. Request a new quote.');
  const normalized=validateOpenOceanPair({code:200,data:{chainId:q.chainId,from:q.taker,to:q.transaction?.to,inToken:{address:q.sellToken,decimals:18},outToken:{address:q.buyToken,decimals:18},inAmount:q.sellAmount,outAmount:q.grossBuyAmount,minOutAmount:q.minBuyAmount,value:q.transaction?.value,data:q.transaction?.data,price_impact:q.priceImpactSource==='RH pair reference deviation'?undefined:q.priceImpact}},p,now);
  if(normalized.referenceDeviation!==q.referenceDeviation||normalized.priceImpact!==q.priceImpact||normalized.priceImpactSource!==q.priceImpactSource)throw Error('Pair price protection changed.');return q;
}
