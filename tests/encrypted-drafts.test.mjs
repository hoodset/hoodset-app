import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {draftForSharing,draftForBuilder,validateSharedDraft,encryptDraft,decryptDraft,inspectEncryptedDraft,passwordBytes} from '../client/encrypted-drafts.js';
import {createEncryptedDrafts,isEncryptedRoute} from '../client/encrypted-drafts-ui.js';

// Public synthetic fixture, not a credential or an investment recommendation.
const password='hoodset-public-qa-passphrase';
const builder={name:'QA Compute',symbol:'QASET',thesis:'A public synthetic draft for testing encrypted links.',maxSupply:'100',assets:[{symbol:'NVDA',weight:'40'},{symbol:'AMD',weight:'35'},{symbol:'AVGO',weight:'25'}],budgetUSDG:'10.123456'};
const draft=draftForSharing(builder);
const b64=x=>Buffer.from(x).toString('base64url');
const unpack=x=>JSON.parse(Buffer.from(x,'base64url').toString('utf8'));
const pack=x=>b64(JSON.stringify(x));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function sealUnchecked(value,pass=password) {
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  const derived=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},key,{name:'AES-GCM',length:256},false,['encrypt']);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128,additionalData:new TextEncoder().encode('hoodset:draft:v1:PBKDF2-SHA256:600000:AES-256-GCM:4663')},derived,new TextEncoder().encode(JSON.stringify(value)));
  return pack({type:'hoodset-encrypted-draft',version:1,kdf:'PBKDF2-SHA256',iterations:600000,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)});
}

test('encrypted links round trip a complete draft including fractional budget',async()=>{
  const token=await encryptDraft(draft,password);
  assert.deepEqual(await decryptDraft(token,password),draft);
  assert.deepEqual(draftForBuilder(await decryptDraft(token,password)),builder);
  assert.equal(token.includes(password),false);
  const envelope=Buffer.from(token,'base64url').toString('utf8');
  for(const secret of [password,builder.name,builder.thesis,'NVDA','10.123456']) assert.equal(envelope.includes(secret),false);
});
test('each encryption uses independent random salt and IV',async()=>{
  const a=unpack(await encryptDraft(draft,password)),b=unpack(await encryptDraft(draft,password));
  assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
});
test('wrong password and authenticated payload tampering fail closed',async()=>{
  const token=await encryptDraft(draft,password);
  await assert.rejects(decryptDraft(token,'a-different-qa-password'),/Could not unlock/);
  for(const field of ['salt','iv','ciphertext']){
    const v=unpack(token),bytes=Buffer.from(v[field],'base64url');bytes[0]^=1;v[field]=bytes.toString('base64url');
    await assert.rejects(decryptDraft(pack(v),password),/Could not unlock/);
  }
});
test('link parser bounds input and rejects noncanonical or unsupported formats before key derivation',async()=>{
  const v=unpack(await encryptDraft(draft,password));
  for(const patch of [{version:2},{iterations:1},{iterations:999999999},{kdf:'custom'},{password:'x'},{iv:'AA'},{salt:'AA'},{ciphertext:'AA'}])assert.throws(()=>inspectEncryptedDraft(pack({...v,...patch})),/Invalid or unsupported/);
  for(const token of ['', 'A'.repeat(9001),'bad%2Fdata','AAAA=',b64('{"version":1,"version":1}')])assert.throws(()=>inspectEncryptedDraft(token),/Invalid or unsupported/);
  assert.throws(()=>inspectEncryptedDraft(b64(JSON.stringify(v,null,2))),/Invalid or unsupported/);
  assert.throws(()=>inspectEncryptedDraft(b64(JSON.stringify(v).replace('"version":1','"version":1,"version":1'))),/Invalid or unsupported/);
});
test('draft schema rejects invalid allocations, asset injection and bounds',()=>{
  const patches=[{chainId:46630},{version:2},{kind:'wallet'},{name:''},{name:'🙂'.repeat(13)},{symbol:'1BAD'},{thesis:'x'.repeat(281)},{maxSupply:'0'},{maxSupply:'1.5'},{maxSupply:'1000001'},{budgetUSDG:'0'},{budgetUSDG:'1000000.000001'},{budgetUSDG:'1.0000001'},{assets:[{symbol:'NVDA',weight:'99'}]},{assets:[{symbol:'NVDA',weight:'50'},{symbol:'NVDA',weight:'50'}]},{assets:[{symbol:'NVDA',weight:'50'},{symbol:'NOT_REAL',weight:'50'}]},{assets:[{symbol:'NVDA',weight:'50'},{symbol:'AMD',weight:'49.99'}]},{assets:[{symbol:'NVDA',weight:'100'},{symbol:'AMD',weight:'0'}]},{assets:[{symbol:'NVDA',weight:'50.001'},{symbol:'AMD',weight:'49.999'}]},{assets:[{symbol:'NVDA',weight:'50',address:'0x0'},{symbol:'AMD',weight:'50'}]}];
  for(const patch of patches)assert.throws(()=>validateSharedDraft({...draft,...patch}),JSON.stringify(patch));
  assert.throws(()=>validateSharedDraft({...draft,wallet:'private'}));
  assert.throws(()=>validateSharedDraft({...draft,assets:Array.from({length:13},()=>({symbol:'NVDA',weight:'1'}))}));
});
test('schema is revalidated after authenticated decryption',async()=>{
  for(const patch of [{chainId:1},{assets:[{symbol:'EVIL',weight:'50'},{symbol:'AMD',weight:'50'}]},{wallet:'should-never-import'}]){
    await assert.rejects(decryptDraft(await sealUnchecked({...draft,...patch}),password),/Could not unlock/);
  }
});
test('sharing exports only allowed draft fields; imports return detached plain builder data',()=>{
  const exported=draftForSharing({...builder,wallet:'secret',activity:[{hash:'private'}],vaults:['private'],recovery:{private:true}});
  assert.deepEqual(exported,draft);
  const imported=draftForBuilder(exported);imported.assets[0].weight='1';
  assert.equal(exported.assets[0].weight,'40');
  assert.equal('kind' in imported,false);
});
test('password rules preserve whitespace and bound Unicode input',()=>{
  assert.throws(()=>passwordBytes('short'),/at least 12/);
  assert.throws(()=>passwordBytes('🙂'.repeat(257)),/1,024/);
  assert.equal(new TextDecoder().decode(passwordBytes('  a long QA passphrase  ')),'  a long QA passphrase  ');
});

function controller(data=builder) {
  const imports=[],notices=[];
  const ui=createEncryptedDrafts({esc,btn:(label,action)=>`<button data-action="${action}">${label}</button>`,heading:(title,p)=>`<h1>${title}</h1><p>${p}</p>`,getDraft:()=>data,applyDraft:d=>imports.push(d),go:()=>{},render:()=>{},notify:t=>notices.push(t),origin:()=> 'https://hoodset.space'});
  return {ui,imports,notices};
}
function form(id,pass=password,confirm=pass){const inputs=[{value:pass},{value:confirm}];return {id,elements:{password:inputs[0],confirm:inputs[1]},querySelectorAll:()=>inputs};}
test('locked preview reveals no composition and persists nothing until explicit import',async()=>{
  const token=await encryptDraft(draft,password),route='draft/'+token,{ui,imports}=controller();
  let html=ui.page(route);assert.equal(html.includes(builder.name),false);assert.equal(html.includes('NVDA'),false);
  const f=form('encrypted-open');await ui.submit(f);assert.equal(f.elements.password.value,'');
  html=ui.page(route);assert.ok(html.includes(builder.name));assert.equal(imports.length,0);
  await ui.action('draft-import');assert.deepEqual(imports,[builder]);
  assert.equal(ui.page(route).includes(builder.name),false);
});
test('UI handles wrong password, mismatched confirmation and cancelled async work',async()=>{
  const token=await encryptDraft(draft,password),route='draft/'+token,{ui,imports}=controller();
  ui.page(route);await ui.submit(form('encrypted-open','wrong-qa-password'));
  assert.ok(ui.page(route).includes('Could not unlock'));assert.equal(imports.length,0);
  const pending=ui.submit(form('encrypted-open'));ui.leave();await pending;
  assert.equal(ui.page(route).includes(builder.name),false);
  ui.page('encrypted');await ui.submit(form('encrypted-create',password,'another-password'));
  assert.ok(ui.page('encrypted').includes('passwords do not match'));
});
test('link creation and lock/discard keep all sensitive values out of UI password attributes',async()=>{
  const {ui}=controller();ui.page('encrypted');const f=form('encrypted-create');await ui.submit(f);
  let html=ui.page('encrypted');assert.ok(html.includes('https://hoodset.space/#draft/'));assert.equal(html.includes(password),false);assert.equal(f.elements.confirm.value,'');
  await ui.action('draft-discard');assert.equal(ui.page('encrypted').includes('https://hoodset.space/#draft/'),false);
});
test('draft HTML is escaped and invalid links do not offer unlock',async()=>{
  const unsafe={...builder,name:'<img src=x onerror=alert(1)>',thesis:'<script>window.bad=true</script>'};
  const {ui}=controller(unsafe);let html=ui.page('encrypted');assert.ok(html.includes('&lt;script&gt;'));assert.equal(html.includes('<script>window.bad'),false);
  html=ui.page('draft/not-a-valid-envelope');assert.ok(html.includes('Invalid or unsupported'));assert.equal(html.includes('id="draft-password"'),false);
  assert.equal(isEncryptedRoute('draft/example'),true);assert.equal(isEncryptedRoute('encrypted'),true);assert.equal(isEncryptedRoute('community'),false);
});
test('private routes defer automatic wallet restore and public data; no server endpoint is used for drafts',async()=>{
  const live=await readFile(new URL('../client/live.js',import.meta.url),'utf8');
  assert.match(live,/async function restoreWallet\(\)\{if\(isEncryptedRoute\(route\(\)\)/);
  assert.match(live,/function startPublicData\(\)\{if\(isEncryptedRoute\(route\(\)\)\)return/);
  for(const name of ['encrypted-drafts.js','encrypted-drafts-ui.js']){
    const source=await readFile(new URL('../client/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bfetch\s*\(|localStorage|sessionStorage|sendTransaction|eth_requestAccounts/);
  }
});
