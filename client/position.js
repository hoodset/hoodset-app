import {SCALE, completeValue, units, usd} from './finance.js';

// Match previewRedeem's rounding; reserved balances are already excluded from available.
export function positionBreakdown(v,prices,{perShare=false}={}){
 const amount=perShare?SCALE:v.owned,planned=perShare&&v.supply===0n;
 if(amount<0n||v.supply<0n||!perShare&&amount>v.supply)throw Error('Invalid share position.');
 const quantities=planned?[...v.initial]:v.available.map(n=>v.supply?BigInt(n)*amount/v.supply:0n);
 const total=completeValue(v.symbols,quantities,prices);
 const rows=v.symbols.map((symbol,i)=>{const mark=prices[symbol],value=mark?.ok?quantities[i]*mark.mid18/SCALE:null;return{symbol,quantity:quantities[i],value,weightBps:total!==null&&total>0n?value*10000n/total:null};});
 return{shares:amount,planned,total,rows};
}

export function positionPanel(v,prices,{esc,perShare=false}={}){
 const x=positionBreakdown(v,prices,{perShare});
 return `<section class="position-lookthrough" aria-label="${perShare?'Stock Tokens per basket share':'Stock Tokens represented by your shares'}"><div class="position-summary"><div><small>${perShare?(x.planned?'PLANNED COMPOSITION':'ONE BASKET SHARE'): 'YOUR BASKET POSITION'}</small><strong>${units(x.shares,18,12)} ${esc(v.symbol)}</strong></div><div><small>REFERENCE VALUE</small><strong>${usd(x.total)}</strong></div></div><p>${perShare?'Each basket share represents the token quantities below.':'Your shares represent these Stock Token quantities in the vault.'} Reference value is an estimate; an executable USDG sale needs a fresh quote.</p><div class="table-scroll"><table><thead><tr><th>STOCK TOKEN</th><th>${perShare?'TOKENS / SHARE':'TOKENS IN YOUR POSITION'}</th><th>CURRENT WEIGHT</th><th>REFERENCE VALUE</th></tr></thead><tbody>${x.rows.map(r=>`<tr><td><b>${esc(r.symbol)}</b></td><td title="${r.quantity}">${units(r.quantity,18,12)}</td><td>${r.weightBps===null?'—':units(r.weightBps,2,2)+'%'}</td><td>${usd(r.value)}</td></tr>`).join('')}</tbody></table></div>${!perShare&&v.owned===0n?'<p>You hold no active shares in this basket. After a completed sale, these quantities are zero.</p>':''}<p class="footnote">The share quantity is a unit count, not a dollar balance. Redemption returns RH Stock Tokens; they provide economic exposure to stocks and ETFs, without direct shareholder rights. <a href="https://docs.robinhood.com/chain/stock-tokens/" target="_blank" rel="noreferrer">How RH Stock Tokens work</a>.</p></section>`;
}
