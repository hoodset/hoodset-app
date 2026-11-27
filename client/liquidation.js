import { Interface,formatUnits } from 'ethers';
import { ALLOWED } from '../worker/assets.js';
import { OPENOCEAN_ROUTER,OPENOCEAN_CALLER,openOceanInput,reviewOpenOcean } from '../shared/openocean.js';
import { fetchOpenOcean,browserOpenOceanJson } from '../shared/openocean-api.js';
import { swapSettlement } from '../shared/settlement.js';
import { vaultIdentity } from './funding-math.js';
import { redemptionAmounts,redemptionSettlement,liquidationLedger } from './liquidation-math.js';
import { createRunTracker } from './run-tracker.js';
import { CHAIN_ID,decimal,units,short } from './finance.js';

const approvalABI=new Interface(['function approve(address spender,uint256 amount) returns(bool)']);
export function createLiquidation(d){
  const {state,saved,esc,btn,heading,save,render,assertWallet,loadVault,loadBalances,token,vault,transactionReview,approveToken,expirePrices,notify}=d;
  const view={shares:'',slippage:100,busy:false,error:'',message:''};
  const runs=()=>Array.isArray(saved.liquidationRuns)?saved.liquidationRuns:[];
  const current=a=>runs().findLast(p=>!p.archived&&p.account===state.account&&p.vault===a.toLowerCase());
  const byId=id=>runs().find(p=>p.id===id);
  const quoteFor=d.fetchQuote||((input)=>fetchOpenOcean(openOceanInput(input),browserOpenOceanJson));
  let storageError='';
  try{
    const addr=a=>/^0x[0-9a-f]{40}$/.test(a||''),amount=n=>/^[1-9][0-9]{0,76}$/.test(String(n))&&BigInt(n)<2n**256n;
    if(saved.liquidationRuns!==undefined&&!Array.isArray(saved.liquidationRuns))throw Error();
    for(const p of runs())if(!p||p.version!==1||p.chain!==CHAIN_ID||typeof p.id!=='string'||!addr(p.account)||!addr(p.vault)||!amount(p.shares)||!amount(p.estimate)||!Number.isSafeInteger(p.at)||typeof p.identity!=='string'||!Array.isArray(p.rows)||p.rows.length<2||p.rows.length>12||new Set(p.rows.map(r=>r?.symbol)).size!==p.rows.length||!Array.isArray(p.assets)||p.assets.length!==p.rows.length||p.rows.some((r,i)=>!Object.hasOwn(ALLOWED,r?.symbol)||!amount(r.amount)||p.assets[i]?.toLowerCase()!==ALLOWED[r.symbol].toLowerCase())||![50,100,200,300].includes(p.slippage)||!Array.isArray(p.transactions))throw Error();
  }catch{storageError='Saved exit data could not be read safely. No redemption or sale will be sent. Keep browser storage and inspect wallet Activity.';}
  function validate(p,v){if(!p||p.chain!==CHAIN_ID||p.account!==state.account||p.vault!==v.address||p.identity!==vaultIdentity(v)||p.rows.length!==v.symbols.length||p.rows.some((r,i)=>r.symbol!==v.symbols[i]))throw Error('This exit does not match the connected wallet and vault.');}
  function prices(v){expirePrices();for(const s of v.symbols)if(!state.prices[s]?.ok||state.tokenChecks[s]?.paused||!state.assets.some(a=>a.tokenSymbol===s))throw Error(s+': refresh the missing, paused or stale reference price.');}
  function bindRequest(p,r,tx){
    if(r.exit!==p.id||BigInt(tx.value||0n)!==0n)throw Error('Transaction belongs to another exit or sends unexpected ETH.');
    if(r.kind==='liquidation.redeem'){
      const x=vault(p.vault).interface.decodeFunctionData('redeem',tx.data);
      if(tx.to.toLowerCase()!==p.vault||String(x[0])!==p.shares||r.shares!==p.shares||x[1].toLowerCase()!==p.account||JSON.stringify([...x[2]].map(String))!==JSON.stringify(r.amounts))throw Error('Redemption calldata does not match the reviewed shares and receiver.');
    }else if(r.kind==='liquidation.swap'){
      if(tx.to.toLowerCase()!==OPENOCEAN_ROUTER.toLowerCase()||tx.data.toLowerCase()!==r.quote.transaction.data.toLowerCase())throw Error('Sale calldata does not match the reviewed router and quote.');
    }else if(r.kind==='liquidation.approval'){
      const x=approvalABI.decodeFunctionData('approve',tx.data);
      if(r.symbol!==p.rows[r.step]?.symbol||tx.to.toLowerCase()!==ALLOWED[r.symbol]?.toLowerCase()||r.spender?.toLowerCase()!==OPENOCEAN_ROUTER.toLowerCase()||x[0].toLowerCase()!==OPENOCEAN_ROUTER.toLowerCase()||String(x[1])!==r.amount)throw Error('Component approval does not match this exit and router.');
    }else throw Error('Unrecognized exit transaction.');
  }
  const tracker=createRunTracker({d,key:'liquidationRuns',prefix:'liquidation',ledger:liquidationLedger,settle(p,r,receipt,tx){
    bindRequest(p,r,tx);
    if(r.kind==='liquidation.redeem'){
      return redemptionSettlement(receipt,p,r);
    }
    if(r.kind==='liquidation.swap'){
      const input={symbol:p.rows[r.step]?.symbol,side:'sell',amount:r.amount,slippageBps:p.slippage,taker:p.account};
      reviewOpenOcean(r.quote,input,r.quote.requestedAt);
      return {...swapSettlement(receipt,r.quote),step:r.step,requestedAmount:r.amount};
    }
    if(r.kind==='liquidation.approval'){
      return null;
    }
    throw Error('Unrecognized exit transaction.');
  }});
  const info=(k,v)=>`<div class="meta-pair"><span>${k}</span><strong>${v}</strong></div>`;
  function page(address){
    if(storageError)return heading('CHECK SAVED EXIT DATA.',storageError)+'<a class="btn" href="#portfolio">OPEN PORTFOLIO & ACTIVITY</a>';
    const a=address.toLowerCase(),v=state.vaults[a];
    if(!v)return `${heading('BACK TO USDG.','Checking the existing vault, composition and position.')}<div class="notice" role="status">${esc(state.vaultErrors[a]||'Reading RH mainnet…')}</div>${btn('REFRESH VAULT','refresh')}`;
    const p=current(a),l=p&&tracker.cache.get(p.id),done=!!l?.done,redeemed=!!l?.redemption,count=l?.remaining.filter(n=>n===0n).length||0,phase=done?3:redeemed?2:p?1:0;
    return `<div class="fund-page exit-page">${heading('ONE SET.<br>BACK TO USDG.',`Redeem ${esc(v.symbol)} shares, then sell every received component. Same vault. Same wallet.`,'SHARES / STOCK TOKENS / USDG')}<div class="basket-meta"><span class="badge lime">RH MAINNET / 4663</span><a href="#basket/${a}" class="address">${short(a)} / EXISTING VAULT</a><span>${v.symbols.length} COMPONENTS</span></div><ol class="fund-steps" aria-label="Basket sale progress">${['Choose shares','Redeem shares','Sell components','USDG received'].map((s,i)=>`<li class="${i===phase?'active':i<phase?'done':''}" ${i===phase?'aria-current="step"':''}>${s}</li>`).join('')}</ol><div class="fund-grid"><section class="panel fund-main"><div class="panel-heading"><h2>${done?'YOUR EXIT IS COMPLETE.':redeemed?'COMPONENTS IN YOUR WALLET':p?'READY TO REVIEW REDEMPTION':'CHOOSE YOUR EXIT'}</h2><span class="badge">${done?'RECEIPTS VERIFIED':redeemed?count+' / '+v.symbols.length+' SOLD':'LIVE / WALLET SIGNATURES'}</span></div>${!p?`${info('Available shares',state.account?units(v.owned,18,12)+' '+esc(v.symbol):'Connect wallet')}<form id="exit-setup"><div class="fund-inputs"><label>BASKET SHARES TO SELL<div class="exit-amount"><input id="exit-shares" aria-label="Basket shares to sell" type="text" inputmode="decimal" placeholder="Enter shares" value="${esc(view.shares)}" ${view.busy?'disabled':''}>${btn('MAX','exit-max','text-btn',`data-vault="${a}"`,!state.account||v.owned===0n||view.busy)}</div></label><label>SLIPPAGE PER SWAP<select id="exit-slippage" ${view.busy?'disabled':''}>${[[50,'0.5%'],[100,'1%'],[200,'2%'],[300,'3%']].map(([n,t])=>`<option value="${n}" ${view.slippage===n?'selected':''}>${t}</option>`).join('')}</select></label></div><p>We check the proportional redemption and a sell route for every component before any share burn.</p>${state.account?(state.chain!==CHAIN_ID?btn('SWITCH TO RH MAINNET','switch','primary wide'):v.owned===0n?`<div class="notice"><h3>NO AVAILABLE SHARES</h3><p>This wallet has no ${esc(v.symbol)} shares to redeem. Existing Stock Tokens and reserved exits are separate.</p><a href="#fund/${a}">Buy this basket with USDG</a></div>`:btn(view.busy?'CHECKING ALL SELL ROUTES…':'CHECK REDEMPTION & ROUTES','exit-plan','primary wide',`data-vault="${a}"`,view.busy)):btn('CONNECT WALLET TO CONTINUE','connect','primary wide')}<small class="footnote">No signatures during this check. Max selects your full available share balance.</small></form>`:`${info('Shares selected',units(BigInt(p.shares),18,12)+' '+esc(v.symbol))}${info('USDG estimated at route check',units(BigInt(p.estimate),6,6)+' USDG')}${info('USDG actually received',l?units(l.total,6,6)+' USDG':'Checking receipts…')}${info('Wallet',short(p.account))}<p class="footnote">Route-check estimate / ${new Date(p.checkedAt||p.at).toLocaleString()}. It is not a guaranteed USDG amount. Each sale uses a fresh minimum-output quote. ETH gas is separate.</p>${done?`<p class="notice">The selected shares were burned and every received component was sold. The USDG total above comes from these sale receipts only.</p><a class="btn primary wide" href="#portfolio">VIEW MY PORTFOLIO</a>${btn('START ANOTHER EXIT','exit-new','wide',`data-vault="${a}"`)}<a class="btn wide" href="#fund/${a}">BUY THIS BASKET AGAIN</a>`:`<div class="fund-next"><h3>${redeemed?'NEXT: SELL '+esc(v.symbols[l.remaining.findIndex(n=>n>0n)]||'REMAINING COMPONENTS'):'NEXT: REDEEM YOUR SHARES'}</h3><p>${redeemed?'Approve the exact remaining component amount if needed, then review its sale for USDG. Only tokens received in this exit are counted.':'Redemption burns the selected shares and sends proportional components to your wallet. It does not itself return USDG.'}</p>${btn(view.busy?esc(view.message||'CHECKING…'):l?.pending.length?'CHECK PENDING TRANSACTION':!l?'VERIFY & RESUME EXIT':redeemed?'CONTINUE COMPONENT SALES':'REVIEW REDEMPTION','exit-next','primary wide',`data-vault="${a}"`,view.busy||!!p.intent)}</div>${p.intent||l?.pending.length?`<div class="notice warn"><h3>${p.intent?'CHECK THE LAST WALLET REQUEST':'WAITING FOR RH INCLUSION'}</h3><p>${p.intent?'The wallet did not return a hash. Recover it from wallet activity before retrying.':'No second redemption or sale is allowed while this transaction is pending.'}</p>${(l?.pending||[]).map(t=>`<a class="address" target="_blank" rel="noreferrer" href="https://robinhoodchain.blockscout.com/tx/${t.hash}">${short(t.hash)}</a>`).join(' ')}<details><summary>${p.intent?'Recover transaction hash':'Track a speed-up or cancellation'}</summary><p>Paste the original hash, an identical same-nonce speed-up, or a confirmed zero-value self-cancellation.</p><label>TRANSACTION HASH<input id="exit-recovery-hash" autocomplete="off" placeholder="0x…"></label>${btn('VERIFY TRANSACTION','exit-recover','wide',`data-vault="${a}"`,view.busy)}</details></div>`:''}${btn('REFRESH RECEIPTS & BALANCES','exit-refresh','wide',`data-vault="${a}"`,view.busy)}${!redeemed&&!p.intent&&!l?.pending.length?btn('CHANGE SHARE AMOUNT','exit-reset','text-btn',`data-vault="${a}"`,view.busy):''}<p class="footnote">Leave and resume in this browser with the same wallet. Confirmed redemptions and sales will not be repeated.</p>`}`}
    <div id="exit-error" class="form-error" role="alert">${esc(view.error)}</div>${view.busy?`<p role="status">${esc(view.message)}</p>`:''}</section><aside class="panel fund-summary"><h2>${redeemed?'TRACK EVERY COMPONENT.':'WHAT YOU WILL REDEEM.'}</h2>${v.symbols.map((s,i)=>`<div class="fund-component ${redeemed&&l.remaining[i]===0n?'purchased':''}"><div><strong>${s}</strong><span>${redeemed&&l.remaining[i]===0n?'SOLD':redeemed?'TO SELL':p?'PREVIEW':'PROPORTIONAL'}</span></div>${redeemed?`<small>Received: ${units(BigInt(l.redemption.amounts[i]),18,18)}</small><small>Remaining: ${units(l.remaining[i],18,18)}</small><small>Received USDG: ${units(l.proceeds[i],6,6)}</small>`:p?`<small>${units(BigInt(p.rows[i].amount),18,18)} tokens / preview</small>`:'<small>Exact quantity after the share check</small>'}</div>`).join('')}<p class="footnote">Existing wallet holdings and previously reserved exits are excluded. No remaining component is silently discarded as dust.</p></aside></div><section class="fund-disclosure"><div><h3>REDEEM, THEN SELL</h3><p>One redemption, exact component approvals as needed, then separate Stock Token sales. Every transaction requires your wallet confirmation. Only the selected shares are burned.</p></div><div><h3>IF A ROUTE DISAPPEARS</h3><p>The initial route check cannot guarantee later liquidity. After redemption, unsold tokens stay in your wallet. Resume sales with fresh quotes; the share burn cannot be undone.</p></div></section><a class="text-btn" href="#basket/${a}">View backing, token withdrawal and reserved exits</a></div>`;
  }
  async function context(a,requirePrices=true){await assertWallet();const v=await loadVault(a);if(requirePrices)prices(v);const p=current(a);if(p)validate(p,v);return {v,p};}
  async function preflight(v,amounts,slippage,account,session){
    let estimate=0n;
    for(let i=0;i<v.symbols.length;i++){
      view.message='CHECKING '+v.symbols[i]+' SELL ROUTE / '+(i+1)+' OF '+v.symbols.length;render();
      const input={symbol:v.symbols[i],side:'sell',amount:String(amounts[i]),slippageBps:slippage,taker:account},q=await quoteFor(input);reviewOpenOcean(q,input);estimate+=BigInt(q.minBuyAmount);
      if(session!==state.session||state.account!==account)throw Error('Wallet changed. Check the exit again.');
    }
    return estimate;
  }
  async function plan(a){
    if(current(a))throw Error('Resume or change the saved exit first.');
    const session=state.session,{v}=await context(a),shares=decimal(view.shares),amounts=redemptionAmounts(v,shares),onchain=[...await vault(a).previewRedeem(shares)];
    if(onchain.some((n,i)=>n!==amounts[i]))throw Error('Backing changed. Refresh and check the redemption again.');
    await loadBalances();if(state.eth<=0n)throw Error('Fund the RH wallet with ETH for redemption and swap gas.');
    const account=state.account,estimate=await preflight(v,amounts,view.slippage,account,session);
    const p={version:1,id:crypto.randomUUID(),chain:CHAIN_ID,account,vault:a,identity:vaultIdentity(v),assets:v.assets,shares:String(shares),slippage:view.slippage,estimate:String(estimate),at:Date.now(),checkedAt:Date.now(),rows:v.symbols.map((symbol,i)=>({symbol,amount:String(amounts[i])})),transactions:[]};
    saved.liquidationRuns=[...runs(),p];saved.vaults=[...new Set([...(saved.vaults||[]),a])];tracker.persist();await tracker.sync(p);notify('Every component sell route checked. Review the share redemption next.');
  }
  async function next(a){
    const session=state.session,{v,p}=await context(a);if(!p)throw Error('Check redemption and routes first.');await tracker.sync(p);const l=tracker.guard(p);if(l.done)throw Error('This basket exit is already complete.');
    if(!l.redemption){
      const shares=BigInt(p.shares),amounts=redemptionAmounts(v,shares),onchain=[...await vault(a).previewRedeem(shares)];
      if(onchain.some((n,i)=>n!==amounts[i]))throw Error('Backing changed. Refresh before reviewing redemption.');
      const estimate=await preflight(v,amounts,p.slippage,p.account,session);p.rows.forEach((r,i)=>r.amount=String(amounts[i]));p.estimate=String(estimate);p.checkedAt=Date.now();tracker.persist();
      const tx={to:a,data:vault(a).interface.encodeFunctionData('redeem',[shares,p.account,amounts]),value:0n};
      await transactionReview('REDEEM '+esc(v.symbol)+' / START BASKET SALE',tx,`<p>${esc(v.name)} / existing vault ${short(a)}</p>${info('Shares to burn',units(shares,18,18)+' '+esc(v.symbol))}${v.symbols.map((s,i)=>info('Minimum '+s+' received',units(amounts[i],18,18))).join('')}${info('Indicative USDG from route check',units(estimate,6,6)+' USDG')}<div class="notice warn"><p>This transaction burns shares and returns component tokens, not USDG. Sales follow in separate wallet confirmations. Later routes and their prices can change; unsold tokens remain yours. There is no guaranteed total USDG output or atomic rollback.</p></div>`,null,Date.now()+90000,{kind:'liquidation.redeem',exit:p.id,shares:p.shares,amounts:amounts.map(String)});return;
    }
    const step=l.remaining.findIndex(n=>n>0n),symbol=v.symbols[step],amount=l.remaining[step];await loadBalances();
    if((state.balances[symbol]||0n)<amount)throw Error('The '+symbol+' received in this exit is no longer fully available. Return the missing tokens to this wallet before continuing; existing unrelated holdings are not added to the sale.');
    const input={symbol,side:'sell',amount:String(amount),slippageBps:p.slippage,taker:p.account},q=await quoteFor(input);
    if(session!==state.session)throw Error('Wallet changed. Review again.');reviewOpenOcean(q,input);
    if(await token(symbol).allowance(p.account,OPENOCEAN_ROUTER)<amount){
      if(session!==state.session)throw Error('Wallet changed. Review again.');await approveToken(symbol,OPENOCEAN_ROUTER,amount,{kind:'liquidation.approval',exit:p.id,step});return;
    }
    for(const address of [OPENOCEAN_ROUTER,OPENOCEAN_CALLER])if(await d.reader().getCode(address)==='0x')throw Error('Verified OpenOcean infrastructure is unavailable.');
    if(session!==state.session)throw Error('Wallet changed. Review again.');
    await transactionReview('SELL '+symbol+' / BASKET EXIT', {to:q.transaction.to,data:q.transaction.data,value:0n},`<p>${esc(v.name)} / selling only tokens received in this exit.</p>${info('Exact '+symbol+' spend',units(amount,18,18))}${info('Minimum USDG received',units(BigInt(q.minBuyAmount),6,6)+' USDG')}${info('USDG received so far',units(l.total,6,6)+' USDG')}${info('Price impact',esc(q.priceImpact))}<p class="footnote">Recipient ${esc(p.account)}. Minimum output includes slippage and provider deductions up to 0.5%. ETH gas is separate. Any refunded component amount remains in the exit queue until sold.</p>`,null,q.expiresAt,{kind:'liquidation.swap',exit:p.id,step,amount:String(amount),quote:q});
  }
  async function action(action,el){
    if(storageError){notify(storageError);return;}if(view.busy)return;
    const a=el.dataset.vault?.toLowerCase(),hash=document.querySelector('#exit-recovery-hash')?.value.trim();
    if(action==='exit-plan'){view.shares=document.querySelector('#exit-shares')?.value||view.shares;view.slippage=Number(document.querySelector('#exit-slippage')?.value||100);}
    view.busy=true;view.error='';view.message='VERIFYING EXIT PROGRESS';render();
    try{
      if(action==='exit-max'){const {v}=await context(a,false);if(v.owned<=0n)throw Error('This wallet has no available basket shares.');view.shares=formatUnits(v.owned,18);}
      else if(action==='exit-plan')await plan(a);
      else if(action==='exit-next')await next(a);
      else if(action==='exit-refresh'){const {p}=await context(a,false);await loadBalances();if(p)await tracker.sync(p);}
      else if(action==='exit-recover'){const {p}=await context(a,false);if(!p)throw Error('No saved exit for this wallet.');await tracker.recoverHash(p,hash);await loadBalances();}
      else if(action==='exit-new'||action==='exit-reset'){
        const {p}=await context(a,false);if(!p)throw Error('No saved exit for this wallet.');await tracker.sync(p);const l=tracker.guard(p);
        if(action==='exit-new'?!l.done:!!l.redemption)throw Error('Finish or recover the current exit first.');p.archived=true;tracker.persist();view.shares='';
      }
    }catch(e){view.error=d.fail(e);}finally{view.busy=false;view.message='';render();}
  }
  async function beforeSend(r){
    if(!r.recovery?.kind?.startsWith('liquidation.'))return;if(storageError)throw Error(storageError);
    const p=byId(r.recovery.exit);if(!p)throw Error('Exit progress is missing.');await assertWallet(p.account);const v=await loadVault(p.vault);validate(p,v);prices(v);await tracker.sync(p);const l=tracker.guard(p);
    bindRequest(p,r.recovery,r.tx);
    if(l.done)throw Error('This exit is already complete.');
    if(r.recovery.kind==='liquidation.redeem'){
      if(l.redemption)throw Error('These shares were already redeemed. Continue the component sales.');
      const amounts=redemptionAmounts(v,BigInt(p.shares)),onchain=[...await vault(p.vault).previewRedeem(BigInt(p.shares))];
      if(onchain.some((n,i)=>n!==amounts[i]||n<BigInt(r.recovery.amounts[i])))throw Error('Redemption amounts changed. Review again.');
      await preflight(v,amounts,p.slippage,p.account,state.session);
    }else{
      const i=r.recovery.step;if(!l.redemption||!p.rows[i]||l.remaining[i]<=0n)throw Error('This component is not available for another sale.');
      await loadBalances();if((state.balances[p.rows[i].symbol]||0n)<l.remaining[i])throw Error('Some redeemed component tokens are missing from this wallet.');
      if(r.recovery.kind==='liquidation.swap'){
        if(BigInt(r.recovery.amount)!==l.remaining[i])throw Error('The remaining component amount changed. Request a fresh sale.');
        reviewOpenOcean(r.recovery.quote,{symbol:p.rows[i].symbol,side:'sell',amount:r.recovery.amount,slippageBps:p.slippage,taker:p.account});
      }else if(r.recovery.kind==='liquidation.approval'){
        if(r.recovery.symbol!==p.rows[i].symbol||r.recovery.spender?.toLowerCase()!==OPENOCEAN_ROUTER.toLowerCase()||![0n,l.remaining[i]].includes(BigInt(r.recovery.amount)))throw Error('Approval differs from the remaining component amount.');
      }else throw Error('Unrecognized exit operation.');
    }
  }
  function input(t){if(t.id==='exit-shares')view.shares=t.value;if(t.id==='exit-slippage')view.slippage=Number(t.value);}
  async function reconcile(){if(storageError)throw Error(storageError);for(const p of runs().filter(p=>p.account===state.account&&!p.archived))await tracker.sync(p);}
  function resumePanel(){
    if(storageError)return '';const p=runs().findLast(p=>!p.archived&&p.account===state.account);if(!p||tracker.cache.get(p.id)?.done)return '';
    return `<section class="funding-resume"><div><small>BASKET SALE IN PROGRESS</small><b>${esc(state.vaults[p.vault]?.name||short(p.vault))}</b><p>Resume the verified redemption and remaining component sales.</p></div><a class="btn primary" href="#exit/${p.vault}">RESUME SALE</a></section>`;
  }
  return {async refreshReview(recovery){const p=byId(recovery.exit);if(!p||p.account!==state.account)throw Error('The saved operation is no longer available.');await next(p.vault);},page,action,input,reconcile,resumePanel,beforeSend,sending:tracker.sending,submitted:tracker.submitted,rejected:tracker.rejected,recover:tracker.recover,busy:()=>view.busy};
}
