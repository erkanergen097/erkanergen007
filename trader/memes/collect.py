"""Collect recently graduated pump.fun tokens (PumpSwap pools) and their 5m candles.

GeckoTerminal only lists PumpSwap pools ranked by 24h volume / tx count, so this
sample is biased toward tokens that were still trading; treat backtests on it as
an optimistic upper bound.
"""
import json
import os
import sys
import time
from datetime import datetime

from gt import gt, ohlcv_5m

OUT = os.path.join(os.path.dirname(__file__), "cache", "graduated.json")
MAX_AGE_H = float(sys.argv[1]) if len(sys.argv) > 1 else 48


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    db = json.load(open(OUT)) if os.path.exists(OUT) else {}
    pools = {}
    for sort in ("h24_volume_usd_desc", "h24_tx_count_desc"):
        for page in range(1, 11):
            d = gt(f"/dexes/pumpswap/pools?sort={sort}&page={page}")
            for p in (d or {}).get("data", []):
                a = p["attributes"]
                created = datetime.fromisoformat(a["pool_created_at"].replace("Z", "+00:00")).timestamp()
                if time.time() - created <= MAX_AGE_H * 3600:
                    pools[a["address"]] = {"name": a["name"], "created": created}
    todo = [a for a in pools if a not in db]
    print(f"{len(pools)} graduated pools <= {MAX_AGE_H}h old, {len(todo)} to fetch", flush=True)
    for i, a in enumerate(todo, 1):
        candles = ohlcv_5m(a)
        db[a] = dict(pools[a], candles=candles)
        if i % 10 == 0 or i == len(todo):
            json.dump(db, open(OUT, "w"))
            print(f"  {i}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()
