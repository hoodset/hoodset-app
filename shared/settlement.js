import { Interface } from 'ethers';
import { OPENOCEAN_ROUTER } from './openocean.js';
const transfers = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();

export function swapSettlement(receipt, quote) {
  if (receipt?.status !== 1 || !same(receipt.from,quote.taker) || !same(receipt.to,OPENOCEAN_ROUTER)) throw Error('A successful receipt for this wallet and router is required.');
  let inputDelta=0n,outputDelta=0n;
  for(const log of receipt.logs || []) {
    if(!same(log.address,quote.sellToken)&&!same(log.address,quote.buyToken))continue;
    let parsed;try{parsed=transfers.parseLog(log);}catch{continue;}
    if(!parsed)continue;
    const net=(same(parsed.args.to,quote.taker)?parsed.args.value:0n)-(same(parsed.args.from,quote.taker)?parsed.args.value:0n);
    if(same(log.address,quote.sellToken))inputDelta+=net;
    if(same(log.address,quote.buyToken))outputDelta+=net;
  }
  if(inputDelta>=0n || -inputDelta>BigInt(quote.spendingCap) || outputDelta<BigInt(quote.minBuyAmount))throw Error('Transaction included, but token transfers did not match the reviewed bounds. Inspect the explorer before continuing.');
  return {account:quote.taker,hash:receipt.hash,block:receipt.blockNumber,symbol:quote.symbol,side:quote.side,sellToken:quote.sellToken,buyToken:quote.buyToken,sellAmount:String(-inputDelta),buyAmount:String(outputDelta)};
}
