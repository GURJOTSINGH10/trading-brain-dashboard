/* ============================================================================
   fundamentals.mjs — "Numbers Check" panel ka data layer
   ----------------------------------------------------------------------------
   Ye SELECTION nahi karta. Ye sirf CONFIDENCE dikhata hai.

   Creator ka stand (mining/_buckets/fundamentals.md se, quote-verified):
     · "स्टॉक प्राइसेस आर स्लेव ऑफ अर्निंग्स"           → earnings hi asli fuel hai
     · "वी आर प्लेइंग ब्रेकआउट्स"                       → par entry chart se hi hoti hai
     · "इतना देखें कि कहां पे ग्रोथ आ रही है"           → padhne ki depth yahin tak
     · "30% ग्रो कर रहे हो तो तीन से कम साल में डबल"    → ekmaatra numeric bar
     · "नंबर्स अपने आप में कोई मैटर नहीं करते...
        प्राइस एक्शन क्या मैच कर रहा है?"               → teeno match hone chahiye
     · Transrail: "अर्निंग्स के अगले दिन से ही लोवर
        सर्किट... द रिएक्शन इज नॉट गुड"                → numbers se bada unka REACTION

   Isliye do naap nikalte hain:
     1. GROWTH   — akhri quarter ka sales/PAT, 30% bar ke against
     2. REACTION — un numbers pe market ne us din kya kiya, aur pakda ya chhod diya

   DATA SOURCE (3 Sep 2026 pe live verify kiya):
     https://www.nseindia.com/api/top-corp-info?symbol=X&market=equities
       → financial_results.data = akhri 5 quarter (income, PAT, dil-EPS, broadcast ts)
     ⚠️ PURANA /api/corporates-financial-results ab MARA HUA hai — wo Jan 2025 pe
        freeze hai (har symbol pe). Uspe wapas mat jaana.

   Fail-safe: koi bhi cheez toote to null lautao. Scan kabhi nahi rukega.
   ========================================================================== */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const GROWTH_BAR = 30;   // creator ka "30% = 3 saal me double" wala bar
const POP_BAR    = 4;    // result-day pe itna move = market ne dhyan diya
const HOLD_BAR   = 0.7;  // us pop ka itna hissa bacha = pakde rakha hai
const GIVEBACK   = 0.3;  // isse neeche = pop & drop

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const pct = (a, b) => (a == null || b == null || b === 0) ? null : ((a - b) / Math.abs(b)) * 100;
const istDay = ts => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function parseDate(s) {
  const m = /(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s || '');
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  return { ms: Date.UTC(+m[3], mon, +m[1], +(m[4] || 0), +(m[5] || 0)),
           hh: m[4] == null ? null : +m[4], mm: m[5] == null ? null : +m[5] };
}

/* ---------- NSE session (wahi cookie pattern jo scan.mjs use karta hai) ---------- */
export async function nseSession() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const home = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(timer);
    const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    return cookie || null;
  } catch { return null; }
}

async function corpInfo(sym, cookie) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://www.nseindia.com/api/top-corp-info?symbol=' + encodeURIComponent(sym) + '&market=equities', {
      headers: {
        'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/get-quotes/equity?symbol=' + encodeURIComponent(sym)
      }, signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ---------- 5 raw rows → distinct quarters, newest first ----------
   API duplicate rows deta hai (ek hi quarter do baar broadcast hua), aur
   Consolidated/Non-Consolidated mix kar deta hai. Ek hi basis pe tulna karo. */
function quarters(json) {
  const raw = json && json.financial_results && json.financial_results.data;
  if (!Array.isArray(raw) || !raw.length) return [];
  const byDate = new Map();
  for (const row of raw) {
    const d = parseDate(row.to_date); if (!d) continue;
    const bc = parseDate(row.re_broadcast_timestamp);
    const prev = byDate.get(d.ms);
    if (prev && prev.bcMs && bc && bc.ms <= prev.bcMs) continue;   // purana broadcast chhod do
    byDate.set(d.ms, {
      ms: d.ms, to: row.to_date, basis: row.consolidated || null, audited: row.audited || null,
      inc: num(row.income), pat: num(row.proLossAftTax), eps: num(row.reDilEPS),
      bc: row.re_broadcast_timestamp || null, bcMs: bc ? bc.ms : null,
      bcHH: bc ? bc.hh : null, bcMM: bc ? bc.mm : null
    });
  }
  const list = [...byDate.values()].sort((a, b) => b.ms - a.ms);
  if (!list.length) return [];
  // ★ Ek hi basis pe tulna, warna hisaab jhootha. Pehle yahan fallback tha jo
  //   Consolidated aur Non-Consolidated MILA deta tha — wo galat tha. Ab agar
  //   sabse nayi row ka basis akela pada hai to hum growth hi nahi dikhate,
  //   galat growth dikhane se behtar hai kuch na dikhana.
  const basis = list[0].basis;
  const same = list.filter(q => q.basis === basis);
  if (same.length >= 2) return same;
  const other = {};
  for (const q of list) other[q.basis || '?'] = (other[q.basis || '?'] || 0) + 1;
  const best = Object.entries(other).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? list.filter(q => (q.basis || '?') === best[0]) : same;
}

/* ---------- growth: YoY pehli pasand, na mile to QoQ ---------- */
function growth(qs) {
  const cur = qs[0]; if (!cur) return null;
  const yoy = qs[4] || null, qoq = qs[1] || null;
  let base = yoy, tag = 'YoY';
  // YoY base me numbers hi na hon to QoQ pe gir jao (adhura data chhupana nahi hai)
  if (!base || (base.pat == null && base.eps == null && base.inc == null)) { base = qoq; tag = 'QoQ'; }
  if (!base) return null;

  const sales = (cur.inc > 0 && base.inc > 0) ? pct(cur.inc, base.inc) : null;

  // profit ke liye PAT pehli pasand, na mile to EPS
  let cp = cur.pat, bp = base.pat, src = 'PAT';
  if (cp == null || bp == null) { cp = cur.eps; bp = base.eps; src = 'EPS'; }

  /* ★ % growth SIRF tab banta hai jab dono taraf munafa ho.
     Ghaate se tulna karne pe number bemaani ho jaata hai: -5662 se +91482 ko
     "1896% growth" kehna galat hai, wo TURNAROUND hai. Aur turnaround creator ke
     "30% growth = 3 saal me double" wale hisaab ko poora nahi karta, isliye wo leg
     hara NAHI hota — par khabar achhi hai, isliye alag se dikhate hain. */
  let profit = null, state = 'na', turnaround = false;
  if (cp != null && bp != null) {
    if (cp <= 0) state = 'loss';                          // is quarter ghaata
    else if (bp <= 0) { state = 'turnaround'; turnaround = true; }
    else { profit = pct(cp, bp); state = 'ok'; }
  }

  let verdict = 'numbers adhure hain', cls = 'na', ok = false;
  if (state === 'loss') {
    verdict = 'is quarter ' + src + ' ghaate me hai'; cls = 'bad';
  } else if (state === 'turnaround') {
    verdict = 'ghaate se munafe me aaya — turnaround (30% wala bar ispe lagta hi nahi)';
    cls = 'good';   // khabar achhi hai
    ok = false;     // par 30%+ growth wali shart poori NAHI hui
  } else if (profit != null) {
    if (profit >= GROWTH_BAR && sales != null && sales >= GROWTH_BAR) {
      verdict = '30%+ dono me — creator ka bar paar'; cls = 'good'; ok = true;
    } else if (profit >= GROWTH_BAR) {
      verdict = 'profit 30%+ (sales peeche)'; cls = 'good'; ok = true;
    } else if (profit > 0) {
      verdict = 'growth hai par 30% se kam'; cls = 'mid';
    } else {
      verdict = 'de-growth'; cls = 'bad';
    }
  }
  return {
    tag, sales, profit, src, verdict, cls, ok, turnaround, state,
    curProfit: cp, baseProfit: bp,
    quarter: cur.to, basis: cur.basis, on: cur.bc
  };
}

/* ---------- reaction: un numbers pe market ne kya kaha ----------
   Result 3:30 ke baad aaya to reaction agle session me. */
function reaction(chart, cur) {
  if (!chart || !cur || !cur.bcMs || !chart.t || !chart.t.length) return null;
  const bcDay = new Date(cur.bcMs).toISOString().slice(0, 10);
  // bell 15:30 pe bajti hai — 15:10 ka result USI din ke bar me dikhta hai,
  // 15:45 ka agle din. Pehle poora 3 baje ka ghanta "after-hours" gina jaata tha.
  const late = cur.bcHH != null && (cur.bcHH > 15 || (cur.bcHH === 15 && (cur.bcMM ?? 0) >= 30));
  let i = chart.t.findIndex(ts => istDay(ts) >= bcDay);
  if (i < 0) return null;
  if (late && istDay(chart.t[i]) === bcDay) i++;
  if (i < 1 || i >= chart.t.length) return null;

  const pre = chart.c[i - 1], day = chart.c[i], now = chart.c[chart.c.length - 1];
  const moveDay = pct(day, pre), since = pct(now, pre);
  // held = result-day ke pop ka kitna hissa abhi bhi bacha hai.
  // 1 se zyada ho sakta hai (stock aur upar chala gaya) — UI wahan alag likhta hai.
  const held = (moveDay != null && moveDay > 0 && since != null) ? since / moveDay : null;

  let volX = null;
  if (chart.v && chart.v.length) {
    const back = chart.v.slice(Math.max(0, i - 21), i).filter(x => x > 0);
    if (back.length) volX = chart.v[i] / (back.reduce((s, x) => s + x, 0) / back.length);
  }

  let verdict, cls, ok = false;
  if (moveDay == null) { verdict = 'reaction nahi padh paaye'; cls = 'na'; }
  else if (moveDay >= POP_BAR && held != null && held >= HOLD_BAR) { verdict = 'result pe bhaaga AUR gain pakde rakha'; cls = 'good'; ok = true; }
  else if (moveDay >= POP_BAR && held != null && held >= GIVEBACK) { verdict = 'accha reaction, thoda give-back'; cls = 'good'; ok = true; }
  else if (moveDay > 0 && held != null && held < GIVEBACK) { verdict = 'pop & drop — reaction sustain nahi hui'; cls = 'mid'; }
  else if (moveDay > 0) { verdict = 'halka positive reaction'; cls = 'mid'; ok = true; }
  else if (moveDay <= -POP_BAR) { verdict = 'numbers pe bech diya'; cls = 'bad'; }
  else { verdict = 'market ko khaas farak nahi pada'; cls = 'mid'; }

  return { day: istDay(chart.t[i]), moveDay, since, held, volX, sessionsAgo: chart.t.length - 1 - i, verdict, cls, ok };
}

/* ---------- ek symbol ka poora Numbers Check ---------- */
export async function fundamentalsFor(sym, cookie, chart) {
  const json = await corpInfo(sym, cookie);
  const qs = quarters(json);
  if (!qs.length) return null;
  const g = growth(qs);
  const rx = reaction(chart, qs[0]);
  /* Purana → naya. income ki UNIT company-dar-company alag hai (zyadatar ₹ lakh),
     isliye absolute rupaya kabhi mat dikhana. EPS per-share hai, wo safe hai;
     sales/PAT sirf SHAPE ke liye (bar) aur %-change ke liye use karo. */
  const series = qs.slice(0, 5).reverse().map((q, i, arr) => {
    const prev = arr[i - 1];
    return {
      q: q.to, eps: q.eps, inc: q.inc, pat: q.pat,
      incQoQ: prev ? pct(q.inc, prev.inc) : null,
      patQoQ: prev ? pct(q.pat, prev.pat) : null
    };
  });

  return {
    quarter: qs[0].to, basis: qs[0].basis, resultOn: qs[0].bc,
    growth: g, reaction: rx, series,
    eps: qs.slice(0, 5).map(q => q.eps),
    // teesri leg (price action / setup) scanner deta hai — wahan jodenge
    legs: { growth: !!(g && g.ok), reaction: !!(rx && rx.ok) }
  };
}

/* ---------- batch. charts = Map(symbol → {t,c,v}) ya undefined ---------- */
export async function fetchFundamentals(symbols, charts) {
  const out = new Map();
  const list = [...new Set(symbols)].filter(Boolean);
  if (!list.length) return out;
  const cookie = await nseSession();
  if (!cookie) { console.log('Fundamentals: NSE session nahi mila — panel skip.'); return out; }
  let ok = 0;
  for (const s of list) {
    try {
      const ch = charts && charts.get ? charts.get(s) : undefined;
      const f = await fundamentalsFor(s, cookie, ch);
      if (f) { out.set(s, f); ok++; }
    } catch { /* ek naam fail ho to baaki chalte rahein */ }
  }
  console.log('Fundamentals: ' + ok + '/' + list.length + ' stocks ke numbers mile');
  return out;
}

/* ---------- aage 21 din ke results (NSE board meetings) ----------
   scan.mjs me yahi call pehle se hai; yahan alag se isliye ki watchlist ko bhi
   "agla result kab" dikhana hai. Creator: fresh breakout ko result ke aar-paar
   hold karna coin toss hai. */
export async function fetchEarningsDates(cookie, daysAhead = 21) {
  const dd = d => String(d.getUTCDate()).padStart(2, '0') + '-' +
                  String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + d.getUTCFullYear();
  const map = new Map();
  try {
    const ck = cookie || await nseSession();
    if (!ck) return map;
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const from = dd(ist), to = dd(new Date(ist.getTime() + daysAhead * 86400000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=' + from + '&to_date=' + to, {
      headers: {
        'User-Agent': UA, 'Cookie': ck, 'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings'
      }, signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return map;
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.data || []);
    for (const row of arr) {
      const sym = row.bm_symbol, dt = row.bm_date;
      if (!sym || !dt) continue;
      if (!/financial result/i.test((row.bm_purpose || '') + ' ' + (row.bm_desc || ''))) continue;
      const p = parseDate(dt);
      if (!p) continue;
      if (!map.has(sym) || p.ms < map.get(sym).ms) map.set(sym, { ms: p.ms, on: dt });
    }
  } catch { /* calendar na mile to panel bina iske chalega */ }
  return map;
}

export const FUND_BARS = { GROWTH_BAR, POP_BAR, HOLD_BAR, GIVEBACK };
