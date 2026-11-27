import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistory,historicalBasket,compareHistorical,isoDay,nyDay} from '../shared/market-history.js';
import {localD1} from '../scripts/local-d1.mjs';
import {createHistoryService} from '../worker/history.js';
const now=Date.parse('2026-11-26T22:00:00Z');
const dates=[];for(let at=Date.parse('2025-04-01');at<=Date.parse('2026-11-25');at+=86400000){const d=new Date(at).getUTCDay();if(d!==0&&d!==6)dates.push(isoDay(at));}
const provider=(symbol,rows=dates.map(datetime=>({datetime,close:'100'})))=>({status:'ok',meta:{symbol,interval:'1day',currency:'USD',exchange_timezone:'America/New_York'},values:rows});
function fixture(){const series={};for(const symbol of ['SPY','AAPL','NVDA'])series[symbol]=normalizeHistory(symbol,provider(symbol),now);const a=series.AAPL.points,b=series.NVDA.points;a.at(-1).close='200';b.at(-1).close='50';return{configured:true,series};}
const theme={assets:['AAPL','NVDA'],weights:[50,50]};

test('daily adapter verifies symbol, currency, interval, positive closes and unique valid dates',()=>{
  const rows=[{datetime:'2026-11-24',close:'100.12345678901'},{datetime:'2026-11-25',close:'102'}];
  assert.equal(normalizeHistory('AAPL',provider('AAPL',rows),now).points.length,2);
  for(const patch of [{symbol:'MSFT'},{currency:'EUR'},{interval:'1min'},{exchange_timezone:'UTC'}]){const d=provider('AAPL',rows);Object.assign(d.meta,patch);assert.throws(()=>normalizeHistory('AAPL',d,now));}
  for(const close of ['0','-2','NaN',null,'1e2'])assert.throws(()=>normalizeHistory('AAPL',provider('AAPL',[rows[0],{...rows[1],close}]),now));
  assert.throws(()=>normalizeHistory('AAPL',provider('AAPL',[rows[0],rows[0]]),now));
  assert.throws(()=>normalizeHistory('AAPL',provider('AAPL',[rows[0],{datetime:'2026-02-30',close:'100'}]),now));
});
test('current and future sessions never enter completed daily returns',()=>{
  assert.equal(nyDay(Date.parse('2026-11-27T01:00:00Z')),'2026-11-26');
  const d=normalizeHistory('AAPL',provider('AAPL',[{datetime:'2026-11-24',close:'100'},{datetime:'2026-11-25',close:'101'},{datetime:'2026-11-26',close:'999'},{datetime:'2026-11-27',close:'999'}]),now);
  assert.equal(d.last,'2026-11-25');assert.equal(d.points.length,2);
});
test('annual mix uses start weights and fixed units; edited weights recalculate without daily rebalancing',()=>{
  const h=fixture(),r=historicalBasket(theme,h,'1Y',now);
  assert.equal(r.ready,true);assert.equal(r.returnBps,2500);assert.equal(r.startDate,'2025-11-25');assert.equal(r.endDate,'2026-11-25');assert.equal(r.endValue,125n*10n**18n);
  assert.equal(historicalBasket({...theme,weights:[90,10]},h,'1Y',now).returnBps,8500);
  const mid=h.series.AAPL.points.find(p=>p.date==='2026-06-01');mid.close='400';
  const after=historicalBasket(theme,h,'1Y',now);assert.equal(after.returnBps,2500);assert.equal(after.drawdownBps,6000);
});
test('any missing component or interior bar leaves the entire mix unranked, preserving other valid mixes',()=>{
  const h=fixture();h.series.NVDA.points=h.series.NVDA.points.filter(p=>p.date!=='2026-06-01');
  const r=historicalBasket(theme,h,'1Y',now);assert.equal(r.ready,false);assert.equal(r.returnBps,null);assert.deepEqual(r.missing,['NVDA']);
  assert.equal(historicalBasket({assets:['AAPL','SPY'],weights:[50,50]},h,'1Y',now).ready,true);
});
test('stale, short and missing-key histories do not produce annual percentages',()=>{
  assert.equal(historicalBasket(theme,null,'1Y',now).ready,false);
  const h=fixture();h.series.SPY.points=h.series.SPY.points.slice(-100);assert.equal(historicalBasket(theme,h,'1Y',now).ready,false);
  const old=fixture();old.series.SPY.points=old.series.SPY.points.filter(p=>p.date<'2026-11-10');assert.match(historicalBasket(theme,old,'1Y',now).reason,/stale/);
  assert.equal(historicalBasket({...theme,weights:[50,40]},fixture(),'1Y',now).ready,false);
});
test('daily and monthly views have the same exact endpoint across every ranked mix; no live mark is spliced in',()=>{
  const h=fixture(),daily=historicalBasket(theme,h,'1D',now),monthly=historicalBasket(theme,h,'1M',now);
  assert.equal(daily.count,2);assert.equal(daily.startDate,'2026-11-24');assert.equal(monthly.startDate,'2026-10-23');assert.equal(monthly.endDate,daily.endDate);
});
test('return sorting is numeric in both directions and missing rows remain last',()=>{
  const h=fixture(),high=historicalBasket({...theme,weights:[90,10]},h,'1Y',now),low=historicalBasket(theme,h,'1Y',now),missing={ready:false};
  assert.ok(compareHistorical(high,low)<0);assert.ok(compareHistorical(high,low,'asc')>0);assert.ok(compareHistorical(missing,low,'asc')>0);assert.equal(compareHistorical(high,{...low,window:'other'}),0);
});
test('history service requires a private key and cannot act as an arbitrary symbol proxy',async()=>{
  let calls=0;const service=createHistoryService({fetcher:async()=>{calls++;},clock:()=>now});
  for(const key of [undefined,'demo']){const r=await service(new Request('https://hoodset.test/api/history'),{TWELVE_DATA_API_KEY:key});assert.equal(r.body.configured,false);}
  assert.equal(calls,0);assert.equal((await service(new Request('https://hoodset.test/api/history?symbols=EVIL'),{})).status,400);
});
test('persistent history survives fresh service instances and shares the rolling quota across requests',async t=>{
  let at=now;const calls=[];const fetcher=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(provider(new URL(url).searchParams.get('symbol'))));};
  const service=createHistoryService({fetcher,clock:()=>at});const request=new Request('https://hoodset.test/api/history'),env={TWELVE_DATA_API_KEY:'private-test-key',HISTORY_DB:localD1()};t.after(()=>env.HISTORY_DB.close());
  const a=await service(request,env);assert.equal(calls.length,8);assert.equal(Object.keys(a.body.series).length,8);assert.equal(a.body.pending.length,9);assert.equal(a.body.retryAfter,65);
  assert.ok(calls.every(c=>c.opts.headers.Authorization==='apikey private-test-key'&&!c.url.includes('private-test-key')&&new URL(c.url).searchParams.get('adjust')==='splits'&&new URL(c.url).searchParams.get('end_date')==='2026-11-26'));
  assert.equal(JSON.stringify(a).includes('private-test-key'),false);
  const restarted=await createHistoryService({fetcher,clock:()=>at})(request,env);assert.equal(calls.length,8);assert.equal(Object.keys(restarted.body.series).length,8);
  at+=65000;const b=await createHistoryService({fetcher,clock:()=>at})(request,env);assert.equal(calls.length,16);assert.equal(Object.keys(b.body.series).length,16);assert.equal(b.body.pending.length,1);
  at+=65000;const c=await createHistoryService({fetcher,clock:()=>at})(request,env);assert.equal(calls.length,17);assert.equal(Object.keys(c.body.series).length,17);assert.equal(c.body.pending.length,0);
  await createHistoryService({fetcher,clock:()=>at})(request,env);assert.equal(calls.length,17);
});
test('authorization and quota errors stay explicit without reflecting provider secrets',async t=>{
  for(const code of [401,429]){const db=localD1();t.after(()=>db.close());let calls=0;const service=createHistoryService({clock:()=>now,fetcher:async()=>{calls++;return new Response(JSON.stringify({status:'error',code,message:'secret-key reflected by provider'}),{status:code});}});
    const r=await service(new Request('https://hoodset.test/api/history'),{TWELVE_DATA_API_KEY:'secret-key',HISTORY_DB:db});assert.equal(calls,1);assert.equal(JSON.stringify(r).includes('secret-key'),false);assert.equal(Object.keys(r.body.series).length,0);assert.ok(code===401?r.body.error:r.body.retryAfter);
  }
});


test('missing durable storage sends no external calls instead of restarting an ephemeral quota',async()=>{
 let calls=0;const service=createHistoryService({fetcher:async()=>{calls++;},clock:()=>now});
 const r=await service(new Request('https://hoodset.test/api/history'),{TWELVE_DATA_API_KEY:'private-test-key'});
 assert.equal(calls,0);assert.match(r.body.error,/Persistent history cache/);
});
test('concurrent cold instances share asset leases and never duplicate provider requests',async t=>{
 const db=localD1();t.after(()=>db.close());const seen=[];
 const fetcher=async url=>{const symbol=new URL(url).searchParams.get('symbol');seen.push(symbol);await new Promise(resolve=>setTimeout(resolve,1));return new Response(JSON.stringify(provider(symbol)));};
 const env={TWELVE_DATA_API_KEY:'private-test-key',HISTORY_DB:db},request=new Request('https://hoodset.test/api/history');
 await Promise.all([createHistoryService({fetcher,clock:()=>now})(request,env),createHistoryService({fetcher,clock:()=>now})(request,env)]);
 assert.equal(seen.length,8);assert.equal(new Set(seen).size,8);
 const cached=await db.prepare('SELECT COUNT(*) AS count FROM history_cache').first();assert.equal(cached.count,8);
});
