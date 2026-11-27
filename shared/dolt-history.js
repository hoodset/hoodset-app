import {ALLOWED} from '../worker/assets.js';
import {validDay,close18,nyDay} from './market-history.js';

export const DOLT_SOURCE='DoltHub / post-no-preference/stocks';
export const DOLT_URL='https://www.dolthub.com/repositories/post-no-preference/stocks';
export const DOLT_API='https://www.dolthub.com/api/v1alpha1/post-no-preference/stocks/master';
export const DATA_LICENSE={name:'CC BY-SA 4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/',textUrl:'/data/LICENSE-stock-history.txt',author:'post-no-preference',source:DOLT_URL,changes:'Selected US instruments; date validation, split-only normalization and fixed-quantity basket calculations by HOODSET. No cash-dividend adjustment. Data and adaptations remain CC BY-SA 4.0. No endorsement; provided as is.'};
export const LICENSE_HASH='23ee78c8bae49cf08ea2f0c84945c66b987ebe4520881fb51b3dad4fb43d07c2';
const symbols=Object.keys(ALLOWED),DAY=86400000,SCALE=10n**18n;
const sqlList=values=>values.map(s=>"'"+s+"'").join(',');
export function revisionRef(value){if(typeof value!=='string'||!/^[0-9a-v]{32}$/.test(value))throw Error('Invalid history snapshot revision.');return value;}
export function historyDays(now=Date.now()){
  const end=Date.parse(nyDay(now)),days=[];
  for(let at=end-410*DAY;at<end;at+=DAY){const d=new Date(at);if(d.getUTCDay()%6!==0)days.push(d.toISOString().slice(0,10));}
  return days;
}
export function priceQuery(days,revision){
  if(!Array.isArray(days)||!days.length||days.length>40||new Set(days).size!==days.length||days.some(d=>!validDay(d)))throw Error('Invalid history date batch.');
  return `SELECT act_symbol,date,close FROM ohlcv AS OF '${revisionRef(revision)}' WHERE date IN (${sqlList(days)}) AND act_symbol IN (${sqlList(symbols)}) ORDER BY date,act_symbol`;
}
export function metadataQueries(revision,from,through){
  if(!validDay(from)||!validDay(through))throw Error('Invalid history metadata window.');
  const ref=` AS OF '${revisionRef(revision)}'`;
  return {identities:`SELECT act_symbol,security_name,listing_exchange,is_etf,is_test_issue,last_seen FROM symbol${ref} WHERE act_symbol IN (${sqlList(symbols)})`,splits:`SELECT act_symbol,ex_date,to_factor,for_factor FROM split${ref} WHERE act_symbol IN (${sqlList(symbols)}) AND ex_date>='${from}' AND ex_date<'${through}' ORDER BY act_symbol,ex_date`};
}
export function validateIdentities(rows){
  if(!Array.isArray(rows)||rows.length!==symbols.length||new Set(rows.map(r=>r.act_symbol)).size!==symbols.length)throw Error('History instrument coverage changed.');
  for(const row of rows){if(!Object.hasOwn(ALLOWED,row.act_symbol)||String(row.is_test_issue)!=='0'||String(row.is_etf)!==(['SPY','QQQ'].includes(row.act_symbol)?'1':'0')||typeof row.security_name!=='string'||!row.security_name.length||!['NASDAQ','NYSE','NYSE ARCA','NYSE American','CBOE'].includes(row.listing_exchange))throw Error('History instrument identity mismatch.');}
}
export function validatePriceRows(rows,days){
  if(!Array.isArray(rows)||rows.length>days.length*symbols.length)throw Error('History response exceeds its bounded date request.');
  const seen=new Set(),allowed=new Set(days);
  for(const row of rows){const key=row.act_symbol+':'+row.date;if(!Object.hasOwn(ALLOWED,row.act_symbol)||!allowed.has(row.date)||seen.has(key))throw Error('Unexpected or duplicate historical bar.');close18(row.close);seen.add(key);}
  return rows;
}
export function validateSplits(rows){
  if(!Array.isArray(rows)||rows.length>1000)throw Error('Split history exceeds the supported bound.');
  const seen=new Set();
  for(const row of rows){const key=row.act_symbol+':'+row.ex_date;if(!Object.hasOwn(ALLOWED,row.act_symbol)||!validDay(row.ex_date)||seen.has(key)||close18(row.to_factor)<=0n||close18(row.for_factor)<=0n)throw Error('Invalid or duplicate split adjustment.');seen.add(key);}
}
export function snapshotSeries(bundle,now=Date.now()){
  if(bundle.priceBasis!=='as-traded'||!Array.isArray(bundle.rows)||bundle.rows.length>9000)throw Error('Invalid raw historical snapshot.');
  validateIdentities(bundle.identities);validateSplits(bundle.splits);revisionRef(bundle.revision);
  const days=historyDays(now),first=days[0],today=nyDay(now),series={},errors={};
  const relevant=bundle.rows.filter(r=>r.date>=first&&r.date<today);
  validatePriceRows(relevant,days);
  for(const symbol of symbols){
    try{
      const raw=relevant.filter(r=>r.act_symbol===symbol).sort((a,b)=>a.date.localeCompare(b.date));
      if(raw.length<2)throw Error('Completed daily prices are missing.');
      const splits=bundle.splits.filter(s=>s.act_symbol===symbol&&s.ex_date<today);
      const points=raw.map(row=>{let numerator=1n,denominator=1n;for(const split of splits)if(row.date<split.ex_date){numerator*=close18(split.for_factor);denominator*=close18(split.to_factor);}
        const value=close18(row.close)*numerator/denominator;if(value<=0n)throw Error('Split-adjusted price is too small.');
        const close=(value/SCALE)+'.'+(value%SCALE).toString().padStart(18,'0');return {date:row.date,close};
      });
      for(let i=1;i<points.length;i++){const before=close18(points[i-1].close),after=close18(points[i].close);if(after*100n>before*180n||after*100n<before*55n)throw Error('Large price discontinuity needs corporate-action review.');}
      series[symbol]={symbol,points,first:points[0].date,last:points.at(-1).date,fetchedAt:bundle.fetchedAt,source:DOLT_SOURCE,revisions:[...new Set(raw.map(r=>bundle.revisionsByDate?.[r.date]||bundle.baseRevision||bundle.revision))],adjustment:'splits'};
    }catch(e){errors[symbol]=e.message;}
  }
  return {series,errors};
}
export async function doltRead(query,fetcher=fetch){
  const url=new URL(DOLT_API);url.searchParams.set('q',query);
  const response=await fetcher(url.toString(),{signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(Error(response.status===429?'Historical source rate limit reached.':'Historical source request failed ('+response.status+').'),{retryable:true});
  const result=await response.json();
  if(result.query_execution_status!=='Success'||result.repository_owner!=='post-no-preference'||result.repository_name!=='stocks'||!Array.isArray(result.rows)||result.rows.length>1000)throw Error('Historical source returned an incomplete or mismatched query.');
  return result.rows;
}
