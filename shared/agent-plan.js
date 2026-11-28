export const AGENT_PLAN={id:'hset-1000-v1',token:'0x2c94879c2b482d1838ccce3cd00ffd96a82fbcb8',runtime:'0x040904d1ae06fb97e0a6fdf5ed8d79ac42209ff7c8965347f3a118f1b01a4738',recipient:'0xfff16ba1b3e7766cd89171661d2963fd1eaff0a1',chainId:4663,decimals:18,amount:'100000000000000000000000',displayAmount:'100,000',credits:1000,confirmations:20};
export const AGENT_ORIGIN='https://www.hoodset.space';
export const AGENT_PROTOCOLS=['2026-07-28','2025-11-25','2025-06-18'];
export const AGENT_REQUEST_LIMIT=32768;
export const AGENT_LEASE=90000;
export const agentAddress=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/i.test(value)?value.toLowerCase():null;
export function agentMessage({account,nonce,action,payload,expiresAt}){
 return ['HOODSET API authorization',`Domain: ${AGENT_ORIGIN}`,`Chain: ${AGENT_PLAN.chainId}`,`Account: ${account}`,`Action: ${action}`,`Payload: ${payload}`,`Nonce: ${nonce}`,`Expires: ${new Date(expiresAt).toISOString()}`,'This authorizes API key management only. It cannot transfer tokens or sign trades.'].join('\n');
}
export const agentJson=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v);
export const agentHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export const agentSecret=()=>{const a=new Uint8Array(32);crypto.getRandomValues(a);return Array.from(a,v=>v.toString(16).padStart(2,'0')).join('');};
