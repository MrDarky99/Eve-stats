# Eve Stats — modular GitHub Pages rewrite

Static, browser-only EVE Online character dashboard. No server or database.

## Deploy
1. Create a GitHub repository (or use your existing repository).
2. Upload the files in this folder to the repository root: `index.html`, `style.css`, `app.js`, `esi.js`, `planner.js`, `store.js`.
3. In GitHub, open Settings → Pages and choose deployment from the main branch/root.
4. Ensure the EVE Developer application callback URL matches `` in `esi.js`.
5. Visit the Pages URL and click Add character.

## Included
- PKCE EVE OAuth and token refresh
- Character sync for wallets, transactions, journal, assets, market orders, industry jobs, mining, planets and recent killmails
- Overview, finance, trading FIFO estimate, holdings, industry and a basic multi-hub market spread scanner
- Manual production-planning calculator with quantity, materials, BPC, facility fee, job time, sale price and estimated fees
- Data-health metadata and warnings when paging caps are reached

## Limitations / caution
- Tokens are stored in browser local storage; this is not appropriate for shared/untrusted devices. Remove a character to delete its local records. OAuth token revocation is not implemented.
- Journal and asset sync are capped to 100 pages per sync; historical transaction fetching is capped at 12 batches. Some endpoints may return partial or unavailable data.
- The production planner is a manual estimate: it does not yet automatically fetch blueprint recipes, market material prices, station bonuses, ME/TE, skills, manufacturing facility quotes, or sourcing locations. Inputs are not saved as production plans yet.
- Market scan is indicative and does not account for volume, market depth, hauling, taxes beyond a simple spread, or order competition.
- FIFO and valuation are estimates; contracts, unmatched stock, actual fees and other accounting edge cases may not be represented.
- The app never automatically places market orders.
