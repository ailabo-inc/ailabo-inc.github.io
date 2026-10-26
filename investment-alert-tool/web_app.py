"""
投資アラートツール — Webアプリ版
iPhoneのSafariからアクセスできるWebインターフェース
"""

import json
import math
import os

import pandas as pd
from flask import Flask, render_template

from config import FUNDS, PORTFOLIO, WATCHLIST
from fetcher import fetch_stock_data, fetch_ticker_info
from fund_fetcher import fetch_fund_data
from indicators import add_all_indicators
from portfolio import Portfolio
from signals import detect_signals, summarize_signals

app = Flask(__name__)
portfolio = Portfolio(PORTFOLIO)

# ── ディスクキャッシュ（Renderのサーバー再起動後も最終データを保持）──────
_CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
_SCAN_CACHE_FILE = os.path.join(_CACHE_DIR, "scan_cache.json")
_FUND_CACHE_FILE = os.path.join(_CACHE_DIR, "fund_cache.json")
os.makedirs(_CACHE_DIR, exist_ok=True)


def _load_cache(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(path: str, data: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


_scan_cache: dict = _load_cache(_SCAN_CACHE_FILE)
_fund_cache: dict = _load_cache(_FUND_CACHE_FILE)


def _safe_float(val) -> float | None:
    """NaN / None を None に変換"""
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


# ── API エンドポイント ────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/watchlist")
def api_watchlist():
    """ウォッチリストを返す"""
    return {"watchlist": WATCHLIST}


@app.route("/api/funds")
def api_funds():
    """投資信託リストを返す"""
    return {"funds": FUNDS}


@app.route("/api/fund-scan/<code>")
def api_fund_scan(code: str):
    """投資信託1本の基準価額・損益・チャートデータを返す"""
    code = code.upper()
    fund = next((f for f in FUNDS if f["code"].upper() == code), None)
    if not fund:
        return {"error": "ファンドが見つかりません"}, 404

    try:
        fetch_code = fund.get("fetch_code", code)
        df = fetch_fund_data(fetch_code)
        if df.empty or len(df) < 2:
            return {"error": "データ不足"}, 400

        close = float(df["Close"].iloc[-1])
        prev_close = float(df["Close"].iloc[-2])
        change_pct = (close - prev_close) / prev_close * 100

        avg_cost = fund["avg_cost"]   # 円/10,000口
        kuchi = fund["kuchi"]
        pnl = round((close - avg_cost) / 10000 * kuchi, 0)
        pnl_pct = round((close - avg_cost) / avg_cost * 100, 1)

        result = {
            "code": code,
            "name": fund["name"],
            "price": round(close, 0),
            "change_pct": round(change_pct, 2),
            "kuchi": kuchi,
            "avg_cost": avg_cost,
            "cost": fund.get("cost", round(avg_cost / 10000 * kuchi, 0)),
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "chart": {
                "dates": [d.strftime("%m/%d") for d in df.index[-60:]],
                "closes": [round(float(v), 0) for v in df["Close"].iloc[-60:]],
            },
        }
        # キャッシュに保存（ディスクにも永続化）
        _fund_cache[code] = result
        _save_cache(_FUND_CACHE_FILE, _fund_cache)
        return result
    except Exception as exc:
        # キャッシュがあれば返す（サーバー再起動後・休場日など）
        if code in _fund_cache:
            cached = dict(_fund_cache[code])
            cached["cached"] = True
            return cached
        return {"error": str(exc)}, 500


@app.route("/api/fund-chart/<code>/<period>")
def api_fund_chart(code: str, period: str):
    """投資信託チャートデータ（期間指定）"""
    code = code.upper()
    period_days = {"3mo": 90, "1y": 365, "3y": 1095}
    if period not in period_days:
        return {"error": "無効な期間"}, 400

    fund = next((f for f in FUNDS if f["code"].upper() == code), {})
    try:
        fetch_code = fund.get("fetch_code", code)
        df = fetch_fund_data(fetch_code, days=period_days[period])
        if df.empty:
            return {"error": "データ不足"}, 400

        date_fmt = "%y/%m" if period == "3y" else "%m/%d"
        return {
            "code": code,
            "period": period,
            "chart": {
                "dates": [d.strftime(date_fmt) for d in df.index],
                "closes": [round(float(v), 0) for v in df["Close"]],
                "avg_cost": fund.get("avg_cost"),
            },
        }
    except Exception as exc:
        return {"error": str(exc)}, 500


@app.route("/api/fx")
def api_fx():
    """USD/JPY リアルタイムレートを返す"""
    try:
        import yfinance as yf
        ticker = yf.Ticker("USDJPY=X")
        rate = ticker.fast_info.last_price
        return {"usdjpy": round(float(rate), 2)}
    except Exception as exc:
        return {"error": str(exc), "usdjpy": 150.0}, 200


@app.route("/api/news/<symbol>")
def api_news(symbol: str):
    """ニュースを取得する（Google News日本語）"""
    import urllib.request
    import urllib.parse
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    symbol = symbol.upper()
    name = next((w["name"] for w in WATCHLIST if w["symbol"].upper() == symbol), symbol)
    query = urllib.parse.quote(f"{name} 株")
    url = f"https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        channel = root.find("channel")
        items = []
        for item in (channel.findall("item") if channel is not None else [])[:6]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub = item.findtext("pubDate", "")
            try:
                dt = parsedate_to_datetime(pub)
                pub_fmt = dt.strftime("%m/%d %H:%M")
            except Exception:
                pub_fmt = pub[:16]
            items.append({"title": title, "link": link, "pub": pub_fmt})
        return {"news": items, "symbol": symbol}
    except Exception as exc:
        return {"error": str(exc), "news": []}, 200


@app.route("/api/scan/<symbol>")
def api_scan(symbol: str):
    """1銘柄をスキャンして価格・指標・シグナルを返す"""
    symbol = symbol.upper()
    name = next((w["name"] for w in WATCHLIST if w["symbol"].upper() == symbol), symbol)

    try:
        df = fetch_stock_data(symbol, period="6mo")
        if df.empty or len(df) < 30:
            return {"error": "データ不足（最低30日分が必要）", "symbol": symbol}, 400

        df = add_all_indicators(df)
        latest = df.iloc[-1]
        prev = df.iloc[-2]

        close = float(latest["Close"])
        prev_close = float(prev["Close"])
        change_pct = (close - prev_close) / prev_close * 100

        signals = detect_signals(df, symbol)
        summary = summarize_signals(signals)

        current_prices = {symbol: close}
        pnl_map = portfolio.get_pnl(current_prices)
        pos = pnl_map.get(symbol)

        result = {
            "symbol": symbol,
            "name": name,
            "price": round(close, 2),
            "change_pct": round(change_pct, 2),
            "rsi": _safe_float(latest.get("RSI")),
            "macd": _safe_float(latest.get("MACD")),
            "macd_signal": _safe_float(latest.get("MACD_Signal")),
            "sma5": _safe_float(latest.get("SMA_5")),
            "sma25": _safe_float(latest.get("SMA_25")),
            "bb_upper": _safe_float(latest.get("BB_Upper")),
            "bb_lower": _safe_float(latest.get("BB_Lower")),
            "stoch_k": _safe_float(latest.get("Stoch_K")),
            "signals": [
                {"type": s.signal_type, "reason": s.reason, "strength": s.strength}
                for s in signals
            ],
            "summary": summary,
            "chart": {
                "dates": [d.strftime("%m/%d") for d in df.index[-60:]],
                "closes": [round(float(v), 2) for v in df["Close"].iloc[-60:]],
                "sma25": [_safe_float(v) for v in df["SMA_25"].iloc[-60:]],
            },
        }

        if pos:
            result["portfolio"] = {
                "shares": pos.shares,
                "avg_cost": round(pos.avg_cost, 2),
                "pnl": round(pos.pnl, 0),
                "pnl_pct": round(pos.pnl_pct, 1),
            }

        # キャッシュに保存（ディスクにも永続化）
        _scan_cache[symbol] = result
        _save_cache(_SCAN_CACHE_FILE, _scan_cache)
        return result

    except Exception as exc:
        # キャッシュがあれば返す（サーバー再起動後・市場閉鎖時など）
        if symbol in _scan_cache:
            cached = dict(_scan_cache[symbol])
            cached["cached"] = True
            return cached
        return {"error": str(exc), "symbol": symbol}, 500


@app.route("/api/chart/<symbol>/<period>")
def api_chart(symbol: str, period: str):
    """指定期間のチャートデータを返す (3mo / 1y / 3y)"""
    symbol = symbol.upper()
    period_map = {"3mo": "6mo", "1y": "1y", "3y": "3y"}
    if period not in period_map:
        return {"error": "無効な期間"}, 400

    fetch_period = period_map[period]
    date_fmt = "%y/%m" if period == "3y" else "%m/%d"

    try:
        df = fetch_stock_data(symbol, period=fetch_period)
        if df.empty or len(df) < 10:
            return {"error": "データ不足"}, 400

        df = add_all_indicators(df)

        if period == "3mo":
            df = df.iloc[-65:]

        avg_cost = next(
            (p["avg_cost"] for p in PORTFOLIO if p["symbol"].upper() == symbol), None
        )

        return {
            "symbol": symbol,
            "period": period,
            "chart": {
                "dates": [d.strftime(date_fmt) for d in df.index],
                "closes": [round(float(v), 2) for v in df["Close"]],
                "sma25": [_safe_float(v) for v in df["SMA_25"]],
                "avg_cost": avg_cost,
            },
        }
    except Exception as exc:
        return {"error": str(exc)}, 500


# ── 起動 ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
