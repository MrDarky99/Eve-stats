EVE Ledger SDE storage-quota staging build

This build moves the large SDE blueprint/type cache from localStorage into IndexedDB.
It retains a session-only fallback if IndexedDB caching fails.

Deployment: replace the existing site's HTML file with EveLedger_fixed.html after backing up the current file.

Checks run: embedded script syntax check; static inspection confirms SDE cache writes use IndexedDB and no longer write sdeTypes/sdeBlueprints into localStorage.
Not verified: live CCP SDE fetch, OAuth, browser UI, IndexedDB on your specific mobile browser.
