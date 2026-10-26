"""
投資信託データ取得モジュール
みんかぶ投信 (itf.minkabu.jp) から基準価額を取得
"""

import re
import urllib.request
import pandas as pd
from datetime import datetime, timedelta


def fetch_fund_data(fund_code: str, days: int = 365) -> pd.DataFrame:
    return _fetch_minkabu(fund_code)


def _fetch_minkabu(fund_code: str) -> pd.DataFrame:
    """みんかぶ投信から基準価額・前日比を取得してDataFrameを返す"""
    url = f"https://itf.minkabu.jp/fund/{fund_code}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8")
    except Exception:
        return pd.DataFrame()

    # メタdescription から「基準価額XXXXX円、前日比YYY（Z.ZZ%）」を抽出
    m = re.search(
        r"基準価額([0-9,]+)円、前日比([-−+]?[0-9,]+)（([+-]?[0-9.]+)%）",
        html,
    )
    if not m:
        return pd.DataFrame()

    price = float(m.group(1).replace(",", ""))
    change_amount_str = m.group(2).replace("−", "-").replace(",", "")
    change_amount = float(change_amount_str)
    prev_price = price - change_amount

    # 日付を取得（ページ内の「基準価額（MM/DD）」形式）
    date_m = re.search(r"基準価額（(\d{1,2})/(\d{1,2})）", html)
    if date_m:
        now = datetime.now()
        month = int(date_m.group(1))
        day = int(date_m.group(2))
        # 月が未来なら前年として扱う
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
