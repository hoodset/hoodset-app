import {Contract,ContractFactory,isAddress} from 'ethers';
import {AGENT_PLAN} from '../shared/agent-plan.js';
import {REWARDS_HSET,REWARDS_DURATION,REWARDS_ERC,REWARDS_IFACE,rewardsAmount,rewardsSymbols,rewardsTransaction,readRewardsPool,rewardsSettlement} from '../shared/stock-rewards.js';
import {readHsetHolder} from './hset-holder.js';
import {transactionKey,checkWalletQueue} from './transactions.js';
import {units} from './finance.js';
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const erc=['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'];
export function createStockRewards(d){
 const {state,saved,save,render,esc,btn,heading,notify}=d;
 const ui={artifact:null,config:null,pool:null,address:saved.rewardsPool||'',amount:'',withdraw:'',fundAmount:'',fundIndex:0,hash:'',error:'',busy:false,loaded:false};
 const belongs=r=>r?.recovery?.kind?.startsWith('rewards.');
 const intent=()=>saved.rewardsIntents?.[state.account]||null;
 function noUnknown(account=state.account){if(saved.rewardsIntents?.[account])throw Error('Recover the last Stock Rewards wallet request before another transaction.');}
 function persist(){save();const disk=JSON.parse((d.storage||localStorage).getItem(d.storageKey)||'{}');if(JSON.stringify(disk.rewardsIntents||{})!==JSON.stringify(saved.rewardsIntents||{}))throw Error('Could not save rewards progress. Enable browser storage before signing.');return disk;}
 function session(account,s){if(state.account!==account||state.session!==s)throw Error('Wallet changed. Read this rewards position again.');}
 async function refreshPool(address=ui.address){
  if(!ui.artifact)throw Error('Rewards build is not loaded.');
  const a=state.account,s=state.session,p=await readRewardsPool(d.reader(),address,ui.artifact,a);session(a,s);
  try{const logs=await d.reader().getLogs({address:p.address,fromBlock:Math.max(0,p.block-1999),toBlock:p.block,topics:[REWARDS_IFACE.getEvent('RewardsFunded').topicHash]});p.funding=logs.slice(-20).reverse().map(l=>{const e=REWARDS_IFACE.parseLog(l).args;return {funder:e.funder,token:e.token,symbol:p.rows.find(r=>same(r.token,e.token))?.symbol||'Stock Token',amount:e.amount,hash:l.transactionHash,block:l.blockNumber,queued:e.queued};});}catch{p.funding=[];p.fundingError='Recent funding events could not be read. Lifetime totals and custody above come from the contract.';}
  session(a,s);ui.pool=p;ui.address=p.address;saved.rewardsPool=p.address;save();return p;
 }
 async function load(){
  if(ui.busy)return;ui.busy=true;ui.error='';
  try{const [ar,co]=await Promise.all([fetch('/chain/stock-rewards.json'),fetch('/data/stock-rewards.json')]);if(!ar.ok||!co.ok)throw Error('Stock Rewards build is unavailable.');ui.artifact=await ar.json();ui.config=await co.json();if(ui.artifact.contractName!=='HoodsetStockRewards'||ui.config.durationSeconds!==REWARDS_DURATION)throw Error('Rewards configuration does not match this release.');ui.loaded=true;if(ui.config.pool&&!saved.rewardsPool)ui.address=ui.config.pool;if(ui.address)await refreshPool();}
  catch(e){ui.pool=null;ui.error=e.shortMessage||e.message;}finally{ui.busy=false;if(d.active())render();}
 }
 async function guard(){const a=await d.assertWallet();noUnknown(a);d.noOtherUnknown(a);await checkWalletQueue(saved.activity||[],d.otherQueue(),a,'stock-rewards',h=>d.reader().getTransactionReceipt(h));return a;}
 function describe(r,p){
  const token=r.token===REWARDS_HSET?'HSET':p?.rows.find(x=>same(x.token,r.token))?.symbol||'Stock Token';
  const text={'rewards.stake':'HSET moves into this contract. There is no minimum lock period. Rewards accrue only from actually funded Stock Tokens over time. No fixed yield is promised.','rewards.withdraw':'Returns HSET principal only. Accrued Stock Token rewards remain separately claimable.','rewards.claim':'Transfers this asset’s actually accrued rewards to your wallet. Other Stock Tokens and HSET principal are unchanged.','rewards.fund':'Transfers your Stock Tokens into the reward stream. This is a contribution, not a basket investment, and cannot be withdrawn by the funder. Active-cycle top-ups queue for a later cycle. The onchain funder is recorded; this is not automatically classified as protocol revenue.','rewards.approval':BigInt(r.amount)===0n?'Reset this token permission before approving the exact requested amount.':'Allows only this rewards pool to pull the stated token amount. Approval alone neither stakes nor funds rewards.','rewards.checkpoint':'Starts an eligible queued seven-day cycle at its actual activation time. No rewards are backdated.'}[r.kind];
  return `<div class="meta-pair"><span>Rewards contract</span><strong>${esc(r.pool)}</strong></div>${r.amount!==undefined?`<div class="meta-pair"><span>Exact amount / ${token}</span><strong>${units(BigInt(r.amount),18,18)}</strong></div>`:''}<p>${text}</p>`;
 }
 async function review(kind,index){
  const account=await guard(),s=state.session,p=await refreshPool();session(account,s);
  const row=p.rows[Number(index??ui.fundIndex)];if(kind==='rewards.stake'&&!p.healthy)throw Error('Verify all reward assets before adding HSET. Principal withdrawal is still available.');if(['rewards.fund','rewards.claim'].includes(kind)&&row?.error)throw Error(row.error);let r={kind,pool:p.address,account};
  if(kind==='rewards.stake'){r.amount=String(rewardsAmount(ui.amount,p.wallet));r.token=REWARDS_HSET;}
  if(kind==='rewards.withdraw'){r.amount=String(rewardsAmount(ui.withdraw,p.owned));r.token=REWARDS_HSET;}
  if(kind==='rewards.fund'){if(!row)throw Error('Choose a reward asset.');r.index=row.index;r.token=row.token;r.amount=String(rewardsAmount(ui.fundAmount,row.wallet));}
  if(kind==='rewards.claim'){if(!row||row.earned<=0n)throw Error('No reward has accrued for this asset.');r.index=row.index;r.token=row.token;}
  if(kind==='rewards.stake'||kind==='rewards.fund'){
   const allowance=kind==='rewards.stake'?p.allowance:row.allowance;
   if(allowance<BigInt(r.amount))r={...r,kind:'rewards.approval',amount:allowance>0n?'0':r.amount};
  }
  await d.transactionReview({'rewards.stake':'STAKE HSET','rewards.withdraw':'WITHDRAW HSET','rewards.fund':'FUND STOCK REWARDS','rewards.claim':'CLAIM STOCK TOKEN','rewards.approval':'REVIEW REWARDS PERMISSION','rewards.checkpoint':'START NEXT REWARDS CYCLE'}[r.kind],rewardsTransaction(r),describe(r,p),async()=>{await refreshPool();},Date.now()+90000,r);
 }
 async function deploy(){
  const account=await guard(),s=state.session;if(!ui.artifact||!ui.config)throw Error('Load the verified rewards build first.');await readHsetHolder(d.reader(),account);session(account,s);
  const symbols=ui.config.rewardSymbols,assets=symbols.map(symbol=>d.allowed[symbol]);rewardsSymbols(assets);
  const tx=await new ContractFactory(ui.artifact.abi,ui.artifact.bytecode).getDeployTransaction(REWARDS_HSET,assets);
  const r={kind:'rewards.deploy',account,tokens:assets};
  await d.transactionReview('DEPLOY HSET STOCK REWARDS',tx,`<p>Deploys a separate rewards contract on RH mainnet. It begins empty: no HSET is staked and no Stock Tokens are funded.</p><div class="meta-pair"><span>Participation token</span><strong>Canonical HSET</strong></div><div class="meta-pair"><span>Reward assets</span><strong>${symbols.join(' / ')}</strong></div><p>Seven-day finite-funded cycles. No owner, upgrade, sweep or minimum HSET lock period. Deployment spends ETH gas only; it buys or transfers no tokens.</p><p class="notice warn">New contract without an independent audit. Review the source before deployment.</p><a href="/chain/HoodsetStockRewards.sol" target="_blank" rel="noreferrer">CONTRACT SOURCE</a> · <a href="/chain/stock-rewards-standard-input.json" target="_blank" rel="noreferrer">COMPILER INPUT</a>`,async()=>{},Date.now()+600000,r);
 }
 async function beforeSend(review){
  if(!belongs(review))return;const r=review.recovery;if(!same(r.account,review.account)||!same(r.account,state.account))throw Error('Rewards wallet changed after review.');noUnknown(r.account);
  if(r.kind==='rewards.deploy'){
   const tx=await new ContractFactory(ui.artifact.abi,ui.artifact.bytecode).getDeployTransaction(REWARDS_HSET,r.tokens);if(transactionKey(tx)!==transactionKey(review.tx))throw Error('Rewards deployment changed after review.');await readHsetHolder(d.reader(),r.account);return;
  }
  if(transactionKey(rewardsTransaction(r))!==transactionKey(review.tx))throw Error('Rewards transaction changed after review.');
  const p=await readRewardsPool(d.reader(),r.pool,ui.artifact,r.account),row=p.rows[r.index];
  if(r.kind==='rewards.stake'&&(!p.healthy||BigInt(r.amount)>p.wallet||BigInt(r.amount)>p.allowance))throw Error('HSET balance or allowance changed.');
  if(r.kind==='rewards.withdraw'&&BigInt(r.amount)>p.owned)throw Error('Amount exceeds staked HSET.');
  if(r.kind==='rewards.fund'&&(!row||row.error||!same(r.token,row.token)||BigInt(r.amount)>row.wallet||BigInt(r.amount)>row.allowance))throw Error('Funding balance or allowance changed.');
  if(r.kind==='rewards.claim'&&(!row||row.error||!same(r.token,row.token)||row.earned===0n))throw Error('The selected reward is not currently claimable.');
  if(r.kind==='rewards.approval'&&![REWARDS_HSET,...p.assets].some(t=>same(t,r.token)))throw Error('Unsupported rewards approval.');
 }
 function sending(r){
  if(!belongs(r))return;noUnknown(r.account);saved.rewardsIntents||={};saved.rewardsIntents[r.account]={account:r.account,target:r.tx.to||null,data:r.tx.data,value:String(r.tx.value||0),operationKey:r.operationKey,label:r.label,recovery:r.recovery,at:Date.now()};
  try{persist();}catch(e){delete saved.rewardsIntents[r.account];throw e;}
 }
 function submitted(row){
  if(!belongs(row))return;const disk=persist();if(!disk.activity?.some(x=>same(x.hash,row.hash)))throw Error('Keep the wallet hash: rewards progress was not saved.');
  const prior=saved.rewardsIntents?.[row.account];delete saved.rewardsIntents?.[row.account];try{persist();}catch(e){if(prior)saved.rewardsIntents[row.account]=prior;throw e;}
 }
 function rejected(r,e,requested,started){if(!belongs(r)||r.sentHash||!started)return;if(!requested||e.code===4001||e.code==='ACTION_REJECTED'||e.info?.error?.code===4001){delete saved.rewardsIntents?.[r.account];persist();}}
 async function recover(row,receipt){
  if(!ui.artifact){const response=await fetch('/chain/stock-rewards.json');if(!response.ok)throw Error('Rewards build is unavailable for receipt recovery.');ui.artifact=await response.json();}
  const r=row.recovery;if(!same(r.account,row.account))throw Error('Rewards recovery account mismatch.');const tx=await d.reader().getTransaction(row.hash);if(!tx||!same(tx.from,row.account)||transactionKey(tx)!==row.operationKey||Number(tx.chainId)!==4663)throw Error('Rewards transaction does not match its saved request.');
  if(r.kind==='rewards.deploy'){
   if(!receipt.contractAddress)throw Error('Rewards deployment has no contract address.');const p=await readRewardsPool(d.reader(),receipt.contractAddress,ui.artifact,row.account);
   if(JSON.stringify(p.assets)!==JSON.stringify(r.tokens.map(t=>t.toLowerCase())))throw Error('Deployed rewards assets do not match the request.');
   row.rewards={kind:r.kind,address:p.address,block:receipt.blockNumber};saved.rewardsPool=p.address;ui.address=p.address;ui.pool=p;save();return;
  }
  row.rewards=rewardsSettlement(receipt,r);if(same(state.account,row.account)){ui.address=r.pool;await refreshPool(r.pool);}save();
 }
 async function recoverHash(){
  const p=intent(),hash=ui.hash.trim();if(!p||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Enter the matching hash from wallet Activity.');const account=await d.assertWallet(),s=state.session,tx=await d.reader().getTransaction(hash);session(account,s);
  if(!tx||!same(tx.from,account)||Number(tx.chainId)!==4663||transactionKey(tx)!==p.operationKey)throw Error('This hash does not match the unknown rewards request.');
  if(tx.blockNumber!==null){const b=await d.reader().getBlock(tx.blockNumber);if(!b||b.timestamp*1000+1000<p.at)throw Error('This transaction predates the wallet request.');}
  let row=saved.activity.find(x=>same(x.hash,hash));if(row&&(!same(row.account,account)||row.operationKey!==p.operationKey))throw Error('Hash belongs to another saved operation.');
  if(!row){row={label:p.label,operationKey:p.operationKey,hash:tx.hash,account,target:p.target,nonce:tx.nonce,recovery:p.recovery,at:p.at,status:'Submitted'};saved.activity.unshift(row);}submitted(row);
  const receipt=await d.reader().getTransactionReceipt(hash);if(receipt){row.status=receipt.status===1?'Included in RH block':'Reverted';if(receipt.status===1){await recover(row,receipt);row.recoveryComplete=true;}save();}notify('Rewards transaction recovered. Refresh the position to check settlement.');
 }
 async function action(action,el){
  if(ui.busy)return;ui.busy=true;ui.error='';render();
  try{
   if(!ui.artifact&&action!=='rewards-reload'){ui.busy=false;await load();ui.busy=true;}
   if(action==='rewards-reload'){ui.busy=false;await load();return;}
   if(action==='rewards-connect')d.connect();
   else if(action==='rewards-switch')await d.switchNetwork();
   else if(action==='rewards-import'||action==='rewards-refresh')await refreshPool();
   else if(action==='rewards-deploy')await deploy();
   else if(action==='rewards-recover')await recoverHash();
   else if(action==='rewards-max-stake'){await refreshPool();ui.amount=units(ui.pool.wallet,18,18).replaceAll(',','');}
   else if(action==='rewards-max-withdraw'){await refreshPool();ui.withdraw=units(ui.pool.owned,18,18).replaceAll(',','');}
   else if(action==='rewards-stake')await review('rewards.stake');
   else if(action==='rewards-withdraw')await review('rewards.withdraw');
   else if(action==='rewards-fund')await review('rewards.fund');
   else if(action==='rewards-claim')await review('rewards.claim',Number(el.dataset.index));
   else if(action==='rewards-checkpoint')await review('rewards.checkpoint');
  }catch(e){ui.error=String(e.shortMessage||e.message||e).slice(0,350);}finally{ui.busy=false;render();}
 }
 function input(el){if(el.id==='rewards-address')ui.address=el.value.trim();if(el.id==='rewards-stake-amount')ui.amount=el.value;if(el.id==='rewards-withdraw-amount')ui.withdraw=el.value;if(el.id==='rewards-fund-amount')ui.fundAmount=el.value;if(el.id==='rewards-fund-index')ui.fundIndex=Number(el.value);if(el.id==='rewards-recovery-hash')ui.hash=el.value;}
 function sync(){if(ui.pool&&!same(ui.pool.account,state.account))ui.pool=null;}
 function page(){
  sync();const p=ui.pool,unknown=intent(),connected=!!state.account,ready=connected&&state.chain===4663&&!unknown&&!ui.busy;
  const link=a=>`<a href="https://robinhoodchain.blockscout.com/address/${a}" target="_blank" rel="noreferrer">${esc(a)}</a>`;
  const amount=n=>units(n||0n,18,12),date=t=>t?new Date(t*1000).toISOString().slice(0,16).replace('T',' ')+' UTC':'Not started';
  return `<div id="stock-rewards">${heading('HSET IN.<br>STOCK TOKENS OUT.','Participate with HSET. Claim your share of actually funded Stock Token rewards.','HSET STOCK REWARDS / RH MAINNET')}<div class="rewards-intro"><p>Rewards accrue over time while your HSET participates. Withdraw your HSET principal without a minimum lock period; earned Stock Tokens remain separately claimable.</p><span>FUNDED ASSETS.<br>NO FIXED APY.</span></div>${ui.error?`<div class="notice warn" role="alert">${esc(ui.error)}</div>`:''}${!ui.loaded?`<div class="notice">${ui.busy?'Loading the rewards build…':'Rewards configuration is unavailable.'}${btn('RETRY','rewards-reload','text-btn','',ui.busy)}</div>`:''}${!p?`<section class="panel rewards-empty"><h2>${ui.config?.pool?'CONNECT TO THE POOL.':'THE POOL STARTS EMPTY.'}</h2><p>${ui.config?.pool?'Read the deployed contract to inspect funding and participation.':'No public rewards contract has been published yet. Deployment alone creates no rewards. Stock Tokens must actually be funded before they can accrue.'}</p><label>Rewards contract<input id="rewards-address" aria-label="Rewards contract address" placeholder="0x…" value="${esc(ui.address)}" autocomplete="off"></label>${btn('READ & VERIFY POOL','rewards-import','wide','',ui.busy||!ui.loaded)}<details><summary>Deploy a verified rewards pool</summary><p>Deploys a new, empty, unaudited contract for ${ui.config?.rewardSymbols.join(' / ')||'supported Stock Tokens'}. No HSET or Stock Tokens move during deployment; ETH gas is separate.</p>${btn('REVIEW DEPLOYMENT','rewards-deploy','wide','',!ready||!ui.loaded)}</details></section>`:`<div class="rewards-address"><span>${same(ui.config?.pool,p.address)?'Published pool':'Imported pool'}</span>${link(p.address)}${btn('REFRESH','rewards-refresh','text-btn','',ui.busy)}</div><div class="rewards-metrics"><div><span>Total HSET participating</span><strong>${amount(p.total)}</strong></div><div><span>Your participating HSET</span><strong>${connected?amount(p.owned):'—'}</strong></div><div><span>Reward assets</span><strong>${p.rows.length}</strong></div></div>${p.rows.every(row=>row.funded===0n)?'<div class="notice"><h3>NO STOCK TOKENS FUNDED YET.</h3><p>Participation earns no rewards until an actual Stock Token contribution is verified onchain.</p></div>':''}<div class="rewards-grid"><section class="panel rewards-participate"><h2>YOUR HSET.</h2><p>Wallet: ${connected?amount(p.wallet)+' HSET':'Connect to read your balance'}</p><label>Participate / HSET<input id="rewards-stake-amount" aria-label="HSET participation amount" inputmode="decimal" value="${esc(ui.amount)}" placeholder="0.00"></label><div class="rewards-actions">${btn('MAX','rewards-max-stake','text-btn','',!ready)}${btn('REVIEW PARTICIPATION','rewards-stake','primary','',!ready||!p.healthy)}</div><hr><label>Withdraw principal / HSET<input id="rewards-withdraw-amount" aria-label="HSET withdrawal amount" inputmode="decimal" value="${esc(ui.withdraw)}" placeholder="0.00"></label><div class="rewards-actions">${btn('ALL HSET','rewards-max-withdraw','text-btn','',!ready||p.owned===0n)}${btn('REVIEW WITHDRAWAL','rewards-withdraw','','',!ready||p.owned===0n)}</div><p class="footnote">Participation needs an exact HSET permission, then a separate wallet-confirmed deposit. Principal withdrawal does not claim Stock Tokens.</p></section><section class="panel rewards-claims"><h2>YOUR STOCK TOKENS.</h2><p>Only actual funded tokens can accrue. A zero balance earns no reward.</p>${p.rows.map(row=>`<div class="rewards-asset">${row.error?`<p class="form-error" role="alert">${esc(row.error)}</p>`:''}<div><b>${row.symbol}</b><span>${connected?amount(row.earned):'—'}<small>claimable tokens</small></span></div>${btn('REVIEW CLAIM','rewards-claim','wide',`data-index="${row.index}"`,!ready||!!row.error||row.earned===0n)}<details><summary>Funding and current cycle</summary><dl><dt>Total funded</dt><dd>${amount(row.funded)} ${row.symbol}</dd><dt>Total claimed</dt><dd>${amount(row.paid)} ${row.symbol}</dd><dt>Current-cycle amount left</dt><dd>${amount(row.budget-row.vested)}</dd><dt>Queued / empty-period carry</dt><dd>${amount(row.queued+row.carry)}</dd><dt>Current cycle ends</dt><dd>${date(row.finish)}</dd></dl><p>Direct token funding is recorded onchain. Deposits are not automatically labelled as protocol revenue.</p></details></div>`).join('')}</section></div><section class="rewards-funding panel"><div><h2>WHERE REWARDS COME FROM.</h2><p>${esc(ui.config.fundingPolicy)}</p><p>Funding uses this page’s contract call. A direct transfer is not registered funding and cannot be swept back. Fund only amounts you intend to contribute.</p></div><div><label>Stock Token<select id="rewards-fund-index" aria-label="Reward funding token">${p.rows.map(row=>`<option value="${row.index}" ${row.index===ui.fundIndex?'selected':''}>${row.symbol}</option>`).join('')}</select></label><label>Exact tokens to contribute<input id="rewards-fund-amount" aria-label="Stock Token reward funding amount" inputmode="decimal" value="${esc(ui.fundAmount)}" placeholder="0.00"></label>${btn('REVIEW REWARD FUNDING','rewards-fund','wide','',!ready)}</div></section><section class="rewards-history"><h2>ONCHAIN FUNDING.</h2><p>Most recent 20 deposits in the last 2,000 RH blocks. These are direct token contributions; their origin is not assumed to be platform fees.</p>${p.fundingError?`<p role="status">${esc(p.fundingError)}</p>`:''}${p.funding?.length?`<table><thead><tr><th>Funder</th><th>Actual deposit</th><th>Receipt</th></tr></thead><tbody>${p.funding.map(f=>`<tr><td>${link(f.funder)}</td><td>${amount(f.amount)} ${f.symbol}</td><td><a href="https://robinhoodchain.blockscout.com/tx/${f.hash}" target="_blank" rel="noreferrer">RH block ${f.block}</a></td></tr>`).join('')}</tbody></table>`:'<p>No funding deposits are shown in this window. Use the explorer for older activity.</p>'}</section>${p.rows.some(row=>row.finish<=p.at/1000&&row.queued+row.carry>0n)?`<section class="notice"><h3>NEXT CYCLE READY.</h3><p>The next onchain interaction starts a fresh seven-day stream. Waiting time is not backdated. A read or page refresh does not activate it.</p>${btn('REVIEW CYCLE ACTIVATION','rewards-checkpoint','','',!ready)}</section>`:''}`}<div class="rewards-wallet">${!connected?btn('CONNECT WALLET','rewards-connect','primary wide'):state.chain!==4663?btn('SWITCH TO RH MAINNET','rewards-switch','primary wide'):''}</div>${unknown?`<section class="notice warn"><h3>RECOVER THE WALLET REQUEST.</h3><p>The last rewards transaction has an unknown outcome. Check wallet Activity and recover its matching hash before sending another.</p><input id="rewards-recovery-hash" aria-label="Rewards recovery transaction hash" placeholder="0x…" value="${esc(ui.hash)}">${btn('VERIFY MATCHING HASH','rewards-recover','wide','',ui.busy)}</section>`:''}<section class="rewards-details"><h2>PARTICIPATION, NOT A BASKET SHARE.</h2><p>HSET principal and Stock Token rewards have separate accounting. Holding or participating with HSET does not create a claim on every basket or make HSET itself stock-backed. Rewards depend on actual funding and time spent participating.</p><p>Finite seven-day cycles. Active-cycle funding queues; empty-period amounts carry into later cycles. A new cycle starts on a state-changing interaction, not a background timer. Tiny integer-rounding dust may remain unallocated.</p><p>Each asset has its own claim. A failed Stock Token transfer does not prevent another asset’s claim or HSET withdrawal. Issuer restrictions, contract and network risks still apply. No independent audit has been completed.</p><div class="source-links"><a href="/chain/HoodsetStockRewards.sol" target="_blank" rel="noreferrer">CONTRACT SOURCE</a><a href="https://github.com/hoodset/hoodset-app/blob/main/docs/stock-rewards.md" target="_blank" rel="noreferrer">HOW REWARDS WORK</a><a href="https://robinhoodchain.blockscout.com/token/${AGENT_PLAN.token}" target="_blank" rel="noreferrer">HSET CONTRACT</a></div></section></div>`;
 }
 return {ui,page,load,refreshPool,action,input,intent,noUnknown,beforeSend,sending,submitted,rejected,recover,queue:()=>Object.values(saved.rewardsIntents||{}).map(p=>({id:'rewards-unknown',account:p.account,intent:p}))};
}
