import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits} from 'ethers';
import {orderPlan,minimumBuy,minimumSell,ladderTransaction,LADDER_IFACE,ladderReceipt} from '../shared/ladder-orders.js';
import {ALLOWED} from '../worker/assets.js';
const draft=()=>({symbol:'NVDA',levels:[{price:'90',budget:'10'},{price:'80',budget:'20'}],profit:'5',cycles:'2',days:'30'});
test('ladder plan uses fixed-point quantities and a weighted acquisition average',()=>{
 const p=orderPlan(draft(),parseUnits('100',18));assert.equal(p.total,30000000n);assert.equal(p.levels[1].cumulativeCost,30000000n);assert.ok(p.levels[1].average18<parseUnits('85',18));assert.equal(p.levels[1].target,31500000n);assert.equal(p.cycles,2);
});
test('ladder input rejects unsupported, malformed, nondecreasing and excessive settings',()=>{
 for(const mutation of[
  d=>d.symbol='NOPE',d=>d.levels=[],d=>d.levels=Array(9).fill({price:'1',budget:'1'}),d=>d.levels[1].price='90',d=>d.levels[1].price='100',d=>d.levels[0].price='0',d=>d.levels[0].price='1e2',d=>d.levels[0].budget='.1',d=>d.levels[0].budget='0.99',d=>d.levels[0].budget='1000000.000001',d=>d.levels[0].budget='5000000',d=>d.levels[0].budget='1.0000001',d=>d.profit='0.99',d=>d.profit='100.01',d=>d.cycles=0,d=>d.cycles=101,d=>d.cycles=1.5,d=>d.days=91,d=>d.days=0]){const d=draft();mutation(d);assert.throws(()=>orderPlan(d));}
 assert.throws(()=>orderPlan(draft(),parseUnits('90',18)),/below/);
});
test('buy bounds round toward protection; sell bounds include net output deductions',()=>{
 assert.equal(minimumBuy(1n,3n),333333333333333333333333333334n);assert.equal(minimumSell(1n,100),2n);assert.equal(minimumSell(10000000n,500),10500000n);
 assert.throws(()=>minimumBuy(0,1));assert.throws(()=>minimumSell(1,0));
});
test('unsigned open and exit encode only owner-selected plan and exact withdrawals',()=>{
 const engine='0x1111111111111111111111111111111111111111';const tx=ladderTransaction({kind:'orders.open',engine,plan:draft(),expiresAt:2000000000});const decoded=LADDER_IFACE.parseTransaction(tx);assert.equal(decoded.name,'open');assert.equal(decoded.args[0],ALLOWED.NVDA);assert.equal(decoded.args[3],500n);assert.equal(tx.value,0n);
 assert.equal(LADDER_IFACE.parseTransaction(ladderTransaction({kind:'orders.cash',engine,id:'7',amount:'123456'})).args[1],123456n);assert.throws(()=>ladderTransaction({kind:'orders.swap',engine}));
});
test('ladder settlement validates event provenance, owner, asset, budget and exact withdrawal',()=>{
 const engine='0x1111111111111111111111111111111111111111',account='0x2222222222222222222222222222222222222222',r={kind:'orders.open',engine,account,plan:draft()};
 const e=LADDER_IFACE.encodeEventLog(LADDER_IFACE.getEvent('Opened'),[3,account,ALLOWED.NVDA,30000000]);const receipt={blockNumber:9,logs:[{address:engine,...e}]};assert.equal(ladderReceipt(receipt,r).id,'3');assert.throws(()=>ladderReceipt(receipt,{...r,account:engine}));assert.throws(()=>ladderReceipt({...receipt,logs:[{address:account,...e}]},r));
});
import {prepareExecution} from '../scripts/ladder-executor.mjs';
const engine='0x1111111111111111111111111111111111111111';
const clock=()=>1800000000000;
const strategy=()=>({owner:engine,token:ALLOWED.NVDA,active:true,expiresAt:1800003600n,tokens:0n,cost:0n,profitBps:500n,revision:3n});
const rows=[{price:parseUnits('90',18),budget:10000000n,remaining:10000000n}];
test('executor dry plan selects an eligible exact-budget buy with a fresh bounded route',async()=>{
 let asked;const p=await prepareExecution({engine,id:1n,s:strategy(),levels:rows,price:parseUnits('80',18),clock,quote:async q=>{asked=q;return{expiresAt:clock()+30000,minBuyAmount:String(minimumBuy(10000000n,parseUnits('80',18))),transaction:{data:'0x1234'}};}});
 assert.equal(p.method,'buy');assert.equal(asked.taker,engine);assert.equal(asked.sellAmount,'10000000');assert.equal(p.args[2],3n);assert.equal(p.args[3][0],10000000n);
});
test('executor refuses stopped/expired strategies and prices which do not trigger',async()=>{
 const quote=()=>{throw Error('Must not request a quote.');};
 for(const s of[{...strategy(),active:false},{...strategy(),expiresAt:1800000000n},strategy()]){const p=await prepareExecution({engine,id:1n,s,levels:rows,price:parseUnits('100',18),clock,quote});assert.ok(p.skip);}
});
test('executor exits the exact full position only after the net target can be met',async()=>{
 const s={...strategy(),tokens:parseUnits('1',18),cost:10000000n};let asked;
 const p=await prepareExecution({engine,id:1n,s,levels:[],price:parseUnits('11',18),clock,quote:async q=>{asked=q;return{expiresAt:clock()+30000,minBuyAmount:'10600000',transaction:{data:'0x1234'}};}});
 assert.equal(asked.side,'sell');assert.equal(asked.sellAmount,String(s.tokens));assert.equal(p.method,'sell');assert.equal(p.args[2][0],s.tokens);
});
test('executor refreshes expired quotes and skips routes whose minimum misses the limit',async()=>{
 const args={engine,id:1n,s:strategy(),levels:rows,price:parseUnits('80',18),clock};
 await assert.rejects(()=>prepareExecution({...args,quote:async()=>({expiresAt:clock()+1000})}),/expired/);
 const p=await prepareExecution({...args,quote:async()=>({expiresAt:clock()+30000,minBuyAmount:'1'})});assert.match(p.skip,/limit/);
});
