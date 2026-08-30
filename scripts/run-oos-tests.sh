#!/usr/bin/env bash
# OOS test harness — #1 (sector persistence) aur #4 (leader-weighted hot bonus)
# Har run ka poora report alag file me. Cache (charts-10y-v3) sab share karte hain.
# H1/H2 runs me positional 1400 diya hai taaki RANGE bhi 10y rahe aur wahi cache
# use ho — warna har window apna 2000-stock fetch chalu kar deti.
set -u
cd "$(dirname "$0")/.."
OUT=${1:-./.cache/oos}
mkdir -p "$OUT"

COMMON="--sizes 24,24,24,24,24 --ramp --test-size 12 --ramp-need 2 --ramp-max 3 --ramp-gain 5"

run () {   # run <label> <capital> <from> <to> <extra...>
  local label=$1 cap=$2 from=$3 to=$4; shift 4
  echo ">>> $label"
  node --max-old-space-size=8192 scripts/backtest.mjs 1400 \
    --from "$from" --to "$to" --capital "$cap" $COMMON "$@" > "$OUT/$label.log" 2>&1
  cp .cache/backtest-report.txt "$OUT/$label.report.txt" 2>/dev/null
  grep -E "Equity \(net|Profit factor|Max drawdown|Win rate|Expectancy|trade lagi" "$OUT/$label.report.txt" \
    | sed "s/^/    /"
}

F1=2021-07-16; F2=2026-03-31          # FULL
H1a=2021-07-16; H1b=2024-01-01        # H1
H2a=2024-01-01; H2b=2026-03-31        # H2

# ---- FULL, dono capital, teen variant ----
run base-6L-FULL     600000 $F1 $F2
run base-1L-FULL     100000 $F1 $F2
run persist-6L-FULL  600000 $F1 $F2 --sector-persist
run persist-1L-FULL  100000 $F1 $F2 --sector-persist
run leader-6L-FULL   600000 $F1 $F2 --leader-bonus
run leader-1L-FULL   100000 $F1 $F2 --leader-bonus

# ---- H1 / H2 ----
run base-6L-H1     600000 $H1a $H1b
run base-6L-H2     600000 $H2a $H2b
run base-1L-H1     100000 $H1a $H1b
run base-1L-H2     100000 $H2a $H2b
run persist-6L-H1  600000 $H1a $H1b --sector-persist
run persist-6L-H2  600000 $H2a $H2b --sector-persist
run persist-1L-H1  100000 $H1a $H1b --sector-persist
run persist-1L-H2  100000 $H2a $H2b --sector-persist
run leader-6L-H1   600000 $H1a $H1b --leader-bonus
run leader-6L-H2   600000 $H2a $H2b --leader-bonus
run leader-1L-H1   100000 $H1a $H1b --leader-bonus
run leader-1L-H2   100000 $H2a $H2b --leader-bonus

echo "ALL RUNS DONE"
