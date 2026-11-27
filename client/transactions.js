import { keccak256 } from 'ethers';

export function transactionKey(tx) {
  return `${(tx.to || 'deploy').toLowerCase()}:${keccak256(tx.data || '0x')}:${BigInt(tx.value || 0)}`;
}

export async function checkWalletQueue(activity, plans, account, runId, getReceipt) {
  if(plans.some(p=>p?.account===account&&p.id!==runId&&p.intent))throw Error('Another basket operation has an unknown wallet outcome. Recover it before continuing.');
  for(const row of activity){
    if(row.account!==account||row.status!=='Submitted'||(row.recovery?.exit||row.recovery?.fund)===runId)continue;
    if(!await getReceipt(row.hash))throw Error('Another wallet transaction is still pending. Resolve it before continuing this basket operation.');
  }
}

// A timeout is not proof that a broadcast transaction failed. Only a receipt resolves it.
export async function checkPending(activity, account, key, getReceipt) {
  for (const row of activity) {
    if (row.account !== account || row.operationKey !== key || row.status !== 'Submitted') continue;
    const receipt = await getReceipt(row.hash);
    if (!receipt) throw Error('This operation was already submitted. Check its explorer link before retrying.');
    row.status = receipt.status === 1 ? 'Included in RH block' : 'Reverted';
  }
}

// Read-only recovery: a pending timeout never becomes a failure or another send.
export async function reconcileActivity(activity, account, getReceipt, recover) {
  const errors = [];
  for (const row of activity) {
    if (row.account !== account || row.recoveryComplete || !['Submitted', 'Included in RH block'].includes(row.status)) continue;
    try {
      const receipt = await getReceipt(row.hash);
      if (!receipt) continue;
      if (receipt.status !== 0 && receipt.status !== 1) throw Error('Receipt status is not final yet.');
      if (receipt.hash?.toLowerCase() !== row.hash.toLowerCase() || receipt.from?.toLowerCase() !== account || row.target && receipt.to?.toLowerCase() !== row.target.toLowerCase()) throw Error('Receipt does not match the submitted account and target.');
      row.status = receipt.status === 1 ? 'Included in RH block' : 'Reverted';
      row.block = receipt.blockNumber;
      if (receipt.status === 1) await recover(row, receipt);
      row.recoveryComplete = true;
      delete row.recoveryError;
    } catch (e) {
      row.recoveryError = String(e.message || e).slice(0, 240);
      errors.push(row.recoveryError);
    }
  }
  return errors;
}
