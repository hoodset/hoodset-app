import {ALLOWED} from './assets.js';
import {normalizeHistory,nyDay} from '../shared/market-history.js';
const HISTORY_SOURCE='Twelve Data',HISTORY_URL='https://twelvedata.com/docs/market-data/time-series';
const TTL=6*3600000,VERSION=2;
export const historyDisplayAllowed=env=>env?.TWELVE_DATA_DISPLAY_RIGHTS==='external-display';
const waiting=(message,stop=false)=>Object.assign(Error(message),{pending:true,stop});
export function createHistoryService({fetcher=fetch,clock=Date.now}={}){
  async function series(symbol,key,db){
    const now=clock();
    const lease=crypto.randomUUID();
    const lock=await db.prepare('INSERT INTO history_locks(symbol,lease,expires_at) VALUES(?1,?2,?3) ON CONFLICT(symbol) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at WHERE history_locks.expires_at<=?4 RETURNING symbol').bind(symbol,lease,now+30000,now).first();
    if(!lock)throw waiting('This component history is loading in another request.');
    try{
      // One atomic statement enforces the rolling account-wide budget across isolates.
      const credit=await db.prepare('INSERT INTO history_requests(requested_at) SELECT ?1 WHERE (SELECT COUNT(*) FROM history_requests WHERE requested_at>?2)<8 RETURNING id').bind(now,now-61000).first();
      if(!credit)throw waiting('Waiting for the history provider rate limit.',true);
      const url=new URL('https://api.twelvedata.com/time_series');
      // Date-only end_date is the New York midnight boundary; normalization also drops today's bar.
      for(const[k,v]of Object.entries({symbol,interval:'1day',outputsize:'400',adjust:'splits',order:'asc',country:'United States',end_date:nyDay(now)}))url.searchParams.set(k,v);
      let response,data;
      try{response=await fetcher(url.toString(),{headers:{Authorization:'apikey '+key},signal:AbortSignal.timeout(15000)});data=await response.json();}catch{throw Error('Historical price provider could not be reached.');}
      const code=Number(data?.code||response.status);
      if(response.status===429||code===429){await db.prepare('INSERT INTO history_provider(id,retry_at) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET retry_at=MAX(history_provider.retry_at,excluded.retry_at)').bind('twelve',clock()+65000).run();throw waiting('History provider quota reached. Try again after one minute.',true);}
      if(response.status===401||response.status===403||code===401||code===403)throw Object.assign(Error('Historical price credentials or data entitlement need attention.'),{auth:true});
      if(!response.ok||data?.status!=='ok')throw Error('Historical prices are unavailable for '+symbol+'.');
      const value=normalizeHistory(symbol,data,clock());
      await db.prepare('INSERT INTO history_cache(symbol,version,payload,fetched_at) VALUES(?1,?2,?3,?4) ON CONFLICT(symbol) DO UPDATE SET version=excluded.version,payload=excluded.payload,fetched_at=excluded.fetched_at').bind(symbol,VERSION,JSON.stringify(value),clock()).run();
      return value;
    }finally{await db.prepare('DELETE FROM history_locks WHERE symbol=?1 AND lease=?2').bind(symbol,lease).run();}
  }
  return async function history(request,env={}){
    const url=new URL(request.url),symbols=[...new Set(['SPY',...(url.searchParams.get('symbols')||Object.keys(ALLOWED).join(',')).split(',')])];
    if(symbols.length>17||symbols.some(s=>!Object.hasOwn(ALLOWED,s)))return {status:400,body:{error:'Invalid historical asset symbols.'}};
    const key=env.TWELVE_DATA_API_KEY;
    const body={provider:HISTORY_SOURCE,sourceUrl:HISTORY_URL,configured:!!key,displayAvailable:!!key&&key!=='demo'&&historyDisplayAllowed(env),adjustment:'splits',currency:'USD',interval:'1day',cache:'persistent',series:{},errors:{},pending:[],receivedAt:new Date(clock()).toISOString(),retryAfter:0};
    // A working API key does not grant external display or redistribution rights.
    // Stop before both D1 reads and provider requests, including already cached data.
    if(!historyDisplayAllowed(env)){body.error='Historical prices are currently unavailable on this deployment.';body.availability='display-not-configured';return{status:200,body};}
    if(!key||key==='demo'){body.configured=false;body.error='Connect a personal historical data key in Site settings.';return{status:200,body};}
    const binding=env.HISTORY_DB,db=binding?.withSession?binding.withSession('first-primary'):binding;
    if(!db){body.error='Persistent history cache is not available. No provider requests were sent.';return{status:200,body};}
    let blockedUntil=0;
    try{
      await db.prepare('DELETE FROM history_requests WHERE requested_at<=?1').bind(clock()-61000).run();
      const cached=await db.prepare('SELECT symbol,payload FROM history_cache WHERE version=?1 AND fetched_at>?2').bind(VERSION,clock()-TTL).all();
      for(const row of cached.results){try{const value=JSON.parse(row.payload);if(symbols.includes(row.symbol)&&value.symbol===row.symbol&&Array.isArray(value.points))body.series[row.symbol]=value;}catch{}}
      blockedUntil=(await db.prepare('SELECT retry_at FROM history_provider WHERE id=?1').bind('twelve').first())?.retry_at||0;
    }catch{body.error='Persistent history cache could not be read. No provider requests were sent.';return{status:200,body};}
    let authError=false,throttled=blockedUntil>clock();
    for(const symbol of symbols){
      if(body.series[symbol])continue;
      if(authError){body.errors[symbol]='History source needs valid credentials.';continue;}
      if(throttled){body.errors[symbol]='Waiting for the history provider rate limit.';body.pending.push(symbol);continue;}
      try{body.series[symbol]=await series(symbol,key,db);}catch(e){body.errors[symbol]=e.pending||e.auth?e.message:'Historical data could not be loaded for '+symbol+'.';if(e.pending)body.pending.push(symbol);if(e.stop)throttled=true;if(e.auth){authError=true;body.error=e.message;}}
    }
    if(body.pending.length)body.retryAfter=65;
    return {status:200,body};
  };
}
export const marketHistory=createHistoryService();
