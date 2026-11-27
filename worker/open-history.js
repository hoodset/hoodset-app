import bootstrap from '../data/stock-history.seed.json' with {type:'json'};
import{ALLOWED}from'./assets.js';
import{nyDay}from'../shared/market-history.js';
import{d1HistoryStore}from'./history-store.js';
import{DOLT_SOURCE,DOLT_URL,DATA_LICENSE,LICENSE_HASH,historyDays,revisionRef,metadataQueries,priceQuery,validateIdentities,validateSplits,validatePriceRows,snapshotSeries,doltRead}from'../shared/dolt-history.js';

const KEY='__dolt_stocks_v1__',VERSION=3,TTL=6*3600000;
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function createOpenHistoryService({fetcher=fetch,clock=Date.now,seed=bootstrap}={}){
  return async function history(request,env={}){
    const symbols=[...new Set(['SPY',...(new URL(request.url).searchParams.get('symbols')||Object.keys(ALLOWED).join(',')).split(',')])];
    if(symbols.length>17||symbols.some(s=>!Object.hasOwn(ALLOWED,s)))return{status:400,body:{error:'Invalid historical asset symbols.'}};
    const now=clock(),body={provider:DOLT_SOURCE,sourceUrl:DOLT_URL,license:DATA_LICENSE,configured:true,displayAvailable:true,adjustment:'splits',currency:'USD',interval:'1day',cache:'persistent',series:{},errors:{},pending:[],retryAfter:0,receivedAt:new Date(now).toISOString()};
    const store=env.HISTORY_STORE||d1HistoryStore(env.HISTORY_DB,KEY,VERSION);
    if(!store){body.error='Historical cache is unavailable. No upstream requests were sent.';return{status:200,body};}
    body.cache=store.kind;body.cacheHit=false;
    let bundle=clone(seed),lease;
    const expose=()=>{
      if(!bundle)return;
      const value=snapshotSeries(bundle,now);
      body.series=Object.fromEntries(Object.entries(value.series).filter(([s])=>symbols.includes(s)));
      body.errors=Object.fromEntries(Object.entries(value.errors).filter(([s])=>symbols.includes(s)));
      body.snapshot={latestSourceRevision:bundle.revision,baseRevision:bundle.baseRevision,priceRevisionsByDate:bundle.revisionsByDate,checkedAt:bundle.checkedAt,sourceFetchedAt:bundle.fetchedAt,pendingDateBatches:Math.ceil((bundle.pendingDays?.length||0)/20),bootstrapRevision:seed.revision};
      body.cacheStale=!Number.isFinite(Date.parse(bundle.checkedAt))||now-Date.parse(bundle.checkedAt)>TTL;
    };
    try{
      const payload=await store.read();
      try{if(payload){bundle=JSON.parse(payload);snapshotSeries(bundle,now);if(bundle.licenseSha256!==LICENSE_HASH||!Array.isArray(bundle.coveredDays)||!Array.isArray(bundle.pendingDays))throw Error('Invalid source cache');body.cacheHit=true;}}catch{bundle=null;}
      if(!bundle){bundle=clone(seed);snapshotSeries(bundle,now);}
      const persist=()=>store.write(JSON.stringify(bundle),clock());
      if(!bundle.pendingDays.length&&now-Date.parse(bundle.checkedAt)>=-60000&&now-Date.parse(bundle.checkedAt)<TTL){await persist();expose();return{status:200,body};}
      lease=crypto.randomUUID();
      const lock=await store.acquire(lease,now,now+90000);
      if(!lock){lease=null;body.pending=symbols;body.retryAfter=65;body.updateStatus='A shared history refresh is already running.';expose();return{status:200,body};}
      const days=historyDays(now),allowedDays=new Set(days);
      if(!bundle.pendingDays.length){
        const docs=await doltRead("SELECT HASHOF('HEAD') AS revision,doc_text FROM dolt_docs WHERE doc_name='LICENSE.md'",fetcher);
        if(docs.length!==1||typeof docs[0].doc_text!=='string'||await hash(docs[0].doc_text)!==LICENSE_HASH)throw Error('History data license changed; source review is required.');
        const revision=revisionRef(docs[0].revision),queries=metadataQueries(revision,days[0],nyDay(now));
        const [identities,splits]=await Promise.all([doltRead(queries.identities,fetcher),doltRead(queries.splits,fetcher)]);
        validateIdentities(identities);validateSplits(splits);
        const covered=new Set(bundle.coveredDays);
        bundle={...bundle,revision,identities,splits,licenseSha256:LICENSE_HASH,revisions:[...new Set([...(bundle.revisions||[]),revision])],coveredDays:bundle.coveredDays.filter(d=>allowedDays.has(d)),pendingDays:[...new Set([...days.filter(d=>!covered.has(d)),...days.slice(-10)])].sort()};
      }
      const batches=[bundle.pendingDays.slice(0,20),bundle.pendingDays.slice(20,40)].filter(a=>a.length);
      const results=await Promise.allSettled(batches.map(async dates=>({dates,rows:validatePriceRows(await doltRead(priceQuery(dates,bundle.revision),fetcher),dates)})));
      let updated=false,failed=false;
      for(const result of results){
        if(result.status==='rejected'){failed=true;continue;}
        const {dates,rows}=result.value,queried=new Set(dates);
        // A successful empty response removes old bars for those dates; no invented fill.
        bundle.rows=[...bundle.rows.filter(r=>allowedDays.has(r.date)&&!queried.has(r.date)),...rows];
        bundle.revisionsByDate=Object.fromEntries(Object.entries(bundle.revisionsByDate||{}).filter(([day])=>allowedDays.has(day)));
        for(const day of dates)bundle.revisionsByDate[day]=bundle.revision;
        bundle.coveredDays=[...new Set([...bundle.coveredDays,...dates])].sort();
        bundle.pendingDays=bundle.pendingDays.filter(d=>!queried.has(d));updated=true;
      }
      if(updated)bundle.fetchedAt=new Date(clock()).toISOString();
      if(!bundle.pendingDays.length)bundle.checkedAt=new Date(clock()).toISOString();
      await persist();
      if(bundle.pendingDays.length){body.pending=symbols;body.retryAfter=65;body.updateStatus=failed?'Source refresh delayed; remaining date batches will retry.':'Loading remaining daily history.';}
      expose();
    }catch{
      body.error='Historical source refresh could not be verified. The last dated snapshot is shown where a complete period remains available.';
      body.pending=symbols;body.retryAfter=65;
      try{expose();}catch{body.series={};body.errors={};}
    }finally{
      if(lease)try{await store.release(lease);}catch{}
    }
    return{status:200,body};
  };
}
export const marketHistory=createOpenHistoryService();
