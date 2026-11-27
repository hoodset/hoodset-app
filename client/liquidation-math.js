import { Interface } from 'ethers';

const events=new Interface([
  'event AssetsRedeemed(address indexed owner,address indexed receiver,uint256 shares,uint256[] amounts)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();

// The contract rounds withdrawals down and excludes segregated reserves.
export function redemptionAmounts(v,shares){
  if(shares<=0n||v.supply<=0n||shares>v.supply||shares>v.owned)throw Error('Enter shares within your available basket balance.');
  if(v.available.length!==v.symbols.length||v.available.some(n=>n<0n))throw Error('Incomplete active backing.');
  const amounts=v.available.map(n=>n*shares/v.supply);
  if(amounts.some(n=>n===0n))throw Error('This amount rounds a component to zero. Increase the shares; nothing has been redeemed.');
  return amounts;
}

export function redemptionSettlement(receipt,plan,request){
  if(receipt.status!==1||!same(receipt.from,plan.account)||!same(receipt.to,plan.vault)||request.shares!==plan.shares)throw Error('Redemption receipt does not match this exit, wallet and vault.');
  let redeemed=null,burn=0n;
  const wallet=plan.assets.map(()=>0n),backing=plan.assets.map(()=>0n);
  for(const log of receipt.logs||[]){
    let e;try{e=events.parseLog(log);}catch{continue;}if(!e)continue;
    if(same(log.address,plan.vault)){
      if(e.name==='AssetsRedeemed'&&same(e.args.owner,plan.account)&&same(e.args.receiver,plan.account)){if(redeemed)throw Error('Unexpected duplicate redemption event.');redeemed=e.args;}
      if(e.name==='Transfer'&&same(e.args.from,plan.account)&&BigInt(e.args.to)===0n)burn+=e.args.value;
    }
    const i=plan.assets.findIndex(a=>same(a,log.address));
    if(i>=0&&e.name==='Transfer'){
      wallet[i]+=(same(e.args.to,plan.account)?e.args.value:0n)-(same(e.args.from,plan.account)?e.args.value:0n);
      backing[i]+=(same(e.args.from,plan.vault)?e.args.value:0n)-(same(e.args.to,plan.vault)?e.args.value:0n);
    }
  }
  const shares=BigInt(plan.shares);
  if(!redeemed||redeemed.shares!==shares||burn!==shares||redeemed.amounts.length!==plan.assets.length||request.amounts.length!==plan.assets.length)throw Error('The share burn and redeemed components could not be verified.');
  const amounts=[...redeemed.amounts];
  if(amounts.some((n,i)=>n<=0n||n<BigInt(request.amounts[i])||wallet[i]!==n||backing[i]!==n))throw Error('Received components do not match the reviewed redemption bounds.');
  return {kind:'redemption',hash:receipt.hash,block:receipt.blockNumber,shares:String(shares),amounts:amounts.map(String)};
}

// All inventory comes from this redemption's receipt, never a wallet snapshot.
export function liquidationLedger(plan,settlements){
  const unique=new Map();
  for(const s of settlements){if(!s.hash)throw Error('A settlement hash is missing.');if(!unique.has(s.hash.toLowerCase()))unique.set(s.hash.toLowerCase(),s);}
  const burns=[...unique.values()].filter(s=>s.kind==='redemption');
  if(burns.length>1)throw Error('More than one redemption belongs to this exit. Inspect Activity before continuing.');
  const redemption=burns[0]||null,sold=plan.rows.map(()=>0n),proceeds=plan.rows.map(()=>0n);
  if(redemption&&(redemption.shares!==plan.shares||redemption.amounts.length!==plan.rows.length||redemption.amounts.some(n=>BigInt(n)<=0n)||!Number.isSafeInteger(redemption.nonce)||redemption.nonce<0))throw Error('Redemption inventory is incomplete.');
  const sales=[...unique.values()].filter(s=>s.kind!=='redemption').sort((a,b)=>a.nonce-b.nonce);
  for(const s of sales){
    const i=s.step;
    if(!redemption||!Number.isInteger(i)||!plan.rows[i]||s.symbol!==plan.rows[i].symbol||s.side!=='sell'||s.account!==plan.account||!Number.isSafeInteger(s.nonce)||s.nonce<=redemption.nonce)throw Error('A sale does not match the verified redemption.');
    const spent=BigInt(s.sellAmount),received=BigInt(s.buyAmount),remaining=BigInt(redemption.amounts[i])-sold[i],requested=BigInt(s.requestedAmount);
    if(requested!==remaining||spent<=0n||spent>requested||received<=0n)throw Error('A sale exceeds or does not match this exit’s remaining components.');
    sold[i]+=spent;proceeds[i]+=received;
  }
  const remaining=plan.rows.map((_,i)=>redemption?BigInt(redemption.amounts[i])-sold[i]:0n);
  return {redemption,sold,proceeds,remaining,total:proceeds.reduce((a,b)=>a+b,0n),done:!!redemption&&remaining.every(n=>n===0n)};
}
