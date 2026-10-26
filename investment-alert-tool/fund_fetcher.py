"""
投資信託データ取得モジュール
Yahoo Finance Japan から基準価額をスクレイピング
"""

import re
import time
import pandas as pd
import urllib.request
from datetime import datetime, timedelta


def fetch_fund_data(fund_code: str, days: int = 365) -> pd.DataFrame:
    return _fetch_yahoo_japan(fund_code, days)


def _fetch_yahoo_japan(fund_code: str, days: int) -> pd.DataFrame:
    """Yahoo Finance Japan の投資信託ページから基準価額を取得"""
    target_start = datetime.now() - timedelta(days=days + 30)
    all_rows = []

    for page in range(1, 30):
        url = f"https://finance.yahoo.co.jp/quote/{fund_code}/history?page={page}"
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
            break

        rows = _parse_table(html)
        if not rows:
            break
        all_rows.extend(rows)

        # 十分な期間のデータが揃ったら終了
        try:
            oldest = datetime.strptime(all_rows[-1][0], "%Y-%m-%d")
            if oldest <= target_start:
                break
        except Exception:
            pass

        # 次ページがなければ終了
        if f"page={page + 1}" not in html:
            break
        time.sleep(0.3)

    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows, columns=["Date", "Close"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    df = df[~df.index.duplicated()]
    df["Open"] = df["Close"]
    df["High"] = df["Close"]
    df["Low"] = df["Close"]
    df["Volume"] = 0
    return df


def _parse_table(html: str):
    """HTML から 日付 / 基準価額 ペアを抽出（新旧フォーマット対応）"""
    rows = []
    tr_re = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL)
    td_re = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL)
    tag_re = re.compile(r"<[^>]+>")
    # 新フォーマット: 2026/10/23
    date_new = re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})")
    # 旧フォーマット: 2026年07月10日
    date_old = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")

    for tr in tr_re.finditer(html):
        cells = [tag_re.sub("", c).strip() for c in td_re.findall(tr.group(1))]
        if len(cells) < 2:
            continue

        date_str = None
        dm = date_new.search(cells[0])
        if dm:
            date_str = f"{dm.group(1)}-{dm.group(2).zfill(2)}-{dm.group(3).zfill(2)}"
        else:
            dm = date_old.search(cells[0])
            if dm:
                date_str = f"{dm.group(1)}-{dm.group(2).zfill(2)}-{dm.group(3).zfill(2)}"

        if not date_str:
            continue
        try:
            price = float(cells[1].replace(",", "").replace("円", "").strip())
            rows.append((date_str, price))
        except (ValueError, TypeError):
            continue
    return rows
