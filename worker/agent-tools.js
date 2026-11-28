import {Interface} from 'ethers';
import {ALLOWED} from './assets.js';
import {BASE_THEMES} from '../client/themes.js';
import {historicalComparison,close18} from '../shared/market-history.js';
import {adjustedPrice,SCALE,decimal} from '../client/finance.js';
import {freshMark,referenceSpread} from '../client/market-analysis.js';
import {catalogueAddress} from '../shared/vault-catalogue.js';
import {agentJson} from '../shared/agent-plan.js';
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const symbol={type:'string',enum:Object.keys(ALLOWED)};
const mixSchema=object({assets:{type:'array',minItems:2,maxItems:12,uniqueItems:true,items:symbol},weights:{type:'array',minItems:2,maxItems:12,items:{type:'number',exclusiveMinimum:0,maximum:100}}},['assets','weights']);
const address={type:'string',pattern:'^0x[0-9a-fA-F]{40}$'};
const period={type:'string',enum:['1M','1Y'],default:'1Y'};
const define=(name,title,description,inputSchema)=>({name,title,description:description+' One successful call costs 1 request credit. No trade is submitted.',inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}});
export const AGENT_TOOLS=[
 define('list_baskets','Public basket catalogue','List runtime-verified shared HOODSET vaults, supported editorial starting sets and unavailable catalogue records. An editorial set is not an issued vault.',object({after:{...address,description:'Pagination cursor from the previous response.'}})),
 define('inspect_basket','Inspect actual vault backing','Read a supported vault at one recent RH block: active and reserved token balances, supply, fixed composition and the pro-rata claim for the requested share amount. Supply zero has no live per-share backing.',object({address,shares:{type:'string',pattern:'^(0|[1-9][0-9]{0,6})(\\.[0-9]{1,18})?$'}},['address'])),
 define('get_basket_observations','Recorded vault observations','Return up to 100 actual server-recorded snapshots, collected on inspect_basket calls. No background collection, interpolated prices or synthetic pre-inception history. Use observedAt as the next after cursor.',object({address,after:{type:'integer',minimum:0}},['address'])),
 define('analyze_mix','Mix performance and SPY','Retrospective fixed-quantity analysis of today’s chosen supported mix against SPY on identical 1M/1Y daily closes, including component contributions. Underlying-price history is not an issued vault track record.',object({mix:mixSchema,period},['mix'])),
 define('compare_mixes','Compare two compositions','Compare two chosen starting mixes over the same completed sessions and show asset/starting-weight differences. Neither mix is automatically traded or rebalanced.',object({left:mixSchema,right:mixSchema,period},['left','right'])),
 define('get_reference_spreads','RH reference bid/ask','Fresh RH reference bid/ask adjusted once for each canonical Stock Token multiplier. No executable liquidity, swap route or profit is implied. A missing selected mark fails the whole call without charge.',object({symbols:{type:'array',items:symbol,uniqueItems:true,minItems:1,maxItems:17}},['symbols']))
];
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exact(v,keys,required=[]){if(!plain(v)||Object.keys(v).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(v,k)))throw Error('Arguments do not match the tool schema.');}
export function cleanAgentMix(m){exact(m,['assets','weights'],['assets','weights']);if(!Array.isArray(m.assets)||m.assets.length<2||m.assets.length>12||new Set(m.assets).size!==m.assets.length||m.assets.some(s=>!Object.hasOwn(ALLOWED,s))||!Array.isArray(m.weights)||m.weights.length!==m.assets.length||m.weights.some(w=>typeof w!=='number'||!Number.isFinite(w)||w<=0||w>100||Math.abs(w*100-Math.round(w*100))>1e-7)||m.weights.reduce((a,b)=>a+Math.round(b*100),0)!==10000)throw Error('Choose 2–12 distinct supported assets with positive starting weights totaling exactly 100%, to two decimals.');return {assets:[...m.assets],weights:[...m.weights]};}
export function agentArguments(name,args={}){
 if(!AGENT_TOOLS.some(t=>t.name===name))throw Error('Unknown HOODSET tool.');
 const a=structuredClone(args);
 if(name==='list_baskets'){exact(a,['after']);if(a.after!==undefined)a.after=catalogueAddress(a.after);}
 if(name==='inspect_basket'||name==='get_basket_observations'){exact(a,name==='inspect_basket'?['address','shares']:['address','after'],['address']);a.address=catalogueAddress(a.address);if(name==='inspect_basket'){a.shares=a.shares??'1';if(typeof a.shares!=='string'||a.shares.length>27||decimal(a.shares)<=0n||decimal(a.shares)>1000000n*SCALE)throw Error('Share amount must be greater than zero and no more than 1,000,000.');}else if(a.after!==undefined&&(!Number.isSafeInteger(a.after)||a.after<0))throw Error('Invalid observation cursor.');}
 if(['analyze_mix','compare_mixes'].includes(name)){exact(a,name==='analyze_mix'?['mix','period']:['left','right','period'],name==='analyze_mix'?['mix']:['left','right']);a.period=a.period??'1Y';if(!['1M','1Y'].includes(a.period))throw Error('Choose 1M or 1Y.');for(const k of name==='analyze_mix'?['mix']:['left','right'])a[k]=cleanAgentMix(a[k]);}
 if(name==='get_reference_spreads'){exact(a,['symbols'],['symbols']);if(!Array.isArray(a.symbols)||!a.symbols.length||a.symbols.length>17||new Set(a.symbols).size!==a.symbols.length||a.symbols.some(s=>!Object.hasOwn(ALLOWED,s)))throw Error('Choose distinct supported Stock Token symbols.');}
 return a;
}
function analysis(mix,history,period,now){
 const r=historicalComparison(mix,history,period,now);if(!r.ready)throw Error(r.reason);
 const components=mix.assets.map((symbol,i)=>{const p=history.series[symbol].points,first=close18(p.find(p=>p.date===r.basket.startDate).close),last=close18(p.find(p=>p.date===r.basket.endDate).close);return {symbol,startingWeightPercent:mix.weights[i],priceReturnPercent:Number((last-first)*1000000n/first)/10000,contributionPercentagePoints:Number((last-first)*BigInt(Math.round(mix.weights[i]*100))*100n/first)/10000};});
 return {mix,period,start:r.basket.startDate,end:r.basket.endDate,completedSessions:r.basket.count,returnBps:r.basket.returnBps,maximumDailyCloseDrawdownBps:r.basket.drawdownBps,benchmark:{symbol:'SPY',returnBps:r.benchmark.returnBps,differenceBps:r.differenceBps},components,points:r.basket.points.map(p=>({date:p.date,value18:p.value})),basis:'Retrospective split-adjusted underlying closes; fixed starting quantities. No dividends, fees, gas or RH multiplier history. Not an issued vault track record.',source:{provider:history.provider,url:history.sourceUrl,license:history.license,snapshot:history.snapshot}};
}
export function createAgentTools({publicApi,rpc,readVault,store,clock=Date.now}){
 const token=new Interface(['function decimals() view returns(uint8)','function uiMultiplier() view returns(uint256)','function oraclePaused() view returns(bool)']);
 async function marks(symbols){
  const [registry,rows,chain,block]=await Promise.all([publicApi('assets'),publicApi('prices?symbols='+symbols.join(',')),rpc('eth_chainId',[]),rpc('eth_getBlockByNumber',['latest',false])]);if(BigInt(chain)!==4663n)throw Error('Wrong price-reader network.');
  const result={};await Promise.all(symbols.map(async s=>{const a=registry.assets.find(a=>a.tokenSymbol===s&&a.deployments?.some(d=>d.chainId===4663&&d.contractAddress.toLowerCase()===ALLOWED[s].toLowerCase()));if(!a)throw Error(s+': canonical registry entry unavailable.');const call=async fn=>token.decodeFunctionResult(fn,await rpc('eth_call',[{to:ALLOWED[s],data:token.encodeFunctionData(fn)},block.number]))[0];const [decimals,multiplier,paused]=await Promise.all(['decimals','uiMultiplier','oraclePaused'].map(call));result[s]=adjustedPrice(a,rows.prices.find(p=>p.symbol===s)?.quote,{decimals:Number(decimals),multiplier,paused},clock());freshMark(s,result,clock());}));return result;
 }
 return async function execute(name,args){
  const a=agentArguments(name,args),now=clock();
  if(name==='list_baskets'){const page=await publicApi('catalogue'+(a.after?'?after='+a.after:''));return {...page,editorialSets:BASE_THEMES.map(t=>({id:t.id,name:t.name,assets:t.assets,startingWeightsPercent:t.weights,thesis:t.thesis,issuedVault:false}))};}
  if(name==='inspect_basket'){
   const v=await readVault(a.address);await store.observe(v,now);const supply=BigInt(v.supply),shares=decimal(a.shares);if(supply>0n&&shares>supply)throw Error('Requested shares exceed this vault’s total issued supply.');
   return {vault:v,compositionVersion:1,composition:'Fixed at deployment; a new mix requires a new vault.',requestedShares18:String(shares),claim:supply>0n?v.symbols.map((symbol,i)=>({symbol,token:ALLOWED[symbol],quantity18:String(BigInt(v.available[i])*shares/supply)})):null,claimStatus:supply>0n?'Pro-rata active backing, rounded down; not a wallet balance or executable sale.':'No issued shares. Current per-share backing is unavailable; initial quantities are not presented as funded backing.',units:'All token quantities are 18-decimal Stock Token units, not underlying shareholder rights.'};
  }
  if(name==='get_basket_observations'){const observations=await store.observations(a.address,a.after||0);return {address:a.address,observations,next:observations.length===100?observations.at(-1).observedAt:null,collection:'On-demand verified snapshots from inspect_basket; at most one per minute, last 1,500 per vault. No background history or interpolation.'};}
  if(name==='get_reference_spreads'){const prices=await marks(a.symbols);return JSON.parse(agentJson({chainId:4663,quotes:a.symbols.map(s=>referenceSpread(s,prices,now)),units:'bid/ask/mid/difference are USD scaled by 1e18; spreadBps is basis points.',basis:'RH underlying bid/ask adjusted exactly once by the current onchain token multiplier; not executable pool quotes.'}));}
  const symbols=[...new Set((name==='analyze_mix'?a.mix.assets:[...a.left.assets,...a.right.assets]))],history=await publicApi('history?symbols='+symbols.join(','));
  if(name==='analyze_mix')return analysis(a.mix,history,a.period,now);
  const left=analysis(a.left,history,a.period,now),right=analysis(a.right,history,a.period,now);if(left.start!==right.start||left.end!==right.end)throw Error('Mixes do not share a complete historical window.');
  return {left,right,returnDifferenceBps:left.returnBps-right.returnBps,startingWeightChangesPercent:symbols.map(symbol=>({symbol,before:a.left.weights[a.left.assets.indexOf(symbol)]||0,after:a.right.weights[a.right.assets.indexOf(symbol)]||0})),basis:'Comparison of explicitly supplied starting mixes, not a deployed vault rebalance or investment signal.'};
 };
}
