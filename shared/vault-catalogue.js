import {isAddress,keccak256,Interface} from 'ethers';
import {ALLOWED} from '../worker/assets.js';

export const VAULT_RUNTIME_HASH='0xff6b4155860a506a2188d2bf92c001ab7362e8303cb304ed65243d64e5adc658';
export const VAULT_RUNTIME_BYTES=7788;
export const CATALOGUE_PAGE_SIZE=8;
export const SNAPSHOT_MAX_AGE=120000;
export const VAULT_READ_ABI=['function name() view returns(string)','function symbol() view returns(string)','function thesis() view returns(string)','function creator() view returns(address)','function createdAt() view returns(uint256)','function maxSupply() view returns(uint256)','function totalSupply() view returns(uint256)','function assets() view returns(address[])','function initialQuantities() view returns(uint256[])','function initialWeights() view returns(uint16[])','function availableBalances() view returns(uint256[])','function reserved(uint256) view returns(uint256)'];
const abi=new Interface(VAULT_READ_ABI),erc=new Interface(['function balanceOf(address) view returns(uint256)']);
const SCALE=10n**18n,MAX=2n**256n,byAddress=Object.fromEntries(Object.entries(ALLOWED).map(([s,a])=>[a.toLowerCase(),s]));
export function catalogueAddress(value){if(typeof value!=='string'||value.length!==42||!isAddress(value)||/^0x0{40}$/i.test(value))throw Error('Enter a valid RH mainnet vault address.');return value.toLowerCase();}
const uint=x=>typeof x==='string'&&/^(0|[1-9]\d{0,77})$/.test(x)&&BigInt(x)<MAX;
const text=(x,min,max)=>typeof x==='string'&&x.trim().length>=min&&new TextEncoder().encode(x).length<=max;
export function validateVaultSnapshot(v){
 if(!v||v.chainId!==4663||v.runtimeHash!==VAULT_RUNTIME_HASH)throw Error('Unsupported vault runtime or network.');
 const address=catalogueAddress(v.address),creator=catalogueAddress(v.creator);
 if(!text(v.name,1,48)||!text(v.thesis,1,280)||!text(v.symbol,2,8)||!/^[A-Z][A-Z0-9]{1,7}$/.test(v.symbol))throw Error('Invalid onchain basket metadata.');
 if(!Number.isSafeInteger(v.block)||v.block<1||!Number.isSafeInteger(v.createdAt)||v.createdAt<1||!Number.isSafeInteger(v.checkedAt)||v.checkedAt<1||!Number.isSafeInteger(v.blockTime)||v.createdAt>v.blockTime||v.blockTime*1000>v.checkedAt+60000||v.checkedAt-v.blockTime*1000>300000)throw Error('A recent consistent chain snapshot is required.');
 if(!uint(v.supply)||!uint(v.maxSupply)||BigInt(v.maxSupply)<=0n||BigInt(v.maxSupply)>1000000n*SCALE||BigInt(v.supply)>BigInt(v.maxSupply))throw Error('Invalid issued share supply.');
 const n=v.symbols?.length;
 if(!Array.isArray(v.symbols)||n<2||n>12||new Set(v.symbols).size!==n||v.symbols.some(s=>!Object.hasOwn(ALLOWED,s)))throw Error('Unsupported basket composition.');
 for(const key of ['initial','available','reserved','balances'])if(!Array.isArray(v[key])||v[key].length!==n||v[key].some(x=>!uint(x)))throw Error('Incomplete basket backing.');
 if(v.initial.some(x=>BigInt(x)<=0n||BigInt(x)>10n**30n)||!Array.isArray(v.weights)||v.weights.length!==n||v.weights.some(w=>!Number.isInteger(w)||w<=0||w>10000)||v.weights.reduce((s,w)=>s+w,0)!==10000)throw Error('Invalid initial allocation.');
 for(let i=0;i<n;i++)if(BigInt(v.balances[i])<BigInt(v.reserved[i])||BigInt(v.balances[i])-BigInt(v.reserved[i])!==BigInt(v.available[i]))throw Error('Backing and reserves do not reconcile.');
 return {address,creator,chainId:4663,runtimeHash:VAULT_RUNTIME_HASH,name:v.name,symbol:v.symbol,thesis:v.thesis,createdAt:v.createdAt,block:v.block,blockTime:v.blockTime,checkedAt:v.checkedAt,supply:v.supply,maxSupply:v.maxSupply,symbols:[...v.symbols],weights:[...v.weights],initial:[...v.initial],available:[...v.available],reserved:[...v.reserved],balances:[...v.balances]};
}

// Every state and token-balance call uses one concrete block. No wallet or transaction writes.
export async function readVaultSnapshot(input,rpc,{now=Date.now}={}){
 const address=catalogueAddress(input);
 if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error('RPC is not Robinhood Chain mainnet.');
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 if(!block||!/^0x[0-9a-f]+$/i.test(block.number||'')||!/^0x[0-9a-f]+$/i.test(block.timestamp||''))throw Error('A recent chain block is unavailable.');
 const code=await rpc('eth_getCode',[address,block.number]);
 if(typeof code!=='string'||code.length!==2+VAULT_RUNTIME_BYTES*2||keccak256(code)!==VAULT_RUNTIME_HASH)throw Error('This address does not match the HOODSET vault runtime.');
 const call=async(fn,args=[])=>abi.decodeFunctionResult(fn,await rpc('eth_call',[{to:address,data:abi.encodeFunctionData(fn,args)},block.number]))[0];
 const [name,symbol,thesis,creator,createdAt,maxSupply,supply,assets,initial,weights,available]=await Promise.all(['name','symbol','thesis','creator','createdAt','maxSupply','totalSupply','assets','initialQuantities','initialWeights','availableBalances'].map(fn=>call(fn)));
 const symbols=[...assets].map(a=>byAddress[a.toLowerCase()]);
 if(symbols.length<2||symbols.length>12||symbols.some(s=>!s)||new Set(symbols).size!==symbols.length)throw Error('Unsupported basket components.');
 const [reserved,balances]=await Promise.all([Promise.all(symbols.map((_,i)=>call('reserved',[i]))),Promise.all([...assets].map(async a=>erc.decodeFunctionResult('balanceOf',await rpc('eth_call',[{to:a,data:erc.encodeFunctionData('balanceOf',[address])},block.number]))[0]))]);
 return validateVaultSnapshot({address,creator,chainId:4663,runtimeHash:VAULT_RUNTIME_HASH,name,symbol,thesis,createdAt:Number(createdAt),block:Number(BigInt(block.number)),blockTime:Number(BigInt(block.timestamp)),checkedAt:now(),supply:String(supply),maxSupply:String(maxSupply),symbols,initial:[...initial].map(String),weights:[...weights].map(Number),available:[...available].map(String),reserved:reserved.map(String),balances:balances.map(String)});
}

export function createCatalogueRpc(url,{fetcher=fetch}={}){
 let pending=[],scheduled=false,id=0;
 async function flush(){scheduled=false;const jobs=pending;pending=[];
  for(let i=0;i<jobs.length;i+=10){const chunk=jobs.slice(i,i+10);try{
   let rows;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(chunk.map(x=>x.body)),signal:AbortSignal.timeout(8000)});
     if(!response.ok)throw Object.assign(Error('Chain reader unavailable. Retry shortly.'),{retryable:response.status===429||response.status>=500});
     const raw=await response.text();if(raw.length>600000)throw Error('Chain response exceeded the read limit.');
     rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length!==chunk.length||new Set(rows.map(x=>x.id)).size!==chunk.length)throw Error('Incomplete chain response.');
     if(rows.some(x=>x.error&&[-32005,-32016].includes(x.error.code)))throw Object.assign(Error('Chain read limit reached.'),{retryable:true});
     break;
    }catch(e){if(attempt===1||!e.retryable&&!(e instanceof TypeError)&&e.name!=='TimeoutError')throw e;await new Promise(resolve=>setTimeout(resolve,350));}
   }
   for(const job of chunk){const row=rows.find(x=>x.id===job.body.id);if(!row||row.error||!Object.hasOwn(row,'result'))job.reject(Error('A vault read failed ('+(row?.error?.code??'missing result')+'). Retry with a healthy RPC.'));else job.resolve(row.result);}
  }catch(e){for(const job of chunk)job.reject(e);}}
 }
 return (method,params)=>new Promise((resolve,reject)=>{pending.push({body:{jsonrpc:'2.0',id:++id,method,params},resolve,reject});if(!scheduled){scheduled=true;queueMicrotask(flush);}});
}
