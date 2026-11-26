EVE Ledger contract blueprint finder staging

Primary website file: index.html

This build adds a Blueprint Contract Finder inside Production Planner.
It scans The Forge region contract pages (bounded to 20 pages), filters outstanding item-exchange contracts by the configured Jita 4-4 location ID, checks contents for up to 80 listings, and matches blueprint items to the loaded SDE blueprint dataset. Results show contract price, BPO/BPC status, and BPC ME/TE/runs.

Deployment: backup your current site file, then replace it with index.html from this package.

Limitations: no live ESI/browser/mobile verification was performed here. Contract listings may be region-wide; the location filter assumes Jita 4-4 ID 60003760. The scan is deliberately capped. This is a finder, not an automated purchase feature. Contract links are generic contract-search links rather than direct contract purchase links.
