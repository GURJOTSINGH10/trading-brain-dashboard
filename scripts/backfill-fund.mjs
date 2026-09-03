/* ============================================================================
   backfill-fund.mjs — EK BAAR chalane wali script.

   Kyun chahiye: Numbers Check ka stamp 3 Sep 2026 se lagna shuru hua. Us waqt
   watch tracker me 31 naam AUR journal me 5 open positions PEHLE SE chal rahi
   thi. Unpe koi stamp nahi tha, aur scan.mjs sirf NAYE naam pe stamp lagata hai.
   Nateeja: agle 15 session me settle hone wale lagbhag saare naam byMatch me
   ginti me hi nahi aate — yaani imtihaan asal me shuru hi nahi hota.

   ★ CAUSALITY GUARD (project ke test gate ka apna sawaal):
     "ye information decision ke WAQT available thi?"
   Stamp SIRF tab lagta hai jab us stock ka aakhri result us naam ke
   firstSeen / picked se PEHLE broadcast ho chuka tha. Result baad me aaya ho to
   stamp NAHI lagta — warna hum aisa data bhar denge jo faisle ke waqt tha hi
   nahi, aur poora imtihaan jhootha ho jayega.

   Quarterly numbers din-ba-din badalte nahi, isliye jo result pehle se public
   tha uska aaj ka aankda wahi hai jo tab dikhta. Ye backfill us maane me
   imaandaar hai. Har aise stamp pe backfilled: true likha jaata hai.

   Chalao:  node scripts/backfill-fund.mjs           (dry run — sirf batata hai)
            node scripts/backfill-fund.mjs --write   (asli me journal likhta hai)
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFundamentals } from './fundamentals.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const round2 = v => v == null ? null : Math.round(v * 100) / 100;
function bcMs(s) {
  const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s || '');
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  return Date.UTC(+m[3], mon, +m[1], +(m[4] || 0), +(m[5] || 0)) - 5.5 * 3600 * 1000;
}

async function chart(sym) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?range=2y&interval=1d`,
      { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const R = j?.chart?.result?.[0]; if (!R) return null;
    const q = R.indicators.quote[0];
    const out = { t: [], c: [], v: [] };
    for (let i = 0; i < R.timestamp.length; i++) {
      if (q.close[i] == null) continue;
      out.t.push(R.timestamp[i]); out.c.push(q.close[i]); out.v.push(q.volume[i] || 0);
    }
    return out.t.length ? out : null;
  } catch { return null; }
}

const JP = path.join(ROOT, 'journal.json');
const j = JSON.parse(fs.readFileSync(JP, 'utf8'));
const track = j.watchTrack || { names: {}, done: [] };

// kaunse naam pe stamp nahi hai
const needTrack = Object.entries(track.names || {}).filter(([, t]) => !t.fund);
const needPos = (j.positions || []).filter(p => !p.fund);
const syms = [...new Set([...needTrack.map(([s]) => s), ...needPos.map(p => p.symbol)])];

console.log(`Stamp ke bina: ${needTrack.length} tracked naam + ${needPos.length} open position = ${syms.length} unique`);
if (!syms.length) { console.log('Kuch karne ko nahi.'); process.exit(0); }

const charts = new Map();
for (const s of syms) { const c = await chart(s); if (c) charts.set(s, c); }
console.log(`Charts mile: ${charts.size}/${syms.length}`);

const fund = await fetchFundamentals(syms, charts);

function stamp(sym, asOfMs, label) {
  const f = fund.get(sym);
  if (!f) return { skip: 'numbers nahi mile' };
  const rMs = bcMs(f.resultOn);
  if (rMs == null) return { skip: 'result ki date nahi padh paye' };
  // ★ causality: result faisle se PEHLE public hona chahiye
  if (rMs >= asOfMs) return { skip: `result (${f.resultOn}) ${label} ke BAAD aaya — stamp nahi` };
  const legs = f.legs;
  // setup leg backfill me pata nahi chal sakti (us din ready tha ya nahi) —
  // isliye usse chhod dete hain aur matchCount sirf 2 legs pe banta hai
  const n = (legs.growth ? 1 : 0) + (legs.reaction ? 1 : 0);
  return {
    ok: {
      matchCount: n, outOf: 2,
      growth: legs.growth, reaction: legs.reaction,
      growthPct: f.growth && f.growth.profit != null ? Math.round(f.growth.profit) : null,
      growthTag: f.growth ? f.growth.tag : null,
      growthState: f.growth ? f.growth.state : null,
      reactionPct: f.reaction && f.reaction.moveDay != null ? round2(f.reaction.moveDay) : null,
      quarter: f.quarter || null,
      backfilled: true
    }
  };
}

let done = 0, skipped = 0;
console.log('\n--- watch tracker ---');
for (const [sym, t] of needTrack) {
  const r = stamp(sym, (t.firstSeen || 0) * 1000, 'firstSeen');
  if (r.ok) { if (WRITE) t.fund = r.ok; done++; console.log(`  ✓ ${sym.padEnd(12)} ${r.ok.matchCount}/2  (${r.ok.quarter})`); }
  else { skipped++; console.log(`  · ${sym.padEnd(12)} ${r.skip}`); }
}

console.log('\n--- open positions ---');
for (const p of needPos) {
  const r = stamp(p.symbol, (p.pickedTs || 0) * 1000, 'pick');
  if (r.ok) { if (WRITE) p.fund = r.ok; done++; console.log(`  ✓ ${p.symbol.padEnd(12)} ${r.ok.matchCount}/2  (${r.ok.quarter})`); }
  else { skipped++; console.log(`  · ${p.symbol.padEnd(12)} ${r.skip}`); }
}

console.log(`\nStamp lage: ${done} | chhode gaye: ${skipped}`);
if (WRITE) {
  j.watchTrack = track;
  fs.writeFileSync(JP, JSON.stringify(j, null, 2));
  console.log('journal.json likh diya.');
} else {
  console.log('DRY RUN tha — kuch likha nahi. Asli me karne ke liye: node scripts/backfill-fund.mjs --write');
}
