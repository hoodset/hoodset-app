# Ladder orders

HOODSET's standalone implementation of a dip-buy ladder with an exit based on the **actual acquisition average**. It is inspired by the Spring Orders concept. It is not an integration with or an endorsement by Ticker Spring.

## Release status

The public editor, browser-local plans and hypothetical fill preview are available at `/#orders`. The escrow contract, wallet transaction flow and executor source are implemented and tested locally. **No HOODSET ladder engine has been deployed or activated on mainnet.** The activation file deliberately has `engine: null` and `executorActive: false`, so the website cannot request a deposit. The executor is never launched by a website build or deployment.

HSET service payments are planned following the project owner's choice. **Price, billing unit, recipient and refund terms have not been selected.** The release does not collect HSET, impose a holder gate or reuse API credits for trading. Existing API billing remains a different service. No own execution fee or token buyback/burn allocation is present.

## User flow

1. Choose one of the 17 canonical supported RH Stock Tokens. Configure 1–8 strictly descending buy levels, each with a USDG budget of at least 1. Maximum total is 1,000,000 USDG.
2. Set a full-position take-profit of 1–100% over actual USDG cost, 1–100 maximum completed cycles and a 1–90 day expiry. There is no leverage, borrowing or short position.
3. Preview hypothetical fills at the entered limits. The example is arithmetic; it is not a backtest, real order, quote, forecast or promised return. Save a plan locally without connecting a wallet.
4. After activation, connect an eligible wallet on RH mainnet, review exact USDG permission, then review a separate deposit transaction. A permission alone creates no strategy. USDG is escrowed in the separate order contract, not a basket vault; no basket shares are minted.
5. An independent executor pays its own ETH gas and submits available routes. Anyone can execute a valid route, but nobody except the strategy owner can stop or withdraw. Closing this browser is not the execution mechanism. An offline executor means there may be no fills.
6. Stop at any time and recover cash and Stock Tokens separately. No fresh feed, working route or executor is required for recovery. A frozen token can block its own transfer but cannot block the other asset's withdrawal.

## Exact accounting

A buy must spend exactly the requested part of one remaining level budget and receive at least `ceil(spentUSDG6 * 1e30 / limitPrice18)` token base units. Partial **buys** are supported. Net tokens actually received and USDG actually spent update the cost basis. Deductions inside swap output therefore affect the average automatically.

The full position can sell only for at least `ceil(actualCostUSDG6 * (10,000 + profitBps) / 10,000)` **net USDG**. A partial sale cannot be substituted. This version has a single full-position exit, not 2–4 take-profit parts. Gas is separate and can exceed the gain. USDG amounts are token units, not guaranteed US dollar purchasing power.

After a complete sale, repeating reserves the **original** budget at the original levels. Surplus remains separately withdrawable; it is not compounded automatically. The cycle limit bounds repetitions. In an active cycle, unspent buy budgets stay reserved. Expiry prevents all subsequent fills and releases reservations. A buy level currently above market may execute on a subsequent route if the actual effective price still meets its bound.

There is no 95% fill-complete approximation or hidden dust write-off. Partial buy remainders remain allocated until spent, stopped or expired. A sale requires the exact recorded token holding. Tiny residual positions may be uneconomic to execute and can be withdrawn in kind.

## Price and route protection

`HoodsetLadderOrders.sol` pins the canonical RH allowlist, OpenOcean exchange and executor addresses. It accepts only the expected swap selector, exact assets and amount, engine receiver, flags, empty permit and no native value in inner calls. It sets only the exact per-swap allowance, clears it afterwards, and verifies actual input/output balance changes. Other strategies' balances and direct donations are not claimable.

Each supported execution market needs a separately verified Chainlink token-price proxy in the constructor. These mappings cannot be changed later. The feed's decimals are read; the token feed already includes the RH multiplier and it is **not applied twice**. Invalid/nonpositive/incomplete/future/stale rounds (older than the constructor-pinned market age limit, at most 86,400 seconds) and `oraclePaused()` block opening and execution. Stale periods and weekends can prevent fills even if a pool price appears attractive. The onchain feed condition is necessary but insufficient: the **net swap route must also satisfy the exact user price bound in USDG**. USDG/USD depegs can make those two tests disagree and block execution.

Robinhood Chain is not currently listed among Chainlink's published sequencer uptime feeds. This implementation does not invent a sequencer feed. The executor additionally rejects an old or future chain head. Feed freshness uses the configured heartbeat, whereas an execution route lasts at most 120 seconds; these are different clocks. This does not provide a complete sequencer-recovery grace-period guarantee. An independent review of network/oracle risks is required before activation. There is no independent audit claim.

Each fill carries the strategy revision and a short deadline. A fill or owner change increments the revision; stale concurrent quotes revert. Quotes are obtained again rather than reused after expiry. Insufficient liquidity, provider rejection, missing price impact or a route outside the net bound produces no fill. Reaching a chart price does not guarantee execution.

## Activation checklist for the operator

These are deployment requirements, not actions already performed:

1. Review the contract and tests independently. Verify canonical token deployments and corresponding token-price proxies using [Robinhood docs](https://docs.robinhood.com/chain/oracles-and-price-feeds/) and [Chainlink's Robinhood catalog](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood). Record the full addresses and source/date; do not guess or substitute raw-underlying feeds. The release includes the 12 matches from the official catalog in `web/data/ladder-feeds.json` (Shared SVR proxies, 8 decimals, 86,400-second heartbeat). `node scripts/check-ladder-feeds.mjs` checks metadata and the current round onchain without signing. AVGO, JPM, NFLX, V and XOM have no catalog match in this snapshot; they remain planning-only. A catalog heartbeat is not evidence of a recent round.
2. Compile with `node scripts/compile-ladder-orders.mjs`. The published standard JSON includes dependencies. A deployment accepts arrays of canonical token addresses, verified price feeds and fixed maximum ages (not exceeding the published heartbeat), and spends ETH gas only. Deployment does not create an order or transfer USDG/HSET. The owner must separately review and sign it; this task did not request any wallet action.
3. Verify the deployed runtime against `/chain/ladder-orders.json`, the constructor feed mappings and `BUILD_ID`. Verify source on the explorer. Record deployment block and engine in `web/data/ladder-orders.json`; do not mark the executor active yet.
4. Run `node scripts/ladder-executor.mjs --ids=1` for a **dry run** once a user-created test strategy exists. The executor reads the public configuration and validates runtime/feeds/limits before simulating a fill. No signatures or sends occur in dry run. Price tests must use actual mainnet feed timestamps, including closed-market states.
5. Explicitly authorize a small funded test: exact approval, opening deposit, actual buy, exit and owner withdrawal. Wallet confirmations belong to the user. Check receipts, actual balances and net proceeds; local mock-exchange tests are not evidence of mainnet liquidity or profitability.
6. Set up a separate gas-only executor wallet via the operator's own secret manager. For explicitly authorized execution use `LADDER_EXECUTOR_KEY` and `--execute`. Never put its key in browser code, the repository or chat. The key cannot withdraw user escrow. Use a persistent host such as Railway only after its service/secret/cost setup has been agreed. No Railway resource is created in this release.
7. Activate `executorActive` only after the engine, routes, monitoring and operator are verified. Complete HSET pricing/recipient/refund design separately before collecting a service payment.

## Commands

```sh
npm test
npm run test:contracts
npm run build
node scripts/check-ladder-feeds.mjs           # metadata and current rounds only
node scripts/ladder-executor.mjs --ids=1,2   # dry-run; needs a configured engine
# --watch polls every 15 seconds. --execute is an explicit financial execution flag.
```

The executor stops on an unknown send outcome and refuses to start sends with a pending executor nonce. Its gas estimate ceiling is 0.001 ETH per execution. This is a source-level ceiling, not a funded budget authorization. Operators must check the recorded transaction hash before restarting after an unknown outcome.
