"""Live paper trader for freshly graduated pump.fun tokens (no real money, no wallet).

Detects new PumpSwap pools via GeckoTerminal, prices them via DexScreener every
POLL seconds, and applies the rule in cache/params.json (written by backtest.py).
Usage: python3 live.py [hours]
"""
import csv
import json
import os
import sys
import time

from gt import ds_pairs, gt

CACHE = os.path.join(os.path.dirname(__file__), "cache")
STATE = os.path.join(CACHE, "live_state.json")
TRADES = os.path.join(CACHE, "live_trades.csv")
POLL = 30
COST = 0.01
SIZE = 0.10
MAX_OPEN = 10
MIN_LIQ = 5_000  # below this, treat the pool as rugged / untradeable


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def main():
    hours = float(sys.argv[1]) if len(sys.argv) > 1 else 6
    p = json.load(open(os.path.join(CACHE, "params.json")))
    st = json.load(open(STATE)) if os.path.exists(STATE) else {"cash": 100.0, "pos": {}, "watch": {}, "seen": []}
    seen = set(st["seen"])
    log(f"params={p} cash=${st['cash']:.2f}")
    end, last_scan = time.time() + hours * 3600, 0
    while time.time() < end:
        now = time.time()
        if now - last_scan >= 60:
            last_scan = now
            for page in (1, 2, 3):
                for pool in ((gt(f"/new_pools?page={page}") or {}).get("data") or []):
                    a = pool["attributes"]["address"]
                    if pool["relationships"]["dex"]["data"]["id"] == "pumpswap" and a not in seen:
                        seen.add(a)
                        st["watch"][a] = {"name": pool["attributes"]["name"], "t": now, "grad": None}

        addrs = list(st["watch"]) + list(st["pos"])
        data = ds_pairs(addrs) if addrs else {}
        for a in list(st["watch"]):
            w, d = st["watch"][a], data.get(a)
            if not d or not d.get("priceUsd"):
                if now - w["t"] > 3600:
                    del st["watch"][a]
                continue
            # graduated pump.fun tokens are SOL-quoted with mint addresses ending in "pump"
            if not d["baseToken"]["address"].endswith("pump") or d["quoteToken"]["symbol"] != "SOL":
                del st["watch"][a]
                continue
            price = float(d["priceUsd"])
            if w["grad"] is None:
                w["grad"] = price
            if now - w["t"] < p["delay"] * 300:
                continue
            del st["watch"][a]
            vol = (d.get("volume") or {}).get("h1", 0)
            liq = (d.get("liquidity") or {}).get("usd", 0)
            mom = price / w["grad"] - 1
            equity = st["cash"] + sum(x["stake"] * x["last"] / x["entry"] for x in st["pos"].values())
            stake = min(st["cash"], equity * SIZE)
            if mom < p["min_mom"] or vol < p["min_vol"] or liq < MIN_LIQ or len(st["pos"]) >= MAX_OPEN or stake < 1:
                continue
            entry = price * (1 + COST)
            st["cash"] -= stake
            st["pos"][a] = {"name": w["name"], "t": now, "entry": entry, "last": entry, "stake": stake}
            log(f"BUY  {w['name']:<24} ${stake:.2f} @ {price:.3g} mom={mom:+.0%} vol1h=${vol:,.0f}")

        for a in list(st["pos"]):
            x, d = st["pos"][a], data.get(a)
            if not d or not d.get("priceUsd"):
                continue
            price = float(d["priceUsd"])
            x["last"] = price
            liq = (d.get("liquidity") or {}).get("usd", 0)
            r = price / x["entry"] - 1
            why = ("SL" if r <= -p["sl"] else "TP" if r >= p["tp"] else
                   "TIME" if now - x["t"] >= p["hold"] * 300 else "RUG" if liq < MIN_LIQ else None)
            if why:
                net = price * (1 - COST) / x["entry"] - 1
                st["cash"] += x["stake"] * (1 + net)
                del st["pos"][a]
                log(f"SELL {x['name']:<24} {why:<4} {net:+.1%} cash=${st['cash']:.2f}")
                new = not os.path.exists(TRADES)
                with open(TRADES, "a", newline="") as f:
                    w = csv.writer(f)
                    if new:
                        w.writerow(["pool", "name", "opened", "closed", "reason", "net_return", "stake"])
                    w.writerow([a, x["name"], int(x["t"]), int(now), why, round(net, 4), round(x["stake"], 2)])

        st["seen"] = list(seen)[-5000:]
        json.dump(st, open(STATE, "w"))
        time.sleep(max(1, POLL - (time.time() - now)))
    equity = st["cash"] + sum(x["stake"] * x["last"] / x["entry"] for x in st["pos"].values())
    log(f"done. equity=${equity:.2f} open={len(st['pos'])}")


if __name__ == "__main__":
    main()
