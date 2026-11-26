# EVE Ledger staged test report

## Executed checks
- SDE index normalization tests — PASS (7 assertions): array and object table-index handling, JSONL URL extraction, JSONL parsing, localized type-name fallback.
- Industry core tests — PASS (11 assertions): material rounding/edge cases, plan calculations, blueprint indexing and recursive component requirements/owned-material subtraction.
- Manual planner tests — PASS (8 assertions): totals, fee/revenue/profit/time calculations and validation.
- Syntax checks — PASS: `app.js`, `esi.js`, `planner.js`, and the embedded script extracted from `EveLedger_fixed.html`.

## Fix in this staging revision
The SDE loader no longer assumes `index.tables` is an array with `.find()`. It normalizes array or object table indexes, resolves blueprints/types JSONL links, skips blank JSONL rows, and gives clearer errors for missing links or unusable downloaded data.

## Scope / limitations
These are executable core and syntax tests, not browser end-to-end tests. We could not verify a live SDE download, ESI market calls, OAuth, DOM interactions, mobile layout or deployment in a browser. The recursive industry core is still not fully wired into the existing planner UI and does not yet implement every EVE modifier, reaction, invention, market depth, job batching, blueprint-copy constraints or all official rounding nuances.
