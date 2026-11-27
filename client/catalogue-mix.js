import {validateVaultSnapshot,SNAPSHOT_MAX_AGE} from '../shared/vault-catalogue.js';
import {completeValue,SCALE} from './finance.js';
import {currentWeights} from './reference.js';
import {validateMix} from './basket-radar.js';

export function catalogueMetrics(v,prices,{now=Date.now()}={}){
 const snapshot=validateVaultSnapshot(v),fresh=now-snapshot.checkedAt<=SNAPSHOT_MAX_AGE&&snapshot.checkedAt<=now+60000;
 const funded=BigInt(v.supply)>0n,backed=!funded||v.available.every(x=>BigInt(x)>0n);
 const priced=fresh&&backed&&v.symbols.every(s=>{const p=prices[s],age=now-Date.parse(p?.at);return p?.ok&&typeof p.mid18==='bigint'&&p.mid18>0n&&Number.isFinite(age)&&age<=120000&&age>=-60000;});
 const value=priced?completeValue(v.symbols,v.available,prices):null;
 return {fresh,funded,backed,priced,value,nav:funded&&value!==null?value*SCALE/BigInt(v.supply):null,currentBps:funded&&priced&&value>0n?currentWeights(v.symbols,v.available,prices):null};
}
function fitName(name){let value=name.trim();while(new TextEncoder().encode(value+' copy').length>48)value=[...value].slice(0,-1).join('');return value+' copy';}
export function copyCatalogueMix(value,prices,basis='starting',{now=Date.now()}={}){
 const v=validateVaultSnapshot(value),metrics=catalogueMetrics(v,prices,{now});
 if(!metrics.fresh)throw Error('Refresh this vault before copying its mix.');
 if(!['starting','current'].includes(basis))throw Error('Choose starting or current weights.');
 let weights=v.weights;
 if(basis==='current'){
  if(!metrics.funded)throw Error('This vault has no issued shares. Copy its starting weights.');
  if(!metrics.backed||!metrics.currentBps)throw Error('Fresh marks and complete active backing are required for current weights.');
  weights=metrics.currentBps;
  if(weights.some(x=>x===0))throw Error('A component is below 0.01%. Copy starting weights or revise the mix in your builder.');
 }
 const assets=v.symbols.map((symbol,i)=>({symbol,weight:String(weights[i]/100)}));validateMix(assets);
 return {draft:{name:fitName(v.name),symbol:v.symbol.slice(0,6)+'CP',thesis:v.thesis,maxSupply:'100',assets},origin:{address:v.address,creator:v.creator,name:v.name,basis,block:v.block,copiedAt:now}};
}
