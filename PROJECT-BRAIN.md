# 🧠 TRADING BRAIN — START HERE (Master Handover)

> **Agar tum ye pehli baar padh rahe ho (Claude bina memory ke, ya koi bhi):**
> Ye file poore project ka dimaag hai. Ise poora padho — iske baad tumhe sab pata hoga.
> Owner: Gurjot (GitHub: GURJOTSINGH10, email: kgurjeet53@gmail.com). Baat **Hinglish** me karna, "bhai" bolta hai.

---

## 1. YE PROJECT KYA HAI

User ne "The Wealth Magnet" (Hindi YouTube trading channel) ko follow karke asli paisa banaya tha.
Channel ne videos delete kar diye aur inactive ho gaya — isliye uske 225 videos ke transcripts se
uska **poora trading system clone** kiya gaya (July 2026):

1. **Rulebook** — uska dimaag likha hua (`TRADING_BRAIN.md`)
2. **/trade skill** — usse baat karne ke liye (Claude Code + claude.ai dono pe)
3. **Automated scanner + live dashboard** — roz NSE scan karke agle din ke picks, uske hi rules se
4. **₹1 lakh paper portfolio** — har pick ka imaandaar hisaab (backtest + live tracking)

**Strategy ek line me**: Livermore/Darvas lineage ka swing/momentum — market environment pehle (gear system),
hot sector, tight consolidation ke breakout pe hi entry (pivot cross + volume), SL 3-4% no exceptions,
10 DMA trail, partial booking. Win rate 35-45% expected — paisa expectancy se banta hai.
Kharab market me picks NAHI aate ("cash bhi position hai").

---

## 2. LIVE LINKS

| Kya | Kahan |
|---|---|
| **Dashboard (roz ka output)** | https://gurjotsingh10.github.io/trading-brain-dashboard/ |
| GitHub repo | https://github.com/GURJOTSINGH10/trading-brain-dashboard |
| Cloud automation (Actions) | repo → Actions → "Daily Scan (7 PM IST)" |
| Manual scan button | Dashboard pe "☁️ Naya Scan" (GitHub login chahiye → Run workflow) |

---

## 3. FOLDER MAP (kya kahan hai)

```
C:\Users\gk379\Projects\trading-brain\
├── START-HERE.md            ← YE FILE (master handover)
├── TRADING_BRAIN.md          ← RULEBOOK — creator ke saare rules (sabse important gyaan)
├── CONCEPTS_GUIDE.md         ← concepts ka "kyun" (teaching — user beginner hai)
├── SCANNERS.md               ← Chartink scan queries (manual scan ka purana tarika)
├── TRADING_BRAIN_CHAT_LOG.txt← project banne ki poori kahani (4-9 Jul 2026)
├── PROGRESS.md, CLAUDE.md, CHATGPT_SETUP.md, README.md — chhoti support files
├── run-scan.bat              ← LOCAL automation runner — MAT HATANA/MOVE KARNA
├── run-scan-hidden.vbs       ← Task Scheduler isse chalata hai (bat ko hidden window me run karta hai) — MAT HATANA
├── scan.log                  ← local runs ka log (debugging ke liye pehle yahan dekho)
├── trade-skill-v2.zip        ← claude.ai wali skill ka package (re-upload ke liye)
├── workflow-backup\scan.yml  ← cloud workflow ki local copy (repo wala asli hai)
├── source\                   ← 225 videos ke raw transcripts + chart screenshots
├── extractions\              ← transcripts se nikale rules (batch-01..06)
└── dashboard\                ← GIT REPO (GitHub se synced) — asli engine yahan hai
    ├── index.html            ← dashboard UI (liquid glass + market mood)
    ├── data.js               ← AUTO-GENERATED har scan pe (haath mat lagana)
    ├── journal.json          ← CHALU portfolio (FY 26-27, ₹6L) — startCapital + sizeByGear + closed + positions
    ├── strategy-test.json    ← 5-saal ka strategy proof (₹1L, Mar 2026 tak) — summary + curve
    ├── universe.json         ← POORI NSE EQ list ~2075 + cap + sector tags (AUTO-refresh har 10 din)
    ├── industry-cache.json   ← Yahoo se laaya har stock ka industry (sector fill ke liye) — commit hota hai
    ├── index-flat-backup.html, index-old-backup.html ← purane UI designs
    ├── .cache\               ← gitignored: backtest ka 2-saal chart cache + report
    ├── .github\workflows\scan.yml ← CLOUD automation (4 crons)
    └── scripts\
        ├── scan.mjs          ← MAIN ENGINE (data fetch → gear → picks → journal → data.js)
        ├── build-universe.mjs← NSE lists + industry cache se universe banata hai
        ├── sector-map.mjs    ← sector vocabulary (alias + Yahoo industry → sector)
        ├── fetch-industries.mjs ← Yahoo assetProfile se industry cache bharta hai
        └── backtest.mjs      ← 12-mahine ka historical replay (live rules ke barabar)
```

**Is folder ke BAHAR wali cheezein:**
- `C:\Users\gk379\.claude\skills\trade\SKILL.md` — Claude Code ki /trade skill (voice contract ke saath)
- claude.ai pe: Project "The Wealth Magnet Clone" + account skill "trade" (zip se upload hui)
- Windows Task Scheduler: task **"TradingBrainDailyScan"** (12 triggers)
- Claude memory: `C:\Users\gk379\.claude\projects\C--Users-gk379--claude\memory\trading-brain-project.md`

---

## 4. SYSTEM KAISE KAAM KARTA HAI (architecture)

```
[NSE bhavcopy 4:30 PM official]──┐
[Yahoo Finance (sirf history)]───┼──> scan.mjs ──> data.js + journal.json ──> git push ──> GitHub Pages (dashboard)
[NSE indices close file]─────────┘        │
                                          └─ gear nikalta hai → picks → journal update
```

**scan.mjs ka flow (har run):**
1. Universe 10 din purana ho → khud rebuild (NSE lists se)
2. Universe ~2080 (poori NSE EQ list) → bhavcopy ke aaj ke turnover se prefilter (₹2Cr+) → ~1333 scan hote hain. Yahoo se unki + indices ki 1-saal history — **market-hours me aaj ka ADHURA candle DROP hota hai** (15:35 IST se pehle aaj ka bar use nahi hota — ye critical guard hai)
3. NSE **bhavcopy** (sec_bhavdata_full_DDMMYYYY.csv, ~4:30 PM publish) + indices (ind_close_all) → aaj ka OFFICIAL bar merge (delivery % bhi)
4. Session naya hai? Nahi → skip (idempotent). Haan →
5. **Market health → GEAR (1-5)**: smallcap 10/50 DMA, breadth, adv/dec, 52W highs, USDINR, aur **"Breakouts Working?"** (creator ka #1 signal — recent breakouts me traction% ; kam ho to gear hard-cap)
6. Hot sectors (5-din return + participation + volume). Sector tags universe.json me hain —
   **96% stocks tagged** (NSE index lists se ~750, baaki Yahoo industry cache se; 33 canonical
   sectors, `scripts/sector-map.mjs`). `Other` aur `Diversified` heat calc me SKIP hote hain —
   pehla matlab "pata nahi", doosra conglomerates ka jhola jisme koi common driver hota hi nahi.
6b. **Earnings guard**: NSE board-meetings API se agle 12 din ke result dates. Jis pick ka result 3 din me hai — score -8, flag, aur card pe warning (creator: "numbers pe leke chale gaye, loss ho gaya"). API cookie-gated hai — fail ho to chup-chaap skip.
7. Stock scan: liquid (₹5Cr+), rising 50 DMA ke upar, tight base (≤13%), pivot ke paas (≤4.5%), shaant (ATR check) = **READY** → picks gear se scale: gear2=3, gear3=5, gear4=6, gear5=8 (gear 1 = 0 picks). 0 picks ho to relaxed "watchlist" (nazar-me-rakho) deta hai
8. **Journal**: pending pick → pivot cross + 1.2x volume = trigger (entry) → phir SL hit / +8% book / 10DMA trail / 3-din squat fail — sab automatic. Gear-based sizing: gear1=10% ... gear5=25% of capital
9. data.js + journal.json likho → runner commit+push → Pages update

**UI (index.html)**: gear se poora page ka MOOD badalta hai — gear 1-2 laal, 3 amber, 4-5 hara
(liquid glass, animated blobs, pulsing pill). Tabs: Aaj ka Scan / Track Record (equity curve,
clickable filter chips, stock search, recent form).
**Scan tab ka "Paper Portfolio" card SIRF chalu FY (1 Apr – 31 Mar) ka return dikhata hai** —
pehle wo lifetime (5 saal ka backtest) dikha raha tha, to +423% padh ke lagta tha ki ye saal
ka return hai. Lifetime ab Track Record tab pe hai.
**Track Record pe time-range selector hai (1D/1W/1M/FY/1Y/5Y/All, default 1Y)** — chart, period ka
return, breakdown chips aur journal table CHAARO ek saath us period pe filter hote hain. Ye sirf
feature nahi, zaroorat hai: 5-saal ke journal me ~2950 rows hain, sab ek saath render karna phone
pe bhaari hai (default 1Y pe ~390 rows). Upar ke stat cards jaan-bujh ke LIFETIME rehte hain.
Search karte waqt range hat jaati hai (poori history me dhundo). Har stock: cap badge, TradingView link (avatar/button),
full breakdown (DMAs, 52W, delivery%, SL/target ₹ scenarios).

---

## 5. AUTOMATION (kab kya chalta hai)

**Cloud (GitHub Actions — PC band ho tab bhi):** `.github/workflows/scan.yml`
| UTC cron | IST | Kyun |
|---|---|---|
| 15 11 * * 1-5 | 4:45 PM | bhavcopy 4:30 pe aati hai — pehla mauka |
| 45 13 * * 1-5 | 7:15 PM | backup |
| 30 16 * * 1-5 | 10:00 PM | backup |
| 0 2 * * 2-6 | 7:30 AM | final guarantee (market 9:15 se pehle) |
⚠️ GitHub cron 1-3 ghante LATE chalta hai (unki free-tier aadat) — isliye 4 crons. Jo pehla naya session dekhe, wahi update karta hai.

**Local (Task Scheduler "TradingBrainDailyScan" — PC on ho to):** 5-11 PM har ghanta (Mon-Fri) + 8 AM (Tue-Sat) = 12 triggers, StartWhenAvailable on. Task `run-scan-hidden.vbs` chalata hai (16 Jul 2026 se — cmd window flash na ho isliye), jo `run-scan.bat` ko hidden run karta hai. Bat **pehle `git fetch + reset --hard origin/main`** karta hai (KABHI pull/rebase nahi — niche "bugs" dekho), phir scan, phir commit+push.

Dono idempotent — same session dobara process nahi hota. Expectation: **same evening update (usually 5-7 PM); worst case agli subah 8 baje.**

---

## 6. BUGS JO AA CHUKE HAIN (dobara mat hone dena)

1. **Yahoo partial-candle (SABSE BADA)**: market-hours me Yahoo aaj ka LIVE adhura candle deta hai → delayed runs ne adhure din pe journal chala diya tha. FIX scan.mjs me hai (15:35 IST guard). Kabhi hatana mat.
2. **Yahoo EOD lag**: shaam ko ghanton late final hota hai → isliye NSE bhavcopy primary source hai.
3. **`git pull --rebase --autostash` ne data.js/journal.json me CONFLICT MARKERS chhod ke commit kar diye** → dashboard toot gaya ("Data load nahi hua"). RULE: auto-generated files pe kabhi rebase/pull nahi — sirf `reset --hard origin/main` ya cloud me push-fail = graceful skip.
4. **Missed-trigger catch-up market hours me chala** (StartWhenAvailable) → partial data process (ab #1 guard se safe).
4b. **(5 Aug 2026) Session ADHURI bhavcopy pe aage badh gaya** — 3:40 PM pe missed 8AM trigger chala. Bhavcopy 4:30 PM pe aati hai, to usne KAL ki utha li, par Yahoo ke paas aaj ka bar tha → sessionTs = max(yahoo,bhav) ne session aage badha diya KAL ki delivery % ke saath, aur lastSession mark hote hi shaam ke saare runs skip ho gaye. **FIX**: (a) session sirf tab advance hota hai jab US DIN ki bhavcopy mile — fail-safe: 8 PM ke baad Yahoo pe bharosa; (b) delivery % sirf tab attach hoti hai jab bhavcopy usi session ki ho; (c) **stale-display refresh**: session processed ho par nayi bhavcopy aa jaye to display dobara banta hai (journal untouched), journal me `lastBhav` field track hoti hai taaki loop na bane. Ye (c) sabse zaroori hai — pehle ek adhura run raat bhar atka deta tha, ab system khud sudhaar leta hai.
5. **GitHub OAuth token me `workflow` scope NAHI hai** — scan.yml ko gh/git se push NAHI kar sakte. Edit karna ho to: github.com pe web editor (browser automation se content daal do, COMMIT BUTTON user se dabwana — CDP click us button pe renderer FREEZE karta hai is machine pe; 2-3 attempt me kabhi chal jata hai).
6. **Git-bash me `TZ=Asia/Kolkata date` UTC dikhata hai is PC pe** — IST chahiye to PowerShell `Get-Date` ya Node Intl use karo.
7. Journal kabhi corrupt ho jaye → git history me pichhla achha version hota hai (`git log -- journal.json`).
7b. **(7 Aug 2026) Backtest ke 4 bugs, ek saath mile** — sab tab dikhe jab window 45 din se 250 din ki ki:
   (a) **Timeline misalignment** — purana code stock ka array-index Nifty ke index se seedha match kar deta tha ("same calendar maan lo"). Jo stock baad me list hua ya jiske beech din missing the, uska poora data date-shift ho jaata tha = jhoothi trades. FIX: `alignTo()` har stock ki timeline ko reference pe map karti hai.
   (b) **Alag rules** — backtest fixed 15-din base + purani scoring pe chal raha tha, jabki live adaptive base + capPref + hot-sector pe. Matlab jo system chal raha tha uska test hi nahi ho raha tha. FIX: `setupAt()` ab scan.mjs ka hubahu port hai.
   (c) **Infinite capital** — 29 positions ek saath khul jaati thi (₹1 lakh me ~490% deployment). Returns 5x leverage maan ke aa rahe the. FIX: cash constraint, ab peak 99%.
   (d) **Journal overwrite** — `--write` poora `closed[]` replace kar deta tha, user ki asli live trades mit jaati thi; upar se backtest window live period pe chadh ke wahi din do baar count karti thi. FIX: `live: true` tag + live ki pehli pick pe backtest kaat dena.
7i. **(8 Aug 2026) ENTRY ka volume look-ahead — POORE PROJECT KA SABSE BADA BUG.** Trigger `pivot cross + AAJ ka volume > 1.2× avg` tha. Us din ka total volume order bharte waqt pata hi nahi hota, aur high-volume din = bade green din, to ye "aaj jo bhaaga usi ko aaj ke low pe khareedo" ban gaya tha. 5-saal ka result **+305% se −30%**. User ne shak kiya tha ki numbers sensible nahi lag rahe — sahi tha. **Sabak: har filter pe poochho — "ye information decision ke WAQT available hoti hai?"**
7j. **(8 Aug 2026) `+8% pe 100% book` rule trail se PEHLE chalta tha** — matlab koi trade kabhi +8% se aage ja hi nahi sakti thi. Momentum ka saara paisa ek bade runner me hota hai, wahi kat raha tha. Transcripts se creator ka asli rule mila: "double digit pe 1/3 ya 50% book, baaki trail". Fix ke baad avg win +7.7% se +17.7% ho gaya. **Sabak: rules ko creator ke transcripts se verify karo, yaad se mat likho.**
7k. **(8 Aug 2026) `booked` flag positions me carry nahi ho raha tha** — backtest ne partial-book kiya, par `openPositions` me flag nahi bheja, to scan.mjs agle din usi position ko DOBARA half book kar deta. journal me positions likhte waqt saara state bhejo, sirf price fields nahi.
7f. **(8 Aug 2026) LIVE journal me cash constraint tha hi nahi — SABSE BADA** — maine constraint sirf backtest me daala tha, `scan.mjs` me daalna reh gaya. Nateeja: live portfolio me **11 open positions, ₹2,66,203 deployed = ₹1 lakh ka 266%**. Backtest wahi rules pe max 6 pe rukta tha. User ne khud pakda. **FIX**: scan.mjs ab `deployed` track karta hai aur DO PASS chalata hai — pehle saari exits (cash free hoti hai), phir naye triggers us bachi cash se. Na fit ho to trade `no-cash` status me jaati hai (dashboard pe apna chip hai). Sabak: koi bhi constraint backtest me daalo to **usi waqt live me bhi daalo** — warna backtest jhooth bolega ki sab theek hai.
7g. **(8 Aug 2026) `backtest --write` ne live equity ka basis tod diya** — usne `journal.equity` ko backtest ki ending equity (₹5,10,068) se replace kar diya, jabki open positions ₹1.15 lakh ke hisaab se khuli thi. Agli position 21% of ₹5.1L = ₹1.07 lakh ki banti — ₹1 lakh ke account pe. **FIX**: ab `journal.startCapital` aur `sizeByGear` bhi backtest hi likhta hai, aur scan.mjs wahi padhta hai (hardcode nahi) — dono kabhi alag nahi ho sakte. Saath me `lastSession` bhi set hota hai, warna scan usi din ko dobara process kar deta.
7h. **(8 Aug 2026) Open positions chhoti range me gayab** — journal pick-date pe filter hota tha, to 3 Aug ki khuli position 1D view me nahi dikhti thi aur lagta tha "gayab ho gayi". Open positions HISTORY nahi, ABHI ki haalat hain — ab har range me dikhti hain.
7d. **(8 Aug 2026) `Math.max(1, floor(alloc/price))` = chhupa hua leverage** — 5-saal ke backtest me peak deployment 126% aaya jabki cash constraint laga tha. Wajah: MRF/Page jaise ₹1.5 lakh ke share ka 1 share zabardasti "khareeda" jaata tha jabki allocation ₹17,000 ki thi. Ab `Math.floor` hai aur ek share bhi na aaye to trade skip. **Yahi bug live scan.mjs me bhi tha** — paper portfolio jhootha ho raha tha; wahan bhi fix hai (aisi trade `no-trigger` me jaati hai saaf reason ke saath).
7e. **(8 Aug 2026) Dashboard ka equity backtest se ~4% upar dikhta tha** — client `qty` khud dobara nikalta tha, bina cash-limit ke. Ab journal me hi `qty`/`invested` jaate hain aur client wahi use karta hai. Dono number ab ek hain (farak sirf live trades ka, jo backtest ke baad hui hain).
7c. **(7 Aug 2026) Journal ka date sort tut gaya** jab window 12 mahine ki hui — closed entries me sirf "20 Aug" tha, saal nahi. Client saal guess karta tha (`MON[mon] > nowM+1`), to Aug 2025 ki trades Aug 2026 ki ban ke sabse upar aa gayi. Doosra: en-IN locale **"Sept"** likhta hai par client ke map me sirf `Sep` tha → un saari rows ka time 0 ho ke wo sabse neeche chali jaati thi. FIX: har trade me `ts` (asli epoch) jaata hai, client wahi use karta hai; pichhle saal ki rows pe `'25` suffix bhi dikhta hai.
8. **(6 Aug 2026) "pages build and deployment" deploy job 10-min timeout** ("Timeout reached, aborting!") — GitHub-side degradation thi, repo ki galti nahi. Pehchaan: kal tak deploys <1 min, achanak sab 10-min timeout, PAR live site phir bhi naya data dikha rahi thi (content CDN pahunch jata hai, sirf status-check hang hota hai). FIX: kuch mat chhedo — pehle `curl data.js` se check karo site fresh hai ya nahi; recover hone pe `gh api -X POST repos/GURJOTSINGH10/trading-brain-dashboard/pages/builds` se rebuild trigger karo, green ho jayega. (.nojekyll bhi tab add hua tha — wo cause nahi tha, par rakha hai, Jekyll skip karta hai.)

## 7. USER KE WORKING RULES (inka paalan karna)

- **"Done" bolne se pehle POORA verify karo** — live site browser me render check karke, concrete numbers ke saath. Khokhle "sab theek hai" pe user ka bharosa toot chuka hai ek baar.
- **UI change se pehle PREVIEW dikhao** (`preview.html` pe banao → approve → promote). Bina pooche UI mat badlo.
- Har analysis/trading jawab me: SL ke bina koi plan nahi, "framework-based view hai, financial advice nahi" disclaimer.
- User beginner hai — har technical term ek line me samjhao. Voice: Wealth Magnet style (SKILL.md me voice contract).

## 8. HEALTH CHECK (copy-paste — sab theek hai?)

```bash
# 1. Live site fresh + valid?
curl -s "https://gurjotsingh10.github.io/trading-brain-dashboard/data.js?t=$(date +%s)" | head -c 300
# 2. Cloud runs (last 3):
gh run list --repo GURJOTSINGH10/trading-brain-dashboard --workflow scan.yml --limit 3
# 3. Local task:
powershell -c "(Get-ScheduledTask -TaskName 'TradingBrainDailyScan').State; (Get-ScheduledTaskInfo -TaskName 'TradingBrainDailyScan').LastRunTime"
# 4. Local log:
tail -20 C:/Users/gk379/Projects/trading-brain/scan.log
```

## 9. COMMON KAAM

```bash
cd C:/Users/gk379/Projects/trading-brain/dashboard
node scripts/scan.mjs           # normal scan (naya session ho to process)
node scripts/scan.mjs --force   # display regenerate (journal untouched)
node scripts/build-universe.mjs # universe rebuild (waise auto hai har 10 din)
node scripts/fetch-industries.mjs        # naye stocks ka sector laao (build-universe khud bhi bulata hai)
# --- DONO backtest dobara banane ka poora nuskha (isi order me) ---
# 1) Strategy proof: 5 saal, Rs 1 lakh, 31 Mar 2026 tak
node --max-old-space-size=8192 scripts/backtest.mjs --from 2021-07-16 --to 2026-03-31 \
  --capital 100000 --sizes 24,24,24,24,24 --ramp --test-size 12 --ramp-need 2 --ramp-max 3 --ramp-gain 5 \
  --summary strategy-test.json
# 2) Chalu portfolio: 1 Apr 2026 se aaj tak, Rs 6 lakh (journal.json isi se banti hai)
node --max-old-space-size=8192 scripts/backtest.mjs --from 2026-04-01 \
  --capital 600000 --sizes 24,24,24,24,24 --ramp --test-size 12 --ramp-need 2 --ramp-max 3 --ramp-gain 5 --write
# 3) Phir hamesha:
node scripts/scan.mjs --force
#
# Flags: --from/--to YYYY-MM-DD · --capital N · --sizes a,b,c,d,e · --summary FILE
#        --write (journal likho) · --refresh (chart cache phenk do)
#        --book-at N / --book-part F / --trail-ma N  (default 10 / 0.5 / 40)
#        --max-picks N  ·  --no-chase N%
# AUDIT flags (sirf comparison ke liye, normal run me MAT lagao):
#        --vol-confirm  = purana look-ahead wapas (+305% wala jhootha number)
#        --prev-vol     = volume kal ke bar se (causal test)
#        --next-open    = EOD confirm, agle din open pe entry
#        --vol-exit     = pivot pe ghuso, volume na aaye to usi close pe bahar
# Bina --write ke sirf report chhapti hai — experiment ke liye safe.
# Push hamesha: git add <files> && git commit && git push  (PULL/REBASE NAHI)
```

**Backtest ke baare me zaroori baatein:**
- Rules **live scan.mjs ke barabar** hain (adaptive base, capPref scoring, hot-sector bonus,
  gear-wise pick count). Pehle backtest purane rules pe chalta tha — matlab jo system chal
  raha tha uska test hi nahi ho raha tha.
- **Cash constraint** lagta hai: ₹1 lakh me 29 positions ek saath nahi khul sakti. Bina iske
  backtest chupke se 5x leverage maan leta tha aur returns jhoothe achhe dikhte the.
- **qty me `Math.max(1, ...)` nahi** — wo MRF/Page jaise ₹1.5 lakh ke share ka 1 share
  zabardasti khareed leta tha jabki allocation ₹17,000 ki thi. Ek share bhi na aaye to
  wo trade is capital me possible hi nahi (live scan.mjs me bhi yahi fix hai).
- Range chunav apne aap hota hai: window ≤480 bars → `2y`, ≤1200 → `5y`, warna `10y`.
  Har chart turant `window + warmup + 30` bars pe kat jaata hai — isliye 5y bhi 2y jitni
  RAM me chalta hai. Cache alag-alag file me (`charts-10y.json.gz`).
- Journal me `qty`/`invested` bhi jaate hain, taaki dashboard apna hisaab dobara na kare
  (pehle wo bina cash-limit ke ginta tha aur equity ~4% upar dikhta tha).
- `--write` **live trades (`live: true`) ko kabhi nahi mitata**, aur apni window ko live
  period se pehle kaat deta hai — warna wahi din do baar count hote the.
- Jaan-bujh ke alag: earnings guard nahi hai (historical result calendar milta hi nahi),
  aur universe aaj ki NSE list hai (delisted stocks nahi = thodi survivorship bias).

## 10. PENDING IDEAS (user ne abhi mana kiya, baad me maange to)

- Gear 2 ka mood amber karna (abhi laal hai), header me session-date chip,
  delivery% flag card pe, PWA manifest (Add to Home Screen app feel)
- Kal-ke-picks ka result strip scan tab pe

## 10b. STRATEGY RULES — 8 Aug 2026 ko BADLE (kyun badle, ye padhna zaroori hai)

**ENTRY: volume condition hata di.** Pehle trigger tha `pivot cross + us din ka volume
> 1.2× average`. Ye LOOK-AHEAD tha — jab tumhara stop-buy pivot pe bharta hai, us waqt
poore din ka volume pata hi nahi hota. Aur high-volume din aksar bade green din hote
hain, to wo condition asal me *"jo din stock bhaaga usi din ke low pe khareedo"* ban
jaati thi. **Sirf isi ek cheez se 5-saal ka result +305% se −30% ho jaata tha.** Teen
tarike se verify kiya (any-cross, prev-day volume, next-open) — teenon me edge khatam.

**EXIT: transcripts se creator ke apne shabd nikale.** Wo do baar saaf bolta hai:
> *"जैसे ही आप डबल डिजिट में आए तो आप 1/3 या 50% बुक कर लें। बाकी आप 10 डे से ट्रेल करते रहे।"*
> *"जहां पे भी 10-12% का आए आप 50% बुक करके बाकी 10 डे पे ट्रेल कर सकते हैं"*

Code kar raha tha: **+8% pe 100% book** — dono galat. Aur wo rule trail se PEHLE chalta
tha, matlab **koi trade kabhi +8% se aage ja hi nahi sakti thi.** Momentum ka saara
paisa us ek bade runner me hota hai, wahi kat raha tha.

Ab: **+10% pe 50% book, baaki 40 DMA pe trail.**

Trail 10 DMA kyun nahi (jo creator bolta hai)? Mechanically wo bahut kathor hai — pehla
close 10 DMA ke neeche aate hi bahar, avg hold 4 session. Wo chart/volume/market dekh ke
discretion lagata hai; hum nahi laga sakte. Backtest me 10 DMA = FULL −25%, 40 DMA = +63%.
40 DMA hi ek aisi trail hai jo DONO halves me PF > 1 deti hai.

**ROZ SIRF TOP-2 PICKS** (pehle gear ke hisaab se 3-8 the). Creator: *"एक दो पोजीशन ली।
स्टॉक इज़ अप लाइक 10-20%, ऐसे तीन चार स्टॉक मिल गए — यू आर लाइक 25% इन्वेस्टेड, दे आर डन।"*
Scan har candidate ko score deta hai; **rank 3 ke baad signal khatam** ho jaata hai aur wo
trades achhi walon ki capital kha jaati hain. Dono capitals pe test:

| picks/din | ₹6L FULL | ₹6L H2 | ₹1L FULL | ₹1L H2 |
|---|---|---|---|---|
| top-1 | +6.8% | +12% | — | — |
| **top-2** | **+152%** | **+56%** | **+138%** | **+55%** |
| top-3 | +113% | +9% | +38% | +18% |
| top-4 | +83% | −5.5% | — | — |
| purana (3-8) | +123% | +14% | +105% | +8% |

H2 (recent bura market) ka profit factor **1.29 → 2.10**. Drawdown bhi −19.8% se −12.3%.
Ye ek hi change hai jo dono capitals pe consistent nikla. Watchlist ab hamesha dikhti hai
(agle 3 candidates) — par wo TRADE nahi hai, journal unhe track nahi karta.

### JO TEST KIYE AUR FAIL HUE (dobara mat aazmana)

Transcripts se 6 filters nikale, sab **alag-alag** OOS test kiye — **har ek ne nateeja
BIGAADA** (baseline ₹6L: FULL +122.7%, H1 +46%, H2 +13.9%):

| filter | FULL | H1 | H2 |
|---|---|---|---|
| prior-move ≥20% / 40% / 60% | +3.8% / −24% / **−48%** | — | −24% / −32% / −28% |
| no-chase 2% / 3% | +52% / +101% | — | −1% / +10% |
| liquidity ₹15Cr / ₹25Cr | −1.6% / +16.5% | — | +17% / −17% |
| 150 DMA ke upar | +20.6% | +26.3% | −12.2% |
| Healthcare skip | +61% | +29.4% | +0.3% |
| overhead supply 30% | +67.4% | +27.1% | +3.4% |
| **hot-sector bonus HATANA** | **−42.1%** | −18.4% | −28% |

Sabak: **uske rules judgement hain, mechanical gate nahi.** "Overhead supply zyada hai"
wo chart pe context ke saath dekhta hai; fixed 30% rule bhonda hathiyaar hai. Aur ye bhi
pata chala ki **hot-sector bonus (+4) system ka sabse zaroori scoring element hai** —
hatane se −42%. Usko kabhi mat chhedna. Uski liquidity ki shikayat bhi USKI capital ke
liye thi — ₹1.44 lakh ki position ke liye ₹5 Cr turnover bilkul theek hai.

**RISK RAMP — cash se nikalte waqt aadhi size.** Creator ke shabd:
> *"हमने कुछ एक ट्रेड्स ली **टू टेस्ट कि मार्केट कैसा है**। अगर यहां पर हमें सफलता मिलती है,
> ईजीनेस महसूस होता है, तो हम आगे जाएंगे। **हम गियर अप करेंगे।** लेकिन हमें वहीं पर ही खड्डे
> नजर आ रहे थे। तो पहले गियर से दूसरे तीसरे गियर में जाने का कोई मतलब है नहीं।"*
> *"**एक दो पोजीशन ली। स्टॉक इज़ अप लाइक 10-20%**, ऐसे तीन चार स्टॉक मिल गए। यू आर लाइक 25% इन्वेस्टेड, दे आर डन।"*

Rule: **jab tak 2 open positions +5% se upar na hon, size aadhi (12%) aur max 3 positions.**
Do chalne lagein → full size (24%). Ye market gear se ALAG hai — gear market ka mood hai,
ye TUMHARE apne trades ka feedback.

⚠ **IMAANDAARI — iska return pe asar NOISE ke andar hai.** ₹1L pe ye nateeja bigaadta hai
(+133% → +105%), ₹6L pe sudhaarta hai (+87% → +123%). Same rules, alag capital, ULTA
nateeja. **Isliye ise return booster maan ke kabhi tune mat karna.** Ye risk discipline
hai: cash se nikalte hi 96% invested ho jaana asli paise me khatarnak hai, aur backtest
gap-risk / slippage / emotion price nahi karta. Chalu FY me isne madad ki: −11.4% se
−8.7%, drawdown −10.3% se −8.9%.

**SIZING: har trade 24% of capital (flat), test mode me 12%.** Gear-based scaling data me kuch add nahi
karti. 5 ladders × 2 halves test kiye — 22% aur 24% hi dono halves me positive. 24%
chuna: kam drawdown (−16.9% vs −23.1%) aur H2 me behtar. **Note:** 7 Aug ko maine
`10/18/24/24/12` recommend kiya tha (gear 5 pe size kam) — wo TOOTE exit rules pe nikla
tha. Us waqt gear 5 isliye kharaab lag raha tha kyunki +8% cap us gear ke sabse bade
runners ko kaat raha tha. Exit theek karte hi wo nateeja ulta ho gaya.

**Sabak:** ek rule ka nateeja doosre rule ki galti ki wajah se aa sakta hai. Koi bhi
parameter tune karne se pehle dekho ki baaki rules sahi hain ya nahi.

## 11. TRACK RECORD SNAPSHOT (8 Aug 2026 tak)

### DO ALAG CHEEZEIN — inhe kabhi mat milaana

**(a) Chalu portfolio — FY 26-27, base ₹6,00,000.** 1 Apr 2026 se, `journal.json` isi ka hai.

| | |
|---|---|
| Opening (1 Apr 26) | ₹6,00,000 |
| Abhi | ₹5,45,351 (**−9.1%**, 88 sessions) |
| Win rate | 21% (10W / 38L) · avg win +12.4% / loss −2.7% |
| Open positions | 6 · ₹5,33,469 lagi hui (**98%**) · 4 half-booked |
| Chhoote mauke | 113 (breakout aaya, cash nahi thi) |

Haan, abhi **loss me hai**. 88 sessions / 48 trades ka sample bahut chhota hai, aur ye
daur weak raha (Sep 24 – Mar 26 me Nifty −13.5%). Long-only momentum girte market me
paisa nahi banata — ye bug nahi.

**(b) Strategy ka 5-saal test — ₹1 lakh pe, 16 Jul 2021 → 30 Mar 2026** (`strategy-test.json`).
Ye PROOF hai ki framework kaam karta hai, user ka account nahi.

| | |
|---|---|
| Trades | 417 (2104 aur chhoote — cash khatam) |
| Win rate | 33.6% · avg win **+17.7%** / loss −2.9% |
| Expectancy | **+4.02%**/trade · PF **1.63** · avg hold 12.4 sessions |
| Equity | ₹1,00,000 → ₹2,67,397 gross / **₹2,33,306 net** (+133%) |
| Charges | ₹34,092 (gross profit ka 20%) |
| Max drawdown | **−18.2%** · max 7 positions |

≈ **19.5% CAGR** net. Benchmark usi daur me: Nifty +40% (7.5% CAGR), Nifty Midcap
+94% (15.2% CAGR). To ye midcap ko thoda beat karta hai, aur 42% din cash me baitha
rehta hai — user ka andaaza ("creator index ko kuch percent se beat karta hai") match.

**Purane numbers (+305%) INVALID the** — wo entry ke volume look-ahead pe khade the.

**Caveat dono pe:** universe aaj ki NSE list hai — delist hue stocks nahi (survivorship
bias), cap/sector tag bhi aaj ke hain. Backtest me earnings guard nahi hai. Transcripts
bhi adhure hain (kaafi videos delete ho chuke hain), to creator ke rules ka poora context
nahi mila hoga.

### POSITION SIZING — 10/18/24/24/12 (data se chuna, guess nahi)

₹6 lakh pe: gear 2 = ₹1.08L · gear 3-4 = **₹1.44L** · gear 5 = ₹72k. Max ~4-6 positions.

Purana ladder (10/14/17/21/25) **hata diya** — 12 ladders ko 5 saal pe test kiya, phir
OUT-OF-SAMPLE check (2021-24 vs 2024-26 alag-alag):

| Ladder | H1 rank | H2 rank | 5y net |
|---|---|---|---|
| **10/18/24/24/12** | **#2** | **#2** | **+479%** |
| flat 20 | #3 | #3 | +431% |
| purana 10/14/17/21/25 | #5 | #4 | +340% |
| 20/20/20/20/12 | #1 | **#6** | ← noise, isse bacha |

Sirf 10/18/24/24/12 dono halves me top-2 raha. `20/20/20/20/12` H1 me #1 tha aur H2 me
#6 — agar sirf ek window dekhte to wahi chun lete. **Isliye single-window winner pe
kabhi mat jaana, hamesha out-of-sample check karo.**

Kyun kaam karta hai: gear 5 pe expectancy sabse KAM hai (+0.31% vs gear 3-4 ka ~+1.3%) —
euphoria me breakout mehnga milta hai. Isliye gear 5 pe size ghatti hai (24% → 12%).
**Ye creator ke "5th gear = strike very very hard" ke ULTA hai** — par gear 5 ka sample
chhota hai (61 din / 52 trades), to ye ek conservative hedge hai, pakka daava nahi.

## PURANA SNAPSHOT (reference ke liye)

**Backtest — 1250 sessions / 5 saal (16 Jul 2021 → 7 Aug 2026), live rules, cash-constrained:**

| | |
|---|---|
| Picks diye | 3855 |
| Trade lagi | 833 (21.6%) — baaki 2114 no-trigger, 908 cash khatam |
| Win rate | **38.2%** (318W / 515L) |
| Avg win / loss | +7.8% / −3.0% |
| Expectancy per trade | **+1.13%** ← asli baat yahi hai |
| Profit factor | 1.57 |
| Equity (gross) | ₹1,00,000 → ₹5,10,068 (+410%) |
| Charges (STT/DP/GST) | ₹99,295 — gross profit ka 24% |
| **Equity (net)** | **₹4,10,773 (+311%)** |
| Max drawdown | **−14.7%** |
| Max concurrent positions | 6 (peak deployment 100% of capital) |
| Gear 1 (cash) days | 535 / 1245 — 43% din market se bahar |

Gear-wise expectancy: gear 3 = +1.30%, gear 4 = +1.35%, gear 2 = +0.55%, **gear 5 = +0.31%**
(5th gear sabse kharaab — 61 din, sirf 52 trades; euphoria me entry mehngi padti hai).
Cap-wise: Mid 42% win / +1.37% · Small 38% / +1.23% · Micro 38% / +1.07%.
Sector-wise sabse kharaab: **FMCG −0.16% expectancy** (63 trades) — is framework ko defensive
sectors suit nahi karte.

**Sabse bada sabak:** 908 breakouts sirf isliye chhoot gaye kyunki capital pehle se lagi thi.
₹1 lakh me gear 5 pe 8 picks dena bekaar hai — 6 se zyada positions kabhi khul hi nahi sakti.

**Caveats (numbers thode upar hain):** universe aaj ki NSE list hai — 5 saal me delist hue
stocks usme nahi (survivorship bias). Cap/sector tag bhi AAJ ke hain, 2021 ke nahi.
Earnings guard backtest me nahi hai.

Purana 45-din (+1.2%) aur 250-din wala backtest ab valid nahi — alag rules/constraints the.

- 9 Jul: automation ka pehla solo pass (cloud ne 18:45 IST khud update kiya)
- Ye PAPER trading hai. User se wada: 2-3 mahine paper track record dekh ke hi real paise ki baat.

---
*Ye file update karte rehna jab kuch bada badle. Copy GitHub repo me bhi hai (PROJECT-BRAIN.md) taaki PC ke bina bhi mile.*
