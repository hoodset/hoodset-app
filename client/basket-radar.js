import { ALLOWED } from '../worker/assets.js';
import { SCALE, decimal, initialAmounts } from './finance.js';

export const RADAR_PERIODS = { OBSERVED:0, '1D':86400000, '1M':30*86400000, '1Y':365*86400000 };

// Retain real samples: minute marks for one day, hourly for one month, then daily.
// This allows a year of observations without silently limiting every chart to ~2 days.
export function retainObservations(history, now=Date.now()) {
  const seen=new Set(),out=[];
  for(const point of [...history].sort((a,b)=>(a?.at||0)-(b?.at||0))){
    if(!point||!Number.isFinite(point.at)||point.at>now||point.at<now-366*86400000||!/^\d+$/.test(point.value||'')||BigInt(point.value)<=0n)continue;
    const age=now-point.at,bucket=age<=86400000?60000:age<=30*86400000?3600000:86400000;
    const key=bucket+':'+Math.floor(point.at/bucket);
    if(!seen.has(key)){seen.add(key);out.push(point);}
  }
  return out;
}

export function mixRows(theme) {
  return theme.assets.map((symbol,i)=>({symbol,weight:String(theme.weights[i])}));
}

function validateAssets(rows) {
  if(!Array.isArray(rows)||rows.length<2||rows.length>12)throw Error('Choose 2–12 different assets.');
  if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw Error('Each token can appear only once.');
  if(rows.some(r=>!Object.hasOwn(ALLOWED,r.symbol)))throw Error('Choose a supported canonical Stock Token.');
}

export function validateMix(rows) {
  validateAssets(rows);
  let total=0n;
  const bps=rows.map(r=>{
    if(!Object.hasOwn(ALLOWED,r.symbol))throw Error('Choose a supported canonical Stock Token.');
    const value=decimal(r.weight,2);
    if(value<=0n||value>10000n)throw Error('Every weight must be above 0% and at most 100%.');
    total+=value;return Number(value);
  });
  if(total!==10000n)throw Error('Weights must total exactly 100%.');
  return {assets:rows.map(r=>r.symbol),weights:bps.map(x=>x/100),bps};
}

// Largest remainder allocation preserves the exact total at one basis point precision.
export function distribute(total, weights) {
  const sum=weights.reduce((a,b)=>a+BigInt(b),0n);
  if(total<0n||sum<=0n||weights.some(x=>BigInt(x)<0n))throw Error('Invalid allocation.');
  const raw=weights.map(w=>total*BigInt(w)),out=raw.map(x=>x/sum);
  const order=raw.map((x,i)=>({i,r:x%sum})).sort((a,b)=>a.r>b.r?-1:a.r<b.r?1:a.i-b.i);
  const missing=Number(total-out.reduce((a,b)=>a+b,0n));
  for(let i=0;i<missing;i++)out[order[i].i]++;
  return out;
}

export function rebalanceRows(rows, operation, symbol) {
  validateAssets(rows);
  const valid=operation==='equal'?{assets:rows.map(r=>r.symbol),bps:rows.map(()=>1)}:validateMix(rows);
  let assets=[...valid.assets],weights=[...valid.bps];
  if(operation==='remove'){
    if(assets.length<=2)throw Error('A basket needs at least two assets.');
    const i=assets.indexOf(symbol);if(i<0)throw Error('Token is not in this basket.');
    assets.splice(i,1);weights.splice(i,1);
  }else if(operation==='add'){
    if(assets.length>=12)throw Error('A basket supports at most 12 assets.');
    if(!Object.hasOwn(ALLOWED,symbol)||assets.includes(symbol))throw Error('Choose a different supported token.');
    const nextWeight=10000n/BigInt(assets.length+1);
    weights=distribute(10000n-nextWeight,weights).map(Number);
    assets.push(symbol);weights.push(Number(nextWeight));
  }else if(operation==='equal')weights=assets.map(()=>1);
  else throw Error('Unknown composition action.');
  const bps=distribute(10000n,weights);
  if(bps.some(x=>x<=0n))throw Error('An allocation became too small. Use equal weights first.');
  return assets.map((symbol,i)=>({symbol,weight:(Number(bps[i])/100).toFixed(2)}));
}

export function compositionKey(theme) {
  const v=validateMix(mixRows(theme));
  // Order is meaningful in the vault. The complete composition is the history identity.
  return 'mix:'+theme.id+':'+v.assets.map((s,i)=>s+'='+v.bps[i]).join(',');
}

export function resolvedThemes(base,saved={}) {
  return base.map(t=>{
    try {if(saved?.[t.id])return {...t,...validateMix(saved[t.id]),name:'Your mix / '+t.symbol,thesis:'Your saved composition. It may differ from the current '+t.name+' template.',templateName:t.name,custom:true};}catch{}
    return {...t,assets:[...t.assets],weights:[...t.weights],custom:false};
  });
}

export function mixSummary(theme) {
  const {bps}=validateMix(mixRows(theme));
  const largest=Math.max(...bps),i=bps.indexOf(largest);
  return {count:theme.assets.length,largestBps:largest,largestSymbol:theme.assets[i],etfs:theme.assets.filter(s=>['SPY','QQQ'].includes(s)).length};
}

export function budgetPlan(theme, budget, prices) {
  const {bps}=validateMix(mixRows(theme));
  const micros=decimal(budget,6);if(micros<=0n||micros>1000000000000n)throw Error('Enter a budget above 0 and at most 1,000,000 USDG.');
  const complete=theme.assets.every(s=>prices[s]?.ok&&prices[s].ask18>0n&&prices[s].mid18>0n);
  const amounts=complete?initialAmounts(mixRows(theme),prices).amounts:null;
  const costs=complete?amounts.map((q,i)=>q*prices[theme.assets[i]].ask18/SCALE):bps;
  const allocations=distribute(micros,costs);
  if(allocations.some(x=>x<=0n)||micros<=BigInt(theme.assets.length))throw Error('Increase the budget so every component has a positive allocation.');
  const askCost=complete?costs.reduce((a,b)=>a+b,0n):null;
  const shares18=complete?(micros-BigInt(theme.assets.length))*10n**12n*SCALE/askCost:null;
  if(complete&&shares18<=0n)throw Error('This budget is too small for a positive share estimate.');
  return {micros,complete,shares18,rows:theme.assets.map((symbol,i)=>({symbol,usdg:complete?allocations[i]:null,tokens:complete?allocations[i]*10n**12n*SCALE/prices[symbol].ask18:null}))};
}

export function observedPerformance(history, period='OBSERVED', now=Date.now(), fresh=true) {
  const empty=reason=>({ready:false,reason,returnBps:null,drawdownBps:null,points:[]});
  if(!fresh)return empty('Fresh prices are required for every component.');
  if(!Object.hasOwn(RADAR_PERIODS,period))return empty('Choose an available period.');
  const points=(Array.isArray(history)?history:[]).filter(x=>x&&Number.isFinite(x.at)&&x.at<=now&&/^\d+$/.test(x.value||'')&&BigInt(x.value)>0n).sort((a,b)=>a.at-b.at);
  if(points.length<2)return empty('Collecting actual marks for this composition.');
  const last=points.at(-1);
  if(now-last.at>120000)return empty('The latest observed mark is stale.');
  let start=points[0];
  if(period!=='OBSERVED'){
    const cutoff=now-RADAR_PERIODS[period];
    const before=points.filter(x=>x.at<=cutoff);start=before.at(-1);
    const tolerance=period==='1Y'?86400000:period==='1M'?3600000:120000;
    if(!start||cutoff-start.at>tolerance)return empty(period+' history is not available for this composition.');
  }
  const window=points.filter(x=>x.at>=start.at);
  if(window.length<2||last.at<=start.at)return empty('Another observation is needed.');
  const firstValue=BigInt(start.value),lastValue=BigInt(last.value);
  let peak=firstValue,drawdown=0n;
  for(const x of window){const value=BigInt(x.value);if(value>peak)peak=value;const dd=(peak-value)*10000n/peak;if(dd>drawdown)drawdown=dd;}
  return {ready:true,start:start.at,end:last.at,count:window.length,returnBps:Number((lastValue-firstValue)*10000n/firstValue),drawdownBps:Number(drawdown),points:window};
}
