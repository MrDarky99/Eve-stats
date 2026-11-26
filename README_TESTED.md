# EVE Ledger staging revision

This staging revision includes a fix for the screenshot error (`tables.find is not a function`): the loader now normalizes the SDE index whether `tables` is an array or an object, and handles JSONL table links and parsing more defensively.

## Test commands
Run with Node.js:

```bash
node sde-loader-core.test.mjs
node industry-core.test.mjs
node planner.test.mjs
```

## Deploy cautiously
This is a staged fix, not a verified live deployment. Back up the currently deployed repository before replacing files. Browser/live SDE/OAuth/ESI behavior could not be tested here. The recursive calculation foundation is not fully integrated with the planner UI yet.
