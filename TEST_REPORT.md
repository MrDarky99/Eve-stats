# EVE Ledger preliminary test report

## Executed checks
- JavaScript syntax checks: `app.js`, `esi.js`, `planner.js` and the extracted embedded script from `EveLedger_fixed.html` — PASS.
- Industry core tests — PASS (11 assertions): material rounding/edge cases, cost/revenue/tax/time calculations, blueprint indexing and recursive component requirements/owned subtraction.
- Manual planner calculation tests — PASS (8 assertions): totals, installation fee, revenue, fees, profit, hours and invalid-input rejection.

## Scope / limitations
These are executable calculation and syntax tests, not browser end-to-end tests. Live SDE downloads, ESI market calls, OAuth, DOM interactions, mobile layout and actual deployment remain unverified. The calculation engine files are a staged foundation and have not yet been fully wired into the existing dashboard UI. Recursive requirement helper does not yet implement EVE facility/skill/rig modifiers, reactions, invention, market depth, job batching/blueprint-copy constraints or complete official rounding nuances.
