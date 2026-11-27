import { ALLOWED } from '../worker/assets.js';
import { validateMix } from './basket-radar.js';

// This format encrypts basket drafts, never wallet data or onchain transactions.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ITERATIONS = 600000;
const MAX_PLAINTEXT = 4096;
const MAX_TOKEN = 9000;
const AAD = encoder.encode('hoodset:draft:v1:PBKDF2-SHA256:600000:AES-256-GCM:4663');
const envelopeKeys = ['type','version','kdf','iterations','salt','iv','ciphertext'];
const draftKeys = ['kind','version','chainId','name','symbol','thesis','maxSupply','assets'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function exactKeys(x, required, optional = []) {
  if (!object(x) || required.some(k => !Object.hasOwn(x,k)) || Object.keys(x).some(k => !required.includes(k) && !optional.includes(k))) throw Error('Unsupported draft format.');
}
function text(x, label, max) {
  if (typeof x !== 'string' || !x.trim() || x.isWellFormed?.() === false || encoder.encode(x).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x)) throw Error(`${label} is missing or too long (${max} UTF-8 bytes maximum).`);
  return x.trim();
}
export function validateSharedDraft(value) {
  exactKeys(value,draftKeys,['budgetUSDG']);
  if (value.kind !== 'hoodset-basket-draft' || value.version !== 1 || value.chainId !== 4663) throw Error('This draft is not for Robinhood Chain mainnet.');
  const name = text(value.name,'Basket name',48), thesis = text(value.thesis,'Thesis',280);
  if (typeof value.symbol !== 'string' || !/^[A-Z][A-Z0-9]{1,7}$/.test(value.symbol)) throw Error('Share symbol must be 2–8 uppercase letters or numbers, starting with a letter.');
  if (typeof value.maxSupply !== 'string' || !/^[1-9]\d{0,6}$/.test(value.maxSupply) || BigInt(value.maxSupply) > 1000000n) throw Error('Maximum supply must be 1–1,000,000 whole shares.');
  if (!Array.isArray(value.assets) || value.assets.length < 2 || value.assets.length > 12) throw Error('Choose 2–12 supported Stock Tokens.');
  const assets = value.assets.map(a => {
    exactKeys(a,['symbol','weight']);
    if (typeof a.symbol !== 'string' || !Object.hasOwn(ALLOWED,a.symbol) || typeof a.weight !== 'string' || a.weight.length > 6 || !/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(a.weight)) throw Error('Use supported Stock Tokens and weights with at most two decimal places.');
    return {symbol:a.symbol,weight:a.weight};
  });
  validateMix(assets);
  const result = {kind:'hoodset-basket-draft',version:1,chainId:4663,name,symbol:value.symbol,thesis,maxSupply:value.maxSupply,assets};
  if (Object.hasOwn(value,'budgetUSDG')) {
    if (typeof value.budgetUSDG !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value.budgetUSDG) || Number(value.budgetUSDG) <= 0 || Number(value.budgetUSDG) > 1000000) throw Error('Planned budget must be above 0 and at most 1,000,000 USDG, with at most 6 decimals.');
    result.budgetUSDG = value.budgetUSDG;
  }
  if (encoder.encode(JSON.stringify(result)).length > MAX_PLAINTEXT) throw Error('This draft is too large to share.');
  return result;
}
// Explicit allowlist: nothing from the wallet, recovery ledger or browser address book is exported.
export function draftForSharing(draft) {
  const result = {kind:'hoodset-basket-draft',version:1,chainId:4663,name:draft.name,symbol:draft.symbol,thesis:draft.thesis,maxSupply:draft.maxSupply,assets:draft.assets?.map(a => ({symbol:a.symbol,weight:String(a.weight)}))};
  if (draft.budgetUSDG !== undefined) result.budgetUSDG = draft.budgetUSDG;
  return validateSharedDraft(result);
}
export function draftForBuilder(shared) {
  const d = validateSharedDraft(shared);
  const result = {name:d.name,symbol:d.symbol,thesis:d.thesis,maxSupply:d.maxSupply,assets:d.assets.map(a => ({...a}))};
  if (d.budgetUSDG !== undefined) result.budgetUSDG = d.budgetUSDG;
  return result;
}
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value, max) {
  if (typeof value !== 'string' || !value.length || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw Error('Invalid encrypted draft link.');
  const bytes = Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if (encode(bytes) !== value) throw Error('Invalid encrypted draft link.');
  return bytes;
}
export function inspectEncryptedDraft(token) {
  try {
    const raw = decoder.decode(decode(token,MAX_TOKEN)), value = JSON.parse(raw);
    exactKeys(value,envelopeKeys);
    if (JSON.stringify(value) !== raw || value.type !== 'hoodset-encrypted-draft' || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS) throw Error();
    const salt=decode(value.salt,24),iv=decode(value.iv,16),ciphertext=decode(value.ciphertext,5500);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > MAX_PLAINTEXT+16) throw Error();
    return {salt,iv,ciphertext};
  } catch { throw Error('Invalid or unsupported encrypted draft link. Ask the sender for a new link.'); }
}
export function passwordBytes(password) {
  if (typeof password !== 'string' || password.isWellFormed?.() === false || [...password].length < 12 || encoder.encode(password).length > 1024) throw Error('Use a unique password of at least 12 characters (maximum 1,024 UTF-8 bytes).');
  return encoder.encode(password);
}
function cryptoAPI() {
  if (!globalThis.crypto?.subtle) throw Error('Encrypted drafts need HTTPS and a browser with Web Crypto support.');
  return globalThis.crypto;
}
async function keyFor(password,salt,usage) {
  const bytes=passwordBytes(password),api=cryptoAPI();
  try {
    const material=await api.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);
    return await api.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},material,{name:'AES-GCM',length:256},false,[usage]);
  } finally { bytes.fill(0); }
}
export async function encryptDraft(draft,password) {
  const value=validateSharedDraft(draft),api=cryptoAPI(),salt=api.getRandomValues(new Uint8Array(16)),iv=api.getRandomValues(new Uint8Array(12));
  const key=await keyFor(password,salt,'encrypt'),plain=encoder.encode(JSON.stringify(value));
  try {
    const ciphertext=new Uint8Array(await api.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,plain));
    return encode(encoder.encode(JSON.stringify({type:'hoodset-encrypted-draft',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:encode(salt),iv:encode(iv),ciphertext:encode(ciphertext)})));
  } finally { plain.fill(0); }
}
export async function decryptDraft(token,password) {
  const {salt,iv,ciphertext}=inspectEncryptedDraft(token),key=await keyFor(password,salt,'decrypt');
  let plain;
  try {
    plain=new Uint8Array(await cryptoAPI().subtle.decrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,ciphertext));
    const raw=decoder.decode(plain),value=JSON.parse(raw);
    if (JSON.stringify(value) !== raw) throw Error();
    return validateSharedDraft(value);
  } catch { throw Error('Could not unlock this draft. Check the password and link.'); }
  finally { plain?.fill(0); }
}
