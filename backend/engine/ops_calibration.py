"""Deterministic operational performance calibration engine."""
from typing import List, Dict, Optional


DAYS_PER_MONTH = 30.44


def calibrate_ops(
    history: List[Dict],  # [{month, btc_produced, uptime, energy_kwh}]
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    hashrate_th: float,
    power_w: float,
    assumed_uptime: float,
    electricity_rate: float,
) -> Dict:
    """
    Compare predicted vs actual performance and derive calibration factors.

    Returns:
        {
            realized_uptime_factor, realized_efficiency_factor,
            production_adjustment, flags, monthly_comparison
        }
    """
    flags: List[str] = []
    monthly_comparison: List[Dict] = []

    actual_uptimes: List[float] = []
    actual_productions: List[float] = []
    predicted_productions: List[float] = []

    miner_ph = hashrate_th / 1000.0

    for i, entry in enumerate(history):
        if i >= len(btc_prices) or i >= len(hashprice_btc_per_ph_day):
            break

        # Predicted values
        predicted_btc = hashprice_btc_per_ph_day[i] * miner_ph * DAYS_PER_MONTH * assumed_uptime
        predicted_energy_kwh = (power_w / 1000.0) * 24.0 * DAYS_PER_MONTH * assumed_uptime

        actual_btc = entry["btc_produced"]
        actual_uptime = entry["uptime"]
        actual_energy = entry["energy_kwh"]

        actual_uptimes.append(actual_uptime)
        actual_productions.append(actual_btc)
        predicted_productions.append(predicted_btc)

        # Efficiency: actual kWh per TH (lower is better)
        actual_efficiency = actual_energy / (hashrate_th * 24 * DAYS_PER_MONTH * actual_uptime) if actual_uptime > 0 else 0
        predicted_efficiency = power_w / hashrate_th  # J/TH = W/TH

        variance_pct = ((actual_btc - predicted_btc) / predicted_btc * 100) if predicted_btc > 0 else 0

        monthly_comparison.append({
            "month": entry["month"],
            "predicted_btc": round(predicted_btc, 8),
            "actual_btc": round(actual_btc, 8),
            "variance_pct": round(variance_pct, 2),
            "predicted_energy_kwh": round(predicted_energy_kwh, 2),
            "actual_energy_kwh": round(actual_energy, 2),
            "actual_uptime": round(actual_uptime, 4),
        })

    # Compute calibration factors
    avg_actual_uptime = sum(actual_uptimes) / len(actual_uptimes) if actual_uptimes else assumed_uptime
    avg_actual_prod = sum(actual_productions) / len(actual_productions) if actual_productions else 0
    avg_predicted_prod = sum(predicted_productions) / len(predicted_productions) if predicted_productions else 0

    realized_uptime_factor = avg_actual_uptime / assumed_uptime if assumed_uptime > 0 else 1.0
    production_adjustment = avg_actual_prod / avg_predicted_prod if avg_predicted_prod > 0 else 1.0

    # Efficiency factor: ratio of actual to predicted efficiency
    realized_efficiency_factor = production_adjustment  # Simplified proxy

    # Flags
    if realized_uptime_factor < 0.9:
        flags.append(f"WARNING: Realized uptime factor {realized_uptime_factor:.2f} is below 0.90 — model is optimistic")
    if production_adjustment < 0.85:
        flags.append(f"RED FLAG: Production is {(1-production_adjustment)*100:.0f}% below model — significant gap")
    if production_adjustment > 1.1:
        flags.append(f"INFO: Production is {(production_adjustment-1)*100:.0f}% above model — model may be conservative")

    # Variance analysis
    variances = [m["variance_pct"] for m in monthly_comparison]
    if variances:
        sorted_var = sorted(variances)
        p50_idx = len(sorted_var) // 2
        p90_idx = int(len(sorted_var) * 0.9)
        p50_var = sorted_var[p50_idx]
        p90_var = sorted_var[min(p90_idx, len(sorted_var) - 1)]
    else:
        p50_var = 0.0
        p90_var = 0.0

    return {
        "realized_uptime_factor": round(realized_uptime_factor, 4),
        "realized_efficiency_factor": round(realized_efficiency_factor, 4),
        "production_adjustment": round(production_adjustment, 4),
        "flags": flags,
        "monthly_comparison": monthly_comparison,
        "variance_p50": round(p50_var, 2),
        "variance_p90": round(p90_var, 2),
    }
