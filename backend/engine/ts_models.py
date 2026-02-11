"""Time series forecasting models for BTC price and network metrics.

Supported models:
  - auto_arima: Automatic ARIMA order selection via stepwise AIC search (statsmodels)
  - holt_winters: Exponential Smoothing with trend + seasonality (statsmodels)
  - sarimax: Seasonal ARIMA with configurable orders (statsmodels)

All models support log-transformation for exponentially growing series
and return forecasts with confidence intervals.
"""
import logging
import warnings
from typing import Dict, Any, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def _ensure_positive(arr: np.ndarray) -> np.ndarray:
    """Clamp values to a small positive floor (avoid negatives in price/hashrate)."""
    return np.maximum(arr, 0.01)


# ── Auto ARIMA (pure statsmodels — no pmdarima) ─────────

def forecast_auto_arima(
    series: pd.Series,
    periods: int,
    confidence: float = 0.95,
    use_log: bool = True,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Forecast using automatic ARIMA order selection.

    Performs a stepwise search over (p,d,q)(P,D,Q,12) orders using AIC,
    implemented entirely with statsmodels SARIMAX (no pmdarima dependency).

    Args:
        series: Historical time series (pd.Series, ideally with DatetimeIndex).
        periods: Number of future periods to forecast.
        confidence: Confidence level for prediction intervals (0.80, 0.90, 0.95).
        use_log: Apply log-transform before fitting (recommended for exponential growth).

    Returns:
        (forecast, lower_bound, upper_bound, model_info)
    """
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    train = series.copy().astype(float)
    if use_log:
        train = np.log(train.clip(lower=1.0))

    # Stepwise search over common ARIMA orders
    # Non-seasonal: p in {0,1,2}, d in {0,1}, q in {0,1,2}
    # Seasonal:     P in {0,1}, D in {0,1}, Q in {0,1}, m=12
    best_aic = np.inf
    best_order = (1, 1, 1)
    best_seasonal = (0, 0, 0, 12)
    best_model = None

    candidate_orders = [
        # (p, d, q)
        (0, 1, 0), (1, 1, 0), (0, 1, 1), (1, 1, 1),
        (2, 1, 0), (0, 1, 2), (2, 1, 1), (1, 1, 2), (2, 1, 2),
        (1, 0, 0), (0, 0, 1), (1, 0, 1),
    ]

    candidate_seasonal = [
        # (P, D, Q, m)
        (0, 0, 0, 12),
        (1, 0, 0, 12),
        (0, 0, 1, 12),
        (1, 0, 1, 12),
        (0, 1, 0, 12),
        (1, 1, 0, 12),
        (0, 1, 1, 12),
        (1, 1, 1, 12),
    ]

    # Only search seasonal if enough data (>= 3 years)
    if len(train) < 36:
        candidate_seasonal = [(0, 0, 0, 12)]

    logger.info("Auto ARIMA: searching %d order combinations...",
                len(candidate_orders) * len(candidate_seasonal))

    for order in candidate_orders:
        for seasonal in candidate_seasonal:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model = SARIMAX(
                        train,
                        order=order,
                        seasonal_order=seasonal,
                        enforce_stationarity=False,
                        enforce_invertibility=False,
                    ).fit(disp=False, maxiter=100)

                if model.aic < best_aic:
                    best_aic = model.aic
                    best_order = order
                    best_seasonal = seasonal
                    best_model = model
            except Exception:
                continue

    if best_model is None:
        raise ValueError("Auto ARIMA failed: no valid model found for the data")

    logger.info("Auto ARIMA: best order=%s seasonal=%s AIC=%.2f",
                best_order, best_seasonal, best_aic)

    # Generate forecast
    alpha = 1.0 - confidence
    pred = best_model.get_forecast(steps=periods)
    forecast = pred.predicted_mean
    conf_int = pred.conf_int(alpha=alpha)

    if use_log:
        forecast = np.exp(forecast.values)
        lower = np.exp(conf_int.iloc[:, 0].values)
        upper = np.exp(conf_int.iloc[:, 1].values)
    else:
        forecast = forecast.values
        lower = conf_int.iloc[:, 0].values
        upper = conf_int.iloc[:, 1].values

    forecast = _ensure_positive(np.asarray(forecast))
    lower = _ensure_positive(np.asarray(lower))
    upper = _ensure_positive(np.asarray(upper))

    metrics = {
        "model": "auto_arima",
        "order": list(best_order),
        "seasonal_order": list(best_seasonal),
        "aic": round(float(best_aic), 2),
        "models_evaluated": len(candidate_orders) * len(candidate_seasonal),
        "log_transformed": use_log,
    }

    return forecast, lower, upper, metrics


# ── Holt-Winters ─────────────────────────────────────────

def forecast_holt_winters(
    series: pd.Series,
    periods: int,
    confidence: float = 0.95,
    use_log: bool = True,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Forecast using Holt-Winters Exponential Smoothing.

    Supports additive trend and seasonal components.
    Prediction intervals are estimated from residual std with expanding uncertainty.
    """
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    from scipy.stats import norm

    train = series.copy().astype(float)
    if use_log:
        train = np.log(train.clip(lower=1.0))

    # Need at least 2 full seasonal cycles (24 months) for seasonal decomposition
    has_seasonal = len(train) >= 24

    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal="add" if has_seasonal else None,
        seasonal_periods=12 if has_seasonal else None,
        initialization_method="estimated",
    ).fit(optimized=True)

    forecast = model.forecast(periods)

    # Estimate prediction intervals from residuals
    residuals = model.resid.dropna()
    std = float(residuals.std())
    z = norm.ppf((1 + confidence) / 2)

    # Uncertainty fans out with sqrt(time)
    steps = np.arange(1, periods + 1)
    margin = z * std * np.sqrt(steps / 12.0)

    lower = forecast.values - margin
    upper = forecast.values + margin

    if use_log:
        forecast = np.exp(forecast.values)
        lower = np.exp(lower)
        upper = np.exp(upper)
    else:
        forecast = forecast.values

    forecast = _ensure_positive(np.asarray(forecast))
    lower = _ensure_positive(np.asarray(lower))
    upper = _ensure_positive(np.asarray(upper))

    metrics = {
        "model": "holt_winters",
        "aic": round(float(model.aic), 2),
        "bic": round(float(model.bic), 2),
        "seasonal": has_seasonal,
        "log_transformed": use_log,
    }

    return forecast, lower, upper, metrics


# ── SARIMAX ──────────────────────────────────────────────

def forecast_sarimax(
    series: pd.Series,
    periods: int,
    confidence: float = 0.95,
    use_log: bool = True,
    order: tuple = (1, 1, 1),
    seasonal_order: tuple = (1, 1, 1, 12),
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Forecast using SARIMAX (Seasonal ARIMA with eXogenous variables).

    Default orders (1,1,1)(1,1,1,12) work well for monthly economic data.
    """
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    train = series.copy().astype(float)
    if use_log:
        train = np.log(train.clip(lower=1.0))

    model = SARIMAX(
        train,
        order=order,
        seasonal_order=seasonal_order,
        enforce_stationarity=False,
        enforce_invertibility=False,
    ).fit(disp=False, maxiter=200)

    alpha = 1.0 - confidence
    pred = model.get_forecast(steps=periods)
    forecast = pred.predicted_mean
    conf_int = pred.conf_int(alpha=alpha)

    if use_log:
        forecast = np.exp(forecast.values)
        conf_int_lower = np.exp(conf_int.iloc[:, 0].values)
        conf_int_upper = np.exp(conf_int.iloc[:, 1].values)
    else:
        forecast = forecast.values
        conf_int_lower = conf_int.iloc[:, 0].values
        conf_int_upper = conf_int.iloc[:, 1].values

    forecast = _ensure_positive(np.asarray(forecast))
    lower = _ensure_positive(np.asarray(conf_int_lower))
    upper = _ensure_positive(np.asarray(conf_int_upper))

    metrics = {
        "model": "sarimax",
        "order": list(order),
        "seasonal_order": list(seasonal_order),
        "aic": round(float(model.aic), 2),
        "log_transformed": use_log,
    }

    return forecast, lower, upper, metrics


# ── Dispatcher ───────────────────────────────────────────

AVAILABLE_MODELS = ["auto_arima", "holt_winters", "sarimax"]


def run_forecast(
    series: pd.Series,
    model_type: str,
    periods: int,
    confidence: float = 0.95,
    use_log: bool = True,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Run a time series forecast with the specified model.

    Args:
        series: Historical monthly time series.
        model_type: One of 'auto_arima', 'holt_winters', 'sarimax'.
        periods: Number of months to forecast.
        confidence: Confidence interval width (0.80, 0.90, 0.95).
        use_log: Whether to log-transform before modeling.

    Returns:
        (forecast, lower_bound, upper_bound, model_info)
    """
    if model_type not in AVAILABLE_MODELS:
        raise ValueError(
            f"Unknown model type: '{model_type}'. "
            f"Available models: {AVAILABLE_MODELS}"
        )

    logger.info(
        "Running %s forecast: %d periods, confidence=%.2f, log=%s",
        model_type, periods, confidence, use_log,
    )

    if model_type == "auto_arima":
        return forecast_auto_arima(series, periods, confidence, use_log)
    elif model_type == "holt_winters":
        return forecast_holt_winters(series, periods, confidence, use_log)
    elif model_type == "sarimax":
        return forecast_sarimax(series, periods, confidence, use_log)

    # Should not reach here
    raise ValueError(f"Unhandled model type: {model_type}")
