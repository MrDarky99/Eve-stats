// Builds data/contracts.json, data/prices.json and market books for the five trade hubs for the Pages site. Runs inside GitHub Actions.
// All market data comes from EVE Ref's market-order snapshot (one download), so neither this script nor the site makes ESI price requests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {execFileSync, spawn} from 'node:child_process';

const OUT = process.argv[2] || 'site/data';
const HUBS = [10000002, 10000043, 10000032, 10000030, 10000042]; // Forge (Jita), Domain (Amarr), Sinq Laison (Dodixie), Heimatar (Rens), Metropolis (Hek)
const SNAP_BASE = 'https://data.everef.net/market-orders/', LEVELS = 40, TRIM_AT = 200, MAX_SNAPSHOT_AGE_MS = 3 * 3600 * 1000;
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

// Streams EVE Ref's bzip2 CSV through the system bzip2 and keeps the best LEVELS sell/buy levels per type, per hub region.
// wanted = Set of type ids to keep, or null to keep every type that has orders in the hub regions.
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
    if (wanted && !wanted.has(t)) continue;
    const b = books[reg][t] || (books[reg][t] = [[], []]);
    const side = /^(true|1)$/i.test(row[ix.is_buy_order]) ? 1 : 0, lv = b[side];
    lv.push([+row[ix.price], +row[ix.volume_remain]]);
    if (lv.length > TRIM_AT) { lv.sort(side ? (a, c) => c[0] - a[0] : (a, c) => a[0] - c[0]); lv.length = LEVELS; } // keeps memory bounded when every type is kept
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

// 4) Market depth for EVERY item type in the hub regions (not only blueprint products/materials), from EVE Ref's market snapshot (no ESI calls)
// `types` is only used as a sanity check: the products and materials of the contract blueprints must be well covered.
const types = new Set();
for (const c of kept) for (const r of c.rows) { const rc = recipes.get(String(r[0])); types.add(rc.product); rc.mats.forEach(m => types.add(m)); }
console.log(`${types.size} item types are needed by the contract blueprints; keeping books for every traded type.`);
const snapUrl = await snapshotUrl();
console.log('Downloading market snapshot…', snapUrl);
const snapRes = await get(snapUrl);
if (!snapRes) throw new Error('Could not download the EVE Ref market snapshot; keeping the previous deployment (no fallback to ESI on purpose).');
const snapFile = path.join(tmp, 'orders.csv.bz2');
fs.writeFileSync(snapFile, Buffer.from(await snapRes.arrayBuffer()));
console.log(`Reading ${(fs.statSync(snapFile).size / 1048576).toFixed(1)} MiB snapshot…`);
const snapshot = await readSnapshot(snapFile, null, HUBS);
console.log(`${snapshot.scanned.toLocaleString()} orders scanned, ${snapshot.kept.toLocaleString()} kept.`);
if (snapshot.scanned < 200000) throw new Error(`Snapshot looks incomplete (${snapshot.scanned} orders); keeping the previous deployment.`);
const jitaAt = Date.parse(snapshot.snap[HUBS[0]]);
if (Number.isFinite(jitaAt) && Date.now() - jitaAt > MAX_SNAPSHOT_AGE_MS) throw new Error(`Snapshot is too old (${snapshot.snap[HUBS[0]]}); keeping the previous deployment.`);
for (const reg of HUBS) {
  const have = Object.keys(snapshot.books[reg]).length;
  const need = [...types].filter(t => snapshot.books[reg][t]).length;
  console.log(`  region ${reg}: books for ${have} item types (${need}/${types.size} of the contract blueprint items)`);
}
if ([...types].filter(t => snapshot.books[HUBS[0]][t]).length < types.size * 0.5) throw new Error('Too few Jita markets found in the snapshot; keeping the previous deployment.');

// 5) Write the files
fs.mkdirSync(OUT, {recursive: true});
const updated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'contracts.json'), JSON.stringify({updated, scrape_end: meta.scrape_end, contracts: kept.map(c => [c.id, c.price, c.station, c.exp, c.items, c.rows])}));
// One price per item type for valuing assets, mining and losses (replaces ESI /markets/prices/):
// Jita lowest sell, else Jita highest buy, else the cheapest sell in the other hubs, else their highest buy.
const prices = {}, allTypes = new Set(HUBS.flatMap(r => Object.keys(snapshot.books[r])));
for (const t of allTypes) {
  let p = 0;
  const j = snapshot.books[HUBS[0]][t];
  if (j) p = j[0][0]?.[0] || j[1][0]?.[0] || 0;
  if (!p) { const s = HUBS.slice(1).map(r => snapshot.books[r][t]?.[0][0]?.[0]).filter(x => x > 0); if (s.length) p = Math.min(...s); }
  if (!p) { const b = HUBS.slice(1).map(r => snapshot.books[r][t]?.[1][0]?.[0]).filter(x => x > 0); if (b.length) p = Math.max(...b); }
  if (p > 0) prices[t] = Math.round(p * 100) / 100;
}
fs.writeFileSync(path.join(OUT, 'prices.json'), JSON.stringify({updated, snapshot: snapshot.snap[HUBS[0]] || null, source: 'everef-market-orders', region: HUBS[0], prices}));
console.log(`Wrote prices for ${Object.keys(prices).length} item types.`);
// Jita keeps the original file name and format; the other hubs get market-<regionId>.json in the same format (now with every traded type).
for (const reg of HUBS) {
  const file = reg === HUBS[0] ? 'market.json' : `market-${reg}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify({updated, region: reg, snapshot: snapshot.snap[reg] || null, source: 'everef-market-orders', complete: true, books: snapshot.books[reg]}));
}
// 6) Facilities within MAX_JUMPS of Jita (EVE Ref + SDE, no ESI).
// NON-FATAL on purpose: a failure here is written into facilities.json (ok:false + checkpoints) and logged as a GitHub warning,
// but never blocks the prices/contracts/market deployment above.
async function buildFacilities() {
  const ORIGIN = 30000142, MAX = +process.env.MAX_JUMPS || 10, cps = [];
  const STRUCT_TYPES = {35825: 'Raitaru', 35826: 'Azbel', 35827: 'Sotiyo', 35832: 'Astrahus', 35833: 'Fortizar', 35834: 'Keepstar', 35835: 'Athanor', 35836: 'Tatara'};
  const INDUSTRY = new Set([35825, 35826, 35827, 35835, 35836]);
  const result = {updated, origin: ORIGIN, max_jumps: MAX, ok: false, checkpoints: cps, counts: {}, facilities: []};
  const cp = (step, ok, msg) => {
    cps.push({step, ok, msg}); console.log(`[facilities] ${ok ? 'OK  ' : 'FAIL'} ${step}: ${msg}`);
    if (!ok) console.log(`::warning title=Facilities ${step}::${msg}`);
  };
  const pick = (o, ...names) => { for (const n of names) for (const s of [o, o?.value]) if (s && s[n] !== undefined) return s[n]; };
  const sysOf = r => Number(pick(r, 'solar_system_id', 'system_id', 'solarSystemID', 'solarSystemId') ?? r?.value?.esi?.solar_system_id);
  const rows = j => {
    if (Array.isArray(j)) return j;
    if (j && typeof j === 'object') {
      const arrs = Object.values(j).filter(Array.isArray);
      if (arrs.length === 1 && arrs[0].length > 20) return arrs[0];
      return Object.entries(j).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)) ? {_key: k, ...v} : {_key: k, value: v});
    }
    return [];
  };
  const getJ = async u => { const r = await get(u); if (!r) throw new Error('download failed: ' + u); return r.json(); };
  async function latest(dir, pattern, fallback) {
    const base = `https://data.everef.net/${dir}/`;
    try {
      const idx = await (await get(base + 'index.json')).json();
      const fl = (idx.files || []).filter(f => pattern.test(f.name || ''));
      const f = fl.find(x => /latest/i.test(x.name)) || fl.sort((a, b) => String(b.name).localeCompare(String(a.name)))[0];
      if (f) return f.url || base + f.name;
    } catch {}
    return fallback;
  }
  const secClass = s => s >= 0.45 ? 'high' : s > 0 ? 'low' : 'null';
  const mfgIndex = d => {
    const ci = d?.cost_indices ?? d?.costIndices ?? d; let v;
    if (Array.isArray(ci)) { const a = ci.find(x => /manufactur/i.test(String(x.activity ?? x.activity_name ?? ''))); v = a?.cost_index ?? a?.costIndex; }
    else if (ci && typeof ci === 'object') v = ci.manufacturing?.cost_index ?? ci.manufacturing ?? ci.manufacturing_cost_index;
    return typeof v === 'number' ? Math.round(v * 10000) / 100 : null; // percent, e.g. 0.0129 -> 1.29
  };
  try {
    // A) jump graph
    const nm = t => String(t.name || t.table || t.id || ''), tUrl = t => t.jsonl?.url || t.jsonl || t.url;
    const jsonl = async t => (await (await get(tUrl(t))).text()).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
    const adj = new Map(), link = (a, b) => { if (a && b) { (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a); } };
    const jt = tables.find(t => /solarsystemjumps|systemjumps/i.test(nm(t))), gt = tables.find(t => /stargates/i.test(nm(t)));
    if (jt) for (const r of await jsonl(jt)) link(+pick(r, 'fromSolarSystemID', 'from_solar_system_id', 'fromSystemID'), +pick(r, 'toSolarSystemID', 'to_solar_system_id', 'toSystemID'));
    else if (gt) for (const r of await jsonl(gt)) link(+pick(r, 'solarSystemID'), +(pick(r, 'destination')?.solarSystemID ?? pick(r, 'destinationSolarSystemID')));
    else throw new Error('No jump or stargate table in the SDE (tables: ' + tables.map(nm).filter(n => /jump|gate|system/i.test(n)).join(', ') + ')');
    if (adj.size < 5000) throw new Error(`Jump graph only has ${adj.size} systems (expected ~8000); SDE format changed?`);
    const jumps = new Map([[ORIGIN, 0]]); let fr = [ORIGIN];
    for (let d = 1; d <= MAX; d++) { const nx = []; for (const s of fr) for (const n of adj.get(s) || []) if (!jumps.has(n)) { jumps.set(n, d); nx.push(n); } fr = nx; }
    if (jumps.size < 10) throw new Error(`Only ${jumps.size} systems found within ${MAX} jumps of ${ORIGIN}`);
    cp('jump-search', true, `${adj.size} systems in graph, ${jumps.size} within ${MAX} jumps of Jita`);
    // B) names + security
    const info = new Map(), st = tables.find(t => /^mapsolarsystems$/i.test(nm(t)));
    if (st) for (const r of await jsonl(st)) { const n = pick(r, 'name', 'solarSystemName'); info.set(+pick(r, '_key', 'solarSystemID'), {name: typeof n === 'object' ? n.en : n, sec: Number(pick(r, 'securityStatus', 'security'))}); }
    cp('system-names', info.size > 5000, `${info.size} system names/security values loaded`);
    // C) cost indices (optional)
    const idx = new Map();
    try {
      const u = await latest('industry-systems', /latest.*\.json$/i, 'https://data.everef.net/industry-systems/industry-systems-latest.json');
      for (const r of rows(await getJ(u))) { const sid = sysOf(r); if (jumps.has(sid)) idx.set(sid, mfgIndex(r.value || r)); }
      const withVal = [...idx.values()].filter(v => v !== null).length;
      cp('cost-indices', withVal > 0, `${idx.size} systems matched, ${withVal} with a manufacturing index${withVal ? '' : ' (record format not recognised; see data/facilities.json)'}`);
    } catch (e) { cp('cost-indices', false, e.message); }
    const base = (sid, f) => ({...f, system_id: sid, system: info.get(sid)?.name, sec: info.get(sid)?.sec, sec_class: secClass(info.get(sid)?.sec), jumps: jumps.get(sid), mfg_index: idx.get(sid) ?? null});
    // D) player structures (optional)
    try {
      const u = await latest('structures', /structures-latest\.v2\.json$/i, 'https://data.everef.net/structures/structures-latest.v2.json');
      const all = rows(await getJ(u)); let n = 0;
      for (const r of all) {
        const sid = sysOf(r); if (!jumps.has(sid)) continue;
        const d = r.value || r, tid = Number(d.type_id ?? d.esi?.type_id);
        result.facilities.push(base(sid, {kind: 'structure', id: Number(r._key ?? d.structure_id ?? d.id), name: d.name ?? d.esi?.name ?? 'Unknown structure', type_id: tid, type: STRUCT_TYPES[tid] || 'Structure', industry: INDUSTRY.has(tid), market: d.has_market ?? d.market ?? null})); n++;
      }
      cp('structures', all.length > 100 && n > 0, `${all.length} structures downloaded, ${n} within range`);
    } catch (e) { cp('structures', false, e.message); }
    // E) NPC stations (optional)
    try {
      const u = await latest('industry-facilities', /latest.*\.json$/i, 'https://data.everef.net/industry-facilities/industry-facilities-latest.json');
      const all = rows(await getJ(u)); let n = 0;
      for (const r of all) {
        const d = r.value || r, sid = sysOf(r); if (!jumps.has(sid)) continue;
        const id = Number(r._key ?? d.facility_id ?? d.station_id ?? d.id); if (result.facilities.some(f => f.id === id)) continue;
        const tax = typeof d.tax === 'number' ? (d.tax <= 1 ? d.tax * 100 : d.tax) : null;
        result.facilities.push(base(sid, {kind: 'npc', id, name: d.name ?? d.station_name ?? 'NPC station ' + id, type: 'NPC station', industry: true, tax})); n++;
      }
      cp('npc-stations', all.length > 100 && n > 0, `${all.length} NPC facilities downloaded, ${n} within range`);
    } catch (e) { cp('npc-stations', false, e.message); }
    // F) finish
    result.facilities.sort((a, b) => a.jumps - b.jumps || String(a.name).localeCompare(String(b.name)));
    result.counts = result.facilities.reduce((a, f) => (a[f.kind] = (a[f.kind] || 0) + 1, a), {});
    result.ok = result.facilities.length > 0 && cps.every(c => c.ok || ['cost-indices', 'structures', 'npc-stations'].includes(c.step));
    cp('summary', result.facilities.length > 0, `${result.facilities.length} facilities written (${JSON.stringify(result.counts)})`);
  } catch (e) { cp('fatal', false, e.message); }
  fs.writeFileSync(path.join(OUT, 'facilities.json'), JSON.stringify(result));
}
await buildFacilities();

// 7) Sold volume in The Forge (Jita's region) from EVE Ref's daily market-history dataset (no ESI).
// The game only publishes regional daily totals, not Jita 4-4 alone, and only for completed days (so no "today").
// NON-FATAL: a failure is written into volume.json (ok:false + checkpoints) and logged as a GitHub warning.
// Reads every history file through the system bzip2; aggregates per type: [latest day, day 7 earlier, last-7-days sum, last-30-days sum].
async function readHistoryFile(file, region, vol, dayTypes) {
  let ix = null, rowsSeen = 0, rowsKept = 0;
  const proc = spawn('bzip2', ['-dc', file], {stdio: ['ignore', 'pipe', 'inherit']});
  const exited = new Promise((res, rej) => { proc.on('error', rej); proc.on('close', code => code === 0 ? res() : rej(new Error('bzip2 exited with code ' + code))); });
  exited.catch(() => {});
  for await (const raw of readline.createInterface({input: proc.stdout, crlfDelay: Infinity})) {
    if (!raw) continue;
    const row = raw.split(',');
    if (!ix) {
      ix = {}; row.forEach((x, i) => ix[x.replace(/"/g, '').trim()] = i);
      for (const k of ['date', 'region_id', 'type_id', 'volume']) if (ix[k] === undefined) throw new Error(`History file has an unexpected format (missing column ${k}; header: ${Object.keys(ix).join(', ')}).`);
      continue;
    }
    rowsSeen++;
    if (+row[ix.region_id] !== region) continue;
    const date = String(row[ix.date]).replace(/"/g, '').slice(0, 10), t = +row[ix.type_id], v = +row[ix.volume];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !t || !Number.isFinite(v)) continue;
    let m = vol.get(t); if (!m) vol.set(t, m = new Map());
    m.set(date, v); dayTypes.set(date, (dayTypes.get(date) || 0) + 1); rowsKept++;
  }
  await exited;
  return {rowsSeen, rowsKept};
}
function summariseVolumes(vol, dayTypes) {
  const dates = [...dayTypes.keys()].sort(), maxN = Math.max(0, ...dayTypes.values());
  const full = dates.filter(d => dayTypes.get(d) >= maxN * 0.5), latest = full[full.length - 1] || null; // ignores a half-uploaded newest day
  if (!latest) return {latest: null, v: {}, days: 0};
  const L = Date.parse(latest + 'T00:00:00Z'), key = n => new Date(L - n * 864e5).toISOString().slice(0, 10), v = {};
  const d7 = key(7), w7 = new Set(Array.from({length: 7}, (_, i) => key(i))), w30 = new Set(Array.from({length: 30}, (_, i) => key(i)));
  for (const [t, m] of vol) {
    let s7 = 0, s30 = 0; for (const [d, x] of m) { if (w30.has(d)) s30 += x; if (w7.has(d)) s7 += x; }
    const d0 = m.get(latest) || 0, a = m.get(d7) || 0;
    if (d0 || a || s7 || s30) v[t] = [d0, a, s7, s30];
  }
  return {latest, v, days: full.filter(d => w30.has(d)).length};
}
async function buildVolume() {
  const REGION = 10000002, BASE = 'https://data.everef.net/market-history/', cps = [];
  const result = {updated, region: REGION, ok: false, checkpoints: cps, latest_date: null, days: 0, types: 0, v: {}};
  const cp = (step, ok, msg) => {
    cps.push({step, ok, msg}); console.log(`[volume] ${ok ? 'OK  ' : 'FAIL'} ${step}: ${msg}`);
    if (!ok) console.log(`::warning title=Volume ${step}::${msg}`);
  };
  let tmpd = null;
  try {
    const r = await get(BASE + 'index.json');
    if (!r) throw new Error('could not download ' + BASE + 'index.json');
    const files = ((await r.json()).files || []).map(f => ({m: /(\d{4}-\d{2}-\d{2})[^/]*\.csv\.bz2$/i.exec(f.name || ''), f}))
      .filter(x => x.m).map(x => ({date: x.m[1], url: x.f.url || BASE + x.f.name})).sort((a, b) => b.date.localeCompare(a.date));
    if (!files.length) throw new Error('index.json lists no daily .csv.bz2 history files (dataset layout changed?)');
    cp('history-index', true, `${files.length} daily files listed, newest ${files[0].date}`);
    tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
    const vol = new Map(), dayTypes = new Map(); let used = 0, failed = 0;
    for (const f of files.slice(0, 45)) {
      if (dayTypes.size >= 32) break;
      const res = await get(f.url);
      if (!res) { failed++; console.log(`[volume] download failed for ${f.date}`); continue; }
      const file = path.join(tmpd, f.date + '.csv.bz2');
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const s = await readHistoryFile(file, REGION, vol, dayTypes); fs.rmSync(file, {force: true}); used++;
      console.log(`[volume] ${f.date}: ${s.rowsSeen} rows, ${s.rowsKept} in The Forge`);
    }
    cp('history-download', used > 0 && vol.size > 0, `${used} files read${failed ? `, ${failed} failed` : ''}, ${vol.size} item types with Forge history, ${dayTypes.size} distinct days`);
    if (!vol.size) throw new Error('no rows for region 10000002 found in the history files');
    const s = summariseVolumes(vol, dayTypes);
    if (!s.latest) throw new Error('could not determine the latest complete day');
    const ageDays = (Date.now() - Date.parse(s.latest + 'T00:00:00Z')) / 864e5;
    cp('latest-day', ageDays <= 4, `latest complete day ${s.latest} (${ageDays.toFixed(1)} days old)${ageDays > 4 ? ': dataset looks stale' : ''}`);
    cp('window', s.days >= 25, `${s.days} of the last 30 days present${s.days < 25 ? ': 30-day totals will be too low' : ''}`);
    Object.assign(result, {latest_date: s.latest, days: s.days, v: s.v, types: Object.keys(s.v).length});
    result.ok = result.types > 1000 && ageDays <= 4;
    const jita = s.v[34]; // Tritanium, as a sanity value
    cp('summary', result.types > 1000, `${result.types} types written; Tritanium latest day ${jita ? jita[0].toLocaleString() : 'missing'}, 7d ${jita ? jita[2].toLocaleString() : '?'}, 30d ${jita ? jita[3].toLocaleString() : '?'}`);
  } catch (e) { cp('fatal', false, e.message); }
  finally { if (tmpd) fs.rmSync(tmpd, {recursive: true, force: true}); }
  fs.writeFileSync(path.join(OUT, 'volume.json'), JSON.stringify(result));
}
await buildVolume();

console.log('Done.', updated);
