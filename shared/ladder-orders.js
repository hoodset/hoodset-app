import {Interface,parseUnits,keccak256} from 'ethers';
import {ALLOWED,USDG} from '../worker/assets.js';
export const LADDER_ABI=[
 'function BUILD_ID() view returns(bytes32)',
 'function MAX_FEED_AGE() view returns(uint256)',
 'function markets(address) view returns(address feed,uint8 decimals,uint32 maxAge)',
 'function nextId() view returns(uint256)',
 'function strategies(uint256) view returns(address owner,address token,uint64 expiresAt,uint16 profitBps,uint16 maxCycles,uint16 cycles,bool active,uint256 revision,uint256 budget,uint256 cash,uint256 tokens,uint256 cost)',
 'function levels(uint256) view returns(tuple(uint256 price,uint256 budget,uint256 remaining)[])',
 'function ownedCount(address) view returns(uint256)',
 'function ownedId(address,uint256) view returns(uint256)',
 'function price(address) view returns(uint256)',
 'function reserved(uint256) view returns(uint256)',
 'function minimumProceeds(uint256) view returns(uint256)',
 'function open(address,uint256[],uint256[],uint16,uint16,uint64) returns(uint256)',
 'function stop(uint256)',
 'function withdrawCash(uint256,uint256)',
 'function withdrawTokens(uint256,uint256)',
 'function buy(uint256,uint256,uint256,tuple(uint256 amount,uint256 minimum,bytes data),uint256)',
 'function sell(uint256,uint256,tuple(uint256 amount,uint256 minimum,bytes data),uint256)',
 'event Opened(uint256 indexed id,address indexed owner,address indexed token,uint256 budget)',
 'event Bought(uint256 indexed id,uint256 indexed level,uint256 spent,uint256 received,uint256 cost,uint256 tokens)',
 'event Sold(uint256 indexed id,uint256 tokens,uint256 received,uint256 cost,uint256 cycle,bool rearmed)',
 'event Stopped(uint256 indexed id)',
 'event Withdrawn(uint256 indexed id,address indexed token,uint256 amount)'
];
export const LADDER_IFACE=new Interface(LADDER_ABI);
export const LADDER_BUILD=keccak256(new TextEncoder().encode('HOODSET_LADDER_ORDERS_V1'));
export const LADDER_SCALE=10n**30n;
export const ceil=(a,b)=>(a+b-1n)/b;
const decimal=(x,d)=>{if(!/^(0|[1-9][0-9]{0,11})(\.[0-9]+)?$/.test(String(x)))throw Error('Enter a positive decimal number.');try{return parseUnits(String(x),d);}catch{throw Error('Use at most '+d+' decimal places.');}};
export function orderPlan(input,mark18=null){
 if(!Object.hasOwn(ALLOWED,input?.symbol))throw Error('Select a supported Stock Token.');
 if(!Array.isArray(input.levels)||input.levels.length<1||input.levels.length>8)throw Error('Use 1–8 buy levels.');
 const profitBps=Number(decimal(input.profit,2));if(profitBps<100||profitBps>10000)throw Error('Take profit must be from 1% to 100%.');
 const cycles=Number(input.cycles);if(!Number.isInteger(cycles)||cycles<1||cycles>100)throw Error('Choose 1–100 cycles.');
 const days=Number(input.days);if(!Number.isInteger(days)||days<1||days>90)throw Error('Choose an expiry from 1 to 90 days.');
 let total=0n,prior=0n,cost=0n,tokens=0n;
 const levels=input.levels.map((r,i)=>{
  const price=decimal(r.price,18),budget=decimal(r.budget,6);
  if(price<=0n||price>10n**30n)throw Error('Buy prices must be positive.');
  if(i&&price>=prior)throw Error('Buy prices must decrease from top to bottom.');
  if(mark18!==null&&price>=BigInt(mark18))throw Error('Every buy level must be below the fresh token price.');
  if(budget<1000000n||budget>1000000000000n)throw Error('Each level needs 1–1,000,000 USDG.');
  total+=budget;cost+=budget;tokens+=budget*LADDER_SCALE/price;prior=price;
  if(tokens===0n)throw Error('Level amount is too small.');
  const average18=ceil(cost*LADDER_SCALE,tokens),target=ceil(cost*BigInt(10000+profitBps),10000n);
  return {price,budget,tokens:budget*LADDER_SCALE/price,cumulativeCost:cost,cumulativeTokens:tokens,average18,target,exit18:ceil(target*LADDER_SCALE,tokens)};
 });
 if(total>1000000000000n)throw Error('Total budget must not exceed 1,000,000 USDG.');
 return {symbol:input.symbol,token:ALLOWED[input.symbol],levels,total,profitBps,cycles,days};
}
export function minimumBuy(amount,price18){if(BigInt(amount)<=0n||BigInt(price18)<=0n)throw Error('Invalid buy bound.');return ceil(BigInt(amount)*LADDER_SCALE,BigInt(price18));}
export function minimumSell(cost,profitBps){if(BigInt(cost)<=0n||!Number.isInteger(Number(profitBps))||Number(profitBps)<100||Number(profitBps)>10000)throw Error('Invalid exit bound.');return ceil(BigInt(cost)*BigInt(10000+Number(profitBps)),10000n);}
export function ladderTransaction(r){
 const id=BigInt(r.id??0),amount=BigInt(r.amount??0);let to=r.engine,data;
 if(r.kind==='orders.approval'){if(!/^0x[0-9a-fA-F]{40}$/.test(r.engine))throw Error('Invalid engine.');to=USDG;data=new Interface(['function approve(address,uint256)']).encodeFunctionData('approve',[r.engine,amount]);}
 else if(r.kind==='orders.open'){const p=orderPlan(r.plan);data=LADDER_IFACE.encodeFunctionData('open',[p.token,p.levels.map(x=>x.price),p.levels.map(x=>x.budget),p.profitBps,p.cycles,r.expiresAt]);}
 else if(r.kind==='orders.stop')data=LADDER_IFACE.encodeFunctionData('stop',[id]);
 else if(r.kind==='orders.cash')data=LADDER_IFACE.encodeFunctionData('withdrawCash',[id,amount]);
 else if(r.kind==='orders.tokens')data=LADDER_IFACE.encodeFunctionData('withdrawTokens',[id,amount]);
 else throw Error('Unknown ladder operation.');
 return {to,data,value:0n};
}
export function ladderReceipt(receipt,r){
 const events=[];for(const log of receipt.logs||[]){if(String(log.address).toLowerCase()!==r.engine.toLowerCase())continue;try{const e=LADDER_IFACE.parseLog(log);if(e)events.push(e);}catch{}}
 const name={'orders.open':'Opened','orders.stop':'Stopped','orders.cash':'Withdrawn','orders.tokens':'Withdrawn'}[r.kind];
 if(r.kind==='orders.approval'){
  const erc=new Interface(['event Approval(address indexed owner,address indexed spender,uint256 value)']);
  const ok=(receipt.logs||[]).some(l=>{if(l.address.toLowerCase()!==USDG.toLowerCase())return false;try{const e=erc.parseLog(l);return e.args.owner.toLowerCase()===r.account&&e.args.spender.toLowerCase()===r.engine.toLowerCase()&&e.args.value===BigInt(r.amount);}catch{return false;}});
  if(!ok)throw Error('Exact USDG permission was not confirmed.');return {kind:r.kind};
 }
 const e=events.find(x=>x.name===name&&(r.kind==='orders.open'||x.args.id===BigInt(r.id)));
 if(!e)throw Error('Expected strategy event was not confirmed.');
 if(r.kind==='orders.open'&&(e.args.owner.toLowerCase()!==r.account||e.args.token.toLowerCase()!==ALLOWED[r.plan.symbol].toLowerCase()||e.args.budget!==orderPlan(r.plan).total))throw Error('Opened strategy does not match the requested wallet and budget.');
 if(name==='Withdrawn'&&(e.args.amount!==BigInt(r.amount)||e.args.token.toLowerCase()!==(r.kind==='orders.cash'?USDG:ALLOWED[r.symbol]).toLowerCase()))throw Error('Withdrawal event does not match the requested asset and amount.');
 return {kind:r.kind,id:String(e.args.id),engine:r.engine,block:receipt.blockNumber};
}
