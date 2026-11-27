# EVE Ledger — integrated GitHub Pages build

Upload `index.html` to the root of the existing GitHub Pages repository (replace the current index). The contract finder is integrated directly into the Production planner and does not require extra project files.

## Blueprint Contract Finder
- Uses EVE Ref `public-contracts-latest.v2.tar.bz2` bulk snapshots.
- Checks snapshot timestamp/ETag and caches the archive in IndexedDB.
- Decompresses BZIP2 in the browser and parses the TAR/CSV contract archive.
- Loads blueprint type names from ESI, then searches active item-exchange and auction contracts by blueprint, region, station, volume and price.
- Displays BPO/BPC, ME/TE, BPC runs, contract price, seller, location and expiry.
- Does not issue one ESI request per contract.

The app remains browser-only. First load requires a connection to EVE Ref, ESI and the BZIP2 CDN. Browser storage must be enabled for persistent caching.
