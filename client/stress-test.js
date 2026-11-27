import {mixRows,validateMix,distribute} from './basket-radar.js';
import {decimal} from './finance.js';

export const SCENARIO_LIMIT=12;
const BPS=10000n;
export function shockBps(value){
  const s=String(value),m=/^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(s);
  if(!m)throw Error('Use a price change from -100% to +500%, with up to two decimals.');
  const n=(BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0')))*(m[1]?-1n:1n);
  if(n< -10000n||n>50000n)throw Error('Price changes must stay between -100% and +500%.');
  return n;
}
function round(n,d){return n<0n?-((-n+d/2n)/d):(n+d/2n)/d;}
export function stressScenario(theme,budget,shocks={}){
  const {assets,bps}=validateMix(mixRows(theme));
  const cents=decimal(budget,2);
  if(cents<100n||cents>100000000n)throw Error('Choose a hypothetical amount from $1 to $1,000,000, with up to two decimals.');
  if(!shocks||Array.isArray(shocks)||typeof shocks!=='object'||Object.keys(shocks).some(s=>!assets.includes(s)))throw Error('The price changes do not match this mix.');
  const allocations=distribute(cents,bps);
  const rows=assets.map((symbol,i)=>{const shock=shockBps(shocks[symbol]??'0'),change=round(allocations[i]*shock,BPS);return {symbol,weightBps:bps[i],shockBps:shock,startCents:allocations[i],changeCents:change,endCents:allocations[i]+change};});
  const changeCents=rows.reduce((sum,r)=>sum+r.changeCents,0n);
  const ranked=[...rows].sort((a,b)=>b.weightBps-a.weightBps),squares=bps.reduce((sum,x)=>sum+x*x,0);
  return {rows,startCents:cents,changeCents,endCents:cents+changeCents,returnBps:Number(changeCents*BPS)/Number(cents),largest:ranked[0],top3Bps:ranked.slice(0,3).reduce((sum,r)=>sum+r.weightBps,0),effectiveCount:100000000/squares,key:assets.map((s,i)=>s+'='+bps[i]).join(',')};
}
export function scenarioRecord(theme,budget,shocks,label,now=Date.now(),id=crypto.randomUUID()){
  stressScenario(theme,budget,shocks);
  if(typeof label!=='string'||!label.trim()||label.trim().length>40)throw Error('Name the scenario using 1–40 characters.');
  if(!Number.isSafeInteger(now)||now<0||!/^[-a-zA-Z0-9]{1,64}$/.test(id))throw Error('Invalid scenario identity.');
  return {id,at:now,label:label.trim(),mix:{id:'saved-stress',name:String(theme.name).slice(0,80),assets:[...theme.assets],weights:[...theme.weights]},budget:String(budget),shocks:Object.fromEntries(theme.assets.map(s=>[s,String(shocks[s]??'0')]))};
}
export function validScenarios(rows){
  const seen=new Set();return (Array.isArray(rows)?rows:[]).slice(0,SCENARIO_LIMIT).flatMap(r=>{try{const clean=scenarioRecord(r.mix,r.budget,r.shocks,r.label,r.at,r.id);if(seen.has(clean.id))return [];seen.add(clean.id);return [clean];}catch{return [];}});
}
