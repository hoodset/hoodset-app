import {CATALOGUE_BACKEND} from './catalogue-proxy.js';
import {AGENT_REQUEST_LIMIT} from '../shared/agent-plan.js';
export async function agentsProxy(request,mcp=false,{fetcher=fetch}={}){
 const url=new URL(request.url),origin=request.headers.get('origin');
 const json=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
 if(origin&&origin!==url.origin)return json('Cross-origin requests are not allowed.',403);
 if(!['GET','POST'].includes(request.method)||mcp&&request.method!=='POST')return json('Method not allowed.',405);
 if(Number(request.headers.get('content-length'))>AGENT_REQUEST_LIMIT)return json('Request exceeds 32 KiB.',413);
 const body=request.method==='POST'?await request.text():undefined;if(body&&new TextEncoder().encode(body).length>AGENT_REQUEST_LIMIT)return json('Request exceeds 32 KiB.',413);
 const target=new URL(mcp?'/api/agent-mcp':'/api/agents',CATALOGUE_BACKEND);if(!mcp)target.search=url.search;
 const headers=new Headers();for(const name of ['authorization','content-type','accept','idempotency-key','mcp-protocol-version','mcp-method','mcp-name'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
 try{const r=await fetcher(target,{method:request.method,headers,...(body!==undefined?{body}:{}),redirect:'error',signal:AbortSignal.timeout(65000)}),text=await r.text();if(text.length>1500000)throw Error('Oversized response');return new Response(text||null,{status:r.status,headers:{'Content-Type':r.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}catch{return json('The API ledger is unavailable. Retry the same request id or payment hash; do not pay again.',503);}
}
