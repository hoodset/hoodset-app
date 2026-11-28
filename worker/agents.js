import {verifyMessage} from 'ethers';
import {AGENT_PLAN,AGENT_ORIGIN,AGENT_PROTOCOLS,AGENT_REQUEST_LIMIT,agentAddress,agentMessage,agentHash,agentSecret,agentJson} from '../shared/agent-plan.js';
import {verifyAgentPayment} from '../shared/agent-payment.js';
import {createCatalogueRpc,readVaultSnapshot} from '../shared/vault-catalogue.js';
import {agentStore} from './agent-store.js';
import {AGENT_TOOLS,agentArguments,createAgentTools} from './agent-tools.js';
const VERSION='2.19.0',META='io.modelcontextprotocol/',MODERN=AGENT_PROTOCOLS[0];
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const error=(message,status=400)=>Object.assign(Error(message),{status});
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200,extra={})=>new Response(agentJson(body),{status,headers:{...headers,...extra}});
function exact(b,keys,required=[]){if(!object(b)||Object.keys(b).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(b,k)))throw error('Request does not match the documented schema.');}
function label(value){if(typeof value!=='string'||!value.trim()||value.trim().length>40||/[\x00-\x1f]/.test(value))throw error('Name the API key using 1–40 characters.');return value.trim();}
const rpcError=(id,code,message,status=400,data)=>json({jsonrpc:'2.0',...(id===undefined?{}:{id}),error:{code,message,...(data?{data}:{})}},status);
const modernResult=result=>({...result,resultType:'complete',_meta:{[META+'serverInfo']:{name:'hoodset',version:VERSION}}});
function nameHeader(value){
 if(!value?.startsWith('=?base64?'))return value;
 try{if(!value.endsWith('?='))return null;const encoded=value.slice(9,-2);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return null;const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}
export async function agentsResponse(request,env={},options={}){
 const now=options.clock||Date.now,url=new URL(request.url),mcp=options.mcp||url.pathname==='/api/agent-mcp';let rpcId,modern=false;
 try{
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw error('Cross-origin requests are not allowed.',403);
  if(!['GET','POST'].includes(request.method)||mcp&&request.method!=='POST')return mcp?rpcError(undefined,-32600,'Use POST with an MCP JSON-RPC message.',405):json({error:'GET or POST required.'},405);
  if(Number(request.headers.get('content-length'))>AGENT_REQUEST_LIMIT)throw error('Request exceeds 32 KiB.',413);
  let body={};if(request.method==='POST'){const raw=await request.text();if(new TextEncoder().encode(raw).length>AGENT_REQUEST_LIMIT)throw error('Request exceeds 32 KiB.',413);try{body=JSON.parse(raw);}catch{if(mcp)return rpcError(undefined,-32700,'Parse error.');throw error('Invalid JSON.');}}
  const store=options.store||agentStore(env.HISTORY_DB);
  const rpc=options.rpc||createCatalogueRpc(env.CATALOGUE_RPC_URL||env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com');
  const api=options.publicApi;if(!api&&!options.execute)throw error('The agent data service is unavailable.',503);
  const execute=options.execute||createAgentTools({publicApi:api,rpc,store,readVault:a=>readVaultSnapshot(a,rpc,{now}),clock:now});
  async function auth(){const match=/^Bearer (hset_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');if(!match)throw error('A HOODSET API bearer key is required.',401);const key=await store.authenticate(await agentHash(match[1]));if(!key)throw error('API key is invalid or revoked.',401);return key;}
  async function run(name,args,idempotency){
   const key=await auth();let clean;try{clean=agentArguments(name,args);}catch(e){throw error(e.message);}
   if(!await store.rate('call:'+key.id,now(),60))throw error('API key rate limit: 60 calls per minute.',429);
   await store.reap(key.account,now());
   const clientId=idempotency??crypto.randomUUID();if(typeof clientId!=='string'||!/^[-a-zA-Z0-9_:.]{8,100}$/.test(clientId))throw error('Idempotency key must contain 8–100 letters, digits, dots, colons, underscores or hyphens.');
   const fingerprint=await agentHash(agentJson([name,clean])),id=await agentHash(key.id+':'+clientId),reservation=await store.reserve(key,id,fingerprint,name,now());
   if(!reservation.row)throw error('No request credits remain. Top up with HSET on the API & MCP page.',402);
   if(reservation.row.fingerprint!==fingerprint)throw error('This idempotency key belongs to different arguments.',409);
   if(!reservation.fresh){if(reservation.row.status==='running')throw error('This request is still running. Retry the same idempotency key shortly.',409);const cached=JSON.parse(reservation.row.result);if(reservation.row.status==='failed')throw error(cached.error,502);return {data:cached,requestId:clientId,replayed:true,chargedCredits:0};}
   try{const result=JSON.parse(agentJson(await execute(name,clean)));if(agentJson(result).length>1200000)throw Error('Tool result exceeded the response size limit.');if(!await store.finish(id,result))throw Error('This request lease expired and its credit was refunded. Retry with a new idempotency key.');return {data:result,requestId:clientId,replayed:false,chargedCredits:1};}
   catch(e){await store.fail(id,key.account,String(e.message||'Data unavailable.').slice(0,300));throw error(String(e.message||'Data unavailable.').slice(0,300),502);}
  }
  if(mcp){
   if(!object(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||Object.hasOwn(body,'result')||Object.hasOwn(body,'error'))return rpcError(undefined,-32600,'A single JSON-RPC request is required.');
   rpcId=body.id;if(rpcId!==undefined&&!(typeof rpcId==='string'&&rpcId.length<=100||Number.isSafeInteger(rpcId)))return rpcError(undefined,-32600,'Invalid JSON-RPC id.');
   const p=body.params??{};if(!object(p))return rpcError(rpcId,-32602,'params must be an object.');
   const declared=request.headers.get('mcp-protocol-version')||p._meta?.[META+'protocolVersion'];modern=declared===MODERN||object(p._meta)&&Object.hasOwn(p._meta,META+'protocolVersion');
   if(body.method==='initialize'&&!modern){const protocol=AGENT_PROTOCOLS.slice(1).includes(p.protocolVersion)?p.protocolVersion:'2025-11-25';return json({jsonrpc:'2.0',id:rpcId,result:{protocolVersion:protocol,capabilities:{tools:{}},serverInfo:{name:'hoodset',version:VERSION},instructions:'Read-only basket data; successful tool calls consume HSET-funded API credits. No signing or trading tools.'}});}
   if(body.method==='notifications/initialized'&&rpcId===undefined&&!modern)return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
   if(!AGENT_PROTOCOLS.includes(declared))return rpcError(rpcId,-32022,'Unsupported protocol version',400,{supported:AGENT_PROTOCOLS,requested:declared??null});
   if(modern){
    if(!object(p._meta)||typeof p._meta[META+'protocolVersion']!=='string'||!object(p._meta[META+'clientCapabilities']))return rpcError(rpcId,-32602,'Modern protocol version and clientCapabilities metadata are required.');
    if(p._meta[META+'protocolVersion']!==request.headers.get('mcp-protocol-version'))return rpcError(rpcId,-32020,'MCP protocol header does not match the body.');
    const info=p._meta[META+'clientInfo'];if(info!==undefined&&(!object(info)||typeof info.name!=='string'||typeof info.version!=='string'))return rpcError(rpcId,-32602,'Invalid clientInfo metadata.');
    if(request.headers.get('mcp-protocol-version')!==MODERN||request.headers.get('mcp-method')!==body.method||body.method==='tools/call'&&nameHeader(request.headers.get('mcp-name'))!==p.name)return rpcError(rpcId,-32020,'Required MCP headers are missing or do not match the body.');
   }
   if(rpcId===undefined)return rpcError(undefined,-32600,'This MCP method requires a request id.');
   let result;
   if(body.method==='server/discover')result={supportedVersions:AGENT_PROTOCOLS,capabilities:{tools:{}},instructions:'HOODSET read-only basket research. tools/list is free. Each successful data tool call costs one HSET-funded credit; errors are refunded. Supply a bearer key. No wallet or trading tools.',ttlMs:300000,cacheScope:'public'};
   else if(body.method==='tools/list')result={tools:AGENT_TOOLS,...(modern?{ttlMs:300000,cacheScope:'public'}:{})};
   else if(body.method==='tools/call'){
    if(!AGENT_TOOLS.some(t=>t.name===p.name))return rpcError(rpcId,-32602,'Unknown HOODSET tool.');
    try{const output=await run(p.name,p.arguments??{},request.headers.get('idempotency-key')||p._meta?.['space.hoodset/idempotencyKey']);result={content:[{type:'text',text:agentJson(output)}],structuredContent:output,isError:false};}
    catch(e){if([401,402,429].includes(e.status))return rpcError(rpcId,-32000,e.message,e.status);result={content:[{type:'text',text:e.message}],isError:true};}
   }else if(body.method==='ping'&&!modern)result={};
   else return rpcError(rpcId,-32601,'Method not found.',404);
   return json({jsonrpc:'2.0',id:rpcId,result:modern?modernResult(result):result});
  }
  const action=url.searchParams.get('action')||'config';
  if(action==='config'&&request.method==='GET')return json({version:VERSION,plan:AGENT_PLAN,endpoint:AGENT_ORIGIN+'/mcp',restEndpoint:AGENT_ORIGIN+'/api/agents',protocols:AGENT_PROTOCOLS,tools:AGENT_TOOLS,ledger:'Persistent server-side credit ledger',keyScope:'Read-only HOODSET data; no wallet or transaction access',billing:'One credit per successful data-tool call; discovery, usage, key management and payment verification are free. Credits do not expire. A browser-local holder check does not grant credits.'});
  if(action==='challenge'&&request.method==='POST'){
   exact(body,['account','action','label','keyId'],['account','action']);const account=agentAddress(body.account);if(!account)throw error('A valid EVM wallet address is required.');
   if(!['create_key','revoke_key'].includes(body.action))throw error('Unsupported authorization action.');
   if(!await store.rate('challenge:'+account,now(),20,3600000)||!await store.rate('ip:'+await agentHash(request.headers.get('cf-connecting-ip')||'proxy'),now(),120))throw error('Too many key authorizations. Retry later.',429);
   const payload=body.action==='create_key'?agentJson({label:label(body.label)}):agentJson({keyId:body.keyId});if(body.action==='revoke_key'&&!/^key_[a-f0-9]{32}$/.test(body.keyId||''))throw error('Invalid key id.');
   const challenge={account,action:body.action,payload,nonce:agentSecret(),expiresAt:now()+300000};await store.challenge(challenge);return json({...challenge,message:agentMessage(challenge)});
  }
  if(['create_key','revoke_key'].includes(action)&&request.method==='POST'){
   exact(body,['nonce','signature'],['nonce','signature']);if(!/^[a-f0-9]{64}$/.test(body.nonce||'')||!/^0x[a-fA-F0-9]{130}$/.test(body.signature||''))throw error('A valid wallet message signature is required.');
   const c=await store.getChallenge(body.nonce);if(!c||c.action!==action||c.used||c.expiresAt<=now())throw error('Authorization expired or was already used. Request a fresh message.');
   let account;try{account=verifyMessage(agentMessage(c),body.signature).toLowerCase();}catch{throw error('Wallet message signature is invalid.');}if(account!==c.account)throw error('Signature belongs to a different wallet.');
   if(action==='create_key'&&(await store.keys(account)).filter(k=>k.revoked_at===null).length>=8)throw error('Up to 8 active keys are allowed. Revoke an unused key first.',409);
   if(!await store.consume(c.nonce,now()))throw error('Authorization was already used.',409);
   const payload=JSON.parse(c.payload);
   if(action==='revoke_key')return json({revoked:await store.revoke(account,payload.keyId,now())});
   const secret='hset_'+agentSecret(),id='key_'+agentSecret().slice(0,32);await store.createKey({id,account,hash:await agentHash(secret),prefix:secret.slice(0,13),label:payload.label},now());return json({key:secret,id,account,label:payload.label,notice:'Copy this key now. Only its SHA-256 hash is stored. A new signed key can access the same wallet’s credit balance.'},201);
  }
  const key=await auth();
  if(action==='usage'&&request.method==='GET'){await store.reap(key.account,now());return json({account:key.account,...await store.usage(key.account)});}
  if(action==='invoice'&&request.method==='POST'){
   exact(body,[]);if(key.account===AGENT_PLAN.recipient)throw error('The payment recipient cannot buy credits with a self-transfer. Use a separate paying wallet.');
   let invoice=await store.invoice(key.account);if(!invoice){invoice={id:'inv_'+agentSecret().slice(0,32),account:key.account,plan:AGENT_PLAN.id,token:AGENT_PLAN.token,recipient:AGENT_PLAN.recipient,amount:AGENT_PLAN.amount,credits:AGENT_PLAN.credits,chainId:4663,createdAt:now()};await store.addInvoice(invoice);}return json({invoice});
  }
  if(action==='claim'&&request.method==='POST'){
   exact(body,['invoiceId','hash'],['invoiceId','hash']);if(!await store.rate('claim:'+key.account,now(),12))throw error('Too many payment checks. Retry in a minute.',429);
   const invoice=await store.getInvoice(key.account,body.invoiceId);if(!invoice)throw error('Invoice does not belong to this API account.',404);
   const previous=typeof body.hash==='string'?await store.payment(body.hash.toLowerCase()):null;
   if(previous){if(previous.account!==key.account||previous.invoice!==invoice.id)throw error('Payment already belongs to another invoice.',409);return json({credited:false,replayed:true,payment:previous,...await store.usage(key.account)});}
   const payment=await (options.verifyPayment||verifyAgentPayment)(invoice,body.hash,rpc),entry=await store.credit(invoice,payment,now());return json({credited:entry.added,replayed:!entry.added,payment,...await store.usage(key.account)});
  }
  if(action==='call'&&request.method==='POST'){exact(body,['tool','arguments'],['tool']);const output=await run(body.tool,body.arguments??{},request.headers.get('idempotency-key'));return json(output);}
  throw error('API action or method not found.',404);
 }catch(e){const message=String(e.message||'Request unavailable.').slice(0,350),status=e.status||503;return mcp?rpcError(rpcId,-32000,message,status):json({error:message},status);}
}
