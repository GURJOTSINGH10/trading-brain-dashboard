/* Breakout ledger ka audit — data.js ko asli chart se dobara jodke dekho.
   Chalao: node scripts/audit-breakouts.mjs
   scan.mjs ya breakouts.mjs badalne ke BAAD hamesha chalana. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'))(w);
const d = w.DASHBOARD_DATA;
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'journal.json'), 'utf8'));
const bl = d.breakoutLog;
const P = [];
const near = (a, b, t = 0.05) => a == null || b == null ? false : Math.abs(a - b) <= t;

if (!bl || !bl.list) { console.log('breakoutLog hai hi nahi'); process.exit(0); }
const L = bl.list, S = bl.summary;

console.log('=== A. andar ka mel (days array vs upar ke aankde) ===');
for (const b of L) {
  if (!b.days) continue;
  if (b.days.length !== b.sessions) P.push(`${b.symbol}: sessions ${b.sessions} par days ${b.days.length}`);
  const last = b.days[b.days.length - 1];
  if (!near(b.nowPct, last.pct)) P.push(`${b.symbol}: nowPct ${b.nowPct} par akhri din ${last.pct}`);
  if (!near(b.day1VolX, b.days[0].volX)) P.push(`${b.symbol}: day1VolX ${b.day1VolX} par days[0] ${b.days[0].volX}`);
  const minPct = Math.min(...b.days.map(x => x.pct));
  if (!near(b.maxDrawPct, minPct)) P.push(`${b.symbol}: maxDrawPct ${b.maxDrawPct} par sabse neeche ${minPct}`);
  if (b.tractionInSessions != null && b.tractionInSessions >= b.sessions)
    P.push(`${b.symbol}: traction ${b.tractionInSessions}ve session me par kul ${b.sessions}`);
}
console.log('  ' + L.filter(b => b.days).length + ' breakout ke days array jaanche');

console.log('\n=== B. nateeja apne hi niyam pe khara hai? ===');
const bars = bl.bars || { TRACTION_PCT: 10, SQUAT_SESSIONS: 3, MAX_SESSIONS: 40 };
for (const b of L) {
  if (b.outcome === 'traction' && !(b.maxGainPct >= bars.TRACTION_PCT))
    P.push(`${b.symbol}: traction bola par best move sirf ${b.maxGainPct}%`);
  if (b.outcome === 'squat' && (b.sessions - 1) > bars.SQUAT_SESSIONS)
    P.push(`${b.symbol}: squat bola par ${b.sessions - 1} session lage`);
  if (b.outcome === 'fail' && (b.sessions - 1) <= bars.SQUAT_SESSIONS)
    P.push(`${b.symbol}: fail bola par sirf ${b.sessions - 1} session — ye squat hona chahiye`);
  if (b.live && b.endedBy) P.push(`${b.symbol}: live bola par endedBy ${b.endedBy}`);
  if (!b.live && !b.endedBy) P.push(`${b.symbol}: settle bola par endedBy nahi`);
  if (b.sessions > bars.MAX_SESSIONS) P.push(`${b.symbol}: ${b.sessions} session — cap ${bars.MAX_SESSIONS} se zyada`);
  if (b.days && b.endedBy === 'fail') {
    const last = b.days[b.days.length - 1];
    if (!(last.c < b.boLow)) P.push(`${b.symbol}: fail bola par akhri close ${last.c} BO-low ${b.boLow} se upar`);
  }
}
console.log('  ' + L.length + ' breakout ke nateeje jaanche');

console.log('\n=== C. ek hi stock do baar? (alag-alag waqt ke trade alag breakout hone chahiye) ===');
const bySym = {};
for (const b of L) (bySym[b.symbol] = bySym[b.symbol] || []).push(b);
const multi = Object.entries(bySym).filter(([, v]) => v.length > 1);
console.log('  ek se zyada baar aane wale:', multi.length);
for (const [sym, v] of multi) {
  console.log('   ', sym, v.map(x => x.source + '@' + x.boDate).join(', '));
  const ts = v.map(x => x.boTs);
  if (new Set(ts).size !== ts.length) P.push(`${sym}: ek hi boTs par do entry`);
}
// journal me ek hi stock ke alag-alag waqt ke trade hain kya, aur wo ledger me aaye?
/* ⚠️ Sirf wahi pick gino jinka pivot SACH ME cross hua tha.
   'no-trigger' matlab bhaav pivot tak pahuncha hi nahi — uska koi breakout hota
   hi nahi, to ledger me na hona SAHI hai. Pehle audit inhe bhi gin raha tha aur
   9 jhoothe alarm de raha tha.
   Aur alag-alag pick agar EK HI din, EK HI pivot pe break hue to wo ek hi
   breakout hai — isliye pivot ke hisaab se unique gino, pick ke hisaab se nahi. */
const tradeTimes = {};
for (const c of j.closed || []) {
  if (!c.ts || c.status === 'no-trigger') continue;
  (tradeTimes[c.symbol] = tradeTimes[c.symbol] || new Set()).add(c.entry);
}
const missedRepeat = Object.entries(tradeTimes).filter(([sym, set]) =>
  set.size > 1 && (bySym[sym] || []).filter(x => x.source === 'trade').length < set.size);
if (missedRepeat.length) {
  console.log('  ⚠️ jin stocks pe ek se zyada baar trade li par ledger me utni entry nahi:');
  for (const [sym, set] of missedRepeat.slice(0, 8))
    console.log(`     ${sym}: journal me ${set.size} alag pick (${[...set].join(', ')}), ledger me ${(bySym[sym] || []).filter(x => x.source === 'trade').length}`);
  P.push(missedRepeat.length + ' stock pe dobara li gayi trade ledger me nahi aayi');
}

console.log('\n=== D. journal ke nateeje se mel ===');
const wins = (j.closed || []).filter(c => c.pnlPct > 8);
let ok = 0, bad = [];
for (const c of wins) {
  const b = (bySym[c.symbol] || []).find(x => x.source === 'trade');
  if (!b) continue;
  if (b.outcome === 'traction' || b.live) ok++;
  else bad.push(`${c.symbol} journal me +${c.pnlPct}% par ledger me ${b.outcome}`);
}
console.log('  bade winners:', wins.length, '| ledger me traction/live:', ok);
bad.slice(0, 5).forEach(x => console.log('   ⚠️', x));

console.log('\n=== E. delivery % sach me bhar raha hai? ===');
const withDlv = L.filter(b => b.days && b.days.some(x => x.dlv != null));
const totalDlvDays = L.reduce((a, b) => a + (b.days ? b.days.filter(x => x.dlv != null).length : 0), 0);
const totalDays = L.reduce((a, b) => a + (b.days ? b.days.length : 0), 0);
console.log('  delivery wale din:', totalDlvDays, '/', totalDays, '| kitne breakout me kuch bhi delivery:', withDlv.length);
if (totalDays > 100 && totalDlvDays === 0) P.push('delivery column poori tarah khali hai — UI wada karti hai par data aata hi nahi');

console.log('\n=== F. summary vs list ===');
console.log('  summary.total', S.total, '| list me', L.length, '| shown', bl.shown, '| full', bl.total);
const liveL = L.filter(b => b.live).length;
if (bl.total === L.length) {
  const cnt = {}; L.filter(b => !b.live).forEach(b => cnt[b.outcome] = (cnt[b.outcome] || 0) + 1);
  if ((cnt.traction || 0) !== S.traction) P.push(`traction: summary ${S.traction} par list me ${cnt.traction || 0}`);
  if ((cnt.squat || 0) !== S.squat) P.push(`squat: summary ${S.squat} par list me ${cnt.squat || 0}`);
  if ((cnt.fail || 0) !== S.fail) P.push(`fail: summary ${S.fail} par list me ${cnt.fail || 0}`);
  if (liveL !== S.live) P.push(`live: summary ${S.live} par list me ${liveL}`);
} else console.log('  (list cap ho chuki hai — summary poori list se hai, seedhi tulna nahi)');
if (S.settled + S.live !== S.total) P.push(`settled ${S.settled} + live ${S.live} != total ${S.total}`);

console.log('\n=== G. chart se dobara jodo (sample) ===');
const sample = L.filter(b => b.days).slice(0, 6);
for (const b of sample) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${b.symbol}.NS?range=2y&interval=1d`, { headers: { 'User-Agent': UA } });
    const jj = await r.json();
    const R = jj?.chart?.result?.[0]; if (!R) continue;
    const q = R.indicators.quote[0];
    const day = ts => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const i0 = R.timestamp.findIndex(t => day(t) === b.boDate);
    if (i0 < 0) { console.log('  ' + b.symbol + ': breakout ka din chart me nahi mila'); continue; }
    const hiOk = q.high[i0] > b.pivot;
    const lowOk = near(q.low[i0], b.boLow, 0.2);
    // pehla din hona chahiye — usse pehle koi din pivot paar na kiya ho (entry ke baad)
    console.log(`  ${b.symbol.padEnd(12)} BO ${b.boDate} pivot ${b.pivot} | high>${b.pivot}? ${hiOk ? 'haan' : '⚠️ NAHI'} | BO-low mel: ${lowOk ? 'haan' : '⚠️ ' + q.low[i0]}`);
    if (!hiOk) P.push(`${b.symbol}: breakout wale din high pivot se upar gaya hi nahi`);
    if (!lowOk) P.push(`${b.symbol}: boLow ${b.boLow} par chart me ${q.low[i0]}`);
  } catch { }
}

console.log('\n\n================ NATEEJA ================');
if (!P.length) console.log('koi problem nahi mili.');
else { console.log(P.length + ' problem:'); P.forEach(x => console.log('  • ' + x)); }
