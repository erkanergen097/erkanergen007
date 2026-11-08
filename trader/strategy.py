"""Five 'agents' vote on each bar; a trade opens only on consensus (tweet-style stack).

Proxies for the tweet's agents using only exchange data:
  TREND    - EMA50 above EMA200 and price above EMA200
  MOMENTUM - RSI in a healthy bullish band and positive 24-bar return
  SMART$   - taker-buy share of volume elevated while volume is above average (whale proxy)
  BREAKOUT - close above the prior N-bar high
  RISK     - volatility (ATR%) not extreme, RSI not overbought
"""


def ema(xs, n):
    k, out, e = 2 / (n + 1), [], xs[0]
    for x in xs:
        e = x * k + e * (1 - k)
        out.append(e)
    return out


def rsi(closes, n=14):
    out, ag, al = [50.0], 0.0, 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        g, l = max(d, 0), max(-d, 0)
        ag = (ag * (n - 1) + g) / n
        al = (al * (n - 1) + l) / n
        out.append(100 if al == 0 else 100 - 100 / (1 + ag / al))
    return out


def atr(bars, n=14):
    out, a = [], bars[0]["h"] - bars[0]["l"]
    for i, b in enumerate(bars):
        pc = bars[i - 1]["c"] if i else b["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        a = (a * (n - 1) + tr) / n
        out.append(a)
    return out


def votes(bars, p):
    c = [b["c"] for b in bars]
    e50, e200, r, a = ema(c, 50), ema(c, 200), rsi(c), atr(bars)
    vol_ma = ema([b["v"] for b in bars], 48)
    flow = ema([b["tbv"] / b["v"] if b["v"] else 0.5 for b in bars], 6)
    n = p["breakout"]
    out = []
    for i, b in enumerate(bars):
        if i < 200:
            out.append(0)
            continue
        prior_high = max(x["h"] for x in bars[i - n:i])
        atr_pct = a[i] / c[i]
        agents = [
            e50[i] > e200[i] and c[i] > e200[i],
            50 < r[i] < 75 and c[i] > c[i - 24],
            flow[i] > p["flow"] and b["v"] > vol_ma[i],
            c[i] > prior_high,
            atr_pct < p["max_atr"] and r[i] < 78,
        ]
        out.append(sum(agents))
    return out, a
