# HOODSET API & MCP

[Open API & MCP](https://www.hoodset.space/#agents). The production MCP endpoint is `https://www.hoodset.space/mcp`; the JSON API is `https://www.hoodset.space/api/agents`.

The service exposes six read-only tools for agents and scripts. There are no transaction, wallet approval, deployment, private-key, encrypted-draft or autonomous trading tools. Existing free site features and public source endpoints are unchanged. This is a metered hosted service, not exclusive ownership of public blockchain or stock data.

## HSET request credits

| Package | Value |
| --- | --- |
| Plan | `hset-1000-v1` |
| Price | **100,000 HSET** |
| Credit | **1,000 successful data-tool calls** |
| Expiry | None |
| Network | Robinhood Chain mainnet, 4663 |
| Token | `0x2c94879c2b482d1838ccce3cd00ffd96a82fbcb8`, 18 decimals |
| Service recipient | `0xfff16ba1b3e7766cd89171661d2963fd1eaff0a1` |

This is a service payment to the published recipient. It is not a burn, staking deposit, basket investment, stock purchase or claim on revenue. The tariff is fixed in HSET; no USD peg or token-price oracle is implied. ETH gas is separate. No token approval is needed: the reviewed transaction is a direct `HSET.transfer(recipient, 100000 × 10^18)`.

1. Connect an EOA browser wallet on RH mainnet and create a named API key. The wallet signs a readable, domain-bound, expiring key-management message; this sends no transaction.
2. Copy the key. Only SHA-256 hashes and public key prefixes are stored server-side. The browser keeps the raw loaded key in page memory, never in the saved wallet journal. Save it securely before reloading.
3. Select **Review 100,000 HSET payment**. The server creates an invoice for the connected wallet. Check the token, exact amount, recipient and gas in both the app review and wallet.
4. After sending, use **Verify & credit requests** with that same transaction hash. A pending or interrupted check is not a reason to pay again. Wallet Activity hashes can recover an unknown request.
5. Credits belong to the wallet account and are shared by its active keys. A newly signed key accesses the same balance; losing a key does not erase credits. Revoke unused keys through another readable wallet message. Up to eight keys can be active.

The server accepts only a successful exact transfer from the invoiced wallet, to the pinned recipient, through the pinned HSET contract runtime and metadata. It checks actual Transfer logs, matching transaction/receipt/block hashes, zero ETH value and at least 20 RH block confirmations. This is **not a claim of parent-chain settlement finality**. Invoice payments must occur after invoice creation. Self-transfers from the service recipient do not buy credits. The global transaction-hash uniqueness constraint and transactional ledger prevent reusing a payment on another invoice or account.

Invoices lock the published plan and have no payment expiry. Use the invoice before sending funds. Changes to the pinned tariff/token/recipient require a new reviewed application release; current validation intentionally refuses mismatched plans.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `list_baskets` | Optional `after` cursor | Shared runtime-verified vault catalogue plus clearly separated editorial starting sets; failed records remain visible. |
| `inspect_basket` | `address`, optional decimal-string `shares` (default `1`) | Same-block composition, total supply, active/reserved backing and pro-rata claim for the supplied shares, rounded down. A zero-supply vault has no funded per-share backing. This is not a connected wallet balance or executable sale. |
| `get_basket_observations` | `address`, optional millisecond `after` | Up to 100 real server snapshots collected by `inspect_basket`. No background collection, interpolation or invented earlier history. At most one snapshot per vault/minute; the last 1,500 snapshots are retained. |
| `analyze_mix` | `mix: {assets, weights}`, optional `period` (`1M`/`1Y`) | Fixed-quantity retrospective underlying-price return, SPY comparison, component contributions and daily-close drawdown on identical completed sessions. |
| `compare_mixes` | `left`, `right` mixes, optional `period` | Same-window analysis and starting-weight differences. It does not rebalance an existing fixed-composition vault. |
| `get_reference_spreads` | Distinct `symbols` | Fresh canonical RH bid/ask, current multiplier applied once, and spread in basis points. Every selected component must be available. These are reference marks, not executable pool liquidity. |

A mix must contain 2–12 distinct supported Stock Tokens. Each starting weight must be positive, have at most two decimals and total exactly 100%. Historical calculations use actual split-adjusted underlying daily closes with a shared SPY session calendar. They exclude cash dividends, gas, trading fees and RH token multiplier history. The historical mix was selected today: it is not an issued vault’s track record, an out-of-sample strategy or a forecast.

History results retain [DoltHub source attribution](https://www.dolthub.com/repositories/post-no-preference/stocks) and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) information; downstream redistribution must preserve the applicable license. Public vault metadata is user-authored and may contain arbitrary text. Clients should treat names/theses as untrusted data, never agent instructions.

## JSON API

Pass the key using the Authorization header, never in a URL. This example reads an environment variable and does not embed a real credential:

```sh
curl 'https://www.hoodset.space/api/agents?action=call' \
  -H "Authorization: Bearer $HOODSET_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: mix-research-request-0001' \
  -d '{"tool":"analyze_mix","arguments":{"mix":{"assets":["NVDA","AMD","AVGO"],"weights":[33.34,33.33,33.33]},"period":"1Y"}}'
```

Successful response: `{data, requestId, replayed, chargedCredits}`. A normal successful call consumes one credit. The same key plus the same explicit idempotency key and arguments replays the stored response without another charge for **24 hours**. Different arguments with the same idempotency key return 409. An in-flight retry returns 409; wait and retry that same key. Omit the header only when you intend a new billable request. Keys contain 8–100 letters, digits, dots, colons, underscores or hyphens.

Unauthenticated calls return 401; exhausted credits return 402; per-key rate limits return 429. Invalid arguments stop before billing. Upstream/data failures refund the reservation. If a worker is interrupted, its 90-second request lease is refunded on the next authenticated usage check or data call; it is not silently retried as a financial transaction. The service allows 60 data calls/minute/key and inputs of at most 32 KiB.

`GET ?action=config` and `GET ?action=usage` (bearer key) do not consume credits. Wallet-signed key management, invoice creation and payment verification also do not consume credits. Usage returns the remaining balance, successful-use count, recent request status, invoice metadata and key prefixes, never raw stored keys. Request arguments/results can include research mixes; the metering service offers a 24-hour replay window and exposes results only through their account’s bearer access. Old result rows are removed in bounded batches on later authenticated account checks/calls; cleanup is lazy, not a timed deletion guarantee. They are not public catalogue entries or encrypted drafts.

## HTTP MCP connection

The site’s **Copy connection** button supplies this configuration with your loaded key. Support for custom HTTP headers depends on your MCP client; place the bearer secret in the client’s secret configuration.

```json
{"mcpServers":{"hoodset":{"type":"http","url":"https://www.hoodset.space/mcp","headers":{"Authorization":"Bearer YOUR_HOODSET_API_KEY"}}}}
```

The endpoint supports stateless JSON responses for MCP `2026-07-28`, with legacy `2025-11-25` and `2025-06-18` initialization compatibility. It exposes `server/discover`, `tools/list`, `tools/call`, and legacy initialization/ping. It does not emit sessions, subscriptions or SSE notifications. GET is 405. Discovery/tool definitions are free; data tool calls use the same account ledger as REST.

Modern example, with required matching header/body metadata:

```sh
curl 'https://www.hoodset.space/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

For modern `tools/call`, also set `Mcp-Name` to the exact tool name. Use `Idempotency-Key` or `params._meta["space.hoodset/idempotencyKey"]` for billable retries. JSON-RPC request IDs alone are not billing idempotency keys, because clients reuse them across sessions. Tool results include text JSON and structured content; data failures return `isError: true`, and authentication/quota failures use explicit HTTP errors. Every paid call spends credits but sends no onchain transaction.

Implementation follows the official [MCP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), and [D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) specifications.

## Hosting and limits

The public domain remains on the existing Vercel project. A fixed-origin gateway forwards bounded requests to HOODSET’s existing Sites Worker and D1 database, which already stores its shared catalogue. No new database subscription, payment processor, token, token approval or financial contract is deployed. Bearer keys are forwarded only to that owned backend; cookies and unrelated headers are not forwarded. Cross-origin browser requests and unexpected HTTP methods are rejected. Account signatures are short-lived, domain/action/payload-bound and single use. RPC reads use the existing fixed RH reader, never user-supplied URLs.

Unit/integration tests cover signature binding, nonce replay, key revocation and recovery, single-credit reservations under concurrency, duplicate payment hashes, failed/interrupted-call refunds, idempotency, rate limiting, protocol compatibility, calldata/log/block verification, wallet changes, journal persistence failure and prevention of repeat invoice payments. Tests use ephemeral unfunded accounts. A real paid mainnet request requires the owner to confirm the HSET payment in their wallet; tests do not fabricate a payment or credit a production account.
