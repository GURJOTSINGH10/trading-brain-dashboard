// ============================================================
// TICKER RESOLUTION / HISTORY STITCHING
//
// SAMASYA (30 Aug 2026 ko pakdi gayi):
// NSE ne Apr aur Aug 2026 me BSE ki companies ka BULK admission kiya —
// Apr me 91, Aug me 158 "nayi listings". Ye IPO nahi hain; ye purani companies
// hain jinka NSE ticker naya hai. Yahoo pe `SYMBOL.NS` sirf NSE listing se
// shuru hoti hai (92-98 bars), jabki `SYMBOL.BO` ke paas poori history hai (500+).
//
// Nateeja: scan.mjs ka `MIN_BARS = 100` gate inhe CHUP-CHAAP reject kar deta tha.
// Sample 40 me se 32 (80%) aisi hi nikli. Poore universe me ~272 stocks 150 din
// se kam NSE history wale hain — yaani ~215 sthapit stocks scanner ko INVISIBLE the.
//
// Aur sirf gate hi nahi — 52W high `h.slice(-252)` se nikalta hai. 92 bars wale
// stock me wo 92 din ka high ban jaata hai, to stock jhoothe "52W high zone" me
// dikhne lagta hai aur +3 bonus le leta hai. Ye chup-chaap galat scoring thi.
//
// ILAAJ: NS chhoti ho to BO se PURANA hissa aage jod do (price NSE ke paimane pe
// scale karke). Recent bars hamesha NS ke hi rehte hain — isliye liquidity,
// volume-shrink aur base sab asli NSE data pe hi nikalte hain. BO sirf wahan
// bharta hai jahan NSE ka wajood hi nahi tha (52W high, lambi DMA, 60-din count).
//
// IDENTITY CHECK — ye sabse zaroori hissa hai:
// `GOODYEAR.BO` sach me wahi company hai ya koi aur? 24 naamon pe naapa:
// median NS/BO close ratio HAR EK me 0.9927–1.0034 nikla. To level-match ek
// bharosemand pehchan hai. Bina is jaanch ke kabhi stitch mat karna — galat
// company ki history jod dena poore backtest ko jhootha kar dega.
//
// ⚠️ Return-correlation pe gate MAT lagana: illiquid naamon me NSE ke closes
// stale/carry-forward hote hain, to corr 0.03 tak gir jaati hai — jabki company
// wahi hai. Liquidity ka faisla ₹5Cr floor aur bhavcopy turnover prefilter
// pehle se karte hain; correlation us kaam ke liye galat auzaar hai.
// ============================================================

// NS itni bari ho to BO ki zaroorat hi nahi (52W high + DMA sab andar aa jaate hain)
export const NS_SOLO_BARS = 260;

const istDay = ts => Math.floor((ts + 19800) / 86400);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** NS series itni chhoti hai ki BSE se bharna chahiye? */
export function needsBseBackfill(ns) {
  return !ns || !ns.c || ns.c.length < NS_SOLO_BARS;
}

/**
 * NS aur BO ko jodo. Hamesha NSE ke price-paimane me lautata hai.
 *
 * @param ns      NSE bars ({t,o,h,l,c,v}) ya null
 * @param bo      BSE bars ya null
 * @param refClose  (optional) aaj ka OFFICIAL NSE close (bhavcopy se). Jab NS bars
 *                  itni kam hon ki overlap se pehchan na ho paaye, tab identity
 *                  isi se verify hoti hai — bina koi extra request kiye.
 * @returns {bars, src, boBars, ratio, reason}
 */
export function stitchHistory(ns, bo, refClose = null) {
  const nsLen = ns?.c?.length || 0;
  if (!bo?.c?.length) return { bars: ns, src: 'NS', boBars: 0, ratio: 1, reason: 'BO nahi mili' };
  if (nsLen && bo.c.length <= nsLen + 20)
    return { bars: ns, src: 'NS', boBars: 0, ratio: 1, reason: 'BO se kuch extra nahi mil raha' };

  // ---- overlap nikalo ----
  const boIdx = new Map();
  for (let i = 0; i < bo.t.length; i++) boIdx.set(istDay(bo.t[i]), i);
  const pairs = [];
  for (let i = 0; i < nsLen; i++) {
    const j = boIdx.get(istDay(ns.t[i]));
    if (j != null && bo.c[j] > 0) pairs.push([ns.c[i], bo.c[j], ns.v[i], bo.v[j]]);
  }

  // ---- IDENTITY + scale ----
  let ratio;
  if (pairs.length >= 5) {
    ratio = median(pairs.map(p => p[0] / p[1]));
    // Ek hi company do exchange pe 5% se zyada alag nahi ho sakti (naapa: 0.7% max).
    if (!(ratio > 0.95 && ratio < 1.05))
      return { bars: ns, src: 'NS', boBars: 0, ratio, reason: `identity fail — ratio ${ratio.toFixed(3)}` };
    // Drift check: doosri company waqt ke saath alag chalegi, chahe ek din match kar jaye.
    const half = Math.floor(pairs.length / 2);
    const r1 = median(pairs.slice(0, half).map(p => p[0] / p[1]));
    const r2 = median(pairs.slice(half).map(p => p[0] / p[1]));
    if (Math.abs(r1 - r2) > 0.05)
      return { bars: ns, src: 'NS', boBars: 0, ratio, reason: `drift — ${r1.toFixed(3)} vs ${r2.toFixed(3)}` };
  } else if (refClose > 0) {
    // Overlap se pehchan nahi ho paayi — aaj ke official NSE close se karo.
    ratio = refClose / bo.c[bo.c.length - 1];
    if (!(ratio > 0.95 && ratio < 1.05))
      return { bars: ns, src: 'NS', boBars: 0, ratio, reason: `identity fail (bhav) — ratio ${ratio.toFixed(3)}` };
  } else {
    // Kuch bhi verify nahi kar sakte — to jodo mat. Andhere me stitch karna
    // galat company ki history chipka dene se behtar nahi hai.
    return { bars: ns, src: 'NS', boBars: 0, ratio: 1, reason: 'identity verify nahi ho payi' };
  }

  // ---- volume ka paimana ----
  // Purane (BO) hisse ka volume BSE ka hai. Use NSE ke paimane pe laane ke liye
  // overlap ka median ratio. Overlap na ho to 1 — wo hissa waise bhi sirf
  // 52W-high / DMA / 60-din-count me use hota hai, liquidity me nahi (wo hamesha
  // aakhri 20 bars se nikalti hai, jo NS ke hi hote hain).
  const volPairs = pairs.filter(p => p[3] > 0 && p[2] > 0);
  const volRatio = volPairs.length >= 5 ? median(volPairs.map(p => p[2] / p[3])) : 1;

  // ---- jodo: BO ka wo hissa jo NS shuru hone se PEHLE ka hai ----
  const cutDay = nsLen ? istDay(ns.t[0]) : Infinity;
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  let added = 0;
  for (let i = 0; i < bo.t.length; i++) {
    if (istDay(bo.t[i]) >= cutDay) break;
    out.t.push(bo.t[i]);
    out.o.push(bo.o[i] * ratio); out.h.push(bo.h[i] * ratio);
    out.l.push(bo.l[i] * ratio); out.c.push(bo.c[i] * ratio);
    out.v.push(Math.round(bo.v[i] * volRatio));
    added++;
  }
  if (!added) return { bars: ns, src: 'NS', boBars: 0, ratio, reason: 'BO me purana hissa nahi' };

  // ★★ SEAM CONTINUITY GUARD (30 Aug 2026 — ye check pehle NAHI tha, aur uske
  // bina stitch ne JHOOTHE moves bana diye the: BATLIBOI -80.3%, RAJPALAYAM
  // -58.9%, SAYAJIHOTL -50.9% jodne wali jagah pe.)
  //
  // Overlap ka ratio ~1.000 aa sakta hai (dono series AAJ ek jaisi hain) aur
  // phir bhi PURANA BSE data alag paimane pa ho sakta hai — kyunki us series me
  // koi split/bonus adjust nahi hua. Ek recent ratio se poora itihaas theek
  // nahi hota.
  //
  // Ilaaj: jodne wali jagah pe do bars ka farak dekho. Asli continuous series
  // me wahan ek normal din jitna hi move hona chahiye. Bada jump = purane hisse
  // me unadjusted corporate action = ye history bharosemand NAHI hai.
  // Aise me jodo MAT — adhuri history galat history se behtar hai.
  if (nsLen) {
    const lastOld = out.c[added - 1], firstNew = ns.c[0];
    const seam = Math.abs(firstNew / lastOld - 1);
    if (seam > 0.10) {
      return {
        bars: ns, src: 'NS', boBars: 0, ratio,
        reason: `seam jump ${(seam * 100).toFixed(1)}% — purane BSE data me corporate action adjust nahi hua`
      };
    }
  }

  for (let i = 0; i < nsLen; i++) {
    out.t.push(ns.t[i]); out.o.push(ns.o[i]); out.h.push(ns.h[i]);
    out.l.push(ns.l[i]); out.c.push(ns.c[i]); out.v.push(ns.v[i]);
  }
  // NS ke baaki fields (jaise deliv) na khoyein
  if (ns && ns.deliv != null) out.deliv = ns.deliv;

  return {
    bars: out,
    src: nsLen ? 'NS+BO' : 'BO',
    boBars: added,
    ratio,
    reason: `${added} purane bars BSE se (ratio ${ratio.toFixed(4)}, vol ×${volRatio.toFixed(2)})`
  };
}
