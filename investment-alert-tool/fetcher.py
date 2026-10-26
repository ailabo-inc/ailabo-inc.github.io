"""
株価データ取得モジュール
yfinance を使って米国株・日本株・ETFのデータを取得します
"""

import time
import pandas as pd
import yfinance as yf
from typing import Optional


def fetch_stock_data(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """
    ヒストリカルデータを取得する（リトライあり）

    Args:
        symbol: 銘柄コード (例: AAPL, 7203.T)
        period: 取得期間 (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max)
        interval: 足の種類 (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)

    Returns:
        DataFrame: Open, High, Low, Close, Volume を含むデータフレーム
    """
    for attempt in range(3):
        try:
            # 方法1: ticker.history()
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=interval)
            if not df.empty:
                if df.index.tz is not None:
                    df.index = df.index.tz_localize(None)
                df = df.dropna(subset=["Close"])
                if not df.empty:
                    return df

            # 方法2: yf.download() にフォールバック
            df = yf.download(symbol, period=period, interval=interval,
                             progress=False, auto_adjust=True)
            if not df.empty:
                if df.index.tz is not None:
                    df.index = df.index.tz_localize(None)
                # MultiIndex の場合フラット化
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                df = df.dropna(subset=["Close"])
                if not df.empty:
                    return df
        except Exception:
            pass
        if attempt < 2:
            time.sleep(2)
    return pd.DataFrame()


def fetch_ticker_info(symbol: str) -> dict:
    """
    銘柄の基本情報を取得する

    Returns:
        dict: 銘柄名、業種、時価総額、PER、配当利回りなど
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return {
            "name": info.get("longName") or info.get("shortName", symbol),
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", "N/A"),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "dividend_yield": info.get("dividendYield"),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
            "analyst_target": info.get("targetMeanPrice"),
        }
    except Exception:
        return {"name": symbol}


def get_current_price(symbol: str) -> Optional[float]:
    """最新の終値を取得する"""
    df = fetch_stock_data(symbol, period="5d")
    if df.empty:
        return None
    return float(df["Close"].iloc[-1])
