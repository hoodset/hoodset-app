// Dry-run by default. This file is NOT started by web builds or deployment.
// The executor's wallet pays its own gas; it has no withdrawal authority.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Contract,JsonRpcProvider,Wallet,keccak256} from 'ethers';
import {LADDER_ABI,LADDER_BUILD,minimumBuy,minimumSell} from '../shared/ladder-orders.js';
import {ALLOWED} from '../worker/assets.js';
import {openOceanInput} from '../shared/openocean.js';
import {fetchOpenOcean} from '../shared/openocean-api.js';

export async function prepareExecution({engine,id,s,levels,price,quote,clock=Date.now}){
 const now=Math.floor(clock()/1000);
 if(!s.active||Number(s.expiresAt)<=now)return {skip:'Strategy stopped or expired.'};
 const symbol=Object.keys(ALLOWED).find(x=>ALLOWED[x].toLowerCase()===s.token.toLowerCase());if(!symbol)throw Error('Unsupported strategy token.');
 let side,index,amount,bound;
 if(s.tokens>0n&&s.tokens*price/10n**30n>=minimumSell(s.cost,Number(s.profitBps))){side='sell';amount=s.tokens;bound=minimumSell(s.cost,Number(s.profitBps));}
 else{index=levels.findIndex(r=>r.remaining>0n&&price<=r.price);if(index<0)return {skip:'No buy or full-exit trigger.'};side='buy';amount=levels[index].remaining;bound=minimumBuy(amount,levels[index].price);}
 const q=await quote(openOceanInput({symbol,side,amount:String(amount),taker:engine,slippageBps:100}));
 if(q.expiresAt<=clock()+5000)throw Error('Quote expired before simulation.');
 if(BigInt(q.minBuyAmount)<bound)return {skip:'Net route does not satisfy the strategy limit.'};
 const route=[amount,BigInt(q.minBuyAmount),q.transaction.data],deadline=Math.floor(q.expiresAt/1000);
 return {method:side,args:side==='buy'?[id,index,s.revision,route,deadline]:[id,s.revision,route,deadline],expiresAt:q.expiresAt,side,symbol,amount:String(amount),minimum:q.minBuyAmount,revision:String(s.revision)};
}
async function main(){
 const execute=process.argv.includes('--execute'),watch=process.argv.includes('--watch'),idArg=process.argv.find(a=>a.startsWith('--ids='));
 if(!idArg||!/^--ids=[1-9][0-9]*(,[1-9][0-9]*){0,29}$/.test(idArg))throw Error('Pass an explicit list: --ids=1,2 (at most 30 strategies). Dry-run unless --execute is given.');
 const ids=[...new Set(idArg.slice(6).split(',').map(BigInt))];
 const config=JSON.parse(fs.readFileSync('web/data/ladder-orders.json','utf8')),artifact=JSON.parse(fs.readFileSync('web/chain/ladder-orders.json','utf8'));
 if(!config.engine||config.chainId!==4663||config.protocolFeeBps!==0)throw Error('No activated, reviewed HOODSET ladder engine is configured.');
 const rpc=new JsonRpcProvider(process.env.LADDER_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,batchMaxCount:5,cacheTimeout:-1});
 try{
  if(Number(BigInt(await rpc.send('eth_chainId',[])))!==4663)throw Error('Wrong chain.');
  if(keccak256(await rpc.getCode(config.engine))!==artifact.runtimeHash)throw Error('Engine runtime does not match the local reproducible build.');
  let signer;
  if(execute){if(!config.executorActive)throw Error('Executor has not been explicitly activated in config.');if(!process.env.LADDER_EXECUTOR_KEY)throw Error('Execute mode needs an operator-provided gas-wallet key in LADDER_EXECUTOR_KEY.');signer=new Wallet(process.env.LADDER_EXECUTOR_KEY,rpc);}
  const c=new Contract(config.engine,LADDER_ABI,signer||rpc);if(await c.BUILD_ID()!==LADDER_BUILD)throw Error('Unexpected engine build.');
  const json=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Route provider HTTP '+r.status);return r.json();};
  let quit=false;process.once('SIGINT',()=>{quit=true;});process.once('SIGTERM',()=>{quit=true;});
  do{
   // A pending transaction or unknown outcome stops this process. Restart only after checking its receipt.
   if(signer&&await rpc.getTransactionCount(signer.address,'pending')!==await rpc.getTransactionCount(signer.address,'latest'))throw Error('Executor has a pending transaction. Resolve it before another send.');
   for(const id of ids){
    try{
     const block=await rpc.getBlock('latest');if(!block||Date.now()/1000-block.timestamp>60||block.timestamp>Date.now()/1000+30)throw Error('Chain head is stale or future-dated.');
     const s=await c.strategies(id,{blockTag:block.number});
     const m=config.markets.find(x=>x.token.toLowerCase()===s.token.toLowerCase());if(!m)throw Error('Token feed is not in the verified activation manifest.');
     const market=await c.markets(s.token,{blockTag:block.number});if(market.feed.toLowerCase()!==m.feed.toLowerCase()||Number(market.maxAge)!==m.maxAge)throw Error('Oracle manifest mismatch.');
     const [levels,price]=await Promise.all([c.levels(id,{blockTag:block.number}),c.price(s.token,{blockTag:block.number})]);
     const p=await prepareExecution({engine:config.engine,id,s,levels,price,quote:q=>fetchOpenOcean(q,json)});
     if(p.skip){console.log(JSON.stringify({id:String(id),mode:execute?'execute':'dry-run',skip:p.skip}));continue;}
     const fn=c.getFunction(p.method);await fn.staticCall(...p.args);const gas=await fn.estimateGas(...p.args);if(Date.now()+3000>=p.expiresAt)throw Error('Quote expired during simulation; refresh next cycle.');
     if(!execute){console.log(JSON.stringify({id:String(id),mode:'dry-run',side:p.side,symbol:p.symbol,amount:p.amount,minimum:p.minimum,gas:String(gas)}));continue;}
     // A small explicit per-transaction ETH ceiling protects the gas wallet from a bad RPC estimate.
     const fee=await rpc.getFeeData(),gasLimit=gas*120n/100n,priceGas=fee.maxFeePerGas||fee.gasPrice;
     if(!priceGas||gasLimit*priceGas>1000000000000000n)throw Error('Estimated gas exceeds 0.001 ETH.');
     let tx;try{tx=await fn(...p.args,{gasLimit});console.log(JSON.stringify({id:String(id),hash:tx.hash,status:'submitted'}));const r=await tx.wait(2,90000);if(!r||r.status!==1)throw Error('Execution did not confirm successfully.');console.log(JSON.stringify({id:String(id),hash:tx.hash,status:'included',block:r.blockNumber}));}
     catch{throw Object.assign(Error('Wallet outcome requires checking before this executor is restarted.'),{fatal:true});}
    }catch(e){console.error(JSON.stringify({id:String(id),error:e.shortMessage||e.message}));if(e.fatal)throw e;}
   }
   if(watch&&!quit)await new Promise(r=>setTimeout(r,15000));
  }while(watch&&!quit);
 }finally{rpc.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
