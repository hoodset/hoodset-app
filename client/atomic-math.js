import {Interface} from 'ethers';
import {allocateFunding,mintCapacity,vaultIdentity} from './funding-math.js';
import {decimal} from './finance.js';
import {USDG} from '../worker/assets.js';

const events=new Interface([
  'event BasketBought(address indexed owner,address indexed vault,uint256 usdgSpent,uint256 shares,uint256[] contributed,uint256[] deposited,uint256[] refunds)',
  'event BasketSold(address indexed owner,address indexed vault,uint256 shares,uint256 usdgReceived,uint256[] amounts)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();

export function atomicBuyInputs(v,budget,prices,progress,balances){
  if(v.max<=v.supply)throw Error('This vault has reached its share capacity.');
  if(!progress){const a=allocateFunding(v,budget,prices);return{budget:a.budget,allocations:a.allocations,contributed:v.assets.map(()=>0n),legacy:null};}
  const{plan:p,ledger:l}=progress;
  if(!p||!l||p.identity!==vaultIdentity(v)||p.intent||l.pending.length||l.mint||p.rows.length!==v.assets.length)throw Error('Resolve the current purchase before batching.');
  const allocations=p.rows.map((r,i)=>l.bought[i]>0n?0n:BigInt(r.allocation));
  const contributed=l.bought.map((n,i)=>{if(n<0n||(balances[v.symbols[i]]??0n)<n)throw Error('A previously purchased component is no longer available.');return n;});
  const remaining=allocations.reduce((a,b)=>a+b,0n);
  if(l.total+remaining>BigInt(p.budget))throw Error('Batch would exceed the original purchase budget.');
  return{budget:remaining,allocations,contributed,legacy:p.id,previousSpent:l.total,originalBudget:BigInt(p.budget)};
}
export function atomicBuyMinimum(v,inputs,quotes){
  if(quotes.length!==v.assets.length)throw Error('Incomplete batch quote.');
  const amounts=quotes.map((q,i)=>inputs.contributed[i]+(inputs.allocations[i]>0n?BigInt(q?.minBuyAmount||0):0n));
  const shares=mintCapacity(v,amounts);if(shares<=0n)throw Error('The full basket cannot mint a positive share amount.');return shares;
}
export function atomicShareInput(text,v){const shares=decimal(text);if(shares<=0n||shares>v.owned)throw Error('Amount exceeds your available basket shares.');return shares;}
export function atomicReceipt(receipt,{router,account,vault,kind,assets,budget,minimumShares,shares,minimumUSDG,contributed}){
  if(receipt.status!==1||!same(receipt.from,account)||!same(receipt.to,router))throw Error('Batch receipt does not match this wallet and router.');
  const parsed=receipt.logs.flatMap(log=>{if(!same(log.address,router))return[];try{const e=events.parseLog(log);return e?[e]:[]}catch{return[]}});
  const name=kind==='buy'?'BasketBought':'BasketSold',matching=parsed.filter(e=>e.name===name&&same(e.args.owner,account)&&same(e.args.vault,vault));
  if(matching.length!==1)throw Error('Expected exactly one basket settlement.');const e=matching[0].args;
  const transferDelta=(token,from,to)=>receipt.logs.reduce((n,l)=>{if(!same(l.address,token))return n;try{const t=events.parseLog(l);return t?.name==='Transfer'&&same(t.args[0],from)&&same(t.args[1],to)?n+t.args[2]:n;}catch{return n;}},0n);
  if(kind==='buy'){
    if(e.usdgSpent>BigInt(budget)||e.shares<BigInt(minimumShares)||e.deposited.length!==assets.length||e.contributed.length!==assets.length||e.refunds.length!==assets.length)throw Error('Batch buy exceeds the reviewed limits.');
    if(e.contributed.some((n,i)=>n!==BigInt(contributed[i])))throw Error('Batch contributions changed.');
    if(transferDelta(vault,'0x0000000000000000000000000000000000000000',account)!==e.shares)throw Error('Minted share transfer is missing.');
    if(transferDelta(USDG,account,router)-transferDelta(USDG,router,account)!==e.usdgSpent)throw Error('USDG spend does not match settlement.');
    for(let i=0;i<assets.length;i++)if(transferDelta(assets[i],router,vault)!==e.deposited[i]||transferDelta(assets[i],account,router)!==e.contributed[i]||transferDelta(assets[i],router,account)!==e.refunds[i])throw Error('Component deposits/refunds do not match settlement.');
    return{kind,hash:receipt.hash,block:receipt.blockNumber,usdgSpent:String(e.usdgSpent),shares:String(e.shares),contributed:[...e.contributed].map(String),deposited:[...e.deposited].map(String),refunds:[...e.refunds].map(String)};
  }
  if(e.shares!==BigInt(shares)||e.usdgReceived<BigInt(minimumUSDG)||e.amounts.length!==assets.length||transferDelta(vault,router,'0x0000000000000000000000000000000000000000')!==e.shares||transferDelta(vault,account,router)!==e.shares)throw Error('Batch sale does not match the share burn or minimum proceeds.');
  if(transferDelta(USDG,router,account)!==e.usdgReceived)throw Error('USDG proceeds do not match settlement.');
  for(let i=0;i<assets.length;i++)if(transferDelta(assets[i],vault,router)!==e.amounts[i])throw Error('Redeemed components do not match settlement.');
  return{kind,hash:receipt.hash,block:receipt.blockNumber,shares:String(e.shares),usdgReceived:String(e.usdgReceived),amounts:[...e.amounts].map(String)};
}
