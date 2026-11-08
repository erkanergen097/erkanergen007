"""Paper-trade the consensus strategy on a $100 virtual account.

Parameters are chosen on the first 60% of history (train) and then frozen and
run on the last 40% (test), so the test result is out-of-sample.
"""
import itertools

from data import load
from strategy import ema, votes

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"]
FEE = 0.001      # 0.1% Binance spot taker fee per side
SLIP = 0.0005    # 0.05% slippage per side
START = 100.0
HARD_STOP = 0.08  # the tweet's -8% stop on every trade


def simulate(data, p, lo, hi, log=None, regime=None):
    """data: {sym: (bars, votes, atr)} aligned on index. Long-only spot."""
    cash, pos, trades = START, {}, []
    peak, max_dd, curve = START, 0.0, []
    for i in range(lo, hi):
        # exits first
        for s in list(pos):
            bars, v, a = data[s]
            b, ps = bars[i], pos[s]
            ps["high"] = max(ps["high"], b["h"])
            stop = max(ps["entry"] * (1 - HARD_STOP), ps["high"] - p["trail"] * a[i - 1])
            px = None
            if b["o"] <= stop:
                px = b["o"]
            elif b["l"] <= stop:
                px = stop
            elif v[i - 1] <= p["exit_votes"]:
                px = b["o"]
            if px is not None:
                proceeds = ps["qty"] * px * (1 - SLIP) * (1 - FEE)
                cash += proceeds
                trades.append(proceeds / ps["cost"] - 1)
                if log is not None:
                    log.append((s, ps["t"], b["t"], ps["entry"], px, proceeds - ps["cost"]))
                del pos[s]
        # entries on previous bar's consensus, filled at this bar's open
        equity = cash + sum(ps["qty"] * data[s][0][i]["o"] for s, ps in pos.items())
        for s, (bars, v, a) in data.items():
            if s in pos or len(pos) >= p["max_pos"] or v[i - 1] < p["enter_votes"]:
                continue
            # market regime: no new longs while BTC is below its ~50-day EMA
            if p.get("regime") and regime and not regime[i - 1]:
                continue
            alloc = min(cash, equity / p["max_pos"])
            if alloc < 5:  # Binance min notional
                continue
            px = bars[i]["o"] * (1 + SLIP)
            qty = alloc * (1 - FEE) / px
            cash -= alloc
            pos[s] = {"qty": qty, "entry": px, "cost": alloc, "high": px, "t": bars[i]["t"]}
        equity = cash + sum(ps["qty"] * data[s][0][i]["c"] for s, ps in pos.items())
        curve.append(equity)
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak)
    wins = sum(1 for t in trades if t > 0)
    return {"final": curve[-1] if curve else START, "trades": len(trades),
            "win": wins / len(trades) if trades else 0, "max_dd": max_dd,
            "worst": min(trades) if trades else 0, "best": max(trades) if trades else 0}


def buy_hold(data, lo, hi):
    each = START / len(data)
    return sum(each * (1 - FEE) * bars[hi - 1]["c"] / bars[lo]["o"] * (1 - FEE)
               for bars, _, _ in data.values())


def main():
    raw = {s: load(s) for s in SYMBOLS}
    common = set.intersection(*(set(b["t"] for b in bars) for bars in raw.values()))
    raw = {s: [b for b in bars if b["t"] in common] for s, bars in raw.items()}
    n = len(next(iter(raw.values())))
    split = int(n * 0.6)
    print(f"{len(SYMBOLS)} coins, {n} hourly bars (~{n / 24:.0f} days); train={split}, test={n - split}")

    btc = [b["c"] for b in raw["BTCUSDT"]]
    regime = [c > e for c, e in zip(btc, ema(btc, 1200))]
    grid = {"regime": [False, True], "breakout": [24, 48, 96], "flow": [0.50, 0.52], "max_atr": [0.02, 0.03],
            "enter_votes": [4, 5], "exit_votes": [1, 2], "trail": [3, 5], "max_pos": [2, 3]}
    cache, best = {}, None
    for combo in itertools.product(*grid.values()):
        p = dict(zip(grid, combo))
        key = (p["breakout"], p["flow"], p["max_atr"])
        if key not in cache:
            cache[key] = {s: (bars, *votes(bars, p)) for s, bars in raw.items()}
        r = simulate(cache[key], p, 1201, split, regime=regime)
        # rank by return per unit drawdown to avoid picking a lucky, fragile setup
        score = (r["final"] / START - 1) / max(r["max_dd"], 0.05)
        if r["trades"] >= 30 and (best is None or score > best[0]):
            best = (score, p, r)

    _, p, tr = best
    data = cache[(p["breakout"], p["flow"], p["max_atr"])]
    log = []
    te = simulate(data, p, split, n, log, regime=regime)
    fmt = lambda r: (f"${r['final']:.2f} ({(r['final'] / START - 1) * 100:+.1f}%), trades={r['trades']}, "
                     f"win={r['win'] * 100:.0f}%, maxDD={r['max_dd'] * 100:.1f}%, "
                     f"best={r['best'] * 100:+.1f}%, worst={r['worst'] * 100:+.1f}%")
    print("chosen params:", p)
    print("TRAIN (in-sample):     ", fmt(tr))
    print(f"  buy&hold train:       ${buy_hold(data, 1201, split):.2f}")
    print("TEST  (out-of-sample): ", fmt(te))
    p0 = dict(p, regime=not p["regime"])
    print(f"  same params, regime={p0['regime']}:", fmt(simulate(data, p0, split, n, regime=regime)))
    print(f"  buy&hold test:        ${buy_hold(data, split, n):.2f}")


if __name__ == "__main__":
    main()
