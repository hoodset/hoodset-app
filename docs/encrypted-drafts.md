# Encrypted Drafts

Open [Encrypted Drafts](https://hoodset.space/#encrypted) from the sidebar or use **Share encrypted draft** in the basket builder. Finish a valid 2–12 asset composition first. Create and confirm a unique passphrase of at least 12 characters, copy the link, and send the password separately.

The recipient opens the link, enters the password and reviews the decrypted composition in memory. **Use in builder** explicitly saves an unencrypted copy in that browser's working draft. The previous builder draft is kept locally and can be restored. Importing never connects a wallet, approves tokens, deploys a vault or places an order. Fresh asset eligibility, prices and transaction checks still apply when deployment is reviewed. Reference quantities are not frozen by sharing a draft.

## Scope and limitations

- Only the shared draft payload is encrypted. Ordinary builder drafts, restored drafts, saved preferences and existing wallet progress remain unencrypted browser localStorage data. The encrypted link is held in the current page, not saved to a new server database. Copying, browser history, clipboard sync, backups and messaging services can retain the ciphertext.
- The password is not included in the link, persisted by HOODSET or sent to a draft endpoint. Password inputs are cleared when submitted. Derived keys are non-extractable; intermediate byte buffers are cleared where possible. JavaScript strings, browser memory and garbage collection cannot guarantee complete erasure.
- An unopened draft link defers automatic wallet restoration, public price/history loading and RPC polling. The page and its local assets still load normally; hosting sees IP addresses and normal request metadata. Existing requests started on other workspace pages can finish after navigation.
- Anyone with the link and password can decrypt. An attacker with the link can make offline password guesses. Use a long, unique, unpredictable passphrase. Do not reuse a wallet, exchange or account password. There is no password recovery, expiry, password change or revocation for already copied links. Discarding a link only removes it from the current page.
- Website JavaScript, malicious browser extensions, a compromised device, screen capture and anyone present after unlocking can access plaintext. This is not a defence against a malicious/compromised origin, nor anonymous trading, an encrypted wallet or a zero-knowledge system. The implementation has not received an independent security audit.
- Publishing a vault makes its composition and metadata public. Backing, wallet addresses, balances and transactions on Robinhood Chain remain public. Encrypted Drafts do not change any contracts, Stock Token restrictions, existing transaction paths or the role of $HSET.

## Version 1 wire format

The link is `https://hoodset.space/#draft/<base64url-envelope>`. URI fragments are [not part of the HTTP request](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment). The password is never part of the URL. No draft-sharing API or provider is required.

The envelope is compact JSON, UTF-8 encoded, then unpadded base64url encoded:

```json
{"type":"hoodset-encrypted-draft","version":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"<16 random bytes, base64url>","iv":"<12 random bytes, base64url>","ciphertext":"<AES-GCM ciphertext and 16-byte tag, base64url>"}
```

PBKDF2-HMAC-SHA256 (600,000 iterations) derives a non-extractable AES-256-GCM key from the exact UTF-8 password and fresh salt. GCM uses a fresh 96-bit IV and 128-bit tag. Additional authenticated data is the UTF-8 string `hoodset:draft:v1:PBKDF2-SHA256:600000:AES-256-GCM:4663`. Web Crypto supplies cryptography and secure randomness. See [MDN AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) and [OWASP PBKDF2 work factors](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). This choice uses native browser APIs; it does not imply certification.

The plaintext contains exactly `kind`, `version`, `chainId`, `name`, `symbol`, `thesis`, `maxSupply`, `assets`, and optionally `budgetUSDG`. It never exports wallet data, transaction recovery, vault address books or balances. `assets` contains only canonical supported symbols and decimal-string weights. The schema enforces mainnet 4663, 2–12 unique allowed assets, positive weights totalling 100% at basis-point precision, contract metadata limits, whole-share supply of 1–1,000,000, and bounded optional USDG budget. No contract address or external URL is imported.

Envelope size is bounded to 9,000 base64url characters, plaintext to 4,096 bytes, password to 1,024 UTF-8 bytes. Unknown fields, versions, algorithms, attacker-selected iteration counts, noncanonical encodings and malformed JSON are rejected before key derivation. Decryption authenticates before parsing, then revalidates the plaintext schema. Errors do not echo the password or plaintext. Rendered text is HTML escaped. Unlocked data is cleared from controller state when locked, imported, navigated away from or reloaded. Closing the tab does not remove browser history or external copies.

## Verification

`npm test` covers round trips, randomized salts/IVs, wrong passwords, ciphertext/IV/salt tampering, authenticated invalid plaintext, malformed and oversized links, unsupported KDF costs, metadata/assets/weights/supply/budget bounds, allowlisted export, escaped preview, explicit import, cleared password inputs and cancelled async operations. Browser checks exercise create → share → wrong password → unlock → preview → import, plus mobile layout. No financial transaction is needed for these checks.
