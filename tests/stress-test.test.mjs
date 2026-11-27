import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import {stressScenario,shockBps,scenarioRecord,validScenarios,SCENARIO_LIMIT} from '../client/stress-test.js';
import {holderAccess,readHsetHolder,HSET_ADDRESS,HSET_MINIMUM,HOLDER_FRESH_MS} from '../client/hset-holder.js';
import {createStressUI} from '../client/stress-ui.js';

const mix={id:'test',name:'Test mix',assets:['NVDA','AMD'],weights:[50,50]},account='0x2980397cc5b7e14dc858c865410b0b79c9db268d';
test('a 20% fall in a half-weight component loses exactly 10% of the hypothetical basket',()=>{
  const r=stressScenario(mix,'1000',{NVDA:'-20',AMD:'0'});
  assert.equal(r.startCents,100000n);assert.equal(r.changeCents,-10000n);assert.equal(r.endCents,90000n);assert.equal(r.returnBps,-1000);
  assert.equal(r.rows[0].changeCents,-10000n);assert.equal(r.rows[1].changeCents,0n);
});
test('component cents reconcile exactly across fractional allocations and mixed shocks',()=>{
  const t={...mix,assets:['NVDA','AMD','AVGO'],weights:[33.34,33.33,33.33]};
  const r=stressScenario(t,'1234.57',{NVDA:'-17.25',AMD:'5.73',AVGO:'0.01'});
  assert.equal(r.rows.reduce((s,r)=>s+r.startCents,0n),r.startCents);
  assert.equal(r.rows.reduce((s,r)=>s+r.changeCents,0n),r.changeCents);
  assert.equal(r.rows.reduce((s,r)=>s+r.endCents,0n),r.endCents);
  assert.equal(r.endCents,r.startCents+r.changeCents);
});
test('a complete wipeout reaches zero and permitted positive shocks remain explicit scenarios',()=>{
  const lost=stressScenario(mix,'1',{NVDA:'-100',AMD:'-100'});assert.equal(lost.endCents,0n);assert.equal(lost.returnBps,-10000);
  assert.equal(stressScenario(mix,'100',{NVDA:'500',AMD:'500'}).endCents,60000n);
  assert.equal(shockBps('-0.01'),-1n);assert.equal(shockBps('0.01'),1n);
});
test('invalid and incomplete scenarios stop the calculation rather than dropping an asset',()=>{
  for(const s of ['','-','-100.01','500.01','1e2','NaN','Infinity','0.001',' 5','+20'])assert.throws(()=>shockBps(s));
  for(const b of ['0','0.99','1.001','1000000.01','-1','NaN'])assert.throws(()=>stressScenario(mix,b));
  assert.throws(()=>stressScenario(mix,'100',{FAKE:'-10'}));
  assert.throws(()=>stressScenario({...mix,weights:[50,49]},'100'));
  assert.throws(()=>stressScenario({...mix,assets:['NVDA','FAKE']},'100'));
});
test('concentration describes token weights and never expands ETF underlying holdings',()=>{
  assert.equal(stressScenario(mix,'100').effectiveCount,2);
  const r=stressScenario({...mix,assets:['NVDA','AMD','AVGO','SPY'],weights:[70,10,10,10]},'100');
  assert.equal(r.top3Bps,9000);assert.equal(r.largest.symbol,'NVDA');assert.ok(Math.abs(r.effectiveCount-1/0.52)<1e-12);
  assert.equal(stressScenario({...mix,assets:['SPY','QQQ']},'100').effectiveCount,2);
});
test('saved records retain their own composition and reject corrupt or injected state',()=>{
  const r=scenarioRecord(mix,'1000',{NVDA:'-20'},' Downside ',100,'record-1');
  assert.equal(r.label,'Downside');assert.deepEqual(r.shocks,{NVDA:'-20',AMD:'0'});assert.equal(r.mix.name,mix.name);
  const rows=validScenarios([r,{...r,id:'record-2',shocks:{NVDA:'bad'}},r,null,{...r,id:'\" onclick='}]);assert.deepEqual(rows,[r]);
  assert.throws(()=>scenarioRecord(mix,'100',{},' '.repeat(10)));assert.throws(()=>scenarioRecord(mix,'100',{},'x'.repeat(41)));
  assert.equal(validScenarios(Array.from({length:20},(_,i)=>({...r,id:'record-'+i}))).length,SCENARIO_LIMIT);
});
test('holder access requires a fresh account-bound mainnet balance of at least one HSET',()=>{
  const now=Date.now(),proof={account,chain:4663,block:123,checkedAt:now,balance:HSET_MINIMUM};
  assert.equal(holderAccess(proof,account,4663,now),true);
  assert.equal(holderAccess({...proof,balance:HSET_MINIMUM-1n},account,4663,now),false);
  assert.equal(holderAccess(proof,account,46630,now),false);
  assert.equal(holderAccess(proof,'0x0000000000000000000000000000000000000001',4663,now),false);
  assert.equal(holderAccess(proof,account,4663,now+HOLDER_FRESH_MS+1),false);
  assert.equal(holderAccess(proof,account,4663,now-1),false);
  assert.equal(holderAccess({...proof,block:0},account,4663,now),false);
  assert.equal(holderAccess(proof,null,4663,now),false);
});
const abi=new Interface(['function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
const runtime=fs.readFileSync(new URL('./fixtures/hset-runtime.hex',import.meta.url),'utf8').trim();
function reader(options={}){
  const calls=[];return {calls,send:async(method)=>{assert.equal(method,'eth_chainId');return options.chain||'0x1237';},getBlockNumber:async()=>123456,getCode:async(address,block)=>{calls.push({kind:'code',address,block});return options.code||runtime;},call:async tx=>{
    const f=abi.parseTransaction({data:tx.data});calls.push({kind:f.name,address:tx.to,block:tx.blockTag,args:f.args});
    return abi.encodeFunctionResult(f.name,[f.name==='symbol'?(options.symbol||'HSET'):f.name==='decimals'?(options.decimals??18):options.balance??HSET_MINIMUM]);
  }};
}
test('the holder reader pins identity and reads metadata and balance at one concrete block',async()=>{
  const p=reader(),proof=await readHsetHolder(p,account);assert.equal(proof.balance,HSET_MINIMUM);assert.equal(proof.block,123456);
  assert.equal(p.calls.length,4);assert.ok(p.calls.every(c=>c.block===123456));assert.ok(p.calls.every(c=>c.address.toLowerCase()===HSET_ADDRESS));
  assert.equal(p.calls.find(c=>c.kind==='balanceOf').args[0].toLowerCase(),account);
});
test('wrong networks, runtime or token metadata never grant holder access',async()=>{
  for(const o of [{chain:'0x1'},{code:'0x6000'},{symbol:'FAKE'},{decimals:6}])await assert.rejects(readHsetHolder(reader(o),account));
});
function ui(options={}){
  const state={account,session:1,chain:4663},saved={},memory=new Map(),p=reader(options),notices=[];
  const storage={getItem:k=>memory.get(k)||null};
  const d={state,saved,storage,storageKey:'test',reader:()=>p,esc:s=>String(s??'').replace(/[<>"&]/g,'_'),btn:(label,action,cls='',attrs='',disabled=false)=>`<button data-action="${action}" ${attrs} ${disabled?'disabled':''}>${label}</button>`,render:()=>{},notify:s=>notices.push(s),save:()=>{if(!options.storageFails)memory.set('test',JSON.stringify(saved));}};
  return {...d,ui:createStressUI(d),p,notices};
}
test('holder workspace verifies real read calls, saves independent scenarios and uses matching shocks',async()=>{
  const t=ui();t.ui.render(mix);await t.ui.action('stress-check-holder',{});await t.ui.action('stress-save',{});
  assert.equal(t.saved.stressScenarios[account].length,1);assert.match(t.notices[0],/saved/);
  await t.ui.action('stress-all',{});await t.ui.action('stress-save',{});
  const rows=t.saved.stressScenarios[account];assert.equal(rows.length,2);assert.notDeepEqual(rows[0].shocks,rows[1].shocks);
  await t.ui.action('stress-use',{dataset:{id:rows[0].id}});assert.match(t.ui.render(mix),/value="-20"/);
  await t.ui.action('stress-remove',{dataset:{id:rows[0].id}});assert.equal(t.saved.stressScenarios[account].length,1);
});
test('missing holder balance or changed wallet cannot save, and a balance is checked again for each write',async()=>{
  const t=ui({balance:0n});t.ui.render(mix);await t.ui.action('stress-check-holder',{});await t.ui.action('stress-save',{});assert.equal(t.saved.stressScenarios,undefined);
  const a=ui();a.ui.render(mix);await a.ui.action('stress-check-holder',{});const n=a.p.calls.length;await a.ui.action('stress-save',{});assert.ok(a.p.calls.length>n);
  a.state.account='0x0000000000000000000000000000000000000001';await a.ui.action('stress-save',{});assert.equal(a.saved.stressScenarios[a.state.account],undefined);
});
test('failed local persistence is reported without claiming success or losing previous records',async()=>{
  const t=ui({storageFails:true});t.ui.render(mix);await t.ui.action('stress-check-holder',{});await t.ui.action('stress-save',{});
  assert.equal(t.saved.stressScenarios[account],undefined);assert.equal(t.notices.length,0);assert.match(t.ui.render(mix),/Could not save the scenario library/);
});
test('a new wallet session and tokens leaving the wallet invalidate saving',async()=>{
  const o={},t=ui(o);t.ui.render(mix);await t.ui.action('stress-check-holder',{});t.state.session++;
  await t.ui.action('stress-save',{});assert.equal(t.saved.stressScenarios,undefined);
  await t.ui.action('stress-check-holder',{});o.balance=0n;await t.ui.action('stress-save',{});assert.equal(t.saved.stressScenarios,undefined);
});
test('a later failed storage write retains existing saved scenarios',async()=>{
  const o={},t=ui(o);t.ui.render(mix);await t.ui.action('stress-check-holder',{});await t.ui.action('stress-save',{});
  const before=structuredClone(t.saved.stressScenarios);o.storageFails=true;await t.ui.action('stress-save',{});
  assert.deepEqual(t.saved.stressScenarios,before);assert.equal(t.notices.length,1);
});
