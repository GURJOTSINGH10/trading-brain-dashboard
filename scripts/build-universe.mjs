// Universe builder — NSE ki official index lists se universe.json banata hai.
// Nifty 500 (large+mid+small) + Nifty Microcap 250 = ~750 tradeable stocks.
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

function parseCsvLine(line) {
  // Format: Company Name,Industry,Symbol,Series,ISIN Code
  // Company name me comma ho sakta hai — end se parse karo
  const f = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  if (f.length < 5) return null;
  return {
    name: f.slice(0, f.length - 4).join(','),
    industry: f[f.length - 4],
    symbol: f[f.length - 3],
    series: f[f.length - 2]
  };
}

async function main() {
  // curated sectors preserve karo (Defence/Railways jaisi granularity CSV me nahi hoti)
  const existing = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  const curated = new Map(existing.map(s => [s.s, s]));

  const merged = new Map();
  for (const [sym, s] of curated) merged.set(sym, s);

  for (const url of LISTS) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://niftyindices.com/' } });
    if (!res.ok) { console.error(`FAIL ${res.status}: ${url}`); continue; }
    const text = await res.text();
    const lines = text.split(/\r?\n/).slice(1).filter(l => l.trim());
    let added = 0;
    for (const line of lines) {
      const row = parseCsvLine(line);
      if (!row || row.series !== 'EQ') continue; // sirf EQ series — T2T/BE nahi
      if (merged.has(row.symbol)) continue;       // curated sector jeet-ta hai
      merged.set(row.symbol, {
        s: row.symbol,
        n: row.name.replace(/\s+(Limited|Ltd\.?)$/i, ''),
        sec: row.industry || 'Other'
      });
      added++;
    }
    console.log(`${url.split('/').pop()}: +${added} naye symbols`);
  }

  const stocks = [...merged.values()].sort((a, b) => a.s.localeCompare(b.s));
  writeFileSync(join(ROOT, 'universe.json'), JSON.stringify({
    note: `NSE universe — Nifty 500 + Microcap 250 + curated momentum list (${stocks.length} stocks). SME/T2T excluded. Rebuild: node scripts/build-universe.mjs`,
    stocks
  }, null, 1));
  console.log(`universe.json: total ${stocks.length} stocks`);
}

main().catch(e => { console.error(e); process.exit(1); });
