// Universe builder — POORI NSE equity list se universe.json banata hai.
// Base: EQUITY_L.csv (~2400 listed stocks) — sirf index members nahi.
// Kyun: creator chhote/mid momentum stocks trade karta hai jo Nifty500/Microcap250
// se BAHAR hote hain (Marine Electricals, Nelco, Laser Power type). Sirf index lists
// se scan karne se wo saare miss ho rahe the.
// Cap tags NSE ki 4 official lists se; jo kisi me nahi = 'Micro'.
// Sector Nifty500 list se; unknown = 'Other' (hot-sector calc me skip hota hai).
// Scan me bhavcopy turnover se prefilter hota hai, isliye badi list se dikkat nahi.
// Rebuild: node scripts/build-universe.mjs

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const EQUITY_LIST = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';

// Sector/industry ke liye (in me industry column hoti hai)
const SECTOR_LISTS = [
  'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv',
  'https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv'
];

// Cap classification — order matters (bada cap pehle jeet-ta hai)
const CAP_LISTS = [
  ['https://niftyindices.com/IndexConstituent/ind_nifty100list.csv', 'Large'],
  ['https://niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv', 'Mid'],
  ['https://niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv', 'Small'],
  ['https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv', 'Micro']
];

// ETF / fund / bond — trading candidates nahi
const NOT_A_STOCK = /\b(ETF|BeES|Exchange Traded|Mutual Fund|Bharat Bond|Index Fund|Gold Fund|Silver Fund|Liquid Fund|Nifty|Sensex)\b/i;

function parseIndexLine(line) {
  // Format: Company Name,Industry,Symbol,Series,ISIN
  const f = line.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
  if (f.length < 5) return null;
  return { industry: f[f.length - 4], symbol: f[f.length - 3], series: f[f.length - 2] };
}

async function fetchCsv(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.nseindia.com/' } });
    if (!res.ok) { console.error(`FAIL ${res.status}: ${url}`); return []; }
    return (await res.text()).split(/\r?\n/).filter(l => l.trim());
  } catch (e) { console.error('FETCH FAIL:', url, e.message); return []; }
}

async function main() {
  // 1) cap map
  const capMap = new Map();
  for (const [url, cap] of CAP_LISTS) {
    const lines = (await fetchCsv(url)).slice(1);
    let n = 0;
    for (const line of lines) {
      const r = parseIndexLine(line);
      if (r && !capMap.has(r.symbol)) { capMap.set(r.symbol, cap); n++; }
    }
    console.log(`cap ${cap}: ${n}`);
  }

  // 2) sector map
  const secMap = new Map();
  for (const url of SECTOR_LISTS) {
    const lines = (await fetchCsv(url)).slice(1);
    for (const line of lines) {
      const r = parseIndexLine(line);
      if (r && r.industry && !secMap.has(r.symbol)) secMap.set(r.symbol, r.industry);
    }
  }
  console.log(`sector tags: ${secMap.size}`);

  // 3) curated overrides (Defence/Railways jaisi granularity CSV me nahi hoti)
  const curated = new Map();
  try {
    for (const s of JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks) {
      if (s.curated) curated.set(s.s, s.sec);
    }
  } catch { }

  // 4) POORI NSE equity list
  const eqLines = await fetchCsv(EQUITY_LIST);
  if (eqLines.length < 100) { console.error('EQUITY_L.csv nahi mila — abort, purani universe rakhi'); process.exit(1); }
  const stocks = [];
  for (const line of eqLines.slice(1)) {
    const f = line.split(',').map(x => x.trim());
    const [symbol, name, series] = f;
    if (series !== 'EQ') continue;             // sirf normal equity (T2T/BE nahi)
    if (!symbol || NOT_A_STOCK.test(name)) continue;
    stocks.push({
      s: symbol,
      n: name.replace(/\s+(Limited|Ltd\.?)$/i, ''),
      sec: curated.get(symbol) || secMap.get(symbol) || 'Other',
      cap: capMap.get(symbol) || 'Micro',
      ...(curated.has(symbol) ? { curated: true } : {})
    });
  }
  stocks.sort((a, b) => a.s.localeCompare(b.s));

  const capCounts = stocks.reduce((m, s) => (m[s.cap] = (m[s.cap] || 0) + 1, m), {});
  const withSector = stocks.filter(s => s.sec !== 'Other').length;
  writeFileSync(join(ROOT, 'universe.json'), JSON.stringify({
    note: `POORI NSE EQ list (${stocks.length} stocks) — cap tags + sector jahan mile. Scan me bhavcopy turnover se prefilter hota hai. Rebuild: node scripts/build-universe.mjs`,
    builtAt: new Date().toISOString(),
    stocks
  }, null, 1));
  console.log(`universe.json: ${stocks.length} stocks | caps:`, capCounts, `| sector tagged: ${withSector}`);
}

main().catch(e => { console.error(e); process.exit(1); });
