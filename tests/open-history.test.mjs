import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import bootstrap from '../data/stock-history.seed.json' with {type:'json'};
import{snapshotSeries,priceQuery,revisionRef,validatePriceRows,doltRead,historyDays}from'../shared/dolt-history.js';
import{historicalBasket,compareHistorical,close18}from'../shared/market-history.js';
import{createOpenHistoryService}from'../worker/open-history.js';import{localD1}from'../scripts/local-d1.mjs';import{BASE_THEMES}from'../client/themes.js';
const now=Date.parse(bootstrap.fetchedAt),clone=x=>JSON.parse(JSON.stringify(x)),request=()=>new Request('https://hoodset.test/api/history');
const license=readFileSync(new URL('../web/data/LICENSE-stock-history.txt',import.meta.url),'utf8');
function splitFixture(to='10',forFactor='1',before='1208.88',after='121.79'){
 const b=clone(bootstrap);b.rows=[{act_symbol:'NVDA',date:'2024-06-07',close:before},{act_symbol:'NVDA',date:'2024-06-10',close:after}];b.splits=[{act_symbol:'NVDA',ex_date:'2024-06-10',to_factor:to,for_factor:forFactor}];return b;
}
test('raw daily closes are split-adjusted exactly once, including reverse splits',()=>{
 const at=Date.parse('2024-06-12T20:00:00Z'),a=snapshotSeries(splitFixture(),at).series.NVDA;
 assert.equal(close18(a.points[0].close),120888n*10n**15n);assert.equal(close18(a.points[1].close),12179n*10n**16n);
 const reverse=snapshotSeries(splitFixture('1','10','10','100'),at).series.NVDA;assert.equal(close18(reverse.points[0].close),100n*10n**18n);
 assert.throws(()=>snapshotSeries({...splitFixture(),priceBasis:'already-adjusted'},at));
});
test('missing corporate actions and malformed or duplicate rows cannot fabricate a return',()=>{
 const at=Date.parse('2024-06-12T20:00:00Z'),b=splitFixture();b.splits=[];const h=snapshotSeries(b,at);
 assert.equal(h.series.NVDA,undefined);assert.match(h.errors.NVDA,/corporate-action/);
 for(const rows of [[b.rows[0],b.rows[0]],[{...b.rows[0],act_symbol:'EVIL'}],[{...b.rows[0],close:'0'}]])assert.throws(()=>validatePriceRows(rows,['2024-06-07']));
 assert.throws(()=>priceQuery(["2026-11-25';DROP TABLE ohlcv"],bootstrap.revision));assert.throws(()=>revisionRef('master;DROP'));
});
test('the real dated bootstrap covers all 17 instruments and seven comparable annual mixes',()=>{
 const h={configured:true,displayAvailable:true,...snapshotSeries(bootstrap,now)};assert.equal(Object.keys(h.series).length,17);assert.deepEqual(h.errors,{});
 const annual=BASE_THEMES.map(t=>historicalBasket(t,h,'1Y',now));assert.ok(annual.every(r=>r.ready));assert.equal(new Set(annual.map(r=>r.window)).size,1);
 const asc=[...annual].sort((a,b)=>compareHistorical(a,b,'asc')),desc=[...annual].sort((a,b)=>compareHistorical(a,b,'desc'));
 assert.equal(asc[0].returnBps,desc.at(-1).returnBps);assert.equal(asc.at(-1).returnBps,desc[0].returnBps);
 const gapped=clone(h);gapped.series.NVDA.points.splice(100,1);assert.equal(historicalBasket(BASE_THEMES[0],gapped,'1Y',now).ready,false);
 assert.equal(historicalBasket(BASE_THEMES[0],h,'1Y',now+10*86400000).ready,false);
});
test('free history ignores paid-provider credentials and never reads legacy Twelve Data payloads',async t=>{
 const db=localD1();t.after(()=>db.close());await db.prepare('INSERT INTO history_cache(symbol,version,payload,fetched_at) VALUES(?1,?2,?3,?4)').bind('SPY',2,'private-legacy-data',now).run();
 let calls=0;const service=createOpenHistoryService({clock:()=>now,fetcher:async()=>{calls++;throw Error('must not fetch');}});
 const a=await service(request(),{HISTORY_DB:db,TWELVE_DATA_API_KEY:'private-test-key'});assert.equal(Object.keys(a.body.series).length,17);assert.equal(a.body.displayAvailable,true);assert.equal(calls,0);
 assert.equal(JSON.stringify(a).includes('private-test-key'),false);assert.equal(JSON.stringify(a).includes('private-legacy-data'),false);assert.equal(a.body.license.name,'CC BY-SA 4.0');
 assert.equal((await service(new Request('https://hoodset.test/api/history?symbols=EVIL'),{HISTORY_DB:db})).status,400);
});
function provider(calls,{changedLicense=false}={}){return async url=>{
 const q=new URL(url).searchParams.get('q');calls.push(q);let rows;
 if(q.includes('dolt_docs'))rows=[{revision:bootstrap.revision,doc_text:changedLicense?'different license':license}];
 else if(q.includes('FROM symbol'))rows=bootstrap.identities;
 else if(q.includes('FROM split'))rows=bootstrap.splits;
 else{const match=q.match(/date IN \(([^)]+)\)/);assert.ok(match);const dates=match[1].split(',').map(s=>s.slice(1,-1));rows=bootstrap.rows.filter(r=>dates.includes(r.date));}
 return new Response(JSON.stringify({query_execution_status:'Success',repository_owner:'post-no-preference',repository_name:'stocks',rows}));
};}
test('bounded refresh survives fresh worker instances and retains date-level provenance',async t=>{
 const db=localD1();t.after(()=>db.close());const calls=[],at=now+7*3600000,fetcher=provider(calls);
 const a=await createOpenHistoryService({clock:()=>at,fetcher})(request(),{HISTORY_DB:db});assert.equal(Object.keys(a.body.series).length,17);assert.equal(a.body.pending.length,0);assert.ok(calls.length<=5);
 assert.ok(calls.filter(q=>q.includes('FROM ohlcv')).every(q=>q.includes("AS OF '"+bootstrap.revision+"'")&&q.match(/date IN \(([^)]+)\)/)[1].split(',').length<=20));
 const n=calls.length,b=await createOpenHistoryService({clock:()=>at,fetcher})(request(),{HISTORY_DB:db});assert.equal(calls.length,n);assert.equal(Object.keys(b.body.series).length,17);assert.ok(Object.values(b.body.snapshot.priceRevisionsByDate).every(r=>r===bootstrap.revision));
});
test('source truncation, wrong repository and changed license stop ingestion',async t=>{
 for(const patch of [{query_execution_status:'RowLimit'},{repository_owner:'other'}])await assert.rejects(()=>doltRead('SELECT',async()=>new Response(JSON.stringify({query_execution_status:'Success',repository_owner:'post-no-preference',repository_name:'stocks',rows:[],...patch}))));
 const db=localD1();t.after(()=>db.close());const calls=[];const r=await createOpenHistoryService({clock:()=>now+7*3600000,fetcher:provider(calls,{changedLicense:true})})(request(),{HISTORY_DB:db});assert.ok(r.body.error);assert.equal(calls.length,1);assert.equal(r.body.cacheStale,true);assert.equal(r.body.snapshot.latestSourceRevision,bootstrap.revision);
});
test('concurrent refreshes share a lease; missing D1 does not trigger upstream reads',async t=>{
 const db=localD1();t.after(()=>db.close());const calls=[],at=now+7*3600000;let release,started;
 const wait=new Promise(r=>release=r),begin=new Promise(r=>started=r),base=provider(calls);
 const fetcher=async u=>{if(new URL(u).searchParams.get('q').includes('dolt_docs')){started();await wait;}return base(u);};
 const first=createOpenHistoryService({clock:()=>at,fetcher})(request(),{HISTORY_DB:db});await begin;
 const second=await createOpenHistoryService({clock:()=>at,fetcher})(request(),{HISTORY_DB:db});assert.equal(second.body.retryAfter,65);assert.equal(Object.keys(second.body.series).length,17);release();await first;assert.equal(calls.filter(q=>q.includes('dolt_docs')).length,1);
 const n=calls.length,missing=await createOpenHistoryService({clock:()=>at,fetcher})(request(),{});assert.equal(calls.length,n);assert.match(missing.body.error,/cache/);
});
