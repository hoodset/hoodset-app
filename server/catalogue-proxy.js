import {catalogueAddress,validateVaultSnapshot} from '../shared/vault-catalogue.js';
// Existing HOODSET-owned D1 binding. Only public verified-vault records cross this boundary.
export const CATALOGUE_BACKEND='https://elyset-rh-demo-1126.jaswaleska.chatgpt.site';
export async function catalogueProxy(request,{fetcher=fetch}={}){
 const url=new URL(request.url),target=new URL('/api/catalogue',CATALOGUE_BACKEND);target.search=url.search;
 if(!['GET','POST'].includes(request.method))return new Response(JSON.stringify({error:'GET or POST required.'}),{status:405,headers:{'Content-Type':'application/json'}});
 const body=request.method==='POST'?await request.text():undefined;
 if(body&&new TextEncoder().encode(body).length>160)return new Response(JSON.stringify({error:'Only a vault address can be submitted.'}),{status:413,headers:{'Content-Type':'application/json'}});
 const r=await fetcher(target,{method:request.method,headers:{'Content-Type':'application/json'},...(body?{body}:{}),signal:AbortSignal.timeout(60000)});
 const raw=await r.text();if(raw.length>100000)throw Error('Catalogue response too large.');const d=JSON.parse(raw);
 if(r.ok){if(d.vault)d.vault=validateVaultSnapshot(d.vault);else {if(!Array.isArray(d.vaults)||d.vaults.length>8||!Array.isArray(d.errors)||d.errors.length>8||!Number.isInteger(d.total)||d.total<0||d.total>1000)throw Error('Invalid catalogue response.');d.vaults=d.vaults.map(v=>({...validateVaultSnapshot(v),listedAt:v.listedAt}));d.errors=d.errors.map(e=>({address:catalogueAddress(e.address),error:'Chain snapshot unavailable. Retry or inspect this address directly.'}));if(d.next!==null)catalogueAddress(d.next);}}
 return new Response(JSON.stringify(d),{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
