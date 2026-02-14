"""BTC price curve generation engine — deterministic + ML forecasting."""
import logging
import math
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def generate_btc_price_curve(
    start_price: float,
    months: int,
    anchor_points: Dict[int, float],  # year_index -> target price
    interpolation_type: str = "linear",
    custom_monthly_prices: Optional[List[float]] = None,
    volatility_enabled: bool = False,
    volatility_seed: int = 42,
) -> List[float]:
    """
    Generate a deterministic monthly BTC price curve.

    Args:
        start_price: Starting BTC price in USD.
        months: Number of months to generate (default 120 = 10 years).
        anchor_points: Dict mapping year index (0-10) to target price.
        interpolation_type: 'linear', 'step', or 'custom'.
        custom_monthly_prices: If interpolation_type='custom', use these directly.
        volatility_enabled: If True, apply deterministic pseudo-noise.
        volatility_seed: Seed for deterministic noise generation.

    Returns:
        List of monthly prices (length = months).
    """
    if interpolation_type == "custom" and custom_monthly_prices:
        prices = list(custom_monthly_prices[:months])
        # Pad if shorter
        while len(prices) < months:
            prices.append(prices[-1] if prices else start_price)
        return _apply_volatility(prices, volatility_enabled, volatility_seed)

    # Build month-indexed anchor map from year-indexed anchors
    month_anchors: Dict[int, float] = {}
    for year_idx, price in sorted(anchor_points.items()):
        year_idx = int(year_idx)
        month_idx = year_idx * 12
        if month_idx < months:
            month_anchors[month_idx] = price
        elif month_idx == months:
            month_anchors[months - 1] = price

    # Ensure month 0 exists
    if 0 not in month_anchors:
        month_anchors[0] = start_price

    sorted_months = sorted(month_anchors.keys())
    prices = []

    if interpolation_type == "step":
        # Step function: hold price until next anchor
        for m in range(months):
            # Find the latest anchor at or before month m
            val = start_price
            for am in sorted_months:
                if am <= m:
                    val = month_anchors[am]
                else:
                    break
            prices.append(val)
    else:
        # Linear interpolation (default)
        for m in range(months):
            # Find bounding anchors
            lower_m = 0
            upper_m = months - 1
            lower_p = month_anchors.get(0, start_price)
            upper_p = month_anchors.get(months - 1, lower_p)

            for am in sorted_months:
                if am <= m:
                    lower_m = am
                    lower_p = month_anchors[am]
                if am >= m:
                    upper_m = am
                    upper_p = month_anchors[am]
                    break

            if upper_m == lower_m:
                prices.append(lower_p)
            else:
                t = (m - lower_m) / (upper_m - lower_m)
                interpolated = lower_p + t * (upper_p - lower_p)
                prices.append(round(interpolated, 2))

    return _apply_volatility(prices, volatility_enabled, volatility_seed)


def _apply_volatility(
    prices: List[float],
    enabled: bool,
    seed: int
) -> List[float]:
    """Apply deterministic pseudo-noise to price curve."""
    if not enabled:
        return [round(p, 2) for p in prices]

    result = []
    for i, price in enumerate(prices):
        # Deterministic pseudo-random based on seed + month index
        # Using a simple hash-based approach for reproducibility
        noise_val = _deterministic_noise(seed, i)
        # Apply ±5% max noise scaled by a factor
        factor = 1.0 + noise_val * 0.05
        result.append(round(price * factor, 2))
    return result


def _deterministic_noise(seed: int, index: int) -> float:
    """
    Generate a deterministic noise value in [-1, 1] from seed + index.
    Uses multiple rounds of hashing to avoid periodic patterns.
    """
    # Combine seed and index with bit mixing to avoid linear patterns
    x = seed ^ (index * 2654435761)  # Knuth's multiplicative hash
    
    # Multiple rounds of mixing to break periodicity
    for _ in range(3):
        x = ((x ^ (x >> 16)) * 0x85ebca6b) & 0xFFFFFFFF
        x = ((x ^ (x >> 13)) * 0xc2b2ae35) & 0xFFFFFFFF
        x = (x ^ (x >> 16)) & 0xFFFFFFFF
    
    # Map to [-1, 1]
    return (x / 0xFFFFFFFF) * 2.0 - 1.0


# ──────────────────────────────────────────────────────────
# ML Forecasting Mode
# ──────────────────────────────────────────────────────────

def generate_btc_price_curve_ml(
    model_type: str = "auto_arima",
    forecast_months: int = 120,
    confidence: float = 0.95,
) -> Tuple[List[float], List[float], List[float], dict]:
    """
    Generate a BTC price curve using ML time-series forecasting.

    Fetches historical BTC/USD monthly prices, trains the specified model,
    and produces a forecast with confidence intervals.

    Args:
        model_type: 'auto_arima', 'holt_winters', or 'sarimax'.
        forecast_months: Number of months to forecast (default 120 = 10 years).
        confidence: Confidence interval (0.80, 0.90, 0.95).

    Returns:
        (monthly_prices, lower_bound, upper_bound, model_info)
    """
    from .data_fetcher import get_btc_monthly_prices
    from .ts_models import run_forecast

    logger.info(
        "Generating BTC price curve (ML): model=%s, months=%d, CI=%.2f",
        model_type, forecast_months, confidence,
    )

    # 1. Fetch & prepare historical monthly prices
    monthly_prices = get_btc_monthly_prices()

    if len(monthly_prices) < 24:
        raise ValueError(
            f"Insufficient historical data for ML forecasting: "
            f"got {len(monthly_prices)} months, need >= 24"
        )

    # 2. Run the forecast model
    forecast, lower, upper, model_info = run_forecast(
        series=monthly_prices,
        model_type=model_type,
        periods=forecast_months,
        confidence=confidence,
        use_log=True,  # BTC prices grow exponentially → log transform
    )

    # 3. Enrich model_info with training metadata
    model_info["training_months"] = len(monthly_prices)
    model_info["training_start"] = str(monthly_prices.index[0].date())
    model_info["training_end"] = str(monthly_prices.index[-1].date())
    model_info["last_historical_price"] = round(float(monthly_prices.iloc[-1]), 2)
    model_info["confidence_interval"] = confidence
    model_info["forecast_months"] = forecast_months

    return (
        [round(float(v), 2) for v in forecast],
        [round(float(v), 2) for v in lower],
        [round(float(v), 2) for v in upper],
        model_info,
    )
