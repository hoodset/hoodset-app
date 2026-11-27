import {Contract,keccak256,isAddress} from 'ethers';
export const HSET_ADDRESS='0x2c94879c2b482d1838ccce3cd00ffd96a82fbcb8';
export const HSET_RUNTIME='0x040904d1ae06fb97e0a6fdf5ed8d79ac42209ff7c8965347f3a118f1b01a4738';
export const HSET_MINIMUM=10n**18n;
export const HOLDER_FRESH_MS=120000;
const ABI=['function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)'];
export function holderAccess(proof,account,chain,now=Date.now()){
  return !!proof&&isAddress(account||'')&&chain===4663&&proof.account===account.toLowerCase()&&proof.chain===4663&&Number.isSafeInteger(proof.block)&&proof.block>0&&Number.isFinite(proof.checkedAt)&&now>=proof.checkedAt&&now-proof.checkedAt<=HOLDER_FRESH_MS&&typeof proof.balance==='bigint'&&proof.balance>=HSET_MINIMUM;
}
export async function readHsetHolder(reader,account,now=Date.now()){
  if(!isAddress(account))throw Error('Connect a wallet address before checking HSET.');
  let timer;const task=(async()=>{
  const chain=Number(BigInt(await reader.send('eth_chainId',[])));
  if(chain!==4663)throw Error('HSET must be read on Robinhood Chain mainnet.');
  const block=await reader.getBlockNumber(),token=new Contract(HSET_ADDRESS,ABI,reader);
  const [code,symbol,decimals,balance]=await Promise.all([reader.getCode(HSET_ADDRESS,block),token.symbol({blockTag:block}),token.decimals({blockTag:block}),token.balanceOf(account,{blockTag:block})]);
  if(keccak256(code)!==HSET_RUNTIME||symbol!=='HSET'||Number(decimals)!==18||balance<0n)throw Error('HSET contract identity could not be verified.');
  return {account:account.toLowerCase(),chain,block,checkedAt:now,balance};
  })();
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HSET balance check timed out. Try again.')),12000);})]);}
  finally{clearTimeout(timer);}
}
