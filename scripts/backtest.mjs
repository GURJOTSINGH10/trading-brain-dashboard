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
import { stitchHistory, needsBseBackfill } from './history.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache');

// MIN_TRADED_VALUE ab --min-tv flag se aata hai (neeche define hota hai)
const WARMUP = 120;                // itne bars ke bina koi setup nahi (scan: n < 120 → skip)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const REFRESH = args.includes('--refresh');
const WRITE = args.includes('--write');
// ★ ENTRY ab DEFAULT me bina volume-confirm ke hai (pivot pe stop-buy jaisa).
// Pehle default me "us din ka volume > 1.2x average" chahiye tha — par jab tumhara
// order pivot pe bharta hai, us waqt poore din ka volume pata hi nahi hota. Aur
// high-volume din aksar bade green din hote hain, to wo condition asal me "jo din
// stock bhaaga usi din khareedo" ban jaati thi. Usi ek cheez se 5-saal ka result
// +305% se -30% ho jaata tha. --vol-confirm se purana (galat) behaviour wapas aata
// hai, sirf comparison ke liye.
const ANY_CROSS = !args.includes('--vol-confirm');
// --next-open: breakout+volume EOD pe confirm karo, entry AGLE din ke open pe.
// Ye poori tarah implementable hai (ye system waise bhi EOD hai) — jabki default
// wala same-din pivot pe entry us din ke TOTAL volume ko pehle se jaanta hai.
const NEXT_OPEN = args.includes('--next-open');
// --vol-exit: pivot pe stop-buy se ghuso (koi look-ahead nahi), phir US DIN KE CLOSE pe
// volume dekho — confirm na ho to wahin nikal jao. Poori tarah implementable, aur entry
// ka bhaav bhi pivot hi rehta hai (next-open wale me chase karna padta hai).
const VOL_EXIT = args.includes('--vol-exit');
const NO_CHASE = parseFloat(argVal('--no-chase', '0')); // % — open pivot se itna upar ho to skip
// --prev-vol: volume condition KAL ke bar pe lagao (jo entry se pehle pata hoti hai)
// aaj ke bar pe nahi. Ye pakka causal test hai: agar edge phir bhi rehta hai to
// volume ki asli information value hai; nahi rehta to wo sirf same-day look-ahead thi.
const PREV_VOL = args.includes('--prev-vol');
// ★ Roz sirf TOP-2 picks. Pehle gear ke hisaab se 3-8 hote the.
// Creator: "एक दो पोजीशन ली। स्टॉक इज़ अप लाइक 10-20%, ऐसे तीन चार स्टॉक मिल गए —
// यू आर लाइक 25% इन्वेस्टेड, दे आर डन।" Scan har candidate ko score deta hai; rank 3
// ke baad signal khatam ho jaata hai, aur wo trades achhi walon ki capital kha jaati
// hain. Dono capitals (₹1L aur ₹6L) pe test kiya — H2 (recent bura market) me PF
// 1.29 se 2.10 ho gaya. --max-picks 0 se purana gear-based behaviour wapas.
const MAX_PICKS = parseInt(argVal('--max-picks', '2'), 10);
// ★ RISK RAMP — creator ka "test trades" wala tarika, uske apne shabdon me:
//   "हमने कुछ एक ट्रेड्स ली टू टेस्ट कि मार्केट कैसा है। अगर यहां पर हमें सफलता मिलती है,
//    ईजीनेस महसूस होता है, तो हम आगे जाएंगे। हम गियर अप करेंगे।"
//   "एक दो पोजीशन ली। स्टॉक इज़ अप लाइक 10-20%... यू आर लाइक 25% इन्वेस्टेड, दे आर डन।"
// Matlab: cash se wapas aate waqt CHHOTI size se shuru karo, aur tabhi poori size pe
// jao jab apni hi 2 positions profit dikha rahi hon. Market ka breadth alag cheez hai —
// ye TUMHARE apne trades ka feedback hai. Flat size me pehli hi trade poori size pe
// lag jaati thi, jo bilkul ulta hai.
const RAMP = args.includes('--ramp');
const TEST_SIZE = parseFloat(argVal('--test-size', '8'));   // test mode me % of capital
const RAMP_NEED = parseInt(argVal('--ramp-need', '2'), 10); // itni open positions profit me = gear up
const RAMP_MAX = parseInt(argVal('--ramp-max', '2'), 10);   // test mode me max itni positions
// Kitna profit ho tab position "chal rahi hai" mani jaye. Creator: "stock is up like
// 10-20%... they are done" — +0.1% ko success maanna uske matlab se door hai.
const RAMP_GAIN = parseFloat(argVal('--ramp-gain', '0'));

// ---- Stock-pick quality filters (transcripts se nikale — test ke liye flags) ----
// --min-gain6 N : stock pichhle ~6 mahine me kam se kam N% bhaag chuka ho.
//   Creator: "ये स्टॉक ट्रेडेबल नहीं है... 15-20% वाले हैं, उनमें पैसा नहीं लगाना"
//   aur "हॉटेस्ट स्टॉक, रिसेंटली 77% ऊपर था". Soye hue stock ka breakout squat karta hai.
const MIN_GAIN6 = parseFloat(argVal('--min-gain6', '0'));
// --min-tv N : minimum 20-din average traded value, CRORE me (default 5)
//   Creator ne ₹3 Cr wale stock ko reject kiya tha — "pehle ek ghante me sirf 50 lakh"
const MIN_TV_CR = parseFloat(argVal('--min-tv', '5'));
// --above-150dma : higher-timeframe check (150 DMA ≈ 30 weekly bars, Stage-2 filter)
//   Creator: "मैंने इसका मंथली चार्ट देखा" — wo weekly/monthly bhi dekhta hai, hum sirf daily.
const ABOVE_150 = args.includes('--above-150dma');
// --skip-sectors "A,B" : jin sectors me strategy kaam nahi karti unhe chhodo
const SKIP_SECTORS = new Set((argVal('--skip-sectors', '') || '').split(',').map(s => s.trim()).filter(Boolean));
// --max-below52 N : 52-week high se itne % se zyada neeche = overhead supply, skip
//   Creator: "काफी ओवरहेड सप्लाई लग रहा था... 33%, 30% होता है तभी मैं लीव करता हूं"
const MAX_BELOW52 = parseFloat(argVal('--max-below52', '0'));
const MIN_TRADED_VALUE = MIN_TV_CR * 1e7;   // crore → rupees
// --hot-bonus N : hot-sector ka score weight (default 4). Creator theme-driven hai —
// "Defence names are doing something good", "metal me action hai" — dekhein weight
// badhane se pick quality sudhrti hai ya nahi.
const HOT_BONUS = parseFloat(argVal('--hot-bonus', '4'));
// --min-bars N : stock ke paas kam se kam itne din ka data ho tabhi setup ban sakta hai.
// Default 120 (~6 mahine) = abhi ka behaviour. Isse kam karne se NAYE LISTINGS dikhne
// lagte hain — abhi 51 liquid naye stocks (INDOMIM ₹1433Cr/din, SBIFUNDS ₹649Cr/din
// waghera) scanner ko bilkul invisible hain. Floor 60 hai kyunki 60-din wale window
// (pbig, s50p) usse neeche toot jaate hain.
// Default 100 (~5 mahine). 120 se ghataya kyunki 51 liquid naye listings invisible the.
// Test: 120→100 pe bada fayda (₹6L FULL +150%→+201%, PF 1.85→2.05, DD -11.7%→-9.9%),
// par 100→80→60 me KOI farak nahi. Matlab fayda 5-6 mahine purani listings se hai,
// 2-mahine wali se nahi. Isliye 100 pe ruke — utna hi fayda, patle data se door.
const MIN_BARS = Math.max(60, parseInt(argVal('--min-bars', '100'), 10));
// Cache hamesha 70+ bars wale sab stocks laati hai; MIN_BARS sirf setup-eligibility
// decide karta hai. Isse ek hi fetch se saari min-bars settings test ho jaati hain.
const FETCH_MIN_BARS = 70;
// --book-at N : +N% pe profit book. 0 = bilkul book mat karo, sirf 10 DMA trail chale.
// --book-part F : +N% pe sirf F fraction becho (creator PARTIAL karta hai), baaki trail pe.
// Kyun: abhi 100% book +8% pe hota hai, aur wo rule trail se PEHLE chalta hai —
// matlab koi winner kabhi +8% se aage jaa hi nahi sakta. Momentum ka saara paisa
// us ek +40% wale runner me hota hai, aur ye rule use 8 pe kaat deta hai.
// Defaults ab creator ke apne shabdon se: "jaise hi DOUBLE DIGIT me aaye to 1/3 ya
// 50% book kar lein, baaki trail karte rahein". Pehle 8% pe 100% book hota tha —
// dono galat the, aur usi ne har winner ko 8% pe kaat diya tha.
const BOOK_AT = parseFloat(argVal('--book-at', '10'));
const BOOK_PART = parseFloat(argVal('--book-part', '0.5'));   // 1 = poora, 0.5 = aadha
// --trail-ma N / --trail-days N : trail kitni dheeli ho.
// Kyun: 10 DMA se neeche ek hi close pe nikal jaana bahut tight hai — avg hold 4
// session reh jaata hai. Momentum move hafton me banta hai, 4 din me nahi. Normal
// pullback bhi 10 DMA tod deta hai, aur hum wahin bahar.
// Creator "10 DMA se trail" bolta hai, par mechanically wo bahut kathor hai — pehla
// close 10 DMA ke neeche aate hi bahar, avg hold 4 session. Wo chart/volume/market
// dekh ke discretion lagata hai, hum nahi laga sakte. 40 DMA hi ek aisi trail hai jo
// backtest ke DONO halves me PF > 1 deti hai (10 DMA: FULL -25%, 40 DMA: +63%).
const TRAIL_MA = parseInt(argVal('--trail-ma', '40'), 10);
const TRAIL_DAYS = parseInt(argVal('--trail-days', '1'), 10); // itne LAGATAR close neeche ho tab bahar

// Ab do alag portfolio chalte hain (Aug 2026 se):
//  1. History  — 5 saal, ₹1 lakh, 31 Mar 2026 tak. Strategy ka proof, freeze.
//  2. Chalu FY — 1 Apr 2026 se, ₹6 lakh (user ki asli trading capital ke kareeb).
// Isliye capital, sizing ladder aur date-range sab flags se aate hain.
const START_CAPITAL = parseFloat(argVal('--capital', '100000'));
const SIZE_BY_GEAR = argVal('--sizes', '10,14,17,21,25').split(',').map(Number);
const FROM = argVal('--from', null);          // YYYY-MM-DD (IST) — is din se replay
const TO = argVal('--to', null);              // YYYY-MM-DD (IST) — is din tak
const SUMMARY_OUT = argVal('--summary', null); // report ka JSON yahan likho
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const FROM_DAY = FROM ? dayNum(FROM) : null;
const TO_DAY = TO ? dayNum(TO) : null;
// Window: explicit number, warna --from se andaaza (250 trading days ≈ 365 calendar)
const todayDay = Math.floor((Date.now() / 1000 + 19800) / 86400);
const WINDOW = parseInt(args.find(a => /^\d+$/.test(a)) || '', 10)
  || (FROM_DAY ? Math.ceil((todayDay - FROM_DAY) * 250 / 365) + 10 : 250);

// Yahoo se utna hi maango jitna chahiye: window + warmup + thoda margin.
// 5-saal ka backtest (1250 sessions) 10y range maangta hai — par 2000 stocks ki
// poori 10-saal history RAM me 1 GB+ le jaati hai, isliye har chart ko turant
// KEEP_BARS pe kaat dete hain. Isse 5y bhi 2y jitni RAM me chalta hai.
const KEEP_BARS = WINDOW + WARMUP + 30;
const RANGE = KEEP_BARS <= 480 ? '2y' : KEEP_BARS <= 1200 ? '5y' : '10y';
// v2 = naye listings bhi included (fetch threshold 130 se 70 bars ho gaya)
// v3 = BSE history backfill (NSE pe naye ticker ki purani history .BO se) — cache
//      ka naam badalna ZAROORI hai, warna purani (adhuri) history reuse ho jaati.
const CACHE_FILE = join(CACHE_DIR, `charts-${RANGE}-v3.json.gz`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round2 = x => Math.round(x * 100) / 100;
const roundPrice = x => x >= 1000 ? Math.round(x) : Math.round(x * 10) / 10;
const IST = 'Asia/Kolkata';
const fmtShort = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const fmtMonth = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, month: 'short', year: '2-digit' });
// IST din-number — do timestamps ek hi trading din ke hain ya nahi, ye batata hai
const istDay = ts => Math.floor((ts + 19800) / 86400);

// ---------- fetch ----------
async function fetchChart(ticker, range = RANGE) {
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
      if (out.c.length < FETCH_MIN_BARS) return null;
      // sirf utne bars rakho jitne is window ke liye chahiye — RAM aur cache dono bachta hai
      if (out.c.length > KEEP_BARS) for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) out[k] = out[k].slice(-KEEP_BARS);
      return out;
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
      console.log(`Chart cache mila (${RANGE}): ${Object.keys(j.charts).length} stocks, ${ageH.toFixed(1)}h purana (--refresh se naya laao)`);
      return j.charts;
    } catch { console.log('Cache corrupt — dobara fetch.'); }
  }
  console.log(`${universe.length} stocks ki ${RANGE} history laa rahe (ek hi baar, phir cache se)...`);
  const charts = {};
  let idx = 0, ok = 0, bse = 0, t0 = Date.now();
  async function worker() {
    while (idx < universe.length) {
      const u = universe[idx++];
      let ch = await fetchChart(u.s + '.NS');
      // ★ scan.mjs ke BARABAR rakhna ZAROORI hai. NSE pe naya ticker = chhoti
      // history, chahe company purani ho (Apr+Aug 2026 me BSE se ~250 companies
      // aayi thi). Agar ye sirf live me hota aur backtest me nahi, to backtest
      // ek ALAG universe pe chalta — bilkul wahi galti jo bug 7f me hui thi
      // (cash constraint backtest me tha, live me nahi).
      // NOTE: yahan bhavcopy nahi hai, to refClose null jaata hai — matlab jinki
      // NS bars 5 se kam hain unka stitch nahi hoga (identity verify nahi ho
      // sakti). Ye jaan-boojhkar conservative hai.
      if (needsBseBackfill(ch)) {
        const bo = await fetchChart(u.s + '.BO');
        if (bo) {
          const r = stitchHistory(ch, bo, null);
          if (r.boBars) {
            ch = r.bars;
            if (ch.c.length > KEEP_BARS) for (const k of ['t','o','h','l','c','v']) ch[k] = ch[k].slice(-KEEP_BARS);
            bse++;
          }
        }
      }
      if (ch) { charts[u.s] = ch; ok++; }
      if (idx % 250 === 0) console.log(`  ${idx}/${universe.length} (mile ${ok}, ${Math.round((Date.now() - t0) / 1000)}s)`);
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, gzipSync(JSON.stringify({ builtAt: new Date().toISOString(), range: RANGE, charts })));
  console.log(`BSE backfill: ${bse} stocks ki purani history .BO se joddi`);
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
  if (si < MIN_BARS) return null;
  const close = c[si];

  // Trend check: normally "close > rising 50 DMA". Par naye listing ke paas 50 DMA
  // hoti hi nahi (ya kachchi hoti hai) — uske liye 20 DMA use karte hain. Ye tabhi
  // hota hai jab MIN_BARS ghataya gaya ho; default 120 pe har stock 50 DMA hi use karta hai.
  const young = si < 120;
  const ma = young ? 20 : 50;
  const s50 = smaAt(S.pc, si, ma), s50p = smaAt(S.pc, si - 10, ma), s10 = smaAt(S.pc, si, 10);
  if (s50 == null || s50p == null) return null;
  if (!(close > s50 && s50 > s50p)) return null;                       // above rising MA

  const tv = (S.ptv[si + 1] - S.ptv[si + 1 - 20]) / 20;
  if (tv < MIN_TRADED_VALUE) return null;                              // liquidity floor

  // ---- pick-quality filters (sab default me OFF, flags se on hote hain) ----
  if (SKIP_SECTORS.size && SKIP_SECTORS.has(S.sec)) return null;
  if (MIN_GAIN6 && (close - c[si - 120]) / c[si - 120] * 100 < MIN_GAIN6) return null;
  if (ABOVE_150) {
    if (si < 160) return null;
    const s150 = smaAt(S.pc, si, 150), s150p = smaAt(S.pc, si - 10, 150);
    if (!(close > s150 && s150 > s150p)) return null;
  }
  if (MAX_BELOW52 && (S.hi252[si] - close) / close * 100 > MAX_BELOW52) return null;

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
  if (hot) score += HOT_BONUS;
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
    if (!ch || ch.c.length < FETCH_MIN_BARS) continue;
    const S = prepare(ch, refDays);
    S.sym = u.s; S.sec = u.sec; S.cap = u.cap || 'Small';
    S.capPref = capPref[S.cap] ?? 2.5;
    stocks.push(S);
  }
  console.log(`Prepared: ${stocks.length} stocks (universe ${universe.length})`);

  // Replay ki hadd: --from/--to diye ho to unke hisaab se, warna last WINDOW sessions
  let startDi = Math.max(WARMUP, N - WINDOW);
  if (FROM_DAY != null) { const i = refDays.findIndex(d => d >= FROM_DAY); if (i >= 0) startDi = Math.max(WARMUP, i); }
  let endDi = N - 1;
  if (TO_DAY != null) { for (let i = 0; i < N; i++) if (refDays[i] <= TO_DAY) endDi = i; }
  const LAST = endDi + 1;   // loop `di < LAST` chalega
  console.log(`Replay: ${fmtShort(T[startDi])} → ${fmtShort(T[endDi])} (${LAST - startDi} sessions) | capital ₹${START_CAPITAL.toLocaleString('en-IN')} | sizes ${SIZE_BY_GEAR.join('/')}%\n`);

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

  for (let di = startDi; di < LAST; di++) {
    // Din ki shuruaat: apni kitni open positions abhi profit me hain? (KAL ke close pe —
    // aaj ka bhaav abhi pata nahi). Yahi wo "feedback" hai jis pe gear up hota hai.
    let winningOpen = 0, openCount = 0;
    for (const p of active.values()) {
      if (p.status !== 'open') continue;
      openCount++;
      const si = p.S.map[di];
      const prevClose = si > 0 ? p.S.c[si - 1] : null;
      if (prevClose && prevClose >= p.entry * (1 + RAMP_GAIN / 100)) winningOpen++;
    }
    const rampedUp = !RAMP || winningOpen >= RAMP_NEED;

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
          // qty/invested asli hain (cash constraint ke saath). Dashboard pehle ye
          // khud dobara nikalta tha — bina cash limit ke — isliye uska equity
          // backtest se ~4% upar chala jaata tha. Ab dono ka number ek hai.
          entry: p.entry, qty: p.qty, invested: p.invested, status, pnlPct, exitDate: fmtShort(T[di]), reason,
          _exitTs: T[di], _pickTs: T[p.pickDi], _hold: p.tDays || 0,
          _buyVal: p.invested, _sellVal: round2(p.qty * px)
        });
        active.delete(sym);
      };

      // --next-open mode: kal EOD pe breakout confirm hua tha, aaj open pe kharido
      if (p.status === 'confirmed') {
        const entryPx = roundPrice(o);
        const alloc = equity * p.sizePct / 100;
        const qty = Math.floor(alloc / entryPx);
        if (qty < 1 || deployed + qty * entryPx > equity) {
          skippedNoCash++;
          closed.push({
            picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
            entry: p.pivot, status: 'no-cash', pnlPct: 0,
            reason: 'Breakout confirm hua, par capital pehle se lagi hui thi — trade chhoot gayi',
            _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
          });
          active.delete(sym);
          continue;
        }
        p.status = 'open'; p.entry = entryPx; p.qty = qty; p.triggerDi = di;
        p.invested = round2(p.qty * p.entry);
        deployed = round2(deployed + p.invested);
        if (deployed / equity * 100 > maxDeployPct) maxDeployPct = deployed / equity * 100;
        p.tDays = 0;
        if (lo <= p.sl) close('sl', Math.min(p.sl, o), `Entry ke din hi SL ${p.sl} hit — turant fail`);
        continue;
      }

      if (p.status === 'pending') {
        // ★ LOOK-AHEAD CHECK — volume condition poore din ka volume dekhti hai, jo
        // breakout ke waqt pata hi nahi hota. Asli me tum pivot pe stop-buy lagate ho
        // aur wo volume kaisa bhi ho, bhar jaata hai. --any-cross se wahi test hota hai.
        const v20 = smaAt(S.pv, si, 20) || 0;
        const volOk = PREV_VOL ? S.v[si - 1] > (smaAt(S.pv, si - 1, 20) || 0) * 1.2
                               : S.v[si] > v20 * 1.2;
        if (hi > p.pivot && (ANY_CROSS || VOL_EXIT || volOk)) {
          if (NEXT_OPEN) { p.status = 'confirmed'; continue; }   // kal ke open pe lenge
          if (NO_CHASE && o > p.pivot * (1 + NO_CHASE / 100)) {  // bahut upar khula = mat chaso
            closed.push({
              picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
              entry: p.pivot, status: 'no-trigger', pnlPct: 0,
              reason: `Pivot se ${round2((o - p.pivot) / p.pivot * 100)}% upar khula — chase nahi karte`,
              _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
            });
            active.delete(sym); continue;
          }
          // ★ CASH CONSTRAINT — ₹1 lakh me 29 positions ek saath nahi khul sakti.
          // Bina iske backtest chup-chaap 5x leverage maan leta tha aur returns
          // jhoothe achhe dikhte the. Paisa nahi hai to trade nahi hoti — bas.
          const entryPx = roundPrice(Math.max(o, p.pivot));
          // Size TRIGGER ke waqt tay hoti hai, pick ke waqt nahi — kyunki feedback
          // (kitni positions profit me hain) tabhi pata hota hai.
          if (RAMP && !rampedUp && openCount >= RAMP_MAX) {
            skippedNoCash++;
            closed.push({
              picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
              entry: p.pivot, status: 'no-cash', pnlPct: 0,
              reason: `Test mode — abhi sirf ${winningOpen} position profit me hai. Pehle ${RAMP_NEED} chalein, tab gear up. Tab tak nayi position nahi.`,
              _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
            });
            active.delete(sym); continue;
          }
          p.sizePct = rampedUp ? p.fullSize : TEST_SIZE;
          const alloc = equity * p.sizePct / 100;
          // ★ qty me Math.max(1, ...) NAHI. Wo MRF/Page jaise ₹1.5 lakh ke share ka
          // 1 share zabardasti khareed leta tha jabki allocation ₹17,000 ki thi —
          // isi wajah se peak deployment 126% pahunch gaya tha. Ek share bhi na
          // aata ho to us stock ki trade is capital me possible hi nahi.
          const qty = Math.floor(alloc / entryPx);
          if (qty < 1 || deployed + qty * entryPx > equity) {
            skippedNoCash++;
            closed.push({
              picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
              entry: p.pivot, status: 'no-cash', pnlPct: 0,
              reason: qty < 1
                ? `Ek share ka bhaav ₹${entryPx} — ${SIZE_BY_GEAR[p.gear - 1]}% position size me aata hi nahi. Is capital me ye trade possible nahi.`
                : 'Breakout to aaya, par capital pehle se lagi hui thi — ye trade chhoot gayi',
              _exitTs: T[di], _pickTs: T[p.pickDi], _hold: 0, _buyVal: 0, _sellVal: 0
            });
            active.delete(sym);
            continue;
          }
          p.status = 'open';
          p.entry = entryPx;
          p.qty = qty;
          p.triggerDi = di;
          p.invested = round2(p.qty * p.entry);
          deployed = round2(deployed + p.invested);
          if (deployed / equity * 100 > maxDeployPct) maxDeployPct = deployed / equity * 100;
          p.tDays = 0;
          // ★ SAME-DAY SL — breakout aur stop ek hi din me ho sakte hain (GNA, 4 Aug)
          if (lo <= p.sl) close('sl', p.sl, `Entry ke din hi SL ${p.sl} hit — breakout turant fail, same-day out`);
          // volume EOD pe confirm nahi hua = fake breakout, usi close pe bahar
          else if (VOL_EXIT && S.v[si] <= v20 * 1.2) close('fail', cl, 'Volume confirm nahi hua — jhoota breakout, usi din close pe nikal gaye');
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
      const s10 = smaAt(S.pc, si, TRAIL_MA);
      if (cl >= s10) p.below = 0;   // MA ke upar wapas = counter reset
      // ★ GAP-DOWN — agar stock SL ke NEECHE khula hai to SL ka bhaav milta hi nahi,
      // open pe hi nikalna padta hai. Bina iske backtest har SL ko exact bhaav pe
      // bhar deta tha = losses asli se chhote dikhte the.
      if (lo <= p.sl) {
        const gap = o < p.sl;
        close('sl', gap ? o : p.sl, gap
          ? `Gap-down — SL ${p.sl} tha, stock ${roundPrice(o)} pe khula. Bhaav mila hi nahi, open pe out.`
          : `SL hit ${p.sl} pe — out, end of story. Sell is a sell.`);
      }
      else if (BOOK_AT > 0 && !p.booked && cl >= p.entry * (1 + BOOK_AT / 100)) {
        if (BOOK_PART >= 1) {
          close('win', cl, `+${round2((cl - p.entry) / p.entry * 100)}% — book zone, profit liya.`);
        } else {
          // PARTIAL book — utna hissa bech ke baaki ko 10 DMA pe chalne do.
          // Realised P&L alag trade ke roop me darj, position chhoti ho ke chalti rehti hai.
          const sellQty = Math.max(1, Math.floor(p.qty * BOOK_PART));
          const pnlPct = round2((cl - p.entry) / p.entry * 100);
          const soldVal = round2(sellQty * p.entry);
          equity = round2(equity + soldVal * pnlPct / 100);
          deployed = Math.max(0, round2(deployed - soldVal));
          closed.push({
            picked: fmtShort(T[p.pickDi]), symbol: sym, sector: S.sec, cap: S.cap, gear: p.gear,
            entry: p.entry, qty: sellQty, invested: soldVal, status: 'win', pnlPct,
            exitDate: fmtShort(T[di]), reason: `+${pnlPct}% — double digit aa gaya, ${Math.round(BOOK_PART * 100)}% book kiya. Baaki ${TRAIL_MA} DMA pe trail hoga.`,
            _exitTs: T[di], _pickTs: T[p.pickDi], _hold: p.tDays || 0, _buyVal: soldVal, _sellVal: round2(sellQty * cl)
          });
          p.qty -= sellQty; p.invested = round2(p.qty * p.entry); p.booked = true;
          if (p.qty < 1) active.delete(sym);
          // Baaki hissa SIRF 10 DMA pe trail hota hai — SL ko entry pe nahi khiskate.
          // Creator ka shabd: "1/3 ya 50% book kar lein, baaki 10 DE se trail karte
          // rahein". SL entry pe le jaana runner ko pehle hi pullback pe kaat deta hai.
        }
      }
      else if (cl < s10 && p.tDays >= 2 && (p.below = (p.below || 0) + 1) >= TRAIL_DAYS) {
        const g = (cl - p.entry) / p.entry * 100;
        close(g >= 0 ? 'win' : 'fail', cl, g >= 0 ? `${TRAIL_MA} DMA trail exit — jo mila le liya` : `${TRAIL_MA} DMA break = story over.`);
      }
      else if (p.tDays >= 3 && cl < p.pivot) close('fail', cl, `Breakout fail — ${p.tDays} din squat, move nahi aaya. Abnormal behavior = out.`);
    }

    let openNow = 0; for (const p of active.values()) if (p.status === 'open') openNow++;
    if (openNow > maxConcurrent) maxConcurrent = openNow;

    // 2) aaj ke naye picks (kal se track honge)
    // Historical run me aakhri kuch din pick mat lo — track karne ki jagah nahi.
    // Lekin AAJ tak chalne wale run me lena hai: wahi to live portfolio ki
    // abhi-khuli positions banti hain jo scan.mjs aage sambhalega.
    if (TO_DAY != null && di > endDi - 5) continue;
    const { gear } = marketAt(di);
    gearDays[gear]++;
    if (gear <= 1) continue;                                 // noTrade — cash bhi ek position hai
    const hot = hotAt(di);
    const maxPicks = MAX_PICKS || (gear >= 5 ? 8 : gear === 4 ? 6 : gear >= 3 ? 5 : 3);

    const cands = [];
    for (const S of stocks) {
      if (active.has(S.sym)) continue;
      const si = S.map[di];
      if (si < MIN_BARS) continue;   // setupAt bhi yahi check karta hai, ye sirf tez raasta
      const r = setupAt(S, si, hot.has(S.sec));
      if (r && r.isReady) cands.push({ S, ...r });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, maxPicks)) {
      active.set(c.S.sym, {
        S: c.S, gear, fullSize: SIZE_BY_GEAR[gear - 1], sizePct: SIZE_BY_GEAR[gear - 1],
        pivot: c.pivot, sl: c.sl, status: 'pending', wait: 0, pickDi: di
      });
    }
  }

  // Replay ke aakhir me jo positions khuli/pending hain — wahi live portfolio ki
  // current holdings hain. scan.mjs inhe kal se aage sambhalega, isliye usi
  // format me likhni padti hain.
  const openPositions = [...active.values()].map(p => {
    let lastClose = null;
    for (let i = endDi; i >= startDi && lastClose == null; i--) if (p.S.map[i] >= 0) lastClose = p.S.c[p.S.map[i]];
    const base = {
      picked: fmtShort(T[p.pickDi]), pickedTs: T[p.pickDi], symbol: p.S.sym, sector: p.S.sec,
      gear: p.gear, fullSize: p.fullSize, sizePct: p.sizePct, pivot: p.pivot, sl: p.sl
    };
    return p.status === 'open'
      // booked flag zaroori hai — warna scan.mjs is position ko kal DOBARA
      // partial-book kar dega (wo `!pos.booked` dekhta hai)
      ? { ...base, entryStatus: 'open', entry: p.entry, qty: p.qty, invested: p.invested,
          booked: !!p.booked, daysSinceTrigger: p.tDays || 0, triggerDate: fmtShort(T[p.triggerDi]),
          curPnlPct: lastClose ? round2((lastClose - p.entry) / p.entry * 100) : 0 }
      : { ...base, entryStatus: 'pending', daysWaiting: p.wait || 0 };
  });

  const stats = report(closed, equity, gearDays, { maxConcurrent, maxDeployPct, skippedNoCash }, T, startDi, endDi);

  if (SUMMARY_OUT) {
    // Equity curve ko ~160 points pe downsample — dashboard ke sparkline ke liye kaafi
    const byExit = closed.filter(t => t.status !== 'no-trigger' && t.status !== 'no-cash').sort((a, b) => a._exitTs - b._exitTs);
    let eq = START_CAPITAL;
    const full = [{ ts: T[startDi], v: eq }];
    for (const t of byExit) { eq += t._buyVal * t.pnlPct / 100; full.push({ ts: t._exitTs, v: Math.round(eq) }); }
    const step = Math.max(1, Math.ceil(full.length / 160));
    const curve = full.filter((_, i) => i % step === 0 || i === full.length - 1);
    writeFileSync(SUMMARY_OUT, JSON.stringify({
      from: fmtLongDate(T[startDi]), to: fmtLongDate(T[endDi]), sessions: LAST - startDi,
      capital: START_CAPITAL, sizeByGear: SIZE_BY_GEAR, builtAt: new Date().toISOString(), ...stats, curve
    }, null, 1));
    console.log(`\nSummary likh di: ${SUMMARY_OUT}`);
  }

  if (WRITE) writeJournal(closed, equity, T, openPositions, T[endDi]);
  else console.log('\n(--write nahi diya — journal.json ko haath nahi lagaya. Track record badalna ho to --write lagao.)');
}

const fmtLongDate = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });

// ---------- journal me likhna ----------
// Journal me DO tarah ki trades hoti hain: backtest ki simulated (bt:true) aur
// live scan ki asli (live:true). Purana code poora closed[] replace kar deta tha —
// isse user ki asli trades (GNA ka same-day SL waghera) mit jaati.
// Aur ulta problem bhi tha: backtest window live period ke UPAR chadh jaati thi,
// to wahi din do baar count hote the. Ab live ki sabse purani pick pe backtest
// kaat dete hain — ek hi timeline, koi overlap nahi.
const istDateStr = ts => new Date(ts * 1000).toLocaleDateString('en-IN', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

function writeJournal(closed, equity, T, positions, lastSessionTs) {
  const path = join(ROOT, 'journal.json');
  let journal = {};
  try { journal = JSON.parse(readFileSync(path, 'utf8')); } catch { }

  // Aug 2026 se: backtest hi is portfolio ka poora record likhta hai (closed + open
  // positions). Pehle live trades ko bachaya jaata tha, par wo trades BUGGY engine ne
  // banayi thi — bina cash constraint ke, aur Math.max(1,...) wale galat qty pe.
  // Unhe rakhna matlab jhoothi history rakhna. Ab engine sahi hai, to poora period
  // isi se dobara simulate hota hai aur scan.mjs kal se aage le jaata hai.
  journal.startCapital = START_CAPITAL;
  journal.sizeByGear = SIZE_BY_GEAR;
  // no-cash bhi journal me jaata hai. Pehle filter kar dete the "ye to diagnostic hai"
  // soch ke — galat tha. Ye SABSE zaroori signal hai: batata hai ki capital chhoti pad
  // rahi hai aur kitne mauke isliye chhoot rahe hain. Dashboard pe apna chip hai.
  journal.closed = closed
    // ts = pick ka waqt (sorting), exitTs = exit ka waqt (equity curve ka time-range filter)
    .map(({ _exitTs, _pickTs, _hold, _buyVal, _sellVal, ...t }) => ({ ...t, ts: _pickTs, exitTs: _exitTs, bt: true }));
  journal.positions = positions;
  journal.equity = round2(equity);
  // lastSession = replay ka aakhri din. Ye ZAROORI hai: backtest us din ko process
  // kar chuka hai, to scan.mjs ko sirf display banana hai. Null chhodne pe scan usi
  // din ko DOBARA process karta — pending positions ek extra din aage badh jaati aur
  // exits do baar check hote.
  journal.lastSession = istDateStr(lastSessionTs);
  journal.lastBhav = null;   // bhavcopy ka apna track — agla scan set kar lega
  journal.backtestedAt = new Date().toISOString();
  journal.backtestWindow = WINDOW;
  writeFileSync(path, JSON.stringify(journal, null, 2));
  const open = positions.filter(p => p.entryStatus === 'open');
  const dep = open.reduce((s, p) => s + (p.invested || 0), 0);
  console.log(`\njournal.json: ${journal.closed.length} closed + ${open.length} open + ${positions.length - open.length} pending`);
  console.log(`  capital ₹${START_CAPITAL.toLocaleString('en-IN')} → equity ₹${Math.round(equity).toLocaleString('en-IN')} | deployed ₹${Math.round(dep).toLocaleString('en-IN')} (${round2(dep / equity * 100)}%)`);
  console.log('Ab `node scripts/scan.mjs --force` chala ke dashboard refresh karo.');
}

// ---------- report ----------
function report(closed, equity, gearDays, cash, T, startDi, endDi) {
  const N = endDi + 1;
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

  return {
    picks: closed.length, trades: traded.length, noTrigger: noTrig, noCash: cash.skippedNoCash,
    wins: wins.length, losses: losses.length, winRate: round2(winRate),
    avgWin: round2(avgWin), avgLoss: round2(avgLoss), expectancy: round2(expectancy),
    profitFactor: round2(pf), avgHold: round2(traded.reduce((s, t) => s + t._hold, 0) / (traded.length || 1)),
    equityGross: Math.round(eq), equityNet: Math.round(eqNet), charges: Math.round(costTotal),
    returnPct: round2((eq - START_CAPITAL) / START_CAPITAL * 100),
    returnNetPct: round2((eqNet - START_CAPITAL) / START_CAPITAL * 100),
    maxDrawdownPct: round2(maxDD), maxConcurrent: cash.maxConcurrent,
    maxDeployPct: round2(cash.maxDeployPct), cashDays: gearDays[1] ?? 0
  };
}

main().catch(e => { console.error(e); process.exit(1); });
