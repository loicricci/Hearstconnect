"""
Deterministic product performance waterfall engine.

Implements the mining bucket waterfall logic:
1) BTC production from miner+hosting+network (apply calibration)
2) OPEX from energy + hosting fees + maintenance
3) Sell BTC for OPEX at spot
4) Deficit check (OPEX coverage only)
5) Yield distribution (capped at base 8% or 12% after BTC holding target hit)
6) Capitalization — remaining BTC goes to capitalization bucket
7) Take-profit ladder (optional, on capitalization bucket)

Capital reconstitution (principal) is handled by the BTC Holding bucket,
NOT by the mining waterfall. Mining delivers yield and capitalization only.
"""
from typing import List, Dict, Optional
import math


DAYS_PER_MONTH = 30.44


def simulate_product_3y(
    # Curve inputs
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    # Miner inputs
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    # Hosting inputs
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    # Product structure
    capital_raised_usd: float,
    product_tenor_months: int,
    base_yield_apr: float = 0.08,
    bonus_yield_apr: float = 0.04,
    # Cross-bucket: month when BTC holding target was hit (None = not hit)
    holding_sell_month: Optional[int] = None,
    # Calibration
    calibration_uptime_factor: float = 1.0,
    calibration_production_adj: float = 1.0,
    # Take-profit ladder
    take_profit_ladder: List[Dict] = None,
) -> Dict:
    """
    Run the full product waterfall simulation.

    The waterfall priority is:
      OPEX -> Yield (8% base, +4% bonus once BTC holding target hit) -> Capitalization

    Returns:
        {monthly_waterfall, metrics, flags, decision, decision_reasons}
    """
    if take_profit_ladder is None:
        take_profit_ladder = []

    monthly_waterfall: List[Dict] = []
    flags: List[str] = []

    # Initial state
    capitalization_usd = 0.0
    capitalization_btc = 0.0
    cumulative_yield_paid = 0.0
    total_btc_produced = 0.0
    total_btc_sold = 0.0

    # Applied uptime with calibration
    effective_uptime = uptime * calibration_uptime_factor * (1 - curtailment_pct)

    # Fleet-level
    fleet_hashrate_th = miner_hashrate_th * miner_count
    fleet_power_w = miner_power_w * miner_count
    fleet_power_kw = fleet_power_w / 1000.0

    red_flag_months = 0

    sim_months = min(product_tenor_months, len(btc_prices), len(hashprice_btc_per_ph_day))

    for t in range(sim_months):
        spot_price = btc_prices[t]
        hashprice = hashprice_btc_per_ph_day[t]

        # ──────────────────────────────────────────────
        # 1) BTC PRODUCTION (apply calibration)
        # ──────────────────────────────────────────────
        fleet_ph = fleet_hashrate_th / 1000.0
        btc_produced = hashprice * fleet_ph * DAYS_PER_MONTH * effective_uptime
        btc_produced *= calibration_production_adj
        total_btc_produced += btc_produced

        # ──────────────────────────────────────────────
        # 2) OPEX CALCULATION
        # ──────────────────────────────────────────────
        elec_kwh = fleet_power_kw * 24.0 * DAYS_PER_MONTH * effective_uptime
        elec_cost_usd = elec_kwh * electricity_rate
        hosting_fee_usd = fleet_power_kw * hosting_fee_per_kw_month
        maintenance_usd = (btc_produced * spot_price) * miner_maintenance_pct
        total_opex_usd = elec_cost_usd + hosting_fee_usd + maintenance_usd

        # ──────────────────────────────────────────────
        # 3) SELL BTC FOR OPEX AT SPOT
        # ──────────────────────────────────────────────
        btc_for_opex = total_opex_usd / spot_price if spot_price > 0 else 0
        btc_sell_opex = min(btc_produced, btc_for_opex)
        btc_remaining = btc_produced - btc_sell_opex
        total_btc_sold += btc_sell_opex

        # ──────────────────────────────────────────────
        # 4) DEFICIT CHECK (OPEX coverage only)
        # ──────────────────────────────────────────────
        # A month is deficit if BTC produced cannot cover at least 95% of OPEX
        opex_coverage_ratio = (btc_produced * spot_price) / total_opex_usd if total_opex_usd > 0 else 999.0
        month_flag = "GREEN"
        yield_paid_usd = 0.0

        if btc_produced < btc_for_opex * 0.95:
            # Not enough BTC to cover OPEX
            yield_paid_usd = 0.0
            month_flag = "RED"
            flags.append(
                f"Month {t}: DEFICIT — BTC produced ({btc_produced:.6f}) "
                f"< OPEX required ({btc_for_opex:.6f})"
            )
            red_flag_months += 1
        else:
            # ──────────────────────────────────────────
            # 5) YIELD DISTRIBUTION
            # ──────────────────────────────────────────
            # Determine current yield APR: base, or base+bonus if holding target hit
            if holding_sell_month is not None and t >= holding_sell_month:
                current_apr = base_yield_apr + bonus_yield_apr
            else:
                current_apr = base_yield_apr

            btc_surplus = btc_remaining
            yield_distributable_usd = btc_surplus * spot_price
            yield_cap_usd = capital_raised_usd * (current_apr / 12.0)
            yield_paid_usd = min(yield_distributable_usd, yield_cap_usd)

            btc_for_yield = yield_paid_usd / spot_price if spot_price > 0 else 0
            btc_remaining -= btc_for_yield
            total_btc_sold += btc_for_yield

            # ──────────────────────────────────────────
            # 6) CAPITALIZATION — remaining BTC goes to capitalization
            # ──────────────────────────────────────────
            if btc_remaining > 0:
                capitalization_btc += btc_remaining

        cumulative_yield_paid += yield_paid_usd

        # Update capitalization USD value (mark-to-market)
        capitalization_usd = capitalization_btc * spot_price

        # ──────────────────────────────────────────────
        # 7) TAKE-PROFIT LADDER (on capitalization bucket)
        # ──────────────────────────────────────────────
        take_profit_sold_usd = 0.0
        for tp in take_profit_ladder:
            if spot_price >= tp.get("price_trigger", float("inf")) and capitalization_btc > 0:
                sell_btc = capitalization_btc * tp.get("sell_pct", 0)
                take_profit_sold_usd += sell_btc * spot_price
                capitalization_btc -= sell_btc
                total_btc_sold += sell_btc

        # Recalculate capitalization after take-profit
        capitalization_usd = capitalization_btc * spot_price

        # ──────────────────────────────────────────────
        # 8) COMPUTE RATIOS & HEALTH
        # ──────────────────────────────────────────────
        # Yield fulfillment: actual yield / target yield for this month
        target_yield_usd = capital_raised_usd * (base_yield_apr / 12.0)
        yield_fulfillment = yield_paid_usd / target_yield_usd if target_yield_usd > 0 else 0

        # Determine the applied APR for display
        if holding_sell_month is not None and t >= holding_sell_month:
            yield_apr_applied = base_yield_apr + bonus_yield_apr
        else:
            yield_apr_applied = base_yield_apr

        # Health score (0-100)
        health = _compute_health_score(opex_coverage_ratio, yield_fulfillment, month_flag)

        monthly_waterfall.append({
            "month": t,
            "btc_price_usd": round(spot_price, 2),
            "btc_produced": round(btc_produced, 8),
            "btc_sell_opex": round(btc_sell_opex, 8),
            "btc_for_yield": round(yield_paid_usd / spot_price if spot_price > 0 and yield_paid_usd > 0 else 0, 8),
            "btc_to_capitalization": round(max(0, btc_remaining) if month_flag == "GREEN" else 0, 8),
            "opex_usd": round(total_opex_usd, 2),
            "yield_paid_usd": round(yield_paid_usd, 2),
            "yield_apr_applied": round(yield_apr_applied, 4),
            "take_profit_sold_usd": round(take_profit_sold_usd, 2),
            "capitalization_btc": round(capitalization_btc, 8),
            "capitalization_usd": round(capitalization_usd, 2),
            "opex_coverage_ratio": round(opex_coverage_ratio, 4),
            "yield_fulfillment": round(yield_fulfillment, 4),
            "health_score": round(health, 1),
            "flag": month_flag,
        })

    # ──────────────────────────────────────────────
    # 9) FINAL METRICS & DECISION
    # ──────────────────────────────────────────────
    final_health = monthly_waterfall[-1]["health_score"] if monthly_waterfall else 0
    avg_yield = cumulative_yield_paid / sim_months if sim_months > 0 else 0
    effective_apr = (cumulative_yield_paid / capital_raised_usd) / (sim_months / 12.0) if capital_raised_usd > 0 and sim_months > 0 else 0
    avg_opex_coverage = sum(m["opex_coverage_ratio"] for m in monthly_waterfall) / sim_months if sim_months > 0 else 0

    metrics = {
        "final_health_score": round(final_health, 1),
        "total_btc_produced": round(total_btc_produced, 8),
        "total_btc_sold": round(total_btc_sold, 8),
        "cumulative_yield_paid_usd": round(cumulative_yield_paid, 2),
        "avg_monthly_yield_usd": round(avg_yield, 2),
        "effective_apr": round(effective_apr, 4),
        "red_flag_months": red_flag_months,
        "capitalization_btc_final": round(capitalization_btc, 8),
        "capitalization_usd_final": round(capitalization_usd, 2),
        "avg_opex_coverage_ratio": round(avg_opex_coverage, 4),
    }

    # Decision logic
    decision, decision_reasons = _make_decision(red_flag_months, sim_months, final_health)

    return {
        "monthly_waterfall": monthly_waterfall,
        "metrics": metrics,
        "flags": flags,
        "decision": decision,
        "decision_reasons": decision_reasons,
    }


def _compute_health_score(
    opex_coverage_ratio: float,
    yield_fulfillment: float,
    flag: str,
) -> float:
    """Compute a 0-100 health score based on OPEX coverage and yield fulfillment."""
    score = 100.0

    # OPEX coverage contribution (50% weight)
    # Perfect score if coverage >= 1.5x, degrades below that
    if opex_coverage_ratio < 1.0:
        score -= 50  # Can't even cover OPEX
    elif opex_coverage_ratio < 1.2:
        score -= 30 * (1.2 - opex_coverage_ratio) / 0.2
    elif opex_coverage_ratio < 1.5:
        score -= 10 * (1.5 - opex_coverage_ratio) / 0.3

    # Yield fulfillment contribution (30% weight)
    # How much of the target yield was actually delivered
    if yield_fulfillment < 0.5:
        score -= 30 * (1 - yield_fulfillment / 0.5)
    elif yield_fulfillment < 1.0:
        score -= 15 * (1 - yield_fulfillment)

    # Deficit penalty (20% weight)
    if flag == "RED":
        score -= 20

    return max(0, min(100, score))


def _make_decision(
    red_months: int, total_months: int, health: float,
) -> tuple:
    """Make GO/NO-GO decision based on OPEX deficit months."""
    reasons: List[str] = []

    # BLOCKED: too many months where mining can't cover OPEX
    if red_months > total_months * 0.2:
        reasons.append(f"Too many deficit months ({red_months}/{total_months})")
        return "BLOCKED", reasons

    # ADJUST: health is concerning but not critical
    if health < 50:
        reasons.append(f"Health score below target ({health:.0f}/100)")
        return "ADJUST", reasons

    if red_months > total_months * 0.1:
        reasons.append(f"Elevated deficit months ({red_months}/{total_months})")
        return "ADJUST", reasons

    if not reasons:
        reasons.append("All metrics within acceptable ranges")
    return "APPROVED", reasons
