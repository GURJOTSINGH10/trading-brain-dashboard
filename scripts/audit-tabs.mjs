/* Positions / Track Record / Scan / Watchlist tabs ka audit.
   Chalao: node scripts/audit-tabs.mjs
   Dikhaye gaye har number ko journal.json se dobara jodta hai.
   Doosre tabs ka audit — data.js aur journal.json ko aapas me milaake dekho */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = {}; new Function('window', fs.readFileSync(path.join(ROOT,'data.js'), 'utf8'))(w);
const d = w.DASHBOARD_DATA;
const j = JSON.parse(fs.readFileSync(path.join(ROOT,'journal.json'), 'utf8'));
const P = [];
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

console.log('=== POSITIONS TAB ===');
const ps = d.positions || [];
console.log('  data.js positions:', ps.length, '| journal open:', j.positions.filter(p => p.entryStatus === 'open').length,
  '| journal pending:', j.positions.filter(p => p.entryStatus === 'pending').length);
for (const p of ps) {
  const src = j.positions.find(x => x.symbol === p.symbol);
  if (!src) { P.push(p.symbol + ': data.js me hai par journal me nahi'); continue; }
  // P&L ka hisaab
  const calcPct = (p.cmp - p.entry) / p.entry * 100;
  if (!near(calcPct, p.pnlPct, 0.15)) P.push(`${p.symbol}: pnlPct ${p.pnlPct} par hisaab ${calcPct.toFixed(2)}`);
  // pnlAmt = invested * pnlPct/100, aur pnlPct 2 decimal pe round hota hai.
  // Isliye (cmp-entry)*qty se thoda farak AAYEGA — wo rounding hai, bug nahi.
  const calcAmt = (p.invested || 0) * p.pnlPct / 100;
  const tol = Math.max(2, (p.invested || 0) * 0.00005 + 1);
  if (!near(calcAmt, p.pnlAmt, tol)) P.push(`${p.symbol}: pnlAmt ${p.pnlAmt} par hisaab ${calcAmt.toFixed(0)}`);
  const calcInv = p.entry * p.qty;
  if (!near(calcInv, p.invested, 2)) P.push(`${p.symbol}: invested ${p.invested} par entry*qty ${calcInv.toFixed(0)}`);
  // rail: SL < cmp < bookAt hona chahiye warna bar range se bahar
  if (p.sl != null && p.bookAt != null && p.sl >= p.bookAt) P.push(`${p.symbol}: SL ${p.sl} >= bookAt ${p.bookAt}`);
  if (p.sl != null && p.cmp < p.sl) console.log(`  ⚠️ ${p.symbol}: cmp ${p.cmp} SL ${p.sl} ke NEECHE hai — abhi tak exit kyun nahi hua?`);
  if (p.trail != null && p.trail > p.cmp) console.log(`  ⚠️ ${p.symbol}: trail ${p.trail} cmp ${p.cmp} ke UPAR hai`);
  console.log(`  ${p.symbol.padEnd(12)} entry ${p.entry} cmp ${p.cmp} qty ${p.qty} pnl ${p.pnlPct}% (${p.pnlAmt}) booked=${!!p.booked} trail=${p.trail ?? '-'}`);
}
const dep = ps.reduce((a, p) => a + (p.invested || 0), 0);
if (d.deployed != null && !near(dep, d.deployed, 5)) P.push(`deployed ${d.deployed} par positions ka jod ${dep.toFixed(0)}`);
console.log('  deployed:', d.deployed, '| jod:', Math.round(dep));

console.log('\n=== TRACK RECORD TAB ===');
const jr = d.journal || [];
console.log('  data.js journal rows:', jr.length, '| journal.json closed:', j.closed.length, '+ positions:', j.positions.length);
const closed = jr.filter(r => r.status !== 'open' && r.status !== 'pending');
const wins = closed.filter(r => (r.pnlPct ?? 0) > 0).length;
console.log('  closed rows:', closed.length, '| wins:', wins, '| win rate:', closed.length ? Math.round(wins / closed.length * 100) + '%' : '-');
const counted = jr.filter(r => ['win','sl','fail'].includes(r.status));
console.log('  win-rate me ginti:', counted.length, '(backtest-seeded ' + counted.filter(r=>r.bt).length + ', live ' + counted.filter(r=>!r.bt).length + ')');
// har row ka status vaajib hai?
const okStatus = new Set(['open', 'pending', 'sl', 'target', 'trail', 'squat', 'book', 'exit', 'closed', 'timeout']);
const badStatus = [...new Set(jr.map(r => r.status).filter(s => !okStatus.has(s)))];
if (badStatus.length) console.log('  status jo pehchane nahi:', badStatus.join(', '));
// equity curve
const eq = (d.strategyTest && d.strategyTest.curve) || [];
console.log('  strategyTest curve points:', eq.length);
// duplicate rows
// ⚠️ Ek stock+picked pe DO row hona normal hai: +10% pe aadha book, baaki 40 DMA
// pe trail. Wo ek trade ke do HISSE hain, duplicate nahi. Asli duplicate wahi hai
// jahan exitDate bhi same ho.
const seen = new Map();
for (const r of jr) {
  const k = r.symbol + '|' + (r.picked || '') + '|' + (r.exitDate || '') + '|' + (r.status || '');
  seen.set(k, (seen.get(k) || 0) + 1);
}
const dup = [...seen.entries()].filter(([, n]) => n > 1);
if (dup.length) { console.log('  ⚠️ asli duplicate:', dup.slice(0, 5).map(([k, n]) => k + ' x' + n).join(', ')); P.push('journal me ' + dup.length + ' asli duplicate row'); }
else console.log('  asli duplicate: koi nahi (aadha-book wale jode alag cheez hain)');
// P&L jod
// closed rows me pnlAmt nahi hota — invested aur pnlPct hote hain
const realized = j.closed.reduce((a, c) => a + (c.invested || 0) * (c.pnlPct || 0) / 100, 0);
const expectedEq = (d.portfolio.startCapital || 600000) + realized;
console.log('  journal equity:', j.equity, '| startCapital + realized =', Math.round(expectedEq));
if (!near(j.equity, expectedEq, 5)) P.push(`equity ${j.equity} par startCapital+realized ${expectedEq.toFixed(0)}`);

console.log('\n=== SCAN TAB ===');
console.log('  gear:', d.market.gear, '| checks:', (d.market.checks || []).length);
console.log('  hotSectors:', (d.hotSectors || []).length, '| sectorPlays:', (d.sectorPlays || []).length);
console.log('  readyCount:', d.readyCount, '| candidateCount:', d.candidateCount);
if (d.readyCount > d.candidateCount) P.push('readyCount candidateCount se zyada');
for (const sp of d.sectorPlays || []) {
  if (!sp.stocks.length) P.push(sp.name + ': sector play me koi stock nahi');
  const ranks = sp.stocks.map(x => x.rank);
  if (ranks.join() !== ranks.slice().sort((a, b) => a - b).join()) P.push(sp.name + ': rank sorted nahi');
}
const lp = d.lastPicks;
console.log('  lastPicks:', lp ? (lp.date + ' — ' + (lp.picks||[]).length + ' pick, ' + lp.triggered + ' trigger hue') : 'koi nahi');
console.log('  universeHealth:', JSON.stringify(d.universeHealth).slice(0, 150));
const uh = d.universeHealth || {};
if (uh.scanned > uh.fetched) P.push('universeHealth: scanned > fetched');
if (uh.prefiltered > uh.listed) P.push('universeHealth: prefiltered > listed');

console.log('\n=== WATCHLIST TAB ===');
console.log('  watchlist:', (d.watchlist || []).length, '| fund:', d.fund ? d.fund.count : 0);
for (const wl of d.watchlist || []) {
  if (wl.pivot == null || wl.cmp == null) { P.push(wl.symbol + ': pivot/cmp missing'); continue; }
  const prox = (wl.pivot - wl.cmp) / wl.cmp * 100;
  if (wl.prox != null && !near(Math.abs(prox), Math.abs(wl.prox), 0.6))
    P.push(`${wl.symbol}: prox ${wl.prox} par hisaab ${prox.toFixed(2)}`);
  if (wl.sl != null && wl.sl >= wl.pivot) P.push(`${wl.symbol}: SL ${wl.sl} pivot ${wl.pivot} se upar`);
}
const ws = d.watchStats || {};
console.log('  watchStats: tracking', ws.trackingCount, 'settled', ws.settled, 'matchTracked', ws.matchTracked);
if (ws.matchTracked > ws.trackingCount) P.push('matchTracked trackingCount se zyada');

console.log('\n\n================ NATEEJA ================');
if (!P.length) console.log('koi problem nahi mili.');
else { console.log(P.length + ' problem:'); P.forEach(x => console.log('  • ' + x)); }
