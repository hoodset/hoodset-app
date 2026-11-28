import {Contract,Interface,isAddress,keccak256,parseUnits} from 'ethers';
import {AGENT_PLAN} from './agent-plan.js';
import {ALLOWED} from '../worker/assets.js';
export const REWARDS_DURATION=604800;
export const REWARDS_RUNTIME='0x5f9d54fd101250e4c7b6e29d30c30667a8d14d9f94bde4f43eec54f3c0af7a8f';
export const REWARDS_HSET=AGENT_PLAN.token;
export const REWARDS_ABI=[
 'function stakingToken() view returns(address)',
 'function rewardTokens() view returns(address[])',
 'function DURATION() view returns(uint256)',
 'function totalStaked() view returns(uint256)',
 'function balanceOf(address) view returns(uint256)',
 'function earned(address,uint256) view returns(uint256)',
 'function rewardState(uint256) view returns(tuple(uint256 budget,uint256 vested,uint256 start,uint256 finish,uint256 queued,uint256 carry,uint256 index,uint256 funded,uint256 paid))',
 'function stake(uint256)', 'function withdraw(uint256)', 'function claim(uint256)', 'function fundRewards(uint256,uint256)', 'function checkpoint()',
 'event Staked(address indexed account,uint256 amount)',
 'event Withdrawn(address indexed account,uint256 amount)',
 'event RewardsFunded(address indexed funder,address indexed token,uint256 amount,bool queued)',
 'event RewardsClaimed(address indexed account,address indexed token,uint256 amount)',
 'event StreamStarted(address indexed token,uint256 amount,uint256 start,uint256 finish)'
];
export const REWARDS_ERC=new Interface(['function approve(address,uint256)','event Transfer(address indexed from,address indexed to,uint256 value)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
export const REWARDS_IFACE=new Interface(REWARDS_ABI);
const tokenAbi=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function decimals() view returns(uint8)','function symbol() view returns(string)'];
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
export function rewardsAmount(text,max){
 if(typeof text!=='string'||!/^\d{1,19}(?:\.\d{1,18})?$/.test(text))throw Error('Enter a positive amount with up to 18 decimals.');
 const n=parseUnits(text,18);if(n<=0n)throw Error('Amount must be positive.');if(max!==undefined&&n>BigInt(max))throw Error('Amount exceeds your available balance.');return n;
}
export function rewardsSymbols(addresses){
 if(!Array.isArray(addresses)||!addresses.length||addresses.length>12||new Set(addresses.map(a=>a.toLowerCase())).size!==addresses.length)throw Error('Invalid reward asset list.');
 return addresses.map(a=>{const s=Object.keys(ALLOWED).find(s=>same(ALLOWED[s],a));if(!s||same(a,REWARDS_HSET))throw Error('Rewards must be distinct supported Stock Tokens.');return s;});
}
export function rewardsTransaction(r){
 if(!isAddress(r.pool))throw Error('Invalid rewards pool.');
 const pool=r.pool.toLowerCase(),amount=BigInt(r.amount||0),i=Number(r.index);
 if(r.kind==='rewards.approval'){
  if(!isAddress(r.token)||amount<0n||amount>10n**36n)throw Error('Invalid token permission.');
  return {to:r.token.toLowerCase(),data:REWARDS_ERC.encodeFunctionData('approve',[pool,amount]),value:0n};
 }
 let fn,args;
 if(r.kind==='rewards.stake'||r.kind==='rewards.withdraw'){if(amount<=0n||amount>10n**36n)throw Error('Invalid HSET amount.');fn=r.kind.slice(8);args=[amount];}
 else if(r.kind==='rewards.fund'){if(!Number.isInteger(i)||i<0||i>11||amount<=0n||amount>10n**36n)throw Error('Invalid funding request.');fn='fundRewards';args=[i,amount];}
 else if(r.kind==='rewards.claim'){if(!Number.isInteger(i)||i<0||i>11)throw Error('Invalid reward asset.');fn='claim';args=[i];}
 else if(r.kind==='rewards.checkpoint'){fn='checkpoint';args=[];}
 else throw Error('Unknown rewards action.');
 return {to:pool,data:REWARDS_IFACE.encodeFunctionData(fn,args),value:0n};
}
export async function readRewardsPool(reader,address,artifact,account=null){
 if(!isAddress(address))throw Error('Enter a valid rewards contract address.');
 if(artifact?.runtimeHash!==REWARDS_RUNTIME||artifact.contractName!=='HoodsetStockRewards')throw Error('Rewards contract build is unavailable.');
 if(Number(BigInt(await reader.send('eth_chainId',[])))!==4663)throw Error('Rewards requires Robinhood Chain mainnet.');
 const block=await reader.getBlock('latest');if(!block||Date.now()/1000-block.timestamp>300||block.timestamp>Date.now()/1000+60)throw Error('The rewards chain reader is stale.');
 const tag={blockTag:block.number},pool=address.toLowerCase(),contract=new Contract(pool,REWARDS_ABI,reader),hset=new Contract(REWARDS_HSET,tokenAbi,reader);
 const [code,hsetCode]=await Promise.all([reader.getCode(pool,block.number),reader.getCode(REWARDS_HSET,block.number)]);
 if(keccak256(code)!==artifact.runtimeHash||keccak256(hsetCode)!==AGENT_PLAN.runtime)throw Error('This address is not a verified HOODSET Stock Rewards pool.');
 const [staking,tokens,duration,total,hsetSymbol,hsetDecimals]=await Promise.all([contract.stakingToken(tag),contract.rewardTokens(tag),contract.DURATION(tag),contract.totalStaked(tag),hset.symbol(tag),hset.decimals(tag)]);
 if(keccak256(code)!==artifact.runtimeHash||!same(staking,REWARDS_HSET)||keccak256(hsetCode)!==AGENT_PLAN.runtime||hsetSymbol!=='HSET'||Number(hsetDecimals)!==18||duration!==BigInt(REWARDS_DURATION))throw Error('This pool does not match the verified HOODSET rewards build and HSET identity.');
 const assets=[...tokens].map(a=>a.toLowerCase()),symbols=rewardsSymbols(assets);
 const rows=await Promise.all(assets.map(async(token,index)=>{
  const c=new Contract(token,tokenAbi,reader);const [r,earned]=await Promise.all([contract.rewardState(index,tag),account?contract.earned(account,index,tag):0n]);
  let held=null,wallet=null,allowance=null,error='';
  try{let decimals;[held,decimals,wallet,allowance]=await Promise.all([c.balanceOf(pool,tag),c.decimals(tag),account?c.balanceOf(account,tag):0n,account?c.allowance(account,pool,tag):0n]);if(Number(decimals)!==18||r.paid>r.funded||held<r.funded-r.paid)throw Error('custody mismatch');}catch{error=symbols[index]+' custody/balance is unavailable. This asset’s funding and claim are paused; HSET withdrawal remains separate.';}
  return {index,token,symbol:symbols[index],budget:r.budget,vested:r.vested,start:Number(r.start),finish:Number(r.finish),queued:r.queued,carry:r.carry,funded:r.funded,paid:r.paid,held,earned,wallet,allowance,error};
 }));
 const [owned,wallet,allowance,custody]=await Promise.all([account?contract.balanceOf(account,tag):0n,account?hset.balanceOf(account,tag):0n,account?hset.allowance(account,pool,tag):0n,hset.balanceOf(pool,tag)]);
 if(custody<total)throw Error('HSET principal custody cannot be verified.');
 return {address:pool,assets,symbols,rows,total,owned,wallet,allowance,custody,healthy:rows.every(x=>!x.error),block:block.number,at:block.timestamp*1000,account};
}
export function rewardsSettlement(receipt,request){
 if(receipt.status!==1||!same(receipt.from,request.account))throw Error('Rewards receipt does not match the account.');
 const expected=rewardsTransaction(request);if(!same(receipt.to,expected.to))throw Error('Rewards receipt target changed.');
 if(request.kind==='rewards.checkpoint')return {kind:request.kind,block:receipt.blockNumber};
 const logs=receipt.logs||[];
 const parsed=(target,iface,name)=>logs.filter(l=>same(l.address,target)).flatMap(l=>{try{const x=iface.parseLog(l);return x?.name===name?[x.args]:[];}catch{return[];}});
 if(request.kind==='rewards.approval'){
  const events=parsed(request.token,REWARDS_ERC,'Approval');if(!events.some(x=>same(x.owner,request.account)&&same(x.spender,request.pool)&&x.value===BigInt(request.amount)))throw Error('Exact rewards approval was not found.');return {kind:request.kind,amount:request.amount,block:receipt.blockNumber};
 }
 const name={'rewards.stake':'Staked','rewards.withdraw':'Withdrawn','rewards.fund':'RewardsFunded','rewards.claim':'RewardsClaimed'}[request.kind],events=parsed(request.pool,REWARDS_IFACE,name);
 const event=events.find(x=>same(x.account||x.funder,request.account)&&(!x.token||same(x.token,request.token)));
 if(!event||event.amount<=0n||request.kind!=='rewards.claim'&&event.amount!==BigInt(request.amount))throw Error('Rewards accounting event was not found.');
 const outgoing=request.kind==='rewards.withdraw'||request.kind==='rewards.claim',from=outgoing?request.pool:request.account,to=outgoing?request.account:request.pool;
 const transfers=parsed(request.token,REWARDS_ERC,'Transfer').filter(x=>same(x.from,from)&&same(x.to,to));
 if(transfers.reduce((n,x)=>n+x.value,0n)!==event.amount)throw Error('Rewards token transfer did not match accounting.');
 return {kind:request.kind,token:request.token,amount:String(event.amount),block:receipt.blockNumber};
}
