// Builds data/contracts.json + market books for the five trade hubs for the Pages site. Runs inside GitHub Actions.
// Market data comes from EVE Ref's market-order snapshot (one download), so this script makes NO per-item ESI requests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {execFileSync, spawn} from 'node:child_process';

const OUT = process.argv[2] || 'site/data';
const HUBS = [10000002, 10000043, 10000032, 10000030, 10000042]; // Forge (Jita), Domain (Amarr), Sinq Laison (Dodixie), Heimatar (Rens), Metropolis (Hek)
const SNAP_BASE = 'https://data.everef.net/market-orders/', LEVELS = 40, MAX_SNAPSHOT_AGE_MS = 3 * 3600 * 1000;
const STATIONS = new Set([60003760, 60008494, 60011866, 60004588, 60005686]); // Jita, Amarr, Dodixie, Rens, Hek
const UA = {'User-Agent': 'EVE-Ledger data builder (github.com/mrdarky99/Eve-stats)'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, {headers: UA}); if (r.ok) return r; } catch {}
    await sleep(1000 * (i + 1));
  }
  return null;
}

// Streams EVE Ref's bzip2 CSV through the system bzip2 and keeps the best LEVELS sell/buy levels per wanted type, per hub region.
async function readSnapshot(file, wanted, hubs) {
  const books = Object.fromEntries(hubs.map(r => [r, {}])), snap = {}, regions = new Set(hubs);
  let ix = null, scanned = 0, kept = 0;
  const proc = spawn('bzip2', ['-dc', file], {stdio: ['ignore', 'pipe', 'inherit']});
  const exited = new Promise((res, rej) => { proc.on('error', rej); proc.on('close', code => code === 0 ? res() : rej(new Error('bzip2 exited with code ' + code))); });
  exited.catch(() => {});
  for await (const raw of readline.createInterface({input: proc.stdout, crlfDelay: Infinity})) {
    if (!raw) continue;
    const row = raw.split(',');
    if (!ix) {
      ix = {}; row.forEach((x, i) => ix[x.replace(/"/g, '').trim()] = i);
      for (const k of ['is_buy_order', 'price', 'type_id', 'volume_remain', 'region_id']) if (ix[k] === undefined) throw new Error(`Snapshot has an unexpected format (missing column ${k}).`);
      continue;
    }
    scanned++;
    const reg = +row[ix.region_id];
    if (!regions.has(reg)) continue;
    const t = +row[ix.type_id];
    if (!wanted.has(t)) continue;
    const b = books[reg][t] || (books[reg][t] = [[], []]);
    b[/^(true|1)$/i.test(row[ix.is_buy_order]) ? 1 : 0].push([+row[ix.price], +row[ix.volume_remain]]);
    kept++;
    if (!snap[reg] && ix.http_last_modified !== undefined && row[ix.http_last_modified]) snap[reg] = row[ix.http_last_modified];
  }
  await exited;
  for (const reg of hubs) for (const t in books[reg]) {
    const [sells, buys] = books[reg][t];
    sells.sort((a, b) => a[0] - b[0]); buys.sort((a, b) => b[0] - a[0]);
    if (sells.length > LEVELS) sells.length = LEVELS;
    if (buys.length > LEVELS) buys.length = LEVELS;
  }
  return {books, snap, scanned, kept};
}
async function snapshotUrl() {
  const r = await get(SNAP_BASE + 'index.json');
  if (r) {
    try {
      const files = ((await r.json()).files || []).filter(f => /\.csv\.bz2$/i.test(f.name || ''));
      const f = files.find(x => /latest/i.test(x.name)) || files.sort((a, b) => String(b.last_modified || b.name).localeCompare(String(a.last_modified || a.name)))[0];
      if (f) return f.url || SNAP_BASE + f.name;
    } catch {}
  }
  return SNAP_BASE + 'market-orders-latest.v3.csv.bz2';
}
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
function eachCSV(text, cb) { // fast path for unquoted lines, slow path for quoted records
  const n = text.length; let pos = 0;
  while (pos < n) {
    let end = text.indexOf('\n', pos); if (end < 0) end = n;
    const line = text.slice(pos, end);
    if (line.indexOf('"') < 0) {
      pos = end + 1; const l = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (l.length) cb(l.split(','));
    } else {
      let row = [], field = '', quoted = false, i = pos;
      for (; i < n; i++) {
        const ch = text[i];
        if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; }
        else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') break;
        else if (ch !== '\r') field += ch;
      }
      row.push(field); cb(row); pos = i + 1;
    }
  }
}

// 1) Contract snapshot from EVE Ref
console.log('Downloading contract snapshot…');
const idx = await (await get('https://data.everef.net/public-contracts/index.json')).json();
const f = (idx.files || []).find(x => x.name === 'public-contracts-latest.v2.tar.bz2');
if (!f) throw new Error('Snapshot not listed in EVE Ref index');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-'));
const arc = path.join(tmp, 'c.tar.bz2');
fs.writeFileSync(arc, Buffer.from(await (await get(f.url)).arrayBuffer()));
execFileSync('tar', ['-xjf', arc, '-C', tmp]);
const files = walk(tmp), find = n => files.find(p => path.basename(p) === n);
const meta = JSON.parse(fs.readFileSync(find('meta.json'), 'utf8'));

// 2) Blueprint recipes from the SDE
console.log('Loading blueprint recipes…');
const sdeIdx = await (await get('https://sde.evetech.net/tranquility/latest/')).json();
const raw = sdeIdx.tables || sdeIdx.table || {};
const tables = Array.isArray(raw) ? raw : Object.entries(raw).map(([name, v]) => ({name, ...(v && typeof v === 'object' ? v : {})}));
const bt = tables.find(t => String(t.name || t.table || t.id || '').toLowerCase() === 'blueprints');
const bUrl = bt && (bt.jsonl?.url || bt.jsonl || bt.url);
if (typeof bUrl !== 'string') throw new Error('SDE blueprints table not found');
const recipes = new Map();
for (const line of (await (await get(bUrl)).text()).split(/\r?\n/)) {
  if (!line.trim()) continue;
  const b = JSON.parse(line), act = b.activities?.manufacturing, prod = act?.products?.[0];
  if (prod) recipes.set(String(b.blueprintTypeID ?? b._key ?? b.typeID), {product: prod.typeID, mats: (act.materials || []).map(m => m.typeID)});
}

// 3) Active item-exchange contracts at the hub stations
console.log('Indexing contracts…');
const contracts = new Map(), now = Date.now();
let ci = null;
eachCSV(fs.readFileSync(find('contracts.csv'), 'utf8'), row => {
  if (!ci) { ci = {}; row.forEach((x, i) => ci[x] = i); return; }
  if (row[ci.type] !== 'item_exchange') return;
  const id = Number(row[ci.contract_id]), price = Number(row[ci.price]) || 0, station = Number(row[ci.station_id]);
  const exp = new Date(row[ci.date_expired]).getTime();
  if (!id || !(price > 0) || !STATIONS.has(station) || exp <= now) return;
  contracts.set(id, {id, price, station, exp, items: 0, rows: []});
});
const rl = readline.createInterface({input: fs.createReadStream(find('contract_items.csv')), crlfDelay: Infinity});
let ii = null;
for await (const line of rl) {
  const row = line.split(',');
  if (!ii) { ii = {}; row.forEach((x, i) => ii[x.replace(/"/g, '')] = i); continue; }
  const c = contracts.get(Number(row[ii.contract_id]));
  if (!c) continue;
  c.items++;
  if (row[ii.is_included] !== 'true') continue;
  const t = String(row[ii.type_id]);
  if (!recipes.has(t)) continue;
  const runs = row[ii.runs];
  c.rows.push([Number(t), row[ii.is_blueprint_copy] === 'true' ? 1 : 0, Number(row[ii.material_efficiency]) || 0, Number(row[ii.time_efficiency]) || 0, Number(row[ii.quantity]) || 1, runs === '' || runs === undefined ? null : Number(runs)]);
}
const kept = [...contracts.values()].filter(c => c.rows.length);
console.log(`${kept.length} contracts contain blueprints.`);

// 4) Market depth for every product and material those blueprints need, from EVE Ref's market snapshot (no ESI calls)
const types = new Set();
for (const c of kept) for (const r of c.rows) { const rc = recipes.get(String(r[0])); types.add(rc.product); rc.mats.forEach(m => types.add(m)); }
console.log(`Need market data for ${types.size} item types.`);
const snapUrl = await snapshotUrl();
console.log('Downloading market snapshot…', snapUrl);
const snapRes = await get(snapUrl);
if (!snapRes) throw new Error('Could not download the EVE Ref market snapshot; keeping the previous deployment (no fallback to ESI on purpose).');
const snapFile = path.join(tmp, 'orders.csv.bz2');
fs.writeFileSync(snapFile, Buffer.from(await snapRes.arrayBuffer()));
console.log(`Reading ${(fs.statSync(snapFile).size / 1048576).toFixed(1)} MiB snapshot…`);
const snapshot = await readSnapshot(snapFile, types, HUBS);
console.log(`${snapshot.scanned.toLocaleString()} orders scanned, ${snapshot.kept.toLocaleString()} kept.`);
if (snapshot.scanned < 200000) throw new Error(`Snapshot looks incomplete (${snapshot.scanned} orders); keeping the previous deployment.`);
const jitaAt = Date.parse(snapshot.snap[HUBS[0]]);
if (Number.isFinite(jitaAt) && Date.now() - jitaAt > MAX_SNAPSHOT_AGE_MS) throw new Error(`Snapshot is too old (${snapshot.snap[HUBS[0]]}); keeping the previous deployment.`);
for (const reg of HUBS) {
  const have = Object.keys(snapshot.books[reg]).length;
  console.log(`  region ${reg}: books for ${have}/${types.size} item types`);
}
if (Object.keys(snapshot.books[HUBS[0]]).length < types.size * 0.5) throw new Error('Too few Jita markets found in the snapshot; keeping the previous deployment.');

// 5) Write the files
fs.mkdirSync(OUT, {recursive: true});
const updated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'contracts.json'), JSON.stringify({updated, scrape_end: meta.scrape_end, contracts: kept.map(c => [c.id, c.price, c.station, c.exp, c.items, c.rows])}));
// Jita keeps the original file name and format; the other hubs get market-<regionId>.json in the same format.
for (const reg of HUBS) {
  const file = reg === HUBS[0] ? 'market.json' : `market-${reg}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify({updated, region: reg, snapshot: snapshot.snap[reg] || null, source: 'everef-market-orders', books: snapshot.books[reg]}));
}
console.log('Done.', updated);
