"""Network curve generation engine — deterministic + ML forecasting."""
import logging
import math
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)


# BTC subsidy schedule (block reward halvings)
# Halving occurs every 210,000 blocks (~4 years)
# 2024-04: halving to 3.125 BTC
# 2028-04: halving to 1.5625 BTC
# 2032-04: halving to 0.78125 BTC
HALVING_SCHEDULE = [
    ("2024-04", 3.125),
    ("2028-04", 1.5625),
    ("2032-04", 0.78125),
    ("2036-04", 0.390625),
]

BLOCKS_PER_DAY = 144.0
DAYS_PER_MONTH = 30.44  # average

# Fee regime multipliers
FEE_REGIMES = {
    "low": 0.5,
    "base": 1.0,
    "high": 2.0,
}


def get_subsidy_for_month(start_date: str, month_index: int, halving_enabled: bool) -> float:
    """Get the block subsidy (BTC) for a given month."""
    if not halving_enabled:
        return 3.125  # Current subsidy as of 2024

    start_year = int(start_date[:4])
    start_month = int(start_date[5:7])

    current_year = start_year + (start_month - 1 + month_index) // 12
    current_month = (start_month - 1 + month_index) % 12 + 1
    current_date_str = f"{current_year:04d}-{current_month:02d}"

    subsidy = 3.125  # Default (post-2024 halving)
    for halving_date, new_subsidy in HALVING_SCHEDULE:
        if current_date_str >= halving_date:
            subsidy = new_subsidy
    return subsidy


def generate_network_curve(
    start_date: str,
    months: int,
    starting_network_hashrate_eh: float,
    monthly_difficulty_growth_rate: float,
    halving_enabled: bool,
    fee_regime: str,
    starting_fees_per_block_btc: float,
) -> Tuple[List[float], List[float], List[float], List[float], List[str]]:
    """
    Generate deterministic network curves.

    Returns:
        (difficulty[], hashprice_btc_per_ph_day[], fees_per_block_btc[], network_hashrate_eh[], warnings[])
    """
    warnings: List[str] = []
    fee_mult = FEE_REGIMES.get(fee_regime, 1.0)

    difficulty_curve: List[float] = []
    hashprice_curve: List[float] = []
    fees_curve: List[float] = []
    hashrate_curve: List[float] = []

    prev_hashprice = None

    for m in range(months):
        # Network hashrate grows with difficulty growth
        hashrate_eh = starting_network_hashrate_eh * ((1 + monthly_difficulty_growth_rate) ** m)

        # Difficulty is roughly proportional to hashrate
        # difficulty ≈ hashrate_th * 2^32 / 600 (simplified)
        hashrate_th = hashrate_eh * 1e6  # EH/s -> TH/s
        difficulty = hashrate_th * (2**32) / 600.0

        # Block subsidy
        subsidy = get_subsidy_for_month(start_date, m, halving_enabled)

        # Fees per block
        fees_btc = starting_fees_per_block_btc * fee_mult
        # Slight growth in fees over time (0.1% per month for base)
        fees_btc *= (1 + 0.001 * m)
        fees_btc = round(fees_btc, 6)

        # Hashprice in BTC/PH/day
        # hashprice_btc_per_th_day = ((subsidy + fees) * blocks_per_day) / network_hashrate_th
        # hashprice_btc_per_ph_day = hashprice_btc_per_th_day * 1000 (1 PH = 1000 TH)
        total_btc_per_block = subsidy + fees_btc
        hashprice_btc_per_th_day = (total_btc_per_block * BLOCKS_PER_DAY) / hashrate_th
        hashprice_btc_per_ph_day = hashprice_btc_per_th_day * 1000.0

        difficulty_curve.append(round(difficulty, 0))
        hashprice_curve.append(round(hashprice_btc_per_ph_day, 8))
        fees_curve.append(fees_btc)
        hashrate_curve.append(round(hashrate_eh, 2))

        # Warning checks
        if prev_hashprice is not None:
            if hashprice_btc_per_ph_day > prev_hashprice * 1.1:
                if monthly_difficulty_growth_rate > 0:
                    warnings.append(
                        f"Month {m}: hashprice rising (+{((hashprice_btc_per_ph_day/prev_hashprice)-1)*100:.1f}%) "
                        f"while difficulty also rising — check fee assumptions"
                    )
        prev_hashprice = hashprice_btc_per_ph_day

    # Halving warnings
    if halving_enabled:
        for halving_date, new_subsidy in HALVING_SCHEDULE:
            h_year = int(halving_date[:4])
            h_month = int(halving_date[5:7])
            s_year = int(start_date[:4])
            s_month = int(start_date[5:7])
            halving_month_idx = (h_year - s_year) * 12 + (h_month - s_month)
            if 0 <= halving_month_idx < months:
                warnings.append(
                    f"Halving at month {halving_month_idx} ({halving_date}): "
                    f"subsidy drops to {new_subsidy} BTC"
                )

    return difficulty_curve, hashprice_curve, fees_curve, hashrate_curve, warnings


# ──────────────────────────────────────────────────────────
# ML Forecasting Mode
# ──────────────────────────────────────────────────────────

def generate_network_curve_ml(
    model_type: str = "auto_arima",
    forecast_months: int = 120,
    confidence: float = 0.95,
    halving_enabled: bool = True,
    start_date: str = "2025-01",
) -> Dict:
    """
    Generate network curves using ML time-series forecasting.

    Independently forecasts hashrate and fees using the selected model,
    then derives difficulty and hashprice from the forecasts.

    Args:
        model_type: 'auto_arima', 'holt_winters', or 'sarimax'.
        forecast_months: Number of months to forecast.
        confidence: Confidence interval (0.80, 0.90, 0.95).
        halving_enabled: Apply Bitcoin halving schedule to hashprice calc.
        start_date: Start date (YYYY-MM) for subsidy schedule alignment.

    Returns:
        Dict with keys:
          difficulty, hashprice_btc_per_ph_day, fees_per_block_btc,
          network_hashrate_eh — each containing 'forecast', 'lower', 'upper'.
          Plus: warnings, model_info.
    """
    from .data_fetcher import get_network_monthly_data
    from .ts_models import run_forecast

    logger.info(
        "Generating network curves (ML): model=%s, months=%d, CI=%.2f",
        model_type, forecast_months, confidence,
    )

    # 1. Fetch historical monthly network data
    monthly = get_network_monthly_data()

    if len(monthly) < 24:
        raise ValueError(
            f"Insufficient network history for ML: "
            f"got {len(monthly)} months, need >= 24"
        )

    warnings: List[str] = []
    model_infos = {}

    # 2. Forecast hashrate (log-transform — exponential growth)
    hr_forecast, hr_lower, hr_upper, hr_info = run_forecast(
        series=monthly["hashrate_eh"],
        model_type=model_type,
        periods=forecast_months,
        confidence=confidence,
        use_log=True,
    )
    model_infos["hashrate"] = hr_info

    # 3. Forecast fees (log-transform — right-skewed distribution)
    fee_forecast, fee_lower, fee_upper, fee_info = run_forecast(
        series=monthly["fees_per_block_btc"],
        model_type=model_type,
        periods=forecast_months,
        confidence=confidence,
        use_log=True,
    )
    model_infos["fees"] = fee_info

    # 4. Derive difficulty from hashrate
    #    difficulty ≈ hashrate_th × 2^32 / 600
    diff_forecast = [(hr * 1e6) * (2**32) / 600.0 for hr in hr_forecast]
    diff_lower = [(hr * 1e6) * (2**32) / 600.0 for hr in hr_lower]
    diff_upper = [(hr * 1e6) * (2**32) / 600.0 for hr in hr_upper]

    # 5. Derive hashprice from forecasted hashrate + fees + halving schedule
    hp_forecast = []
    hp_lower = []
    hp_upper = []

    for m in range(forecast_months):
        subsidy = get_subsidy_for_month(start_date, m, halving_enabled)

        # Central forecast
        total_btc = subsidy + float(fee_forecast[m])
        hr_th = float(hr_forecast[m]) * 1e6
        hp = (total_btc * BLOCKS_PER_DAY) / hr_th * 1000.0 if hr_th > 0 else 0.0
        hp_forecast.append(hp)

        # Upper hashprice = higher fees + lower hashrate
        total_upper = subsidy + float(fee_upper[m])
        hr_th_low = max(float(hr_lower[m]), 0.001) * 1e6
        hp_up = (total_upper * BLOCKS_PER_DAY) / hr_th_low * 1000.0 if hr_th_low > 0 else 0.0
        hp_upper.append(hp_up)

        # Lower hashprice = lower fees + higher hashrate
        total_lower = subsidy + float(fee_lower[m])
        hr_th_hi = float(hr_upper[m]) * 1e6
        hp_lo = (total_lower * BLOCKS_PER_DAY) / hr_th_hi * 1000.0 if hr_th_hi > 0 else 0.0
        hp_lower.append(hp_lo)

    # 6. Halving warnings
    if halving_enabled:
        for halving_date, new_subsidy in HALVING_SCHEDULE:
            h_year = int(halving_date[:4])
            h_month = int(halving_date[5:7])
            s_year = int(start_date[:4])
            s_month = int(start_date[5:7])
            halving_month_idx = (h_year - s_year) * 12 + (h_month - s_month)
            if 0 <= halving_month_idx < forecast_months:
                warnings.append(
                    f"Halving at month {halving_month_idx} ({halving_date}): "
                    f"subsidy drops to {new_subsidy} BTC"
                )

    # 7. Compile model_info
    model_info = {
        "models": model_infos,
        "training_months": len(monthly),
        "training_start": str(monthly.index[0].date()),
        "training_end": str(monthly.index[-1].date()),
        "confidence_interval": confidence,
        "forecast_months": forecast_months,
    }

    def _round_list(lst, decimals=2):
        return [round(float(v), decimals) for v in lst]

    return {
        "difficulty": _round_list(diff_forecast, 0),
        "difficulty_lower": _round_list(diff_lower, 0),
        "difficulty_upper": _round_list(diff_upper, 0),
        "network_hashrate_eh": _round_list(hr_forecast),
        "hashrate_lower": _round_list(hr_lower),
        "hashrate_upper": _round_list(hr_upper),
        "fees_per_block_btc": _round_list(fee_forecast, 6),
        "fees_lower": _round_list(fee_lower, 6),
        "fees_upper": _round_list(fee_upper, 6),
        "hashprice_btc_per_ph_day": _round_list(hp_forecast, 8),
        "hashprice_lower": _round_list(hp_lower, 8),
        "hashprice_upper": _round_list(hp_upper, 8),
        "warnings": warnings,
        "model_info": model_info,
    }
