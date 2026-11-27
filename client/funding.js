import { formatUnits } from 'ethers';
import { ALLOWED } from '../worker/assets.js';
import { OPENOCEAN_ROUTER, OPENOCEAN_CALLER, openOceanInput, reviewOpenOcean } from '../shared/openocean.js';
import { fetchOpenOcean, browserOpenOceanJson } from '../shared/openocean-api.js';
import { swapSettlement } from '../shared/settlement.js';
import { allocateFunding, vaultIdentity, mintCapacity, fundingLedger, mintSettlement } from './funding-math.js';
import { CHAIN_ID, units, short } from './finance.js';

// A fresh checkout has no featured user vault. Import your own address in the UI.
export const EXISTING_VAULT='';

export function createFunding(d) {
  const {state,saved,esc,btn,heading,save,render,assertWallet,loadVault,loadBalances,token,vault,transactionReview,approveToken,expirePrices,notify}=d;
  const view={busy:false,message:'',error:'',budget:'5',slippage:100,ledgers:new Map()};
  let storageError='';
  try{
    const address=a=>/^0x[0-9a-f]{40}$/.test(a||''),amount=n=>/^[1-9][0-9]{0,76}$/.test(String(n))&&BigInt(n)<2n**256n;
    if(saved.fundingRuns!==undefined&&!Array.isArray(saved.fundingRuns))throw Error();
    for(const p of saved.fundingRuns||[]){
      if(!p||p.version!==1||p.chain!==CHAIN_ID||typeof p.id!=='string'||!address(p.account)||!address(p.vault)||!amount(p.budget)||!amount(p.preflightShares)||typeof p.identity!=='string'||!Array.isArray(p.rows)||p.rows.length<2||p.rows.length>12||new Set(p.rows.map(r=>r?.symbol)).size!==p.rows.length||!Array.isArray(p.assets)||p.assets.length!==p.rows.length||p.rows.some((r,i)=>!Object.hasOwn(ALLOWED,r?.symbol)||!amount(r.allocation)||p.assets[i]?.toLowerCase()!==ALLOWED[r.symbol].toLowerCase())||p.rows.reduce((n,r)=>n+BigInt(r.allocation),0n)!==BigInt(p.budget)||![50,100,200,300].includes(p.slippage)||!Array.isArray(p.transactions))throw Error();
    }
  }catch{storageError='Saved purchase data could not be read safely. No new purchase will be started. Keep this browser’s storage and check wallet Activity and onchain balances.';}
  const runs=()=>Array.isArray(saved.fundingRuns)?saved.fundingRuns:[];
  const current=a=>runs().findLast(p=>!p.archived&&p.account===state.account&&p.vault===a.toLowerCase());
  const byId=id=>runs().find(p=>p.id===id);
  const reader=()=>d.reader();
  const quoteFor=d.fetchQuote||((input)=>fetchOpenOcean(openOceanInput(input),browserOpenOceanJson));
  function persist(){save();const copy=JSON.parse(localStorage.getItem(d.storageKey)||'{}');if(JSON.stringify(copy.fundingRuns)!==JSON.stringify(saved.fundingRuns))throw Error('Browser progress could not be saved. Enable local storage before continuing.');}
  function validate(p,v){
    if(!p||p.version!==1||p.chain!==CHAIN_ID||p.account!==state.account||p.vault!==v.address||p.identity!==vaultIdentity(v)||p.rows.length!==v.symbols.length||p.rows.some((r,i)=>r.symbol!==v.symbols[i]||BigInt(r.allocation)<=0n)||p.rows.reduce((n,r)=>n+BigInt(r.allocation),0n)!==BigInt(p.budget))throw Error('The funding plan does not match this wallet and vault.');
  }
  function prices(v){expirePrices();for(const s of v.symbols){if(!state.prices[s]?.ok||state.tokenChecks[s]?.paused||!state.assets.some(a=>a.tokenSymbol===s))throw Error(s+': refresh market data before continuing.');}}
  function guard(p){
    if(p.intent)throw Error('The last wallet request has an unknown outcome. Recover its transaction hash before continuing.');
    const l=view.ledgers.get(p.id);if(!l)throw Error('Refresh and verify the saved transaction receipts first.');
    if(l.pending.length)throw Error('A transaction is still pending. Refresh its receipt; another purchase will not be sent.');
    if(l.mint)throw Error('This basket purchase is already complete.');return l;
  }
  function info(label,value){return `<div class="meta-pair"><span>${label}</span><strong>${value}</strong></div>`;}
  function page(address){
    if(storageError)return heading('CHECK SAVED PURCHASE DATA.',storageError)+'<a class="btn" href="#portfolio">OPEN PORTFOLIO & ACTIVITY</a>';
    const a=address.toLowerCase(),v=state.vaults[a];
    if(!v)return `${heading('BUY THE WHOLE SET.','Checking the existing vault and its fixed composition.')}<div class="notice" role="status">${esc(state.vaultErrors[a]||'Reading RH mainnet…')}</div>${btn('REFRESH VAULT','refresh')}`;
    const p=current(a),l=p&&view.ledgers.get(p.id),done=!!l?.mint,count=l?.bought.filter(n=>n>0n).length||0;
    const phase=done?3:count===v.symbols.length?2:p?1:0;
    return `<div class="fund-page">${heading('ONE BASKET.<br>ONE PROCESS.',`Buy ${esc(v.name)} with USDG. Your existing vault issues ${esc(v.symbol)} shares.`,'USDG / STOCK TOKENS / SHARES')}<div class="basket-meta"><span class="badge lime">RH MAINNET / 4663</span><a href="#basket/${a}" class="address">${short(a)} / EXISTING VAULT</a><span>${v.symbols.length} COMPONENTS</span></div><ol class="fund-steps" aria-label="Basket purchase progress">${['Set budget','Buy components','Approve & mint','Shares in wallet'].map((s,i)=>`<li class="${i===phase?'active':i<phase?'done':''}" ${i===phase?'aria-current="step"':''}>${s}</li>`).join('')}</ol><div class="fund-grid"><section class="panel fund-main"><div class="panel-heading"><h2>${done?'YOUR SET IS FUNDED.':p?'YOUR PURCHASE IN PROGRESS':'START WITH USDG'}</h2><span class="badge">${done?'RECEIPT VERIFIED':p?count+' / '+v.symbols.length+' BOUGHT':'LIVE / WALLET SIGNATURES'}</span></div>${!p?`<form id="fund-setup"><div class="fund-inputs"><label>MAXIMUM USDG SPEND<input id="fund-budget" aria-label="Basket USDG budget" type="text" inputmode="decimal" value="${esc(view.budget)}" ${view.busy?'disabled':''}></label><label>SLIPPAGE PER SWAP<select id="fund-slippage" ${view.busy?'disabled':''}>${[[50,'0.5%'],[100,'1%'],[200,'2%'],[300,'3%']].map(([n,t])=>`<option value="${n}" ${view.slippage===n?'selected':''}>${t}</option>`).join('')}</select></label></div><p>We check a route for every component before the first wallet request. Allocation follows this vault’s mint ratio at current reference prices.</p>${state.account?(state.chain===CHAIN_ID?btn(view.busy?'CHECKING ALL ROUTES…':'CHECK BASKET & ROUTES','fund-plan','primary wide',`data-vault="${a}"`,view.busy):btn('SWITCH TO RH MAINNET','switch','primary wide')):btn('CONNECT WALLET TO CONTINUE','connect','primary wide')}<small class="footnote">No signatures during this check. No new vault will be deployed.</small></form>`:`${info('Maximum purchase spend',units(BigInt(p.budget),6,6)+' USDG')}${info('Verified USDG spent',l?units(l.total,6,6)+' USDG':'Checking receipts…')}${info('Budget not spent',l?units(BigInt(p.budget)-l.total,6,6)+' USDG':'—')}${info('Wallet',short(p.account))}${info('Shares estimated at route check',units(BigInt(p.preflightShares),18,10)+' '+esc(v.symbol))}<p class="footnote">An estimate, not a guaranteed share count. Each swap is quoted again. Final Mint uses actual receipts and current backing.</p>${done?`${info('Shares minted',units(BigInt(l.mint.shares),18,12)+' '+esc(v.symbol))}<a class="btn primary wide" href="#portfolio">VIEW MY PORTFOLIO</a><a class="btn wide" href="#basket/${a}">OPEN FUNDED VAULT</a><a class="btn wide" href="#exit/${a}">SELL BASKET FOR USDG</a>${btn('START ANOTHER PURCHASE','fund-new','text-btn',`data-vault="${a}"`)}`:`${p.intent?`<div class="notice warn"><h3>CHECK THE LAST WALLET REQUEST</h3><p>The wallet did not return a transaction hash. No retry is allowed while its outcome is unknown. If it was submitted, paste the hash from your wallet activity.</p><label>TRANSACTION HASH<input id="fund-recovery-hash" placeholder="0x…" autocomplete="off"></label>${btn('RECOVER TRANSACTION','fund-recover','wide',`data-vault="${a}"`,view.busy)}</div>`:''}<div class="fund-next"><h3>${count<v.symbols.length?'NEXT: '+esc(v.symbols[count]||'VERIFY RECEIPTS'):'NEXT: EXACT DEPOSITS & MINT'}</h3><p>${count<v.symbols.length?'Each component uses a fresh OpenOcean quote. Approve its exact USDG spend if needed, then review the swap.':'All components were purchased. We calculate mintable shares from confirmed receipts, verify your balances, then approve the required tokens and mint.'}</p>${btn(view.busy?esc(view.message||'CHECKING…'):l?.pending.length?'CHECK PENDING TRANSACTION':!l?'VERIFY & RESUME PURCHASE':count<v.symbols.length?'CONTINUE PURCHASE':'CONTINUE TO MINT','fund-next','primary wide',`data-vault="${a}"`,view.busy||!!p.intent)}</div>${l?.pending.length?`<p class="notice" role="status">Waiting for RH inclusion. ${l.pending.map(t=>`<a target="_blank" rel="noreferrer" href="https://robinhoodchain.blockscout.com/tx/${t.hash}">${short(t.hash)}</a>`).join(' ')}</p>`:''}${l?.pending.length&&!p.intent?`<details class="fund-replacement"><summary>Replaced this transaction in your wallet?</summary><p>Paste the hash of an identical speed-up, or a confirmed zero-value cancellation to your own wallet. We check the sender and nonce before resolving the pending step.</p><label>REPLACEMENT HASH<input id="fund-recovery-hash" autocomplete="off" placeholder="0x…"></label>${btn('TRACK REPLACEMENT','fund-recover','wide',`data-vault="${a}"`,view.busy)}</details>`:''}${btn('REFRESH RECEIPTS & BALANCES','fund-refresh','wide',`data-vault="${a}"`,view.busy)}<p class="footnote">You can leave and return in this browser with the same wallet. Confirmed components will not be bought twice.</p>`}`}
    <div id="fund-error" class="form-error" role="alert">${esc(view.error)}</div>${view.busy?`<p role="status">${esc(view.message)}</p>`:''}</section><aside class="panel fund-summary"><h2>THIS VAULT. THESE TOKENS.</h2>${v.symbols.map((s,i)=>`<div class="fund-component ${l?.bought[i]>0n?'purchased':''}"><div><strong>${s}</strong><span>${p?units(BigInt(p.rows[i].allocation),6,6)+' USDG':Number(v.weights[i])/100+'% initial'}</span></div><small>${l?.bought[i]>0n?'Received '+units(l.bought[i],18,12):p?'Awaiting purchase':'Fixed quantities / share'}</small>${p&&l?.bought[i]>0n&&l?.mint?`<small>Not deposited: ${units(l.bought[i]-BigInt(l.mint.amounts[i]),18,12)}</small>`:''}</div>`).join('')}<p class="footnote">Actual holdings determine shares. Reference prices help allocate USDG; they are not executable quotes.</p></aside></div><section class="fund-disclosure"><div><h3>YOUR WALLET, EVERY STEP</h3><p>Exact USDG approvals, ${v.symbols.length} component swaps, component approvals and one Mint. Existing allowances can reduce confirmations. ETH gas is extra for each transaction.</p></div><div><h3>YOU CAN PAUSE HERE</h3><p>Transactions are separate. If a route fails or you decline, purchased tokens stay in your wallet. Quotes and share estimates can change. Any unused components remain yours after Mint.</p></div></section><a class="text-btn" href="#basket/${a}">View composition, backing and withdrawal controls</a></div>`;
  }
  async function sync(p){
    const session=state.session,settlements=[],pending=[];
    const facts=await Promise.all((p.transactions||[]).map(async row=>{
      if(row.cancelHash){
        const [c,tx]=await Promise.all([reader().getTransactionReceipt(row.cancelHash),reader().getTransaction(row.cancelHash)]);
        if(!c||c.status!==1||!tx||tx.nonce!==row.nonce||tx.from.toLowerCase()!==p.account||tx.to?.toLowerCase()!==p.account||tx.data!=='0x'||tx.value!==0n)throw Error('Wallet cancellation could not be verified.');
        return {row,cancelled:true};
      }
      const receipt=await reader().getTransactionReceipt(row.hash);
      if(!receipt)return {row};
      if(receipt.hash.toLowerCase()!==row.hash.toLowerCase()||receipt.from.toLowerCase()!==p.account||receipt.to?.toLowerCase()!==row.target.toLowerCase())throw Error('A funding receipt does not match the account or target.');
      if(receipt.status===0)return {row,receipt};
      if(receipt.status!==1)throw Error('Receipt is not final.');
      const tx=await reader().getTransaction(row.hash),r=row.recovery;
      if(!tx||tx.from.toLowerCase()!==p.account||tx.to?.toLowerCase()!==row.target.toLowerCase()||tx.value!==0n||tx.data!==r.data)throw Error('Submitted transaction data could not be verified.');
      let settlement;
      if(r.kind==='funding.swap'){
        const q=r.quote,input={symbol:p.rows[r.step]?.symbol,side:'buy',amount:p.rows[r.step]?.allocation,slippageBps:p.slippage,taker:p.account};
        reviewOpenOcean(q,input,q.requestedAt);
        if(q.transaction.data!==tx.data)throw Error('The swap receipt does not match its quote.');
        settlement={...swapSettlement(receipt,q),step:r.step};
      }else if(r.kind==='funding.mint'){
        const decoded=vault(p.vault).interface.decodeFunctionData('mintShares',tx.data);
        if(String(decoded[0])!==r.shares||decoded[1].toLowerCase()!==p.account||JSON.stringify([...decoded[2]].map(String))!==JSON.stringify(r.amounts))throw Error('The mint does not match the reviewed request.');
        settlement=mintSettlement(receipt,p,r);
      }else if(r.kind!=='funding.approval')throw Error('Unrecognized funding transaction.');
      return {row,receipt,settlement};
    }));
    if(session!==state.session||p.account!==state.account)throw Error('Wallet changed while verifying purchase progress.');
    for(const {row,receipt,settlement,cancelled} of facts){row.status=cancelled?'Cancelled in wallet':!receipt?'Submitted':receipt.status===1?'Included in RH block':'Reverted';if(!receipt&&!cancelled)pending.push(row);if(settlement)settlements.push(settlement);}
    const ledger={...fundingLedger(p,settlements),pending};view.ledgers.set(p.id,ledger);persist();return ledger;
  }
  async function context(a){await assertWallet();const v=await loadVault(a);prices(v);const p=current(a);if(p)validate(p,v);return {v,p};}
  async function plan(a){
    if(current(a))throw Error('Resume this wallet’s saved purchase first.');
    const session=state.session,{v}=await context(a),allocation=allocateFunding(v,view.budget,state.prices),budget=allocation.budget;
    await loadBalances();if(state.usdg<budget)throw Error('Not enough USDG for this budget. Fund your RH wallet first.');
    if(state.eth<=0n)throw Error('Fund your RH wallet with ETH for gas first.');
    const capacity=v.max-v.supply;if(allocation.referenceShares>capacity)throw Error('This budget exceeds the vault’s remaining share capacity. Reduce it.');
    const quotes=[];
    for(let i=0;i<v.symbols.length;i++){
      view.message='CHECKING '+v.symbols[i]+' / '+(i+1)+' OF '+v.symbols.length;render();
      const input={symbol:v.symbols[i],side:'buy',amount:String(allocation.allocations[i]),slippageBps:view.slippage,taker:state.account};
      const quote=await quoteFor(input);reviewOpenOcean(quote,input);quotes.push(quote);
      if(session!==state.session)throw Error('Wallet changed. Start the basket check again.');
    }
    const minimum=mintCapacity(v,quotes.map(q=>BigInt(q.minBuyAmount)));if(minimum<=0n)throw Error('These routes do not provide enough tokens to mint any shares.');
    const p={version:1,id:crypto.randomUUID(),chain:CHAIN_ID,account:state.account,vault:a,identity:vaultIdentity(v),assets:v.assets,budget:String(budget),slippage:view.slippage,preflightShares:String(minimum),at:Date.now(),rows:v.symbols.map((symbol,i)=>({symbol,allocation:String(allocation.allocations[i])})),transactions:[]};
    saved.fundingRuns=[...runs(),p];saved.vaults=[...new Set([...(saved.vaults||[]),a])];persist();view.ledgers.set(p.id,{...fundingLedger(p,[]),pending:[]});notify('All component routes checked. Continue to review the first wallet action.');
  }
  async function next(a){
    const session=state.session,{v,p}=await context(a);if(!p)throw Error('Check the basket routes first.');
    await sync(p);const l=guard(p);await loadBalances();
    const step=l.bought.findIndex(n=>n===0n);
    if(step>=0){
      const row=p.rows[step],amount=BigInt(row.allocation);
      if(l.total+amount>BigInt(p.budget)||state.usdg<amount)throw Error('Not enough USDG within the remaining budget for '+row.symbol+'.');
      view.message='GETTING FRESH '+row.symbol+' QUOTE';render();
      const input={symbol:row.symbol,side:'buy',amount:row.allocation,slippageBps:p.slippage,taker:p.account};
      const q=await quoteFor(input);
      if(session!==state.session)throw Error('Wallet changed. Review again.');reviewOpenOcean(q,input);
      if(await token('USDG').allowance(p.account,OPENOCEAN_ROUTER)<amount){
        if(session!==state.session)throw Error('Wallet changed. Review again.');
        await approveToken('USDG',OPENOCEAN_ROUTER,amount,{kind:'funding.approval',fund:p.id,step});return;
      }
      for(const address of [OPENOCEAN_ROUTER,OPENOCEAN_CALLER])if(await reader().getCode(address)==='0x')throw Error('Verified OpenOcean infrastructure is unavailable.');
      const tx={to:q.transaction.to,data:q.transaction.data,value:0n};
      await transactionReview('BUY '+row.symbol+' / BASKET '+(step+1)+' OF '+p.rows.length,tx,
        `<p>${esc(v.name)} / existing vault ${short(a)}</p>${info('Exact USDG spend',units(amount,6,6)+' USDG')}${info('Minimum received',units(BigInt(q.minBuyAmount),18,12)+' '+row.symbol)}${info('Total spent before this step',units(l.total,6,6)+' / '+units(BigInt(p.budget),6,6)+' USDG')}${info('Price impact',esc(q.priceImpact))}<p>Tokens go to your wallet. Final shares depend on actual receipts for all components and the fresh vault mint ratio.</p><p class="footnote">Minimum receipt includes swap slippage and provider deductions (up to 0.5%). ETH gas is extra. This purchase is not an atomic basket transaction.</p>`,null,q.expiresAt,{kind:'funding.swap',fund:p.id,step,quote:q});
      return;
    }
    const inventory=v.symbols.map((s,i)=>{const have=state.balances[s]||0n;return have<l.bought[i]?have:l.bought[i];});
    const shares=mintCapacity(v,inventory);if(shares<=0n)throw Error('Some purchased tokens are no longer in this wallet, or the vault is full. No Mint can be prepared.');
    const amounts=[...await vault(a).previewMint(shares)];
    if(amounts.some((n,i)=>n>inventory[i]))throw Error('Vault backing changed. Refresh and recalculate the Mint.');
    for(let i=0;i<v.symbols.length;i++)if(await token(v.symbols[i]).allowance(p.account,a)<amounts[i]){
      if(session!==state.session)throw Error('Wallet changed. Review again.');
      await approveToken(v.symbols[i],a,amounts[i],{kind:'funding.approval',fund:p.id,step:i});return;
    }
    if(session!==state.session)throw Error('Wallet changed. Review again.');
    const tx={to:a,data:vault(a).interface.encodeFunctionData('mintShares',[shares,p.account,amounts]),value:0n};
    await transactionReview('MINT '+esc(v.symbol)+' / COMPLETE BASKET',tx,`<p>Deposit the purchased components into the existing vault.</p>${info('Shares to receive',units(shares,18,12)+' '+esc(v.symbol))}${info('Confirmed USDG spent',units(l.total,6,6)+' USDG')}${v.symbols.map((s,i)=>info(s+' deposit',units(amounts[i],18,12))).join('')}<p class="small">Only quantities acquired in this purchase run are counted. Any leftover component tokens stay in your wallet. Exact maximum deposits protect against changed backing.</p>`,null,Date.now()+90000,{kind:'funding.mint',fund:p.id,shares:String(shares),amounts:amounts.map(String)});
  }
  async function refresh(p){if(p)await sync(p);}
  async function action(action,el){
    if(storageError){notify(storageError);return;}
    if(view.busy)return;view.busy=true;view.error='';view.message='VERIFYING ONCHAIN PROGRESS';
    const a=el.dataset.vault?.toLowerCase();
    if(action==='fund-plan'){view.budget=document.querySelector('#fund-budget')?.value||view.budget;view.slippage=Number(document.querySelector('#fund-slippage')?.value||100);}
    const recoveryHash=document.querySelector('#fund-recovery-hash')?.value.trim();render();
    try{
      if(action==='fund-plan')await plan(a);
      else if(action==='fund-next')await next(a);
      else if(action==='fund-refresh'){await assertWallet();await loadBalances();await loadVault(a);const p=current(a);if(!p)throw Error('No saved purchase for this wallet.');await sync(p);}
      else if(action==='fund-recover'){
        const {p}=await context(a);const pending=view.ledgers.get(p?.id)?.pending?.[0];
        if((!p?.intent&&!pending)||!/^0x[0-9a-fA-F]{64}$/.test(recoveryHash||''))throw Error('Enter the transaction hash from your wallet activity.');
        const tx=await reader().getTransaction(recoveryHash),r=p.intent||pending;
        if(!tx||tx.from.toLowerCase()!==p.account||tx.value!==0n)throw Error('This hash does not match the last wallet request.');
        const matches=tx.to?.toLowerCase()===r.target.toLowerCase()&&tx.data===r.recovery.data;
        if(pending&&!p.intent){
          const original=await reader().getTransaction(pending.hash),nonce=original?.nonce??pending.nonce;
          if(nonce===undefined||tx.nonce!==nonce)throw Error('The replacement must use the same wallet nonce.');
          if(!matches){
            const receipt=await reader().getTransactionReceipt(tx.hash);
            if(tx.to?.toLowerCase()!==p.account||tx.data!=='0x'||!receipt||receipt.status!==1)throw Error('Only an identical speed-up or a confirmed zero-value self-cancellation can resolve this step.');
            pending.cancelHash=tx.hash;pending.nonce=nonce;
          }else{pending.replacedHashes=[...(pending.replacedHashes||[]),pending.hash];pending.hash=tx.hash;pending.nonce=tx.nonce;}
          const previous=saved.activity?.find(t=>t.hash===(pending.replacedHashes?.at(-1)||pending.hash));if(previous){previous.status=pending.cancelHash?'Cancelled in wallet':'Replaced / tracked in basket purchase';previous.recoveryComplete=true;previous.replacementHash=tx.hash;}
          persist();
        }else{
          if(!matches)throw Error('This hash does not match the last wallet request.');
          if(tx.blockNumber!==null&&tx.blockNumber!==undefined){const block=await reader().getBlock(tx.blockNumber);if(!block||block.timestamp*1000<p.at-10000)throw Error('This transaction predates the current purchase.');}
          submitted({hash:tx.hash,account:p.account,target:tx.to.toLowerCase(),nonce:tx.nonce,label:r.label,recovery:r.recovery,at:Date.now(),status:'Submitted'});
        }
        await sync(p);
      }else if(action==='fund-new'){
        const {p}=await context(a);await sync(p);if(!view.ledgers.get(p.id)?.mint)throw Error('Finish or recover this purchase first.');
        // Keep the audit trail in local history, but choose a fresh run on this screen.
        p.archived=true;persist();view.error='';
      }
    }catch(e){view.error=d.fail(e);}finally{view.busy=false;view.message='';render();}
  }
  // No new send is allowed until all receipts for the run are resolved.
  async function beforeSend(r){
    if(!r.recovery?.kind?.startsWith('funding.'))return;
    const p=byId(r.recovery.fund);if(!p)throw Error('The funding run could not be found.');await assertWallet(p.account);const v=await loadVault(p.vault);validate(p,v);prices(v);await sync(p);const l=guard(p);
    if(r.recovery.kind==='funding.swap'){
      const i=r.recovery.step;if(l.bought[i]>0n||l.total+BigInt(p.rows[i].allocation)>BigInt(p.budget))throw Error('This component is already bought or would exceed the budget.');
      reviewOpenOcean(r.recovery.quote,{symbol:p.rows[i].symbol,side:'buy',amount:p.rows[i].allocation,slippageBps:p.slippage,taker:p.account});
    }
    if(r.recovery.kind==='funding.mint'){
      if(l.bought.some(n=>n<=0n))throw Error('Every component purchase must be verified before Mint.');
      await loadBalances();
      const inventory=v.symbols.map((s,i)=>state.balances[s]<l.bought[i]?state.balances[s]:l.bought[i]);
      if(BigInt(r.recovery.shares)>mintCapacity(v,inventory))throw Error('Purchased balances or vault backing changed. Recalculate the Mint.');
      const amounts=[...await vault(p.vault).previewMint(BigInt(r.recovery.shares))];
      if(amounts.some((n,i)=>n>inventory[i]||n>BigInt(r.recovery.amounts[i])))throw Error('Mint deposits changed. Recalculate the Mint.');
    }
  }
  function sending(r){
    if(!r.recovery?.kind?.startsWith('funding.'))return;
    const p=byId(r.recovery.fund);if(p.intent)throw Error('Resolve the previous wallet request first.');r.recovery.data=r.tx.data;
    p.intent={target:r.tx.to.toLowerCase(),label:r.label,recovery:r.recovery,at:Date.now()};persist();
  }
  function submitted(row){
    if(!row.recovery?.kind?.startsWith('funding.'))return;
    const p=byId(row.recovery.fund);if(!p)throw Error('Funding run is missing. Preserve this transaction hash: '+row.hash);
    if(!p.transactions.some(t=>t.hash.toLowerCase()===row.hash.toLowerCase()))p.transactions.push({...row,target:row.target.toLowerCase()});delete p.intent;view.ledgers.delete(p.id);persist();
  }
  function rejected(r,e,requested,intentStarted=false){
    if(!r?.recovery?.kind?.startsWith('funding.'))return;
    if(intentStarted&&!r.sentHash&&(!requested||e.code===4001||e.code==='ACTION_REJECTED'||e.info?.error?.code===4001)){const p=byId(r.recovery.fund);delete p.intent;persist();}
  }
  function input(t){if(t.id==='fund-budget')view.budget=t.value;if(t.id==='fund-slippage')view.slippage=Number(t.value);}
  async function reconcile(){if(storageError)throw Error(storageError);for(const p of runs().filter(p=>p.account===state.account&&!p.archived))await refresh(p);}
  // Completed runs stay in history; they must not prevent a deliberate new purchase.
  return {page,action,input,reconcile,completed:id=>!!view.ledgers.get(id)?.mint,beforeSend,sending,submitted,rejected,busy:()=>view.busy,async recover(row){const p=byId(row.recovery?.fund);if(p){if(!p.transactions.some(t=>t.hash===row.hash))submitted(row);await sync(p);}}};
}
