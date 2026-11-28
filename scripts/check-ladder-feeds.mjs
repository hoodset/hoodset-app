// Read-only. No wallet, key, approval, deposit, deployment or signature.
import fs from 'node:fs';
import {JsonRpcProvider,Contract,ContractFactory} from 'ethers';
import {ALLOWED} from '../worker/assets.js';
const catalog=JSON.parse(fs.readFileSync('web/data/ladder-feeds.json','utf8'));
const rpc=new JsonRpcProvider(process.env.LADDER_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,batchMaxCount:5,cacheTimeout:-1});
const result={checkedAt:new Date().toISOString(),source:catalog.source,markets:[]};
try{
 if(Number(BigInt(await rpc.send('eth_chainId',[])))!==4663)throw Error('Wrong chain.');
 const block=await rpc.getBlock('latest');if(!block||Date.now()/1000-block.timestamp>60)throw Error('Stale chain head.');
 for(const row of catalog.feeds){
  try{
   const c=new Contract(row.feed,['function description() view returns(string)','function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],rpc);
   const [description,decimals,round]=await Promise.all([c.description({blockTag:block.number}),c.decimals({blockTag:block.number}),c.latestRoundData({blockTag:block.number})]);
   if(!description.toUpperCase().includes(row.symbol)||Number(decimals)!==row.decimals||!ALLOWED[row.symbol])throw Error('Feed metadata mismatch.');
   const age=block.timestamp-Number(round[3]),valid=round[0]>0n&&round[1]>0n&&round[4]>=round[0]&&age>=0&&age<=row.heartbeat;
   result.markets.push({symbol:row.symbol,token:ALLOWED[row.symbol],feed:row.feed,maxAge:row.heartbeat,decimals:Number(decimals),description,updatedAt:Number(round[3]),age,fresh:valid});
  }catch(e){result.markets.push({symbol:row.symbol,error:e.shortMessage||e.message});}
 }
 console.log(JSON.stringify(result,null,2));
 if(process.argv.includes('--deployment-payload')){
  // Unsigned only. Never sent. Does not require a funded wallet.
  if(result.markets.some(x=>x.error))throw Error('Refusing a deployment payload with unverified feed metadata.');
  const ar=JSON.parse(fs.readFileSync('web/chain/ladder-orders.json','utf8')),m=result.markets;
  const tx=await new ContractFactory(ar.abi,ar.bytecode).getDeployTransaction(m.map(x=>x.token),m.map(x=>x.feed),m.map(x=>x.maxAge));
  const out=process.env.LADDER_DEPLOYMENT_OUTPUT;if(!out)throw Error('Set LADDER_DEPLOYMENT_OUTPUT to an explicit unsigned-payload file path.');
  fs.writeFileSync(out,JSON.stringify({chainId:4663,runtimeHash:ar.runtimeHash,value:'0',data:tx.data,constructor:{tokens:m.map(x=>x.token),feeds:m.map(x=>x.feed),maxAges:m.map(x=>x.maxAge)},note:'Unsigned gas-only deployment. Creates no strategy and transfers no USDG or HSET.'},null,2)+'\n');
 }
}finally{rpc.destroy();}
