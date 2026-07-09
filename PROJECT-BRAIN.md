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
├── run-scan.bat              ← LOCAL automation runner (Task Scheduler isse chalata hai) — MAT HATANA/MOVE KARNA
├── scan.log                  ← local runs ka log (debugging ke liye pehle yahan dekho)
├── trade-skill-v2.zip        ← claude.ai wali skill ka package (re-upload ke liye)
├── workflow-backup\scan.yml  ← cloud workflow ki local copy (repo wala asli hai)
├── source\                   ← 225 videos ke raw transcripts + chart screenshots
├── extractions\              ← transcripts se nikale rules (batch-01..06)
└── dashboard\                ← GIT REPO (GitHub se synced) — asli engine yahan hai
    ├── index.html            ← dashboard UI (liquid glass + market mood)
    ├── data.js               ← AUTO-GENERATED har scan pe (haath mat lagana)
    ├── journal.json          ← paper portfolio ka state (positions + 186 backtest trades)
    ├── universe.json         ← 749 NSE stocks + cap tags (AUTO-refresh har 10 din)
    ├── index-flat-backup.html, index-old-backup.html ← purane UI designs
    ├── .github\workflows\scan.yml ← CLOUD automation (4 crons)
    └── scripts\
        ├── scan.mjs          ← MAIN ENGINE (data fetch → gear → picks → journal → data.js)
        ├── build-universe.mjs← NSE lists se universe banata hai (cap tags ke saath)
        └── backtest.mjs      ← historical replay (journal.closed bharta hai)
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
2. Yahoo se 749 stocks + indices ki 1-saal history — **market-hours me aaj ka ADHURA candle DROP hota hai** (15:35 IST se pehle aaj ka bar use nahi hota — ye critical guard hai)
3. NSE **bhavcopy** (sec_bhavdata_full_DDMMYYYY.csv, ~4:30 PM publish) + indices (ind_close_all) → aaj ka OFFICIAL bar merge (delivery % bhi)
4. Session naya hai? Nahi → skip (idempotent). Haan →
5. **Market health → GEAR (1-5)**: smallcap 10/50 DMA, breadth, adv/dec, 52W highs, USDINR, aur **"Breakouts Working?"** (creator ka #1 signal — recent breakouts me traction% ; kam ho to gear hard-cap)
6. Hot sectors (5-din return + participation + volume)
7. Stock scan: liquid (₹5Cr+), rising 50 DMA ke upar, tight base (≤13%), pivot ke paas (≤4.5%), shaant (ATR check) = **READY** → top 5 picks (gear<3 to 3; gear 1 = 0 picks). 0 picks ho to relaxed "watchlist" (nazar-me-rakho) deta hai
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

**Local (Task Scheduler "TradingBrainDailyScan" — PC on ho to):** 5-11 PM har ghanta (Mon-Fri) + 8 AM (Tue-Sat) = 12 triggers, StartWhenAvailable on. `run-scan.bat` chalata hai jo **pehle `git fetch + reset --hard origin/main`** karta hai (KABHI pull/rebase nahi — niche "bugs" dekho), phir scan, phir commit+push.

Dono idempotent — same session dobara process nahi hota. Expectation: **same evening update (usually 5-7 PM); worst case agli subah 8 baje.**

---

## 6. BUGS JO AA CHUKE HAIN (dobara mat hone dena)

1. **Yahoo partial-candle (SABSE BADA)**: market-hours me Yahoo aaj ka LIVE adhura candle deta hai → delayed runs ne adhure din pe journal chala diya tha. FIX scan.mjs me hai (15:35 IST guard). Kabhi hatana mat.
2. **Yahoo EOD lag**: shaam ko ghanton late final hota hai → isliye NSE bhavcopy primary source hai.
3. **`git pull --rebase --autostash` ne data.js/journal.json me CONFLICT MARKERS chhod ke commit kar diye** → dashboard toot gaya ("Data load nahi hua"). RULE: auto-generated files pe kabhi rebase/pull nahi — sirf `reset --hard origin/main` ya cloud me push-fail = graceful skip.
4. **Missed-trigger catch-up market hours me chala** (StartWhenAvailable) → partial data process (ab #1 guard se safe).
5. **GitHub OAuth token me `workflow` scope NAHI hai** — scan.yml ko gh/git se push NAHI kar sakte. Edit karna ho to: github.com pe web editor (browser automation se content daal do, COMMIT BUTTON user se dabwana — CDP click us button pe renderer FREEZE karta hai is machine pe; 2-3 attempt me kabhi chal jata hai).
6. **Git-bash me `TZ=Asia/Kolkata date` UTC dikhata hai is PC pe** — IST chahiye to PowerShell `Get-Date` ya Node Intl use karo.
7. Journal kabhi corrupt ho jaye → git history me pichhla achha version hota hai (`git log -- journal.json`).

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
node scripts/backtest.mjs 45    # 45-din ka backtest (journal.closed bhar deta hai)
# Push hamesha: git add <files> && git commit && git push  (PULL/REBASE NAHI)
```

## 10. PENDING IDEAS (user ne abhi mana kiya, baad me maange to)

- Gear 2 ka mood amber karna (abhi laal hai), header me session-date chip,
  delivery% flag card pe, PWA manifest (Add to Home Screen app feel)
- Kal-ke-picks ka result strip scan tab pe

## 11. TRACK RECORD SNAPSHOT (10 Jul 2026 tak)

- Backtest (45 din, May-Jun 2026): 186 picks → 62 trades, 32% win rate, avg win +5.2% vs loss −2.0%, ₹1,00,000 → ₹1,01,174 (+1.2%), 124 no-trigger (breakout hi nahi aaya — paisa nahi laga)
- 9 Jul: automation ka pehla solo pass (cloud ne 18:45 IST khud update kiya)
- Ye PAPER trading hai. User se wada: 2-3 mahine paper track record dekh ke hi real paise ki baat.

---
*Ye file update karte rehna jab kuch bada badle. Copy GitHub repo me bhi hai (PROJECT-BRAIN.md) taaki PC ke bina bhi mile.*
