// ============================================================
// Yahoo industry cache builder
// Kyun: NSE ki index CSVs sirf ~750 stocks ko sector tag deti hain. Baaki ~1330
// 'Other' reh jaate the — aur 'Other' hot-sector calc me SKIP hota hai, matlab
// scanner ke aadhe se zyada stocks ko sector-bonus kabhi milta hi nahi tha.
// Yahoo ka assetProfile har listed stock ka industry deta hai (crumb chahiye).
// Ye script sirf MISSING symbols laati hai aur industry-cache.json me jodti hai —
// isliye 10-din wale universe rebuild pe dobara 1300 requests nahi jaati.
// Chalao: node scripts/fetch-industries.mjs [--all] [--refresh]
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'industry-cache.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Yahoo ab crumb maangta hai: pehle cookie lo (fc.yahoo.com), phir getcrumb.
async function getCrumb() {
  let cookie = '';
  for (const url of ['https://fc.yahoo.com', 'https://finance.yahoo.com/quote/RELIANCE.NS']) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
      if (cookie) break;
    } catch { }
  }
  if (!cookie) return null;
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, 'Cookie': cookie } });
    const crumb = (await r.text()).trim();
    if (!crumb || crumb.length > 30 || crumb.includes('<')) return null;
    return { cookie, crumb };
  } catch { return null; }
}

async function profile(sym, auth) {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetch(
        `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=assetProfile&crumb=${encodeURIComponent(auth.crumb)}`,
        { headers: { 'User-Agent': UA, 'Cookie': auth.cookie } });
      if (res.status === 429) { await sleep(2500); continue; }
      if (!res.ok) continue;
      const p = (await res.json())?.quoteSummary?.result?.[0]?.assetProfile;
      if (!p) continue;
      return { sector: p.sector || null, industry: p.industry || null };
    } catch { }
  }
  return null;
}

async function main() {
  const ALL = process.argv.includes('--all');
  const REFRESH = process.argv.includes('--refresh');

  const uni = JSON.parse(readFileSync(join(ROOT, 'universe.json'), 'utf8')).stocks;
  let cache = {};
  if (existsSync(CACHE) && !REFRESH) { try { cache = JSON.parse(readFileSync(CACHE, 'utf8')).map || {}; } catch { } }

  // Sirf jinka NSE sector nahi hai (ya --all) aur cache me nahi hain
  const todo = uni
    .filter(u => ALL || u.sec === 'Other')
    .filter(u => !(u.s in cache))
    .map(u => u.s);

  console.log(`Cache me ${Object.keys(cache).length} | fetch karne hain ${todo.length}`);
  if (!todo.length) { console.log('Kuch naya nahi — cache fresh hai.'); return; }

  const auth = await getCrumb();
  if (!auth) { console.error('Yahoo crumb nahi mila — abort (purana cache safe hai).'); process.exit(1); }
  console.log('Crumb mil gaya, fetch shuru...');

  let i = 0, got = 0, miss = 0;
  async function worker() {
    while (i < todo.length) {
      const sym = todo[i++];
      const p = await profile(sym, auth);
      // null bhi cache karo (delisted/no-profile) — warna har baar retry hota rahega
      cache[sym] = p && p.industry ? p : null;
      if (cache[sym]) got++; else miss++;
      if ((got + miss) % 100 === 0) console.log(`  ${got + miss}/${todo.length} (mile ${got})`);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));

  writeFileSync(CACHE, JSON.stringify({
    note: 'Yahoo assetProfile industry cache — build-universe.mjs isse Other stocks ka sector bharta hai. Refresh: node scripts/fetch-industries.mjs --refresh',
    builtAt: new Date().toISOString(),
    map: cache
  }, null, 0));

  const hist = {};
  for (const v of Object.values(cache)) if (v?.industry) hist[v.industry] = (hist[v.industry] || 0) + 1;
  console.log(`\nDone: ${got} mile, ${miss} nahi. Cache total ${Object.keys(cache).length}`);
  console.log(`Alag-alag industries: ${Object.keys(hist).length}`);
  console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
