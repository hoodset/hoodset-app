# Community baskets and Copy mix

[Community baskets](https://hoodset.space/#catalogue) is a shared, persistent catalogue of explicitly listed Robinhood Chain vaults. It is separate from reference allocation templates and from the private-to-this-browser vault address book. It is an opt-in address registry, not a complete chain-wide index of all contract deployments.

Anyone can submit a public vault address without connecting a wallet. The server checks chain 4663, the exact pinned HOODSET vault runtime, creator and metadata bounds, the canonical 2–12 component set, original quantities and positive starting weights totalling 100%. A single concrete block is used for all vault-state, reserve and component-balance calls. Token balances minus reserves must equal the reported active balances. Matching bytecode is not an independent security audit, a verified creator identity, an endorsement or proof that the assets can be sold at the displayed value. Creator-supplied names are not editorial theme classifications.

Only the address is submitted. Basket names, symbols, theses, creator addresses, quantities and supply are read from the contract, never accepted from the submitting client. An invalid contract is rejected before persistence. Repeated submission refreshes its read without creating another listing or resetting the first listing time. A failed chain read remains visibly unavailable in the list and in its counts. There is no synthetic bootstrap basket or fabricated funded position.

## Copy semantics

- **Starting weights** copy the immutable initial basis-point weights and supported assets. This works for an empty or fully redeemed vault without price marks.
- **Current weights** use the current active component balances, excluding segregated reserves, valued with complete fresh multiplier-adjusted Stock Token marks. Largest-remainder rounding makes the copied basis-point weights total exactly 100%. All 2–12 components are preserved. An unavailable/stale component, zero issued supply, missing active backing or a component rounded below 0.01% stops current copying. The UI never silently drops a component or substitutes starting weights.
- Every copy first fetches a fresh verified vault snapshot. Current copying also refreshes every required token mark. A new draft is created with an editable copy name/symbol, the source thesis, a default supply cap of 100, and the selected composition. The source vault address, creator, selected basis and block are shown as provenance. UTF-8 metadata limits and builder weight validation still apply.
- Copying transfers no capital, shares, permissions, token quantities per share or performance record. New quantities are calculated from fresh marks when reviewing a new deployment. Nothing connects a wallet, signs or buys as a side effect of copying. The previous builder draft is saved locally with a restore control. Changing drafts and wallet actions remain explicit.
- Copying or publishing a vault does not publish any Encrypted Draft. Encrypted draft links and passwords are not submitted to the catalogue backend.

## Display and pagination

The catalogue distinguishes issued shares from no issued shares. Empty vaults remain real deployments; no reference NAV/share is shown for zero supply. Active token value and reference NAV require every fresh component mark. Missing values stay missing and sort last. Reference value is not a swap quote, realised return, cost basis or vault performance. Actual backing can differ from initial quantities through donations, rounding or reserves.

Eight addresses are read per page, in bounded batches of three. Sorting and search apply to the loaded entries and are labelled accordingly. Unreadable entries remain explicit. Snapshot caching is recomputable and limited to 45 seconds for normal list reads; copying uses an uncached direct read. The browser stops using an expired snapshot for copying. The registry is capped at 1,000 entries. Onchain inspection and withdrawal are independent of catalogue availability.

## Persistence and hosting

The user-facing site remains on Vercel. `api/catalogue.js` proxies only to the existing HOODSET-owned Sites origin's `/api/catalogue` route, which stores verified address records in HOODSET's existing Cloudflare D1 binding `HISTORY_DB`. A separate `vault_catalogue` table is added by a schema-only Drizzle migration. Existing historical price tables are untouched. Cloudflare uses `CATALOGUE_RPC_URL=https://www.hoodset.space/api/rpc`, the existing read-only Vercel gateway, because direct public RPC requests from the Worker were refused. The gateway accepts only the existing bounded read-method allowlist; no transaction forwarding is enabled. No new provider account, private key or transaction permission is required. A Vercel Blob creation attempt was refused by the account's storage usage limit; no Blob store was created and no quota bypass was attempted.

The persistence adapter is separate from chain validation and can be replaced by PostgreSQL (for example on Railway) without changing runtime verification or copy calculations. D1 stores only public onchain snapshots and first-listing timestamps. It does not hold wallet credentials, passwords, encrypted drafts, browser activity, private preferences or custody assets.

Writes accept at most 160 bytes and exactly one address field. Calls are bounded, timed out, runtime-checked and read-only at the RPC layer. Same-origin browser writes are required; catalogue POST rate limiting is best-effort per Worker instance (12/minute), not a distributed abuse-prevention guarantee. Public canonical deployments can be listed by someone other than their creator. The cap and exact-code requirement bound arbitrary-content storage, but this small registry is not a complete moderation or spam prevention system.

## Verification

Unit checks cover the bytecode pin, same-block reads, wrong networks/contracts, reserve reconciliation, serialized snapshot validation, RPC batching/errors, persistent/idempotent storage, stale/unreadable records, empty states, pagination, input/origin limits, fixed proxy destination, current-weight calculations and rounding, stale/missing marks, zero supply, tiny components, UTF-8 copy limits, escaping and explicit read-only copying. Browser QA covers the real existing vault, duplicate/invalid submissions, starting mix → builder → restore, filters, and mobile width. No test buys, sells, signs or deploys a vault.
