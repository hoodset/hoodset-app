import {Interface,keccak256} from 'ethers';
import {AGENT_PLAN,agentAddress} from './agent-plan.js';
const erc=new Interface(['function transfer(address,uint256) returns(bool)','function decimals() view returns(uint8)','function symbol() view returns(string)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export function checkAgentInvoice(i){
 if(!i||!/^inv_[a-f0-9]{32}$/.test(i.id)||!agentAddress(i.account)||i.account===AGENT_PLAN.recipient||i.plan!==AGENT_PLAN.id||i.token!==AGENT_PLAN.token||i.recipient!==AGENT_PLAN.recipient||i.amount!==AGENT_PLAN.amount||i.credits!==AGENT_PLAN.credits||i.chainId!==4663||!Number.isSafeInteger(i.createdAt)||i.createdAt<=0)throw Error('API payment invoice does not match the published HSET plan.');return i;
}
export function agentPaymentTx(invoice){const i=checkAgentInvoice(invoice);return {to:i.token,data:erc.encodeFunctionData('transfer',[i.recipient,BigInt(i.amount)]),value:0n};}
export async function verifyAgentPayment(invoice,hash,rpc,now=Date.now()){
 const i=checkAgentInvoice(invoice);if(!/^0x[a-fA-F0-9]{64}$/.test(hash||''))throw Error('Enter the payment transaction hash.');
 if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error('Payment reader is not on Robinhood Chain.');
 const [tx,r,head]=await Promise.all([rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getBlockByNumber',['latest',false])]);
 if(!tx||!r)throw Object.assign(Error('Payment is not included yet. Verify the same hash again; do not pay again.'),{status:409});
 if(!same(tx.hash,hash)||!same(r.transactionHash,hash)||!same(tx.from,i.account)||!same(r.from,i.account)||!same(tx.to,i.token)||!same(r.to,i.token)||BigInt(tx.value||0)!==0n||BigInt(r.status)!==1n||tx.input?.toLowerCase()!==agentPaymentTx(i).data.toLowerCase()||!same(tx.blockHash,r.blockHash)||tx.blockNumber!==r.blockNumber)throw Error('This is not the exact successful HSET transfer for this invoice.');
 if(!head||!/^0x[0-9a-f]+$/i.test(head.number||'')||!/^0x[0-9a-f]+$/i.test(head.timestamp||'')||now-Number(BigInt(head.timestamp))*1000>300000||Number(BigInt(head.timestamp))*1000>now+60000)throw Error('A fresh RH chain head is required to verify payment.');
 const block=await rpc('eth_getBlockByNumber',[r.blockNumber,false]);
 if(!block||!same(block.hash,r.blockHash)||Number(BigInt(block.timestamp))*1000+1000<i.createdAt)throw Error('Payment block does not match this invoice.');
 const confirmations=Number(BigInt(head.number)-BigInt(r.blockNumber)+1n);
 if(confirmations<AGENT_PLAN.confirmations)throw Object.assign(Error(`Payment has ${Math.max(0,confirmations)}/${AGENT_PLAN.confirmations} RH block confirmations. Verify the same hash shortly.`),{status:409});
 const [code,decimals,symbol]=await Promise.all([rpc('eth_getCode',[i.token,r.blockNumber]),rpc('eth_call',[{to:i.token,data:erc.encodeFunctionData('decimals')},r.blockNumber]),rpc('eth_call',[{to:i.token,data:erc.encodeFunctionData('symbol')},r.blockNumber])]);
 if(keccak256(code)!==AGENT_PLAN.runtime||Number(erc.decodeFunctionResult('decimals',decimals)[0])!==18||erc.decodeFunctionResult('symbol',symbol)[0]!=='HSET')throw Error('The payment token identity could not be verified.');
 let received=0n;for(const log of r.logs||[]){if(!same(log.address,i.token))continue;try{const parsed=erc.parseLog(log);if(parsed?.name==='Transfer'&&same(parsed.args.from,i.account)&&same(parsed.args.to,i.recipient))received+=parsed.args.value;}catch{}}
 if(received!==BigInt(i.amount))throw Error('The actual HSET transfer does not match the invoiced amount.');
 return {hash:hash.toLowerCase(),block:Number(BigInt(r.blockNumber)),blockHash:r.blockHash.toLowerCase(),confirmations,amount:i.amount,account:i.account,recipient:i.recipient};
}
