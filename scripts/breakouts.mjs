/* ============================================================================
   breakouts.mjs — "Breakout ke baad kya hua" ka engine.

   SAWAAL jiska jawab ye deta hai: humne jo naam flag kiya aur usne pivot cross
   kiya — uske BAAD roz kya hua? Chala, latka raha, ya mar gaya?

   KYUN ZAROORI HAI: watch tracker abhi sirf `crossed: haan/na` likhta hai. Jo
   naam pivot se 0.23% upar jaake mar gaya aur jo 6% bhaaga — dono ke record me
   ek hi cheez likhi hai. Watchlist ka report card AUR Numbers Check ka poora
   imtihaan isi kamzor naap pe khada hai. Ye module us naap ko graded banata hai.

   ★ DESIGN KA SABSE ZAROORI FAISLA — timeline JOURNAL ME NAHI RAKHTE.
   journal.json me sirf ENTRY jaati hai (symbol, pivot, breakout ka din, source).
   Poori daily timeline har scan pe CHART SE DOBARA banti hai. Faayde:
     · --force pe kabhi duplicate row nahi banti (append wali poori bug-class gayab)
     · journal patli rehti hai (72 KB thi, aise hi rahegi)
     · hisaab hamesha deterministic — wahi chart, wahi nateeja
   Nuksaan: chart 1 saal ka hai, usse purane breakout nahi ban paayenge. Hum
   waise bhi 40 session pe cap kar rahe hain, to farak nahi padta.

   FAIL KI PARIBHASHA — creator ki apni hai, meri banayi hui nahi.
   ONGC case study (vault): breakout wale din ₹1500 cr ki buying aayi, phir bhi
   follow-through nahi aaya, aur "breakout day low toota to 285.95 pe exit".
   Isliye: FAIL = breakout wale din ke LOW ke neeche koi CLOSE.
   (Low ki jagah CLOSE isliye ki intraday wick pe har trade fail dikhne lagti.
    Ye ek CHUNAAV hai — badalna ho to FAIL_ON yahin ek jagah badlo.)

   TEEN NATEEJE — wahi shabd jo scan.mjs ke market thermometer me pehle se hain:
     traction = pivot se +10% (BOOK_AT, yaani asli trade rule) tak gaya
     fail     = breakout-day low ke neeche band hua
     flat     = na chala, na mara — "attraction nahi mila"

   ⚠️ Ye NAAPNE ke liye hai, filter banane ke liye NAHI. rules.json me 15 rule
   test hokar reject ho chuke hain. Jis din ye kahe "kam delivery wale breakout
   fail hote hain", tab bhi wo pehle test gate paar karega.
   ========================================================================== */

export const BO = {
  TRACTION_PCT: 10,     // BOOK_AT ke barabar — yahi asli trade rule hai
  MAX_SESSIONS: 40,     // itne session baad follow karna band (winner ko hamesha nahi taakte rehna)
  SQUAT_SESSIONS: 3,    // itne din me hi low toot gaya = squat, dheere-dheere fade nahi
  VOL_BASE: 20,         // breakout se PEHLE ke itne din ka average = volume ka paimana
  FAIL_ON: 'close-below-breakout-day-low'
};

const round2 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 100) / 100;
const istDay = ts => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ---------- breakout ka din dhundo ----------
   Pehla session jahan HIGH pivot ke upar gaya (fromTs ke baad).
   High isliye, close nahi: order pivot pe stop-buy hota hai, wo intraday hi bhar
   jaata hai. Yahi scan.mjs ke tracker ka bhi tareeka hai (hi > t.pivot). */
export function findBreakout(chart, pivot, fromTs, maxWaitSessions) {
  if (!chart || !chart.t || !chart.t.length || !(pivot > 0)) return null;
  /* ★ maxWaitSessions — pick ke baad itne hi session tak breakout maano.
     Wajah data se aayi: 99 trade-entries me se 90 pick ke 15 din ke andar hi
     break hue. Jo 9 der se aaye, unme sirf 1 ko traction mila (90 me se 26 ke
     muqable). Aur scanner ka apna watch window bhi 15 session ka hai — uske baad
     wo naam chhod deta hai. To 38 din baad hue breakout ko "humara" kehna galat
     hai; hum us waqt use dekh hi nahi rahe the. */
  let waited = 0;
  for (let i = 0; i < chart.t.length; i++) {
    if (fromTs && chart.t[i] < fromTs) continue;
    if (maxWaitSessions != null && waited++ >= maxWaitSessions) return null;
    if (chart.h[i] > pivot) return { i, ts: chart.t[i] };
  }
  return null;
}

/* ---------- SL — scan.mjs ka wahi rule, chart se dobara ----------
   scan.mjs (line ~684): swingLow = pichhle 8 din ka sabse neecha low,
   sl = max(swingLow, pivot*0.955), aur agar pivot se 2% se kam door ho to pivot*0.965.
   Yahan dobara isliye nikaalte hain ki purane record me SL field thi hi nahi —
   112 me se sirf 5 pe asli SL tha. Derive karke sab pe line dikh jaati hai.
   ⚠️ Ye ANUMAAN hai: scanner ne SL us din ke pichhle 8 bars pe nikala tha jab wo
   candidate bana, aur hum breakout wale din ke pichhle 8 bars le rahe hain. Aksar
   wahi aata hai, par hamesha nahi — isliye UI me ise alag label milta hai. */
export function deriveSL(chart, i0, pivot) {
  if (!chart || !chart.l || i0 == null || !(pivot > 0)) return null;
  const from = Math.max(0, i0 - 8);
  const lows = chart.l.slice(from, i0).filter(v => v > 0);
  if (!lows.length) return null;
  let sl = Math.max(Math.min(...lows), pivot * 0.955);
  if ((pivot - sl) / pivot < 0.02) sl = pivot * 0.965;
  return round2(sl);
}

/* ---------- breakout ke baad ki poori kahani ---------- */
export function buildTimeline(chart, pivot, boTs, opts = {}) {
  /* opts.deliv = { 'YYYY-MM-DD': pct } — us stock ka roz ka delivery %.
     ⚠️ Ye BAHAR se aata hai, chart se nahi. Wajah: timeline har scan pe dobara
     banti hai aur chart me sirf AAJ ka delivery hota hai. Pehle yahi galti thi —
     1022 din me se sirf 32 pe delivery aa rahi thi aur wo kabhi badhne wali bhi
     nahi thi, kyunki purane din har baar naye sire se bante the. Ab scan.mjs
     journal me chhota sa delivLog rakhta hai aur wahi yahan aata hai. */
  if (!chart || !chart.t || !chart.t.length || !(pivot > 0) || !boTs) return null;
  const i0 = chart.t.indexOf(boTs);
  if (i0 < 0) return null;

  const cap = opts.maxSessions ?? BO.MAX_SESSIONS;
  const tractionPct = opts.tractionPct ?? BO.TRACTION_PCT;

  // volume ka paimana breakout se PEHLE ka — fixed rakhna zaroori hai, warna
  // baad ke bade volume khud hi average utha dete hain aur volX chhota dikhta hai
  let volBase = null;
  {
    const from = Math.max(0, i0 - BO.VOL_BASE), arr = [];
    for (let k = from; k < i0; k++) if (chart.v[k] > 0) arr.push(chart.v[k]);
    if (arr.length) volBase = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  const boLow = chart.l[i0];
  const days = [];
  let maxGainPct = null, maxDrawPct = null, gotTraction = false;
  let endedBy = null, endIdx = null, tractionInSessions = null;

  for (let i = i0; i < chart.t.length && (i - i0) < cap; i++) {
    const c = chart.c[i];
    const pct = round2((c - pivot) / pivot * 100);
    const hiPct = round2((chart.h[i] - pivot) / pivot * 100);
    days.push({
      d: istDay(chart.t[i]),
      n: i - i0,                                        // breakout ke baad ka session number
      c: round2(c),
      pct,
      volX: volBase ? round2(chart.v[i] / volBase) : null,
      dlv: (opts.deliv && opts.deliv[istDay(chart.t[i])] != null)
        ? opts.deliv[istDay(chart.t[i])]
        : (chart.deliv != null && i === chart.t.length - 1 ? chart.deliv : null),
      lowBreak: i > i0 && c < boLow
    });

    if (hiPct != null && (maxGainPct == null || hiPct > maxGainPct)) maxGainPct = hiPct;
    if (pct != null && (maxDrawPct == null || pct < maxDrawPct)) maxDrawPct = pct;
    if (!gotTraction && maxGainPct != null && maxGainPct >= tractionPct) {
      gotTraction = true; tractionInSessions = i - i0;
    }
    // ★ creator ka rule: breakout-day low ke neeche band = kahani khatam
    if (i > i0 && c < boLow) { endedBy = 'fail'; endIdx = i; break; }
  }

  if (endedBy == null && days.length >= cap) { endedBy = 'cap'; endIdx = i0 + days.length - 1; }

  // nateeja: traction mila to wahi asli baat hai, chahe baad me fail bhi hua ho
  const live = endedBy == null;
  /* CHAAR nateeje, teen nahi. Pehle sirf fail tha aur asli data ne dikhaya ki 40
     session me lagbhag har non-runner kabhi na kabhi BO-day low tod hi deta hai —
     to 'flat' bucket khali reh jaata tha aur fail bucket sab kuch nigal leta tha.
     Creator ka apna SQUAT concept isi ke liye hai: institution ko jitna maal chahiye
     tha nahi mila, to breakout wale din hi poora maal retail ke sar pe daal deta hai.
     Turant marna aur dheere-dheere fade hona do alag kahaniyan hain. */
  const failedFast = endedBy === 'fail' && endIdx != null && (endIdx - i0) <= BO.SQUAT_SESSIONS;
  const outcome = live ? 'chal raha'
    : gotTraction ? 'traction'
    : endedBy === 'fail' ? (failedFast ? 'squat' : 'fail')
    : 'flat';

  const last = days[days.length - 1];
  return {
    boDate: istDay(boTs), boTs, pivot: round2(pivot), boLow: round2(boLow),
    slDerived: deriveSL(chart, i0, pivot),
    sessions: days.length,
    maxGainPct, maxDrawPct, gotTraction, tractionInSessions,
    endedBy, live, outcome, failedFast,
    nowPct: last ? last.pct : null,
    day1VolX: days[0] ? days[0].volX : null,
    days
  };
}

/* ---------- bahut se breakouts ek saath ----------
   entries: [{symbol, sector, pivot, boTs, source, fund}]
   charts:  Map(symbol -> {t,o,h,l,c,v,deliv?})  ya  {sym: chart} object     */
export function buildAll(entries, charts, opts = {}) {
  const get = s => (charts instanceof Map) ? charts.get(s) : charts[s];
  const out = [];
  for (const e of entries || []) {
    const ch = get(e.symbol);
    if (!ch) continue;
    const t = buildTimeline(ch, e.pivot, e.boTs, { ...opts, deliv: (opts.deliv || {})[e.symbol] });
    if (!t) continue;
    const sl = (e.sl > 0) ? { sl: e.sl, slIsDerived: false } : { sl: t.slDerived, slIsDerived: true };
    out.push({ symbol: e.symbol, sector: e.sector || null, source: e.source || null, ...sl, fund: e.fund || null, ...t, slDerived: undefined });
  }
  // naye breakout sabse upar
  out.sort((a, b) => b.boTs - a.boTs);
  return out;
}

/* ---------- report card ---------- */
export function summarize(list) {
  const done = list.filter(x => !x.live);
  if (!list.length) return null;
  const cnt = { traction: 0, squat: 0, fail: 0, flat: 0 };
  for (const x of done) cnt[x.outcome] = (cnt[x.outcome] || 0) + 1;
  const gains = done.map(x => x.maxGainPct).filter(v => v != null).sort((a, b) => a - b);
  const med = gains.length
    ? (gains.length % 2 ? gains[(gains.length - 1) / 2]
      : round2((gains[gains.length / 2 - 1] + gains[gains.length / 2]) / 2))
    : null;
  const tSess = done.filter(x => x.tractionInSessions != null).map(x => x.tractionInSessions);

  /* ★ Numbers Check ka ASLI imtihaan — cross-rate ki jagah TRACTION-rate.
     Yahi wo upgrade hai jiske liye ye poora panel bana: pehle jawab binary tha
     (cross hua ya nahi), ab graded hai (chala ya nahi). */
  const byLeg = (() => {
    const mk = () => ({ done: 0, traction: 0 });
    const g = { yes: mk(), no: mk() }, r = { yes: mk(), no: mk() };
    for (const x of done) {
      const f = x.fund; if (!f) continue;
      if (f.growth != null) { const b = f.growth ? g.yes : g.no; b.done++; if (x.outcome === 'traction') b.traction++; }
      if (f.reaction != null) { const b = f.reaction ? r.yes : r.no; b.done++; if (x.outcome === 'traction') b.traction++; }
    }
    const rate = b => b.done ? Math.round(b.traction / b.done * 100) : null;
    const any = g.yes.done + g.no.done + r.yes.done + r.no.done;
    return any ? {
      growth: { yes: { ...g.yes, rate: rate(g.yes) }, no: { ...g.no, rate: rate(g.no) } },
      reaction: { yes: { ...r.yes, rate: rate(r.yes) }, no: { ...r.no, rate: rate(r.no) } }
    } : null;
  })();

  return {
    total: list.length, live: list.length - done.length, settled: done.length,
    traction: cnt.traction || 0, squat: cnt.squat || 0, fail: cnt.fail || 0, flat: cnt.flat || 0,
    tractionRate: done.length ? Math.round((cnt.traction || 0) / done.length * 100) : null,
    medianMaxGain: med,
    avgSessionsToTraction: tSess.length ? round2(tSess.reduce((a, b) => a + b, 0) / tSess.length) : null,
    byLeg,
    bars: { tractionPct: BO.TRACTION_PCT, maxSessions: BO.MAX_SESSIONS, failOn: BO.FAIL_ON }
  };
}
