// Builds data/contracts.json + data/market.json (The Forge market) for the Pages site. Runs inside GitHub Actions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {execFileSync} from 'node:child_process';

const OUT = process.argv[2] || 'site/data', REGION = 10000002;
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
async function pool(items, limit, fn) {
  let n = 0;
  await Promise.all(Array.from({length: limit}, async () => { while (n < items.length) await fn(items[n++]); }));
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

// 4) Market depth for every product and material those blueprints need
const types = new Set();
for (const c of kept) for (const r of c.rows) { const rc = recipes.get(String(r[0])); types.add(rc.product); rc.mats.forEach(m => types.add(m)); }
console.log(`Fetching market data for ${types.size} item types…`);
const books = {}; let failed = 0, done = 0;
async function book(id) {
  const base = `https://esi.evetech.net/latest/markets/${REGION}/orders/?order_type=all&type_id=${id}&page=`;
  const r = await get(base + 1); if (!r) throw new Error('ESI failed for ' + id);
  const orders = await r.json(), pages = Math.min(5, Number(r.headers.get('x-pages')) || 1);
  for (let p = 2; p <= pages; p++) { const x = await get(base + p); if (x) orders.push(...await x.json()); }
  const lv = (a, asc) => a.sort((x, y) => asc ? x.price - y.price : y.price - x.price).slice(0, 40).map(o => [o.price, o.volume_remain]);
  return [lv(orders.filter(o => !o.is_buy_order), true), lv(orders.filter(o => o.is_buy_order), false)];
}
await pool([...types], 8, async id => {
  try { books[id] = await book(id); } catch { failed++; }
  if (++done % 500 === 0) console.log(`  ${done}/${types.size}`);
});
if (failed > types.size * 0.05) throw new Error(`Too many market failures (${failed}/${types.size}); keeping the previous deployment.`);

// 5) Write the files
fs.mkdirSync(OUT, {recursive: true});
const updated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'contracts.json'), JSON.stringify({updated, scrape_end: meta.scrape_end, contracts: kept.map(c => [c.id, c.price, c.station, c.exp, c.items, c.rows])}));
fs.writeFileSync(path.join(OUT, 'market.json'), JSON.stringify({updated, region: REGION, books}));
console.log('Done.', updated);
