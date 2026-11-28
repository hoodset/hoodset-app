import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceSpread,referenceBasketCost,historicalPair,livePairRatio,roundTripPreview} from '../client/market-analysis.js';
import {normalizeHistory,isoDay} from '../shared/market-history.js';
const S=10n**18n,now=Date.parse('2026-11-26T22:00:00Z');
const mark=(bid=99n*S,ask=101n*S)=>({ok:true,bid18:bid,ask18:ask,mid18:(bid+ask)/2n,at:new Date(now).toISOString()});
const prices={NVDA:mark(),AMD:mark()},rows=[{symbol:'NVDA',weight:'50'},{symbol:'AMD',weight:'50'}];
test('reference bid/ask spread uses midpoint and does not reapply a token multiplier',()=>{
  const p={NVDA:{...mark(990n*S,1010n*S),multiplier:10n*S}},r=referenceSpread('NVDA',p,now);
  assert.equal(r.bid,990n*S);assert.equal(r.ask,1010n*S);assert.equal(r.spreadBps,200);
  assert.equal(referenceSpread('NVDA',{NVDA:mark(100n*S,100n*S)},now).spreadBps,0);
});
test('reference basket costs use every component and the selected amount, not a partial marked subset',()=>{
  const r=referenceBasketCost(rows,'1000',prices,now);assert.equal(r.ask,1010n*S);assert.equal(r.bid,990n*S);assert.equal(r.parts.length,2);assert.equal(r.parts[0].quantity,5n*S);
  assert.equal(r.parts.reduce((s,r)=>s+r.ask,0n),r.ask);assert.equal(r.parts.reduce((s,r)=>s+r.bid,0n),r.bid);
  for(const p of [{NVDA:mark()},{...prices,AMD:{...mark(),at:new Date(now-120001).toISOString()}},{...prices,AMD:{...mark(),ok:false,error:'Oracle paused'}}])assert.throws(()=>referenceBasketCost(rows,'1000',p,now));
  for(const b of ['0','0.99','1000000.000001','1e2'])assert.throws(()=>referenceBasketCost(rows,b,prices,now));
  assert.throws(()=>referenceBasketCost([{symbol:'NVDA',weight:'50'},{symbol:'AMD',weight:'49'}],'100',prices,now));
});
test('live pair reference ratios are directional bid/ask ratios, with no liquidity claim',()=>{
  const p={NVDA:mark(99n*S,101n*S),AMD:mark(199n*S,201n*S)},r=livePairRatio('NVDA','AMD',p,now);
  assert.equal(r.sellLeft18,99n*S/201n);assert.equal(r.sellRight18,199n*S/101n);
  assert.throws(()=>livePairRatio('NVDA','NVDA',p,now));assert.throws(()=>referenceSpread('FAKE',p,now));
  for(const bad of [{...mark(),bid18:0n},{...mark(),ask18:1n},{...mark(),at:new Date(now+60001).toISOString()}])assert.throws(()=>referenceSpread('NVDA',{NVDA:bad},now));
});
const dates=[];for(let t=Date.parse('2025-04-01');t<=Date.parse('2026-11-25');t+=86400000){const day=new Date(t).getUTCDay();if(day!==0&&day!==6)dates.push(isoDay(t));}
function history(){const series={};for(const symbol of ['SPY','NVDA','AMD'])series[symbol]=normalizeHistory(symbol,{status:'ok',meta:{symbol,interval:'1day',currency:'USD',exchange_timezone:'America/New_York'},values:dates.map(datetime=>({datetime,close:'100'}))},now);return{configured:true,series};}
test('pair history aligns sessions, preserves separate returns and gives no statistic for constant variation',()=>{
  const h=history();h.series.NVDA.points.at(-1).close='200';const r=historicalPair('NVDA','AMD',h,'1Y',now);
  assert.equal(r.ready,true);assert.equal(r.ratio,2);assert.equal(r.leftReturnBps,10000);assert.equal(r.rightReturnBps,0);assert.equal(r.gapBps,10000);assert.ok(r.zScore>7);assert.equal(r.zCount,63);assert.equal(r.correlation,null);
  const flat=historicalPair('NVDA','AMD',history(),'1Y',now);assert.equal(flat.zScore,null);assert.equal(flat.correlation,null);
});
test('proportional underlying series have constant ratio and correlated daily changes, without a fabricated z-score',()=>{
  const h=history();h.series.NVDA.points.forEach((p,i)=>p.close=String(100+i%13));h.series.AMD.points.forEach((p,i)=>p.close=String(2*(100+i%13)));
  const before=JSON.stringify(h),r=historicalPair('NVDA','AMD',h,'1Y',now);assert.equal(r.ratio,0.5);assert.equal(r.zScore,null);assert.ok(Math.abs(r.correlation-1)<1e-12);assert.equal(r.gapBps,0);assert.equal(JSON.stringify(h),before);
});
test('missing interior closes, stale calendars and unsupported pairs stop the whole analysis',()=>{
  const h=history(),date='2026-06-01';h.series.NVDA.points=h.series.NVDA.points.filter(p=>p.date!==date);assert.equal(historicalPair('NVDA','AMD',h,'1Y',now).ready,false);
  assert.equal(historicalPair('NVDA','AMD',history(),'1Y',now+8*86400000).ready,false);
  for(const pair of [['NVDA','NVDA'],['NVDA','FAKE']])assert.equal(historicalPair(...pair,history(),'1Y',now).ready,false);
  assert.equal(historicalPair('NVDA','AMD',{...history(),displayAvailable:false},'1Y',now).ready,false);
});
test('round-trip preview joins independent minimum-output quantities and expires at the earlier quote',()=>{
  const buy={side:'buy',symbol:'NVDA',taker:'a',sellAmount:'5000000',grossBuyAmount:'1000',minBuyAmount:'980',requestedAt:now,expiresAt:now+15000};
  const sell={side:'sell',symbol:'NVDA',taker:'a',sellAmount:'980',grossBuyAmount:'4930000',minBuyAmount:'4900000',requestedAt:now+1000,expiresAt:now+25000};
  const r=roundTripPreview(buy,sell,'5',now+2000);assert.equal(r.difference,-100000n);assert.equal(r.expiresAt,now+15000);assert.equal(r.sellMinimum,4900000n);
  assert.throws(()=>roundTripPreview(buy,{...sell,sellAmount:'1000'},'5',now));assert.throws(()=>roundTripPreview(buy,sell,'5',now+15000));assert.throws(()=>roundTripPreview(buy,{...sell,symbol:'AMD'},'5',now));
});
