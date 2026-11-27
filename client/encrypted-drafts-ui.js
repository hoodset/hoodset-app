import {draftForSharing,draftForBuilder,encryptDraft,decryptDraft,inspectEncryptedDraft} from './encrypted-drafts.js';

export const isEncryptedRoute = route => route === 'encrypted' || route.startsWith('draft/');

export function createEncryptedDrafts({esc,btn,heading,getDraft,applyDraft,go,render,notify,origin}) {
  let current='',generation=0,busy=false,error='',link='',unlocked=null,invalid=false;
  const colors=['#dfff56','#a788da','#c0c9b7','#d7c7a9','#b4c4cc'];
  function reset(route='') { current=route;generation++;busy=false;error='';link='';unlocked=null;invalid=false; }
  function preview(d) {
    return `<section class="encrypted-composition"><div class="encrypted-identity"><span>${esc(d.symbol)}</span><h2>${esc(d.name)}</h2><p>${esc(d.thesis)}</p></div><div class="encrypted-allocation" aria-label="Starting allocation">${d.assets.map((a,i)=>`<span style="flex:${Number(a.weight)};background:${colors[i%colors.length]}" title="${esc(a.symbol)} ${esc(a.weight)}%"></span>`).join('')}</div><table><thead><tr><th>STOCK TOKEN</th><th>STARTING WEIGHT</th></tr></thead><tbody>${d.assets.map(a=>`<tr><td><img src="/assets/tokens/${esc(a.symbol)}.${a.symbol==='SPY'?'svg':'png'}" alt="" width="32" height="32">${esc(a.symbol)}</td><td>${esc(a.weight)}%</td></tr>`).join('')}</tbody><tfoot><tr><th>TOTAL</th><td>100%</td></tr></tfoot></table><div class="encrypted-cap"><span>Maximum supply</span><b>${esc(d.maxSupply)} shares</b></div>${d.budgetUSDG?`<div class="encrypted-cap"><span>Planned budget</span><b>${esc(d.budgetUSDG)} USDG</b></div>`:''}<p class="encrypted-caption">Starting weights only. Token quantities per share are calculated with fresh prices when you review deployment.</p></section>`;
  }
  function details() {
    return `<details class="encrypted-details"><summary>What this protects</summary><p>The basket name, thesis, assets, weights, supply cap and optional budget are encrypted inside the link’s URL fragment. The password stays in this browser and is not included in the link. No wallet or payment is needed to encrypt or open a draft.</p><p>Share the password separately. Anyone with both the link and password can unlock it. Links have no server expiry, password reset or revocation; use a strong unique passphrase. Encryption does not hide your IP or normal hosting requests.</p><p>Page code, browser extensions and anyone with access to an unlocked device may read a draft. Your working builder draft is stored unencrypted in this browser. Deployment publishes the vault’s composition; backing and transactions remain public.</p><p>AES-256-GCM, random salt and IV, PBKDF2-SHA256 with 600,000 iterations. This feature has not received an independent security audit. <a href="https://github.com/hoodset/hoodset-app/blob/main/docs/encrypted-drafts.md" target="_blank" rel="noreferrer">Read the format and threat model ↗</a></p></details>`;
  }
  function page(route) {
    if (route!==current) {
      reset(route);
      if (route.startsWith('draft/')) try { inspectEncryptedDraft(route.slice(6)); } catch(e) { error=e.message;invalid=true; }
    }
    const opening=route.startsWith('draft/');
    let d,validation='';
    if (!opening) try { d=draftForSharing(getDraft()); } catch(e) { validation=e.message; }
    const intro=heading(opening?'A SHARED<br>CONVICTION.':'KEEP YOUR NEXT<br>MOVE YOURS.',opening?'A basket draft, sealed with a password. Unlock it here before deciding what to build.':'Plan a basket. Share it with someone you choose. Publish the vault when you are ready.','ENCRYPTED DRAFTS / BEFORE THE CHAIN');
    const status=opening?(unlocked?'UNLOCKED / IN THIS TAB':'PASSWORD REQUIRED'):'YOUR CURRENT BUILDER DRAFT';
    let content;
    if (opening && unlocked) content=`<div class="encrypted-unlocked"><span class="encrypted-state">UNLOCKED LOCALLY</span><h2>YOUR MIX.<br>YOUR NEXT STEP.</h2><p>Review the draft, then open it in your builder. Nothing has been deployed or purchased.</p><p class="encrypted-boundary">Using this draft saves an <strong>unencrypted copy</strong> in this browser’s builder. Your previous builder draft is kept locally for restore.</p>${btn('USE IN BUILDER','draft-import','primary wide')}${btn('LOCK PREVIEW','draft-lock','wide')}<small>Import does not connect a wallet or send a transaction.</small></div>`;
    else if (opening) content=`<form id="encrypted-open" autocomplete="off"><span class="encrypted-state">ONLY THE LINK IS HERE</span><h2>BRING THE<br>PASSWORD.</h2><p>Ask the sender for the password through a separate channel.</p>${!invalid?`<label for="draft-password">Draft password</label><input id="draft-password" name="password" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required minlength="12" maxlength="1024" aria-describedby="draft-password-help"><small id="draft-password-help">Passwords are case sensitive. No password is stored.</small><div class="encrypted-error" role="alert">${esc(error)}</div><button class="btn primary wide" type="submit" ${busy?'disabled':''}>${busy?'UNLOCKING…':'UNLOCK DRAFT'}</button>`:`<div class="encrypted-error" role="alert">${esc(error)}</div><a class="btn wide" href="#encrypted">CREATE A NEW LINK</a>`}</form>`;
    else if (validation) content=`<div class="encrypted-incomplete"><span class="encrypted-state">FINISH THE COMPOSITION</span><h2>GIVE YOUR<br>IDEA A SHAPE.</h2><p>Complete the name, symbol and thesis. Choose 2–12 supported assets with positive weights totalling exactly 100%.</p><div class="encrypted-error" role="alert">${esc(validation)}</div><a class="btn primary wide" href="#community">OPEN BUILDER</a></div>`;
    else content=`<form id="encrypted-create" autocomplete="off"><span class="encrypted-state">ONE LINK. A SEPARATE PASSWORD.</span><h2>SHARE THE IDEA.<br>CHOOSE WHO SEES IT.</h2><label for="draft-password">Create a draft password</label><input id="draft-password" name="password" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" required minlength="12" maxlength="1024" aria-describedby="draft-password-help"><small id="draft-password-help">At least 12 characters. Use a unique, long passphrase.</small><label for="draft-confirm">Confirm password</label><input id="draft-confirm" name="confirm" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" required minlength="12" maxlength="1024"><div class="encrypted-error" role="alert">${esc(error)}</div><button class="btn primary wide" type="submit" ${busy?'disabled':''}>${busy?'ENCRYPTING…':link?'CREATE A NEW LINK':'CREATE ENCRYPTED LINK'}</button><p class="encrypted-boundary">Your working draft stays unencrypted in this browser. Only the shared link is encrypted.</p></form>${link?`<section class="encrypted-link-result" aria-live="polite"><span class="encrypted-state">READY TO SHARE</span><label for="encrypted-link">Encrypted draft link</label><textarea id="encrypted-link" readonly spellcheck="false" rows="3">${esc(link)}</textarea>${btn('COPY LINK','draft-copy','primary wide')}<p>Send the password separately. Keep it safe: HOODSET cannot recover it.</p>${btn('DISCARD THIS LINK','draft-discard','text-btn')}</section>`:''}`;
    return `<div class="encrypted-workspace">${intro}<div class="encrypted-process"><span>01 / Shape your basket</span><span class="${opening?'':'active'}">02 / Encrypt & share</span><span class="${opening?'active':''}">03 / Unlock & review</span></div><div class="encrypted-grid"><section class="panel encrypted-preview"><div class="encrypted-panel-label"><span>${status}</span>${!opening?'<a href="#community">Edit draft ↗</a>':''}</div>${opening?(unlocked?preview(unlocked):`<div class="encrypted-sealed" aria-label="Encrypted composition hidden"><div class="sealed-sheet"><div class="sealed-top"><span>HOODSET</span><span>PRIVATE DRAFT</span></div><div class="sealed-stripes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="sealed-bottom"><b>NOT PUBLIC.<br>NOT ONCHAIN.</b><span>•••• / ••••</span></div></div><p>The name, assets and weights stay hidden until you unlock this draft.</p></div>`):d?preview(d):`<div class="encrypted-sealed"><strong>YOUR NEXT SET.</strong><p>Finish your draft in the builder, then return here to encrypt a link.</p></div>`}</section><section class="panel encrypted-controls">${content}</section></div>${details()}<a class="encrypted-back" href="#community">← Back to the basket builder</a></div>`;
  }
  async function submit(form) {
    const password=form.elements.password?.value,confirmation=form.elements.confirm?.value;
    for (const input of form.querySelectorAll('input[type="password"]')) input.value='';
    if (busy) return;
    const id=++generation,route=current;busy=true;error='';render();
    try {
      if (form.id==='encrypted-create') {
        if (password!==confirmation) throw Error('The passwords do not match. Enter both again.');
        const token=await encryptDraft(draftForSharing(getDraft()),password);
        if (id!==generation || route!==current) return;
        link=origin()+'/#draft/'+token;
      } else {
        const result=await decryptDraft(route.slice(6),password);
        if (id!==generation || route!==current) return;
        unlocked=result;
      }
    } catch(e) { if (id===generation) error=e.message; }
    finally { if (id===generation) { busy=false;render(); } }
  }
  async function action(name) {
    if (name==='draft-share') { go('encrypted');return; }
    if (busy) return;
    if (name==='draft-copy' && link) {
      try { await navigator.clipboard.writeText(link);notify('Encrypted link copied. Send the password separately.'); }
      catch { const field=document.querySelector('#encrypted-link');field?.focus();field?.select();notify('Copy the selected link, then send the password separately.'); }
    }
    if (name==='draft-import' && unlocked) { const draft=draftForBuilder(unlocked);reset();applyDraft(draft);return; }
    if (name==='draft-lock') { unlocked=null;error='';generation++;render(); }
    if (name==='draft-discard') { link='';error='';generation++;render(); }
  }
  return {page,submit,action,leave:()=>reset()};
}
