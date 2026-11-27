import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_THEMES } from '../client/themes.js';
import { ALLOWED } from '../worker/assets.js';
import { mixRows,validateMix,distribute,rebalanceRows,compositionKey,resolvedThemes,mixSummary,budgetPlan,observedPerformance,retainObservations } from '../client/basket-radar.js';
const S=10n**18n;
const mix={id:'test',assets:['NVDA','AMD'],weights:[50,50]};
const prices={NVDA:{ok:true,ask18:10n*S,mid18:10n*S},AMD:{ok:true,ask18:20n*S,mid18:20n*S}};

test('templates have valid positive 100% allocations from the pinned canonical universe',()=>{
  for(const t of BASE_THEMES){assert.doesNotThrow(()=>validateMix(mixRows(t)));assert.equal(t.assets.every(s=>Object.hasOwn(ALLOWED,s)),true);}
  assert.equal(BASE_THEMES.find(t=>t.id==='big-tech').assets.length,5);
  assert.equal(BASE_THEMES.find(t=>t.id==='ai-chips').assets.length,3);
});

test('adding, removing and equalizing preserve exact weights and the 2–12 asset limits',()=>{
  const added=rebalanceRows(mixRows(mix),'add','MSFT');
  assert.equal(validateMix(added).bps.reduce((a,b)=>a+b,0),10000);
  assert.deepEqual(validateMix(added).bps,[3334,3333,3333]);
  const removed=rebalanceRows(added,'remove','MSFT');
  assert.equal(validateMix(removed).bps.reduce((a,b)=>a+b,0),10000);
  assert.throws(()=>rebalanceRows(removed,'remove','NVDA'),/at least two/);
  assert.throws(()=>rebalanceRows(added,'add','NVDA'),/different/);
  const twelve=Object.keys(ALLOWED).slice(0,12).map((symbol,i)=>({symbol,weight:i===0?'8.37':'8.33'}));
  assert.equal(validateMix(twelve).bps.reduce((a,b)=>a+b,0),10000);
  assert.throws(()=>rebalanceRows(twelve,'add',Object.keys(ALLOWED)[12]),/at most 12/);
});

test('equal weights repairs an incomplete manual allocation; invalid inputs cannot be saved',()=>{
  const dirty=[{symbol:'NVDA',weight:''},{symbol:'AMD',weight:'99'}];
  assert.throws(()=>validateMix(dirty));
  assert.deepEqual(validateMix(rebalanceRows(dirty,'equal')).bps,[5000,5000]);
  for(const rows of [[{symbol:'FAKE',weight:'50'},{symbol:'AMD',weight:'50'}],[{symbol:'NVDA',weight:'0'},{symbol:'AMD',weight:'100'}],[{symbol:'NVDA',weight:'50.001'},{symbol:'AMD',weight:'49.999'}]])assert.throws(()=>validateMix(rows));
});

test('composition identities isolate edited histories and malformed saved mixes fall back to the template',()=>{
  const altered={...mix,weights:[60,40]};
  assert.notEqual(compositionKey(mix),compositionKey(altered));
  assert.equal(compositionKey(mix),compositionKey(JSON.parse(JSON.stringify(mix))));
  const [restored]=resolvedThemes([mix],{test:[{symbol:'FAKE',weight:'50'},{symbol:'AMD',weight:'50'}]});
  assert.deepEqual(restored.assets,mix.assets);
  assert.equal(restored.custom,false);
  const [kept]=resolvedThemes([mix],{test:[{symbol:'NVDA',weight:'60'},{symbol:'MSFT',weight:'40'}]});
  assert.deepEqual(kept.assets,['NVDA','MSFT']);
  assert.equal(kept.custom,true);
  assert.match(kept.name,/Your mix/);
});

test('budget micros add up exactly; token estimates cannot spend beyond the allocation',()=>{
  const plan=budgetPlan(mix,'5.000001',prices);
  assert.equal(plan.rows.reduce((sum,r)=>sum+r.usdg,0n),5000001n);
  assert.equal(plan.rows[0].tokens,2500001n*10n**12n*S/prices.NVDA.ask18);
  for(const r of plan.rows)assert.ok(r.tokens*prices[r.symbol].ask18/S<=r.usdg*10n**12n);
  for(const amount of ['0','-1','1e6','1.0000001','1000000.000001','0.000001'])assert.throws(()=>budgetPlan(mix,amount,prices));
  assert.deepEqual(distribute(5n,[1,1,1]),[2n,2n,1n]);
});

test('one unavailable component pauses the entire token estimate, preserving all rows and weights',()=>{
  const plan=budgetPlan(mix,'5',{...prices,AMD:{ok:false}});
  assert.equal(plan.complete,false);
  assert.equal(plan.rows.length,2);
  assert.equal(plan.rows.every(r=>r.tokens===null),true);
});

test('buy budgets account for different bid/ask spreads instead of mistaking spend weights for exposure weights',()=>{
  const wide={...prices,NVDA:{...prices.NVDA,ask18:20n*S}};
  const plan=budgetPlan(mix,'5',wide);
  assert.equal(plan.rows[0].usdg,3333333n);
  assert.equal(plan.rows[1].usdg,1666667n);
  const needs=[5n*S,25n*S/10n].map(q=>(q*plan.shares18+S-1n)/S);
  const estimates=needs.map((q,i)=>(q*wide[mix.assets[i]].ask18+S*10n**12n-1n)/(S*10n**12n));
  assert.ok(estimates.reduce((a,b)=>a+b,0n)<=5000000n);
  assert.ok(plan.shares18>0n);
});

test('composition statistics describe token concentration and ETF count without inventing a risk score',()=>{
  assert.deepEqual(mixSummary(mix),{count:2,largestBps:5000,largestSymbol:'NVDA',etfs:0});
  assert.equal(mixSummary(BASE_THEMES.find(t=>t.id==='market-core')).etfs,2);
});

test('performance uses actual endpoints and observed peak-to-trough declines',()=>{
  const points=[100,120,100,110].map((value,i)=>({at:i*60000,value:String(BigInt(value)*S)}));
  const result=observedPerformance(points,'OBSERVED',180000,true);
  assert.equal(result.ready,true);assert.equal(result.returnBps,1000);assert.equal(result.drawdownBps,1666);assert.equal(result.count,4);
});

test('missing annual coverage, stale marks and invalid observations never turn into fabricated returns',()=>{
  const now=2000000000000,points=[{at:now-86400000,value:String(100n*S)},{at:now,value:String(110n*S)}];
  assert.equal(observedPerformance(points,'1D',now).returnBps,1000);
  assert.equal(observedPerformance(points,'1Y',now).ready,false);
  assert.equal(observedPerformance(points,'OBSERVED',now+120001).ready,false);
  assert.equal(observedPerformance(points,'OBSERVED',now,false).ready,false);
  assert.equal(observedPerformance([null,{at:now,value:'bad'}],'OBSERVED',now).returnBps,null);
  assert.equal(observedPerformance([{at:now-1000,value:'1'},{at:now,value:'0'}],'OBSERVED',now).ready,false);
});

test('long observation retention keeps actual marks across a year without interpolating new values',()=>{
  const now=2000000000000,points=[];
  for(let i=366*24;i>=0;i--)points.push({at:now-i*3600000,value:String((100n+BigInt(i%10))*S)});
  const retained=retainObservations(points,now);
  assert.ok(retained.length<1200);
  assert.ok(retained[0].at<=now-365*86400000);
  assert.equal(retained.at(-1).at,now);
  assert.ok(retained.every(p=>points.includes(p)));
  assert.equal(observedPerformance(retained,'1Y',now).ready,true);
});
