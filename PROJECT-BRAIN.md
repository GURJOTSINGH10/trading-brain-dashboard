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
    ├── journal.json          ← paper portfolio ka state (positions + ~370 backtest + live trades)
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
clickable filter chips, stock search, recent form). Har stock: cap badge, TradingView link (avatar/button),
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
node scripts/backtest.mjs 250            # 12-mahine ka backtest — sirf report chhapta hai
node scripts/backtest.mjs 250 --write    # ...aur journal.closed bhi update karta hai
node scripts/backtest.mjs 250 --refresh  # chart cache phenk ke Yahoo se naya (~10 min)
# Push hamesha: git add <files> && git commit && git push  (PULL/REBASE NAHI)
```

**Backtest ke baare me zaroori baatein:**
- Rules **live scan.mjs ke barabar** hain (adaptive base, capPref scoring, hot-sector bonus,
  gear-wise pick count). Pehle backtest purane rules pe chalta tha — matlab jo system chal
  raha tha uska test hi nahi ho raha tha.
- **Cash constraint** lagta hai: ₹1 lakh me 29 positions ek saath nahi khul sakti. Bina iske
  backtest chupke se 5x leverage maan leta tha aur returns jhoothe achhe dikhte the.
- `--write` **live trades (`live: true`) ko kabhi nahi mitata**, aur apni window ko live
  period se pehle kaat deta hai — warna wahi din do baar count hote the.
- Jaan-bujh ke alag: earnings guard nahi hai (historical result calendar milta hi nahi),
  aur universe aaj ki NSE list hai (delisted stocks nahi = thodi survivorship bias).

## 10. PENDING IDEAS (user ne abhi mana kiya, baad me maange to)

- Gear 2 ka mood amber karna (abhi laal hai), header me session-date chip,
  delivery% flag card pe, PWA manifest (Add to Home Screen app feel)
- Kal-ke-picks ka result strip scan tab pe

## 11. TRACK RECORD SNAPSHOT (7 Aug 2026 tak)

**Backtest — 250 sessions (1 Aug 2025 → 7 Aug 2026), live rules, cash-constrained:**

| | |
|---|---|
| Picks diye | 429 |
| Trade lagi | 127 (29.6%) — baaki 258 no-trigger, 44 cash khatam |
| Win rate | **38.6%** (49W / 78L) |
| Avg win / loss | +7.8% / −2.7% |
| Expectancy per trade | **+1.34%** ← asli baat yahi hai |
| Profit factor | 1.70 |
| Equity (gross) | ₹1,00,000 → ₹1,28,377 (+28.4%) |
| Charges (STT/DP/GST) | ₹7,251 — gross profit ka 25% |
| **Equity (net)** | **₹1,21,126 (+21.1%)** |
| Max drawdown | −6.3% |
| Max concurrent positions | 7 (peak deployment 99% of capital) |
| Gear 1 (cash) days | 152 / 245 — 62% din market se bahar |

Cap-wise: Mid 56% win / +2.97% exp · Small 40% / +1.29% · Micro 33% / +0.99%.
Purana 45-din wala backtest (+1.2%) ab valid nahi — wo alag rules pe tha aur cash constraint
bhi nahi lagta tha.

- 9 Jul: automation ka pehla solo pass (cloud ne 18:45 IST khud update kiya)
- Ye PAPER trading hai. User se wada: 2-3 mahine paper track record dekh ke hi real paise ki baat.

---
*Ye file update karte rehna jab kuch bada badle. Copy GitHub repo me bhi hai (PROJECT-BRAIN.md) taaki PC ke bina bhi mile.*
