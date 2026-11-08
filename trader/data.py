"""Binance public kline downloader with a local CSV cache."""
import csv
import json
import os
import time
import urllib.request

BASE = "https://data-api.binance.vision/api/v3/klines"
CACHE = os.path.join(os.path.dirname(__file__), "cache")


def _get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(1 + attempt)
    raise RuntimeError(f"download failed: {url}")


def load(symbol, interval="1h", days=1095):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{symbol}_{interval}_{days}.csv")
    if not os.path.exists(path):
        end = int(time.time() * 1000)
        start = end - days * 86_400_000
        rows = []
        while start < end:
            batch = _get(f"{BASE}?symbol={symbol}&interval={interval}&startTime={start}&limit=1000")
            if not batch:
                break
            rows.extend(batch)
            start = batch[-1][0] + 1
        rows = rows[:-1]  # drop the still-open candle
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            for k in rows:
                w.writerow([k[0], k[1], k[2], k[3], k[4], k[5], k[9]])
    bars = []
    with open(path) as f:
        for t, o, h, l, c, v, tbv in csv.reader(f):
            bars.append({"t": int(t), "o": float(o), "h": float(h), "l": float(l),
                         "c": float(c), "v": float(v), "tbv": float(tbv)})
    return bars
