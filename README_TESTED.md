# EVE Ledger test-first industry work (staging)

This bundle preserves the uploaded project files and adds a tested, DOM-independent calculation foundation:
- `industry-core.mjs`: validated material, plan, SDE-record flattening, blueprint indexing and recursive requirements helpers.
- `industry-core.test.mjs`: executable tests.
- `planner-core.mjs` and `planner.test.mjs`: legacy calculator refactor and tests.
- `TEST_REPORT.md`: scope and test results.

Run tests with Node 22+:

```bash
node industry-core.test.mjs
node planner.test.mjs
```

This is **not yet a drop-in deployed release**. The tested core is not fully integrated into the HTML planner; live endpoints and browser behavior are not tested. Do not replace your deployed site with this staging package expecting the full promised manufacturing system yet.
