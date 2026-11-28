# Reference spreads, route checks and Stock Token pairs

## Spreads & execution

[Spreads](https://hoodset.space/#spreads) lists all supported canonical Stock Tokens, including unavailable entries. Search ticker/company, sort spreads in either direction, or filter missing marks and spreads at least 50 basis points. Unavailable rows sort after priced rows and are never treated as a zero spread.

Each displayed quote uses the existing RH registry/contract checks and the existing token-adjusted bid/ask. The adjustment is applied **once** in `adjustedPrice`; this screen never reapplies it. Spread is `(ask − bid) / ((ask + bid) / 2)`, shown in basis points and percent. Marks older than 120 seconds, halted/paused instruments, invalid or missing quotes stop the corresponding calculation. Snapshot age is not the last underlying trade time. See the [official RH price API semantics](https://docs.robinhood.com/chain/stock-token-apis/).

The basket reference model fixes quantities from the selected starting weights at current midpoint marks and scales them to the selected nominal USD amount. It values those same quantities at bid and ask and includes all components. A missing component stops the complete total. This is a model, not a deployed vault's current holdings, executable spread, order or liquidity guarantee. Individual displayed USD values round to cents; totals use full precision. No pool fees, gas or executable slippage are inferred from the reference model.

The independent round-trip preview requests a 1–1,000 USDG buy quote, then a sell quote for the first quote's **minimum output**, rather than its gross estimate. It shows the original spend, gross buy quote, first-leg minimum, gross sell quote for that lower input, the second minimum as a clearly labelled two-quote scenario, and the scenario difference versus the original spend. Raw gross outputs may exclude provider fees. The earliest expiry applies. This is not an aggregate guaranteed return, an expected fill or an arbitrage claim: quotes are independent, actual fills and later routes can differ, and the scenario contains both legs' slippage/fee allowances. ETH gas is excluded. The existing reference execution guard assumes USDG = $1. [OpenOcean public API fees](https://docs.openocean.finance/docs/swap-api/api-pricing-and-access) depend on token category and can reach 0.5% per swap.

Public route previews use `0x1111111111111111111111111111111111111111`, clearly identified as a public read-only preview, without connecting a wallet. They send no approval or transaction. Opening the existing wallet buy flow obtains a separate fresh quote and performs the existing balance/permission checks.

## Pair analysis

[Pairs](https://hoodset.space/#pairs) accepts two different supported Stock Tokens. Its 1M/1Y historical analysis uses split-adjusted underlying daily closes, not token execution prices. The same completed-session window and SPY date calendar checks used by Basket Radar apply. Every selected asset must cover every retained date; missing interior closes do not get dropped or filled. The calendar must be no more than seven days old. No current token mark is spliced into the historical ratio.

- **Ratio:** left underlying close divided by right underlying close.
- **Return gap:** left price return minus right price return, in percentage points over identical dates.
- **Z-score:** last log-ratio minus its sample mean, divided by sample standard deviation, over the last up to 63 selected observations. At least 20 observations and nonzero variation are required.
- **Correlation:** Pearson correlation of the two series' aligned simple daily returns over the selected period. At least 20 daily returns and nonzero variation in both legs are required.

Constant/insufficient series display unavailable statistics rather than fabricated zeroes. These are descriptive statistics, not proof of cointegration, a mean-reversion model, an arbitrage signal, a hedge ratio or a profit forecast. Returns exclude cash dividends, fees and RH token multiplier effects. The page separately shows live directional reference exchange ratios using the left bid/right ask and the reverse; these are not swap quotes.

## Actual pair exchange

Pair execution is an OpenOcean **spot exchange of tokens already owned by the wallet**. It does not borrow stock tokens or open short, leveraged or market-neutral long/short positions. Underlying-equity short selling is not enabled by this feature. A public route preview and a wallet order are separate flows.

The wallet flow requires RH mainnet, complete fresh marks for both components, a sufficient input token balance and an exact token permission. A missing permission opens the existing bounded approval review; it never sends automatically. After approval, a fresh quote is decoded and checked for chain, sender, canonical tokens/decimals, exact spend, known router/executor, recipient, minimum output, flags, empty permit and zero ETH executor calls. Both fresh-RH-reference deviation and available provider impact must stay within 5%. The app simulates the transaction and estimates ETH gas before a separate wallet confirmation. The UI cannot sell more input tokens than the connected wallet owns. The quote/review expires after at most 30 seconds; Refresh quote & review requests a new route and minimum, without sending.

The integration uses the existing [OpenOcean V4 API](https://docs.openocean.finance/docs/swap-api/v4) and router/executor pins; no new financial contract is deployed. A quoted route does not prove funded execution or continuing liquidity.

## Persistence and recovery

Selections and inputs stay in this browser. A wallet-bound intent is persisted before asking the wallet to send a pair transaction. Failed persistence stops the request. An unknown wallet outcome blocks another write for that account until a matching transaction hash is recovered; a definite wallet rejection clears the intent. Intents are retained separately per address. A broadcast hash is journaled before its intent is removed; pending transactions are not resent.

Recovery verifies the transaction's sender, target, calldata/value key and time bounds. Completed swap receipts must reconcile actual net input/output Transfer logs with the reviewed spend cap and minimum. Their result appears in the pair receipt panel and activity journal. Pair receipts do not replace the USDG swap journal used by existing guided flows. A reload reconciles pending activity through the common read-only recovery path.

## Validation

Automated checks cover spread math, one-time multiplier use, complete basket costs, missing/stale marks, aligned pair dates, ratios/return gaps, constant-series statistics, independent quote joins, payload mutations, dual-reference guards, wallet balance/permission limits, changed inputs/wallets, fresh review renewal, local persistence failure, unknown outcomes, hash recovery and receipt transfer reconciliation. The public NVDA→AMD fixture is an observed mainnet route, not a fabricated fill. Live route checks are read-only; no financial transaction is sent by the development checks.
