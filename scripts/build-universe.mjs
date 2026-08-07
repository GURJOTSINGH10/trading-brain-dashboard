// Universe builder — POORI NSE equity list se universe.json banata hai.
// Base: EQUITY_L.csv (~2400 listed stocks) — sirf index members nahi.
// Kyun: creator chhote/mid momentum stocks trade karta hai jo Nifty500/Microcap250
// se BAHAR hote hain (Marine Electricals, Nelco, Laser Power type). Sirf index lists
// se scan karne se wo saare miss ho rahe the.
// Cap tags NSE ki 4 official lists se; jo kisi me nahi = 'Micro'.
// Sector: pehle NSE index lists (~750), phir Yahoo industry cache (baaki ~1330).
// Sab naam ek hi canonical vocabulary me aate hain (scripts/sector-map.mjs) —
// warna 'Auto' aur 'Automobile and Auto Components' alag buckets ban jaate the.
// Scan me bhavcopy turnover se prefilter hota hai, isliye badi list se dikkat nahi.
// Rebuild: node scripts/build-universe.mjs   (--no-fetch = Yahoo call skip)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { INDUSTRY_MAP, canon } from './sector-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = dirname(fileURLToPath(import.meta.url));
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
    const nseSec = curated.get(symbol) || secMap.get(symbol);
    stocks.push({
      s: symbol,
      n: name.replace(/\s+(Limited|Ltd\.?)$/i, ''),
      sec: nseSec ? canon(nseSec) : 'Other',
      cap: capMap.get(symbol) || 'Micro',
      ...(curated.has(symbol) ? { curated: true } : {})
    });
  }
  stocks.sort((a, b) => a.s.localeCompare(b.s));
  const write = () => writeFileSync(join(ROOT, 'universe.json'), JSON.stringify({
    note: `POORI NSE EQ list (${stocks.length} stocks) — cap tags + sector jahan mile. Scan me bhavcopy turnover se prefilter hota hai. Rebuild: node scripts/build-universe.mjs`,
    builtAt: new Date().toISOString(),
    stocks
  }, null, 1));
  write();   // pass 1: NSE tags — fetch-industries.mjs ko is file ki zarurat hai

  // 5) 'Other' bacho ka sector Yahoo industry cache se bharo.
  // Cache me jo symbols nahi hain unhe fetch kar lo (best-effort — Yahoo block
  // ho jaye ya crumb na mile to chup-chaap aage badho, purana behaviour safe hai).
  const CACHE = join(ROOT, 'industry-cache.json');
  let cachedMap = {};
  try { if (existsSync(CACHE)) cachedMap = JSON.parse(readFileSync(CACHE, 'utf8')).map || {}; } catch { }
  // sirf wo 'Other' jo cache me hai hi nahi (naye listings) — count precise rakho,
  // warna delisting/listing ka hisaab galat ho ke naye stocks bina sector reh jaate hain
  const uncached = stocks.filter(s => s.sec === 'Other' && !(s.s in cachedMap)).length;
  if (uncached && !process.argv.includes('--no-fetch')) {
    // Roz ka scan build-universe ko auto-call karta hai (10 din purana hone pe).
    // Us raste pe 1300-request Yahoo crawl kabhi nahi chalna chahiye — job timeout
    // ho jayega. Chhota gap (naye listings) hi apne aap bharo; bada gap = manual.
    if (uncached > 150) {
      console.log(`\n⚠ ${uncached} stocks cache me nahi — bada gap hai, auto-fetch skip.`);
      console.log('  Manually chalao: node scripts/fetch-industries.mjs');
    } else {
      try {
        console.log(`${uncached} naye stocks ka industry chahiye — Yahoo se laa rahe...`);
        execFileSync(process.execPath, [join(HERE, 'fetch-industries.mjs')], { stdio: 'inherit', timeout: 240000 });
      } catch (e) { console.error('Industry fetch skip (purane cache se chal rahe):', e.message); }
    }
  }
  let filled = 0, unmapped = new Map();
  try {
    const map = JSON.parse(readFileSync(CACHE, 'utf8')).map || {};
    for (const s of stocks) {
      if (s.sec !== 'Other') continue;
      const ind = map[s.s]?.industry;
      if (!ind) continue;
      const sec = INDUSTRY_MAP[ind];
      if (sec) { s.sec = sec; filled++; }
      else unmapped.set(ind, (unmapped.get(ind) || 0) + 1);
    }
  } catch { console.log('industry-cache.json nahi mila — sirf NSE tags se chal rahe.'); }
  write();   // pass 2: Yahoo se bhare hue sectors

  const capCounts = stocks.reduce((m, s) => (m[s.cap] = (m[s.cap] || 0) + 1, m), {});
  const secCounts = stocks.reduce((m, s) => (m[s.sec] = (m[s.sec] || 0) + 1, m), {});
  const withSector = stocks.length - (secCounts['Other'] || 0);
  console.log(`\nuniverse.json: ${stocks.length} stocks | caps:`, capCounts);
  console.log(`Sector tagged: ${withSector}/${stocks.length} (${Math.round(withSector / stocks.length * 100)}%) — Yahoo se ${filled} bhare, ab bhi Other: ${secCounts['Other'] || 0}`);
  console.log(`Sectors (${Object.keys(secCounts).length}):`, Object.entries(secCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' | '));
  if (unmapped.size) console.log(`\nINDUSTRY_MAP me nahi (sector-map.mjs me jodo):`, [...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' | '));
}

main().catch(e => { console.error(e); process.exit(1); });
