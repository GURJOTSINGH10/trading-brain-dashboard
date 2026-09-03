/* Test gate harness — koi bhi naya scoring signal isse hi paas karega.
   Chalao:  node scripts/test-gate.mjs "" "--sector-pack" "--hot-bonus 6"
   Pehla argument hamesha "" (baseline) rakho — baaki uske against tulte hain.

   Test gate harness — rules.json ka apna niyam:
   "Koi bhi naya scoring signal 'shipped' tabhi banta hai jab wo CHAARO me positive ho"
   windows : H1 (2021-2024), H2 (2024-2026)
   capitals: Rs 1,00,000 aur Rs 6,00,000
   Sizing live ke barabar (flat 24) — warna hum us system ka test nahi kar rahe jo chal raha hai. */
import { execFileSync } from 'node:child_process';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL = ['2021-07-16', '2026-03-30'];
const H1 = ['2021-07-16', '2024-01-01'];
const H2 = ['2024-01-01', '2026-03-30'];

const variants = process.argv.slice(2);
if (!variants.length) { console.error('usage: node gate.mjs "" "--sector-pack" ...'); process.exit(1); }

function run(extra, capital, from, to) {
  const args = ['scripts/backtest.mjs', '--capital', String(capital), '--sizes', '24,24,24,24,24',
    '--from', from, '--to', to, ...extra];
  const out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 });
  const g = /Equity \(gross\)\s*:.*\(([-+][\d.]+)%\)/.exec(out);
  const dd = /Max drawdown\s*:\s*([-\d.]+)%/.exec(out);
  const pf = /Profit factor\s*:\s*([\d.]+)/.exec(out);
  const tr = /Trades[^\d]*(\d+)/.exec(out);
  return {
    ret: g ? parseFloat(g[1]) : null,
    dd: dd ? parseFloat(dd[1]) : null,
    pf: pf ? parseFloat(pf[1]) : null,
    trades: tr ? parseInt(tr[1], 10) : null
  };
}

const rows = [];
for (const v of variants) {
  const extra = v ? v.split(' ').filter(Boolean) : [];
  const label = v || 'BASELINE';
  const r = {
    label,
    '6L FULL': run(extra, 600000, ...FULL),
    '6L H1': run(extra, 600000, ...H1),
    '6L H2': run(extra, 600000, ...H2),
    '1L FULL': run(extra, 100000, ...FULL),
    '1L H1': run(extra, 100000, ...H1),
    '1L H2': run(extra, 100000, ...H2)
  };
  rows.push(r);
  console.log('done:', label);
}

const cols = ['6L FULL', '6L H1', '6L H2', '1L FULL', '1L H1', '1L H2'];
console.log('\n================ RETURN % (gross) ================');
console.log('variant'.padEnd(34) + cols.map(c => c.padStart(10)).join(''));
for (const r of rows) console.log(r.label.slice(0, 33).padEnd(34) + cols.map(c => (r[c].ret == null ? '?' : (r[c].ret >= 0 ? '+' : '') + r[c].ret.toFixed(1)).padStart(10)).join(''));

console.log('\n================ BASELINE SE FARAK (points) ================');
const base = rows[0];
for (const r of rows.slice(1)) {
  const d = cols.map(c => (r[c].ret != null && base[c].ret != null) ? +(r[c].ret - base[c].ret).toFixed(2) : null);
  console.log(r.label.slice(0, 33).padEnd(34) + d.map(x => (x == null ? '?' : (x >= 0 ? '+' : '') + x.toFixed(1)).padStart(10)).join(''));
  const gate = ['6L H1', '6L H2', '1L H1', '1L H2'].map(c => r[c].ret - base[c].ret);
  const pass = gate.filter(x => x > 0).length;
  console.log('   → GATE (H1/H2 x 1L/6L): ' + pass + '/4 positive' + (pass === 4 ? '  ✅ PAAS' : '  ❌ FAIL'));
  console.log('   → shor-star: 30 point se kam farak ko nateeja mat maano');
}

console.log('\n================ DRAWDOWN % ================');
console.log('variant'.padEnd(34) + cols.map(c => c.padStart(10)).join(''));
for (const r of rows) console.log(r.label.slice(0, 33).padEnd(34) + cols.map(c => String(r[c].dd ?? '?').padStart(10)).join(''));
