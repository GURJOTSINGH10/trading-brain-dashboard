// ============================================================
// TRADING BRAIN — Historical Backtest (long window, live-faithful)
//
// Pichhle N trading days ko din-ba-din replay karta hai — har din wahi kaam jo
// scan.mjs live me karta hai: gear nikalo → hot sectors nikalo → adaptive base
// wale ready setups dhundo → gear ke hisaab se picks lo → agle dino me track karo
// (breakout? SL? +8% book? 10 DMA trail? squat fail?).
//
// KYUN REWRITE (Aug 2026):
//  1. Window chhota tha (45 din, ~70 closed trades) — us par win-rate maanna
//     coin toss pe bharosa karna tha. Ab default 250 trading days (~12 mahine).
//  2. Purana backtest DUSRE rules pe chal raha tha: fixed 15-din base window,
//     purani scoring, na cap-preference, na hot-sector bonus, na gear-wise picks.
//     Matlab hum jo system chala rahe hain, uska test hi nahi ho raha tha.
//     Ab setup detection + scoring + position management scan.mjs ke barabar hai.
//  3. Purana code stock ke index (di) ko Nifty ke index se SEEDHA match karta tha
//     ("same calendar maan lo"). Jo stock baad me list hua ya jiske beech din
//     missing the, uska poora data date-shift ho jaata tha = jhoothi trades.
//     Ab har stock ki timeline reference (Nifty) timeline pe ALIGN hoti hai.
//
// JAAN-BUJH KE ALAG (live se divergence — report me bhi chhapta hai):
//  - Earnings guard nahi hai. NSE board-meeting calendar sirf AAGE ke 21 din ka
//    milta hai, history nahi. To backtest ke numbers thode NEECHE aane chahiye
//    live se — kyunki live me result-wale breakouts skip hote hain.
//  - Delivery % nahi hai (bhavcopy history bulk me nahi milti). Scan bhi isse
//    sirf display me dikhata hai, filter/score me nahi — to farak nahi padta.
//
// Chalao:  node scripts/backtest.mjs [days] [--refresh] [--write]
//   days      kitne trading days peeche (default 250 ≈ 12 mahine)
//   --refresh chart cache ignore karke Yahoo se dobara laao
//   --write   journal.json ka closed[] isse replace karo (dashboard track record)
// Bina --write ke sirf report chhapti hai — journal ko haath nahi lagta.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'charts-2y.json.gz');

const START_CAPITAL = 100000;
const SIZE_BY_GEAR = [10, 14, 17, 21, 25];
const MIN_TRADED_VALUE = 5e7;      // ₹5 Cr avg daily traded value (scan.mjs ke barabar)
const WARMUP = 120;                // itne bars ke bina koi setup nahi (scan: n < 120 → skip)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const args = process.argv.slice(2);
const WINDOW = parseInt(args.find(a => /^\d+$/.test(a)) || '250', 10);
const REFRESH = args.includes('--refresh');
const WRITE = args.includes('--write');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round2 = x => Math.round(x * 100) / 100;
const roundPrice = x => x >= 1000 ? Math.round(x) : Math.round(x * 10) / 10;
const IST = 'Asia/Kolkata';
const fmtShort = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const fmtMonth = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, month: 'short', year: '2-digit' });
// IST din-number — do timestamps ek hi trading din ke hain ya nahi, ye batata hai
const istDay = ts => Math.floor((ts + 19800) / 86400);

// ---------- fetch ----------
async function fetchChart(ticker, range = '2y') {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`, { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(2500); continue; }
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      if (!r?.timestamp) continue;
      const q = r.indicators.quote[0];
      const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      for (let i = 0; i < r.timestamp.length; i++) {
        if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
        out.t.push(r.timestamp[i]);
        out.o.push(round2(q.open[i] ?? q.close[i]));
        out.h.push(round2(q.high[i])); out.l.push(round2(q.low[i])); out.c.push(round2(q.close[i]));
        out.v.push(q.volume[i] ?? 0);
      }
      // market-hours me Yahoo aaj ka ADHURA candle deta hai — usse backtest ka
      // aakhri din ganda hota hai. 15:35 IST se pehle aaj ka bar hata do.
      const p = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
      const g = t => p.find(x => x.type === t).value;
      const nowMins = (+g('hour') % 24) * 60 + +g('minute');
      const nowDay = Math.floor((Date.now() / 1000 + 19800) / 86400);
      if (out.t.length && istDay(out.t[out.t.length - 1]) === nowDay && nowMins < 935) {
        for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) out[k].pop();
      }
      return out.c.length >= WARMUP + 10 ? out : null;
    } catch { }
  }
  return null;
}

// 2000+ stocks ki 2-saal history laane me ~10 min lagte hain. Ek baar la ke gzip
// cache me rakho — rules tweak karke dobara backtest chalana turant ho jaata hai.
async function loadCharts(universe) {
  if (!REFRESH && existsSync(CACHE_FILE)) {
    try {
      const j = JSON.parse(gunzipSync(readFileSync(CACHE_FILE)).toString('utf8'));
      const ageH = (Date.now() - new Date(j.builtAt).getTime()) / 3600000;
      console.log(`Chart cache mila: ${Object.keys(j.charts).length} stocks, ${ageH.toFixed(1)}h purana (--refresh se naya laao)`);
      return j.charts;
    } catch { console.log('Cache corrupt — dobara fetch.'); }
  }
  console.log(`${universe.length} stocks ki 2-saal history laa rahe (~10 min, ek hi baar)...`);
  const charts = {};
  let idx = 0, ok = 0, t0 = Date.now();
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      const ch = await fetchChart(u.s + '.NS');
      if (ch) { charts[u.s] = ch; ok++; }
      if (idx % 250 === 0) console.log(`  ${idx}/${universe.length} (mile ${ok}, ${Math.round((Date.now() - t0) / 1000)}s)`);
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, gzipSync(JSON.stringify({ builtAt: new Date().toISOString(), range: '2y', charts })));
  console.log(`Charts: ${ok}/${universe.length} — cache likh diya (${(existsSync(CACHE_FILE) ? readFileSync(CACHE_FILE).length / 1e6 : 0).toFixed(1)} MB)`);
  return charts;
}

// ---------- rolling helpers ----------
// O(n) sliding-window max/min (monotonic deque) — 252-din high har din ke liye
// naive tarike se nikalna 250M+ operations tha, isse 1M me ho jaata hai.
function rollMax(a, w) {
  const out = new Float64Array(a.length), dq = [];
  for (let i = 0; i < a.length; i++) {
    while (dq.length && a[dq[dq.length - 1]] <= a[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - w) dq.shift();
    out[i] = a[dq[0]];
  }
  return out;
}
function rollMin(a, w) {
  const out = new Float64Array(a.length), dq = [];
  for (let i = 0; i < a.length; i++) {
    while (dq.length && a[dq[dq.length - 1]] >= a[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - w) dq.shift();
    out[i] = a[dq[0]];
  }
  return out;
}
const prefix = a => { const p = new Float64Array(a.length + 1); for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i]; return p; };
// sma jo index i pe khatam hoti hai (i included), n bars ki
const smaAt = (p, i, n) => (i + 1 - n < 0) ? null : (p[i + 1] - p[i + 1 - n]) / n;

// stock ki apni timeline ko reference (Nifty) timeline pe map karo.
// return: Int32Array length N — refIdx di ke liye stock ka index, ya -1 (us din trade nahi hua)
function alignTo(refDays, stockDays) {
  const map = new Int32Array(refDays.length).fill(-1);
  let si = 0;
  for (let di = 0; di < refDays.length; di++) {
    while (si < stockDays.length && stockDays[si] < refDays[di]) si++;
    if (si < stockDays.length && stockDays[si] === refDays[di]) map[di] = si;
  }
  return map;
}

// har stock ka derived data ek baar bana lo — main loop me sab O(1) ho jaata hai
function prepare(ch, refDays) {
  const { t, h, l, c, v } = ch;
  const days = t.map(istDay);
  const n = c.length;
  const tv = new Float64Array(n);
  for (let i = 0; i < n; i++) tv[i] = c[i] * v[i];
  const trArr = new Float64Array(n);
  for (let i = 1; i < n; i++) trArr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  trArr[0] = h[0] - l[0];
  const bigArr = new Float64Array(n);
  for (let i = 0; i < n; i++) bigArr[i] = ((h[i] - l[i]) / c[i] * 100 >= 5) ? 1 : 0;
  const hi252 = rollMax(h, 252);
  const lo252 = rollMin(l, 252);
  const hi15 = rollMax(h, 15);           // aaj sameta — pichhle-15 ke liye i-1 use karenge
  return {
    ...ch, n,
    map: alignTo(refDays, days),
    pc: prefix(c), pv: prefix(v), ptv: prefix(tv), ptr: prefix(trArr), pbig: prefix(bigArr),
    hi252, lo252, hi15
  };
}

// ---------- setup detection (scan.mjs ke barabar) ----------
function setupAt(S, si, hot) {
  const { h, l, c, v } = S;
  if (si < WARMUP) return null;
  const close = c[si];

  const s50 = smaAt(S.pc, si, 50), s50p = smaAt(S.pc, si - 10, 50), s10 = smaAt(S.pc, si, 10);
  if (s50 == null || s50p == null) return null;
  if (!(close > s50 && s50 > s50p)) return null;                       // above rising 50 DMA

  const tv = (S.ptv[si + 1] - S.ptv[si + 1 - 20]) / 20;
  if (tv < MIN_TRADED_VALUE) return null;                              // liquidity floor

  // ADAPTIVE base: 6-30 din me se sabse LAMBA valid base (scan.mjs ka bestBase)
  // strict (pick-worthy): >=8 din, range <=13%, pivot se <=4.5% door
  // loose  (watch-worthy): >=6 din, range <=16%, pivot se <=8% door
  let hh = -Infinity, ll = Infinity, strict = null, loose = null;
  for (let w = 1; w <= 30 && w <= si; w++) {
    const i = si - w + 1;
    if (h[i] > hh) hh = h[i];
    if (l[i] < ll) ll = l[i];
    if (w < 6) continue;
    const rp = (hh - ll) / close * 100, px = (hh - close) / close * 100;
    if (rp <= 16 && px <= 8) loose = { win: w, hiW: hh, rangePct: rp, prox: px };
    if (w >= 8 && rp <= 13 && px <= 4.5) strict = { win: w, hiW: hh, rangePct: rp, prox: px };
  }
  const base = strict || loose;
  if (!base) return null;
  const { win, hiW, rangePct, prox } = base;
  const pivot = hiW;

  const atr3 = (S.ptr[si + 1] - S.ptr[si - 2]) / 3;
  const atr20 = (S.ptr[si + 1] - S.ptr[si + 1 - 20]) / 20;
  if (atr3 > atr20 * 2.2) return null;                                  // bilkul wild = bahar
  const isReady = !!strict && atr3 <= atr20 * 1.8;

  const v5 = smaAt(S.pv, si, 5), v20 = smaAt(S.pv, si, 20);
  const volShrink = v5 < v20;
  const near52 = close >= S.hi252[si] * 0.9;
  const big = S.pbig[si + 1] - S.pbig[si + 1 - 60];
  const fivePct = big >= 3;

  let score = 0;
  score += (13 - rangePct) * 0.8;
  score += Math.min(3, (win - 6) * 0.15);
  score += Math.max(0, 4.5 - prox);
  if (volShrink) score += 2.5;
  if (near52) score += 3;
  if (fivePct) score += 2;
  if (hot) score += 4;
  score += S.capPref;

  let sl = Math.max(Math.min(...l.slice(si - 7, si + 1)), pivot * 0.955);
  if ((pivot - sl) / pivot < 0.02) sl = pivot * 0.965;

  return { pivot: roundPrice(pivot), sl: roundPrice(sl), score, isReady, win, rangePct: round2(rangePct) };
}

// ---------- costs (Zerodha delivery, equity) ----------
// User ne khud dekha tha ki chhoti capital pe DP charge edge kha jaata hai —
// isliye report me gross ke saath net bhi chhapta hai.
function tradeCost(buyVal, sellVal) {
  const stt = 0.001 * (buyVal + sellVal);
  const txn = 0.0000297 * (buyVal + sellVal);
  const sebi = 0.000001 * (buyVal + sellVal);
  const stamp = 0.00015 * buyVal;
  const gst = 0.18 * (txn + sebi);
  const dp = 15.93;                        // per sell scrip
  return stt + txn + sebi + stamp + gst + dp;
}

// ---------- main ----------
async function main() {
  console.log(`Backtest: pichhle ${WINDOW} trading days | rules = scan.mjs live wale`);
  const universe = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;

  const raw = await loadCharts(universe);
  const nifty = await fetchChart('^NSEI');
  const cnxsc = await fetchChart('^CNXSC') || nifty;
  if (!nifty) { console.error('Nifty data nahi mila — abort'); process.exit(1); }

  const T = nifty.t, N = T.length;
  const refDays = T.map(istDay);
  console.log(`Reference timeline: ${N} sessions (${fmtShort(T[0])} → ${fmtShort(T[N - 1])})`);

  // smallcap index ka apna alignment + moving averages (gear ke liye)
  const scMap = alignTo(refDays, cnxsc.t.map(istDay));
  const scPc = prefix(cnxsc.c);

  const capPref = { Micro: 3, Small: 3, Mid: 1.5, Large: -6 };
  const stocks = [];
  for (const u of universe) {
    const ch = raw[u.s];
    if (!ch || ch.c.length < WARMUP + 10) continue;
    const S = prepare(ch, refDays);
    S.sym = u.s; S.sec = u.sec; S.cap = u.cap || 'Small';
    S.capPref = capPref[S.cap] ?? 2.5;
    stocks.push(S);
  }
  console.log(`Prepared: ${stocks.length} stocks (universe ${universe.length})`);

  const startDi = Math.max(WARMUP, N - WINDOW);
  console.log(`Replay: ${fmtShort(T[startDi])} → ${fmtShort(T[N - 1])} (${N - startDi} sessions)\n`);

  // ---- per-day market gear (scan.mjs ka poora 8-point score) ----
  function marketAt(di) {
    const sci = scMap[di];
    let above10 = false, above50 = false, rising50 = false, holdDays = 0;
    if (sci >= 60) {
      const now = cnxsc.c[sci];
      const s10 = smaAt(scPc, sci, 10), s50 = smaAt(scPc, sci, 50), s50p = smaAt(scPc, sci - 10, 50);
      above10 = now > s10; above50 = now > s50; rising50 = s50 > s50p;
      for (let i = sci; i >= 50; i--) { const s = smaAt(scPc, i, 50); if (cnxsc.c[i] > s) holdDays++; else break; }
    }

    let adv = 0, dec = 0, ab50 = 0, hi52 = 0, lo52 = 0, total = 0;
    let boWork = 0, boFlat = 0, boFail = 0;
    for (const S of stocks) {
      const si = S.map[di];
      if (si < 1 || si < 50) continue;
      total++;
      const c = S.c;
      if (c[si] > c[si - 1]) adv++; else dec++;
      const s50 = smaAt(S.pc, si, 50);
      if (s50 && c[si] > s50) ab50++;
      if (c[si] >= S.hi252[si] * 0.97) hi52++;
      if (c[si] <= S.lo252[si] * 1.05) lo52++;

      // Breakouts working? — pichhle 5 din ka sabse recent volume-backed breakout
      const v20 = smaAt(S.pv, si, 20) || 0;
      for (let i = si; i >= si - 4 && i >= 16; i--) {
        const priorHigh = S.hi15[i - 1];
        if (c[i] > priorHigh && S.v[i] > v20 * 1.2) {
          const gain = (c[si] - priorHigh) / priorHigh * 100;
          if (gain < -0.5) boFail++; else if (gain >= 2) boWork++; else boFlat++;
          break;
        }
      }
    }
    const pctAb50 = total ? Math.round(ab50 / total * 100) : 0;
    const boTotal = boWork + boFlat + boFail;
    const boWorkPct = boTotal ? Math.round(boWork / boTotal * 100) : null;
    const boFailPct = boTotal ? Math.round(boFail / boTotal * 100) : null;

    let score = 0;
    if (above10) score++;
    if (above50) score++;
    if (rising50) score++;
    if (holdDays >= 4) score++;
    if (pctAb50 >= 55) score++; else if (pctAb50 < 40) score--;
    if (adv > dec) score++;
    if (hi52 >= Math.max(3, total * 0.04)) score++;
    if (boTotal >= 6) {
      if (boWorkPct >= 45 && boFailPct < 30) score++;
      else if (boWorkPct < 30) score -= 2;
    }

    let gear = (!above10 && !above50) ? 1 : Math.max(1, Math.min(5, Math.round(score * 5 / 8)));
    if (boTotal >= 6 && boWorkPct < 35) gear = Math.min(gear, 3);
    if (boTotal >= 6 && boWorkPct < 25) gear = Math.min(gear, 2);
    return { gear, pctAb50 };
  }

  // ---- per-day hot sectors (scan.mjs ka sector heat) ----
  const bySector = {};
  for (const S of stocks) (bySector[S.sec] = bySector[S.sec] || []).push(S);
  function hotAt(di) {
    const out = [];
    for (const [name, list] of Object.entries(bySector)) {
      if (name === 'Other' || name === 'Diversified' || list.length < 3) continue;
      let ret5 = 0, up = 0, volR = 0, vn = 0, cnt = 0;
      for (const S of list) {
        const si = S.map[di];
        if (si < 25) continue;
        cnt++;
        ret5 += (S.c[si] - S.c[si - 5]) / S.c[si - 5] * 100;
        let ups = 0; for (let i = si - 3; i <= si; i++) if (S.c[i] > S.c[i - 1]) ups++;
        if (ups >= 3) up++;
        const v5 = smaAt(S.pv, si, 5), v20 = smaAt(S.pv, si, 20);
        if (v20 > 0) { volR += v5 / v20; vn++; }
      }
      if (cnt < 3) continue;
      ret5 /= cnt; volR = vn ? volR / vn : 1;
      if (ret5 > 1.5 && (up / cnt >= 0.4 || volR > 1.15)) out.push({ name, heat: ret5 + (up / cnt) * 3 + (volR - 1) * 4 });
    }
    out.sort((a, b) => b.heat - a.heat);
    return new Set(out.slice(0, 4).map(s => s.name));
  }

  // ---- replay ----
  const closed = [];
  const active = new Map();
  let equity = START_CAPITAL;
  let deployed = 0;                 // abhi kitna paisa positions me phasa hua hai
  const gearDays = [0, 0, 0, 0, 0, 0];
  let maxConcurrent = 0, maxDeployPct = 0, skippedNoCash = 0;

  for (let di = startDi; di < N; di++) {
    // 1) purani positions ko aaj ke data se aage badhao
    for (const [sym, p] of [...active]) {
      const S = p.S, si = S.map[di];
      if (si < 0) continue;                                  // stock aaj trade nahi hua
      const o = S.o[si], hi = S.h[si], lo = S.l[si], cl = S.c[si];

      const close = (status, px, reason) => {
        const pnlPct = round2((px - p.entry) / p.entry * 100);
        const pnlAmt = p.invested * pnlPct / 100;
        equity = round2(equity + pnlAmt);
        deployed = Math.max(0, round2(deployed - p.invested));   // paisa wapas cash me
        closed.push({
          picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
          entry: p.entry, status, pnlPct, exitDate: fmtShort(T[di]), reason,
          _exitTs: T[di], _pickTs: T[p.pickDi], _hold: p.tDays || 0,
          _buyVal: p.invested, _sellVal: round2(p.qty * px)
        });
        active.delete(sym);
      };

      if (p.status === 'pending') {
        const v20 = smaAt(S.pv, si, 20) || 0;
        if (hi > p.pivot && S.v[si] > v20 * 1.2) {
          // ★ CASH CONSTRAINT — ₹1 lakh me 29 positions ek saath nahi khul sakti.
          // Bina iske backtest chup-chaap 5x leverage maan leta tha aur returns
          // jhoothe achhe dikhte the. Paisa nahi hai to trade nahi hoti — bas.
          const alloc = equity * p.sizePct / 100;
          if (deployed + alloc > equity) {
            skippedNoCash++;
            closed.push({
              picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
              entry: p.pivot, status: 'no-cash', pnlPct: 0,
              reason: 'Breakout to aaya, par capital pehle se lagi hui thi — ye trade chhoot gayi',
              _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
            });
            active.delete(sym);
            continue;
          }
          p.status = 'open';
          p.entry = roundPrice(Math.max(o, p.pivot));
          p.qty = Math.max(1, Math.floor(alloc / p.entry));
          p.invested = round2(p.qty * p.entry);
          deployed = round2(deployed + p.invested);
          if (deployed / equity * 100 > maxDeployPct) maxDeployPct = deployed / equity * 100;
          p.tDays = 0;
          // ★ SAME-DAY SL — breakout aur stop ek hi din me ho sakte hain (GNA, 4 Aug)
          if (lo <= p.sl) close('sl', p.sl, `Entry ke din hi SL ${p.sl} hit — breakout turant fail, same-day out`);
        } else if (++p.wait >= 4) {
          closed.push({
            picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
            entry: p.pivot, status: 'no-trigger', pnlPct: 0,
            reason: 'Pivot cross nahi hua 4 session me — list se bahar, paisa laga hi nahi',
            _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
          });
          active.delete(sym);
        }
        continue;
      }

      // open position management — scan.mjs ke exact rules (koi max-hold cap nahi,
      // 10 DMA trail hi natural exit hai)
      p.tDays++;
      const s10 = smaAt(S.pc, si, 10);
      // ★ GAP-DOWN — agar stock SL ke NEECHE khula hai to SL ka bhaav milta hi nahi,
      // open pe hi nikalna padta hai. Bina iske backtest har SL ko exact bhaav pe
      // bhar deta tha = losses asli se chhote dikhte the.
      if (lo <= p.sl) {
        const gap = o < p.sl;
        close('sl', gap ? o : p.sl, gap
          ? `Gap-down — SL ${p.sl} tha, stock ${roundPrice(o)} pe khula. Bhaav mila hi nahi, open pe out.`
          : `SL hit ${p.sl} pe — out, end of story. Sell is a sell.`);
      }
      else if (cl >= p.entry * 1.08) close('win', cl, `+${round2((cl - p.entry) / p.entry * 100)}% — partial book zone, profit liya.`);
      else if (cl < s10 && p.tDays >= 2) {
        const g = (cl - p.entry) / p.entry * 100;
        close(g >= 0 ? 'win' : 'fail', cl, g >= 0 ? '10 DMA trail exit — jo mila le liya' : '10 DMA break = story over.');
      }
      else if (p.tDays >= 3 && cl < p.pivot) close('fail', cl, `Breakout fail — ${p.tDays} din squat, move nahi aaya. Abnormal behavior = out.`);
    }

    let openNow = 0; for (const p of active.values()) if (p.status === 'open') openNow++;
    if (openNow > maxConcurrent) maxConcurrent = openNow;

    // 2) aaj ke naye picks (kal se track honge)
    if (di > N - 6) continue;                                // aakhri din — track karne ki jagah nahi
    const { gear } = marketAt(di);
    gearDays[gear]++;
    if (gear <= 1) continue;                                 // noTrade — cash bhi ek position hai
    const hot = hotAt(di);
    const maxPicks = gear >= 5 ? 8 : gear === 4 ? 6 : gear >= 3 ? 5 : 3;

    const cands = [];
    for (const S of stocks) {
      if (active.has(S.sym)) continue;
      const si = S.map[di];
      if (si < WARMUP) continue;
      const r = setupAt(S, si, hot.has(S.sec));
      if (r && r.isReady) cands.push({ S, ...r });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, maxPicks)) {
      active.set(c.S.sym, {
        S: c.S, gear, sizePct: SIZE_BY_GEAR[gear - 1],
        pivot: c.pivot, sl: c.sl, status: 'pending', wait: 0, pickDi: di
      });
    }
  }

  report(closed, equity, gearDays, { maxConcurrent, maxDeployPct, skippedNoCash }, T, startDi, N);

  if (WRITE) writeJournal(closed, equity, T);
  else console.log('\n(--write nahi diya — journal.json ko haath nahi lagaya. Track record badalna ho to --write lagao.)');
}

// ---------- journal me likhna ----------
// Journal me DO tarah ki trades hoti hain: backtest ki simulated (bt:true) aur
// live scan ki asli (live:true). Purana code poora closed[] replace kar deta tha —
// isse user ki asli trades (GNA ka same-day SL waghera) mit jaati.
// Aur ulta problem bhi tha: backtest window live period ke UPAR chadh jaati thi,
// to wahi din do baar count hote the. Ab live ki sabse purani pick pe backtest
// kaat dete hain — ek hi timeline, koi overlap nahi.
function writeJournal(closed, equity, T) {
  const path = join(ROOT, 'journal.json');
  let journal = { lastSession: null, equity: START_CAPITAL, positions: [], closed: [] };
  try { journal = JSON.parse(readFileSync(path, 'utf8')); } catch { }

  // legacy: purane backtest ne 'cap' likha tha, live scan nahi likhta
  const liveTrades = (journal.closed || []).filter(t => t.live || (!t.bt && t.cap === undefined));

  // live ki sabse purani pick ka timestamp — "3 Aug" jaisi string ko T[] se match karke
  let cutoff = Infinity;
  for (const t of liveTrades) {
    for (let i = T.length - 1; i >= 0; i--) {
      if (fmtShort(T[i]) === t.picked) { if (T[i] < cutoff) cutoff = T[i]; break; }
    }
  }

  const bt = closed
    .filter(t => t.status !== 'no-cash')          // ye sirf backtest diagnostic hai, track record nahi
    .filter(t => t._pickTs < cutoff)
    .map(({ _exitTs, _pickTs, _hold, _buyVal, _sellVal, ...t }) => ({ ...t, ts: _pickTs, bt: true }));

  journal.closed = [...bt, ...liveTrades];
  journal.equity = round2(equity);
  journal.backtestedAt = new Date().toISOString();
  journal.backtestWindow = WINDOW;
  writeFileSync(path, JSON.stringify(journal, null, 2));
  console.log(`\njournal.json: ${bt.length} backtest + ${liveTrades.length} live trades` +
    (cutoff < Infinity ? ` (backtest ${fmtShort(cutoff)} pe kaata — live wahin se shuru)` : ''));
  console.log('Ab `node scripts/scan.mjs --force` chala ke dashboard refresh karo.');
}

// ---------- report ----------
function report(closed, equity, gearDays, cash, T, startDi, N) {
  const traded = closed.filter(t => t.status !== 'no-trigger' && t.status !== 'no-cash');
  const noTrig = closed.filter(t => t.status === 'no-trigger').length;
  const wins = traded.filter(t => t.pnlPct > 0), losses = traded.filter(t => t.pnlPct <= 0);
  const winRate = traded.length ? wins.length / traded.length * 100 : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const expectancy = traded.length ? traded.reduce((s, t) => s + t.pnlPct, 0) / traded.length : 0;
  const grossW = wins.reduce((s, t) => s + t.pnlPct * t._buyVal / 100, 0);
  const grossL = Math.abs(losses.reduce((s, t) => s + t.pnlPct * t._buyVal / 100, 0));
  const pf = grossL ? grossW / grossL : Infinity;

  // equity curve + max drawdown (exit order = chronological)
  const byExit = [...traded].sort((a, b) => a._exitTs - b._exitTs);
  let eq = START_CAPITAL, peak = START_CAPITAL, maxDD = 0, costTotal = 0;
  let eqNet = START_CAPITAL;
  const monthly = {};
  for (const t of byExit) {
    const pnl = t._buyVal * t.pnlPct / 100;
    eq += pnl;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    const cost = tradeCost(t._buyVal, t._sellVal);
    costTotal += cost;
    eqNet += pnl - cost;
    const m = fmtMonth(t._exitTs);
    (monthly[m] = monthly[m] || { n: 0, w: 0, pnl: 0 });
    monthly[m].n++; if (t.pnlPct > 0) monthly[m].w++; monthly[m].pnl += pnl;
  }

  const L = [];
  const P = s => { L.push(s); console.log(s); };
  const pct = x => (x >= 0 ? '+' : '') + round2(x) + '%';
  const rs = x => '₹' + Math.round(x).toLocaleString('en-IN');

  P('='.repeat(64));
  P(`BACKTEST REPORT — ${fmtShort(T[startDi])} se ${fmtShort(T[N - 1])} (${N - startDi} sessions)`);
  P('='.repeat(64));
  P(`Picks diye          : ${closed.length}`);
  P(`  trade lagi        : ${traded.length}  (${round2(traded.length / (closed.length || 1) * 100)}% of picks)`);
  P(`  pivot cross nahi  : ${noTrig}  (paisa laga hi nahi)`);
  P(`  capital khatam    : ${cash.skippedNoCash}  (breakout aaya, par cash nahi bacha tha)`);
  P('');
  P(`Win rate            : ${round2(winRate)}%  (${wins.length}W / ${losses.length}L)`);
  P(`Avg win             : ${pct(avgWin)}`);
  P(`Avg loss            : ${pct(avgLoss)}`);
  P(`Expectancy/trade    : ${pct(expectancy)}   ← ye positive hona hi asli baat hai`);
  P(`Profit factor       : ${round2(pf)}  (1.0 = break-even, 1.5+ = solid)`);
  P(`Avg hold            : ${round2(traded.reduce((s, t) => s + t._hold, 0) / (traded.length || 1))} sessions`);
  P('');
  P(`Equity (gross)      : ${rs(START_CAPITAL)} → ${rs(eq)}  (${pct((eq - START_CAPITAL) / START_CAPITAL * 100)})`);
  P(`Charges (STT/DP/GST): ${rs(costTotal)}  — ${round2(costTotal / (eq - START_CAPITAL || 1) * 100)}% of gross profit`);
  P(`Equity (net, real)  : ${rs(eqNet)}  (${pct((eqNet - START_CAPITAL) / START_CAPITAL * 100)})   ← asli haath me aane wala`);
  P(`Max drawdown        : -${round2(maxDD)}%`);
  P(`Max concurrent pos  : ${cash.maxConcurrent}  (peak deployment ${round2(cash.maxDeployPct)}% of capital)`);
  P('');
  P('--- Exit kaise hue ---');
  const byStatus = {};
  for (const t of closed) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    const sub = closed.filter(t => t.status === k);
    const ap = sub.reduce((s, t) => s + t.pnlPct, 0) / sub.length;
    P(`  ${k.padEnd(11)} ${String(v).padStart(4)}  avg ${pct(ap)}`);
  }
  P('');
  P('--- Mahine ke hisaab se ---');
  for (const [m, d] of Object.entries(monthly)) {
    P(`  ${m.padEnd(8)} ${String(d.n).padStart(3)} trades  ${String(Math.round(d.w / d.n * 100)).padStart(3)}% win  ${(d.pnl >= 0 ? '+' : '') + rs(d.pnl)}`);
  }
  P('');
  P('--- Gear ke hisaab se (pick ke din ka gear) ---');
  for (let g = 1; g <= 5; g++) {
    const sub = traded.filter(t => t.gear === g);
    if (!sub.length) { P(`  gear ${g}: ${gearDays[g]} din, 0 trades`); continue; }
    const w = sub.filter(t => t.pnlPct > 0).length;
    P(`  gear ${g}: ${String(gearDays[g]).padStart(3)} din, ${String(sub.length).padStart(3)} trades, ${String(Math.round(w / sub.length * 100)).padStart(3)}% win, exp ${pct(sub.reduce((s, t) => s + t.pnlPct, 0) / sub.length)}`);
  }
  P('');
  P('--- Cap ke hisaab se ---');
  for (const cap of ['Micro', 'Small', 'Mid', 'Large']) {
    const sub = traded.filter(t => t.cap === cap);
    if (!sub.length) continue;
    const w = sub.filter(t => t.pnlPct > 0).length;
    P(`  ${cap.padEnd(6)} ${String(sub.length).padStart(3)} trades, ${String(Math.round(w / sub.length * 100)).padStart(3)}% win, exp ${pct(sub.reduce((s, t) => s + t.pnlPct, 0) / sub.length)}`);
  }
  P('');
  P('--- Sector ke hisaab se (top 10 by trades) ---');
  const bySec = {};
  for (const t of traded) (bySec[t.sector] = bySec[t.sector] || []).push(t);
  for (const [s, arr] of Object.entries(bySec).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const w = arr.filter(t => t.pnlPct > 0).length;
    P(`  ${s.slice(0, 26).padEnd(28)} ${String(arr.length).padStart(3)} trades, ${String(Math.round(w / arr.length * 100)).padStart(3)}% win, exp ${pct(arr.reduce((x, t) => x + t.pnlPct, 0) / arr.length)}`);
  }
  P('');
  P('NOTE: backtest me earnings-guard nahi hai (historical result calendar nahi milta).');
  P('      Live scan result-wale breakouts skip karta hai — to live thoda behtar hona chahiye.');
  P('='.repeat(64));

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, 'backtest-report.txt'), L.join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
