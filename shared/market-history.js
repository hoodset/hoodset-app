// Daily underlying-equity prices are independent of live RH token valuations.
export const HISTORY_SOURCE='DoltHub / post-no-preference/stocks';
export const HISTORY_URL='https://www.dolthub.com/repositories/post-no-preference/stocks';
const DAY=86400000,SCALE=10n**18n;
export function isoDay(at=Date.now()){return new Date(at).toISOString().slice(0,10);}
export function nyDay(at=Date.now()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
  const part=type=>parts.find(p=>p.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&isoDay(Date.parse(s))===s;}
export function close18(s){
  if(typeof s!=='string'||! /^(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(s))throw Error('Invalid daily close.');
  const [whole,fraction='']=s.split('.'),value=BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0'));
  if(value<=0n)throw Error('Daily close must be positive.');return value;
}
export function normalizeHistory(symbol,data,now=Date.now()){
  if(data?.status!=='ok'||data.meta?.symbol!==symbol||data.meta.currency!=='USD'||data.meta.interval!=='1day'||data.meta.exchange_timezone!=='America/New_York')throw Error('Provider returned an unavailable or mismatched US daily series.');
  if(!Array.isArray(data.values)||data.values.length<2||data.values.length>500)throw Error('Daily history is incomplete.');
  const today=nyDay(now),seen=new Set(),points=[];
  for(const row of data.values){
    if(!validDay(row.datetime)||seen.has(row.datetime))throw Error('Daily history has invalid or duplicate dates.');
    seen.add(row.datetime);close18(row.close);
    // Never include today's potentially unfinished session or a future bar.
    if(row.datetime<today)points.push({date:row.datetime,close:row.close});
  }
  points.sort((a,b)=>a.date.localeCompare(b.date));
  if(points.length<2)throw Error('Completed daily sessions are not available.');
  return {symbol,points,first:points[0].date,last:points.at(-1).date,fetchedAt:new Date(now).toISOString()};
}
function anniversary(end,period){
  const d=new Date(end+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);
  if(period==='1Y')d.setUTCFullYear(d.getUTCFullYear()-1);else d.setUTCMonth(d.getUTCMonth()-1);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return isoDay(d.getTime());
}
const empty=(reason,missing=[])=>({ready:false,reason,missing,returnBps:null,drawdownBps:null,points:[]});
export function historicalBasket(theme,history,period='1Y',now=Date.now()){
  if(history?.displayAvailable===false)return empty(history.error||'Historical prices are currently unavailable.');
  if(!history?.configured)return empty('Historical price source is not connected.');
  if(!['1D','1M','1Y'].includes(period))return empty('Choose a historical period.');
  const {assets,weights}=theme;
  if(!Array.isArray(assets)||assets.length<2||assets.length>12||new Set(assets).size!==assets.length||weights?.length!==assets.length)return empty('Complete the basket composition first.');
  const bps=weights.map(w=>Math.round(Number(w)*100));
  if(bps.some((w,i)=>!Number.isFinite(w)||w<=0||Math.abs(Number(weights[i])*100-w)>1e-7)||bps.reduce((a,b)=>a+b,0)!==10000)return empty('Initial weights must total exactly 100%.');
  const spy=history.series?.SPY;
  if(!spy?.points?.length)return empty(history.error||'The shared market calendar is not available.',['SPY']);
  const end=spy.points.at(-1).date;
  if(!validDay(end)||end>=nyDay(now)||Date.parse(nyDay(now))-Date.parse(end)>7*DAY)return empty('Historical closing prices are stale.');
  let start;
  if(period==='1D')start=spy.points.at(-2)?.date;
  else{const target=anniversary(end,period);start=spy.points.filter(p=>p.date<=target).at(-1)?.date;if(!start||Date.parse(target)-Date.parse(start)>7*DAY)return empty(period+' history is incomplete.');}
  if(!start)return empty('The previous completed session is missing.');
  const calendar=spy.points.filter(p=>p.date>=start&&p.date<=end).map(p=>p.date);
  if(calendar.length<(period==='1Y'?200:period==='1M'?15:2))return empty('There are too few completed sessions for this period.');
  let previous=Date.parse(start);
  for(const day of calendar){if(Date.parse(day)-previous>7*DAY)return empty('The shared market calendar has a data gap.');previous=Date.parse(day);}
  const maps=assets.map(s=>new Map((history.series?.[s]?.points||[]).map(p=>[p.date,p.close])));
  const missing=assets.filter((s,i)=>calendar.some(day=>!maps[i].has(day)));
  if(missing.length)return empty('Complete daily history is required for '+missing.join(', ')+'.',missing);
  try{
    const bases=maps.map(m=>close18(m.get(start)));
    const points=calendar.map(date=>({date,at:Date.parse(date+'T12:00:00Z'),value:String(maps.reduce((total,m,i)=>total+100n*SCALE*BigInt(bps[i])*close18(m.get(date))/(10000n*bases[i]),0n))}));
    const first=BigInt(points[0].value),last=BigInt(points.at(-1).value);let peak=first,drawdown=0n;
    for(const p of points){const v=BigInt(p.value);if(v>peak)peak=v;const dd=(peak-v)*10000n/peak;if(dd>drawdown)drawdown=dd;}
    return {ready:true,start:points[0].at,end:points.at(-1).at,startDate:start,endDate:end,count:points.length,points,returnBps:Number((last-first)*10000n/first),drawdownBps:Number(drawdown),endValue:last,window:period+':'+start+':'+end,source:history.provider||HISTORY_SOURCE};
  }catch{return empty('A component contains an invalid historical close.');}
}
export function compareHistorical(a,b,direction='desc'){
  if(a.ready!==b.ready)return a.ready?-1:1;
  if(!a.ready)return 0;
  // All app rows use the same SPY calendar. Refuse a mixed-window comparison.
  if(a.window!==b.window)return 0;
  return direction==='asc'?a.returnBps-b.returnBps:b.returnBps-a.returnBps;
}
