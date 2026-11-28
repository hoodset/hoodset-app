import{api,json}from'./api.js';
import{pageMetadata,publicationFile}from'./publication.js';
import{ASSETS}from'../.generated/assets.js';
export default{async fetch(request,env,ctx){
  try{
    const url=new URL(request.url),publication=publicationFile(request);
    if(url.pathname==='/mcp'){url.pathname='/api/agent-mcp';return api(new Request(url,request),env||{});}
    if(publication)return publication;
    if(url.pathname.startsWith('/api/')){
      if(request.method!=='GET'&&request.method!=='POST')return json({error:'Method not allowed.'},405);
      const origin=request.headers.get('origin');
      if(origin&&origin!==url.origin)return json({error:'Cross-origin requests are not allowed.'},403);
      return await api(request,env||{});
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
    const key=url.pathname==='/'?'/index.html':url.pathname,a=ASSETS[key];
    if(!a)return new Response('Not found',{status:404});
    const bytes=Uint8Array.from(atob(a.body),c=>c.charCodeAt(0));
    let body=a.gzip?new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')):bytes;
    if(key==='/index.html')body=pageMetadata(await new Response(body).text(),request);
    return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':a.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'}});
  }catch(e){return json({error:e instanceof SyntaxError?'Invalid request JSON.':e.message||'Request failed.'},e.upstream?502:400);}
}};
