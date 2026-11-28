import {BrowserProvider} from 'ethers';
import {AGENT_PLAN,AGENT_ORIGIN,agentMessage} from '../shared/agent-plan.js';
import {agentPaymentTx,checkAgentInvoice,verifyAgentPayment} from '../shared/agent-payment.js';
import {readHsetHolder} from './hset-holder.js';
import {transactionKey,checkWalletQueue} from './transactions.js';
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
export function validateAgentChallenge(c,account,action,payload,now=Date.now()){
 if(!c||c.account!==account||c.action!==action||c.payload!==JSON.stringify(payload)||!/^[a-f0-9]{64}$/.test(c.nonce||'')||c.expiresAt<=now||c.expiresAt>now+301000||c.message!==agentMessage(c))throw Error('The API authorization message does not match this wallet and action.');return c;
}
export function createAgentAccess(d){
 const {state,saved,save,render,notify,esc}=d;
 const ui={config:null,key:'',keyAccount:null,keyId:null,usage:null,label:'Research agent',paste:'',hash:'',invoice:null,tool:'list_baskets',args:'{}',result:null,error:'',busy:false};
 const belongs=r=>r?.recovery?.kind==='agent.payment';
 const intent=()=>saved.agentIntents?.[state.account]||null;
 const account=()=>state.account||ui.keyAccount;
 function noUnknown(a=state.account){if(saved.agentIntents?.[a])throw Error('Recover the last HSET payment wallet request before sending another transaction.');}
 function persist(){save();const copy=JSON.parse((d.storage||localStorage).getItem(d.storageKey)||'{}');if(JSON.stringify(copy.agentIntents||{})!==JSON.stringify(saved.agentIntents||{}))throw Error('Could not save API payment progress. Allow browser storage before signing.');return copy;}
 function session(a,s){if(state.account!==a||state.session!==s)throw Error('Wallet changed. Review the API action again.');}
 async function api(action,body,key=ui.key){const r=await (d.fetcher||fetch)('/api/agents?action='+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'API service unavailable.');return result;}
 async function load(){if(ui.busy)return;ui.busy=true;ui.error='';try{ui.config=await api('config');if(ui.config.plan?.recipient!==AGENT_PLAN.recipient||ui.config.plan?.amount!==AGENT_PLAN.amount||ui.config.plan?.credits!==1000)throw Error('The API tariff does not match this site version. Refresh the page before paying.');}catch(e){ui.error=e.message;ui.config=null;}finally{ui.busy=false;if(d.active())render();}}
 async function usage(){if(!ui.key)throw Error('Create or enter an API key first.');const u=await api('usage');if(state.account&&!same(u.account,state.account))throw Error('This key belongs to a different wallet.');ui.usage=u;ui.keyAccount=u.account;ui.invoice=u.invoices.find(i=>!i.paidHash)||u.invoices[0]||null;return u;}
 async function signed(action,payload){
  const a=await d.assertWallet(),s=state.session;const c=validateAgentChallenge(await api('challenge',{account:a,action,...payload},''),a,action,payload);session(a,s);
  d.signing?.(true);let signature;try{signature=await (d.signMessage?d.signMessage(c.message):new BrowserProvider(state.provider).getSigner().then(signer=>signer.signMessage(c.message)));}finally{d.signing?.(false);}session(a,s);
  return api(action,{nonce:c.nonce,signature},'');
 }
 async function createKey(){const label=ui.label.trim();if(!label||label.length>40)throw Error('Name this API key using 1–40 characters.');const r=await signed('create_key',{label});if(!/^hset_[a-f0-9]{64}$/.test(r.key||'')||!same(r.account,state.account))throw Error('The new API key response is invalid.');ui.key=r.key;ui.keyAccount=r.account;ui.keyId=r.id;await usage();notify('API key created. Copy it before leaving this page.');}
 async function reviewPayment(){
  const a=await d.assertWallet(),s=state.session;noUnknown(a);d.noOtherUnknown(a);await checkWalletQueue(saved.activity||[],d.otherQueue(),a,'agent-payment',h=>d.reader().getTransactionReceipt(h));
  if(!ui.key||ui.keyAccount!==a)throw Error('Create or enter an API key for the connected wallet.');await usage();session(a,s);
  const invoice=checkAgentInvoice((await api('invoice',{})).invoice);if(invoice.account!==a)throw Error('Invoice belongs to a different wallet.');ui.invoice=invoice;
  const prior=saved.activity?.find(r=>r.recovery?.kind==='agent.payment'&&r.recovery.invoice?.id===invoice.id&&r.status!=='Reverted');if(prior){ui.hash=prior.hash;throw Error('This invoice already has a wallet transaction. Verify the existing payment hash instead of paying again.');}
  const proof=await readHsetHolder(d.reader(),a);session(a,s);if(proof.balance<BigInt(invoice.amount))throw Error('This wallet needs '+AGENT_PLAN.displayAmount+' HSET for this package. ETH gas is separate.');
  const details=`<div class="meta-pair"><span>API request package</span><strong>1,000 successful requests / no expiry</strong></div><div class="meta-pair"><span>Exact payment</span><strong>100,000 HSET</strong></div><div class="meta-pair"><span>Payment recipient</span><strong>${esc(invoice.recipient)}</strong></div><p>This transfers HSET to the published service recipient. It buys no Stock Tokens or basket shares. API credits are assigned after ${AGENT_PLAN.confirmations} RH block confirmations. Gas is paid in ETH. No token approval is required.</p>`;
  await d.transactionReview('FUND API REQUEST CREDITS',agentPaymentTx(invoice),details,async()=>{},Date.now()+90000,{kind:'agent.payment',invoice});
 }
 async function beforeSend(r){
  if(!belongs(r))return;noUnknown(r.account);const i=checkAgentInvoice(r.recovery.invoice);if(i.account!==r.account||transactionKey(r.tx)!==transactionKey(agentPaymentTx(i)))throw Error('HSET payment changed after review.');
  const proof=await readHsetHolder(d.reader(),r.account);if(proof.balance<BigInt(i.amount))throw Error('HSET balance changed after review.');if(!ui.key||ui.keyAccount!==r.account)throw Error('API key is no longer loaded. Close the review and restore the key.');const u=await api('usage');if(u.account!==r.account||!u.invoices.some(x=>x.id===i.id&&!x.paidHash))throw Error('This API invoice is already paid or unavailable. Refresh the account.');
 }
 function sending(r){if(!belongs(r))return;noUnknown(r.account);saved.agentIntents||={};saved.agentIntents[r.account]={account:r.account,target:r.tx.to,data:r.tx.data,value:String(r.tx.value||0),operationKey:r.operationKey,label:r.label,recovery:r.recovery,at:Date.now()};try{persist();}catch(e){delete saved.agentIntents[r.account];throw e;}}
 function submitted(row){if(!belongs(row))return;const copy=persist();if(!copy.activity?.some(r=>same(r.hash,row.hash)))throw Error('Keep the wallet hash: API payment progress was not saved.');const p=saved.agentIntents?.[row.account];delete saved.agentIntents?.[row.account];try{persist();}catch(e){if(p)saved.agentIntents[row.account]=p;throw e;}ui.hash=row.hash;ui.invoice=row.recovery.invoice;}
 function rejected(r,e,requested,started){if(!belongs(r)||r.sentHash||!started)return;if(!requested||e.code===4001||e.code==='ACTION_REJECTED'||e.info?.error?.code===4001){delete saved.agentIntents?.[r.account];persist();}}
 async function recover(row){
  const i=checkAgentInvoice(row.recovery.invoice),p=await verifyAgentPayment(i,row.hash,(m,p)=>d.reader().send(m,p));if(i.account!==row.account)throw Error('Payment account mismatch.');row.agentPayment={...p,invoiceId:i.id,credits:i.credits};if(same(state.account,row.account)){ui.hash=row.hash;ui.invoice=i;}
 }
 async function recoverHash(){
  const p=intent(),hash=ui.hash;if(!p)throw Error('There is no unknown API payment request.');if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Enter the payment hash from wallet Activity.');const a=await d.assertWallet(),s=state.session,tx=await d.reader().getTransaction(hash);session(a,s);if(!tx||!same(tx.from,a)||transactionKey(tx)!==p.operationKey)throw Error('This hash does not match the original HSET payment request.');if(tx.blockNumber!==null){const block=await d.reader().getBlock(tx.blockNumber);if(!block||block.timestamp*1000+1000<p.at)throw Error('This transaction predates the wallet payment request.');}
  let row=saved.activity.find(r=>same(r.hash,hash));if(row&&(!same(row.account,a)||row.operationKey!==p.operationKey))throw Error('The saved hash belongs to another operation.');if(!row){row={label:p.label,operationKey:p.operationKey,hash:tx.hash,account:a,target:p.target,nonce:tx.nonce,recovery:p.recovery,at:p.at,status:'Submitted'};saved.activity.unshift(row);}submitted(row);const receipt=await d.reader().getTransactionReceipt(hash);if(receipt){row.status=receipt.status===1?'Included in RH block':'Reverted';if(receipt.status===1){await recover(row);row.recoveryComplete=true;}save();}notify('Payment hash recovered. Verify API credit below.');
 }
 async function claim(){
  if(!ui.key)throw Error('Create or enter your API key first.');if(!ui.invoice)await usage();if(!ui.invoice)throw Error('No API invoice exists for this wallet.');
  const r=await api('claim',{invoiceId:ui.invoice.id,hash:ui.hash.trim()});ui.usage={...r,account:ui.keyAccount};ui.invoice=ui.usage.invoices.find(i=>i.id===ui.invoice.id)||ui.invoice;notify(r.credited?'1,000 API request credits added.':'This payment was already credited. Balance refreshed.');
 }
 function sync(){if(state.account&&ui.keyAccount&&state.account!==ui.keyAccount){ui.key='';ui.keyId=null;ui.keyAccount=null;ui.usage=null;ui.invoice=null;ui.result=null;ui.hash='';}if(!ui.hash&&state.account){const row=saved.activity?.find(r=>belongs(r)&&r.account===state.account);if(row){ui.hash=row.hash;ui.invoice=row.recovery.invoice;}}}
 async function action(action,el){if(ui.busy)return;ui.busy=true;ui.error='';render();try{
  if(action==='agent-config'){ui.busy=false;await load();return;}
  if(action==='agent-connect')d.connect();
  if(action==='agent-switch')await d.switchNetwork();
  if(action==='agent-create-key')await createKey();
  if(action==='agent-use-key'){if(!/^hset_[a-f0-9]{64}$/.test(ui.paste.trim()))throw Error('Enter a valid HOODSET API key.');const previous=ui.key;ui.key=ui.paste.trim();try{await usage();ui.paste='';ui.keyId=ui.usage.keys.find(k=>k.prefix===ui.key.slice(0,13))?.id||null;}catch(e){ui.key=previous;throw e;}}
  if(action==='agent-forget-key'){ui.key='';ui.keyId=null;ui.keyAccount=null;ui.usage=null;ui.result=null;}
  if(action==='agent-copy-key'){if(!ui.key)throw Error('No API key is loaded.');await navigator.clipboard.writeText(ui.key);notify('API key copied.');}
  if(action==='agent-copy-config'){await navigator.clipboard.writeText(JSON.stringify({mcpServers:{hoodset:{type:'http',url:AGENT_ORIGIN+'/mcp',headers:{Authorization:'Bearer '+(ui.key||'YOUR_HOODSET_API_KEY')}}}},null,2));notify('MCP connection configuration copied.');}
  if(action==='agent-usage')await usage();
  if(action==='agent-revoke'){await signed('revoke_key',{keyId:el.dataset.key});if(el.dataset.key===ui.keyId){ui.key='';ui.usage=null;ui.keyAccount=null;ui.keyId=null;}else await usage();notify('API key revoked.');}
  if(action==='agent-review-payment')await reviewPayment();
  if(action==='agent-claim')await claim();
  if(action==='agent-recover')await recoverHash();
  if(action==='agent-run'){if(!ui.key)throw Error('Create or enter an API key first.');let args;try{args=JSON.parse(ui.args);}catch{throw Error('Tool arguments must be valid JSON.');}ui.result=await api('call',{tool:ui.tool,arguments:args});await usage();}
 }catch(e){ui.error=String(e.shortMessage||e.message||e).slice(0,350);}finally{ui.busy=false;render();}}
 function input(el){if(el.id==='agent-label')ui.label=el.value;if(el.id==='agent-key-input')ui.paste=el.value;if(el.id==='agent-payment-hash')ui.hash=el.value;if(el.id==='agent-tool-args')ui.args=el.value;if(el.id==='agent-tool'){ui.tool=el.value;ui.args=ui.tool==='list_baskets'?'{}':ui.tool==='get_reference_spreads'?'{"symbols":["NVDA","AMD"]}':ui.tool==='analyze_mix'?'{"mix":{"assets":["NVDA","AMD","AVGO"],"weights":[33.34,33.33,33.33]},"period":"1Y"}':ui.tool==='compare_mixes'?'{"left":{"assets":["NVDA","AMD"],"weights":[50,50]},"right":{"assets":["NVDA","AMD"],"weights":[70,30]},"period":"1Y"}':'{"address":"0x3153a84df153d29f78326e577fa00079083b943a"}';ui.result=null;render();}}
 return {ui,load,action,input,sync,intent,noUnknown,beforeSend,sending,submitted,rejected,recover,queue:()=>Object.values(saved.agentIntents||{}).map(p=>({id:'api-payment-unknown',account:p.account,intent:p}))};
}
