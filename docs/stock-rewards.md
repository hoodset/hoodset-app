# HSET Stock Rewards

Stock Rewards is a separate optional participation contract, not a basket vault and not a change to HSET's token contract. The interface is at `https://www.hoodset.space/#rewards`. The published pool address, if deployed, is in `web/data/stock-rewards.json`; a null address means no official pool has been published. Do not infer a mainnet deployment, funded rewards or completed mainnet test from source publication alone.

## Principal and rewards

Users approve an exact HSET amount and then deposit it into the verified pool. The pool records `balanceOf(account)` and `totalStaked`; it issues no new token or transferable receipt. HSET can be withdrawn without a minimum lock period. A withdrawal checkpoints earned rewards and returns only principal. Earned Stock Tokens remain claimable after full exit.

The constructor pins canonical HSET and its deployed runtime on RH mainnet, validates 18 decimals, and allows only 1–12 distinct canonical Stock Token reward assets. HSET itself cannot be a reward asset. Assets are fixed for this pool's lifetime. A different reward set requires a separate deployment.

Each reward asset is claimed independently. A frozen or failed reward transfer cannot block another asset's claim or HSET withdrawal: principal withdrawal performs no reward-token calls. HSET's own issuer/token behavior, RPC/network availability and contract risks still apply. This contract has not received an independent audit.

## Actual funding, no fixed APY

`fundRewards(index, amount)` pulls an exact Stock Token contribution and checks the actual balance increase before recording it. Funding is permissionless and irrevocable. A token permission is separate from the contribution. Direct transfers are not registered funding and are not recoverable: there is no owner, sweep, upgrade or arbitrary-call function.

Funding records the actual contributor, token, amount and whether it queued in `RewardsFunded`. This proves a token contribution, not its economic origin. The current HOODSET basket router does not retain its own trading fee. No automatic trading-fee allocation or conversion of API payments is implemented by this pool. Manual contributions must not be described as protocol revenue. A fee-funded policy needs a separately reviewed source and explicit financial authorization.

The site shows contract-funded and paid amounts, remaining stream budgets, carry/queued amounts and actual claimant balances. Recent funding history is a bounded window of 2,000 RH blocks, with up to 20 records; missing or older event history is not presented as zero lifetime funding. Source receipts remain available through the explorer.

## Seven-day streaming

Funding starts a finite seven-day stream when no cycle is active. A top-up during a cycle goes into `queued` and never resets the current finish time. This prevents tiny permissionless top-ups from postponing rewards indefinitely.

Rewards vest cumulatively as `floor(budget × elapsed / 604800)`. The difference since the last checkpoint is indexed across current HSET participation using precision `1e36`. Accounts checkpoint before their stake changes; later entrants receive no historical rewards. Per-account fractional remainders survive claims, partial withdrawals and restaking. Integer rounding in the global index can leave unallocated dust; the interface promises no fixed rate or guaranteed distribution of every wei.

If nobody participates during an interval, that interval's vested amount enters `carry`. It is streamed over a later cycle, not assigned immediately to the next participant. Both `stake` and `withdraw` checkpoint internal accounting; neither changes the time already spent participating.

Rollover is interaction-activated. After a cycle ends, the next state-changing interaction can start a fresh seven-day stream from queued/carry funds at the activation timestamp. There is no backdated accrual over an idle gap. A read or refresh does not start a cycle. `checkpoint()` is exposed separately because a zero-earnings claim reverts and therefore cannot activate a cycle.

Lifetime funded amounts per asset and total HSET participation are each capped at `1e36` raw units. Bounds and `Math.mulDiv` keep accumulator arithmetic within uint256 limits. No new funding can be credited from existing obligations, HSET principal or unsolicited donations.

## Wallet flow and recovery

Every deployment, approval, contribution, stake, withdrawal, claim and cycle activation is a real wallet-confirmed transaction with ETH gas. The app verifies pool runtime, HSET identity, asset set and same-block custody; it uses exact token approvals, resets a nonzero insufficient approval first, simulates requests and rechecks before sending. Expired reviews can be refreshed without sending.

An intent is durably recorded before the wallet request. An unknown outcome blocks other financial requests until its matching hash is recovered from wallet Activity. Reloading or an RPC timeout never authorizes another send. Included stake/funding/withdrawal/claim receipts must have the matching accounting event and exact token transfer. Account/network changes invalidate private views and reviews. Keys or wallet signing credentials are never stored.

## Verification scope

Local EVM tests exercise proportional time participation, zero-stake carry, queued top-ups, idle gaps, micro amounts, fractional checkpoints, independent frozen-token claims and principal exit, exact/taxed transfers, reentrancy and arithmetic/amount bounds. Local fixtures are not mainnet rewards or proof of paid usage. A real mainnet deployment and funded participation/claim need separate wallet confirmations and explicit onchain receipts.
