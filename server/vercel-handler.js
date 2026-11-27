import{readFileSync}from'node:fs';
import{api,json}from'../worker/api.js';
import{pageMetadata,publicationFile}from'../worker/publication.js';
import{runtimeHistoryStore}from'./runtime-history-store.js';
let historyStore;
export async function apiResponse(request,endpoint,options={}){
  try{
    const url=new URL(request.url),origin=request.headers.get('origin');
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
    if(origin&&origin!==url.origin)return json({error:'Cross-origin requests are not allowed.'},403);
    if(Number(request.headers.get('content-length'))>500000)return json({error:'Request too large.'},413);
    url.pathname='/api/'+endpoint;
    const body=request.method==='POST'?await request.arrayBuffer():undefined;
    if(body&&body.byteLength>500000)return json({error:'Request too large.'},413);
    const env={RH_RPC_URL:process.env.RH_RPC_URL};
    if(endpoint==='history')env.HISTORY_STORE=options.historyStore||(historyStore||=runtimeHistoryStore());
    return await api(new Request(url,{method:request.method,headers:request.headers,...(body?{body}:{})}),env);
  }catch(e){console.error('HOODSET API failed',{endpoint,name:e.name});return json({error:e instanceof SyntaxError?'Invalid request JSON.':'Request could not be completed.'},e.upstream?502:400);}
}
export function indexResponse(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  return new Response(request.method==='HEAD'?null:pageMetadata(html,request),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
}
export function metaResponse(request,document){
  const url=new URL(request.url),file=document||url.searchParams.get('document');
  if(!['robots','sitemap'].includes(file))return new Response('Not found',{status:404});
  url.pathname=file==='robots'?'/robots.txt':'/sitemap.xml';
  return publicationFile(new Request(url,{method:request.method}))||new Response('Method not allowed',{status:405});
}
