"""Fetch and cache historical time series data for ML forecasting.

Data sources:
  - BTC prices: Yahoo Finance (BTC-USD ticker via yfinance — free, no API key)
  - Network hashrate: blockchain.info charts API
  - Network difficulty: blockchain.info charts API
  - Transaction fees: blockchain.info charts API
"""
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import requests

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / ".cache"
CACHE_TTL_HOURS = 24
REQUEST_TIMEOUT = 60


# ── Cache helpers ────────────────────────────────────────

def _ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(key: str) -> Path:
    _ensure_cache_dir()
    return CACHE_DIR / f"{key}.csv"


def _is_cache_fresh(key: str) -> bool:
    path = _cache_path(key)
    if not path.exists():
        return False
    mtime = datetime.fromtimestamp(path.stat().st_mtime)
    return (datetime.utcnow() - mtime) < timedelta(hours=CACHE_TTL_HOURS)


def _read_cache(key: str) -> Optional[pd.DataFrame]:
    if not _is_cache_fresh(key):
        return None
    try:
        df = pd.read_csv(_cache_path(key), parse_dates=["date"])
        return df
    except Exception:
        return None


def _write_cache(key: str, df: pd.DataFrame):
    _ensure_cache_dir()
    df.to_csv(_cache_path(key), index=False)


# ── BTC Price History (Yahoo Finance) ────────────────────

def fetch_btc_price_history() -> pd.DataFrame:
    """
    Fetch historical BTC/USD daily prices from Yahoo Finance.
    Returns DataFrame with columns: ['date', 'price'].
    """
    cached = _read_cache("btc_daily_prices")
    if cached is not None:
        logger.info("Using cached BTC price data (%d rows)", len(cached))
        return cached

    logger.info("Fetching BTC price history from Yahoo Finance (BTC-USD)...")

    try:
        import yfinance as yf

        ticker = yf.Ticker("BTC-USD")
        # Fetch maximum available history at daily interval
        hist = ticker.history(period="max", interval="1d")

        if hist.empty:
            raise RuntimeError("Yahoo Finance returned no data for BTC-USD")

        df = hist[["Close"]].reset_index()
        df.columns = ["date", "price"]
        df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None).dt.normalize()
        df = (
            df[["date", "price"]]
            .dropna()
            .drop_duplicates(subset=["date"])
            .sort_values("date")
            .reset_index(drop=True)
        )

    except ImportError:
        raise RuntimeError(
            "yfinance is not installed. Run: pip install yfinance"
        )
    except Exception as e:
        raise RuntimeError(
            f"Failed to fetch BTC prices from Yahoo Finance: {e}. "
            "Check internet connection or try again later."
        )

    if len(df) < 30:
        raise RuntimeError(f"Insufficient BTC price data: only {len(df)} days returned")

    _write_cache("btc_daily_prices", df)
    logger.info("Cached %d days of BTC price data", len(df))
    return df


def get_btc_monthly_prices() -> pd.Series:
    """
    Get monthly BTC prices (last trading price of each month).
    Returns pd.Series with DatetimeIndex (month-end) and price values.
    """
    df = fetch_btc_price_history()
    df = df.set_index("date")
    monthly = df["price"].resample("ME").last().dropna()
    return monthly


# ── Network Data (blockchain.info) ───────────────────────

def _fetch_blockchain_chart(chart_name: str, cache_key: str, value_col: str) -> pd.DataFrame:
    """Generic fetcher for blockchain.info chart API."""
    cached = _read_cache(cache_key)
    if cached is not None:
        logger.info("Using cached %s data (%d rows)", chart_name, len(cached))
        return cached

    logger.info("Fetching %s from blockchain.info...", chart_name)
    url = f"https://api.blockchain.info/charts/{chart_name}"
    params = {"timespan": "all", "format": "json", "cors": "true"}

    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to fetch {chart_name} data: {e}")

    data = resp.json()
    values = data.get("values", [])
    if not values:
        raise RuntimeError(f"No {chart_name} data returned from blockchain.info")

    df = pd.DataFrame(values)
    df.columns = ["timestamp", value_col]
    df["date"] = pd.to_datetime(df["timestamp"], unit="s").dt.normalize()
    df = df[["date", value_col]].sort_values("date").reset_index(drop=True)

    _write_cache(cache_key, df)
    logger.info("Cached %d rows of %s data", len(df), chart_name)
    return df


def fetch_network_hashrate_history() -> pd.DataFrame:
    """
    Fetch historical Bitcoin network hashrate.
    Returns DataFrame with ['date', 'hashrate_eh'] columns.
    """
    df = _fetch_blockchain_chart("hash-rate", "network_hashrate", "hashrate_raw")

    # blockchain.info returns hashrate — auto-detect unit and convert to EH/s
    recent_val = df["hashrate_raw"].iloc[-1]
    if recent_val > 1e15:
        # Likely H/s
        df["hashrate_eh"] = df["hashrate_raw"] / 1e18
    elif recent_val > 1e9:
        # Likely TH/s
        df["hashrate_eh"] = df["hashrate_raw"] / 1e6
    elif recent_val > 1e3:
        # Likely PH/s
        df["hashrate_eh"] = df["hashrate_raw"] / 1e3
    else:
        # Already in EH/s
        df["hashrate_eh"] = df["hashrate_raw"]

    return df[["date", "hashrate_eh"]].copy()


def fetch_difficulty_history() -> pd.DataFrame:
    """
    Fetch historical Bitcoin mining difficulty.
    Returns DataFrame with ['date', 'difficulty'] columns.
    """
    return _fetch_blockchain_chart("difficulty", "network_difficulty", "difficulty")


def fetch_fees_history() -> pd.DataFrame:
    """
    Fetch historical Bitcoin transaction fees.
    Returns DataFrame with ['date', 'fees_per_block_btc'] columns.
    """
    df = _fetch_blockchain_chart("transaction-fees", "network_fees", "total_daily_fees_btc")
    # Convert total daily fees to per-block (144 blocks per day)
    df["fees_per_block_btc"] = df["total_daily_fees_btc"] / 144.0
    return df[["date", "fees_per_block_btc"]].copy()


def get_network_monthly_data() -> pd.DataFrame:
    """
    Get monthly network data (hashrate, difficulty, fees).
    Returns DataFrame with DatetimeIndex and columns:
        ['hashrate_eh', 'difficulty', 'fees_per_block_btc']
    """
    hr = fetch_network_hashrate_history().set_index("date")
    diff = fetch_difficulty_history().set_index("date")
    fees = fetch_fees_history().set_index("date")

    monthly = pd.DataFrame({
        "hashrate_eh": hr["hashrate_eh"].resample("ME").mean(),
        "difficulty": diff["difficulty"].resample("ME").mean(),
        "fees_per_block_btc": fees["fees_per_block_btc"].resample("ME").mean(),
    }).dropna()

    # Filter out any rows with zero or negative values
    monthly = monthly[(monthly > 0).all(axis=1)]

    return monthly
