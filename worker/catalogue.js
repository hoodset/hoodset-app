import {catalogueAddress,validateVaultSnapshot,readVaultSnapshot,createCatalogueRpc,CATALOGUE_PAGE_SIZE} from '../shared/vault-catalogue.js';
import {d1CatalogueStore} from './catalogue-store.js';

const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const limits=new Map();
function allowPost(request,now){const key=request.headers.get('cf-connecting-ip')||'local';const old=limits.get(key);if(!old||now-old.at>60000){if(limits.size>2000)limits.clear();limits.set(key,{at:now,n:1});return true;}return ++old.n<=12;}
export async function catalogueResponse(request,env={},options={}){
 const now=options.now||Date.now,url=new URL(request.url),store=options.store||env.CATALOGUE_STORE||d1CatalogueStore(env.HISTORY_DB),read=options.read||((a)=>readVaultSnapshot(a,createCatalogueRpc(env.CATALOGUE_RPC_URL||env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com'),{now}));
 try{
  if(!['GET','POST'].includes(request.method))return response({error:'GET or POST required.'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return response({error:'Cross-origin requests are not allowed.'},403);
  if(request.method==='POST'){
   if(Number(request.headers.get('content-length'))>160)return response({error:'Only a vault address can be submitted.'},413);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>160)return response({error:'Only a vault address can be submitted.'},413);
   let body;try{body=JSON.parse(raw);}catch{return response({error:'Invalid request JSON.'},400);}
   if(!body||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'address'))return response({error:'Submit only the public vault address.'},400);
   let address;try{address=catalogueAddress(body.address);}catch(e){return response({error:e.message},400);}
   if(!allowPost(request,now()))return response({error:'Too many catalogue submissions. Retry in a minute.'},429);
   // A public address is not a verified creator identity or endorsement. Runtime is checked before persistence.
   const snapshot=validateVaultSnapshot(await read(address));if(snapshot.address!==address)throw Error('Vault address mismatch.');
   const records=await store.list();if(records.length>=1000&&!records.some(x=>x.address===address))return response({error:'The catalogue is full. The vault can still be inspected by address.'},409);
   const added=await store.add(snapshot,now());await store.update(snapshot);
   return response({added,vault:snapshot,listed:true},added?201:200);
  }
  for(const key of url.searchParams.keys())if(!['address','after'].includes(key))return response({error:'Unsupported catalogue filter.'},400);
  if(url.searchParams.has('address')){
   let address;try{address=catalogueAddress(url.searchParams.get('address'));}catch(e){return response({error:e.message},400);}
   return response({vault:validateVaultSnapshot(await read(address))});
  }
  const after=url.searchParams.get('after');if(after!==null&&!/^0x[0-9a-f]{40}$/.test(after))return response({error:'Invalid catalogue page.'},400);
  const records=await store.list();if(records.length>1000)return response({error:'The catalogue needs maintenance. Open a vault directly by address.'},503);
  const start=after===null?0:records.findIndex(x=>x.address===after)+1;
  if(after!==null&&start===0)return response({error:'This catalogue page changed. Refresh the list.'},400);
  const page=records.slice(start,start+CATALOGUE_PAGE_SIZE),vaults=[],errors=[];
  // Bounded batches: a failed vault remains visibly unavailable, never silently omitted from counts.
  for(let i=0;i<page.length;i+=3)await Promise.all(page.slice(i,i+3).map(async row=>{try{
   let v=await store.get(row.address);try{v=validateVaultSnapshot(v);if(v.address!==row.address)v=null;}catch{v=null;}
   if(!v||now()-v.checkedAt>45000||v.checkedAt>now()+60000){v=validateVaultSnapshot(await read(row.address));await store.update(v);}
   vaults.push({...v,listedAt:row.listedAt});
  }catch{errors.push({address:row.address,error:'Chain snapshot unavailable. Retry or inspect this address directly.'});}}));
  const order=new Map(page.map((x,i)=>[x.address,i]));vaults.sort((a,b)=>order.get(a.address)-order.get(b.address));
  return response({chainId:4663,vaults,errors,total:records.length,loaded:page.length,next:start+page.length<records.length?page.at(-1).address:null,checkedAt:now(),storage:'Shared HOODSET catalogue',listingPolicy:'Runtime match and supported assets; not an audit, endorsement or verified creator identity.'});
 }catch(e){console.error('HOODSET catalogue verification failed',{name:e.name,reason:e.message});return response({error:/does not match|Unsupported basket|Invalid onchain|Invalid initial|Backing and reserves/.test(e.message)?e.message:'The catalogue could not read and verify this vault. Retry shortly.'},502);}
}
