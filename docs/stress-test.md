# Basket stress test and HSET scenario library

Open [Stress test](https://hoodset.space/#stress) or the fourth Basket Radar view. The builder preview also links to `#stress-draft`, which tests that exact draft without modifying it or requiring price feeds. Anyone can change a mix's component price shocks from −100% to +500%, enter a hypothetical USD amount, and inspect each component's contribution. Presets set the largest starting component to −20%, all components to −10%, or all components flat. Editing a mix changes the calculation immediately and never edits a deployed vault.

## Calculation and limits

This worksheet uses the selected **starting token weights**, not a connected position's current weights. It requires 2–12 canonical components and strictly positive basis-point weights totalling 100%. No price feed is needed: all outcomes are explicit user-defined hypothetical shocks, not observations, probabilities, forecasts, executable quotes or maximum-loss estimates. Fees, gas, dividends, correlations, multiplier changes and ETF look-through are excluded. Each ETF is one component; its issuer can change underlying holdings independently.

The hypothetical budget ($1 to $1,000,000) is allocated to components in integer cents using the largest-remainder method. Each component change is its allocated cents times its shock, rounded to the nearest cent, with half cents away from zero. Component changes sum exactly to the displayed change; start plus change equals end. The displayed percentage derives from that cent-rounded total. Invalid amounts, unknown components, partial allocations and invalid shocks pause the result.

Largest weight and top-three weights describe concentration in the selected tokens. Effective token count is `1 / sum(weight_fraction²)`. It equals the component count for equal token weights and falls with concentration. This is an allocation statistic, not a measure of independent economic bets or a risk rating.

## Implemented HSET role

Holding **at least 1 HSET** in the connected Robinhood Chain mainnet wallet opens a library of up to 12 named scenarios and an outcome comparison table. Everyone retains interactive stress calculations, basket discovery, Copy mix and financial operations. This release does not implement background monitoring or Telegram notifications.

HSET address: `0x2c94879c2b482d1838ccce3cd00ffd96a82fbcb8`, symbol `HSET`, 18 decimals. The read-only checker verifies chain 4663 and runtime hash `0x040904d1ae06fb97e0a6fdf5ed8d79ac42209ff7c8965347f3a118f1b01a4738`, then reads code, metadata and wallet balance at a single block. Access expires after 120 seconds or an account/network change; each save rereads the balance. RPC failure or an identity mismatch does not grant access. No token approval, signature, transfer, lock, burn or staking occurs. HSET does not back basket shares and confers no share of basket assets or returns.

The scenario library is a browser-local convenience feature with a client-side holder check, not a server-enforced data access service. Records are scoped to the connected address in this browser. They are **not encrypted, synced, or recoverable on another device**. A failed storage write reports failure instead of claiming success. Each saved record retains its own mix, budget and shocks, so later template edits never rewrite its result. Use shocks is enabled only for a matching composition; comparisons show each scenario's starting amount.

## Verification

Unit checks cover component cent reconciliation, complete wipeouts, concentration, input bounds, malformed records, account/network/freshness checks, single-block token identity reads, saved scenario independence, repeated holder checks and failed local persistence. The HSET runtime fixture is public chain bytecode, not a private credential. No financial transaction is required to use or verify this feature.
