"""
Multi-bucket product simulation engine.

Splits capital across three buckets:
  (a) Yield Liquidity Product — deterministic returns from APR schedule
  (b) BTC Holding — buy BTC at entry price, sell at target price (principal reconstitution)
  (c) BTC Mining — waterfall engine: OPEX -> Yield (8% base, +4% bonus) -> Capitalization

Capital reconstitution is handled by Bucket B (BTC Holding) when the target
price is hit.  Mining (Bucket C) only delivers yield and builds capitalization.
The mining yield cap bumps from 8% to 12% once the BTC holding target is hit.

Then runs all three buckets across bear/base/bull scenarios.
"""
from typing import List, Dict, Optional
from .product_waterfall import simulate_product_3y


# ──────────────────────────────────────────────────────────
# Bucket A: Yield Liquidity Product
# ──────────────────────────────────────────────────────────
def simulate_yield_bucket(
    allocated_usd: float,
    base_apr: float,
    apr_schedule: Optional[List[Dict]],
    tenor_months: int,
) -> Dict:
    """
    Deterministic yield bucket.
    Returns monthly series and summary metrics.

    apr_schedule: optional list of {from_month, to_month, apr} overrides.
    If None, base_apr is used uniformly.
    """
    monthly_data: List[Dict] = []
    cumulative_yield = 0.0
    current_value = allocated_usd

    for t in range(tenor_months):
        # Determine APR for this month
        apr = base_apr
        if apr_schedule:
            for entry in apr_schedule:
                if entry.get("from_month", 0) <= t <= entry.get("to_month", tenor_months - 1):
                    apr = entry["apr"]
                    break

        monthly_yield = current_value * (apr / 12.0)
        cumulative_yield += monthly_yield
        current_value += monthly_yield  # compound

        monthly_data.append({
            "month": t,
            "apr_applied": round(apr, 4),
            "monthly_yield_usd": round(monthly_yield, 2),
            "cumulative_yield_usd": round(cumulative_yield, 2),
            "bucket_value_usd": round(current_value, 2),
        })

    effective_apr = (cumulative_yield / allocated_usd) / (tenor_months / 12.0) if allocated_usd > 0 and tenor_months > 0 else 0

    return {
        "monthly_data": monthly_data,
        "metrics": {
            "allocated_usd": round(allocated_usd, 2),
            "final_value_usd": round(current_value, 2),
            "total_yield_usd": round(cumulative_yield, 2),
            "effective_apr": round(effective_apr, 4),
        },
    }


# ──────────────────────────────────────────────────────────
# Bucket B: BTC Holding (Principal Reconstitution)
# ──────────────────────────────────────────────────────────
def simulate_btc_holding_bucket(
    allocated_usd: float,
    buying_price_usd: float,
    target_sell_price_usd: float,
    btc_prices: List[float],
    tenor_months: int,
) -> Dict:
    """
    BTC holding bucket — principal reconstitution.
    Buy BTC at buying_price, track value monthly, sell if target hit.
    When target is hit, the sell proceeds reconstitute the capital.
    """
    if buying_price_usd <= 0:
        buying_price_usd = 1.0  # safety

    btc_quantity = allocated_usd / buying_price_usd
    monthly_data: List[Dict] = []
    sold = False
    sell_month: Optional[int] = None
    sell_price: Optional[float] = None
    realized_pnl = 0.0

    sim_months = min(tenor_months, len(btc_prices))

    for t in range(sim_months):
        spot = btc_prices[t]
        current_value = btc_quantity * spot if not sold else realized_pnl
        unrealized_pnl = current_value - allocated_usd if not sold else 0.0

        # Check if target sell price is hit
        if not sold and spot >= target_sell_price_usd:
            sold = True
            sell_month = t
            sell_price = spot
            realized_pnl = btc_quantity * spot
            current_value = realized_pnl

        monthly_data.append({
            "month": t,
            "btc_price_usd": round(spot, 2),
            "btc_quantity": round(btc_quantity, 8) if not sold or t < sell_month else 0.0,
            "bucket_value_usd": round(current_value, 2),
            "unrealized_pnl_usd": round(unrealized_pnl, 2) if not sold else 0.0,
            "realized_pnl_usd": round(realized_pnl - allocated_usd, 2) if sold else 0.0,
            "sold": sold,
        })

    # Final valuation
    if not sold:
        final_value = btc_quantity * btc_prices[sim_months - 1] if sim_months > 0 else allocated_usd
    else:
        final_value = realized_pnl

    total_return_pct = (final_value - allocated_usd) / allocated_usd if allocated_usd > 0 else 0

    return {
        "monthly_data": monthly_data,
        "metrics": {
            "allocated_usd": round(allocated_usd, 2),
            "buying_price_usd": round(buying_price_usd, 2),
            "target_sell_price_usd": round(target_sell_price_usd, 2),
            "btc_quantity": round(btc_quantity, 8),
            "target_hit": sold,
            "sell_month": sell_month,
            "sell_price_usd": round(sell_price, 2) if sell_price else None,
            "final_value_usd": round(final_value, 2),
            "total_return_pct": round(total_return_pct, 4),
        },
    }


# ──────────────────────────────────────────────────────────
# Bucket C: BTC Mining (wraps waterfall engine)
# ──────────────────────────────────────────────────────────
def simulate_mining_bucket(
    allocated_usd: float,
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    tenor_months: int,
    base_yield_apr: float,
    bonus_yield_apr: float,
    holding_sell_month: Optional[int] = None,
    take_profit_ladder: List[Dict] = None,
) -> Dict:
    """
    Mining bucket — delegates to the waterfall engine.
    Receives holding_sell_month from Bucket B to know when to bump yield cap.
    """
    result = simulate_product_3y(
        btc_prices=btc_prices,
        hashprice_btc_per_ph_day=hashprice_btc_per_ph_day,
        miner_hashrate_th=miner_hashrate_th,
        miner_power_w=miner_power_w,
        miner_count=miner_count,
        miner_lifetime_months=miner_lifetime_months,
        miner_maintenance_pct=miner_maintenance_pct,
        electricity_rate=electricity_rate,
        hosting_fee_per_kw_month=hosting_fee_per_kw_month,
        uptime=uptime,
        curtailment_pct=curtailment_pct,
        capital_raised_usd=allocated_usd,
        product_tenor_months=tenor_months,
        base_yield_apr=base_yield_apr,
        bonus_yield_apr=bonus_yield_apr,
        holding_sell_month=holding_sell_month,
        take_profit_ladder=take_profit_ladder,
    )

    return result


# ──────────────────────────────────────────────────────────
# Orchestrator: Run all 3 buckets for a single scenario
# ──────────────────────────────────────────────────────────
def simulate_single_scenario(
    # Curves
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    # Product-level
    capital_raised_usd: float,
    tenor_months: int,
    # Bucket A: Yield
    yield_allocated_usd: float,
    yield_base_apr: float,
    yield_apr_schedule: Optional[List[Dict]],
    # Bucket B: BTC Holding
    holding_allocated_usd: float,
    holding_buying_price: float,
    holding_target_sell_price: float,
    # Bucket C: Mining
    mining_allocated_usd: float,
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    mining_base_yield_apr: float,
    mining_bonus_yield_apr: float,
    mining_take_profit_ladder: List[Dict] = None,
) -> Dict:
    """Run all three buckets for a single price scenario and aggregate.

    IMPORTANT: BTC Holding runs FIRST so we can extract sell_month
    and pass it to the mining waterfall for dynamic yield cap.
    """

    # Bucket A: Yield (independent, can run anytime)
    yield_result = simulate_yield_bucket(
        allocated_usd=yield_allocated_usd,
        base_apr=yield_base_apr,
        apr_schedule=yield_apr_schedule,
        tenor_months=tenor_months,
    )

    # Bucket B: BTC Holding — run FIRST to get sell_month
    holding_result = simulate_btc_holding_bucket(
        allocated_usd=holding_allocated_usd,
        buying_price_usd=holding_buying_price,
        target_sell_price_usd=holding_target_sell_price,
        btc_prices=btc_prices,
        tenor_months=tenor_months,
    )

    # Extract sell_month for cross-bucket communication
    holding_sell_month = holding_result["metrics"].get("sell_month")  # None if target not hit

    # Bucket C: Mining — receives holding_sell_month for yield cap bump
    mining_result = simulate_mining_bucket(
        allocated_usd=mining_allocated_usd,
        btc_prices=btc_prices,
        hashprice_btc_per_ph_day=hashprice_btc_per_ph_day,
        miner_hashrate_th=miner_hashrate_th,
        miner_power_w=miner_power_w,
        miner_count=miner_count,
        miner_lifetime_months=miner_lifetime_months,
        miner_maintenance_pct=miner_maintenance_pct,
        electricity_rate=electricity_rate,
        hosting_fee_per_kw_month=hosting_fee_per_kw_month,
        uptime=uptime,
        curtailment_pct=curtailment_pct,
        tenor_months=tenor_months,
        base_yield_apr=mining_base_yield_apr,
        bonus_yield_apr=mining_bonus_yield_apr,
        holding_sell_month=holding_sell_month,
        take_profit_ladder=mining_take_profit_ladder,
    )

    # Aggregate portfolio view
    sim_months = min(tenor_months, len(btc_prices))
    monthly_portfolio: List[Dict] = []

    for t in range(sim_months):
        y_val = yield_result["monthly_data"][t]["bucket_value_usd"] if t < len(yield_result["monthly_data"]) else 0
        h_val = holding_result["monthly_data"][t]["bucket_value_usd"] if t < len(holding_result["monthly_data"]) else 0

        # Mining bucket value: capitalization (USD mark-to-market)
        m_row = mining_result["monthly_waterfall"][t] if t < len(mining_result["monthly_waterfall"]) else {}
        m_val = m_row.get("capitalization_usd", 0)

        total = y_val + h_val + m_val

        monthly_portfolio.append({
            "month": t,
            "yield_value_usd": round(y_val, 2),
            "holding_value_usd": round(h_val, 2),
            "mining_value_usd": round(m_val, 2),
            "total_portfolio_usd": round(total, 2),
        })

    # Aggregated metrics
    final_yield = yield_result["metrics"]["final_value_usd"]
    final_holding = holding_result["metrics"]["final_value_usd"]

    # Mining final value = capitalization
    mining_metrics = mining_result["metrics"]
    final_mining = mining_metrics.get("capitalization_usd_final", 0)

    total_final = final_yield + final_holding + final_mining
    total_return_pct = (total_final - capital_raised_usd) / capital_raised_usd if capital_raised_usd > 0 else 0

    # Compute total yield across all buckets
    total_yield_paid = (
        yield_result["metrics"]["total_yield_usd"] +
        mining_metrics.get("cumulative_yield_paid_usd", 0)
    )

    effective_apr = (total_yield_paid / capital_raised_usd) / (sim_months / 12.0) if capital_raised_usd > 0 and sim_months > 0 else 0

    # Decision based on mining bucket health (the riskiest component)
    decision = mining_result.get("decision", "APPROVED")
    decision_reasons = mining_result.get("decision_reasons", [])

    aggregated = {
        "monthly_portfolio": monthly_portfolio,
        "metrics": {
            "capital_raised_usd": round(capital_raised_usd, 2),
            "final_portfolio_usd": round(total_final, 2),
            "total_return_pct": round(total_return_pct, 4),
            "total_yield_paid_usd": round(total_yield_paid, 2),
            "effective_apr": round(effective_apr, 4),
            "capital_preservation_ratio": round(total_final / capital_raised_usd, 4) if capital_raised_usd > 0 else 0,
        },
        "decision": decision,
        "decision_reasons": decision_reasons,
    }

    return {
        "yield_bucket": yield_result,
        "btc_holding_bucket": holding_result,
        "mining_bucket": mining_result,
        "aggregated": aggregated,
    }


# ──────────────────────────────────────────────────────────
# Top-level: Run all 3 scenarios (bear/base/bull)
# ──────────────────────────────────────────────────────────
def simulate_all_scenarios(
    # Per-scenario curves: {scenario: {btc_prices, hashprice_btc_per_ph_day}}
    scenario_curves: Dict[str, Dict],
    # Product-level
    capital_raised_usd: float,
    tenor_months: int,
    # Bucket A: Yield
    yield_allocated_usd: float,
    yield_base_apr: float,
    yield_apr_schedule: Optional[List[Dict]],
    # Bucket B: BTC Holding
    holding_allocated_usd: float,
    holding_buying_price: float,
    holding_target_sell_price: float,
    # Bucket C: Mining
    mining_allocated_usd: float,
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    mining_base_yield_apr: float,
    mining_bonus_yield_apr: float,
    mining_take_profit_ladder: List[Dict] = None,
) -> Dict[str, Dict]:
    """
    Run all 3 scenarios and return results keyed by scenario name.
    """
    results: Dict[str, Dict] = {}

    for scenario, curves in scenario_curves.items():
        results[scenario] = simulate_single_scenario(
            btc_prices=curves["btc_prices"],
            hashprice_btc_per_ph_day=curves["hashprice_btc_per_ph_day"],
            capital_raised_usd=capital_raised_usd,
            tenor_months=tenor_months,
            yield_allocated_usd=yield_allocated_usd,
            yield_base_apr=yield_base_apr,
            yield_apr_schedule=yield_apr_schedule,
            holding_allocated_usd=holding_allocated_usd,
            holding_buying_price=holding_buying_price,
            holding_target_sell_price=holding_target_sell_price,
            mining_allocated_usd=mining_allocated_usd,
            miner_hashrate_th=miner_hashrate_th,
            miner_power_w=miner_power_w,
            miner_count=miner_count,
            miner_lifetime_months=miner_lifetime_months,
            miner_maintenance_pct=miner_maintenance_pct,
            electricity_rate=electricity_rate,
            hosting_fee_per_kw_month=hosting_fee_per_kw_month,
            uptime=uptime,
            curtailment_pct=curtailment_pct,
            mining_base_yield_apr=mining_base_yield_apr,
            mining_bonus_yield_apr=mining_bonus_yield_apr,
            mining_take_profit_ladder=mining_take_profit_ladder,
        )

    return results
