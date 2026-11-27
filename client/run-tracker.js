// Persist broadcasts before waiting. Timeouts and missing receipts never mean failure.
export function createRunTracker({d,key,prefix,settle,ledger}){
  const {state,saved,save}=d,cache=new Map();
  const runs=()=>Array.isArray(saved[key])?saved[key]:[];
  const byId=id=>runs().find(p=>p.id===id);
  const matches=r=>r?.recovery?.kind?.startsWith(prefix+'.');
  function persist(){save();const disk=JSON.parse(localStorage.getItem(d.storageKey)||'{}');if(JSON.stringify(disk[key])!==JSON.stringify(saved[key]))throw Error('Progress could not be saved. Enable browser storage before continuing.');}
  function guard(p){
    if(p.intent)throw Error('The last wallet request has an unknown outcome. Recover its hash before continuing.');
    const l=cache.get(p.id);if(!l)throw Error('Verify the saved receipts first.');
    if(l.pending.length)throw Error('A transaction is still pending. Another redemption or sale will not be sent.');
    return l;
  }
  async function sync(p){
    const session=state.session,reader=d.reader(),facts=await Promise.all(p.transactions.map(async row=>{
      if(row.cancelHash){
        const [c,tx]=await Promise.all([reader.getTransactionReceipt(row.cancelHash),reader.getTransaction(row.cancelHash)]);
        if(!c||c.status!==1||!tx||tx.nonce!==row.nonce||tx.from.toLowerCase()!==p.account||tx.to?.toLowerCase()!==p.account||tx.data!=='0x'||tx.value!==0n)throw Error('Wallet cancellation could not be verified.');
        return {row,cancelled:true};
      }
      const receipt=await reader.getTransactionReceipt(row.hash);if(!receipt)return {row};
      if(receipt.hash.toLowerCase()!==row.hash.toLowerCase()||receipt.from.toLowerCase()!==p.account||receipt.to?.toLowerCase()!==row.target.toLowerCase())throw Error('Receipt does not match the submitted wallet and target.');
      if(receipt.status===0)return {row,receipt};if(receipt.status!==1)throw Error('Receipt has not been included yet.');
      const tx=await reader.getTransaction(row.hash);
      if(!tx||tx.from.toLowerCase()!==p.account||tx.to?.toLowerCase()!==row.target.toLowerCase()||tx.value!==0n||tx.data.toLowerCase()!==row.recovery.data?.toLowerCase()||!Number.isSafeInteger(tx.nonce))throw Error('Submitted transaction data could not be verified.');
      const settlement=await settle(p,row.recovery,receipt,tx);
      return {row,receipt,settlement:settlement?{...settlement,nonce:tx.nonce}:null};
    }));
    if(session!==state.session||state.account!==p.account)throw Error('Wallet changed while verifying exit progress.');
    const settlements=facts.filter(f=>f.settlement).map(f=>f.settlement),pending=[];
    for(const {row,receipt,cancelled}of facts){row.status=cancelled?'Cancelled in wallet':!receipt?'Submitted':receipt.status===1?'Included in RH block':'Reverted';if(!receipt&&!cancelled)pending.push(row);}
    const result={...ledger(p,settlements),pending};cache.set(p.id,result);persist();return result;
  }
  function sending(r){if(!matches(r))return;const p=byId(r.recovery.exit);if(p.intent)throw Error('Resolve the previous wallet request first.');r.recovery.data=r.tx.data;p.intent={target:r.tx.to.toLowerCase(),label:r.label,recovery:r.recovery,at:Date.now()};persist();}
  function submitted(row){
    if(!matches(row))return;const p=byId(row.recovery.exit);if(!p)throw Error('Exit progress is missing. Preserve this hash: '+row.hash);
    if(!p.transactions.some(t=>t.hash.toLowerCase()===row.hash.toLowerCase()))p.transactions.push({...row,target:row.target.toLowerCase()});
    delete p.intent;cache.delete(p.id);persist();
  }
  function rejected(r,e,requested,intentStarted=false){if(intentStarted&&matches(r)&&!r.sentHash&&(!requested||e.code===4001||e.code==='ACTION_REJECTED'||e.info?.error?.code===4001)){const p=byId(r.recovery.exit);delete p.intent;persist();}}
  async function recoverHash(p,hash){
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash||''))throw Error('Enter the transaction hash from your wallet activity.');
    const pending=cache.get(p.id)?.pending?.[0],r=p.intent||pending;
    if(!r)throw Error('There is no unresolved wallet request.');
    const reader=d.reader(),tx=await reader.getTransaction(hash);
    if(!tx||tx.from.toLowerCase()!==p.account||tx.value!==0n)throw Error('This hash does not match the wallet request.');
    const identical=tx.to?.toLowerCase()===r.target.toLowerCase()&&tx.data.toLowerCase()===r.recovery.data.toLowerCase();
    if(pending&&!p.intent){
      const original=await reader.getTransaction(pending.hash),nonce=original?.nonce??pending.nonce;
      if(nonce===undefined||tx.nonce!==nonce)throw Error('The replacement must use the same wallet nonce.');
      const oldHash=pending.hash;
      if(identical){pending.replacedHashes=[...(pending.replacedHashes||[]),oldHash];pending.hash=tx.hash;pending.nonce=tx.nonce;}
      else{
        const receipt=await reader.getTransactionReceipt(tx.hash);
        if(tx.to?.toLowerCase()!==p.account||tx.data!=='0x'||!receipt||receipt.status!==1)throw Error('Only an identical speed-up or a confirmed zero-value self-cancellation can resolve this step.');
        pending.cancelHash=tx.hash;pending.nonce=nonce;
      }
      const previous=saved.activity?.find(t=>t.hash===oldHash);if(previous){previous.status=pending.cancelHash?'Cancelled in wallet':'Replaced / tracked in basket exit';previous.recoveryComplete=true;previous.replacementHash=tx.hash;}
      persist();
    }else{
      if(!identical||p.transactions.some(t=>t.hash.toLowerCase()===tx.hash.toLowerCase()))throw Error('This hash does not match the unresolved request.');
      if(tx.blockNumber!=null){const b=await reader.getBlock(tx.blockNumber);if(!b||b.timestamp*1000<r.at-10000)throw Error('This transaction predates the wallet request.');}
      submitted({hash:tx.hash,account:p.account,target:tx.to,nonce:tx.nonce,label:r.label,recovery:r.recovery,at:Date.now(),status:'Submitted'});
    }
    return sync(p);
  }
  return {cache,persist,guard,sync,sending,submitted,rejected,recoverHash,async recover(row){if(!matches(row))return;const p=byId(row.recovery.exit);if(p){if(!p.transactions.some(t=>t.hash===row.hash))submitted(row);await sync(p);}}};
}
