import {homedir} from 'node:os';
import {existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Contract,ContractFactory,parseUnits,AbiCoder,MaxUint256} from 'ethers';
import {compile} from '../scripts/compile-contracts.mjs';
import {ALLOWED,USDG} from '../worker/assets.js';
import {OPENOCEAN_ROUTER,OPENOCEAN_CALLER,openOceanInterface} from '../shared/openocean.js';
const U=s=>parseUnits(String(s),6),T=s=>parseUnits(String(s),18),abi=AbiCoder.defaultAbiCoder();
let node,rpc,a,b,stock,cash,feed,exchange,code;
before(async()=>{
 const bin=process.env.ANVIL_BIN||(existsSync(homedir()+'/.foundry/bin/anvil')?homedir()+'/.foundry/bin/anvil':'anvil');
 node=spawn(bin,['--host','127.0.0.1','--port','18551','--chain-id','4663','--silent'],{stdio:'ignore'});
 rpc=new JsonRpcProvider('http://127.0.0.1:18551',4663,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});rpc.pollingInterval=20;
 for(let i=0;i<80;i++){try{await rpc.getBlockNumber();break;}catch{await new Promise(r=>setTimeout(r,100));}}
 a=await rpc.getSigner(0);b=await rpc.getSigner(1);
 const mock=`pragma solidity 0.8.39;import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
 contract LadderToken is ERC20 {bool public oraclePaused;bool public frozen;bool public tax;constructor()ERC20("MOCK","MOCK"){} function mint(address a,uint256 n)external{_mint(a,n);}function pause(bool x)external{oraclePaused=x;}function freeze(bool x)external{frozen=x;}function setTax(bool x)external{tax=x;} function _update(address a,address b,uint256 n)internal override{require(!frozen||a==address(0),"FROZEN");if(tax&&a!=address(0)&&b!=address(0)){super._update(a,b,n-n/100);super._update(a,address(0),n/100);}else super._update(a,b,n);}}
 contract LadderFeed {uint8 public decimals=8;int256 public value;uint256 public updated;uint80 public round=1;uint80 public answered=1;function set(int256 v,uint256 t,uint80 r,uint80 ar)external{value=v;updated=t;round=r;answered=ar;}function latestRoundData()external view returns(uint80,int256,uint256,uint256,uint80){return(round,value,updated,updated,answered);}}
 contract LadderExchange {struct Description{address srcToken;address dstToken;address srcReceiver;address dstReceiver;uint256 amount;uint256 minReturnAmount;uint256 guaranteedAmount;uint256 flags;address referrer;bytes permit;}struct Call{uint256 target;uint256 gasLimit;uint256 value;bytes data;}function swap(address,Description calldata d,Call[] calldata c)external payable returns(uint256 out){(uint256 received,uint256 spent)=abi.decode(c[0].data,(uint256,uint256));IERC20(d.srcToken).transferFrom(msg.sender,address(this),spent);LadderToken(d.dstToken).mint(d.dstReceiver==address(0)?msg.sender:d.dstReceiver,received);return received;}}
 `;
 const {output}=compile({'contracts/HoodsetLadderOrders.sol':{content:readFileSync('contracts/HoodsetLadderOrders.sol','utf8')},'tests/LadderMocks.sol':{content:mock}});
 code=output.contracts['contracts/HoodsetLadderOrders.sol'].HoodsetLadderOrders;
 const mocks=output.contracts['tests/LadderMocks.sol'];
 for(const address of[USDG,ALLOWED.NVDA])await rpc.send('anvil_setCode',[address,'0x'+mocks.LadderToken.evm.deployedBytecode.object]);
 await rpc.send('anvil_setCode',[OPENOCEAN_ROUTER,'0x'+mocks.LadderExchange.evm.deployedBytecode.object]);
 await rpc.send('anvil_setCode',[OPENOCEAN_CALLER,'0x00']);
 stock=new Contract(ALLOWED.NVDA,mocks.LadderToken.abi,a);cash=new Contract(USDG,mocks.LadderToken.abi,a);exchange=new Contract(OPENOCEAN_ROUTER,mocks.LadderExchange.abi,a);
 feed=await new ContractFactory(mocks.LadderFeed.abi,'0x'+mocks.LadderFeed.evm.bytecode.object,a).deploy();await feed.waitForDeployment();
});
after(async()=>{await rpc?.destroy();node?.kill('SIGTERM');});
const now=async()=>Number((await rpc.send('eth_getBlockByNumber',['latest',false])).timestamp);
async function mark(n){await(await feed.set(BigInt(n)*100000000n,await now(),1,1,{gasLimit:150000})).wait();}
async function fixture(cycles=1){
 await(await stock.pause(false)).wait();await(await stock.freeze(false)).wait();await(await cash.freeze(false)).wait();await(await cash.setTax(false)).wait();await mark(100);
 const e=await new ContractFactory(code.abi,'0x'+code.evm.bytecode.object,a).deploy([ALLOWED.NVDA],[await feed.getAddress()],[120]);await e.waitForDeployment();
 for(const w of[a,b]){await(await cash.mint(await w.getAddress(),U(1000))).wait();await(await cash.connect(w).approve(await e.getAddress(),MaxUint256)).wait();}
 const expiry=await now()+3600;await(await e.open(ALLOWED.NVDA,[T(90),T(80)],[U(100),U(100)],500,cycles,expiry)).wait();return {e,id:1n,expiry};
}
async function route(e,input,output,amount,min,out=min,spent=amount,patch={}){
 const to=await e.getAddress(),desc={srcToken:input,dstToken:output,srcReceiver:OPENOCEAN_CALLER,dstReceiver:to,amount,minReturnAmount:min,guaranteedAmount:0,flags:2,referrer:'0x0000000000000000000000000000000000000000',permit:'0x',...patch};
 return [amount,min,openOceanInterface.encodeFunctionData('swap',[OPENOCEAN_CALLER,desc,[[0,0,0,abi.encode(['uint256','uint256'],[out,spent])]]])];
}
async function buy(e,id=1n,index=0,amount=U(100),out=T('1.25')){return (await e.buy(id,index,(await e.strategies(id)).revision,await route(e,USDG,ALLOWED.NVDA,amount,out),await now()+90)).wait();}
async function sell(e,id=1n,out=U(106)){const s=await e.strategies(id);return (await e.sell(id,s.revision,await route(e,ALLOWED.NVDA,USDG,s.tokens,out),await now()+90)).wait();}
const reject=async f=>assert.rejects(async()=>{const tx=await f();await tx.wait();});

test('orders: partial buys use actual spend/output, net target, exact sale and original-budget repeat',async()=>{
 const {e}=await fixture(2);await mark(80);await buy(e,1n,0,U(50),T('.625'));let s=await e.strategies(1);
 assert.equal(s.cost,U(50));assert.equal(s.tokens,T('.625'));assert.equal((await e.levels(1))[0].remaining,U(50));
 await buy(e,1n,0,U(50),T('.625'));s=await e.strategies(1);assert.equal(s.cost,U(100));assert.equal(s.tokens,T('1.25'));assert.equal(await e.minimumProceeds(1),U(105));assert.equal(await e.reserved(1),U(100));
 await mark(85);await sell(e);s=await e.strategies(1);assert.equal(s.tokens,0n);assert.equal(s.cost,0n);assert.equal(s.cash,U(206));assert.equal(s.cycles,1n);assert.equal(s.active,true);assert.equal(await e.reserved(1),U(200));
 await(await e.withdrawCash(1,U(6))).wait();assert.equal((await e.strategies(1)).cash,U(200));await reject(()=>e.withdrawCash(1,1));
 await mark(80);await buy(e);await mark(85);await sell(e);s=await e.strategies(1);assert.equal(s.active,false);assert.equal(s.cycles,2n);assert.equal(s.cash,U(206));assert.equal(await e.reserved(1),0n);
 const before=await cash.balanceOf(await a.getAddress());await(await e.withdrawCash(1,U(206))).wait();assert.equal(await cash.balanceOf(await a.getAddress())-before,U(206));
 assert.equal(await cash.allowance(await e.getAddress(),OPENOCEAN_ROUTER),0n);assert.equal(await stock.allowance(await e.getAddress(),OPENOCEAN_ROUTER),0n);
});
test('orders: limits reject bad fills, overspends, early triggers, oversells and stale revisions',async()=>{
 const {e}=await fixture();const good=await route(e,USDG,ALLOWED.NVDA,U(100),T('1.25'));
 await reject(async()=>e.buy(1,0,0,good,await now()+90));await mark(80);
 await reject(async()=>e.buy(1,0,0,await route(e,USDG,ALLOWED.NVDA,U(101),T(2)),await now()+90));
 await reject(async()=>e.buy(1,0,0,await route(e,USDG,ALLOWED.NVDA,U(100),T(1)),await now()+90));
 await buy(e);await reject(async()=>e.buy(1,1,0,good,await now()+90));
 await reject(async()=>e.sell(1,1,await route(e,ALLOWED.NVDA,USDG,T('1.26'),U(106)),await now()+90));
 await reject(async()=>e.sell(1,1,await route(e,ALLOWED.NVDA,USDG,T('1.25'),U(104)),await now()+90));
 await reject(()=>sell(e));await mark(85);await sell(e);assert.equal((await e.strategies(1)).active,false);
});
test('orders: stale/incomplete/future/zero feeds and paused tokens block fills, not stop or cash exit',async()=>{
 for(const mode of['stale','future','zero','negative','incomplete','paused']){
  const {e}=await fixture();const t=await now();if(mode==='paused'){await mark(80);await(await stock.pause(true)).wait();}
  else await(await feed.set(mode==='zero'?0:mode==='negative'?-1:8000000000n,mode==='stale'?t-121:mode==='future'?t+100:t,2,mode==='incomplete'?1:2)).wait();
  await reject(()=>buy(e));await(await e.stop(1)).wait();await(await e.withdrawCash(1,U(200))).wait();assert.equal((await e.strategies(1)).cash,0n);
 }
});
test('orders: expired strategies cannot trade; assets recover without fresh prices',async()=>{
 const {e,expiry}=await fixture(5);await mark(80);await buy(e);await rpc.send('evm_setNextBlockTimestamp',[expiry+1]);await rpc.send('evm_mine',[]);
 await reject(()=>sell(e));assert.equal(await e.reserved(1),0n);await(await e.withdrawCash(1,U(100))).wait();await(await e.withdrawTokens(1,T('1.25'))).wait();assert.equal((await e.strategies(1)).cost,0n);
});
test('orders: route recipients/selectors/amounts/return minimums are enforced and no other escrow is spent',async()=>{
 const {e}=await fixture();await mark(100);await(await e.connect(b).open(ALLOWED.NVDA,[T(90)],[U(200)],500,1,await now()+3600)).wait();await mark(80);
 for(const patch of[{dstReceiver:await b.getAddress()},{amount:U(101)},{flags:0},{permit:'0x01'},{srcToken:ALLOWED.NVDA}])await reject(async()=>e.buy(1,0,0,await route(e,USDG,ALLOWED.NVDA,U(100),T('1.25'),T('1.25'),U(100),patch),await now()+90));
 await reject(async()=>e.buy(1,0,0,[U(100),T('1.25'),'0x12345678'],await now()+90));
 await reject(async()=>e.buy(1,0,0,await route(e,USDG,ALLOWED.NVDA,U(100),T('1.25'),T('1.25'),U(99)),await now()+90));
 await reject(async()=>e.buy(1,0,0,await route(e,USDG,ALLOWED.NVDA,U(100),T('1.25'),T(1)),await now()+90));
 await buy(e);assert.equal((await e.strategies(2)).cash,U(200));assert.equal((await e.strategies(2)).tokens,0n);assert.equal(await cash.balanceOf(await e.getAddress()),U(300));
});
test('orders: only owner can stop/withdraw; frozen stock never blocks USDG recovery',async()=>{
 const {e}=await fixture();await mark(80);await buy(e);await reject(()=>e.connect(b).stop(1));await reject(()=>e.connect(b).withdrawCash(1,1));await reject(()=>e.connect(b).withdrawTokens(1,1));
 await reject(()=>e.withdrawTokens(1,1));await(await e.stop(1)).wait();await(await stock.freeze(true)).wait();await reject(()=>e.withdrawTokens(1,T('1.25')));await(await e.withdrawCash(1,U(100))).wait();assert.equal((await e.strategies(1)).cash,0n);assert.equal((await e.strategies(1)).tokens,T('1.25'));
 await(await stock.freeze(false)).wait();await(await e.withdrawTokens(1,T('.25'))).wait();assert.equal((await e.strategies(1)).cost,U(80));await(await e.withdrawTokens(1,T(1))).wait();assert.equal((await e.strategies(1)).cost,0n);
});
test('orders: open validation, exact deposits, expiry and donation isolation',async()=>{
 const {e}=await fixture();await mark(100);const end=await now()+3600;
 for(const args of[[[],[],500,1,end],[[T(100)],[U(1)],500,1,end],[[T(80),T(90)],[U(1),U(1)],500,1,end],[[T(80)],[U('.99')],500,1,end],[[T(80)],[U(1)],99,1,end],[[T(80)],[U(1)],500,101,end],[[T(80)],[U(1)],500,1,await now()+91*86400]])await reject(()=>e.open(ALLOWED.NVDA,...args));
 const next=await e.nextId();await(await cash.setTax(true)).wait();await reject(()=>e.open(ALLOWED.NVDA,[T(90)],[U(10)],500,1,end));assert.equal(await e.nextId(),next);await(await cash.setTax(false)).wait();
 await(await cash.transfer(await e.getAddress(),U(5))).wait();await(await e.stop(1)).wait();await(await e.withdrawCash(1,U(200))).wait();await reject(()=>e.withdrawCash(1,1));assert.equal(await cash.balanceOf(await e.getAddress()),U(5));
});
test('orders: anyone may execute, cannot redirect proceeds; expired route and excessive deadline revert',async()=>{
 const {e}=await fixture();await mark(80);const r=await route(e,USDG,ALLOWED.NVDA,U(100),T('1.25'));
 await reject(async()=>e.buy(1,0,0,r,await now()-1));await reject(async()=>e.buy(1,0,0,r,await now()+121));
 await(await e.connect(b).buy(1,0,0,r,await now()+90)).wait();assert.equal((await e.strategies(1)).owner,await a.getAddress());assert.equal((await e.strategies(1)).tokens,T('1.25'));
});
import {createLadderOrders} from '../client/ladder-orders-ui.js';
import {keccak256} from 'ethers';
test('orders UI: reviewed open is exact, unknown wallet outcomes persist and block repeat requests',async()=>{
 const {e}=await fixture(),account=(await a.getAddress()).toLowerCase(),engine=(await e.getAddress()).toLowerCase(),state={account,session:1},saved={activity:[]},memory={};let review;
 const storage={getItem:k=>memory[k]};
 const ui=createLadderOrders({state,saved,storage,storageKey:'test',save:()=>{memory.test=JSON.stringify(saved);},render:()=>{},heading:()=>'',btn:()=>'',esc:String,notify:()=>{},route:()=>'',reader:()=>rpc,assertWallet:async()=>state.account,noOtherUnknown:()=>{},otherQueue:()=>[],transactionReview:async(label,tx,details,onIncluded,expiresAt,recovery)=>{review={label,tx,details,onIncluded,expiresAt,recovery,account,session:1};}});
 ui.ui.artifact={runtimeHash:keccak256('0x'+code.evm.deployedBytecode.object)};ui.ui.config={engine,chainId:4663,executorActive:true,markets:[{symbol:'NVDA',token:ALLOWED.NVDA,feed:await feed.getAddress(),maxAge:120}]};
 ui.ui.plan={symbol:'NVDA',levels:[{price:'90',budget:'100'},{price:'80',budget:'100'}],profit:'5',cycles:'2',days:'1'};
 await ui.action('orders-open',{});assert.equal(ui.ui.error,'');assert.ok(review);assert.equal(review.recovery.kind,'orders.open');await ui.beforeSend(review);
 const key=(await import('../client/transactions.js')).transactionKey(review.tx);review.operationKey=key;
 ui.sending(review);assert.ok(ui.intent());await assert.rejects(()=>ui.beforeSend(review),/Recover/);
 // An ambiguous provider error cannot clear the durable intent.
 ui.rejected(review,{code:'TIMEOUT'},true,true);assert.ok(ui.intent());
 const row={account,hash:'0x'+'a'.repeat(64),operationKey:key,recovery:review.recovery};saved.activity.push(row);ui.submitted(row);assert.equal(ui.intent(),null);
 await assert.rejects(()=>ui.beforeSend({...review,tx:{...review.tx,data:'0x1234'}}),/changed/);
});
