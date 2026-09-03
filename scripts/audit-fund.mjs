/* Numbers Check ka audit — data.js pe shaq ke saath.
   Chalao: node scripts/audit-fund.mjs
   Har scan.mjs ya fundamentals.mjs badalne ke BAAD ise chalana.
   Ye 8 cheezein dekhta hai: YoY base ka fasla, quarter gaps, ghaate ka base,
   reaction ka din, basis mixing, legs vs matchCount, delivery range, sector ginti. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'))(w);
const d = w.DASHBOARD_DATA;
const F = d.fund.bySymbol;
const problems = [];

const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const pd = s => { const m=/(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})/.exec(s||''); return m? Date.UTC(+m[3],MON[m[2].toLowerCase()],+m[1]) : null; };

console.log('=== A. YoY ka base sach me ek saal peeche hai? ===');
for (const [sym, f] of Object.entries(F)) {
  if (!f.growth || f.growth.tag !== 'YoY') continue;
  const ser = f.series;                       // purana -> naya
  if (ser.length < 5) { problems.push(sym + ': YoY bola par series me sirf ' + ser.length + ' quarter'); continue; }
  const cur = pd(ser[ser.length-1].q), base = pd(ser[0].q);
  const days = (cur - base) / 86400000;
  const ok = days > 300 && days < 430;
  console.log('  ' + sym.padEnd(12) + ser[0].q + ' -> ' + ser[ser.length-1].q + '  = ' + Math.round(days) + ' din  ' + (ok?'OK':'⚠️ GALAT'));
  if (!ok) problems.push(sym + ': YoY base ' + Math.round(days) + ' din peeche hai, 365 nahi');
}

console.log('\n=== B. quarter ke beech gap (missing quarter) ===');
for (const [sym, f] of Object.entries(F)) {
  const ser = f.series; if (!ser || ser.length < 2) continue;
  for (let i = 1; i < ser.length; i++) {
    const g = (pd(ser[i].q) - pd(ser[i-1].q)) / 86400000;
    if (g < 60 || g > 120) { console.log('  ⚠️ ' + sym + ': ' + ser[i-1].q + ' -> ' + ser[i].q + ' = ' + Math.round(g) + ' din');
      problems.push(sym + ': quarter gap ' + Math.round(g) + ' din'); }
  }
}
console.log('  (kuch na chhape to saare gap normal hain)');

console.log('\n=== C. growth ka BASE negative to nahi? (loss se profit = "30% growth" nahi hota) ===');
for (const [sym, f] of Object.entries(F)) {
  const g = f.growth, ser = f.series; if (!g || !ser) continue;
  const base = g.tag === 'YoY' ? ser[0] : ser[ser.length-2];
  if (!base) continue;
  const bp = g.src === 'PAT' ? base.pat : base.eps;
  if (bp != null && bp <= 0 && g.state !== 'turnaround' && g.state !== 'loss') {
    console.log('  ⚠️ ' + sym + ': base ' + g.src + ' = ' + bp + ' (ghaata) par growth ' + Math.round(g.profit) + '% dikha raha hai, ok=' + g.ok);
    problems.push(sym + ': ghaate ke base pe % growth — bemaani');
  }
}
console.log('  (kuch na chhape to saare base positive the)');

console.log('\n=== D. reaction wala din sach me result ke baad ka pehla session hai? ===');
for (const [sym, f] of Object.entries(F)) {
  const r = f.reaction; if (!r) continue;
  const bc = /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})/.exec(f.resultOn || '');
  if (!bc) continue;
  const bcDay = bc[3] + '-' + String(MON[bc[2].toLowerCase()]+1).padStart(2,'0') + '-' + bc[1].padStart(2,'0');
  const hh = +bc[4], mm = +bc[5];
  const late = hh > 15 || (hh === 15 && mm >= 30);
  const same = r.day === bcDay;
  const flag = late && same ? '⚠️ market band hone ke BAAD aaya par USI din ka reaction liya'
             : (!late && !same ? '⚠️ market ke DAURAAN aaya par AGLE din ka reaction liya' : 'OK');
  if (flag !== 'OK') problems.push(sym + ': reaction din galat (' + f.resultOn + ' -> ' + r.day + ')');
  console.log('  ' + sym.padEnd(12) + f.resultOn.padEnd(22) + '-> ' + r.day + '  ' + (late?'[after-hours]':'[market hours]') + '  ' + flag);
}

console.log('\n=== E. reporting basis mix to nahi ho gaya? ===');
console.log('  (basis field ek hi hona chahiye — Consolidated aur Non-Consolidated ki tulna galat hai)');
for (const [sym, f] of Object.entries(F)) console.log('  ' + sym.padEnd(12) + (f.basis || '?'));

console.log('\n=== F. legs aur matchCount aapas me mel khaate hain? ===');
for (const [sym, f] of Object.entries(F)) {
  const n = (f.legs.growth?1:0)+(f.legs.reaction?1:0)+(f.legs.setup?1:0);
  if (n !== f.matchCount) { console.log('  ⚠️ ' + sym + ': legs se ' + n + ' par matchCount ' + f.matchCount); problems.push(sym + ': matchCount galat'); }
  const expect = n===3?'triple':n===2?'two':n===1?'one':'none';
  if (f.match !== expect) { console.log('  ⚠️ ' + sym + ': match "' + f.match + '" hona chahiye "' + expect + '"'); problems.push(sym + ': match label galat'); }
}
console.log('  (kuch na chhape to sab mel me hai)');

console.log('\n=== G. delivery % vaajib range me? ===');
for (const [sym, f] of Object.entries(F)) {
  const dv = f.reaction && f.reaction.delivPct;
  if (dv == null) { console.log('  ' + sym.padEnd(12) + 'delivery nahi mili'); continue; }
  if (dv < 0 || dv > 100) { console.log('  ⚠️ ' + sym + ': delivery ' + dv + '%'); problems.push(sym + ': delivery range se bahar'); }
}
console.log('  (kuch na chhape to sab 0-100 me)');

console.log('\n=== H. sector rollup ka hisaab ===');
for (const [name, sn] of Object.entries(d.fund.bySector || {})) {
  const strong = sn.rows.filter(r => r.ok).length;
  const pos = sn.rows.filter(r => (r.pct != null && r.pct > 0) || r.state === 'turnaround').length;
  console.log('  ' + name + ': rows=' + sn.rows.length + ' checked=' + sn.checked + ' strong=' + sn.strong + '(' + strong + ') positive=' + sn.positive + '(' + pos + ') median=' + sn.median);
  const wp = sn.rows.filter(r=>r.pct!=null).length;
  if (strong !== sn.strong || pos !== sn.positive || sn.rows.length !== sn.checked || (wp < 2 && sn.median != null)) problems.push(name + ': sector rollup ginti galat');
}

console.log('\n\n================ NATEEJA ================');
if (!problems.length) console.log('koi problem nahi mili.');
else { console.log(problems.length + ' problem:'); problems.forEach(p => console.log('  • ' + p)); }
