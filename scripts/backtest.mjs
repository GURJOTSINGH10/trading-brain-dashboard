// ============================================================
// TRADING BRAIN — Historical Backtest
// Pichhle ~N trading days pe strategy ko din-ba-din replay karta hai:
// har din market gear + ready picks nikale, phir aage track kare
// (breakout hua? SL? target? trail? fail?) — real event-driven sim.
// Output: journal.json ka `closed` array bhar deta hai = Track Record.
// Chalao: node scripts/backtest.mjs [days]   (default 45 trading days)
// ============================================================

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START_CAPITAL = 100000;
const SIZE_BY_GEAR = [10, 14, 17, 21, 25];
const MIN_TRADED_VALUE = 5e7;
const WINDOW = parseInt(process.argv[2] || '45', 10); // kitne trading days peeche
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const last = a => a[a.length - 1];
const avg = (a, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += a[i]; return s / (to - from + 1); };
const round2 = x => Math.round(x * 100) / 100;
const roundPrice = x => x >= 1000 ? Math.round(x) : Math.round(x * 10) / 10;
const fmtShort = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

async function fetchChart(ticker, range = '1y') {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      if (!r?.timestamp) continue;
      const q = r.indicators.quote[0];
      const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      for (let i = 0; i < r.timestamp.length; i++) {
        if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
        out.t.push(r.timestamp[i]); out.o.push(q.open[i] ?? q.close[i]);
        out.h.push(q.high[i]); out.l.push(q.low[i]); out.c.push(q.close[i]); out.v.push(q.volume[i] ?? 0);
      }
      return out.c.length >= 150 ? out : null;
    } catch { }
  }
  return null;
}

// setup detection as-of day di (sirf 0..di data use — no look-ahead)
function readyAt(ch, di) {
  const { c, h, l, v } = ch;
  if (di < 120) return null;
  const close = c[di];
  const s50 = avg(c, di - 49, di), s50p = avg(c, di - 59, di - 10), s10 = avg(c, di - 9, di);
  if (!(close > s50 && s50 > s50p)) return null;
  let tv = 0; for (let i = di - 19; i <= di; i++) tv += c[i] * v[i]; tv /= 20;
  if (tv < MIN_TRADED_VALUE) return null;
  let hiW = -Infinity, loW = Infinity;
  for (let i = di - 14; i <= di; i++) { if (h[i] > hiW) hiW = h[i]; if (l[i] < loW) loW = l[i]; }
  const rangePct = (hiW - loW) / close * 100;
  if (rangePct > 13) return null;
  const pivot = hiW, prox = (pivot - close) / close * 100;
  if (prox > 4.5) return null;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let atr3 = 0, atr20 = 0;
  for (let i = di - 2; i <= di; i++) atr3 += tr(i); atr3 /= 3;
  for (let i = di - 19; i <= di; i++) atr20 += tr(i); atr20 /= 20;
  if (atr3 > atr20 * 1.8) return null;
  const v5 = avg(v, di - 4, di), v20 = avg(v, di - 19, di);
  const volShrink = v5 < v20;
  let hi52 = -Infinity; for (let i = Math.max(0, di - 251); i <= di; i++) if (h[i] > hi52) hi52 = h[i];
  const near52 = close >= hi52 * 0.9;
  let score = (13 - rangePct) * 0.8 + Math.max(0, 4.5 - prox);
  if (volShrink) score += 2.5; if (near52) score += 3; score += Math.min(3, tv / 1e9);
  const swingLow = Math.min(...l.slice(di - 7, di + 1));
  let sl = Math.max(swingLow, pivot * 0.955);
  if ((pivot - sl) / pivot < 0.02) sl = pivot * 0.965;
  return { pivot: roundPrice(pivot), sl: roundPrice(sl), score, s10 };
}

async function main() {
  console.log(`Backtest shuru — pichhle ${WINDOW} trading days...`);
  const universe = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  const charts = {};
  let idx = 0, ok = 0;
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      const ch = await fetchChart(u.s + '.NS');
      if (ch) { charts[u.s] = ch; ok++; }
      await sleep(90);
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`Charts: ${ok}/${universe.length} fetched`);

  // reference timeline (Nifty) taaki dates align rahein
  const ref = await fetchChart('^NSEI');
  const T = ref.t, N = T.length;
  const startDi = Math.max(120, N - WINDOW);

  // per-day gear (breadth se) — simple, monotonic
  function gearAt(di) {
    let ab = 0, tot = 0;
    for (const u of universe) {
      const ch = charts[u.s]; if (!ch || ch.c.length <= di) continue;
      // align: use same index assuming same calendar (NSE stocks + index same sessions)
      const c = ch.c; if (di < 50 || di >= c.length) continue;
      tot++; if (c[di] > avg(c, di - 49, di)) ab++;
    }
    const pct = tot ? ab / tot * 100 : 0;
    const gear = pct >= 65 ? 5 : pct >= 55 ? 4 : pct >= 45 ? 3 : pct >= 35 ? 2 : 1;
    return { gear, pct: Math.round(pct) };
  }

  const closed = [];
  const active = new Map();   // symbol -> position
  const cooldown = new Map(); // symbol -> di tak dobara nahi

  for (let di = startDi; di < N; di++) {
    // 1) existing positions ko aaj (di) ke data se aage badhao
    for (const [sym, p] of [...active]) {
      const ch = charts[sym]; if (!ch || di >= ch.c.length) { continue; }
      const o = ch.o[di], hi = ch.h[di], lo = ch.l[di], cl = ch.c[di];
      const s10 = avg(ch.c, di - 9, di);
      if (p.status === 'pending') {
        const v20 = avg(ch.v, di - 19, di);
        if (hi > p.pivot && ch.v[di] > v20 * 1.2) {
          p.status = 'open'; p.entry = roundPrice(Math.max(o, p.pivot)); p.entryDi = di; p.tDays = 0;
        } else if (++p.wait >= 4) {
          closed.push({ picked: fmtShort(T[p.pickDi]), symbol: sym, sector: p.sector, cap: p.cap, gear: p.gear, entry: p.pivot, status: 'no-trigger', pnlPct: 0, reason: 'Pivot cross nahi hua 4 session me — paisa laga hi nahi' });
          active.delete(sym); cooldown.set(sym, di + 5);
        }
        continue;
      }
      // open position management
      p.tDays++;
      const closeTrade = (status, px, reason) => {
        const pnl = round2((px - p.entry) / p.entry * 100);
        closed.push({ picked: fmtShort(T[p.pickDi]), symbol: sym, sector: p.sector, cap: p.cap, gear: p.gear, entry: p.entry, status, pnlPct: pnl, exitDate: fmtShort(T[di]), reason });
        active.delete(sym); cooldown.set(sym, di + 5);
      };
      if (lo <= p.sl) closeTrade('sl', p.sl, `SL hit ${p.sl} pe — out, end of story`);
      else if (cl >= p.entry * 1.08) closeTrade('win', cl, `+${round2((cl - p.entry) / p.entry * 100)}% — partial book zone, profit liya`);
      else if (cl < s10 && p.tDays >= 2) { const g = (cl - p.entry) / p.entry * 100; closeTrade(g >= 0 ? 'win' : 'fail', cl, g >= 0 ? '10 DMA trail exit — jo mila le liya' : '10 DMA break = story over'); }
      else if (p.tDays >= 3 && cl < p.pivot) closeTrade('fail', cl, `Breakout fail — ${p.tDays} din squat, move nahi aaya, abnormal = out`);
      else if (p.tDays >= 15) closeTrade(cl >= p.entry ? 'win' : 'fail', cl, 'Max hold — position band');
    }

    // 2) aaj ke naye picks (di+1 se track honge)
    if (di > N - 6) continue; // aakhri kuch din pick mat karo (track ke liye jagah nahi)
    const { gear, pct } = gearAt(di);
    if (gear < 2) continue; // choppy/bear — cash
    const maxPicks = gear >= 3 ? 5 : 3;
    const cands = [];
    for (const u of universe) {
      const ch = charts[u.s]; if (!ch || di >= ch.c.length || di < 120) continue;
      if (active.has(u.s)) continue;
      if ((cooldown.get(u.s) || 0) > di) continue;
      const r = readyAt(ch, di); if (!r) continue;
      cands.push({ ...u, ...r });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, maxPicks)) {
      active.set(c.s, { sector: c.sec, cap: c.cap, gear, pivot: c.pivot, sl: c.sl, status: 'pending', wait: 0, pickDi: di });
    }
  }

  // portfolio equity simulate (gear sizing, compounding) — dashboard bhi yahi karta hai
  let equity = START_CAPITAL, wins = 0, losses = 0;
  for (const t of closed) {
    if (t.status === 'no-trigger') continue;
    const sizePct = SIZE_BY_GEAR[Math.max(0, Math.min(4, t.gear - 1))];
    const alloc = equity * sizePct / 100;
    const qty = Math.max(1, Math.floor(alloc / t.entry));
    equity += qty * t.entry * t.pnlPct / 100;
    if (t.pnlPct > 0) wins++; else losses++;
  }
  const closedN = wins + losses;
  console.log(`\nBacktest done: ${closed.length} trades (${closedN} closed, ${closed.length - closedN} no-trigger)`);
  console.log(`Win rate: ${closedN ? Math.round(wins / closedN * 100) : 0}% (${wins}W/${losses}L)`);
  console.log(`Equity: ₹${START_CAPITAL.toLocaleString('en-IN')} → ₹${Math.round(equity).toLocaleString('en-IN')} (${round2((equity - START_CAPITAL) / START_CAPITAL * 100)}%)`);

  // journal.json me daalo — closed = backtest history, positions preserve (live pending)
  let journal = { lastSession: null, equity: START_CAPITAL, positions: [], closed: [] };
  try { journal = JSON.parse(readFileSync(join(ROOT, 'journal.json'), 'utf8')); } catch { }
  journal.closed = closed;
  journal.equity = round2(equity);
  journal.backtestedAt = new Date().toISOString();
  writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(journal, null, 2));
  console.log('journal.json updated — ab scan --force chala ke dashboard refresh karo.');
}

main().catch(e => { console.error(e); process.exit(1); });
