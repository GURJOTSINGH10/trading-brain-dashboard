// Universe builder — NSE ki official index lists se universe.json banata hai.
// Nifty 500 (large+mid+small) + Nifty Microcap 250 = ~750 tradeable stocks.
// Har stock ko cap tag milta hai (Large/Mid/Small/Micro) NSE ki official lists se.
// Curated sectors (Defence, Railways etc.) ko priority — baaki CSV industry se.
// Quarterly re-run karo (index rebalance ke baad): node scripts/build-universe.mjs

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const LISTS = [
  'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv',
  'https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv'
];

// NSE ki official cap classification — in lists se har symbol ko Large/Mid/Small/Micro tag milta hai.
// Order matters: Large sabse pehle (agar kahin overlap ho to bada cap jeet-ta hai).
const CAP_LISTS = [
  ['https://niftyindices.com/IndexConstituent/ind_nifty100list.csv', 'Large'],
  ['https://niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv', 'Mid'],
  ['https://niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv', 'Small'],
  ['https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv', 'Micro']
];

function parseCsvLine(line) {
  // Format: Company Name,Industry,Symbol,Series,ISIN Code
  const f = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  if (f.length < 5) return null;
  return {
    name: f.slice(0, f.length - 4).join(','),
    industry: f[f.length - 4],
    symbol: f[f.length - 3],
    series: f[f.length - 2]
  };
}

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://niftyindices.com/' } });
  if (!res.ok) { console.error(`FAIL ${res.status}: ${url}`); return []; }
  const text = await res.text();
  return text.split(/\r?\n/).slice(1).filter(l => l.trim());
}

async function main() {
  // Step 1: cap map banao (symbol -> Large/Mid/Small/Micro)
  const capMap = new Map();
  for (const [url, cap] of CAP_LISTS) {
    const lines = await fetchCsv(url);
    let n = 0;
    for (const line of lines) {
      const row = parseCsvLine(line);
      if (!row) continue;
      if (!capMap.has(row.symbol)) { capMap.set(row.symbol, cap); n++; }
    }
    console.log(`cap ${cap}: ${n} symbols`);
  }

  // Step 2: curated sectors preserve karo (Defence/Railways granularity CSV me nahi hoti)
  const existing = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  const merged = new Map();
  for (const s of existing) merged.set(s.s, { ...s, cap: s.cap || capMap.get(s.s) || 'Small' });

  // Step 3: Nifty 500 + Microcap se universe fill karo
  for (const url of LISTS) {
    const lines = await fetchCsv(url);
    let added = 0;
    for (const line of lines) {
      const row = parseCsvLine(line);
      if (!row || row.series !== 'EQ') continue; // sirf EQ series — T2T/BE nahi
      const cap = capMap.get(row.symbol) || 'Small';
      if (merged.has(row.symbol)) {
        // curated stock ka sector rakho, lekin cap update kar do
        merged.get(row.symbol).cap = capMap.get(row.symbol) || merged.get(row.symbol).cap;
        continue;
      }
      merged.set(row.symbol, {
        s: row.symbol,
        n: row.name.replace(/\s+(Limited|Ltd\.?)$/i, ''),
        sec: row.industry || 'Other',
        cap
      });
      added++;
    }
    console.log(`${url.split('/').pop()}: +${added} naye symbols`);
  }

  const stocks = [...merged.values()].sort((a, b) => a.s.localeCompare(b.s));
  const capCounts = stocks.reduce((m, s) => (m[s.cap] = (m[s.cap] || 0) + 1, m), {});
  writeFileSync(join(ROOT, 'universe.json'), JSON.stringify({
    note: `NSE universe — Nifty 500 + Microcap 250 + curated momentum list (${stocks.length} stocks) with cap tags. SME/T2T excluded. Rebuild: node scripts/build-universe.mjs`,
    stocks
  }, null, 1));
  console.log(`universe.json: total ${stocks.length} stocks | caps:`, capCounts);
}

main().catch(e => { console.error(e); process.exit(1); });
