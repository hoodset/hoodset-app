# HOODSET ladder orders — implementation brief

Selected product: buy a supported Stock Token in a ladder, recalculate the average from actual fills, sell the entire accumulated position above that average, optionally repeat with the original budget. This is a single-token execution strategy, separate from basket vaults.

The editor uses the existing warm paper (#f5f4ed), ink (#11120f), lime (#dfff56), purple (#a788da) and rule (#c6cbbe). Barlow Condensed carries the short headline; IBM Plex Sans carries controls; IBM Plex Mono carries prices. Preserve existing sidebar and squared edges.

The memorable element is an editable price ladder: horizontal buy lines across the main composition, proportional budget bars, and a purple exit line. It represents the user's real settings, not a fabricated historical price chart. Controls sit beside the ladder on desktop and below on mobile. Preview shows the average and exit after each hypothetical buy and explicitly labels the assumptions. No promised returns, fake fills or automatic browser-only bot.

Implementation gates: separate non-upgradeable escrow contract, fixed canonical assets, separately verified price feeds and their immutable maximum ages, exact OpenOcean route checks, public permissionless executor, full-position take profit, bounded cycle count and expiry. An executor cannot change amounts/limits or redirect withdrawals. The owner can stop and recover each asset independently even if feeds/routes fail. Mainnet trading stays unavailable until a contract is explicitly deployed, verified and an executor is operational. HSET pricing and fee recipients are separate decisions; no allocation or charge is inferred from API billing.
