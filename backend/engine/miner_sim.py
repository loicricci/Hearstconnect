"""Deterministic miner economics simulation engine."""
from typing import List, Optional, Dict
import calendar


DAYS_PER_MONTH = 30.44


def simulate_miner(
    hashrate_th: float,
    power_w: float,
    price_usd: float,
    lifetime_months: int,
    maintenance_pct: float,
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    electricity_rate: float,
    uptime: float,
    months: int,
) -> Dict:
    """
    Simulate per-miner monthly cashflows.

    For each month t:
    - btc_mined = hashprice_btc_per_ph_day[t] * (hashrate_th/1000) * days_in_month * uptime
    - elec_kwh = (power_w/1000) * 24 * days_in_month * uptime
    - elec_cost_usd = elec_kwh * electricity_rate
    - depreciation_usd = price_usd / lifetime_months
    - gross_revenue_usd = btc_mined * btc_price[t]
    - maintenance_usd = gross_revenue_usd * maintenance_pct
    - net_usd = gross_revenue_usd - elec_cost_usd - maintenance_usd  (operating net, excludes depreciation)
    - ebit_usd = net_usd - depreciation_usd  (earnings before interest & taxes)

    Returns dict with monthly_cashflows and summary metrics.
    """
    monthly_cashflows: List[Dict] = []
    total_btc_mined = 0.0
    total_revenue_usd = 0.0
    total_elec_cost = 0.0
    total_net_usd = 0.0
    total_ebit_usd = 0.0
    cumulative_net_usd = 0.0
    cumulative_ebit_usd = 0.0
    break_even_month: Optional[int] = None

    sim_months = min(months, len(btc_prices), len(hashprice_btc_per_ph_day))

    for t in range(sim_months):
        hashprice = hashprice_btc_per_ph_day[t]
        btc_price = btc_prices[t]
        days = DAYS_PER_MONTH

        # BTC production
        miner_ph = hashrate_th / 1000.0  # Convert TH to PH
        btc_mined = hashprice * miner_ph * days * uptime

        # Electricity
        elec_kwh = (power_w / 1000.0) * 24.0 * days * uptime
        elec_cost_usd = elec_kwh * electricity_rate

        # Revenue
        gross_revenue_usd = btc_mined * btc_price

        # Maintenance
        maintenance_usd = gross_revenue_usd * maintenance_pct

        # Depreciation (straight-line over lifetime)
        depreciation_usd = price_usd / lifetime_months if t < lifetime_months else 0.0

        # Net (operating): Revenue - OpEx (electricity + maintenance). Excludes depreciation.
        net_usd = gross_revenue_usd - elec_cost_usd - maintenance_usd
        # EBIT: Net - Depreciation
        ebit_usd = net_usd - depreciation_usd
        net_btc = btc_mined - (elec_cost_usd / btc_price) if btc_price > 0 else 0.0

        cumulative_net_usd += net_usd
        cumulative_ebit_usd += ebit_usd

        total_btc_mined += btc_mined
        total_revenue_usd += gross_revenue_usd
        total_elec_cost += elec_cost_usd
        total_net_usd += net_usd
        total_ebit_usd += ebit_usd

        if break_even_month is None and cumulative_ebit_usd >= 0:
            break_even_month = t

        monthly_cashflows.append({
            "month": t,
            "btc_price_usd": round(btc_price, 2),
            "hashprice_btc_per_ph_day": round(hashprice, 8),
            "btc_mined": round(btc_mined, 8),
            "elec_kwh": round(elec_kwh, 2),
            "elec_cost_usd": round(elec_cost_usd, 2),
            "gross_revenue_usd": round(gross_revenue_usd, 2),
            "maintenance_usd": round(maintenance_usd, 2),
            "net_usd": round(net_usd, 2),
            "depreciation_usd": round(depreciation_usd, 2),
            "ebit_usd": round(ebit_usd, 2),
            "net_btc": round(net_btc, 8),
            "cumulative_net_usd": round(cumulative_net_usd, 2),
            "cumulative_ebit_usd": round(cumulative_ebit_usd, 2),
        })

    return {
        "monthly_cashflows": monthly_cashflows,
        "total_btc_mined": round(total_btc_mined, 8),
        "total_revenue_usd": round(total_revenue_usd, 2),
        "total_electricity_cost_usd": round(total_elec_cost, 2),
        "total_net_usd": round(total_net_usd, 2),
        "total_ebit_usd": round(total_ebit_usd, 2),
        "break_even_month": break_even_month,
    }
