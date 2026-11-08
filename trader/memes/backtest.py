"""Backtest graduation strategies on collected PumpSwap tokens with a $100 paper account.

Parameters are selected on the earlier-created half of tokens and evaluated on
the later half. Fills are conservative: a candle that touches both stop and
target counts as a stop, and a gap below the stop fills at the open.
"""
import itertools
import json
import os
import statistics

CACHE = os.path.join(os.path.dirname(__file__), "cache")
COST = 0.01        # per side: PumpSwap fee + slippage + execution lag
START = 100.0
SIZE = 0.10        # fraction of equity per trade
MAX_OPEN = 10
BAR = 300

GRID = {
    "delay": [1, 3, 6, 12],             # 5m candles to wait after graduation
    "min_mom": [-1.0, 0.0, 0.25, 0.5],  # required gain from graduation price at entry
    "min_vol": [0, 20_000, 100_000],    # USD volume traded during the wait
    "tp": [0.3, 0.6, 1.0, 2.0],
    "sl": [0.08, 0.15, 0.3],            # 0.08 = the tweet's stop
    "hold": [12, 36, 144],              # max candles held
}


def trade(token, p):
    """Return (entry_ts, exit_ts, net_return) or None if the filter rejects."""
    c = token["candles"]
    d = p["delay"]
    if len(c) <= d or c[0][0] - token["created"] > BAR * 2:
        return None  # need candles starting at graduation
    grad = c[0][1]
    if c[d - 1][4] / grad - 1 < p["min_mom"] or sum(x[5] for x in c[:d]) < p["min_vol"]:
        return None
    entry = c[d][1] * (1 + COST)
    stop, target = entry * (1 - p["sl"]), entry * (1 + p["tp"])
    last = min(len(c), d + p["hold"])
    for ts, o, h, lo, cl, _ in c[d:last]:
        if o <= stop:
            return c[d][0], ts, o * (1 - COST) / entry - 1
        if lo <= stop:
            return c[d][0], ts, stop * (1 - COST) / entry - 1
        if h >= target:
            px = max(o, target)
            return c[d][0], ts, px * (1 - COST) / entry - 1
    return c[d][0], c[last - 1][0], c[last - 1][4] * (1 - COST) / entry - 1


def portfolio(tokens, p):
    trades = sorted(t for t in (trade(tok, p) for tok in tokens) if t)
    cash, open_, peak, dd, rets = START, [], START, 0.0, []
    events = sorted([(t[0], 1, i) for i, t in enumerate(trades)] + [(t[1], 0, i) for i, t in enumerate(trades)])
    stake = {}
    for ts, kind, i in events:
        if kind == 0 and i in stake:
            cash += stake.pop(i) * (1 + trades[i][2])
            rets.append(trades[i][2])
        elif kind == 1 and len(stake) < MAX_OPEN:
            equity = cash + sum(stake.values())
            amt = min(cash, equity * SIZE)
            if amt >= 1:
                cash -= amt
                stake[i] = amt
        equity = cash + sum(stake.values())
        peak = max(peak, equity)
        dd = max(dd, 1 - equity / peak)
    final = cash + sum(stake.values())
    wins = sum(r > 0 for r in rets)
    return {"final": final, "n": len(rets), "win": wins / len(rets) if rets else 0, "dd": dd,
            "median": statistics.median(rets) if rets else 0}


def main():
    db = json.load(open(os.path.join(CACHE, "graduated.json")))
    tokens = sorted((t for t in db.values() if t["candles"]), key=lambda t: t["created"])
    half = len(tokens) // 2
    train, test = tokens[:half], tokens[half:]
    print(f"{len(tokens)} graduated tokens with candles; train={len(train)}, test={len(test)}")

    base = {"delay": 1, "min_mom": -1.0, "min_vol": 0, "tp": 1.0, "sl": 0.08, "hold": 144}
    fmt = lambda r: (f"${r['final']:.2f} ({(r['final'] / START - 1) * 100:+.1f}%) trades={r['n']} "
                     f"win={r['win'] * 100:.0f}% median_trade={r['median'] * 100:+.1f}% maxDD={r['dd'] * 100:.0f}%")
    print("baseline 'buy every graduate, -8% stop, +100% TP':")
    print("  train", fmt(portfolio(train, base)))
    print("  test ", fmt(portfolio(test, base)))

    best = None
    for combo in itertools.product(*GRID.values()):
        p = dict(zip(GRID, combo))
        r = portfolio(train, p)
        if r["n"] >= 15 and (best is None or r["final"] > best[1]["final"]):
            best = (p, r)
    p, r = best
    print("best on train:", p)
    print("  train", fmt(r))
    print("  test ", fmt(portfolio(test, p)))
    json.dump(p, open(os.path.join(CACHE, "params.json"), "w"))


if __name__ == "__main__":
    main()
