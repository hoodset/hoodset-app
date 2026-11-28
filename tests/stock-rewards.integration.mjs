import {homedir} from 'node:os';
import {existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JsonRpcProvider,ContractFactory,parseEther,MaxUint256} from 'ethers';
import {compile} from '../scripts/compile-contracts.mjs';
const E=parseEther,D=604800n;
let node,rpc,a,b,c,H,T,F,P;
before(async()=>{
 const bin=process.env.ANVIL_BIN||(existsSync(homedir()+'/.foundry/bin/anvil')?homedir()+'/.foundry/bin/anvil':'anvil');
 node=spawn(bin,['--host','127.0.0.1','--port','18549','--chain-id','31337','--silent'],{stdio:'ignore'});
 rpc=new JsonRpcProvider('http://127.0.0.1:18549',31337,{staticNetwork:true,batchMaxCount:1});rpc.pollingInterval=20;
 for(let i=0;i<80;i++){try{await rpc.getBlockNumber();break;}catch{await new Promise(r=>setTimeout(r,100));}}
 a=await rpc.getSigner(0);b=await rpc.getSigner(1);c=await rpc.getSigner(2);
 const src=`pragma solidity 0.8.39; import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
 contract RewardMock is ERC20 {bool public frozen; constructor(string memory s)ERC20(s,s){} function mint(address a,uint n)external{_mint(a,n);} function freeze(bool f)external{frozen=f;} function _update(address a,address b,uint n)internal virtual override{require(!frozen||a==address(0));super._update(a,b,n);}}
 contract TaxMock is ERC20 {constructor()ERC20("TAX","TAX"){} function mint(address a,uint n)external{_mint(a,n);}function _update(address a,address b,uint n)internal override{if(a!=address(0)&&b!=address(0)){super._update(a,b,n-n/100);super._update(a,address(0),n/100);}else super._update(a,b,n);}}
 contract HookMock is RewardMock {address public target;bool public blocked;constructor()RewardMock("HOOK"){}function hook(address t)external{target=t;}function _update(address a,address b,uint n)internal override{if(target!=address(0)&&a!=address(0)){(bool ok,)=target.call(abi.encodeWithSignature("checkpoint()"));blocked=!ok;}super._update(a,b,n);}}
 `;
 const {output}=compile({'contracts/HoodsetStockRewards.sol':{content:readFileSync('contracts/HoodsetStockRewards.sol','utf8')},'tests/RewardsMock.sol':{content:src}});
 P=output.contracts['contracts/HoodsetStockRewards.sol'].HoodsetStockRewards;
 T=output.contracts['tests/RewardsMock.sol'].RewardMock;F=output.contracts['tests/RewardsMock.sol'].TaxMock;H=output.contracts['tests/RewardsMock.sol'].HookMock;
});
after(async()=>{await rpc?.destroy();node?.kill('SIGTERM');});
async function deploy(code,args=[]){const x=await new ContractFactory(code.abi,'0x'+code.evm.bytecode.object,a).deploy(...args);await x.waitForDeployment();return x;}
async function fixture(kind=T){const h=await deploy(T,['HSET']),x=await deploy(kind,kind===T?['NVDA']:[]),y=await deploy(T,['AMD']),p=await deploy(P,[await h.getAddress(),[await x.getAddress(),await y.getAddress()]]);for(const w of[a,b,c]){await(await h.mint(await w.getAddress(),E('1000000'))).wait();await(await h.connect(w).approve(await p.getAddress(),MaxUint256)).wait();}for(const t of[x,y]){await(await t.mint(await a.getAddress(),E('1000000'))).wait();await(await t.approve(await p.getAddress(),MaxUint256)).wait();}return{h,x,y,p};}
async function at(t){await rpc.send('evm_setNextBlockTimestamp',[Number(t)]);await rpc.send('evm_mine',[]);}
async function txAt(t,send){await rpc.send('evm_setNextBlockTimestamp',[Number(t)]);return(await send()).wait();}
test('rewards: proportional time participation, actual token claims and principal exit',async()=>{
 const {h,x,p}=await fixture();await(await p.stake(E('100'))).wait();await(await p.fundRewards(0,E('700'))).wait();const s=await p.rewardState(0);
 await txAt(s.start+D/2n,()=>p.connect(b).stake(E('100')));await at(s.finish);
 assert.equal(await p.earned(await a.getAddress(),0),E('525'));assert.equal(await p.earned(await b.getAddress(),0),E('175'));
 const before=await x.balanceOf(await b.getAddress());await(await p.connect(b).claim(0)).wait();assert.equal(await x.balanceOf(await b.getAddress())-before,E('175'));
 await(await p.withdraw(E('100'))).wait();await(await p.connect(b).withdraw(E('100'))).wait();assert.equal(await p.totalStaked(),0n);assert.equal(await h.balanceOf(await p.getAddress()),0n);assert.equal(await p.earned(await a.getAddress(),0),E('525'));
 await(await p.claim(0)).wait();assert.equal((await p.rewardState(0)).paid,E('700'));assert.equal(await x.balanceOf(await p.getAddress()),0n);
});
test('rewards: empty time carries forward; late first stake gets no retroactive reward',async()=>{
 const {p}=await fixture();await(await p.fundRewards(0,E('700'))).wait();const s=await p.rewardState(0);
 await txAt(s.start+D-10n,()=>p.stake(E('100')));assert.equal(await p.earned(await a.getAddress(),0),0n);
 await at(s.finish);const amount=await p.earned(await a.getAddress(),0);assert.equal(amount,E('700')-E('700')*(D-10n)/D);
 await(await p.checkpoint()).wait();const next=await p.rewardState(0);assert.ok(next.start>=s.finish);assert.equal(next.budget,E('700')-amount);assert.equal(await p.earned(await a.getAddress(),0),amount);
 await at(next.finish);const earned=await p.earned(await a.getAddress(),0);assert.ok(earned<=E('700')&&E('700')-earned<=2n);
});
test('rewards: micro topups queue without extending finish; long idle rollover is not backdated',async()=>{
 const {p}=await fixture();await(await p.stake(E('1'))).wait();await(await p.fundRewards(0,E('7'))).wait();const s=await p.rewardState(0);
 for(let i=0;i<4;i++)await(await p.fundRewards(0,1)).wait();assert.equal((await p.rewardState(0)).finish,s.finish);assert.equal((await p.rewardState(0)).queued,4n);
 await at(s.finish+D*2n);assert.equal(await p.earned(await a.getAddress(),0),E('7'));await(await p.checkpoint()).wait();const next=await p.rewardState(0);assert.equal(next.budget,4n);assert.ok(next.start>=s.finish+D*2n);assert.equal(await p.earned(await a.getAddress(),0),E('7'));
 await at(next.finish);assert.equal(await p.earned(await a.getAddress(),0),E('7')+4n);
});
test('rewards: one frozen stock cannot block HSET withdrawal or the other stock claim',async()=>{
 const {h,x,y,p}=await fixture();await(await p.stake(E('100'))).wait();await(await p.fundRewards(0,E('7'))).wait();await(await p.fundRewards(1,E('14'))).wait();const s=await p.rewardState(1);await at(s.finish);await(await x.freeze(true)).wait();
 await assert.rejects(async()=>(await p.claim(0)).wait());assert.ok(await p.earned(await a.getAddress(),0)>0n);await(await p.withdraw(E('100'))).wait();assert.equal(await h.balanceOf(await p.getAddress()),0n);await(await p.claim(1)).wait();assert.equal((await p.rewardState(1)).paid,E('14'));assert.equal(await y.balanceOf(await p.getAddress()),0n);
});
test('rewards: taxed funding is rejected atomically; direct donations are never announced as new funded rewards',async()=>{
 const {x,p}=await fixture(F);await assert.rejects(async()=>(await p.fundRewards(0,E('10'))).wait());assert.equal((await p.rewardState(0)).funded,0n);
 const q=await fixture();await(await q.x.transfer(await q.p.getAddress(),E('10'))).wait();assert.equal((await q.p.rewardState(0)).funded,0n);await(await q.p.stake(E('1'))).wait();assert.equal(await q.p.earned(await a.getAddress(),0),0n);
});
test('rewards: reentrant token checkpoint callbacks cannot alter accounting',async()=>{
 const {x,p}=await fixture(H);await(await x.hook(await p.getAddress())).wait();await(await p.fundRewards(0,E('7'))).wait();assert.equal(await x.blocked(),true);assert.equal((await p.rewardState(0)).funded,E('7'));
});
test('rewards: constructor, stake limits, oversize funding and overwithdraw protections',async()=>{
 const {h,x,p}=await fixture();await assert.rejects(()=>deploy(P,[awaitAddress(h),[]]));
 await assert.rejects(async()=>deploy(P,[await h.getAddress(),[await h.getAddress()]]));await assert.rejects(async()=>deploy(P,[await h.getAddress(),[await x.getAddress(),await x.getAddress()]]));
 await assert.rejects(async()=>(await p.stake(0)).wait());await assert.rejects(async()=>(await p.withdraw(1)).wait());await assert.rejects(async()=>(await p.fundRewards(0,10n**36n+1n)).wait());await assert.rejects(async()=>(await p.claim(0)).wait());
 await(await p.stake(E('1'))).wait();await assert.rejects(async()=>(await p.withdraw(E('2'))).wait());assert.equal(await p.balanceOf(await a.getAddress()),E('1'));
});
function awaitAddress(c){return c.getAddress();}
test('rewards: micro rewards and repeated user checkpoints preserve fractional entitlements',async()=>{
 const {p}=await fixture();await(await p.stake(3)).wait();await(await p.connect(b).stake(2)).wait();await(await p.fundRewards(0,101)).wait();const s=await p.rewardState(0);
 for(let i=1n;i<=10n;i++){await txAt(s.start+D*i/11n,()=>p.stake(1));await(await p.withdraw(1)).wait();}
 await at(s.finish);const aa=await p.earned(await a.getAddress(),0),bb=await p.earned(await b.getAddress(),0);assert.ok(aa+bb<=101n);assert.ok(101n-aa-bb<=2n);await(await p.claim(0)).wait();await(await p.connect(b).claim(0)).wait();const r=await p.rewardState(0);assert.ok(r.paid<=r.funded);
});
