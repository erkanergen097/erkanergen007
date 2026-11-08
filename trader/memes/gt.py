"""Rate-limited GeckoTerminal / DexScreener client (free tiers, no API key)."""
import json
import time
import urllib.request

GT = "https://api.geckoterminal.com/api/v2/networks/solana"
DS = "https://api.dexscreener.com/latest/dex/pairs/solana"
GT_SPACING = 6.5  # free GeckoTerminal tier is ~10 req/min in practice
_last = [0.0]


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def gt(path):
    for attempt in range(6):
        wait = GT_SPACING - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            return _fetch(GT + path)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(20 * (attempt + 1))
                continue
            if e.code in (400, 404):
                return None
            time.sleep(5)
        except Exception:
            time.sleep(5)
    return None


def ds_pairs(addresses):
    """Current DexScreener data for up to 30 pair addresses."""
    out = {}
    for i in range(0, len(addresses), 30):
        try:
            data = _fetch(DS + "/" + ",".join(addresses[i:i + 30]))
        except Exception:
            continue
        for p in data.get("pairs") or []:
            out[p["pairAddress"]] = p
    return out


def ohlcv_5m(pool):
    """5-minute candles oldest-first: [ts, o, h, l, c, vol_usd]."""
    d = gt(f"/pools/{pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd")
    if not d:
        return []
    return sorted(d["data"]["attributes"]["ohlcv_list"])
