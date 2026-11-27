import test from'node:test';import assert from'node:assert/strict';
import{apiResponse,indexResponse,metaResponse}from'../server/vercel-handler.js';
import{runtimeHistoryStore}from'../server/runtime-history-store.js';
import bootstrap from'../data/stock-history.seed.json' with {type:'json'};
const fakeCache=()=>{const values=new Map();return{get:async k=>values.get(k),set:async(k,v)=>{values.set(k,v);},delete:async k=>{values.delete(k);}};};
test('Vercel history uses the shared price cache without credentials and serves complete real coverage',async()=>{
 const cache=fakeCache(),historyStore=runtimeHistoryStore({cache,key:'test-history'});
 // Test shared-cache reuse independently of the bootstrap's six-hour age and live network.
 await cache.set('test-history',JSON.stringify({...bootstrap,checkedAt:new Date().toISOString(),pendingDays:[]}));
 const a=await apiResponse(new Request('https://hoodset.example/api/history'),'history',{historyStore});const h=await a.json();
 assert.equal(a.status,200);assert.equal(h.displayAvailable,true);assert.equal(Object.keys(h.series).length,17);assert.match(h.cache,/Vercel/);assert.equal(h.license.name,'CC BY-SA 4.0');
 const other=runtimeHistoryStore({cache,key:'test-history'});const b=await apiResponse(new Request('https://hoodset.example/api/history'),'history',{historyStore:other});assert.equal((await b.json()).cacheHit,true);
});
test('Vercel public metadata uses the request host and serves crawler documents without index placeholders',async()=>{
 const root=await indexResponse(new Request('https://hoodset.example/')).text();assert.ok(root.includes('https://hoodset.example/assets/social-cover.png'));assert.ok(!root.includes('__HOODSET_ORIGIN__'));
 assert.equal(indexResponse(new Request('https://hoodset.example/',{method:'POST'})).status,405);
 assert.match(await metaResponse(new Request('https://hoodset.example/api/meta?document=robots')).text(),/Sitemap: https:\/\/hoodset.example\/sitemap.xml/);
 assert.equal(metaResponse(new Request('https://hoodset.example/api/meta?document=private')).status,404);
});
test('Vercel API keeps origin, body-size and RPC write restrictions before any upstream request',async()=>{
 assert.equal((await apiResponse(new Request('https://hoodset.example/api/rpc',{method:'POST',headers:{origin:'https://foreign.example'},body:'{}'}),'rpc')).status,403);
 assert.equal((await apiResponse(new Request('https://hoodset.example/api/rpc',{method:'POST',headers:{'content-length':'500001'},body:'{}'}),'rpc')).status,413);
 const blocked=await apiResponse(new Request('https://hoodset.example/api/rpc',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:['0x']})}),'rpc');assert.equal(blocked.status,400);
});
