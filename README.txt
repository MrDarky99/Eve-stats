EVE Ledger - Blueprint Contract Finder button fix

Replace the site's current index.html with this index.html.

This patch moves EVE Ledger initialization to the end of the script and wraps initialization in a try/catch, so a startup error in another area won't prevent the contract scanner button from being connected. The scanner button also has a guarded error display.

Please backup your existing index.html before replacing it. This is a staged static-code fix; it has not been verified against live ESI in a browser or on mobile.
