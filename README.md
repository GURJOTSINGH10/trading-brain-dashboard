# Trading Brain — Daily Scan Dashboard

NSE ka automated EOD scanner — The Wealth Magnet (YouTube) framework pe based.

- **Har trading day 7:10 PM IST** pe GitHub Action chalta hai ([scan.yml](.github/workflows/scan.yml))
- [scan.mjs](scripts/scan.mjs) ~200 liquid NSE stocks scan karta hai: market health (gear system) → hot sectors → tight consolidation / pivot ke paas "ready" stocks
- Result [data.js](data.js) me likha jaata hai → GitHub Pages pe live dashboard update
- ₹1 lakh paper portfolio [journal.json](journal.json) me track hota hai — breakout trigger, SL hit, 10 DMA trail, squat fail sab automatic

**Disclaimer**: Framework-based paper trading experiment hai, financial advice nahi. SEBI-registered advisory nahi hai.
