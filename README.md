# HOODSET

## HSET Stock Rewards (2.20.0)

[Stock Rewards](https://www.hoodset.space/#rewards) adds an optional, separate HSET participation contract with independently claimable, actually funded canonical Stock Tokens. HSET principal has no minimum lock period; accrued rewards survive exit. Seven-day finite-funded cycles use time-weighted participation, queued top-ups and empty-period carry. No owner, upgrades, sweep, fixed APY or automatic claim on basket backing. Source, exact permissions, simulated wallet reviews and recoverable transaction intents are included. A null pool in `web/data/stock-rewards.json` means no official mainnet pool has been published; deployment and real funding require wallet confirmation. Direct contributions are not automatically described as protocol fees. [Accounting, source-of-funds and rollout details](docs/stock-rewards.md).

## HSET-funded API & MCP (2.19.0)

[API & MCP](https://www.hoodset.space/#agents) exposes six read-only tools for verified vault backing, actual observations, retrospective mix/SPY analysis, mix comparison and fresh RH reference spreads. Wallet-signed API keys share a persistent account ledger. The published package is 100,000 HSET for 1,000 successful requests, with no credit expiry. A payment is credited once after exact canonical-token/recipient/receipt checks and 20 RH block confirmations. No agent can sign trades or access encrypted drafts. Errors refund reserved credits; explicit idempotency keys replay successful requests without another charge for 24 hours. Free site features remain available. [Payment, billing, protocol and data details](docs/agent-api.md).

## Spreads and stock-token pairs (2.18.0)

[Spreads & execution](https://hoodset.space/#spreads) separates multiplier-adjusted RH reference bid/ask from independent OpenOcean buy/sell snapshots. Search and sort supported tokens, inspect a selected input amount, and calculate a complete starting-mix reference spread. [Pairs](https://hoodset.space/#pairs) adds aligned underlying daily-close ratios, return gaps, descriptive z-scores/correlation and a wallet-reviewed **spot exchange of already owned Stock Tokens**. It does not open borrowed or leveraged long/short positions. Exact allowances, fresh dual-token references, decoded routes, minimum output, simulation, expired-review refresh and a recoverable local transaction journal apply. [Definitions and execution boundaries](docs/spreads-pairs.md).

## Stress test and HSET holder library (2.17.0)

[Stress test](https://hoodset.space/#stress) models explicit component price shocks against a selected starting mix, with cent-reconciled contributions, concentration and effective token count. Interactive analysis is open to everyone. Holding at least 1 HSET in the connected RH mainnet wallet enables up to 12 browser-local saved scenarios and an outcome comparison table. The app verifies the pinned HSET contract and same-block balance without a transfer or approval. This is not background monitoring, a live-position risk estimate or server-enforced private storage. [Calculation and access details](docs/stress-test.md).

## Community baskets (2.16)

[The public vault catalogue](https://hoodset.space/#catalogue) lists real, runtime-checked RH mainnet vaults across browsers. Add a public address, inspect issued supply and active backing, and copy starting or freshly valued current weights into a new builder draft. Empty and unreadable vaults remain explicit. Copying transfers no assets or performance and requires no wallet. [Verification, copy semantics and persistent storage](docs/community-catalogue.md).

## Encrypted Drafts (2.15)

[Password-protected draft links](https://hoodset.space/#encrypted) encrypt the basket composition in the browser with AES-256-GCM and PBKDF2-SHA256. Recipients unlock, preview and explicitly import a draft; no wallet or transaction is needed. Only shared link payloads are encrypted. Local working drafts remain plaintext, and deployed vaults and transactions remain public. [Format, threat model and limitations](docs/encrypted-drafts.md).

## Current mainnet deployment

HOODSET is live at https://hoodset.space on Robinhood Chain mainnet (4663). Users define Stock Token baskets, inspect vault backing, fund and mint with USDG, and redeem and sell through wallet-confirmed batch execution. Initial token permissions are separate. Basket share tokens are separate from project token $HSET.

A funded mainnet round trip was completed and verified on 27 November 2026:

- Existing vault: `0x3153a84df153d29f78326e577fa00079083b943a` (legacy name AI & Chips Set, share symbol MYCHIP).
- Batch router: `0x256aa32b5d9c709e1588d21ff80a31b0f6446672`.
- [Buy and mint receipt](https://robinhoodchain.blockscout.com/tx/0x0f388f7b589ead2a674e2715db7f5f8fb281e133c593ddf037f735a51ccbafd7): existing NVDA from an earlier purchase plus six component buys, followed by minting 0.047872579605240611 MYCHIP.
- [Redeem and sell receipt](https://robinhoodchain.blockscout.com/tx/0x7c3c3753b5943dd5cb05fc2a96ebc71aa4b37a4ec3d3e7e32d0d25228856cd8e): all issued shares burned, seven redeemed components sold, 4.938350 USDG returned. Original test spend was 5 USDG; loose purchase refunds remained separately in the wallet and ETH gas was extra.

Matching settlement events, share mint/burn and component/USDG Transfer logs were checked. The test vault was empty after the full exit. This historical test does not establish liquidity for other baskets or amounts. Contracts have not received an independent audit.

Production no longer exposes the retired paper sandbox. Public allocation templates remain reference mixes until a user deploys and funds a vault.

## Clear positions and quote refresh (2.13)

Basket pages and portfolio disclosure show the Stock Token quantities and current weights represented by the connected wallet's exact share balance, using redemption rounding and active backing only. The one-full-share composition remains labelled separately. Loose wallet Stock Tokens, including mint refunds, are distinguished from vault-backed share positions. RH Stock Tokens represent economic exposure through RHJ-issued debt securities; basket shares do not confer direct shareholder rights.

Transaction reviews show expiry status, disable expired sends and offer an in-dialog refresh. Batch and single-token quotes fetch fresh routes/minimum outputs; stable requests are simulated again. Refresh never sends, refuses submitted requests, preserves account and pending-transaction guards, and requires a new wallet confirmation. Exact approval/deployment reviews have ten minutes; swap quote freshness limits are unchanged. Solidity contracts and runtime hashes are unchanged.

## Atomic basket execution (2.12)

The new HoodsetBasketRouter combines component purchases with minting into one transaction, and combines redemption with all component sales into one transaction. Initial exact USDG, contributed-token and share approvals remain separate. The current deployed vault runtime is pinned and unchanged; deployment of this helper is an explicit user-confirmed ETH gas transaction. The deployed helper address and completed test receipts are listed above. Import/deploy in the Batch view verifies the exact compiled runtime.

Interrupted individual purchases can migrate using their independently verified receipt ledger. The helper pulls only the remaining budget and previously acquired component quantities, then refunds unused assets. The old run is archived only after the batch mint receipt and all transfers verify. A failed swap, changed redemption quantity or unmet minimum reverts the execution; gas may still be charged. Prior donations to the helper are isolated and there is no owner, upgrade or sweep authority.

When OpenOcean omits pool price impact, the batch flow can check execution-value deviation against a fresh matching RH bid/ask instead, capped at 5% in either direction. This is explicitly labelled RH reference deviation, assumes USDG = USD1, and includes spread/fees; it is not asserted to be pool-only price impact. Missing/stale marks still block. Per-swap minimums, aggregate minimum shares/USDG, calldata validation and transaction simulation apply independently.

Local EVM tests cover a seven-component round trip, resumed inventory, 12-component baskets, rollback, min bounds, transfer/recipient violations, residual approvals, reserves, donations and reentrancy. These checks are separate from the funded mainnet receipts above and do not constitute an independent audit.

## Previous release: free history and Vercel (2.11)

The primary deployment now targets a separate HOODSET project on Vercel. Earlier version sections below are a historical changelog; their Twelve Data and Sites setup instructions are superseded by this release. `npm run build:vercel` builds the same wallet interface into static CDN assets and Node.js API functions. Root HTML metadata follows the current host. Deploy from an explicitly linked HOODSET checkout; do not reuse another project's `.vercel` configuration. `RH_RPC_URL` is optional; the market-data integration needs no API key.

`/api/history` uses the public `post-no-preference/stocks` DoltHub dataset, published under CC BY-SA 4.0. It contains dated daily US stock and ETF prices and separate split factors. The 17-instrument release includes a real verified bootstrap (283 daily closes per symbol, through November 25, 2026), not simulated bars. A shared regional Vercel Runtime Cache refreshes in bounded date batches after six hours of use. It is evictable and is used only for recomputable public history. An optional D1 adapter remains for local/Sites previews; no D1 or provider credentials are required by Vercel.

Source dates are queried at a verified Dolt commit. The price API rejects truncated SQL responses, altered identity, duplicate/invalid prices, unknown splits and changed license text. Data for each queried date replaces old rows, including a successful empty correction. Date-level revision provenance remains available in the response. If refresh fails, the last dated source remains explicit; the existing common-calendar rules leave stale or incomplete annual periods unranked. No Twelve Data payload or key is used by the active route. The guarded older adapter remains regression coverage only.

Raw closes are adjusted once by published `for_factor / to_factor` for splits after each bar. Cash dividends, gas, fees and RH multiplier effects are excluded. This is retrospective underlying-price return for today's mix, not an issued vault's past performance. Fixed quantities per share, executable quotes, approvals and wallet transaction checks are unchanged.

Data, normalized history and adaptations remain CC BY-SA 4.0. Attribution, license, change notices and the source are linked near the charts and in Data & network. See `web/data/stock-history-source.json` and `web/data/LICENSE-stock-history.txt`. The upstream data is community-maintained, provided as is, and does not imply endorsement or an independently verified exchange data license chain.

Sources: https://www.dolthub.com/repositories/post-no-preference/stocks ; https://www.dolthub.com/repositories/post-no-preference/stocks/doc/master/LICENSE.md ; https://creativecommons.org/licenses/by-sa/4.0/ .


Noncustodial baskets of canonical RH Stock Tokens on Robinhood Chain (4663, ETH gas). OpenOcean public Swap API provides exact-input USDG buys and Stock Token sells without a 0x key.

## Build and preview

Node 24.x and npm are required (local D1 preview/tests use built-in SQLite). Anvil is used only by the independent contract integration tests (set ANVIL_BIN if not on PATH; the local Foundry install is detected).

```sh
npm ci
npm test
npm run test:contracts
npm run build
npm run dev
```

The preview serves http://127.0.0.1:4317. It uses live read-only APIs and cannot sign without a browser wallet. Tests use no real wallet or funds. No private keys or seed phrases are requested or stored.

## Swap path

1. Connect an EIP-1193 wallet and verify RH mainnet 4663. Hold ETH for gas and USDG for buys.
2. Choose a canonical Stock Token. For a buy enter the exact **USDG budget**, with at most six decimal places. For a sell enter the exact token quantity (18 decimals).
3. Request an OpenOcean v4 `/swap` quote. The browser checks official RH metadata, a fresh reference mark and onchain token state before building it directly with OpenOcean. The shared decoder independently checks the swap calldata and binds the chain, wallet, token pair, decimals, exact spend, recipient and minimum output.
4. Review exact approval to the pinned OpenOcean router. Existing nonzero insufficient allowance is reset separately. Unlimited approvals are never requested by the app. Refresh the quote after approval is included.
5. Review the swap. The app reads balances/allowances, checks infrastructure code, simulates the exact transaction and estimates gas. `CONTINUE IN WALLET` is the user's explicit mainnet action; all signing and submission happens through their wallet.
6. Receipt status alone does not claim a fill. Actual component/USDG transfer deltas from that receipt are checked against the reviewed bounds and shown with an explorer link. `REVIEW SALE OF THIS PURCHASE` uses the quantity received in that specific buy, never a preexisting wallet holding.

OpenOcean quotes are short lived (at most 30 seconds, shortened for RFQ deadlines). Gross quoted output is not presented as an exact receipt: public provider fees and slippage are included in the enforced minimum. The documented public fee tiers range from 0.01% to 0.5% by pair category, plus gas and underlying pool costs. Requests are subject to OpenOcean public rate limits (documented 2 RPS). Excessive/missing price impact, unknown executors, unsupported calldata, permits, partial-fill flags and altered minimums are rejected. The app does not silently switch providers after an error.

Public API availability and successful quote construction do not establish legal eligibility or guarantee inclusion. Issuer restrictions, applicable local rules and service conditions remain relevant. No agreement is accepted for the user.

## Pinned swap infrastructure

- Router on RH: `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` (official OpenOcean chain contract list).
- Executor for this release: `0x018fEADD83a8f2ad4d2508469a3a3215483C4377` (observed in the 12 public mainnet transaction builds checked for this release). A provider executor change fails closed and needs a reviewed release.
- Swap signature is derived from OpenOcean's public `OpenOceanExchangeV2` repository. Router pinning and simulation are not an independent audit of provider contracts.
- `shared/openocean.js` validates input, metadata and encoded calldata, including revalidation in the browser before approval/swap review.
- `shared/settlement.js` verifies actual receipt transfer deltas. The data is saved locally for the connected account only.
- `shared/openocean-api.js` handles fixed-chain public requests directly from the browser; it adds no project referrer fee and uses no secret API key.
- `worker/index.js` exposes read-only official RH data/RPC and configuration. It does not proxy OpenOcean quotes: the hosted shared-IP transport returned HTTP 403. The documented direct-browser integration lets OpenOcean evaluate the actual client request; its denials are shown without fallback. `/api/swap/quote` returns 410 with this transport explanation. There is no server endpoint for signing or submitting transactions. Legacy 0x policy tests remain regression coverage but are not an active route.

## Basket contracts

`contracts/HoodsetVault.sol` implements an ERC-20 share backed pro-rata by 2-12 canonical RH Stock Tokens. Exact-share mints round deposits up; redemption rounds outputs down. Reserving an exit burns shares and segregates the corresponding tokens from active backing; claims are owner-only and single-use. There is no administrator, upgrade, swap, sweep or composition-change authority in this vault.

The deployment UI takes positive weights totaling exactly 100%, metadata and supply cap, then derives initial quantities using fresh reference marks. Market price movement does not rebalance quantities. A new vault is deployed by the user's wallet, then verified by runtime hash and canonical composition before operations appear. Source, ABI, bytecode and complete self-contained Standard JSON compiler input are downloadable in `/chain/`.

The default Batch view buys missing components and mints in one execution after initial exact permissions. Its reverse path redeems and sells the received components for USDG together. Individual steps remain available for separate swaps, deposits and in-kind withdrawals; partial purchases in that mode remain in the wallet if a later step fails. In-kind redemption does not require a USD mark.

The new basket contract has **not received an independent audit**. Local EVM tests and a mainnet read-only constructor simulation are not a substitute.

## Data and hosting

Official registry: https://api.robinhood.com/rhj/assets. The release pins 17 active canonical addresses. Raw underlying REST bid/ask is multiplied exactly once by onchain `uiMultiplier()`. Halted, oracle-paused, missing or older-than-120-second marks block valuations and USD-dependent reviews; no component is silently dropped. Wide reference spreads are shown explicitly. Reference marks are not executable swap prices.

Without `RH_RPC_URL`, browser reads use the official public RPC directly (CORS supported); a shared server IP previously received HTTP 429. For reliable production reads configure a dedicated RH mainnet HTTP endpoint as the Sites server environment variable `RH_RPC_URL`. It is never sent to browser code. There is no `ZEROX_API_KEY` requirement in the active release.

The custom Cloudflare Worker is bundled at `dist/server/index.js` with embedded web assets. `.openai/hosting.json` retains the existing project ID and intentionally has no static binding. The existing Sites audience is public. No contracts or tokens are silently deployed by publication.

## Verification and remaining scope

The release has tests for OpenOcean's recorded mainnet buy/sell calldata, malicious recipient/router/asset/amount substitutions, minimum output and expiry, wallet/chain binding, actual transfer settlement, and pending transaction duplicate protection. The basket contract integration checks use a local EVM. A known broadcast with no receipt remains pending and blocks resubmission of the same operation across reloads; a timeout is not a failed transaction.

The completed mainnet test and its exact scope are documented at the top of this README. Every future funded operation requires the connected owner to review and confirm in their wallet. No transaction is submitted by a server.

There is no global vault/community indexer or full historical cost basis/P&L. Known vaults are a local address book plus imported/shared addresses. Charts use real observations collected by this browser, with no synthetic performance.

References: https://docs.openocean.finance/docs/swap-api/v4, https://docs.openocean.finance/docs/swap-api/api-pricing-and-access, https://docs.openocean.finance/docs/contracts, https://github.com/openocean-finance/OpenOceanExchangeV2, https://docs.robinhood.com/chain/stock-tokens/.

## Genex pictograms

Navigation and utility controls in both the wallet app and the separate paper sandbox use the same 16 locally served PNG pictograms, plus a dropdown chevron derived from the generated layer icon generated with Genex. `web/icons.js` supplies decorative, aria-hidden elements and `web/icons.css` uses their alpha channels as currentColor masks. Button labels and pressed states remain accessible. Asset provenance is recorded in `web/assets/icons/provenance.json`. The HOODSET identity mark remains its existing vector.

## Workspace UI, version 2.2

The live app uses a shared workspace across Discover, portfolio, onchain sets, watchlist, sectors, token market, builder, details and source documentation. Catalogue view and sort preferences, drafts and watchlist use the existing browser storage. Search is available in the header, with `/` or Cmd/Ctrl+K, and in mobile navigation.

Reference-template charts record a fixed set of component quantities when a complete fresh valuation is first available. Later observations value those same quantities; they never reset the set to $100 on each refresh. Reference allocations are not issued shares. Current displayed weights are rounded to basis points with the largest-remainder method so they total 100%; no token or order quantities change. Missing marks stop the complete valuation. The real vault transaction and settlement checks remain in the existing execution layer.

`client/workspace-ui.js` contains the presentation layer; `client/reference.js` handles persistent reference quantities and display weights. The Genex assembly artwork is illustrative and locally served; provenance is recorded beside the asset. No financial transaction was used to test the visual update.

### Instrument and basket marks

The former ticker-letter tiles are replaced everywhere in the live workspace. Fifteen company marks come from the version-pinned NVSTly ticker-logo collection; the QQQ and SPY issuer marks come from official Invesco and State Street assets. These identify the underlying instrument, not a new HOODSET token. The six theme illustrations are actual Genex images, matte-cleaned and extracted with cutout checks, not text monograms. All assets are served locally; per-asset provenance is saved in `web/assets/tokens/provenance.json` and `web/assets/baskets/provenance.json`.

### Connected workflow, version 2.3

Data & network now checks registry, marks, wallet network, ETH and USDG separately. Its buy/sell route probe uses an explicit public test address and sends no transaction. OpenOcean browser requests are spaced to respect public rate limits; denials are never retried through a different provider.

The selected wallet can restore an existing `eth_accounts` permission after reload, without requesting new access. Explicit disconnect removes wallet listeners and the saved selection. No secret or signing capability is persisted. Account/network changes invalidate all reviews and balance snapshots.

Component funding remembers the vault, account and intended shares. Continue funding returns from the token market to a new onchain preview; saved amounts are never an executable order. Stock Token balances in portfolio open a sell form with the available quantity, still requiring a fresh quote and wallet confirmation.

Submitted activity reconciles actual receipts on refresh. Swap recovery verifies token transfer deltas; vault deployment recovery verifies runtime and canonical composition before adding the address. Missing receipts remain pending, settlement failures remain visible, and no recovery step sends a transaction. Gas affordability and exact input balance are checked before wallet review. This release has not completed a wallet-funded mainnet round trip.

### Typography, version 2.3.1

Barlow Condensed retains the display hierarchy and selected identity. IBM Plex Sans now handles reading text, navigation and controls; IBM Plex Mono is reserved for financial values, addresses and metadata. Numeric data uses tabular lining figures. A shared typography layer covers the wallet workspace and paper sandbox, with larger task text and mobile inputs. The diagnostics page uses the same families.

Plex Sans variable WOFF2 subsets (Latin, extended Latin and Cyrillic) are self-hosted with their OFL license and source provenance. No visitor font requests go to Google. The body Latin subset and principal display face are preloaded in the wallet app. No transaction or contract behavior changes in this release.


### Basket Radar, version 2.4

Discover and the dedicated `#radar` workspace have three persistent views: Performance, Composition and Buy preview. Broad templates now contain six to eight canonical components; narrower finance and ETF templates retain their meaningful smaller sets. No token address or execution allowlist was expanded.

Each template can be customized with 2–12 different active supported assets, positive initial weights totaling exactly 100%, proportional redistribution on add/remove, and Equal weights. Drafts, saved mixes, the selected view and reference budget persist locally. Cancel and Restore template are available. Invalid allocations pause dependent statistics and funding. Editing a template never changes a deployed vault.

Statistics include component count, largest initial allocation and ETF-token count, with an explicit overlap limitation. Returns and observed drawdown use only actual browser-collected marks for that exact composition. A full 1D/1M/1Y period needs a retained start mark at or before its cutoff and fresh current marks; unavailable years remain empty. Available history uses individual tracking windows and is not ranked as comparable performance. Real samples are retained by minute for a day, hourly for a month and daily for up to 366 days. No synthetic backfill is used.

Buy preview distributes an exact reference USDG budget using component ask costs for a new fixed-quantity vault; it shows token estimates and a conservative share estimate. All components require fresh marks. The reference is not an executable quote and excludes fees, slippage and gas. Build & fund transfers the validated composition and intended budget into the existing builder, preserving the previous builder draft for restoration. Exact provider quotes, individual approvals, deployment and funding still require the existing wallet reviews.

The release adds 11 pure-logic tests (45 total) covering exact normalization, component bounds, invalid drafts, history identity, period completeness, stale/missing marks, sample retention and spread-aware budget estimates. Browser checks cover saved edits, invalid totals, 2/12-token limits, builder handoff/restoration and mobile layouts. No financial transaction was sent for this update.


### Basket versus SPY, version 2.14

Basket Radar's historical view compares the selected mix with the SPY ETF price benchmark over identical completed sessions. Both start at $100. The view shows the two price paths, each price return and maximum daily-close drawdown, their ending values, and the basket-minus-SPY return difference in percentage points. Editing the composition recalculates the comparison; it does not modify a deployed vault.

The benchmark uses the same start, end and every session as the basket. Missing or invalid benchmark prices leave the comparison unavailable; missing components block the whole basket calculation. Daily-close maximum drawdown is the largest decline from a prior peak within the selected window, not an intraday worst loss. Cash dividends, gas, execution costs and RH multiplier effects are excluded. This price-only calculation differs from SPY's published total return and is not an issued vault's track record, a forecast or a claim of risk-adjusted alpha. Wallet execution and all contracts are unchanged.

Definitions: [SPY issuer](https://www.ssga.com/us/en/institutional/etfs/state-street-spdr-sp-500-etf-trust-spy), [maximum drawdown](https://www.mathworks.com/help/finance/maxdrawdown.html).

### Historical price returns, version 2.5

`/api/history` reads Twelve Data `/time_series` for the 17 pinned underlying US symbols. Configure `TWELVE_DATA_API_KEY` as a **secret** runtime environment variable in Sites and deploy the saved version to apply it. Locally, copy `.env.example` to untracked `.env` and start `npm run dev`. The key is sent only in the provider Authorization header, never to the browser, URLs or archives. Missing keys and the public `demo` key remain unconfigured. Provider authorization failures, missing entitlements, malformed replies and quotas are explicit errors; no alternate service or fabricated dataset is substituted.

Choose a provider plan appropriate for displaying data. The provider currently describes Basic as internal non-display use; its market-data display and redistribution rights must match the intended audience. The public Site needs external display and distribution rights before this data can be served. Set `TWELVE_DATA_DISPLAY_RIGHTS=external-display` only after the provider agreement permits this use; the default serves no historical payload, including cached series, and sends no provider request. The builder confirmed the current account is Basic, so the production release leaves history disabled. No paid plan or agreement is activated.

The source requests 400 split-adjusted daily bars (`adjust=splits`), through the midnight boundary of the current New York date, then explicitly excludes current-day and future bars so unfinished sessions never enter returns. Valid series persist for six hours in the HISTORY_DB D1 binding. Atomic shared request credits enforce at most eight uncached symbol requests per rolling 61 seconds across worker instances; per-asset leases prevent duplicate parallel loads. The provider still enforces the account-wide quota, including other apps using the same key. Initial warmup can take three batches for 17 symbols. Quota-limited missing symbols retry in the background after 65 seconds, for at most four automatic retries. Cached components are reused; auth errors are not repeatedly retried. The page refreshes a connected history after six hours when open or focused. The four schema-only D1 tables store price payloads, request timestamps, temporary load leases and provider cooldowns. They contain no API keys, wallet information or financial transactions. No historical synthetic seed is deployed.

Basket Radar separates **Historical prices** from **This browser**. The historical model applies the chosen initial weights to $100 at the start close, then holds fixed split-adjusted underlying units. The value at date t is `100 × sum(weight_i × close_i(t) / close_i(start))`. The period starts at the latest SPY session on or before the calendar-month/year anniversary (at most seven calendar days earlier). The 1D option is the previous SPY close to the latest completed SPY close. SPY supplies the same start/end/session calendar to every ranked mix. Each component must have a valid bar for every retained SPY session; missing components are never removed or renormalized. Annual history needs at least 200 daily samples, monthly history 15, and the last close may be no more than seven calendar days old. The provider calendar is not an independently reconstructed exchange calendar.

These are **underlying price returns**, excluding cash dividends, costs, gas and RH token multiplier effects. They do not claim actual Stock Token execution returns, portfolio P&L, or a newly issued vault's past performance. The RH currentMultiplier is not applied to already split-adjusted historical prices. Current swaps and vault marks retain their independent freshness and multiplier checks.

Historical growth/daily-close drawdown and a $100 ending value recalculate for edited mixes. Radar sorts highest/lowest returns for the selected common period. Discover/Watchlist catalogue rows and cards show 1Y price return and offer both numeric sort directions, with missing histories last. A separate source-health panel explains setup, per-component coverage and methodology. Live vault charts remain browser observations.

Ten additional tests (55 total) cover provider identity/normalization, unfinished sessions, fixed-quantity weighted returns, interior gaps, incomplete/stale periods, a common ranking window, numeric sorting, key isolation, caching, quotas and explicit auth failures. The real public AAPL trial response was read and normalized; it does not grant full 17-symbol access. Full provider coverage must be verified with the owner's private key and entitlement. No funded transaction was used for this change.


Historical feed boundary fix, version 2.5.1: a date-only provider `end_date` is requested at the current New York date boundary, not the previous date, so the most recent completed daily close is not accidentally excluded. Normalization still rejects today's unfinished session. The historical cache namespace is refreshed for this correction. Tests verify the New York date across a UTC midnight boundary. Runtime credentials remain in Sites only.


Persistent history cache, version 2.5.2: D1 replaces the unreliable cross-isolate memory/edge cache. Fresh worker instances read the same saved series and share a rolling credit budget, asset leases and provider cooldown. The entire cached set is read in one bounded query; loading stops when a quota is reached. Missing durable storage fails before sending provider requests. Drizzle-generated schema-only migrations are packaged by Sites. The local preview applies those migrations to ignored `.local/history.sqlite`; tests use isolated in-memory SQLite databases.

History loading resumes when the tab is focused or becomes visible. The refresh button remains usable; an early click shows the remaining cooldown instead of sending another request. A result deferred while a form is focused is rendered after focus leaves. Two new regression cases (57 tests total) cover missing durable storage and concurrent cold instances; the existing cache case now recreates the service between batches and checks that all 17 saved series survive.


### Annual-first home, version 2.6

Discover shows the selected allocation's real 1Y price return in its opening hero. The featured chart on Discover also starts with the complete 1Y underlying-price calculation; allocation detail/vault observations remain separate. Loading or incomplete periods show a dash, never a fabricated growth figure.

Catalogue sorting defaults to highest 1Y return, and Basket Radar starts with historical prices, 1Y and highest first. A single versioned preference migration applies these new defaults to existing visitors once, preserving drafts, saved compositions, watchlists and later deliberate display/sort choices. The public data source, persistent history cache and wallet execution rules are unchanged.

A zero-supply vault labels its initial quantities and estimated value as planned funding targets, alongside actual active/reserved balances. An empty vault's position panel now explains that deployment bought no Stock Tokens, with the next steps: calculate token amounts, acquire missing components, approve deposits and review Mint. The builder's stage labels explicitly distinguish deployment gas from component purchases. No purchase, approval or mint is sent automatically.

## USDG basket purchase (2.7)

Open `#fund/<VAULT_ADDRESS>` to fund an imported verified vault. The wizard never deploys another contract. The same flow is available from each verified vault's Buy basket with USDG button.

A USDG budget is allocated using the actual contract mint ratio and fresh token-adjusted reference asks. Every component route is checked before a run is saved. Each swap is quoted again immediately before review, with exact approvals, minimum output, recipient and estimated gas. Quotes are not a guarantee that all later routes will remain available. Final shares are derived from verified swap Transfer receipts, limited by actual wallet balances and remaining share capacity. A fresh `previewMint` determines exact maximum deposits. Completion requires both SharesMinted and share/component Transfer events from the actual receipt.

Purchases are separate transactions, not an atomic USDG zap: partial purchases and leftovers remain in the user's wallet. ETH gas is separate. Local progress is scoped to account, chain and immutable composition. Pending or unknown broadcast outcomes block another send. Reload reconstructs spend and components from chain receipts, including same-nonce speed-up/cancellation recovery. Do not clear browser storage during an unfinished run. No keys are stored by this flow.

This 2.7 individual-step implementation predates the 2.12 batch flow and the funded mainnet test documented above. Its tests use recorded OpenOcean calldata, simulated provider replies/receipts and a local EVM; current liquidity still requires a fresh route and wallet confirmation.

Text assets are gzip-packed inside the Worker build and streamed through DecompressionStream when served. HTTP clients receive the original bytes without needing a special content encoding.

## Basket sale back to USDG (2.8)

Open `#exit/<VAULT_ADDRESS>`, or choose Sell basket for USDG on a verified vault / portfolio position. Select shares or Max, then check the proportional redemption and every component's sell route. This check sends no transaction. Missing prices, an unavailable route, insufficient shares, or a component rounded to zero prevent the initial redemption.

The guided exit performs one `redeem` call followed by exact component approvals and fresh OpenOcean sell quotes. The original vault and its runtime stay unchanged. No share allowance is needed to redeem one's own shares. The user reviews and confirms every write in their wallet. Redemption burns shares and transfers component tokens; it does not itself produce USDG. Later prices/routes may change. The process is sequential, with no atomic rollback or guaranteed aggregate USDG output.

The exit verifies AssetsRedeemed, the share burn and all component transfer deltas. Sale inventory comes only from that redemption, with no preexisting holdings added. Actual token debits and USDG credits are rebuilt from receipt logs. A refund remains queued, including a one-wei remainder; completion requires all redeemed quantities to be sold. Reserved exits are excluded and remain separately claimable. The UI shows actual USDG received by this exit, distinct from a wallet's prior cash balance and the route-check estimate.

Progress is local to this browser and wallet. Reload verifies calldata, nonces and receipts; pending and unknown broadcasts block another send. Hash recovery supports an identical same-nonce speed-up and confirmed zero-value self-cancellation. Unknown outcomes remain unresolved after a blocked retry. Other known pending basket operations are checked before a new wallet send. Keep browser storage until the exit is completed.

Tests exercise a full seven-component exit, reload, exact/reset approvals, refunded remainders, missing liquidity, overselling, stale/missing prices, changed wallet/network, malformed progress, altered calldata, rejects, pending/reverted receipts and hash recovery. Local EVM tests check actual burn/transfer events and preserve reserve backing during full redemption. These tests do not establish a completed funded mainnet sale or current liquidity for every pair.

## Template curation (November 27, 2026)

Catalog templates separate compute hardware, public-cloud AI platforms and enterprise AI software. Each has a stated inclusion rule, parent-company exposure limits and official company/issuer source links. Initial weights are equal, rounded to basis points; they are examples, not optimized allocations. The supported universe is limited, and neither a high trailing return nor theme membership is a buy recommendation. Historical mixes apply today's composition retrospectively.

Saved custom mixes retain their assets and weights and appear as “Your mix”. Existing deployed vault quantities, names and initial weights are immutable and are never rewritten by a catalog update. In particular the existing seven-component MYCHIP vault differs from the current three-component compute-hardware template.


## Public release preparation (2.10)

GitHub and X links point to `hoodset/hoodset-app` and `@hoodsetq`. Server-rendered Open Graph/Twitter metadata, canonical URL, robots.txt and sitemap.xml use the incoming Site origin. A future custom domain therefore needs no replacement of the preview host in source. `web/assets/social-cover.png` reuses the selected HOODSET editorial artwork. No ticker, contract address or domain purchase is invented.

The existing Site is public. Twelve Data Basic was confirmed by the builder on November 27: public historical output is now disabled until appropriate external display/distribution rights are configured. `/api/history` stops before reading its cache or using provider credits. It returns a clear unavailable status and empty series, so annual returns stay unranked instead of becoming fabricated percentages. Live RH reference marks and OpenOcean trading remain independent. Do not set the display-rights flag merely because the API key works.

The read-only mainnet check on November 27 returned validated NVDA buy and sell routes. The existing connected wallet's basket check at 5 USDG stopped for insufficient USDG before swaps. This is not a funded round trip. Before the wallet test, fund the same wallet with the agreed USDG budget plus ETH for gas, then use the existing vault's Buy basket with USDG flow. The user confirms every transaction; sell only shares from the completed test and inspect all receipts.

A domain is not attached yet. Add the actual purchased domain through Sites, use the exact DNS validation/routing records returned for it, then validate HTTPS and the anonymous root/API/social-image responses. Do not guess records or use another project's hosting target. Browser-local drafts, watchlists and transaction progress belong to the old origin: complete outstanding operations on that origin and keep it accessible. Onchain balances and vault addresses are independent of the domain; import the same vault address on the new host.
