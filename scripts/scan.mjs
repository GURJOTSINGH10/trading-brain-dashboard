// ============================================================
// TRADING BRAIN — Daily EOD Scanner
// The Wealth Magnet framework: environment → sector → setup
// Runs Mon-Fri post-market (GitHub Actions, 7:10 PM IST)
// Data: Yahoo Finance daily candles. No API key needed.
// Outputs: data.js (dashboard) + journal.json (state)
// ============================================================

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = dirname(fileURLToPath(import.meta.url));
const START_CAPITAL = 100000;
const SIZE_BY_GEAR = [10, 14, 17, 21, 25];
const MIN_TRADED_VALUE = 5e7; // ₹5 Cr avg daily traded value
const UNIVERSE_MAX_AGE_DAYS = 10; // har 10 din me stock list auto-refresh

// Universe 10 din se purana ho to NSE lists se rebuild kar do (self-healing).
// Fail ho jaye (NSE down) to purani list se hi chalte raho — scan kabhi na ruke.
function refreshUniverseIfStale() {
  try {
    const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8'));
    const builtAt = uni.builtAt ? new Date(uni.builtAt) : null;
    const ageDays = builtAt ? (Date.now() - builtAt.getTime()) / 86400000 : Infinity;
    if (ageDays < UNIVERSE_MAX_AGE_DAYS) {
      console.log(`Universe ${ageDays.toFixed(1)} din purana — fresh hai, rebuild nahi.`);
      return;
    }
    console.log(`Universe ${ageDays === Infinity ? 'undated' : ageDays.toFixed(1) + ' din purana'} — rebuild kar rahe (NSE lists se)...`);
    execSync('node ' + JSON.stringify(join(HERE, 'build-universe.mjs')), { stdio: 'inherit', timeout: 180000 });
    console.log('Universe rebuild ho gaya.');
  } catch (e) {
    console.error('Universe rebuild fail (purani list se chal rahe):', e.message);
  }
}

// ---------- data fetch ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchChart(ticker, range = '1y') {
  const url = h => `https://${h}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetch(url(host), { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(2000); continue; }
      if (!res.ok) continue;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r?.timestamp) continue;
      const q = r.indicators.quote[0];
      const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      for (let i = 0; i < r.timestamp.length; i++) {
        if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
        out.t.push(r.timestamp[i]);
        out.o.push(q.open[i] ?? q.close[i]);
        out.h.push(q.high[i]); out.l.push(q.low[i]); out.c.push(q.close[i]);
        out.v.push(q.volume[i] ?? 0);
      }
      return out.c.length >= 30 ? out : null;
    } catch { /* try next host */ }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const last = a => a[a.length - 1];
const sma = (a, n, back = 0) => {
  const end = a.length - back;
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += a[i];
  return s / n;
};
const round2 = x => Math.round(x * 100) / 100;
const roundPrice = x => x >= 1000 ? Math.round(x) : Math.round(x * 10) / 10;

// ---------- date helpers (IST) ----------
const IST = 'Asia/Kolkata';
function istDateStr(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });
}
function fmtLong(d) {
  return d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtShort(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
}
function nextTradingDay(lastSessionTs) {
  const d = new Date(lastSessionTs * 1000);
  do { d.setDate(d.getDate() + 1); } while ([0, 6].includes(d.getDay()));
  return fmtLong(d);
}

// ---------- main ----------
async function main() {
  const FORCE = process.argv.includes('--force');
  console.log('Trading Brain scan shuru...');

  // Stock universe 10 din se purana ho to auto-rebuild (bina --force ke bhi)
  if (!FORCE) refreshUniverseIfStale();

  // --- state load ---
  let state = { lastSession: null, equity: START_CAPITAL, positions: [], closed: [] };
  try { state = JSON.parse(readFileSync(join(ROOT, 'journal.json'), 'utf8')); } catch { }

  // --- indices ---
  const nifty = await fetchChart('^NSEI');
  if (!nifty) { console.error('Nifty data nahi mila — abort'); process.exit(1); }
  const smallcap = (await fetchChart('^CNXSC')) || nifty; // CNX Smallcap; fallback Nifty
  const usdinr = await fetchChart('INR=X');

  const sessionTs = last(nifty.t);
  const sessionDate = istDateStr(sessionTs);
  // alreadyProcessed: journal state is session ke liye update ho chuka hai —
  // FORCE me sirf display (data.js) dobara banate hain, journal ko haath nahi lagate
  const alreadyProcessed = state.lastSession === sessionDate;
  if (alreadyProcessed && !FORCE) {
    console.log(`Session ${sessionDate} pehle se processed — aaj market band hoga. Skip.`);
    process.exit(0);
  }

  // --- universe fetch (concurrency 4) ---
  const universe = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  const charts = {};
  let idx = 0, failed = [];
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      const ch = await fetchChart(u.s + '.NS');
      if (ch) charts[u.s] = ch; else failed.push(u.s);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`Universe: ${Object.keys(charts).length}/${universe.length} fetched (fail: ${failed.length})`);

  // --- market health ---
  const sc = smallcap.c;
  const scNow = last(sc);
  const sc10 = sma(sc, 10), sc50 = sma(sc, 50), sc50Prev = sma(sc, 50, 10);
  const above10 = scNow > sc10, above50 = scNow > sc50, rising50 = sc50 > sc50Prev;
  let holdDays = 0;
  for (let i = sc.length - 1; i >= 50; i--) {
    if (sc[i] > sma(sc.slice(0, i + 1), 50)) holdDays++; else break;
  }

  let adv = 0, dec = 0, ab50 = 0, hi52 = 0, lo52 = 0, total = 0;
  let boWork = 0, boFlat = 0, boFail = 0; // recent breakouts: traction / no-traction / pop-and-drop
  for (const u of universe) {
    const ch = charts[u.s]; if (!ch) continue;
    total++;
    const c = ch.c, n = c.length;
    if (c[n - 1] > c[n - 2]) adv++; else dec++;
    const s50 = sma(c, 50); if (s50 && c[n - 1] > s50) ab50++;
    const hh = Math.max(...ch.h.slice(-252)), ll = Math.min(...ch.l.slice(-252));
    if (c[n - 1] >= hh * 0.97) hi52++;
    if (c[n - 1] <= ll * 1.05) lo52++;

    // Breakouts working? — pichhle 5 din me volume-backed breakout dhundo, phir TRACTION check
    // Creator ka asli sawaal: breakout ke baad stock MOVE kar raha hai ya sirf latka hua hai?
    const v20avg = sma(ch.v, 20);
    for (let i = n - 1; i >= n - 5 && i >= 16; i--) {
      const priorHigh = Math.max(...ch.h.slice(i - 15, i)); // pivot = 15 din ka high us din se pehle
      if (c[i] > priorHigh && ch.v[i] > (v20avg || 0) * 1.2) {
        const gain = (c[n - 1] - priorHigh) / priorHigh * 100; // breakout ke baad move
        if (gain < -0.5) boFail++;        // pivot ke neeche gir gaya = pop & drop
        else if (gain >= 2) boWork++;     // 2%+ move = asli traction, follow-through
        else boFlat++;                    // latka hua, move nahi = "attraction nahi mila"
        break; // sirf sabse recent breakout ginolo
      }
    }
  }
  const pctAb50 = total ? Math.round(ab50 / total * 100) : 0;
  const boTotal = boWork + boFlat + boFail;
  const boWorkPct = boTotal ? Math.round(boWork / boTotal * 100) : null; // sirf traction wale
  const boFailPct = boTotal ? Math.round(boFail / boTotal * 100) : null;

  let inrNote = 'Data nahi mila', inrGood = true;
  if (usdinr) {
    const ic = usdinr.c, chg = (last(ic) - ic[ic.length - 11]) / ic[ic.length - 11] * 100;
    inrGood = chg < 0.6;
    inrNote = chg > 0 ? `USDINR +${round2(chg)}% in 10 din${chg > 0.6 ? ' — rupaya gir raha hai, alarm' : ' — halka, theek hai'}` : `USDINR ${round2(chg)}% — rupaya stable/strong, positive`;
  }

  // gear score
  let score = 0;
  if (above10) score++;
  if (above50) score++;
  if (rising50) score++;
  if (holdDays >= 4) score++;
  if (pctAb50 >= 55) score++; else if (pctAb50 < 40) score--;
  if (adv > dec) score++;
  if (hi52 >= Math.max(3, total * 0.04)) score++;

  // ★ Breakouts working? — creator ka SABSE bada thermometer (Section 2 & 6)
  // Traction wale (2%+ move) hi asli "working" — flat/failed = confidence nahi banta
  let boStatus, boNote;
  if (boTotal >= 6) {
    const tail = `${boWork} traction, ${boFlat} flat, ${boFail} fail`;
    if (boWorkPct >= 45 && boFailPct < 30) { score++; boStatus = 'good'; boNote = `${boWorkPct}% breakouts move kar rahe (${tail}) — follow-through accha, confidence banta hai`; }
    else if (boWorkPct >= 30) { boStatus = 'warn'; boNote = `${boWorkPct}% me traction (${tail}) — selective/mixed, size control me rakho`; }
    else { score -= 2; boStatus = 'bad'; boNote = `Sirf ${boWorkPct}% breakouts move kar rahe (${tail}) — pop & drop, choppy phase, chhoti size`; }
  } else {
    boStatus = 'warn'; boNote = `Abhi sirf ${boTotal} recent breakouts — sample chhota, dekhte raho`;
  }

  let gear = (!above10 && !above50) ? 1 : Math.max(1, Math.min(5, Math.round(score * 5 / 8)));
  // Breakouts move nahi kar rahe = confidence low = aggression pe hard cap (chahe breadth accha ho)
  if (boTotal >= 6 && boWorkPct < 35) gear = Math.min(gear, 3);
  if (boTotal >= 6 && boWorkPct < 25) gear = Math.min(gear, 2);
  const noTrade = gear <= 1;
  const gearLabel = ['Neutral', '1st Gear', '2nd Gear', '3rd Gear', '4th Gear', '5th Gear'][gear] || '1st Gear';

  const verdicts = {
    1: 'Environment nahi hai bhaiya. Smallcap index moving averages ke neeche hai — scan band, cash bhi ek position hai. Jab first signs of strength aayenge, hum ready honge. Wait for the right opportunity.',
    2: 'First signs of strength dikh rahe hain — 10 DMA ke aas-paas action hai. Sirf test trades, chhoti size. Breakouts work karte dikhe to gear badhayenge.',
    3: 'Market me traction hai — test trades chal rahi hain, easiness aa rahi hai. Size badha sakte ho, lekin 5th gear abhi nahi. Aaj ke breakouts ka behavior hi kal ka thermometer hai.',
    4: 'Achha environment hai bhaiya — breadth strong, breakouts chal rahe hain. Positions bana sakte ho, bas after-breakout volatility pe nazar rakho.',
    5: 'Full traction, money flow clear hai — attack karo, strike very very hard. Lekin yaad rahe: 5th gear me bhi SL wahi ka wahi. I don’t make big losses.'
  };

  const checks = [
    { label: 'CNX Smallcap vs 50 DMA', status: above50 ? (rising50 ? 'good' : 'warn') : 'bad', note: above50 ? `50 DMA ke upar (${holdDays} din se hold)${rising50 ? ', rising' : ', lekin 50 DMA flat/declining'}` : '50 DMA ke neeche — environment kharab' },
    { label: '10 DMA', status: above10 ? 'good' : 'bad', note: above10 ? 'Index 10 DMA ke upar — first signs of strength' : '10 DMA ke neeche — scan ka time nahi' },
    { label: 'Breakouts working?', status: boStatus, note: boNote },
    { label: 'Breadth (50 DMA ke upar)', status: pctAb50 >= 55 ? 'good' : pctAb50 >= 40 ? 'warn' : 'bad', note: `${pctAb50}% universe 50 DMA ke upar` },
    { label: 'Advance / Decline', status: adv > dec ? 'good' : 'warn', note: `${adv} advances vs ${dec} declines aaj` },
    { label: '52W high zone', status: hi52 > lo52 ? 'good' : hi52 === lo52 ? 'warn' : 'bad', note: `${hi52} stocks 52W-high zone me, ${lo52} low zone me` },
    { label: 'USDINR', status: inrGood ? 'good' : 'warn', note: inrNote }
  ];

  // --- sector heat ---
  const sectors = {};
  for (const u of universe) {
    const ch = charts[u.s]; if (!ch) continue;
    (sectors[u.sec] = sectors[u.sec] || []).push(ch);
  }
  const hotSectors = [];
  for (const [name, list] of Object.entries(sectors)) {
    if (list.length < 3) continue;
    let ret5 = 0, up = 0, volR = 0, vn = 0;
    for (const ch of list) {
      const c = ch.c, n = c.length;
      ret5 += (c[n - 1] - c[n - 6]) / c[n - 6] * 100;
      let ups = 0; for (let i = n - 4; i < n; i++) if (c[i] > c[i - 1]) ups++;
      if (ups >= 3) up++;
      const v5 = sma(ch.v, 5), v20 = sma(ch.v, 20);
      if (v20 > 0) { volR += v5 / v20; vn++; }
    }
    ret5 /= list.length; volR = vn ? volR / vn : 1;
    const heat = ret5 + (up / list.length) * 3 + (volR - 1) * 4;
    if (ret5 > 1.5 && (up / list.length >= 0.4 || volR > 1.15)) {
      hotSectors.push({ name, heat, note: `5 din me avg ${ret5 > 0 ? '+' : ''}${round2(ret5)}% · ${up}/${list.length} stocks me lagatar action${volR > 1.15 ? ' · volumes badhe hue' : ''}` });
    }
  }
  hotSectors.sort((a, b) => b.heat - a.heat);
  const hotNames = new Set(hotSectors.slice(0, 4).map(s => s.name));

  // --- stock scan ---
  const candidates = [];
  if (!noTrade) {
    for (const u of universe) {
      const ch = charts[u.s]; if (!ch) continue;
      const c = ch.c, h = ch.h, l = ch.l, v = ch.v, n = c.length;
      if (n < 120) continue;
      const close = c[n - 1];

      // liquidity
      let tv = 0; for (let i = n - 20; i < n; i++) tv += c[i] * v[i];
      tv /= 20;
      if (tv < MIN_TRADED_VALUE) continue;

      // trend: above rising 50 DMA
      const s50 = sma(c, 50), s50p = sma(c, 50, 10), s10 = sma(c, 10);
      if (!(close > s50 && s50 > s50p)) continue;

      // consolidation + pivot
      const win = 15;
      const hiW = Math.max(...h.slice(-win)), loW = Math.min(...l.slice(-win));
      const rangePct = (hiW - loW) / close * 100;
      if (rangePct > 13) continue;
      const pivot = hiW;
      const prox = (pivot - close) / close * 100;
      if (prox > 4.5) continue; // pivot se door — ready nahi

      // volatility around pivot check: last 3 days avg true range vs 20d
      const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      let atr3 = 0, atr20 = 0;
      for (let i = n - 3; i < n; i++) atr3 += tr(i);
      for (let i = n - 20; i < n; i++) atr20 += tr(i);
      atr3 /= 3; atr20 /= 20;
      if (atr3 > atr20 * 1.8) continue; // pivot ke paas wild swings — chhodo

      const volShrink = sma(v, 5) < sma(v, 20);
      const hi52s = Math.max(...h.slice(-252));
      const near52 = close >= hi52s * 0.9;
      let big = 0; for (let i = n - 60; i < n; i++) if ((h[i] - l[i]) / c[i] * 100 >= 5) big++;
      const fivePct = big >= 3;
      const hot = hotNames.has(u.sec);
      const superTight = rangePct <= 7.5;

      let sc2 = 0;
      sc2 += (13 - rangePct) * 0.8;           // tighter = better
      sc2 += Math.max(0, 4.5 - prox);          // pivot ke paas
      if (volShrink) sc2 += 2.5;
      if (near52) sc2 += 3;
      if (fivePct) sc2 += 2;
      if (hot) sc2 += 4;
      // Creator ka focus small/midcap momentum hai — liquidity sirf floor hai (₹5Cr min),
      // usse upar size ka koi rank-bonus nahi. Chhote explosive movers ko preference.
      // Large-cap ko BHAARI penalty (-6): creator "hum large caps trade nahi karte" —
      // sirf truly generational setup hi is handicap ko paar karke pick me aa payega.
      const capPref = { Micro: 3, Small: 3, Mid: 1.5, Large: -6 };
      sc2 += capPref[u.cap] ?? 2.5;

      // SL: swing low ya ~3.5% niche pivot se
      const swingLow = Math.min(...l.slice(-8));
      let sl = Math.max(swingLow, pivot * 0.955);
      if ((pivot - sl) / pivot < 0.02) sl = pivot * 0.965;
      sl = roundPrice(sl);
      const slPct = round2((pivot - sl) / pivot * 100);
      const risk = pivot - sl;
      const t1 = roundPrice(pivot + 2 * risk), t2 = roundPrice(pivot + 2.6 * risk);
      const rr = round2((((t1 + t2) / 2) - pivot) / risk);

      const flags = [];
      if (hot) flags.push('Hot sector');
      if (superTight) flags.push('Super tight'); else flags.push('Tight base');
      if (volShrink) flags.push('Volume shrink');
      if (near52) flags.push('52W high zone');
      if (fivePct) flags.push('5% stock');

      const commentBits = [];
      if (superTight) commentBits.push(`${win} din se super tight consolidation hai (${round2(rangePct)}% range) — jitna zyada consolidate hua, utna achha action on the breakout`);
      else commentBits.push(`Base bana hua hai, ${round2(rangePct)}% range me pivot ke paas trade ho raha hai`);
      if (hot) commentBits.push(`${u.sec} sector me in dino nonstop action hai — money flow yahi hai`);
      if (near52) commentBits.push('52-week high zone me hai — upar supply nahi, line of least resistance upar');
      if (volShrink) commentBits.push('base me volume shrink — supply exhaust ho rahi hai');
      const comment = commentBits.join('. ') + '. Breakout aaye tabhi entry bhaiya — usse pehle jo bhi hai, sirf indication hai.';

      candidates.push({
        symbol: u.s, name: u.n, sector: u.sec, cap: u.cap || 'Small',
        cmp: roundPrice(close), pivot: roundPrice(pivot),
        entry: `${roundPrice(pivot)} ke upar close/cross, elevated volume ke saath`,
        sl, slPct, target: `${t1} – ${t2}`, rr: `1 : ${rr}`,
        setup: superTight ? `Super tight consolidation — ${win} din, ${round2(rangePct)}% range` : `Tight base — ${win} din, ${round2(rangePct)}% range, pivot ke paas`,
        volumeNote: volShrink ? 'Base me volume shrink — classic supply exhaustion.' : 'Volume abhi normal hai — breakout pe elevated chahiye.',
        comment, spark: c.slice(-17).map(roundPrice), flags, _score: sc2,
        detail: {
          dma10: roundPrice(s10), dma20: roundPrice(sma(c, 20)), dma50: roundPrice(s50),
          dma50Rising: s50 > s50p,
          dist52w: round2((hi52s - close) / close * 100),
          hi52: roundPrice(hi52s),
          tradedValueCr: round2(tv / 1e7),
          volRatio: round2(sma(v, 5) / (sma(v, 20) || 1)),
          rangePct: round2(rangePct),
          baseDays: win,
          proxPivot: round2(prox),
          atrRatio: round2(atr3 / atr20),
          bigMoveDays: big,
          t1, t2
        }
      });
    }
  }
  candidates.sort((a, b) => b._score - a._score);
  const maxPicks = gear >= 3 ? 5 : 3;
  const picks = candidates.slice(0, maxPicks).map(({ _score, ...p }) => p);
  console.log(`Candidates: ${candidates.length}, picks: ${picks.length}, gear: ${gear}`);

  // --- journal update (paper portfolio) — sirf naye session pe, force-rerun pe nahi ---
  const sizePctFor = g => SIZE_BY_GEAR[Math.max(0, Math.min(4, g - 1))];
  if (!alreadyProcessed) {
  const stillOpen = [];
  for (const pos of state.positions) {
    const ch = charts[pos.symbol] || await fetchChart(pos.symbol + '.NS');
    if (!ch) { stillOpen.push(pos); continue; }
    const n = ch.c.length;
    const o = ch.o[n - 1], hi = ch.h[n - 1], lo = ch.l[n - 1], cl = ch.c[n - 1], vol = ch.v[n - 1];
    const closeTrade = (status, exitPrice, reason) => {
      const pnlPct = round2((exitPrice - pos.entry) / pos.entry * 100);
      const pnlAmt = pos.invested * pnlPct / 100;
      state.equity = round2(state.equity + pnlAmt);
      state.closed.push({ picked: pos.picked, symbol: pos.symbol, sector: pos.sector, gear: pos.gear, entry: pos.entry, status, pnlPct, exitDate: fmtShort(sessionTs), reason });
    };

    if (pos.entryStatus === 'pending') {
      const v20 = sma(ch.v, 20);
      if (hi > pos.pivot && vol > (v20 || 0) * 1.2) {
        pos.entryStatus = 'open';
        pos.entry = roundPrice(Math.max(o, pos.pivot));
        const alloc = state.equity * pos.sizePct / 100;
        pos.qty = Math.max(1, Math.floor(alloc / pos.entry));
        pos.invested = round2(pos.qty * pos.entry);
        pos.daysSinceTrigger = 0;
        pos.triggerDate = fmtShort(sessionTs);
        stillOpen.push(pos);
      } else {
        pos.daysWaiting = (pos.daysWaiting || 0) + 1;
        if (pos.daysWaiting >= 4) {
          state.closed.push({ picked: pos.picked, symbol: pos.symbol, sector: pos.sector, gear: pos.gear, entry: pos.pivot, status: 'no-trigger', pnlPct: 0, reason: 'Pivot cross nahi hua 4 session me — list se bahar, paisa laga hi nahi' });
        } else stillOpen.push(pos);
      }
      continue;
    }

    // open position management
    pos.daysSinceTrigger = (pos.daysSinceTrigger || 0) + 1;
    const s10 = sma(ch.c, 10);
    if (lo <= pos.sl) {
      closeTrade('sl', pos.sl, `SL hit ${pos.sl} pe — out, end of story. Sell is a sell.`);
    } else if (cl >= pos.entry * 1.08) {
      closeTrade('win', cl, `+${round2((cl - pos.entry) / pos.entry * 100)}% — partial book zone, profit liya. Exact top nahi milega, 8-9% realistic hai.`);
    } else if (cl < s10 && pos.daysSinceTrigger >= 2) {
      const pnl = (cl - pos.entry) / pos.entry * 100;
      closeTrade(pnl >= 0 ? 'win' : 'fail', cl, pnl >= 0 ? '10 DMA trail exit — jo mila le liya' : '10 DMA break = story over. 10 me se 10 baar yahi decision.');
    } else if (pos.daysSinceTrigger >= 3 && cl < pos.pivot) {
      closeTrade('fail', cl, `Breakout fail — ${pos.daysSinceTrigger} din squat, move nahi aaya. Abnormal behavior = out.`);
    } else {
      pos.curPnlPct = round2((cl - pos.entry) / pos.entry * 100);
      stillOpen.push(pos);
    }
  }
  state.positions = stillOpen;

  // naye picks journal me (jo pehle se tracked nahi)
  const tracked = new Set([...state.positions.map(p => p.symbol)]);
  for (const p of picks) {
    if (tracked.has(p.symbol)) continue;
    state.positions.push({
      picked: fmtShort(sessionTs), symbol: p.symbol, sector: p.sector,
      gear, sizePct: sizePctFor(gear), pivot: p.pivot, sl: p.sl,
      entryStatus: 'pending', daysWaiting: 0
    });
  }
  state.lastSession = sessionDate;
  writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  } // end !alreadyProcessed

  // --- display journal (closed + open/pending) ---
  const journalOut = [
    ...state.closed.slice(-20),
    ...state.positions.filter(p => p.entryStatus === 'open').map(p => ({
      picked: p.picked, symbol: p.symbol, sector: p.sector, gear: p.gear, entry: p.entry,
      status: 'open', pnlPct: p.curPnlPct ?? 0,
      reason: `Open — entry ${p.entry}, SL ${p.sl}${(p.curPnlPct ?? 0) >= 8 ? ', partial book zone me hai' : ''}`
    }))
  ];

  // --- data.js write ---
  const now = new Date();
  const dashboard = {
    demo: false,
    generatedAt: `${fmtLong(now)} · ${now.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })} IST`,
    sessionDate,
    nextTradingDay: nextTradingDay(sessionTs),
    portfolio: {
      startCapital: START_CAPITAL,
      sizingRule: 'Gear-based: 1st gear 10% → 5th gear 25% of capital',
      sizeByGear: SIZE_BY_GEAR
    },
    market: { gear, gearLabel, verdict: verdicts[gear], checks },
    hotSectors: hotSectors.slice(0, 4).map(({ name, note }) => ({ name, note })),
    picks,
    journal: journalOut
  };

  writeFileSync(join(ROOT, 'data.js'),
    '// AUTO-GENERATED by scripts/scan.mjs — haath se edit mat karo\n' +
    'window.DASHBOARD_DATA = ' + JSON.stringify(dashboard, null, 2) + ';\n');
  console.log(`Done. Session ${sessionDate}${alreadyProcessed ? ' (force re-render, journal untouched)' : ''} | gear ${gear} | picks ${picks.length} | equity ₹${state.equity}`);
}

main().catch(e => { console.error(e); process.exit(1); });
