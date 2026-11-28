import {ALLOWED} from '../worker/assets.js';
import {SCALE,decimal,initialAmounts} from './finance.js';
import {historicalBasket,close18} from '../shared/market-history.js';

export function freshMark(symbol,prices,now=Date.now()){
  if(!Object.hasOwn(ALLOWED,symbol))throw Error('Choose a supported Stock Token.');
  const p=prices?.[symbol],age=now-Date.parse(p?.at);
  if(!p?.ok||!Number.isFinite(age)||age>120000||age< -60000||typeof p.bid18!=='bigint'||typeof p.ask18!=='bigint'||p.bid18<=0n||p.ask18<p.bid18)throw Error(symbol+': '+(p?.error||'a fresh verified bid/ask is required.'));
  return {...p,mid18:(p.bid18+p.ask18)/2n};
}
export function referenceSpread(symbol,prices,now=Date.now()){
  const p=freshMark(symbol,prices,now),mid=(p.bid18+p.ask18)/2n,difference=p.ask18-p.bid18;
  return {symbol,bid:p.bid18,ask:p.ask18,mid,difference,spreadBps:Number((difference*1000000n+mid/2n)/mid)/100,at:p.at};
}
export function referenceBasketCost(rows,budget,prices,now=Date.now()){
  const micros=decimal(budget,6);if(micros<1000000n||micros>1000000000000n)throw Error('Choose a reference amount from $1 to $1,000,000.');
  const marks=Object.fromEntries(rows.map(r=>[r.symbol,freshMark(r.symbol,prices,now)])),{amounts}=initialAmounts(rows,marks);
  const parts=rows.map((r,i)=>{const q=amounts[i]*micros/100000000n;if(q===0n)throw Error('Increase the reference amount for every component.');return {symbol:r.symbol,quantity:q,bid:q*marks[r.symbol].bid18/SCALE,ask:q*marks[r.symbol].ask18/SCALE};});
  const bid=parts.reduce((v,r)=>v+r.bid,0n),ask=parts.reduce((v,r)=>v+r.ask,0n);
  return {parts,bid,ask,difference:ask-bid,roundTripBps:Number(((ask-bid)*1000000n+ask/2n)/ask)/100};
}
export function pairInput(left,right){
  if(!Object.hasOwn(ALLOWED,left)||!Object.hasOwn(ALLOWED,right)||left===right)throw Error('Choose two different supported Stock Tokens.');return {left,right};
}
export function livePairRatio(left,right,prices,now=Date.now()){
  pairInput(left,right);const a=freshMark(left,prices,now),b=freshMark(right,prices,now);
  return {mid18:((a.bid18+a.ask18)/2n)*SCALE/((b.bid18+b.ask18)/2n),sellLeft18:a.bid18*SCALE/b.ask18,sellRight18:b.bid18*SCALE/a.ask18};
}
// Daily-close analysis shares the basket calendar checks; missing dates never get dropped.
export function historicalPair(left,right,history,period='1Y',now=Date.now()){
  const no=reason=>({ready:false,reason,points:[],zScore:null,correlation:null});
  try{pairInput(left,right);}catch(e){return no(e.message);}
  if(!['1M','1Y'].includes(period))return no('Choose 1M or 1Y.');
  const checked=historicalBasket({assets:[left,right],weights:[50,50]},history,period,now);if(!checked.ready)return no(checked.reason);
  try{
    const maps=[left,right].map(s=>new Map(history.series[s].points.map(p=>[p.date,p.close])));
    const points=checked.points.map(p=>{const a=Number(close18(maps[0].get(p.date)))/1e18,b=Number(close18(maps[1].get(p.date)))/1e18;return {date:p.date,at:p.at,left:a,right:b,ratio:a/b};});
    const sample=points.slice(-63),logs=sample.map(p=>Math.log(p.ratio)),mean=logs.reduce((s,x)=>s+x,0)/logs.length;
    const deviation=logs.length>=20?Math.sqrt(logs.reduce((s,x)=>s+(x-mean)**2,0)/(logs.length-1)):0;
    const zScore=logs.length>=20&&deviation>1e-12?(logs.at(-1)-mean)/deviation:null;
    const changes=points.slice(1).map((p,i)=>[p.left/points[i].left-1,p.right/points[i].right-1]);
    const avg=i=>changes.reduce((s,p)=>s+p[i],0)/changes.length,ma=avg(0),mb=avg(1);
    const va=changes.reduce((s,p)=>s+(p[0]-ma)**2,0),vb=changes.reduce((s,p)=>s+(p[1]-mb)**2,0);
    const covariance=changes.reduce((s,p)=>s+(p[0]-ma)*(p[1]-mb),0);
    const correlation=changes.length>=20&&va>1e-24&&vb>1e-24?Math.max(-1,Math.min(1,covariance/Math.sqrt(va*vb))):null;
    const first=points[0],last=points.at(-1),leftReturn=(last.left/first.left-1)*10000,rightReturn=(last.right/first.right-1)*10000;
    return {ready:true,points,start:checked.startDate,end:checked.endDate,period,count:points.length,ratio:last.ratio,leftReturnBps:Math.round(leftReturn),rightReturnBps:Math.round(rightReturn),gapBps:Math.round(leftReturn-rightReturn),zScore,correlation,zCount:sample.length,logRatioMean:mean,logRatioStd:deviation};
  }catch{return no('A selected component has an invalid historical close.');}
}
export function roundTripPreview(buy,sell,budget,now=Date.now()){
  const micros=decimal(budget,6);
  if(buy.side!=='buy'||sell.side!=='sell'||buy.symbol!==sell.symbol||buy.taker!==sell.taker||BigInt(buy.sellAmount)!==micros||BigInt(sell.sellAmount)!==BigInt(buy.minBuyAmount))throw Error('Round-trip quotes do not match the selected amounts.');
  const expiresAt=Math.min(buy.expiresAt,sell.expiresAt);if(expiresAt<=now)throw Error('A route expired during the comparison. Refresh both quotes.');
  return {input:micros,quotedTokens:BigInt(buy.grossBuyAmount),buyMinimum:BigInt(buy.minBuyAmount),sellInput:BigInt(buy.minBuyAmount),quotedReturn:BigInt(sell.grossBuyAmount),sellMinimum:BigInt(sell.minBuyAmount),difference:BigInt(sell.minBuyAmount)-micros,expiresAt,requestedAt:Math.max(buy.requestedAt,sell.requestedAt)};
}
