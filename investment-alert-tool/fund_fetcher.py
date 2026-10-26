"""
投資信託データ取得モジュール
みんかぶ投信 (itf.minkabu.jp) から基準価額・履歴を取得
"""

import json
import re
import urllib.request
import pandas as pd
from datetime import datetime, timedelta, timezone

_JST = timezone(timedelta(hours=9))

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/javascript, application/javascript, */*; q=0.01",
    "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
    "Referer": "https://itf.minkabu.jp/",
}


def fetch_fund_data(fund_code: str, days: int = 365) -> pd.DataFrame:
    period_type = "monthly" if days > 365 else "daily"
    df = _fetch_minkabu_history(fund_code, period_type)
    if not df.empty:
        return df
    return _fetch_minkabu_current(fund_code)


def _fetch_minkabu_history(fund_code: str, period_type: str = "daily") -> pd.DataFrame:
    """みんかぶ投信のJSONP APIから基準価額履歴を取得"""
    url = f"https://itf.minkabu.jp/json/funds/{fund_code}/get_line_{period_type}_json?callback=_cb"
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
    except Exception:
        return pd.DataFrame()

    m = re.match(r"^[^(]+\((.+)\)\s*$", body.strip(), re.DOTALL)
    if not m:
        return pd.DataFrame()

    try:
        obj = json.loads(m.group(1))
    except Exception:
        return pd.DataFrame()

    data = obj.get("data", [])
    if not data:
        return pd.DataFrame()

    rows = []
    for item in data:
        # item: [timestamp_ms, open_or_same, dividend_or_null, total_assets_or_null, close]
        ts_ms = item[0]
        close = item[4]
        if close is None:
            continue
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=_JST).date()
        rows.append((str(dt), float(close)))

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["Date", "Close"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df["Open"] = df["Close"]
    df["High"] = df["Close"]
    df["Low"] = df["Close"]
    df["Volume"] = 0
    return df


def _fetch_minkabu_current(fund_code: str) -> pd.DataFrame:
    """フォールバック: メタdescriptionから当日の基準価額のみ取得"""
    url = f"https://itf.minkabu.jp/fund/{fund_code}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                **_HEADERS,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8")
    except Exception:
        return pd.DataFrame()

    m = re.search(
        r"基準価額([0-9,]+)円、前日比([-−+]?[0-9,]+)（([+-]?[0-9.]+)%）",
        html,
    )
    if not m:
        return pd.DataFrame()

    price = float(m.group(1).replace(",", ""))
    change_amount = float(m.group(2).replace("−", "-").replace(",", ""))
    prev_price = price - change_amount

    date_m = re.search(r"基準価額（(\d{1,2})/(\d{1,2})）", html)
    if date_m:
        now = datetime.now()
        month, day = int(date_m.group(1)), int(date_m.group(2))
        try:
            nav_date = datetime(now.year, month, day)
            if nav_date > now + timedelta(days=1):
                nav_date = datetime(now.year - 1, month, day)
        except ValueError:
            nav_date = now
    else:
        nav_date = datetime.now()

    prev_date = nav_date - timedelta(days=1)
    rows = [
        (prev_date.strftime("%Y-%m-%d"), prev_price),
        (nav_date.strftime("%Y-%m-%d"), price),
    ]
    df = pd.DataFrame(rows, columns=["Date", "Close"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    df["Open"] = df["Close"]
    df["High"] = df["Close"]
    df["Low"] = df["Close"]
    df["Volume"] = 0
    return df
