# Contributing

Use Node.js 24. Run `npm ci`, `npm test`, and `npm run build` before submitting a pull request. Local contract checks require Anvil and must remain on a local test chain.

Describe the concrete user behavior changed and the checks performed. Include screenshots for interface changes. Keep onchain write behavior explicit and wallet-confirmed, reject incomplete or stale valuation, and preserve pending transaction recovery.

Do not commit credentials, production databases, personal wallet records, browser storage, or private deployment metadata. `.env.example` contains names only. Do not report a funded mainnet flow as verified without actual receipts and balance deltas.
