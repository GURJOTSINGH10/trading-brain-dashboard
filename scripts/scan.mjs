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
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      const ch = await fetchChart(u.s + '.NS');
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
    if (ret5 > 1.5 && (up / list.length >= 0.4 || volR > 1.15)) {
      hotSectors.push({ name, heat, note: `5 din me avg ${ret5 > 0 ? '+' : ''}${round2(ret5)}% · ${up}/${list.length} stocks me lagatar action${volR > 1.15 ? ' · volumes badhe hue' : ''}` });
    }
  }
  hotSectors.sort((a, b) => b.heat - a.heat);
  const hotNames = new Set(hotSectors.slice(0, 4).map(s => s.name));

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
      if (n < MIN_BARS) continue;
      const close = c[n - 1];

      // liquidity
      let tv = 0; for (let i = n - 20; i < n; i++) tv += c[i] * v[i];
      tv /= 20;
      if (tv < MIN_TRADED_VALUE) continue;

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

      let sc2 = 0;
      sc2 += (13 - rangePct) * 0.8;           // tighter = better
      sc2 += Math.min(3, (win - 6) * 0.15);   // lamba base = zyada safai ho chuki
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
      if (earnRisk) sc2 -= 8;

      candidates.push({
        symbol: u.s, name: u.n, sector: u.sec, cap: u.cap || 'Small',
        cmp: roundPrice(close), pivot: roundPrice(pivot),
        entry: `${roundPrice(pivot)} pe stop-buy lagao. Volume bhi elevated ho to aur behtar — par paper portfolio sirf pivot cross maanta hai (order to bhar hi jaata hai)`,
        sl, slPct, target: `${t1} – ${t2}`, rr: `1 : ${rr}`,
        setup: superTight ? `Super tight consolidation — ${win} din, ${round2(rangePct)}% range` : `Tight base — ${win} din, ${round2(rangePct)}% range, pivot ke paas`,
        volumeNote: volShrink ? 'Base me volume shrink — classic supply exhaustion.' : 'Volume abhi normal hai — breakout pe elevated chahiye.',
        comment, spark: c.slice(-17).map(roundPrice), flags, _score: sc2, _ready: isReady,
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
  // Watchlist ab HAMESHA dikhti hai — agle 3 ranked candidates. Ye sirf nazar rakhne
  // ke liye hain, journal inhe track NAHI karta (warna backtest se match nahi karega).
  const pickSyms = new Set(picks.map(p => p.symbol));
  const watchlist = candidates.filter(c => !pickSyms.has(c.symbol)).slice(0, 3).map(c => ({
    symbol: c.symbol, name: c.name, sector: c.sector, cap: c.cap,
    cmp: c.cmp, pivot: c.pivot, prox: c.detail.proxPivot, range: c.detail.rangePct
  }));
  console.log(`Candidates: ${candidates.length} (ready: ${readyCands.length}), picks: ${picks.length}, watchlist: ${watchlist.length}, gear: ${gear}`);

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
      entryStatus: 'pending', daysWaiting: 0
    });
  }
  state.lastSession = sessionDate;
  writeFileSync(join(ROOT, 'journal.json'), JSON.stringify(state, null, 2));
  } // end !alreadyProcessed

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
    picks,
    watchlist,
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
