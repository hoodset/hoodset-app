import {units} from './finance.js';
import {stressScenario,scenarioRecord,validScenarios,SCENARIO_LIMIT} from './stress-test.js';
import {readHsetHolder,holderAccess,HSET_ADDRESS} from './hset-holder.js';

// Keep displayed cents identical to the sum of component changes.
const usd=n=>{const a=n<0n?-n:n;return (n<0n?'−':'')+'$'+(a/100n).toLocaleString('en-US')+'.'+(a%100n).toString().padStart(2,'0');};
const pct=n=>(n>0?'+':n<0?'−':'')+(Math.abs(n)/100).toFixed(2)+'%';
const tone=n=>n<0?'negative':n>0?'positive':'';

export function createStressUI(d){
  const {state,saved,esc,btn,save,render,notify}=d;
  let current=null,proof=null,checking=false,holderError='',calcError='';
  const drafts=new Map();
  function config(t){
    const baseline=stressScenario(t,'1000'),key=baseline.key;
    if(!drafts.has(key)){
      const old=saved.stressDrafts?.[key],shocks=Object.fromEntries(t.assets.map(s=>[s,'0']));
      shocks[baseline.largest.symbol]='-20';
      drafts.set(key,{budget:typeof old?.budget==='string'&&old.budget.length<=16?old.budget:'1000',shocks:Object.fromEntries(t.assets.map(s=>[s,typeof old?.shocks?.[s]==='string'&&old.shocks[s].length<=10?old.shocks[s]:shocks[s]])),label:typeof old?.label==='string'?old.label.slice(0,40):'Largest component -20%'});
    }
    return {key,draft:drafts.get(key),baseline};
  }
  function remember(){if(!current)return;saved.stressDrafts||={};saved.stressDrafts[current.key]=structuredClone(current.draft);const keys=Object.keys(saved.stressDrafts);for(const k of keys.slice(0,Math.max(0,keys.length-30)))delete saved.stressDrafts[k];save();}
  function result(){if(!current)throw Error('Choose a valid complete mix first.');return stressScenario(current.theme,current.draft.budget,current.draft.shocks);}
  function resultsHTML(r,error=''){
    if(error)return `<p class="form-error" role="alert">${esc(error)} Scenario results are paused.</p>`;
    return `<div class="stress-outcome" aria-live="polite"><div><span>Hypothetical start</span><strong>${usd(r.startCents)}</strong></div><div><span>After your price changes</span><strong>${usd(r.endCents)}</strong></div><div class="stress-impact ${tone(r.changeCents)}"><span>Scenario change</span><strong>${usd(r.changeCents)}</strong><b>${pct(r.returnBps)}</b></div></div>`;
  }
  function access(){return proof?.session===state.session&&holderAccess(proof,state.account,state.chain);}
  function records(){return validScenarios(saved.stressScenarios?.[state.account?.toLowerCase()]);}
  function persistRows(account,rows){
    const key=account.toLowerCase();saved.stressScenarios||={};const before=saved.stressScenarios[key];saved.stressScenarios[key]=rows;
    try{save();const storage=d.storage||localStorage,stored=JSON.parse(storage.getItem(d.storageKey)||'{}');if(JSON.stringify(stored.stressScenarios?.[key])!==JSON.stringify(rows))throw Error('Storage did not retain the scenarios.');}
    catch{if(before===undefined)delete saved.stressScenarios[key];else saved.stressScenarios[key]=before;throw Error('Could not save the scenario library. Allow browser storage and try again.');}
  }
  function library(){
    const open=access(),rows=records(),connected=!!state.account;
    return `<section class="stress-library" aria-label="HSET scenario library"><div class="stress-library-heading"><div><small>HSET HOLDER WORKSPACE</small><h4>SAVE THE WHAT-IFS.</h4></div><span class="badge ${open?'lime':''}">${open?'HOLDER VERIFIED':'1 HSET / RH MAINNET'}</span></div><p>Keep up to ${SCENARIO_LIMIT} named scenarios and compare their modeled outcomes. Hold at least 1 HSET in the connected wallet. Tokens stay in your wallet.</p><div class="stress-holder-actions">${btn(checking?'READING HSET BALANCE…':connected?'CHECK HSET BALANCE':'CONNECT WALLET',connected?'stress-check-holder':'stress-connect','', '',checking)}${connected&&state.chain!==4663?btn('SWITCH TO RH MAINNET','stress-switch',''):''}${proof&&proof.account===state.account?.toLowerCase()&&state.chain===4663?`<span>${units(proof.balance,18,4)} HSET · ${open?'access checked':'balance read'} at block ${proof.block.toLocaleString('en-US')}${proof.balance<10n**18n?' · less than 1 HSET':!open?' · check again to refresh access':''}</span>`:''}</div>${holderError?`<p class="form-error" role="alert">${esc(holderError)}</p>`:''}<div class="stress-save"><label>Scenario name<input id="stress-name" aria-label="Scenario name" maxlength="40" value="${esc(current?.draft.label||'')}"></label>${btn('SAVE SCENARIO','stress-save','primary','',!open||checking||rows.length>=SCENARIO_LIMIT)}</div>${rows.length>=SCENARIO_LIMIT?'<p class="radar-note">Your library is full. Remove a scenario before adding another.</p>':''}${open?rows.length?`<div class="stress-saved-list"><h5>COMPARE SAVED SCENARIOS</h5><div class="stress-compare-scroll"><table><caption class="sr-only">Hypothetical starting amounts and outcomes for your saved scenarios</caption><thead><tr><th scope="col">Scenario / mix</th><th scope="col">Start</th><th scope="col">After shocks</th><th scope="col">Change</th><th scope="col">Actions</th></tr></thead><tbody>${rows.map(row=>{const r=stressScenario(row.mix,row.budget,row.shocks),same=r.key===current?.key;return `<tr><th scope="row">${esc(row.label)}<small>${esc(row.mix.name)}</small></th><td>${usd(r.startCents)}</td><td>${usd(r.endCents)}</td><td class="${tone(r.changeCents)}">${pct(r.returnBps)}<small>${usd(r.changeCents)}</small></td><td>${btn('USE SHOCKS','stress-use','text-btn',`data-id="${row.id}"`,!same)}${btn('REMOVE','stress-remove','text-btn',`data-id="${row.id}"`)}</td></tr>`;}).join('')}</tbody></table></div><p class="radar-note">Use shocks applies to the same assets and starting weights. Other saved mixes remain comparable in this table.</p></div>`:'<p class="stress-library-empty">Your first saved scenario will appear here. Change the shocks and save another to compare.</p>':`<p class="stress-library-empty">${connected?'Check the connected wallet’s HSET balance to open the library.':'Connect your own wallet to check holder access.'} The interactive stress test above is available to everyone.</p>`}<p class="radar-note">Library data stays in this browser, under the connected address. It is not encrypted or synced. A balance check sends no transaction or token approval. <a href="https://robinhoodchain.blockscout.com/token/${HSET_ADDRESS}" target="_blank" rel="noreferrer">HSET contract</a></p></section>`;
  }
  function renderPanel(theme,error=''){
    if(!theme){current=null;return `<div class="stress-empty"><h4>FINISH THE MIX FIRST.</h4><p>${esc(error||'Positive weights must total exactly 100%.')}</p></div>`;}
    const c=config(theme);current={...c,theme};let r,problem='';try{r=result();}catch(e){problem=e.message;}
    const b=c.baseline;
    return `<section class="stress-lab" aria-label="Basket stress test"><div class="stress-intro"><small>STARTING-WEIGHT SCENARIO</small><h4>WHAT IF THE MIX MOVES?</h4><p>Change component prices and see their contribution to a hypothetical basket outcome.</p></div><div class="stress-concentration"><div><span>Largest starting weight</span><b>${b.largest.weightBps/100}% <em>${b.largest.symbol}</em></b></div><div><span>Top ${Math.min(3,b.rows.length)} combined</span><b>${b.top3Bps/100}%</b></div><div><span>Effective token count</span><b>${b.effectiveCount.toFixed(2)}</b></div></div><p class="radar-note stress-concentration-note">Effective count = 1 / sum of squared token weights. Equal token weights give the actual component count. Correlation and ETF underlying overlap are not measured.</p><div class="stress-budget-row"><label>Hypothetical amount / USD<input id="stress-budget" aria-label="Stress test hypothetical amount" inputmode="decimal" autocomplete="off" maxlength="16" value="${esc(c.draft.budget)}"></label><div class="stress-presets" role="group" aria-label="Stress test presets">${btn('LARGEST −20%','stress-largest','')}${btn('ALL −10%','stress-all','')}${btn('RESET TO FLAT','stress-flat','')}</div></div><div class="stress-results">${resultsHTML(r,problem)}</div><div class="stress-inputs" role="group" aria-label="Component price scenarios"><div class="stress-input-head"><span>Stock Token / weight</span><span>Price change %</span><span>Contribution / USD</span></div>${b.rows.map(x=>{const row=r?.rows.find(row=>row.symbol===x.symbol);return `<div class="stress-row"><span><b>${x.symbol}</b><small>${x.weightBps/100}% starting weight</small></span><label><span class="sr-only">${x.symbol} price change percent</span><input data-stress-symbol="${x.symbol}" aria-label="${x.symbol} price change percent" inputmode="decimal" autocomplete="off" maxlength="10" value="${esc(c.draft.shocks[x.symbol])}"></label><strong data-stress-contribution="${x.symbol}" class="${row?tone(row.changeCents):''}">${row?usd(row.changeCents):'—'}</strong></div>`;}).join('')}</div><p class="radar-note">Hypothetical price shocks applied to starting weights, with token units held fixed. Unchanged inputs stay flat. Values use cent-rounded allocations and component changes. This is not a forecast, probability, maximum loss or live vault valuation; costs and ETF look-through are excluded. No funds are spent.</p>${calcError?`<p class="form-error" role="alert">${esc(calcError)}</p>`:''}${library()}</section>`;
  }
  function input(el){
    if(!current||!(el.id==='stress-budget'||el.id==='stress-name'||el.dataset.stressSymbol))return false;
    if(el.id==='stress-name')current.draft.label=el.value;
    else if(el.id==='stress-budget')current.draft.budget=el.value;
    else if(current.theme.assets.includes(el.dataset.stressSymbol)){current.draft.shocks[el.dataset.stressSymbol]=el.value;if(['Largest component -20%','All components -10%','All components flat'].includes(current.draft.label)){current.draft.label='Custom scenario';const name=document.querySelector('#stress-name');if(name)name.value=current.draft.label;}}
    remember();calcError='';if(el.id==='stress-name')return true;
    let r,error='';try{r=result();}catch(e){error=e.message;}
    const root=document.querySelector('.stress-results');if(root)root.innerHTML=resultsHTML(r,error);
    for(const el of document.querySelectorAll('[data-stress-contribution]')){const row=r?.rows.find(r=>r.symbol===el.dataset.stressContribution);el.textContent=row?usd(row.changeCents):'—';el.className=row?tone(row.changeCents):'';}
    return true;
  }
  async function check(){
    if(!state.account)throw Error('Connect your own wallet to check HSET access.');
    if(state.chain!==4663)throw Error('Switch the wallet to Robinhood Chain mainnet first.');
    const account=state.account,session=state.session;proof=null;holderError='';checking=true;render();
    try{const next=await readHsetHolder(d.reader(),account);if(state.account!==account||state.session!==session||state.chain!==4663)throw Error('Wallet changed during the HSET check. Check again.');proof={...next,session};if(!access())holderError='This wallet holds less than 1 HSET. The stress test remains available.';}
    catch(e){holderError=String(e.message).slice(0,240);throw e;}finally{checking=false;render();}
  }
  async function action(action,el){
    calcError='';
    try{
      if(action==='stress-connect'){d.connect();return;}
      if(action==='stress-switch'){await d.switchNetwork();return;}
      if(action==='stress-check-holder'){await check();return;}
      if(!current)throw Error('Choose a valid mix first.');
      if(['stress-largest','stress-all','stress-flat'].includes(action)){
        current.draft.shocks=Object.fromEntries(current.theme.assets.map(s=>[s,action==='stress-all'?'-10':'0']));
        if(action==='stress-largest')current.draft.shocks[current.baseline.largest.symbol]='-20';
        current.draft.label=action==='stress-largest'?'Largest component -20%':action==='stress-all'?'All components -10%':'All components flat';remember();
      }else if(action==='stress-save'){
        result();const mix=structuredClone(current.theme),draft=structuredClone(current.draft),account=state.account;
        if(!access())throw Error('Check a connected wallet holding at least 1 HSET first.');
        await check();if(!access()||account!==state.account)throw Error('Fresh HSET holder access is required to save.');
        const rows=records();if(rows.length>=SCENARIO_LIMIT)throw Error('Remove one scenario before saving another.');
        const record=scenarioRecord(mix,draft.budget,draft.shocks,draft.label);
        persistRows(account,[...rows,record]);notify('Scenario saved in this browser. No tokens moved.');
      }else if(action==='stress-remove'){
        if(!state.account)throw Error('Connect the wallet that owns this local library.');
        persistRows(state.account,records().filter(row=>row.id!==el.dataset.id));
      }else if(action==='stress-use'){
        if(!access())throw Error('Refresh the HSET balance check before using saved scenarios.');
        const row=records().find(row=>row.id===el.dataset.id);if(!row||stressScenario(row.mix,row.budget,row.shocks).key!==current.key)throw Error('Choose the same assets and starting weights to use these shocks.');
        Object.assign(current.draft,{budget:row.budget,shocks:structuredClone(row.shocks),label:row.label});remember();
      }
    }catch(e){calcError=String(e.message).slice(0,240);}
    render();
  }
  return {render:renderPanel,input,action};
}
