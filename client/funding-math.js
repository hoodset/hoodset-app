import { Interface } from 'ethers';
import { SCALE, decimal } from './finance.js';

const events = new Interface([
  'event SharesMinted(address indexed owner,address indexed receiver,uint256 shares,uint256[] amounts)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const ceil = (n,d) => (n+d-1n)/d;

// Match previewMint's ceil rounding, using active backing (never reserves).
export function mintRatio(v) {
  const denominator = v.supply > 0n ? v.supply : SCALE;
  const numerators = v.supply > 0n ? v.available : v.initial;
  if (v.symbols.length < 2 || v.symbols.length > 12 || numerators.length !== v.symbols.length || numerators.some(n=>n<=0n)) throw Error('The vault has incomplete mint backing.');
  return { denominator, numerators };
}
export function mintAmounts(v, shares) {
  if (shares<=0n || shares>v.max-v.supply) throw Error('Share amount exceeds the remaining vault capacity.');
  const r=mintRatio(v);
  return r.numerators.map(n=>ceil(n*shares,r.denominator));
}
export function mintCapacity(v, inventory) {
  const r=mintRatio(v);
  if(inventory.length!==r.numerators.length || inventory.some(n=>n<0n))throw Error('Incomplete component inventory.');
  return inventory.reduce((cap,n,i)=>{const q=n*r.denominator/r.numerators[i];return q<cap?q:cap;},v.max-v.supply);
}
export function vaultIdentity(v) {
  return JSON.stringify([v.address.toLowerCase(),v.assets.map(a=>a.toLowerCase()),v.initial.map(String),String(v.max)]);
}
export function allocateFunding(v, amount, prices, now=Date.now()) {
  const budget=decimal(amount,6),r=mintRatio(v);
  if(budget<=0n)throw Error('Enter a positive USDG budget, with at most 6 decimal places.');
  if(v.max<=v.supply)throw Error('This vault has reached its maximum share supply.');
  const costs=v.symbols.map((s,i)=>{
    const p=prices[s],age=now-Date.parse(p?.at);
    if(!p?.ok || !Number.isFinite(age) || age>120000 || age< -60000 || p.ask18<=0n)throw Error(s+': refresh the missing, paused or stale reference price.');
    return r.numerators[i]*p.ask18;
  });
  const total=costs.reduce((a,b)=>a+b,0n);
  // Largest remainder allocation: every USDG micro-unit is accounted for.
  const allocations=costs.map(c=>budget*c/total);
  const ranked=costs.map((c,i)=>({i,rem:budget*c%total})).sort((a,b)=>a.rem===b.rem?a.i-b.i:a.rem>b.rem?-1:1);
  let remainder=budget-allocations.reduce((a,b)=>a+b,0n);
  for(let i=0;remainder>0n;i++,remainder--)allocations[ranked[i].i]++;
  if(allocations.some(n=>n<=0n))throw Error('The budget is too small to buy every component. Increase it.');
  return {budget,allocations,referenceShares:budget*10n**12n*r.denominator*SCALE/total};
}

// Rebuild from independently verified receipts, never from saved UI step flags.
export function fundingLedger(plan, settlements) {
  const seen=new Set(),bought=plan.rows.map(()=>0n),spent=plan.rows.map(()=>0n);
  let mint=null;
  for(const s of settlements){
    const hash=s.hash?.toLowerCase();
    if(!hash || seen.has(hash))continue;
    seen.add(hash);
    if(s.kind==='mint'){
      if(mint)throw Error('More than one mint receipt belongs to this funding run. Inspect Activity.');
      mint=s;continue;
    }
    const i=s.step;
    if(!Number.isInteger(i)||!plan.rows[i]||s.symbol!==plan.rows[i].symbol||s.account!==plan.account||s.side!=='buy')throw Error('A component receipt does not match this funding run.');
    if(bought[i]>0n)throw Error('Duplicate component purchase. Inspect Activity before continuing.');
    spent[i]=BigInt(s.sellAmount);bought[i]=BigInt(s.buyAmount);
    if(spent[i]<=0n||spent[i]>BigInt(plan.rows[i].allocation)||bought[i]<=0n)throw Error('A component receipt exceeds its USDG allocation.');
  }
  const total=spent.reduce((a,b)=>a+b,0n);
  if(total>BigInt(plan.budget))throw Error('Funding spend exceeds the saved budget.');
  if(mint&&(BigInt(mint.shares)<=0n||mint.amounts.length!==bought.length||bought.some((n,i)=>n<=0n||BigInt(mint.amounts[i])>n)))throw Error('Mint deposits exceed the verified purchases in this run.');
  return {bought,spent,total,mint};
}

export function mintSettlement(receipt, plan, request) {
  if(receipt.status!==1||!same(receipt.from,plan.account)||!same(receipt.to,plan.vault))throw Error('Mint receipt does not match the wallet and vault.');
  let minted=null,shareDelta=0n;
  const deposits=plan.assets.map(()=>0n);
  for(const log of receipt.logs||[]){
    let e;try{e=events.parseLog(log);}catch{continue;}if(!e)continue;
    if(same(log.address,plan.vault)){
      if(e.name==='SharesMinted'&&same(e.args.owner,plan.account)&&same(e.args.receiver,plan.account)){if(minted)throw Error('Unexpected duplicate mint event.');minted=e.args;}
      if(e.name==='Transfer'&&BigInt(e.args.from)===0n&&same(e.args.to,plan.account))shareDelta+=e.args.value;
    }
    const i=plan.assets.findIndex(a=>same(a,log.address));
    if(i>=0&&e.name==='Transfer'&&same(e.args.from,plan.account)&&same(e.args.to,plan.vault))deposits[i]+=e.args.value;
  }
  const shares=BigInt(request.shares);
  if(!minted||minted.shares!==shares||shareDelta!==shares||minted.amounts.length!==deposits.length)throw Error('Minted shares could not be verified from the vault receipt.');
  const amounts=[...minted.amounts];
  if(amounts.some((n,i)=>n<=0n||n>BigInt(request.amounts[i])||deposits[i]!==n))throw Error('Mint deposits do not match the reviewed token bounds.');
  return {kind:'mint',hash:receipt.hash,block:receipt.blockNumber,shares:String(shares),amounts:amounts.map(String)};
}
