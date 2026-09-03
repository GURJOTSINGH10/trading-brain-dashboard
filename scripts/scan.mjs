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
import { stitchHistory, needsBseBackfill } from './history.mjs';
import { fetchFundamentals } from './fundamentals.mjs';
import { findBreakout, buildAll, summarize, BO } from './breakouts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = dirname(fileURLToPath(import.meta.url));
// Capital aur sizing ladder journal.json se aati hai (backtest --write wahan likhta
// hai). Yahan hardcode karne se dono jagah alag ho jaate the. Ye sirf fallback hai.
const DEFAULT_CAPITAL = 600000;
const DEFAULT_SIZES = [24, 24, 24, 24, 24];
// Exit rules — backtest.mjs ke barabar rakhna ZAROORI hai, warna paper portfolio
// aur backtest do alag cheezein ho jaate hain.
const MIN_BARS = 100;      // itne din ka data ho tabhi stock scan me aata hai (~5 mahine)
const BOOK_AT = 10;        // "double digit" pe partial book (creator ka shabd)
const BOOK_PART = 0.5;     // 50% book, baaki trail pe
const TRAIL_MA = 40;       // creator "10 DMA" bolta hai par wo discretion ke saath —
                           // mechanically 40 DMA hi dono backtest halves me PF > 1 deti hai
// ★ RISK RAMP — creator: "कुछ एक ट्रेड्स ली टू टेस्ट कि मार्केट कैसा है। अगर सफलता
// मिलती है, ईजीनेस महसूस होता है, तो हम आगे जाएंगे, गियर अप करेंगे।"
// Cash se wapas aate waqt AADHI size se shuru, aur poori size tabhi jab apni hi 2
// positions profit me hon. Flat size me pehli hi trade poori size pe lag jaati thi.
// TEST_SIZE = full ka aadha (principle se chuna, backtest ke max se nahi — sweep
// noisy tha: 12%→+134%, 14%→+96%, 16%→+55%; us shor pe tune karna overfit hota).
// IMAANDAARI: iska return pe asar NOISE ke andar hai — ₹1L pe ye nateeja bigaadta hai
// (+133% → +105%), ₹6L pe sudhaarta hai (+87% → +123%). Same rules, alag capital, ulta
// nateeja. Isliye ise return booster maan ke tune MAT karna. Ye RISK DISCIPLINE hai:
// cash se nikalte hi 96% invested ho jaana asli paise me khatarnak hai, aur backtest
// gap-risk/slippage/emotion price nahi karta. gain=5% variant sabse stable tha.
const TEST_SIZE = 12;      // full (24%) ka aadha
const RAMP_NEED = 2;       // itni open positions chal rahi hon = full size unlock
const RAMP_MAX = 3;        // test mode me max itni positions
const RAMP_GAIN = 5;       // "chal rahi hai" = kam se kam +5% (creator: "up like 10-20%")
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
      if (out.c.length < 30) continue;
      // ★ CRITICAL: market-hours me Yahoo AAJ ka ADHURA (live) candle deta hai.
      // Adhure din pe scan/journal chalana = galat SL/trigger/gear. Isliye:
      // aaj ka bar tabhi rakho jab market band ho chuki ho (15:35 IST ke baad).
      const clk = istClock();
      if (istDateStr(last(out.t)) === clk.date && clk.mins < 935) {
        out.t.pop(); out.o.pop(); out.h.pop(); out.l.pop(); out.c.pop(); out.v.pop();
      }
      return out.c.length >= 30 ? out : null;
    } catch { /* try next host */ }
  }
  return null;
}

// IST ka asli waqt (system TZ pe depend nahi — Node ICU se)
function istClock() {
  const p = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('day')}/${g('month')}/${g('year')}`, mins: (+g('hour') % 24) * 60 + +g('minute') };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const last = a => a[a.length - 1];

// ---------- NSE bhavcopy (official EOD, ~4:30 PM IST publish) ----------
// Yahoo ka daily candle ghanton late aata hai — bhavcopy se aaj ka session
// same-evening milta hai. Fail ho (NSE down / cloud IP block) to Yahoo fallback.
async function fetchNSE(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Referer': 'https://www.nseindia.com/', 'Accept': '*/*' }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

async function fetchBhavData() {
  // IST ke aaj se peeche 3 din try karo (weekday only) — jo pehli file mile
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000); // UTC+5:30 shift, UTC getters use karo
  for (let back = 0; back <= 3; back++) {
    const d = new Date(istNow.getTime() - back * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // Sat/Sun bhav nahi hota
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const csv = await fetchNSE(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dd}${mm}${yyyy}.csv`);
    if (!csv || !csv.includes('SYMBOL')) continue;

    const stocks = new Map();
    let bhavTs = null;
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const f = line.split(',').map(x => x.trim());
      if (f.length < 15 || f[1] !== 'EQ') continue;
      if (!bhavTs) {
        const [dd2, mon, yy] = f[2].split('-');
        bhavTs = Date.UTC(+yy, MONTHS[mon], +dd2, 4, 30) / 1000; // ~10:00 IST
      }
      stocks.set(f[0], {
        o: +f[4], h: +f[5], l: +f[6], c: +f[8], v: +f[10],
        tv: (+f[11] || 0) * 1e5,                  // TURNOVER_LACS → rupees (prefilter ke liye)
        deliv: isNaN(+f[14]) ? null : +f[14]
      });
    }
    if (!stocks.size) continue;

    // indices closing (Nifty 50 + Smallcap 100) — same date
    const indices = {};
    const icsv = await fetchNSE(`https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}${mm}${yyyy}.csv`);
    if (icsv) {
      for (const line of icsv.split(/\r?\n/)) {
        const f = line.split(',').map(x => x.trim());
        const name = (f[0] || '').toLowerCase();
        if (name === 'nifty 50') indices.nifty = { o: +f[2], h: +f[3], l: +f[4], c: +f[5] };
        if (name === 'nifty smallcap 100') indices.smallcap = { o: +f[2], h: +f[3], l: +f[4], c: +f[5] };
      }
    }
    console.log(`Bhavcopy mila: ${dd}-${mm}-${yyyy} | ${stocks.size} stocks | indices: ${Object.keys(indices).join(',') || 'nahi (Yahoo se chalega)'}`);
    return { ts: bhavTs, stocks, indices };
  }
  console.log('Bhavcopy nahi mila (holiday/pending/blocked) — Yahoo fallback.');
  return null;
}

/* ---------- result wale DIN ka delivery % ----------
   volX batata hai ki volume kitna aaya. Delivery % batata hai ki us volume me se
   kitna maal sach me utha. Creator ke liye ye farak bada hai — bina delivery ke
   volume sirf intraday shor hai. Purani bhavcopy NSE archives me padi rehti hai.
   Ek DATE pe ek hi download, chahe 5 stock usi din reported hon. */
async function attachResultDayDelivery(fundMap, maxDates = 14) {
  try {
    const need = new Map();   // 'DDMMYYYY' -> [symbol,...]
    for (const [sym, f] of fundMap) {
      const day = f.reaction && f.reaction.day;   // 'YYYY-MM-DD' IST
      if (!day) continue;
      const [y, m, d] = day.split('-');
      const key = d + m + y;
      if (!need.has(key)) need.set(key, []);
      need.get(key).push(sym);
    }
    const dates = [...need.keys()].slice(0, maxDates);
    let hits = 0;
    for (const key of dates) {
      const csv = await fetchNSE('https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_' + key + '.csv');
      if (!csv) continue;
      const want = new Set(need.get(key));
      for (const line of csv.split(/\r?\n/)) {
        const f = line.split(',').map(x => x.trim());
        if (f[1] !== 'EQ' || !want.has(f[0])) continue;
        const dv = parseFloat(f[14]);
        const rec = fundMap.get(f[0]);
        if (rec && rec.reaction && isFinite(dv)) { rec.reaction.delivPct = dv; hits++; }
      }
    }
    if (hits) console.log('Result-day delivery %: ' + hits + ' naam (' + dates.length + ' bhavcopy)');
  } catch { /* na mile to reaction row bina delivery ke chalega */ }
}

// ---------- NSE board meetings = earnings dates ----------
// Creator ka sabak: fresh breakout ko RESULT ke aar-paar hold mat karo — wo coin toss hai.
// Cookie-gated API hai; cloud IP block ho jaye to chup-chaap skip (baaki scan chalta rahe).
async function fetchEarningsDates() {
  const dd = d => String(d.getUTCDate()).padStart(2, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + d.getUTCFullYear();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const home = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    clearTimeout(timer);
    if (!cookie) return new Map();

    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const from = dd(istNow), to = dd(new Date(istNow.getTime() + 21 * 86400000));
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 15000);
    const res = await fetch(`https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=${from}&to_date=${to}`, {
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings' },
      signal: ctrl2.signal
    });
    clearTimeout(t2);
    if (!res.ok) return new Map();
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j.data || []);
    const map = new Map();
    for (const row of arr) {
      const sym = row.bm_symbol, dt = row.bm_date;
      if (!sym || !dt) continue;
      if (!/financial result/i.test((row.bm_purpose || '') + ' ' + (row.bm_desc || ''))) continue;
      const parsed = new Date(dt + ' UTC');
      if (isNaN(parsed)) continue;
      // sabse KAREEB wali date rakho
      if (!map.has(sym) || parsed < map.get(sym)) map.set(sym, parsed);
    }
    console.log(`Earnings calendar: ${map.size} stocks ke results agle 21 din me`);
    return map;
  } catch { console.log('Earnings calendar nahi mila (skip) — baaki scan chalega.'); return new Map(); }
}

// chart me official bar daalo: same date = replace (official jeet-ta hai), nayi date = append
function mergeBar(ch, ts, bar) {
  if (!ch || !bar || !isFinite(bar.c)) return;
  const lastDate = istDateStr(last(ch.t)), barDate = istDateStr(ts);
  if (lastDate === barDate) {
    const i = ch.t.length - 1;
    ch.o[i] = bar.o; ch.h[i] = bar.h; ch.l[i] = bar.l; ch.c[i] = bar.c;
    if (bar.v) ch.v[i] = bar.v;
  } else if (ts > last(ch.t)) {
    ch.t.push(ts); ch.o.push(bar.o); ch.h.push(bar.h); ch.l.push(bar.l); ch.c.push(bar.c); ch.v.push(bar.v || 0);
  }
}
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
  let state = { lastSession: null, equity: DEFAULT_CAPITAL, positions: [], closed: [] };
  try { state = JSON.parse(readFileSync(join(ROOT, 'journal.json'), 'utf8')); } catch { }
  const START_CAPITAL = state.startCapital || DEFAULT_CAPITAL;
  const SIZE_BY_GEAR = state.sizeByGear || DEFAULT_SIZES;

  // --- indices ---
  const nifty = await fetchChart('^NSEI');
  if (!nifty) { console.error('Nifty data nahi mila — abort'); process.exit(1); }
  const cnxsc = await fetchChart('^CNXSC');
  const smallcap = cnxsc || nifty; // CNX Smallcap; fallback Nifty
  const usdinr = await fetchChart('INR=X');

  // --- NSE bhavcopy: aaj ka official session (Yahoo late ho to bhi fresh) ---
  const bhav = process.env.SKIP_BHAV ? null : await fetchBhavData();
  if (bhav) {
    if (bhav.indices.nifty) mergeBar(nifty, bhav.ts, bhav.indices.nifty);
    if (bhav.indices.smallcap && cnxsc) mergeBar(cnxsc, bhav.ts, bhav.indices.smallcap);
  }

  // ---- Session kaunsa hai: OFFICIAL bhavcopy hi authority hai ----
  // BUG THA: sessionTs = max(yahoo, bhav). Market band hote hi (3:40 PM) Yahoo aaj ka bar
  // de deta hai, jabki bhavcopy 4:30 PM pe aati hai. To session aage badh jaata tha KAL ki
  // delivery % ke saath, aur baad ke saare runs "already processed" bol ke skip kar dete the.
  const yahooTs = last(nifty.t);
  const bhavTs = bhav ? bhav.ts : 0;
  const bhavIsLatest = !!bhav && istDateStr(bhavTs) === istDateStr(yahooTs);
  const clkNow = istClock();
  let sessionTs;
  if (bhavIsLatest) sessionTs = yahooTs;                              // official data aa gaya ✓
  else if (clkNow.mins >= 1200) sessionTs = Math.max(yahooTs, bhavTs); // 8 PM ke baad intezaar khatam
  else sessionTs = bhavTs || yahooTs;                                  // tab tak bhavcopy ka wait
  const sessionDate = istDateStr(sessionTs);
  const bhavDateStr = bhavTs ? istDateStr(bhavTs) : null;
  const bhavIsSession = bhavDateStr === sessionDate; // delivery % tabhi valid hai
  // alreadyProcessed: journal state is session ke liye update ho chuka hai —
  // FORCE me sirf display (data.js) dobara banate hain, journal ko haath nahi lagate
  const alreadyProcessed = state.lastSession === sessionDate;
  // Session processed ho chuka hai LEKIN ab uski asli (nayi) bhavcopy aa gayi hai?
  // To display dobara banao — journal ko haath nahi. Warna adhura data raat bhar atka rehta hai.
  const staleDisplay = alreadyProcessed && bhavDateStr && state.lastBhav !== bhavDateStr;
  if (alreadyProcessed && !FORCE && !staleDisplay) {
    console.log(`Session ${sessionDate} pehle se processed (bhav ${state.lastBhav || 'n/a'}) — skip.`);
    process.exit(0);
  }
  if (staleDisplay) console.log(`Session ${sessionDate} processed tha, par nayi bhavcopy (${bhavDateStr}) aa gayi — display refresh.`);

  // --- universe fetch (concurrency 4) ---
  const fullUniverse = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  // Universe ab poori NSE list (~2000) hai. Har roz sabki 1-saal history laana bhaari hai,
  // isliye bhavcopy ke AAJ ke turnover se prefilter: jo aaj ₹2 Cr bhi nahi hue, wo
  // ₹5 Cr ka 20-din average kabhi paas nahi karega. Bhavcopy na mile to index-tagged
  // stocks pe wapas (purana behaviour) — scan kabhi ruke nahi.
  let universe = fullUniverse;
  if (bhav) {
    const liquid = fullUniverse.filter(u => (bhav.stocks.get(u.s)?.tv || 0) >= 2e7);
    if (liquid.length >= 300) universe = liquid;
  } else {
    const tagged = fullUniverse.filter(u => u.cap !== 'Micro' || u.sec !== 'Other');
    if (tagged.length >= 300) universe = tagged;
  }
  console.log(`Universe: ${fullUniverse.length} listed → ${universe.length} scan ke liye (liquidity prefilter)`);

  const earningsMap = await fetchEarningsDates();
  const charts = {};
  let idx = 0, failed = [];
  // Universe-health counters. Pehle system CHUP-CHAAP andha tha — 272 stocks
  // history ki kami se skip ho rahe the aur kahin koi ginti nahi dikhti thi.
  const health = { stitched: 0, boOnly: 0, boRejected: 0, shortHistory: 0, illiquid: 0, noSector: 0, scanned: 0 };
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      let ch = await fetchChart(u.s + '.NS');
      // ★ NSE pe naya ticker = chhoti history, chahe company 40 saal purani ho.
      // NSE ne Apr+Aug 2026 me BSE ki ~250 companies BULK me admit ki thi — unki
      // poori history .BO pe hai. Purana hissa wahan se bhar lo, warna MIN_BARS
      // gate unhe chup-chaap reject karta hai AUR 52W-high 92 din ka ban jaata hai.
      // Identity bhavcopy ke aaj ke close se verify hoti hai (history.mjs dekho).
      if (needsBseBackfill(ch)) {
        const bo = await fetchChart(u.s + '.BO');
        if (bo) {
          const r = stitchHistory(ch, bo, bhav?.stocks.get(u.s)?.close ?? null);
          if (r.boBars) {
            // BO-only stock ki liquidity BSE ke volume se nikalti hai — uske liye
            // NSE ka aaj ka asli turnover bhi ₹5Cr+ chahiye, warna hum BSE ki
            // liquidity pe NSE ki trade maan lenge.
            const nseTv = bhav?.stocks.get(u.s)?.tv ?? 0;
            if (r.src === 'BO' && nseTv < MIN_TRADED_VALUE) health.boRejected++;
            else {
              ch = r.bars; ch.src = r.src; ch.boBars = r.boBars;
              if (r.src === 'BO') health.boOnly++; else health.stitched++;
            }
          } else if (/^(identity fail|drift)/.test(r.reason)) health.boRejected++;
        }
      }
      if (ch) {
        if (bhav && bhav.stocks.has(u.s)) {
          const b = bhav.stocks.get(u.s);
          mergeBar(ch, bhav.ts, b);           // official EOD bar (Yahoo late ho tab bhi aaj ka data)
          // delivery % SIRF tab jab bhavcopy usi session ki ho — warna kal ka data
          // "aaj ka" bolke dikh jaata hai (ye aaj hi pakda gaya bug hai)
          if (b.deliv != null && bhavIsSession) ch.deliv = b.deliv;
        }
        charts[u.s] = ch;
      } else failed.push(u.s);
      await sleep(80);
    }
  }
  // Universe ~2000 ka ho gaya hai — 9 workers taaki cloud ke 20-min timeout me aaram se aa jaye
  await Promise.all(Array.from({ length: 9 }, () => worker()));
  console.log(`Universe: ${Object.keys(charts).length}/${universe.length} fetched (fail: ${failed.length})`);
  console.log(`BSE backfill: ${health.stitched} stitch + ${health.boOnly} BO-only | ${health.boRejected} reject`);

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
    // 'Other' = sector pata nahi. 'Diversified' = conglomerates ka jhola — un stocks
    // me koi common driver hota hi nahi, to unka "sector hot hai" jhootha signal hai.
    // Dono skip; warna +4 hot-sector bonus bekaar picks ko upar utha deta hai.
    if (name === 'Other' || name === 'Diversified' || list.length < 3) continue;
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
    // ★ "AAG LAG JAANI CHAHIYE" ka naap — abhi sirf DIKHANE ke liye.
    // Vault (Sector Chunne Ka Tareeka §🔥): "ek-do din ka move ek REACTION hai;
    // sector tab garam hota hai jab HAFTON tak, KAI NAAM ek saath chalein."
    // Upar wala heat sirf 5 din dekhta hai — wo bar dheela hai. Ye gehra naap
    // scoring ko NAHI chhoo raha (wo change untested hai, rules.json me
    // 'sector.heat.persistence' = proposed). Pehle user isse dekhega.
    let ret20 = 0, ret60 = 0, pack = 0, nearHi = 0;
    for (const ch of list) {
      const c = ch.c, n = c.length;
      if (n > 21) ret20 += (c[n - 1] - c[n - 21]) / c[n - 21] * 100;
      if (n > 61) ret60 += (c[n - 1] - c[n - 61]) / c[n - 61] * 100;
      // pack breakout: pichhle 10 din me 20-din ka high toda?
      if (n > 31) {
        const prior = Math.max(...ch.h.slice(-31, -11));
        if (Math.max(...ch.h.slice(-10)) > prior) pack++;
      }
      if (n > 60) { const hi = Math.max(...ch.h.slice(-252)); if (c[n - 1] >= hi * 0.9) nearHi++; }
    }
    ret20 /= list.length; ret60 /= list.length;
    const depth = { ret20: round2(ret20), ret60: round2(ret60), pack, nearHi, count: list.length };
    if (ret5 > 1.5 && (up / list.length >= 0.4 || volR > 1.15)) {
      hotSectors.push({
        name, heat, depth,
        note: `5 din me avg ${ret5 > 0 ? '+' : ''}${round2(ret5)}% · ${up}/${list.length} stocks me lagatar action${volR > 1.15 ? ' · volumes badhe hue' : ''}`,
        // "Aag" ka faisla: hafton ka move + kai naam. Ye sirf ek PADHNE wali raay hai.
        fire: (ret20 > 4 && ret60 > 6 && pack >= Math.max(2, list.length * 0.2)) ? 'aag'
          : (ret20 > 2 && pack >= 2) ? 'garam' : 'reaction',
        depthNote: `20 din ${ret20 > 0 ? '+' : ''}${round2(ret20)}% · 60 din ${ret60 > 0 ? '+' : ''}${round2(ret60)}% · ${pack}/${list.length} naamon ne 20-din ka high toda · ${nearHi} 52W-high zone me`
      });
    }
  }
  hotSectors.sort((a, b) => b.heat - a.heat);
  const hotNames = new Set(hotSectors.slice(0, 4).map(s => s.name));

  // ★ SECTOR KE ANDAR LEADERSHIP (display-only, abhi scoring me NAHI)
  // Vault, Best of the Best §2b: SHREDIGCEM ka base bhi ACHHA tha — par leader
  // RPOWER tha. "Screen pe dono pass ho jaate hain"; farak ye hai ki jab leader
  // chalta hai to KITNA chalta hai. Abhi hot-sector bonus FLAT +4 hai — sector ka
  // #1 ho ya #12, dono ko barabar. Ye naap us bonus ko rank-weighted karne ka
  // aadhaar hai, PAR wo scoring change abhi TEST NAHI hua
  // (rules.json → selection.leader_rank = proposed), isliye filhaal sirf dikhta hai.
  // Naap 60-din ka return hai, SCORE se bilkul alag — warna rank circular ho jaata.
  const leaderPct = {};   // symbol -> 0..100 (100 = sector ka sabse strong)
  {
    const bySec = {};
    for (const u of universe) {
      const ch = charts[u.s]; if (!ch || ch.c.length < 61) continue;
      const c = ch.c, n = c.length;
      const r60 = (c[n - 1] - c[n - 61]) / c[n - 61] * 100;
      (bySec[u.sec] = bySec[u.sec] || []).push([u.s, r60]);
    }
    for (const list of Object.values(bySec)) {
      if (list.length < 3) continue;
      list.sort((a, b) => a[1] - b[1]);            // sabse kamzor pehle
      list.forEach(([sym], i) => { leaderPct[sym] = Math.round(i / (list.length - 1) * 100); });
    }
  }

  // --- stock scan ---
  // noTrade din pe bhi loop chalta hai — picks nahi milte, lekin "nazar-me-rakho"
  // watchlist ke liye relaxed candidates chahiye (ready ke KAREEB wale)
  const candidates = [];
  {
    for (const u of universe) {
      const ch = charts[u.s]; if (!ch) continue;
      const c = ch.c, h = ch.h, l = ch.l, v = ch.v, n = c.length;
      // ★ 120 se ghata ke 100. Pehle 6 mahine se nayi listings scanner ko INVISIBLE
      // thi — 51 liquid naye stocks (INDOMIM ₹1433Cr/din, SBIFUNDS ₹649Cr/din) bilkul
      // nahi dikhte the. Backtest: 120→100 pe ₹6L FULL +150%→+201%, DD -11.7%→-9.9%.
      // 100 se aur neeche jaane ka koi fayda nahi mila, isliye wahin ruke.
      if (n < MIN_BARS) { health.shortHistory++; continue; }
      const close = c[n - 1];

      // liquidity
      let tv = 0; for (let i = n - 20; i < n; i++) tv += c[i] * v[i];
      tv /= 20;
      if (tv < MIN_TRADED_VALUE) { health.illiquid++; continue; }
      health.scanned++;
      if (u.sec === 'Other') health.noSector++;

      // trend: above rising 50 DMA. Nayi listing (120 bars se kam) ke paas 50 DMA
      // kachchi hoti hai — uske liye 20 DMA se check karte hain. s50 display ke liye
      // phir bhi asli 50 DMA hi rehti hai (100+ bars pe wo maujood hoti hai).
      const young = n < 120;
      const tMa = young ? 20 : 50;
      const trendMa = sma(c, tMa), trendMaPrev = sma(c, tMa, 10);
      if (!(close > trendMa && trendMa > trendMaPrev)) continue;
      const s50 = sma(c, 50), s50p = sma(c, 50, 10), s10 = sma(c, 10);

      // consolidation + pivot — ADAPTIVE base window
      // BUG THA: fix 15-din window. Agar 12 din pehle ek spike hua ho (jaise GNA Axles
      // me 601 ka), to wo poore base ko "25% wild range" dikha deta tha aur asli base
      // (jo spike ke BAAD bana) miss ho jaata tha. Creator aankh se asli base dekhta hai.
      // Ab 6-30 din me se sabse LAMBA valid base chunte hain (lamba base = behtar).
      const bestBase = (maxRange, maxProx, minWin = 6) => {
        let r = null;
        for (let w = minWin; w <= 30 && w < n; w++) {
          const hh = Math.max(...h.slice(-w)), ll = Math.min(...l.slice(-w));
          const rp = (hh - ll) / close * 100, px = (hh - close) / close * 100;
          if (rp <= maxRange && px <= maxProx) r = { win: w, hiW: hh, loW: ll, rangePct: rp, prox: px };
        }
        return r;
      };
      // Pick ke liye kam se kam 8 din ka base — ek hafta shanti "supply khatam" ka
      // saboot nahi hai. Watchlist ka bar 6 din (tracking ke liye theek hai).
      const strictBase = bestBase(13, 4.5, 8);       // pick-worthy
      const base = strictBase || bestBase(16, 8, 6); // warna watchlist material
      if (!base) continue;
      const { win, hiW, rangePct, prox } = base;
      const pivot = hiW;

      // volatility around pivot check: last 3 days avg true range vs 20d
      const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      let atr3 = 0, atr20 = 0;
      for (let i = n - 3; i < n; i++) atr3 += tr(i);
      for (let i = n - 20; i < n; i++) atr20 += tr(i);
      atr3 /= 3; atr20 /= 20;
      if (atr3 > atr20 * 2.2) continue; // bilkul wild = bahar

      // READY = asli (strict) criteria — picks sirf inme se; baaki = watch material
      const isReady = !!strictBase && atr3 <= atr20 * 1.8;

      const volShrink = sma(v, 5) < sma(v, 20);
      const hi52s = Math.max(...h.slice(-252));
      const near52 = close >= hi52s * 0.9;
      let big = 0; for (let i = n - 60; i < n; i++) if ((h[i] - l[i]) / c[i] * 100 >= 5) big++;
      const fivePct = big >= 3;
      const hot = hotNames.has(u.sec);
      const superTight = rangePct <= 7.5;

      // ★ scoreParts: har point KAHAN se aaya, ye DIKHANE ke liye.
      // ⚠️ Arithmetic bilkul waisa ka waisa hai — sirf record ho raha hai.
      // Wajah: user beginner hai; "ye naam upar kyun hai" ka jawab card pe dikhe
      // to scanner sirf batata nahi, SIKHATA hai.
      const parts = [];
      const add = (pts, label, why) => { if (Math.abs(pts) >= 0.05) parts.push({ label, pts: round2(pts), why }); return pts; };
      let sc2 = 0;
      sc2 += add((13 - rangePct) * 0.8, 'Tight base', `${round2(rangePct)}% range — jitna tight, utna saaf breakout`);
      sc2 += add(Math.min(3, (win - 6) * 0.15), 'Lamba base', `${win} din ki consolidation — utni der supply saaf hui`);
      sc2 += add(Math.max(0, 4.5 - prox), 'Pivot ke paas', `pivot se sirf ${round2(prox)}% door`);
      if (volShrink) sc2 += add(2.5, 'Volume shrink', 'base me volume sukh gaya — supply exhaust');
      if (near52) sc2 += add(3, '52W high zone', 'upar phansa hua maal nahi — line of least resistance upar');
      if (fivePct) sc2 += add(2, '5% stock', 'din me 5% chal sakta hai — isme jaan hai');
      if (hot) sc2 += add(4, 'Hot sector', `${u.sec} me money flow — scoring ka sabse bhaari element`);
      // Creator ka focus small/midcap momentum hai — liquidity sirf floor hai (₹5Cr min),
      // usse upar size ka koi rank-bonus nahi. Chhote explosive movers ko preference.
      // Large-cap ko BHAARI penalty (-6): creator "hum large caps trade nahi karte" —
      // sirf truly generational setup hi is handicap ko paar karke pick me aa payega.
      const capPref = { Micro: 3, Small: 3, Mid: 1.5, Large: -6 };
      sc2 += add(capPref[u.cap] ?? 2.5, `${u.cap} cap`, u.cap === 'Large' ? 'large cap pe bhaari penalty — "hum large caps trade nahi karte"' : 'chhote explosive movers ko preference');

      // SL: swing low ya ~3.5% niche pivot se
      const swingLow = Math.min(...l.slice(-8));
      let sl = Math.max(swingLow, pivot * 0.955);
      if ((pivot - sl) / pivot < 0.02) sl = pivot * 0.965;
      sl = roundPrice(sl);
      const slPct = round2((pivot - sl) / pivot * 100);
      const risk = pivot - sl;
      const t1 = roundPrice(pivot + 2 * risk), t2 = roundPrice(pivot + 2.6 * risk);
      const rr = round2((((t1 + t2) / 2) - pivot) / risk);

      // ★ Earnings guard — creator: "numbers pe leke chale gaye, loss ho gaya"
      // Fresh breakout ko result ke aar-paar hold karna coin toss hai, setup nahi.
      const earnDate = earningsMap.get(u.s);
      const earnDays = earnDate ? Math.round((earnDate - new Date(sessionTs * 1000)) / 86400000) : null;
      const earnInfo = earnDate
        ? { earnIn: earnDays, earnOn: earnDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) }
        : {};
      const earnRisk = earnDays !== null && earnDays >= 0 && earnDays <= 3;

      const flags = [];
      if (earnRisk) flags.push('⚠️ Result ' + earnInfo.earnOn);
      // Nayi listing = upar koi phansa hua nahi (overhead supply nahi), par history
      // patli hai. User ko dono pata hone chahiye.
      if (young) flags.push(`🆕 Nayi listing — ${Math.round(n / 21)} mahine ka data`);
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
      let comment = commentBits.join('. ') + '. Breakout aaye tabhi entry bhaiya — usse pehle jo bhi hai, sirf indication hai.';
      if (earnRisk) comment = `⚠️ RESULT ${earnInfo.earnOn} ko aa raha hai — is breakout pe abhi entry MAT lo. Numbers ek coin toss hai, setup nahi. Result nikal jaane do, phir setup dobara bane to dekhenge. ` + comment;
      // Result sar pe ho to ranking me neeche — takki wo pick hi na bane
      if (earnRisk) sc2 += add(-8, 'Result sar pe', `${earnInfo.earnOn} ko numbers — breakout pe entry coin toss hai`);

      candidates.push({
        symbol: u.s, name: u.n, sector: u.sec, cap: u.cap || 'Small',
        cmp: roundPrice(close), pivot: roundPrice(pivot),
        entry: `${roundPrice(pivot)} pe stop-buy lagao. Volume bhi elevated ho to aur behtar — par paper portfolio sirf pivot cross maanta hai (order to bhar hi jaata hai)`,
        sl, slPct, target: `${t1} – ${t2}`, rr: `1 : ${rr}`,
        setup: superTight ? `Super tight consolidation — ${win} din, ${round2(rangePct)}% range` : `Tight base — ${win} din, ${round2(rangePct)}% range, pivot ke paas`,
        volumeNote: volShrink ? 'Base me volume shrink — classic supply exhaustion.' : 'Volume abhi normal hai — breakout pe elevated chahiye.',
        comment, spark: c.slice(-17).map(roundPrice), flags, _score: sc2, _ready: isReady,
        scoreParts: parts.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)), scoreTotal: round2(sc2),
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
          delivPct: ch.deliv ?? null,
          ...earnInfo,
          t1, t2
        }
      });
    }
  }
  // diagnostic: base-length ka bantwara (adaptive window dheela to nahi?)
  {
    const rd = candidates.filter(c => c._ready);
    const bins = { '6-7': 0, '8-9': 0, '10-14': 0, '15-19': 0, '20-30': 0 };
    for (const c of rd) {
      const w = c.detail.baseDays;
      if (w <= 7) bins['6-7']++; else if (w <= 9) bins['8-9']++;
      else if (w <= 14) bins['10-14']++; else if (w <= 19) bins['15-19']++; else bins['20-30']++;
    }
    console.log('Ready base-length bantwara:', JSON.stringify(bins));
  }
  candidates.sort((a, b) => b._score - a._score);
  // Picks gear ke saath scale hote hain — jitna strong market, utne zyada mauke
  // gear 2 = 3 (test trades) | 3 = 5 | 4 = 6 | 5 = 8 (attack mode)
  // ★ Roz sirf TOP-2 picks (pehle gear ke hisaab se 3-8 the).
  // Creator: "एक दो पोजीशन ली... यू आर लाइक 25% इन्वेस्टेड, दे आर डन।"
  // Scan har candidate ko score deta hai; rank 3 ke baad signal khatam ho jaata hai
  // aur wo trades achhi walon ki capital kha jaati hain. Dono capitals pe test kiya:
  // H2 (recent bura market) me profit factor 1.29 se 2.10 ho gaya.
  const maxPicks = 2;
  const readyCands = candidates.filter(c => c._ready);
  const picks = noTrade ? [] : readyCands.slice(0, maxPicks).map(({ _score, _ready, ...p }) => p);
  // Watchlist ab HAMESHA dikhti hai — agle ranked candidates. Ye sirf nazar rakhne
  // ke liye hain, journal inhe track NAHI karta (warna backtest se match nahi karega).
  // ★ 3 se 10 kiya. Wajah: gear 1-2 wale din picks 0 hote hain aur dashboard pe
  // "Aaj koi setup nahi" ke alawa kuch bachta hi nahi — jabki andar 200+ ready
  // setups pade hote hain. Wo khalipan jhootha hai: market ka saath nahi hai, par
  // NAAM to maujood hain. Agle din market palte to ye list hi kaam aati hai.
  // ⚠️ Ye TRADE nahi hai. Journal inhe chhuata bhi nahi.
  const pickSyms = new Set(picks.map(p => p.symbol));
  const watchlist = candidates.filter(c => !pickSyms.has(c.symbol)).slice(0, 10).map(c => ({
    symbol: c.symbol, name: c.name, sector: c.sector, cap: c.cap,
    cmp: c.cmp, pivot: c.pivot, sl: c.sl, prox: c.detail.proxPivot, range: c.detail.rangePct,
    baseDays: c.detail.baseDays, ready: !!c._ready,
    leaderPct: leaderPct[c.symbol] ?? null,
    spark: c.spark, scoreParts: c.scoreParts, scoreTotal: c.scoreTotal,
    flags: c.flags, hot: c.flags.includes('Hot sector')
  }));
  console.log(`Candidates: ${candidates.length} (ready: ${readyCands.length}), picks: ${picks.length}, watchlist: ${watchlist.length}, gear: ${gear}`);

  /* ★ NUMBERS CHECK — picks aur watchlist ke peeche ke NUMBERS.
     Ye SELECTION nahi karta. Ranking, filter, score — kisi pe iska asar NAHI hai.
     Creator fundamentals se stock chunta nahi ("वी आर प्लेइंग ब्रेकआउट्स"), par uska
     core belief fundamental hai ("स्टॉक प्राइसेस आर स्लेव ऑफ अर्निंग्स") aur uska
     asli test numbers nahi, numbers pe MARKET KA REACTION hai:
       "नंबर्स अपने आप में कोई मैटर नहीं करते... प्राइस एक्शन क्या मैच कर रहा है?"
     rules.json: selection.fundamental_confidence (status: discretionary).

     ⚠️ Ye journal se PEHLE chalta hai — jaan-boojhkar. Pick banti hai isi ke neeche,
     aur pick ke WAQT ke legs journal me likhne se hi 3-4 mahine baad naapa ja sakega
     ki "teeno match" wale picks sach me behtar chale ya nahi. Baad me nahi likh paoge:
     numbers har quarter badal jaate hain.

     NSE block kare ya kuch bhi toote to fund = null aur scan bina ruke chalta hai. */
  let fund = null;
  try {
    const syms = [...new Set([...picks.map(p => p.symbol), ...watchlist.map(w => w.symbol)])];
    if (syms.length) {
      const chMap = new Map();
      for (const sym of syms) if (charts[sym]) chMap.set(sym, charts[sym]);
      const got = await fetchFundamentals(syms, chMap);
      await attachResultDayDelivery(got);
      const readySet = new Set([...picks.map(p => p.symbol), ...watchlist.filter(w => w.ready).map(w => w.symbol)]);
      const bySymbol = {};
      for (const [sym, f] of got) {
        const legs = { ...f.legs, setup: readySet.has(sym) };
        const n = (legs.growth ? 1 : 0) + (legs.reaction ? 1 : 0) + (legs.setup ? 1 : 0);
        // agla result — wahi earningsMap jo earnings-guard use karta hai, dobara call nahi
        const e = earningsMap.get(sym);
        bySymbol[sym] = {
          ...f, legs,
          matchCount: n,
          match: n === 3 ? 'triple' : n === 2 ? 'two' : n === 1 ? 'one' : 'none',
          nextResult: e ? {
            on: e.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' }),
            inDays: Math.max(0, Math.round((e - new Date(sessionTs * 1000)) / 86400000))
          } : null
        };
      }
      fund = { bySymbol, count: Object.keys(bySymbol).length };
      console.log('Numbers Check: ' + fund.count + '/' + syms.length + ' naam pe numbers laga diye');
    }
  } catch (e) { console.log('Numbers Check skip (' + e.message + ') — baaki dashboard poora hai.'); }

  /* pick/watchlist ke saath journal me jaane wala CHHOTA snapshot.
     Poora fund object journal me daalna fizool hai — 5 quarter ki series har naam pe
     rakhne se journal mahino me bhaari ho jayega. Sirf wahi rakho jo baad me naapna hai. */
  const fundStamp = sym => {
    const f = fund && fund.bySymbol[sym];
    if (!f) return null;
    return {
      matchCount: f.matchCount, outOf: 3,
      growth: f.legs.growth, reaction: f.legs.reaction,
      growthPct: f.growth && f.growth.profit != null ? Math.round(f.growth.profit) : null,
      growthTag: f.growth ? f.growth.tag : null,
      reactionPct: f.reaction && f.reaction.moveDay != null ? round2(f.reaction.moveDay) : null,
      quarter: f.quarter || null
    };
  };

  // ★ SECTOR PLAYS — "ye sector garam hai, isme ye 5 stock strategy pe fit baith rahe".
  // candidates pehle se _score pe sorted hain, to filter karne se rank bacha rehta hai:
  // rank 1 = us sector ka sabse strong naam = LEADER candidate.
  // ⚠️ Ye DISPLAY hai, trade nahi. Journal sirf picks (top-2) ko track karta hai.
  // Vault (Best of the Best §2b): "screen pe dono pass ho jaate hain — farak ye hai
  // ki jab LEADER chalta hai to KITNA chalta hai." Isliye rank dikhana zaroori hai.
  const sectorPlays = hotSectors.slice(0, 4).map(sec => ({
    name: sec.name,
    note: sec.note,
    depthNote: sec.depthNote,
    fire: sec.fire,
    stocks: candidates.filter(c => c.sector === sec.name).slice(0, 5).map((c, i) => ({
      rank: i + 1,
      // Sector ke andar 60-din ke return ka percentile. 100 = sabse strong.
      // Ye setup-score se ALAG cheez hai: setup batata hai "kab", leadership
      // batati hai "kaun". Dono ek hi stock me mil jaayein to wahi best-of-best.
      leaderPct: leaderPct[c.symbol] ?? null,
      symbol: c.symbol, name: c.name, cap: c.cap,
      cmp: c.cmp, pivot: c.pivot, sl: c.sl,
      prox: c.detail.proxPivot, range: c.detail.rangePct, baseDays: c.detail.baseDays,
      spark: c.spark, scoreTotal: c.scoreTotal,
      stage: c._ready ? (c.detail.proxPivot <= 2 ? 'Pivot pe khada' : 'Ready')
        : (c.detail.rangePct <= 16 ? 'Base ban raha' : 'Abhi shor hai'),
      flags: c.flags.filter(f => f !== 'Hot sector'),
      isPick: pickSyms.has(c.symbol)
    }))
  })).filter(s => s.stocks.length);
  console.log('Sector plays: ' + (sectorPlays.map(s => `${s.name}[${s.fire}]=${s.stocks.length}`).join(', ') || 'koi nahi'));

  /* ★ SECTOR KE APNE NUMBERS — creator ka asli tareeka:
       "नंबर्स अपने आप में कोई मैटर नहीं करते... सेक्टर कैसा परफॉर्म कर रहा है
        फंडामेंटली? एंड द सेम टाइम प्राइस एक्शन क्या मैच कर रहा है?"
     Wo sector ke TOP 4 naam ke numbers dekhta hai (Railway pe IRFC/RVNL, Defence pe
     Cochin Shipyard/Mazagon Dock) — ye jaanne ke liye ki sector abhi bhi garam hai.
     Stock ka apna number ek baat hai; poore sector me kamai aa rahi hai ya nahi,
     wo doosri. Yahan doosri wali naapte hain.

     Ye bhi DISPLAY hai. Sector score isse nahi badalta. */
  if (fund) {
    try {
      const wanted = [];
      for (const sp of sectorPlays)
        for (const st of sp.stocks.slice(0, 4))
          if (!wanted.includes(st.symbol)) wanted.push(st.symbol);
      const missing = wanted.filter(sym => !fund.bySymbol[sym]);
      const extra = new Map();
      if (missing.length) {
        const chMap = new Map();
        for (const sym of missing) if (charts[sym]) chMap.set(sym, charts[sym]);
        const got = await fetchFundamentals(missing, chMap);
        for (const [sym, f] of got) extra.set(sym, f);
      }
      const look = sym => fund.bySymbol[sym] || extra.get(sym) || null;

      const bySector = {};
      for (const sp of sectorPlays) {
        const rows = [];
        for (const st of sp.stocks.slice(0, 4)) {
          const f = look(st.symbol);
          if (!f || !f.growth) continue;
          rows.push({
            symbol: st.symbol,
            pct: f.growth.profit != null ? Math.round(f.growth.profit) : null,
            tag: f.growth.tag, ok: !!f.growth.ok,
            // turnaround pe % bemaani hai (ghaate se tulna) — alag se nishaan
            state: f.growth.state || null
          });
        }
        if (!rows.length) continue;
        const withPct = rows.filter(r => r.pct != null);
        const good = rows.filter(r => r.ok).length;
        // turnaround ko bhi positive gino — % nahi bana par khabar achhi hai
        const positive = withPct.filter(r => r.pct > 0).length + rows.filter(r => r.state === 'turnaround').length;
        // median — ek company ka 1900% wala outlier poore sector ka picture na bigade
        // ek hi aankde ka "median" bemaani hai — do se kam ho to dikhao mat
        let median = null;
        if (withPct.length >= 2) {
          const v = withPct.map(r => r.pct).sort((a, b) => a - b);
          median = v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
        }
        let verdict, cls;
        if (good >= 2) { verdict = 'sector fundamentally bhi chal raha hai'; cls = 'good'; }
        else if (positive > rows.length / 2) { verdict = 'growth hai par halki — leaders ka bar paar nahi'; cls = 'mid'; }
        else { verdict = 'price chal raha hai, numbers saath nahi de rahe'; cls = 'bad'; }
        bySector[sp.name] = { checked: rows.length, strong: good, positive, median, rows, verdict, cls };
      }
      if (Object.keys(bySector).length) {
        fund.bySector = bySector;
        console.log('Sector numbers: ' + Object.entries(bySector)
          .map(([k, v]) => k.split(' ')[0] + ' ' + v.strong + '/' + v.checked).join(', '));
      }
    } catch (e) { console.log('Sector numbers skip (' + e.message + ')'); }
  }

  // --- risk ramp ka faisla ---
  // KAL ke close pe (curPnlPct pichhle run ka hai), aaj ke bhaav pe nahi — jab tumhara
  // order aaj subah bharta hai tab tumhe kal tak ka hi pata hota hai.
  // Ye block journal-update se BAHAR hai kyunki data.js me bhi chahiye (force-rerun pe
  // journal skip hota hai par dashboard tab bhi banta hai).
  const openNow = state.positions.filter(p => p.entryStatus === 'open');
  const winningOpen = openNow.filter(p => (p.curPnlPct || 0) >= RAMP_GAIN).length;
  const rampedUp = winningOpen >= RAMP_NEED;
  console.log(`Risk ramp: ${winningOpen}/${openNow.length} open positions profit me — ${rampedUp ? 'FULL SIZE' : 'TEST MODE (aadhi size)'}`);

  // --- journal update (paper portfolio) — sirf naye session pe, force-rerun pe nahi ---
  const sizePctFor = g => SIZE_BY_GEAR[Math.max(0, Math.min(4, g - 1))];
  if (!alreadyProcessed) {
  const stillOpen = [];
  // ★ CASH CONSTRAINT — ₹6 lakh me 25% wali 11 positions ek saath nahi khul sakti.
  // Ye check pehle SIRF backtest me tha, live journal me nahi — isliye live portfolio
  // 11 positions / 266% deployment tak pahunch gaya tha, jo asal me possible hi nahi.
  // deployed = abhi jitna paisa positions me phansa hua hai.
  let deployed = state.positions
    .filter(p => p.entryStatus === 'open')
    .reduce((s, p) => s + (p.invested || 0), 0);


  // DO PASS zaroori hai: pehle saari exits (cash free hoti hai), phir naye triggers
  // us bachi hui cash se. Ek hi pass me aaj bikne wali position ka paisa aaj hi
  // dobara nahi lag paata — jo asli trading me lagta hai.
  const ordered = [...state.positions].sort((a, b) =>
    (a.entryStatus === 'open' ? 0 : 1) - (b.entryStatus === 'open' ? 0 : 1));

  for (const pos of ordered) {
    const ch = charts[pos.symbol] || await fetchChart(pos.symbol + '.NS');
    if (!ch) { stillOpen.push(pos); continue; }
    const n = ch.c.length;
    const o = ch.o[n - 1], hi = ch.h[n - 1], lo = ch.l[n - 1], cl = ch.c[n - 1], vol = ch.v[n - 1];
    const closeTrade = (status, exitPrice, reason) => {
      const pnlPct = round2((exitPrice - pos.entry) / pos.entry * 100);
      const pnlAmt = pos.invested * pnlPct / 100;
      state.equity = round2(state.equity + pnlAmt);
      deployed = Math.max(0, round2(deployed - (pos.invested || 0)));  // paisa wapas cash me
      // live: true — ye ASLI trade hai, backtest ki simulated nahi. backtest.mjs
      // --write in par kabhi haath nahi lagata (warna user ki asli history mit jaati).
      state.closed.push({ picked: pos.picked, ts: pos.pickedTs || null, symbol: pos.symbol, sector: pos.sector, gear: pos.gear, entry: pos.entry, qty: pos.qty, invested: pos.invested, status, pnlPct, exitDate: fmtShort(sessionTs), exitTs: sessionTs, reason, live: true });
    };

    if (pos.entryStatus === 'pending') {
      // ★ Volume condition ENTRY se hata di. Pehle `vol > v20*1.2` bhi chahiye tha —
      // par tum pivot pe stop-buy lagate ho, wo volume kaisa bhi ho bhar jaata hai.
      // Us din ka total volume order bharte waqt pata hi nahi hota. Journal me wo
      // condition rakhna matlab sirf jeetne wale din ginna — 5-saal ke backtest me
      // isi ek cheez se +305% aur -30% ka farak tha.
      if (hi > pos.pivot) {
        const entryPx = roundPrice(Math.max(o, pos.pivot));
        // Size TRIGGER pe tay hoti hai, pick pe nahi — feedback tabhi pata hota hai
        if (!rampedUp && openNow.length >= RAMP_MAX) {
          state.closed.push({
            picked: pos.picked, ts: pos.pickedTs || null, symbol: pos.symbol, sector: pos.sector,
            gear: pos.gear, entry: roundPrice(pos.pivot), status: 'no-cash', pnlPct: 0, exitTs: sessionTs,
            reason: `Test mode — abhi sirf ${winningOpen} position profit me hai. Pehle ${RAMP_NEED} chalein tab gear up hoga. Tab tak nayi position nahi.`,
            live: true
          });
          continue;
        }
        pos.sizePct = rampedUp ? (pos.fullSize || pos.sizePct) : TEST_SIZE;
        const alloc = state.equity * pos.sizePct / 100;
        // ★ Math.max(1, ...) hata diya. Wo MRF/Page jaise ₹1.5 lakh ke share ka
        // 1 share "khareed" leta tha jabki position size ₹17,000 ki thi — paper
        // portfolio jhootha ho jaata tha. Ek share bhi na aaye = trade possible nahi.
        const qty = Math.floor(alloc / entryPx);
        // qty < 1  = share ka bhaav position size se bada (MRF/Page type)
        // cash khatam = capital pehle se lagi hui hai, ye mauka chhoot gaya
        if (qty < 1 || deployed + qty * entryPx > state.equity) {
          state.closed.push({
            picked: pos.picked, ts: pos.pickedTs || null, symbol: pos.symbol, sector: pos.sector,
            gear: pos.gear, entry: roundPrice(pos.pivot), status: 'no-cash', pnlPct: 0, exitTs: sessionTs,
            reason: qty < 1
              ? `Breakout to aaya, par ek share ₹${entryPx} ka hai — ${pos.sizePct}% position size (₹${Math.round(alloc).toLocaleString('en-IN')}) me aata hi nahi.`
              : `Breakout to aaya, par capital pehle se lagi hui thi (₹${Math.round(deployed).toLocaleString('en-IN')} deployed) — ye trade chhoot gayi. Cash bhi ek position hai.`,
            live: true
          });
          continue;
        }
        pos.entryStatus = 'open';
        pos.entry = entryPx;
        pos.qty = qty;
        pos.invested = round2(pos.qty * pos.entry);
        deployed = round2(deployed + pos.invested);
        pos.daysSinceTrigger = 0;
        pos.triggerDate = fmtShort(sessionTs);
        // ★ SAME-DAY SL — breakout aur stop-loss ek hi din me ho sakte hain.
        // GNA Axles (4 Aug): high 563 pe entry bani, phir low 505 — SL 523 usi din hit.
        // Pehle `continue` kar dete the, to ye loss AGLE din darj hota tha (galat bhaav pe)
        // aur track record jhoothi optimistic ban jaati thi.
        if (lo <= pos.sl) closeTrade('sl', pos.sl, `Entry ke din hi SL ${pos.sl} hit — breakout turant fail, same-day out`);
        else stillOpen.push(pos);
      } else {
        pos.daysWaiting = (pos.daysWaiting || 0) + 1;
        if (pos.daysWaiting >= 4) {
          state.closed.push({ picked: pos.picked, ts: pos.pickedTs || null, symbol: pos.symbol, sector: pos.sector, gear: pos.gear, entry: pos.pivot, status: 'no-trigger', pnlPct: 0, exitTs: sessionTs, reason: 'Pivot cross nahi hua 4 session me — list se bahar, paisa laga hi nahi', live: true });
        } else stillOpen.push(pos);
      }
      continue;
    }

    // open position management
    pos.daysSinceTrigger = (pos.daysSinceTrigger || 0) + 1;
    const trailMa = sma(ch.c, TRAIL_MA);
    if (lo <= pos.sl) {
      closeTrade('sl', pos.sl, `SL hit ${pos.sl} pe — out, end of story. Sell is a sell.`);
    } else if (!pos.booked && cl >= pos.entry * (1 + BOOK_AT / 100)) {
      // ★ PARTIAL BOOK — creator ke apne shabd: "jaise hi DOUBLE DIGIT me aaye to
      // 1/3 ya 50% book kar lein, baaki 10 DE se trail karte rahein."
      // Pehle yahan +8% pe POORA book hota tha, aur ye rule trail se pehle chalta tha —
      // matlab koi bhi trade kabhi +8% se aage ja hi nahi sakti thi. Momentum ka saara
      // paisa us ek bade runner me hota hai, aur wahi kat raha tha.
      const sellQty = Math.max(1, Math.floor(pos.qty * BOOK_PART));
      const pnlPct = round2((cl - pos.entry) / pos.entry * 100);
      const soldVal = round2(sellQty * pos.entry);
      state.equity = round2(state.equity + soldVal * pnlPct / 100);
      deployed = Math.max(0, round2(deployed - soldVal));
      state.closed.push({
        picked: pos.picked, ts: pos.pickedTs || null, symbol: pos.symbol, sector: pos.sector,
        gear: pos.gear, entry: pos.entry, qty: sellQty, invested: soldVal, status: 'win', pnlPct,
        exitDate: fmtShort(sessionTs), exitTs: sessionTs,
        reason: `+${pnlPct}% — double digit aa gaya, ${Math.round(BOOK_PART * 100)}% book kiya. Baaki ${TRAIL_MA} DMA pe trail hoga.`,
        live: true
      });
      pos.qty -= sellQty;
      pos.invested = round2(pos.qty * pos.entry);
      pos.booked = true;
      pos.curPnlPct = pnlPct;
      if (pos.qty >= 1) stillOpen.push(pos);   // baaki hissa chalta rahega
    } else if (cl < trailMa && pos.daysSinceTrigger >= 2) {
      const pnl = (cl - pos.entry) / pos.entry * 100;
      closeTrade(pnl >= 0 ? 'win' : 'fail', cl, pnl >= 0 ? `${TRAIL_MA} DMA trail exit — jo mila le liya` : `${TRAIL_MA} DMA break = story over.`);
    } else if (!pos.booked && pos.daysSinceTrigger >= 3 && cl < pos.pivot) {
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
      // pickedTs: "7 Aug" string se saal pata nahi chalta. Journal ab 12 mahine ka
      // hai, to client ko sort karne ke liye asli timestamp chahiye.
      picked: fmtShort(sessionTs), pickedTs: sessionTs, symbol: p.symbol, sector: p.sector,
      gear, fullSize: sizePctFor(gear), sizePct: sizePctFor(gear), pivot: p.pivot, sl: p.sl,
      // ★ pick ke WAQT ka Numbers Check. Baad me ye dobara nahi ban sakta (numbers
      //   agle quarter me badal jaate hain). Isse hi 3-4 mahine baad naapenge ki
      //   "teeno match" ka koi asli farak hai ya nahi — tabhi ye rule discretionary
      //   se shipped ya rejected ban paayega.
      fund: fundStamp(p.symbol),
      entryStatus: 'pending', daysWaiting: 0
    });
  }
  state.lastSession = sessionDate;
  writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  } // end !alreadyProcessed

  // ★ #3 WATCHLIST TRACKER — "watchlist ki ranking predictive hai ya nahi?"
  // Watchlist roz naye sire se banti hai, to kisi ko yaad hi nahi rehta ki us
  // naam ka aage hua kya. Ye har watchlist naam ko WATCH_DAYS tak track karta
  // hai: uska pivot yaad rakhta hai aur dekhta hai ki wo cross hua ya nahi.
  // Isse ek imaandaar sawaal ka jawab milta hai — jinhe scanner "pivot ke
  // kareeb" bata raha tha, unme se sach me kitne bhaage?
  // ⚠️ Ye TRADE nahi hai aur journal se iska koi lena-dena nahi. Ye scanner ka
  // apna report card hai.
  const WATCH_DAYS = 15;
  // ⚠️ Tracker ka state JOURNAL ke andar rehta hai, apni alag file me NAHI.
  // Wajah: cloud workflow sirf `git add data.js journal.json universe.json` karta
  // hai. Alag file cloud run me likhi to jaati, par COMMIT kabhi nahi hoti — to
  // tracker local run pe aage badhta aur cloud run pe chup-chaap reset ho jaata.
  // Bilkul wahi khaamoshi jo is project ko pehle mehngi pad chuki hai.
  // (scan.yml edit nahi kar sakte — GitHub token me 'workflow' scope nahi hai.)
  // backtest.mjs ka writeJournal() unknown keys ko chhuata nahi, to ye safe hai.
  let track = state.watchTrack || { names: {}, done: [] };

  // Pehli baar (file hai hi nahi) to aaj ki watchlist se SEED kar do — chahe
  // session pehle se processed ho. Warna tracker agle naye session tak khali
  // rehta aur dashboard pe report card gayab dikhta.
  const bootstrap = !state.watchTrack;
  if (bootstrap) {
    for (const w of watchlist) {
      track.names[w.symbol] = {
        firstSeen: sessionTs, firstSeenLabel: fmtShort(sessionTs),
        pivot: w.pivot, sl: w.sl ?? null, sector: w.sector, sessions: 0, crossed: false, maxHighPct: 0,
        fund: fundStamp(w.symbol),
        lastSeen: sessionTs
      };
    }
    track.updated = new Date().toISOString();
    state.watchTrack = track;
    writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
    console.log(`Watchlist tracker seed: ${watchlist.length} naam`);
  }

  if (!alreadyProcessed) {
    // 1) aaj ki watchlist ke naye naam jodo
    for (const w of watchlist) {
      if (!track.names[w.symbol]) {
        track.names[w.symbol] = {
          firstSeen: sessionTs, firstSeenLabel: fmtShort(sessionTs),
          pivot: w.pivot, sl: w.sl ?? null, sector: w.sector, sessions: 0, crossed: false, maxHighPct: 0,
          fund: fundStamp(w.symbol)
        };
      }
      track.names[w.symbol].lastSeen = sessionTs;
      // purane record me SL nahi tha (ye field baad me judi) — mil jaye to bhar do
      if (track.names[w.symbol].sl == null && w.sl != null) track.names[w.symbol].sl = w.sl;
    }
    // 2) har tracked naam pe aaj ka bhaav dekho
    for (const [sym, t] of Object.entries(track.names)) {
      const ch = charts[sym];
      t.sessions = (t.sessions || 0) + 1;
      if (ch) {
        const n = ch.c.length, hi = ch.h[n - 1];
        const gainPct = round2((hi - t.pivot) / t.pivot * 100);
        if (gainPct > (t.maxHighPct || 0)) t.maxHighPct = gainPct;
        if (!t.crossed && hi > t.pivot) {
          t.crossed = true; t.crossedTs = sessionTs;
          t.crossedInSessions = t.sessions;
        }
      }
      // 3) window khatam — nateeja done[] me daal ke naam hata do
      if (t.sessions >= WATCH_DAYS) {
        track.done.push({
          symbol: sym, sector: t.sector, from: t.firstSeenLabel,
          crossed: !!t.crossed, inSessions: t.crossedInSessions ?? null,
          maxHighPct: t.maxHighPct ?? 0,
          pivot: t.pivot, sl: t.sl ?? null,
          fund: t.fund || null
        });
        delete track.names[sym];
      }
    }
    if (track.done.length > 500) track.done = track.done.slice(-500);
    track.updated = new Date().toISOString();
    state.watchTrack = track;
    writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  }

  // Report card hamesha banta hai (--force pe bhi), file se
  const watchStats = (() => {
    const done = track.done || [];
    const live = Object.entries(track.names || {}).map(([symbol, t]) => ({
      symbol, sector: t.sector, from: t.firstSeenLabel, sessions: t.sessions || 0,
      crossed: !!t.crossed, inSessions: t.crossedInSessions ?? null,
      maxHighPct: t.maxHighPct ?? 0
    })).sort((a, b) => b.sessions - a.sessions);
    if (!done.length && !live.length) return null;
    const crossedDone = done.filter(d => d.crossed);
    const avgDays = crossedDone.length
      ? round2(crossedDone.reduce((a, d) => a + (d.inSessions || 0), 0) / crossedDone.length) : null;
    return {
      windowDays: WATCH_DAYS,
      settled: done.length,
      settledCrossed: crossedDone.length,
      crossRate: done.length ? Math.round(crossedDone.length / done.length * 100) : null,
      avgSessionsToCross: avgDays,
      tracking: live.slice(0, 12),
      trackingCount: live.length,
      /* ★ Numbers Check ka apna report card.
         Sawaal jiska jawab data se aayega: jin naamon pe numbers saath de rahe the,
         wo pivot zyada baar cross karte hain kya? Jab tak 20-25 naam har bucket me
         settle na ho jaayein, is par koi faisla mat lena. */
      byMatch: (() => {
        // ⚠️ backfill wale stamp 2 legs pe hain (setup leg peeche se pata nahi
        //    chal sakti), naye 3 pe. Isliye bucket ki chaabi "2/3" jaisi hai —
        //    2/2 aur 2/3 ek cheez nahi hain, unhe milana jhooth hoga.
        const buckets = {};
        for (const dd of done) {
          const f = dd.fund;
          if (!f || f.matchCount == null) continue;
          const k = f.matchCount + '/' + (f.outOf || 3);
          if (!buckets[k]) buckets[k] = { settled: 0, crossed: 0, matchCount: f.matchCount, outOf: f.outOf || 3 };
          buckets[k].settled++;
          if (dd.crossed) buckets[k].crossed++;
        }
        const out = Object.entries(buckets).map(([k, v]) => ({
          key: k, matchCount: v.matchCount, outOf: v.outOf,
          settled: v.settled, crossed: v.crossed,
          crossRate: Math.round(v.crossed / v.settled * 100)
        })).sort((a, b) => (b.matchCount / b.outOf) - (a.matchCount / a.outOf));
        return out.length ? out : null;
      })(),
      /* ★ Ek-ek leg ka apna hisaab — YAHI jaldi jawab dega.
         matchCount ke 4-6 bucket bante hain to har bucket patla pad jaata hai.
         Leg-wise sirf DO bucket hain (haan/na), to sample dugna hota hai —
         aur sawaal bhi seedha hai: "growth wale naam zyada cross karte hain kya?" */
      byLeg: (() => {
        const mk = () => ({ yes: { settled: 0, crossed: 0 }, no: { settled: 0, crossed: 0 } });
        const g = mk(), r = mk();
        for (const dd of done) {
          const f = dd.fund; if (!f) continue;
          if (f.growth != null) { const b = f.growth ? g.yes : g.no; b.settled++; if (dd.crossed) b.crossed++; }
          if (f.reaction != null) { const b = f.reaction ? r.yes : r.no; b.settled++; if (dd.crossed) b.crossed++; }
        }
        const rate = b => b.settled ? Math.round(b.crossed / b.settled * 100) : null;
        const any = g.yes.settled + g.no.settled + r.yes.settled + r.no.settled;
        return any ? {
          growth: { yes: { ...g.yes, crossRate: rate(g.yes) }, no: { ...g.no, crossRate: rate(g.no) } },
          reaction: { yes: { ...r.yes, crossRate: rate(r.yes) }, no: { ...r.no, crossRate: rate(r.no) } }
        } : null;
      })(),
      // kitne naam abhi is naap ke saath chal rahe hain (samples aa rahe hain)
      matchTracked: Object.values(track.names || {}).filter(t => t.fund).length
    };
  })();
  if (watchStats) console.log(`Watchlist tracker: ${watchStats.trackingCount} chal rahe, ${watchStats.settled} settle hue` +
    (watchStats.crossRate != null ? ` — ${watchStats.crossRate}% ne pivot cross kiya` : ''));

  // ★ #2 PICKS KA REPORT CARD — "kal jo diye the, unka kya hua?"
  // Creator ka #1 signal "breakouts working?" market ke liye hai. Ye uska
  // PERSONAL version hai: hamare apne picks chal rahe hain ya nahi.
  // Sabse recent pick-date ke saare picks, unka abhi ka haal.
  const pickHistory = [
    ...state.closed.filter(t => t.ts).map(t => ({
      ts: t.ts, picked: t.picked, symbol: t.symbol, sector: t.sector,
      status: t.status, pnlPct: t.pnlPct ?? 0, reason: t.reason
    })),
    ...state.positions.map(p => ({
      ts: p.pickedTs, picked: p.picked, symbol: p.symbol, sector: p.sector,
      status: p.entryStatus === 'open' ? 'open' : 'pending',
      pnlPct: p.curPnlPct ?? 0,
      reason: p.entryStatus === 'open'
        ? `Trigger hua ${p.triggerDate || ''} ko — abhi chal rahi hai`
        : `Abhi tak pivot ${p.pivot} cross nahi hua (${p.daysWaiting || 0} din wait)`
    }))
  ].filter(x => x.ts).sort((a, b) => b.ts - a.ts);

  const lastPicks = (() => {
    if (!pickHistory.length) return null;
    // sabse recent pick-date (aaj ke picks abhi trigger nahi hue honge, to
    // pichhli AISI date lo jispe kuch nateeja aa chuka ho)
    const dayOf = ts => Math.floor((ts + 19800) / 86400);
    const today = dayOf(sessionTs);
    const prior = pickHistory.filter(x => dayOf(x.ts) < today);
    if (!prior.length) return null;
    const d = dayOf(prior[0].ts);
    const group = prior.filter(x => dayOf(x.ts) === d);
    const triggered = group.filter(x => x.status !== 'no-trigger' && x.status !== 'no-cash').length;
    return {
      date: group[0].picked,
      picks: group.map(({ ts, ...g }) => g),
      triggered, total: group.length
    };
  })();
  if (lastPicks) console.log(`Pichhle picks (${lastPicks.date}): ${lastPicks.triggered}/${lastPicks.total} trigger hue`);

  // ★ SESSION HISTORY — gear aur hot-sector ka itihaas.
  // Gear poore framework ki jad hai par uski HISTORY kahin dikhti hi nahi thi
  // ("kitne din se gear 1 hai?" ka jawab kahin nahi tha). Sector rotation bhi
  // vault ka core concept hai (Leadership Rotation) aur dashboard sirf AAJ
  // dikhata tha. Dono journal ke andar rehte hain — kyunki cloud workflow sirf
  // data.js/journal.json/universe.json commit karta hai (Known Bugs #10).
  const HIST_MAX = 90;
  let history = Array.isArray(state.history) ? state.history : [];
  const todayHist = {
    d: sessionDate, ts: sessionTs, gear,
    sec: hotSectors.slice(0, 4).map(x => x.name),
    picks: picks.map(p => p.symbol)
  };
  if (!alreadyProcessed) {
    history = history.filter(h => h.d !== sessionDate);
    history.push(todayHist);
    if (history.length > HIST_MAX) history = history.slice(-HIST_MAX);
    state.history = history;
    writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  }
  // display ke liye aaj ka entry hamesha shaamil (force-run pe bhi)
  const histOut = [...history.filter(h => h.d !== sessionDate), todayHist].slice(-HIST_MAX);
  // gear kitne din se wahi hai
  let gearStreak = 0;
  for (let i = histOut.length - 1; i >= 0; i--) { if (histOut[i].gear === gear) gearStreak++; else break; }

  // ★ "AAPKI PICHHLI 4 TRADES" — creator ka apna thermometer
  // "Aap INDEX TRADER ho kya? Aapki last 4 trades kaisi thi — EASY feel kara
  // rahi hain ki TOUGH?" Market ka thermometer index nahi, apni trades hain.
  const lastTrades = (() => {
    const done = state.closed.filter(t => ['win', 'sl', 'fail'].includes(t.status) && t.ts)
      .sort((a, b) => (a.exitTs || a.ts) - (b.exitTs || b.ts)).slice(-10)
      .map(t => ({ symbol: t.symbol, status: t.status, pnlPct: t.pnlPct ?? 0, picked: t.picked }));
    if (!done.length) return null;
    const last4 = done.slice(-4);
    const wins = last4.filter(t => t.pnlPct > 0).length;
    const net = round2(last4.reduce((a, t) => a + t.pnlPct, 0));
    const feel = wins >= 3 || net > 8 ? 'EASY' : wins <= 1 && net < -3 ? 'TOUGH' : 'MIXED';
    return {
      trades: done, last4, wins, net, feel,
      note: feel === 'EASY' ? 'Pichhli chaar me paisa bana hai — market saath de raha hai. Par yaad rakho: sabse badi galti JEET ke baad hoti hai.'
        : feel === 'TOUGH' ? 'Pichhli chaar tough rahi. Size chhoti rakho, selective raho — bura market khud ek risk-control hai.'
          : 'Mila-jula. Na easy, na tough — normal size, normal selectivity.'
    };
  })();

  // --- display journal (closed + open/pending) ---
  const journalOut = [
    // Backtest ab 5 saal ka hai (~2900 trades). Kaatna nahi hai — warna equity
    // curve beech se shuru hoti hai aur "5Y" range ka matlab hi khatam. Dashboard
    // pe range selector (1D/1W/1M/1Y/5Y/All) hai, wahi render ko halka rakhta hai.
    ...state.closed.slice(-4000),
    ...state.positions.filter(p => p.entryStatus === 'open').map(p => ({
      picked: p.picked, ts: p.pickedTs || null, symbol: p.symbol, sector: p.sector, gear: p.gear, entry: p.entry,
      qty: p.qty, invested: p.invested, status: 'open', pnlPct: p.curPnlPct ?? 0,
      reason: `Open — entry ${p.entry}, SL ${p.sl}${(p.curPnlPct ?? 0) >= 8 ? ', partial book zone me hai' : ''}`
    }))
  ];

  // ★ POSITIONS BLOCK — dashboard ka apna "Positions" tab isse chalta hai.
  // Pehle khuli positions Track Record ki journal TABLE me ek row thi — jahan wo
  // history ke beech dabi rehti thi aur "abhi kya karna hai" kahin nahi dikhta tha.
  // Ye block wahi batata hai: abhi ka bhaav, trail kahan hai, agla kadam kya hai.
  // NOTE: ye sirf DISPLAY hai. Faisle upar wala journal-update loop hi leta hai.
  const positionsOut = state.positions.filter(p => p.entryStatus === 'open').map(p => {
    const ch = charts[p.symbol];
    const c = ch?.c;
    const cmp = c ? roundPrice(c[c.length - 1]) : p.entry;
    const pnlPct = round2((cmp - p.entry) / p.entry * 100);
    const trail = c && c.length >= TRAIL_MA ? roundPrice(sma(c, TRAIL_MA)) : null;
    const bookAt = roundPrice(p.entry * (1 + BOOK_AT / 100));
    // Agla kadam — wahi tarteeb jo journal loop use karta hai
    let next;
    if (cmp <= p.sl) next = `⚠️ SL (${p.sl}) ke neeche — exit zone`;
    else if (!p.booked && cmp < bookAt) next = `+${BOOK_AT}% pe (₹${bookAt}) aadha book hoga — abhi ${round2((bookAt - cmp) / cmp * 100)}% door`;
    else if (trail) next = `Aadha book ho chuka. Ab ${TRAIL_MA} DMA (₹${trail}) ke neeche CLOSE = bahar`;
    else next = `${TRAIL_MA} DMA abhi bani nahi — SL ${p.sl} hi chalega`;
    return {
      symbol: p.symbol, sector: p.sector, gear: p.gear, sizePct: p.sizePct ?? p.fullSize ?? null,
      picked: p.picked, pickedTs: p.pickedTs || null, triggerDate: p.triggerDate || null,
      daysHeld: p.daysSinceTrigger ?? null,
      entry: p.entry, qty: p.qty, invested: p.invested,
      cmp, pnlPct, pnlAmt: round2((p.invested || 0) * pnlPct / 100),
      sl: p.sl, slDistPct: round2((cmp - p.sl) / cmp * 100),
      booked: !!p.booked, bookAt, trail, next,
      // Khuli position ko result ke aar-paar hold karna documented galti hai —
      // isliye warning picks se zyada YAHAN zaroori hai
      ...(earningsMap.get(p.symbol) ? {
        earnIn: Math.round((earningsMap.get(p.symbol) - new Date(sessionTs * 1000)) / 86400000),
        earnOn: earningsMap.get(p.symbol).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
      } : {}),
      stale: !ch,   // chart nahi mila — bhaav purana ho sakta hai
      spark: c ? c.slice(-17).map(roundPrice) : []
    };
  });
  const deployedNow = positionsOut.reduce((a, p) => a + (p.invested || 0), 0);

  // ★ AAJ KYA BADLA — pichhle session se farak.
  // ⚠️ Ye block positionsOut ke BAAD hona zaroori hai (const TDZ), warna
  // "Cannot access before initialization" pe scan gir jaata hai.
  const prev = histOut.length > 1 ? histOut[histOut.length - 2] : null;
  const changes = (() => {
    if (!prev) return null;
    const out = [];
    if (prev.gear !== gear) out.push({ kind: 'gear', text: `Gear ${prev.gear} se ${gear} ${gear > prev.gear ? '↑ badha' : '↓ gira'}` });
    for (const x of todayHist.sec.filter(x => !prev.sec.includes(x))) out.push({ kind: 'sector-in', text: `${x} ab hot list me AAYA` });
    for (const x of prev.sec.filter(x => !todayHist.sec.includes(x))) out.push({ kind: 'sector-out', text: `${x} hot list se NIKLA` });
    for (const p of positionsOut) {
      if (p.cmp <= p.sl) out.push({ kind: 'sl', text: `⚠️ ${p.symbol} SL (₹${p.sl}) ke neeche` });
      else if (!p.booked && p.cmp >= p.bookAt) out.push({ kind: 'book', text: `${p.symbol} book-zone me (₹${p.bookAt}) — aadha book hoga` });
      else if (p.trail && p.cmp <= p.trail * 1.02) out.push({ kind: 'trail', text: `${p.symbol} 40 DMA ke bilkul paas — cushion sirf ${round2((p.cmp - p.trail) / p.cmp * 100)}%` });
    }
    for (const [sym, t] of Object.entries(track.names || {})) {
      if (t.crossed && t.crossedTs === sessionTs) out.push({ kind: 'cross', text: `${sym} ne pivot ₹${t.pivot} cross kiya (watchlist se)` });
    }
    return out.slice(0, 8);
  })();
  console.log(`Positions block: ${positionsOut.length} open, ₹${Math.round(deployedNow).toLocaleString('en-IN')} lagi hui`);

  /* ★ BREAKOUT KE BAAD KYA HUA — naya ledger.
     Watch tracker sirf "crossed: haan/na" likhta tha. Jo naam pivot se 0.23% upar
     jaake mar gaya aur jo 6% bhaaga — dono ka record ek jaisa. Watchlist ka report
     card AUR Numbers Check ka poora imtihaan usi kamzor naap pe khada tha.
     Ab har breakout ki poori kahani banti hai: roz ka bhaav, volume, aur nateeja.

     Timeline JOURNAL ME NAHI JAATI — har scan pe chart se dobara banti hai
     (breakouts.mjs dekho, wahan wajah likhi hai). Journal me sirf ENTRY jaati hai. */
  let breakoutLog = null;
  try {
    const boCand = [];
    const seen = new Set();
    /* ★ Chaabi me WAQT bhi hona zaroori hai. Pehle sirf symbol|source thi, aur usse
       ek hi stock pe dobara li gayi trade gir jaati thi — STYLAMIND 3 baar pick hua
       par ledger me 1 hi aaya, aise 22 stock the. Har pick apna alag breakout hai.
       (Aadha-book wale do closed row ka ts ek hi hota hai, wo sahi tarah se ek hi
        entry bante hain — wahi to hum chahte hain.) */
    const add = (symbol, sector, pivot, fromTs, source, fundStampObj, sl) => {
      const k = symbol + '|' + source + '|' + (fromTs || 0);
      if (!symbol || !(pivot > 0) || seen.has(k)) return;
      seen.add(k);
      boCand.push({ symbol, sector, pivot, sl: (sl > 0 ? sl : null), fromTs, source, fund: fundStampObj || null });
    };
    // (a) watchlist ke wo naam jinhone pivot cross kiya
    for (const [sym, t] of Object.entries(track.names || {}))
      if (t.crossed && t.crossedTs) add(sym, t.sector, t.pivot, t.firstSeen, 'watchlist', t.fund, t.sl);
    for (const dd of track.done || [])
      if (dd.crossed) add(dd.symbol, dd.sector, dd.pivot, null, 'watchlist', dd.fund, dd.sl);
    // (b) asli trades — khuli aur band dono. Inka entry hi pivot hota hai (stop-buy).
    for (const p of state.positions || []) add(p.symbol, p.sector, p.pivot ?? p.entry, p.pickedTs, 'trade', p.fund, p.sl);
    for (const c of state.closed || []) add(c.symbol, c.sector, c.entry, c.ts, 'trade', null, c.sl);

    // chart chahiye. Jo universe me nahi mila usko alag se laao, par ginti bandhi hui.
    const boCharts = new Map();
    let fetched = 0;
    for (const e of boCand) {
      if (charts[e.symbol]) { boCharts.set(e.symbol, charts[e.symbol]); continue; }
      if (fetched >= 40) continue;
      const ch = await fetchChart(e.symbol + '.NS');
      if (ch) { boCharts.set(e.symbol, ch); fetched++; }
    }

    const entries = [];
    const boSeen = new Set();
    for (const e of boCand) {
      const ch = boCharts.get(e.symbol); if (!ch) continue;
      const bo = findBreakout(ch, e.pivot, e.fromTs, e.fromTs ? WATCH_DAYS : null);
      if (!bo) continue;
      // do alag pick agar EK HI din, EK HI pivot pe pahunche to wo ek hi breakout hai
      const k = e.symbol + '|' + bo.ts + '|' + e.pivot;
      if (boSeen.has(k)) continue;
      boSeen.add(k);
      entries.push({ symbol: e.symbol, sector: e.sector, pivot: e.pivot, sl: e.sl, boTs: bo.ts, source: e.source, fund: e.fund });
    }
    /* ★ DELIVERY LOG — journal me chhota sa record.
       Timeline har scan pe chart se dobara banti hai, aur chart me sirf AAJ ka
       delivery hota hai. Isliye bina store kiye delivery kabhi jamaa hi nahi hoti
       (audit ne pakda: 1022 din me se 32). Ab roz ka delivery yahan likhte hain.
       Chhota rakhne ke liye: sirf un stocks ka jinka breakout ABHI chal raha hai,
       aur sirf pichhle 60 din ka. */
    const dl = state.delivLog || {};
    const preview = buildAll(entries, boCharts);
    const liveSyms = new Set(preview.filter(b => b.live).map(b => b.symbol));
    if (!alreadyProcessed) {
      const today = new Date(sessionTs * 1000).toLocaleDateString('en-CA', { timeZone: IST });
      const cutoff = new Date((sessionTs - 60 * 86400) * 1000).toLocaleDateString('en-CA', { timeZone: IST });
      for (const sym of liveSyms) {
        const ch = boCharts.get(sym);
        if (!ch || ch.deliv == null) continue;
        (dl[sym] = dl[sym] || {})[today] = ch.deliv;
      }
      for (const sym of Object.keys(dl)) {
        if (!liveSyms.has(sym)) { delete dl[sym]; continue; }   // breakout khatam = log bhi khatam
        for (const dt of Object.keys(dl[sym])) if (dt < cutoff) delete dl[sym][dt];
      }
      state.delivLog = dl;
    }
    const full = buildAll(entries, boCharts, { deliv: dl });
    const summary = summarize(full);   // summary POORI list pe — kaat-chhaant se pehle
    /* ★ data.js ka size bandho. Daily rows hi is panel ki jaan hain, par unhi se
       file phoolti hai (99 breakout = 1395 row = 156 KB). Isliye:
         · chal rahe SAARE breakout ke rows rehte hain
         · settle hue me sirf pichhle 120 din wale ke rows rehte hain
         · usse purane sirf SUMMARY banke rehte hain (nateeja, best move, sessions)
         · list khud 160 pe cap — usse purane bilkul chhod dete hain
       Summary upar poori list se bana hai, to report card ke aankde poore rehte hain. */
    const CUT = Date.now() / 1000 - 120 * 86400;
    const list = full.slice(0, 160).map(b => (b.live || b.boTs >= CUT) ? b : (({ days, ...rest }) => ({ ...rest, daysDropped: days.length }))(b));
    breakoutLog = { list, summary, bars: BO, shown: list.length, total: full.length };
    if (!alreadyProcessed) {
      // record ke liye — panel iske bina bhi chalta hai (sab kuch derive hota hai)
      state.breakouts = { updated: new Date().toISOString(), entries: entries.map(({ days, ...e }) => e) };
    }
    const sm = breakoutLog.summary;
    console.log('Breakout ledger: ' + list.length + ' breakout (' + (sm ? sm.live : 0) + ' chal rahe, ' +
      (sm ? sm.settled : 0) + ' settle) | traction ' + (sm && sm.tractionRate != null ? sm.tractionRate + '%' : '-') +
      (fetched ? ' | ' + fetched + ' extra chart' : ''));
  } catch (e) { console.log('Breakout ledger skip (' + e.message + ') — baaki dashboard poora hai.'); }

  // ★ RULE QUOTES — creator ke apne shabd card pe.
  // Source of truth trading-brain/brain/rules.json hai, PAR cloud runner ke paas
  // sirf dashboard repo hota hai. Isliye: local run pe source se padho aur
  // dashboard/rules-ui.json me chhota snapshot likh do (wo commit hota hai);
  // cloud me source na mile to snapshot se kaam chala lo. Self-healing —
  // koi manual copy step nahi, aur drift bhi nahi (har local run refresh karta hai).
  let ruleQuotes = {};
  try {
    const src = JSON.parse(readFileSync(join(ROOT, '..', 'brain', 'rules.json'), 'utf8'));
    for (const r of src.rules) {
      if (!r.quote && !r.gloss) continue;
      ruleQuotes[r.id] = { title: r.title, quote: r.quote || null, gloss: r.gloss || null, status: r.status, note: r.vault?.note || null };
    }
    writeFileSync(join(ROOT, 'rules-ui.json'), JSON.stringify(ruleQuotes));
  } catch {
    try { ruleQuotes = JSON.parse(readFileSync(join(ROOT, 'rules-ui.json'), 'utf8')); } catch { ruleQuotes = {}; }
  }

  // --- 5-saal ka strategy test (alag file, backtest.mjs --summary se banti hai) ---
  let strategyTest = null;
  try { strategyTest = JSON.parse(readFileSync(join(ROOT, 'strategy-test.json'), 'utf8')); } catch { }

  // --- data.js write ---
  const now = new Date();
  const dashboard = {
    demo: false,
    generatedAt: `${fmtLong(now)} · ${now.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })} IST`,
    sessionDate,
    nextTradingDay: nextTradingDay(sessionTs),
    portfolio: {
      startCapital: START_CAPITAL,
      sizingRule: SIZE_BY_GEAR.every(s => s === SIZE_BY_GEAR[0])
        ? `Har trade ${SIZE_BY_GEAR[0]}% of capital. Exit: +${BOOK_AT}% pe ${Math.round(BOOK_PART * 100)}% book, baaki ${TRAIL_MA} DMA pe trail`
        : `Gear-based sizing: ${SIZE_BY_GEAR.map((s, i) => `gear ${i + 1} = ${s}%`).join(', ')}`,
      sizeByGear: SIZE_BY_GEAR
    },
    // Risk ramp ki abhi ki haalat — dashboard pe dikhana zaroori hai, warna user ko
    // pata nahi chalega ki aaj poori size leni hai ya aadhi
    riskRamp: {
      mode: rampedUp ? 'full' : 'test',
      winningOpen, openCount: openNow.length, need: RAMP_NEED, maxTest: RAMP_MAX,
      sizePct: rampedUp ? SIZE_BY_GEAR[gear - 1] : TEST_SIZE,
      note: rampedUp
        ? `${winningOpen} positions +${RAMP_GAIN}% se upar chal rahi hain — market feedback accha hai, full size (${SIZE_BY_GEAR[gear - 1]}%) pe khelo.`
        : `Abhi sirf ${winningOpen} position +${RAMP_GAIN}% se upar hai. Market se feedback le rahe hain — aadhi size (${TEST_SIZE}%), max ${RAMP_MAX} positions. ${RAMP_NEED} chalne lagein tab gear up karenge.`
    },
    // 5-saal ka strategy test (₹1 lakh pe, 31 Mar 2026 tak) — ye chalu portfolio se
    // ALAG hai. Wo proof hai ki framework kaam karta hai; ye FY 26-27 ka asli hisaab.
    strategyTest,
    market: { gear, gearLabel, verdict: verdicts[gear], checks },
    hotSectors: hotSectors.slice(0, 4).map(({ name, note }) => ({ name, note })),
    sectorPlays,
    // Universe health — system ab bata sakta hai ki wo kitna DEKH paa raha hai.
    // Ye isliye hai kyunki 272 stocks 4 mahine se chup-chaap skip ho rahe the
    // (NSE pe naya ticker = chhoti history) aur kahin koi ginti nahi thi.
    universeHealth: {
      listed: fullUniverse.length,
      prefiltered: universe.length,
      fetched: Object.keys(charts).length,
      scanned: health.scanned,
      skippedShortHistory: health.shortHistory,
      skippedIlliquid: health.illiquid,
      noSector: health.noSector,
      bseStitched: health.stitched,
      bseOnly: health.boOnly,
      bseRejected: health.boRejected,
      sectorCoveragePct: Math.round((fullUniverse.length - fullUniverse.filter(u => u.sec === 'Other').length) / fullUniverse.length * 100)
    },
    picks,
    watchlist,
    // Numbers Check — sirf confidence panel, ranking ko chhuta nahi
    fund,
    // Breakout ke baad kya hua — naapne ke liye, filter ke liye NAHI
    breakoutLog,
    // Gear 1-2 pe picks 0 hote hain. Tab bhi user ko pata hona chahiye ki andar
    // kitna maal hai — warna lagta hai scanner ne kuch dhoonda hi nahi.
    readyCount: readyCands.length,
    candidateCount: candidates.length,
    lastPicks,
    watchStats,
    history: histOut,
    gearStreak,
    changes,
    lastTrades,
    ruleQuotes,
    positions: positionsOut,
    deployed: round2(deployedNow),
    journal: journalOut
  };

  writeFileSync(join(ROOT, 'data.js'),
    '// AUTO-GENERATED by scripts/scan.mjs — haath se edit mat karo\n' +
    'window.DASHBOARD_DATA = ' + JSON.stringify(dashboard, null, 2) + ';\n');
  // Kaunsi bhavcopy is display me lagi hai — yaad rakho, warna har run "stale" samajh ke
  // dobara refresh karta rahega.
  if (bhavDateStr && state.lastBhav !== bhavDateStr) {
    state.lastBhav = bhavDateStr;
    writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  }
  console.log(`Done. Session ${sessionDate}${alreadyProcessed ? ' (display refresh, journal untouched)' : ''} | bhav ${bhavDateStr || 'nahi'} | gear ${gear} | picks ${picks.length} | equity ₹${state.equity}`);
}

main().catch(e => { console.error(e); process.exit(1); });
