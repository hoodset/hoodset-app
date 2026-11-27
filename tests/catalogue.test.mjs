import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Interface,keccak256} from 'ethers';
import {ALLOWED} from '../worker/assets.js';
import {VAULT_RUNTIME_HASH,VAULT_READ_ABI,readVaultSnapshot,validateVaultSnapshot,createCatalogueRpc} from '../shared/vault-catalogue.js';
import {catalogueMetrics,copyCatalogueMix} from '../client/catalogue-mix.js';
import {catalogueResponse} from '../worker/catalogue.js';
import {d1CatalogueStore} from '../worker/catalogue-store.js';
import {localD1} from '../scripts/local-d1.mjs';
import {catalogueProxy,CATALOGUE_BACKEND} from '../server/catalogue-proxy.js';
import {createCatalogue} from '../client/catalogue-ui.js';

const now=Date.now(),S=10n**18n,address='0x2222222222222222222222222222222222222222',creator='0x3333333333333333333333333333333333333333';
const snapshot=(patch={})=>({address,creator,chainId:4663,runtimeHash:VAULT_RUNTIME_HASH,name:'Public fixture',symbol:'FIXSET',thesis:'Synthetic test composition, never a public listing.',createdAt:Math.floor(now/1000)-1000,block:1234,blockTime:Math.floor(now/1000),checkedAt:now,supply:String(S),maxSupply:String(100n*S),symbols:['NVDA','AMD'],weights:[7000,3000],initial:[String(S),String(S)],available:[String(2n*S),String(8n*S)],reserved:[String(S),String(2n*S)],balances:[String(3n*S),String(10n*S)],...patch});
const prices={NVDA:{ok:true,mid18:100n*S,at:new Date(now).toISOString()},AMD:{ok:true,mid18:50n*S,at:new Date(now).toISOString()}};
const req=(method='GET',body,url='https://hoodset.example/api/catalogue')=>new Request(url,{method,...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
const options=store=>({store,now:()=>now,read:async a=>snapshot({address:a})});

test('snapshot validates exact runtime, supported components and reconciled balances',()=>{
 assert.equal(validateVaultSnapshot(snapshot()).available[0],String(2n*S));
 for(const patch of [{chainId:1},{runtimeHash:'0x00'},{name:''},{symbol:'1BAD'},{supply:String(101n*S)},{maxSupply:'0'},{createdAt:Math.floor(now/1000)+1},{blockTime:Math.floor(now/1000)-1000},{symbols:['NVDA','EVIL']},{symbols:['NVDA','NVDA']},{weights:[5000,4999]},{initial:['0','1']},{available:['1','2']},{balances:['0','0']},{reserved:['1']}])assert.throws(()=>validateVaultSnapshot(snapshot(patch)),JSON.stringify(patch));
});
test('canonical code and all chain reads are pinned to the same block',async()=>{
 const code=(await readFile(new URL('./fixtures/vault-runtime.hex',import.meta.url),'utf8')).trim();assert.equal(keccak256(code),VAULT_RUNTIME_HASH);
 const abi=new Interface(VAULT_READ_ABI),erc=new Interface(['function balanceOf(address) view returns(uint256)']),v=snapshot(),calls=[];
 const rpc=async(method,params)=>{
  calls.push({method,params});if(method==='eth_chainId')return '0x1237';if(method==='eth_getBlockByNumber')return {number:'0x4d2',timestamp:'0x'+v.blockTime.toString(16)};if(method==='eth_getCode')return code;
  assert.equal(method,'eth_call');assert.equal(params[1],'0x4d2');
  const tx=params[0];if(tx.to!==address)return erc.encodeFunctionResult('balanceOf',[tx.to.toLowerCase()===ALLOWED.NVDA.toLowerCase()?3n*S:10n*S]);
  const decoded=abi.parseTransaction(tx),name=decoded.name;let value={name:v.name,symbol:v.symbol,thesis:v.thesis,creator,createdAt:v.createdAt,maxSupply:v.maxSupply,totalSupply:v.supply,assets:v.symbols.map(s=>ALLOWED[s]),initialQuantities:v.initial,initialWeights:v.weights,availableBalances:v.available}[name];
  if(name==='reserved')value=v.reserved[Number(decoded.args[0])];return abi.encodeFunctionResult(name,[value]);
 };
 assert.deepEqual(await readVaultSnapshot(address,rpc,{now:()=>now}),v);
 assert.equal(calls.find(x=>x.method==='eth_getCode').params[1],'0x4d2');assert.ok(calls.every(x=>!x.method.includes('send')));
});
test('wrong network or wrong bytecode stops before component reads',async()=>{
 let count=0;await assert.rejects(readVaultSnapshot(address,async()=>{count++;return '0x1';}),/not Robinhood/);assert.equal(count,1);
 const calls=[];await assert.rejects(readVaultSnapshot(address,async(m)=>{calls.push(m);return m==='eth_chainId'?'0x1237':m==='eth_getBlockByNumber'?{number:'0x1',timestamp:'0x'+Math.floor(now/1000).toString(16)}:'0x00';}),/does not match/);assert.deepEqual(calls,['eth_chainId','eth_getBlockByNumber','eth_getCode']);
});
test('RPC reader batches, maps out-of-order IDs and rejects incomplete or failed responses',async()=>{
 const batches=[];const rpc=createCatalogueRpc('https://rpc.invalid',{fetcher:async(u,o)=>{const rows=JSON.parse(o.body);batches.push(rows);return Response.json(rows.toReversed().map(r=>({id:r.id,result:r.params[0]})));}});
 const values=await Promise.all(Array.from({length:23},(_,i)=>rpc('eth_call',[String(i)])));assert.deepEqual(values,Array.from({length:23},(_,i)=>String(i)));assert.ok(batches.every(x=>x.length<=10));
 const bad=createCatalogueRpc('https://rpc.invalid',{fetcher:async()=>Response.json([])});await assert.rejects(bad('eth_chainId',[]),/Incomplete/);
 const fail=createCatalogueRpc('https://rpc.invalid',{fetcher:async()=>new Response('',{status:503})});await assert.rejects(fail('eth_chainId',[]),/unavailable/);
});
test('D1 catalogue persists across store instances, deduplicates and refuses older snapshots',async()=>{
 const db=localD1(),a=d1CatalogueStore(db),b=d1CatalogueStore(db);try{
  assert.equal(await a.add(snapshot(),now),true);assert.equal(await b.add(snapshot(),now+1),false);assert.equal((await b.list()).length,1);
  await b.update(snapshot({block:1235}));await a.update(snapshot({block:1200}));assert.equal((await a.get(address)).block,1235);assert.equal((await b.list())[0].listedAt,now);
 }finally{db.close();}
});
test('public listing verifies before storing, handles duplicates and lists actual records',async()=>{
 const db=localD1(),store=d1CatalogueStore(db),o=options(store);try{
  let r=await catalogueResponse(req('POST',{address}),{},o);assert.equal(r.status,201);assert.equal((await r.json()).added,true);
  r=await catalogueResponse(req('POST',{address}),{},o);assert.equal(r.status,200);assert.equal((await r.json()).added,false);
  const page=await (await catalogueResponse(req(),{},o)).json();assert.equal(page.total,1);assert.equal(page.vaults[0].address,address);assert.equal(page.next,null);
  const rejected=await catalogueResponse(req('POST',{address:'0x4444444444444444444444444444444444444444'}),{},{...o,read:async()=>{throw Error('This address does not match the HOODSET vault runtime.');}});assert.equal(rejected.status,502);assert.equal((await store.list()).length,1);
 }finally{db.close();}
});
test('listing rejects malformed input, cross-origin writes, excess fields and oversized bodies',async()=>{
 const db=localD1(),store=d1CatalogueStore(db),o=options(store);try{
  for(const body of [{address:'no'},{address,wallet:'private'},null,[]])assert.equal((await catalogueResponse(req('POST',body),{},o)).status,400);
  assert.equal((await catalogueResponse(req('POST',{address:'x'.repeat(200)}),{},o)).status,413);
  const foreign=new Request('https://hoodset.example/api/catalogue',{method:'POST',headers:{origin:'https://other.example'},body:JSON.stringify({address})});assert.equal((await catalogueResponse(foreign,{},o)).status,403);
  assert.equal((await store.list()).length,0);
 }finally{db.close();}
});
test('empty and partially unavailable catalogue states stay truthful and paginate eight records',async()=>{
 const db=localD1(),store=d1CatalogueStore(db),o=options(store);try{
  const empty=await (await catalogueResponse(req(),{},o)).json();assert.equal(empty.total,0);assert.deepEqual(empty.vaults,[]);
  for(let i=1;i<=10;i++)await store.add(snapshot({address:'0x'+String(i).padStart(40,'0'),checkedAt:now-50000,blockTime:Math.floor(now/1000)-50}),now+i);
  const broken={...o,read:async a=>{if(a.endsWith('10'))throw Error('RPC down');return snapshot({address:a});}};
  const page=await (await catalogueResponse(req(),{},broken)).json();assert.equal(page.total,10);assert.equal(page.vaults.length+page.errors.length,8);assert.equal(page.errors.length,1);assert.ok(page.next);
  const next=await (await catalogueResponse(req('GET',undefined,'https://hoodset.example/api/catalogue?after='+page.next),{},o)).json();assert.equal(next.vaults.length,2);assert.equal(next.next,null);
  assert.equal((await catalogueResponse(req('GET',undefined,'https://hoodset.example/api/catalogue?after=bad'),{},o)).status,400);
 }finally{db.close();}
});
test('current mix uses active backing only and rounds all supported components to exactly 100%',()=>{
 const copy=copyCatalogueMix(snapshot(),prices,'current',{now});assert.deepEqual(copy.draft.assets,[{symbol:'NVDA',weight:'33.33'},{symbol:'AMD',weight:'66.67'}]);assert.equal(copy.origin.block,1234);assert.equal(copy.origin.basis,'current');assert.equal(copy.draft.maxSupply,'100');assert.ok(!('address' in copy.draft));
 const m=catalogueMetrics(snapshot(),prices,{now});assert.equal(m.value,600n*S);assert.equal(m.nav,600n*S);
 assert.deepEqual(copyCatalogueMix(snapshot(),{},'starting',{now}).draft.assets,[{symbol:'NVDA',weight:'70'},{symbol:'AMD',weight:'30'}]);
});
test('missing/stale prices, zero supply and sub-basis-point components block current copying',()=>{
 assert.throws(()=>copyCatalogueMix(snapshot(),{NVDA:prices.NVDA},'current',{now}),/Fresh marks/);
 assert.throws(()=>copyCatalogueMix(snapshot(),{...prices,AMD:{...prices.AMD,at:new Date(now-120001).toISOString()}},'current',{now}),/Fresh marks/);
 assert.throws(()=>copyCatalogueMix(snapshot({checkedAt:now-120001,blockTime:Math.floor(now/1000)-120}),prices,'starting',{now}),/Refresh/);
 const empty=snapshot({supply:'0',available:['0','0'],reserved:['0','0'],balances:['0','0']});assert.equal(catalogueMetrics(empty,prices,{now}).nav,null);assert.throws(()=>copyCatalogueMix(empty,prices,'current',{now}),/no issued/);assert.equal(copyCatalogueMix(empty,{},'starting',{now}).draft.assets.length,2);
 const tiny=snapshot({available:['1',String(8n*S)],reserved:['0','0'],balances:['1',String(8n*S)]});assert.throws(()=>copyCatalogueMix(tiny,prices,'current',{now}),/below 0.01/);
 const broken=snapshot({available:['0',String(8n*S)],reserved:['0','0'],balances:['0',String(8n*S)]});assert.equal(catalogueMetrics(broken,prices,{now}).backed,false);
});
test('copied metadata stays within builder byte limits and never carries shares or balances',()=>{
 const copy=copyCatalogueMix(snapshot({name:'🙂'.repeat(12)}),{},'starting',{now});assert.ok(new TextEncoder().encode(copy.draft.name).length<=48);assert.ok(copy.draft.symbol.length<=8);assert.deepEqual(Object.keys(copy.draft).sort(),['assets','maxSupply','name','symbol','thesis']);
});
test('Vercel proxy uses the fixed HOODSET backend, bounds bodies and validates returned runtime',async()=>{
 let called;const r=await catalogueProxy(req('GET',undefined,'https://hoodset.example/api/catalogue?address='+address),{fetcher:async(url)=>{called=url;return Response.json({vault:snapshot()});}});assert.equal(r.status,200);assert.equal(called.origin,CATALOGUE_BACKEND);assert.equal(called.searchParams.get('address'),address);
 await assert.rejects(catalogueProxy(req(),{fetcher:async()=>Response.json({vault:snapshot({runtimeHash:'0x0'})})}),/Unsupported vault/);
 assert.equal((await catalogueProxy(req('POST',{address:'x'.repeat(200)}),{fetcher:()=>{throw Error('must not fetch');}})).status,413);
});
test('catalogue renders escaped creator text and copying stays read-only until builder import',async()=>{
 const escaped=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const imports=[];let requests=0;
 const v=snapshot({name:'<b>name</b>',thesis:'<script>bad()</script>'});
 const ui=createCatalogue({esc:escaped,btn:(l,a)=>`<button data-action="${a}">${l}</button>`,heading:t=>`<h1>${t}</h1>`,api:async path=>{requests++;return path.startsWith('catalogue?address')?{vault:v}:{vaults:[v],errors:[],total:1,next:null,checkedAt:now};},prices:()=>prices,refreshMarks:async()=>{},applyMix:x=>imports.push(x),render:()=>{},route:()=> 'catalogue',go:()=>{},notify:()=>{}});
 await ui.load();assert.equal(imports.length,0);const html=ui.page();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad'));
 await ui.action('catalogue-copy',{dataset:{address}});assert.equal(imports.length,1);assert.equal(imports[0].origin.address,address);assert.equal(requests,2);
});
