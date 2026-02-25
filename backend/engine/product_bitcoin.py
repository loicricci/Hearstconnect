"""
Bitcoin collateral product simulation engine.

Capital is split into BTC + stablecoins:
  - BTC portion is purchased upfront and deposited as collateral
  - Stablecoin reserve is placed into a yield product (earns APR)
  - Stablecoins are minted (borrowed) against BTC collateral at a given LTV
  - Miners are purchased ONLY from minted stablecoins (reserve untouched)

Monthly:
  1. Reserve earns yield (compounds at reserve_yield_apr)
  2. Fleet produces BTC → added to collateral pool
  3. OPEX calculated (electricity + hosting + maintenance)
  4. OPEX paid from reserve yield first; if insufficient, mint more against collateral
  5. Interest accrues on outstanding stablecoin debt
  6. Check LTV — flag if above liquidation threshold
  7. Check strike ladder — sell BTC at strike, repay debt

Debt is ONLY repaid at strike prices (no ongoing repayment from mining).
"""
from typing import List, Dict, Optional

DAYS_PER_MONTH = 30.44


def simulate_bitcoin_scenario(
    # Curves
    btc_prices: List[float],
    hashprice_btc_per_ph_day: List[float],
    # Capital & allocation
    capital_raised_usd: float,
    btc_allocation_pct: float,
    buying_price_usd: float,
    # Collateral / borrowing
    collateral_ltv_pct: float,
    borrowing_apr: float,
    liquidation_ltv_pct: float,
    # Mining fleet
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    miner_price_usd: float,
    # Hosting
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    # Product
    tenor_months: int,
    # Strike ladder
    strike_ladder: List[Dict] = None,
    # Reserve yield
    reserve_yield_apr: float = 0.04,
    # Investor yield
    base_yield_apr: float = 0.08,
    bonus_yield_apr: float = 0.04,
    early_close_threshold_pct: float = 0.36,
    # Commercial
    upfront_commercial_pct: float = 0.0,
    management_fees_pct: float = 0.0,
    performance_fees_pct: float = 0.0,
) -> Dict:
    """Run the Bitcoin collateral simulation for a single price scenario."""
    if strike_ladder is None:
        strike_ladder = []

    # ──────────────────────────────────────────────
    # INCEPTION (Month 0 setup)
    # ──────────────────────────────────────────────
    # Apply upfront commercial fee
    effective_capital = capital_raised_usd
    upfront_fee = 0.0
    if upfront_commercial_pct > 0:
        upfront_fee = capital_raised_usd * (upfront_commercial_pct / 100.0)
        effective_capital -= upfront_fee

    # Split capital: BTC portion + stablecoin reserve (reserve earns yield)
    btc_capital = effective_capital * (btc_allocation_pct / 100.0)
    stablecoin_reserve = effective_capital - btc_capital

    # Buy BTC at buying price
    btc_purchased = btc_capital / buying_price_usd if buying_price_usd > 0 else 0
    btc_collateral = btc_purchased

    # Mint stablecoins against BTC collateral at LTV
    collateral_value_usd = btc_collateral * buying_price_usd
    max_mintable = collateral_value_usd * (collateral_ltv_pct / 100.0)
    stablecoin_debt = 0.0

    # Buy miners ONLY from minted stablecoins (reserve stays intact for yield)
    miner_capex = miner_count * miner_price_usd
    mintable_now = max_mintable - stablecoin_debt
    minted_for_capex = min(miner_capex, max(0, mintable_now))
    stablecoin_debt += minted_for_capex
    capex_shortfall = miner_capex - minted_for_capex

    # Fleet-level constants
    effective_uptime = uptime * (1 - curtailment_pct)
    fleet_hashrate_th = miner_hashrate_th * miner_count
    fleet_power_kw = (miner_power_w * miner_count) / 1000.0

    # Strike ladder tracking (each triggers only once)
    strike_status = []
    for s in strike_ladder:
        strike_status.append({
            "strike_price": s.get("strike_price", 0),
            "btc_sell_pct": s.get("btc_sell_pct", 0),
            "triggered": False,
            "trigger_month": None,
            "btc_sold": 0.0,
            "usd_received": 0.0,
            "debt_repaid": 0.0,
        })

    monthly_data: List[Dict] = []
    strike_events: List[Dict] = []
    mining_production: List[Dict] = []

    total_btc_mined = 0.0
    total_interest_paid = 0.0
    total_opex_paid = 0.0
    total_debt_repaid = 0.0
    total_mgmt_fees = 0.0
    total_reserve_yield = 0.0
    liquidation_months = 0

    # Investor yield tracking
    cumulative_yield_paid = 0.0
    total_yield_paid = 0.0
    bonus_active = False
    early_close_month: Optional[int] = None

    sim_months = min(tenor_months, len(btc_prices), len(hashprice_btc_per_ph_day))

    for t in range(sim_months):
        spot_price = btc_prices[t]
        hashprice = hashprice_btc_per_ph_day[t]

        # ──────────────────────────────────────────────
        # 0) RESERVE YIELD — stablecoin reserve earns yield
        # ──────────────────────────────────────────────
        reserve_yield = stablecoin_reserve * (reserve_yield_apr / 12.0)
        stablecoin_reserve += reserve_yield
        total_reserve_yield += reserve_yield

        # ──────────────────────────────────────────────
        # 1) BTC PRODUCTION
        # ──────────────────────────────────────────────
        fleet_ph = fleet_hashrate_th / 1000.0
        btc_produced = hashprice * fleet_ph * DAYS_PER_MONTH * effective_uptime
        total_btc_mined += btc_produced

        # Add mined BTC to collateral pool
        btc_collateral += btc_produced

        # ──────────────────────────────────────────────
        # 2) OPEX CALCULATION
        # ──────────────────────────────────────────────
        elec_kwh = fleet_power_kw * 24.0 * DAYS_PER_MONTH * effective_uptime
        elec_cost = elec_kwh * electricity_rate
        hosting_fee = fleet_power_kw * hosting_fee_per_kw_month
        maintenance = (btc_produced * spot_price) * miner_maintenance_pct
        opex_usd = elec_cost + hosting_fee + maintenance
        total_opex_paid += opex_usd

        # ──────────────────────────────────────────────
        # 3) PAY OPEX from reserve, then mint if needed
        # ──────────────────────────────────────────────
        opex_from_reserve = min(stablecoin_reserve, opex_usd)
        stablecoin_reserve -= opex_from_reserve
        opex_remaining = opex_usd - opex_from_reserve

        minted_for_opex = 0.0
        opex_shortfall_flag = False
        if opex_remaining > 0:
            collateral_value = btc_collateral * spot_price
            mintable = max(0, collateral_value * (collateral_ltv_pct / 100.0) - stablecoin_debt)
            minted_for_opex = min(opex_remaining, mintable)
            stablecoin_debt += minted_for_opex
            if minted_for_opex < opex_remaining:
                opex_shortfall_flag = True

        # ──────────────────────────────────────────────
        # 4) ACCRUE INTEREST on outstanding debt
        # ──────────────────────────────────────────────
        monthly_interest = stablecoin_debt * (borrowing_apr / 12.0)
        stablecoin_debt += monthly_interest
        total_interest_paid += monthly_interest

        # ──────────────────────────────────────────────
        # 5) MANAGEMENT FEE (from debt — adds to debt)
        # ──────────────────────────────────────────────
        mgmt_fee = 0.0
        if management_fees_pct > 0:
            mgmt_fee = capital_raised_usd * (management_fees_pct / 100.0 / 12.0)
            stablecoin_debt += mgmt_fee
            total_mgmt_fees += mgmt_fee

        # ──────────────────────────────────────────────
        # 5b) INVESTOR YIELD — paid from reserve, then by selling mined BTC
        # ──────────────────────────────────────────────
        if bonus_active:
            current_yield_apr = base_yield_apr + bonus_yield_apr
        else:
            current_yield_apr = base_yield_apr
        yield_obligation_usd = capital_raised_usd * (current_yield_apr / 12.0)

        yield_from_reserve = 0.0
        yield_from_btc_sale = 0.0
        yield_btc_sold = 0.0
        yield_paid_usd = 0.0

        if early_close_month is None:
            yield_from_reserve = min(stablecoin_reserve, yield_obligation_usd)
            stablecoin_reserve -= yield_from_reserve
            yield_remaining = yield_obligation_usd - yield_from_reserve

            if yield_remaining > 0 and spot_price > 0 and btc_collateral > 0:
                btc_needed = yield_remaining / spot_price
                yield_btc_sold = min(btc_needed, btc_collateral)
                yield_from_btc_sale = yield_btc_sold * spot_price
                btc_collateral -= yield_btc_sold

            yield_paid_usd = yield_from_reserve + yield_from_btc_sale
            cumulative_yield_paid += yield_paid_usd
            total_yield_paid += yield_paid_usd

            if early_close_threshold_pct > 0 and capital_raised_usd > 0:
                if cumulative_yield_paid >= early_close_threshold_pct * capital_raised_usd:
                    early_close_month = t

        yield_fulfillment = yield_paid_usd / yield_obligation_usd if yield_obligation_usd > 0 else 1.0

        # ──────────────────────────────────────────────
        # 6) LTV CHECK
        # ──────────────────────────────────────────────
        collateral_value = btc_collateral * spot_price
        ltv = (stablecoin_debt / collateral_value * 100.0) if collateral_value > 0 else 999.0
        is_liquidation_risk = ltv >= liquidation_ltv_pct
        if is_liquidation_risk:
            liquidation_months += 1

        # ──────────────────────────────────────────────
        # 7) STRIKE LADDER — sell BTC, repay debt
        # ──────────────────────────────────────────────
        strike_sold_btc = 0.0
        strike_received_usd = 0.0
        strike_debt_repaid = 0.0
        for i, strike in enumerate(strike_status):
            if strike["triggered"]:
                continue
            if spot_price >= strike["strike_price"] and btc_collateral > 0:
                sell_btc = btc_collateral * (strike["btc_sell_pct"] / 100.0)
                proceeds = sell_btc * spot_price
                repay = min(proceeds, stablecoin_debt)
                stablecoin_debt -= repay
                surplus = proceeds - repay
                stablecoin_reserve += surplus

                btc_collateral -= sell_btc
                strike_sold_btc += sell_btc
                strike_received_usd += proceeds
                strike_debt_repaid += repay
                total_debt_repaid += repay

                strike["triggered"] = True
                strike["trigger_month"] = t
                strike["btc_sold"] = round(sell_btc, 8)
                strike["usd_received"] = round(proceeds, 2)
                strike["debt_repaid"] = round(repay, 2)

                if not bonus_active:
                    bonus_active = True

                strike_events.append({
                    "month": t,
                    "strike_price": strike["strike_price"],
                    "btc_price_usd": round(spot_price, 2),
                    "btc_sold": round(sell_btc, 8),
                    "usd_received": round(proceeds, 2),
                    "debt_repaid": round(repay, 2),
                    "surplus_to_reserve": round(surplus, 2),
                    "remaining_debt": round(stablecoin_debt, 2),
                    "remaining_btc": round(btc_collateral, 8),
                })

        # Recalculate after strikes
        collateral_value = btc_collateral * spot_price
        ltv = (stablecoin_debt / collateral_value * 100.0) if collateral_value > 0 else 999.0
        net_equity = collateral_value - stablecoin_debt + stablecoin_reserve

        # Mining production detail
        mining_production.append({
            "month": t,
            "btc_price_usd": round(spot_price, 2),
            "btc_produced": round(btc_produced, 8),
            "opex_usd": round(opex_usd, 2),
            "elec_cost_usd": round(elec_cost, 2),
            "hosting_fee_usd": round(hosting_fee, 2),
            "maintenance_usd": round(maintenance, 2),
        })

        monthly_data.append({
            "month": t,
            "btc_price_usd": round(spot_price, 2),
            # BTC
            "btc_mined": round(btc_produced, 8),
            "btc_collateral": round(btc_collateral, 8),
            "collateral_value_usd": round(collateral_value, 2),
            # Stablecoins
            "stablecoin_reserve": round(stablecoin_reserve, 2),
            "stablecoin_debt": round(stablecoin_debt, 2),
            "minted_for_opex": round(minted_for_opex, 2),
            "interest_usd": round(monthly_interest, 2),
            "mgmt_fee_usd": round(mgmt_fee, 2),
            # Reserve yield
            "reserve_yield_usd": round(reserve_yield, 2),
            "cumulative_reserve_yield_usd": round(total_reserve_yield, 2),
            # Investor yield
            "yield_paid_usd": round(yield_paid_usd, 2),
            "yield_from_reserve_usd": round(yield_from_reserve, 2),
            "yield_from_btc_sale_usd": round(yield_from_btc_sale, 2),
            "yield_btc_sold": round(yield_btc_sold, 8),
            "yield_obligation_usd": round(yield_obligation_usd, 2),
            "yield_apr_applied": round(current_yield_apr, 4),
            "yield_fulfillment": round(yield_fulfillment, 4),
            "cumulative_yield_paid_usd": round(cumulative_yield_paid, 2),
            "bonus_yield_active": bonus_active,
            # OPEX
            "opex_usd": round(opex_usd, 2),
            "opex_from_reserve": round(opex_from_reserve, 2),
            "opex_shortfall": opex_shortfall_flag,
            # LTV & risk
            "ltv_pct": round(min(ltv, 999.0), 2),
            "liquidation_risk": is_liquidation_risk,
            # Net position
            "net_equity_usd": round(net_equity, 2),
            # Strike activity this month
            "strike_sold_btc": round(strike_sold_btc, 8),
            "strike_received_usd": round(strike_received_usd, 2),
            "strike_debt_repaid": round(strike_debt_repaid, 2),
        })

    # ──────────────────────────────────────────────
    # FINAL METRICS
    # ──────────────────────────────────────────────
    final = monthly_data[-1] if monthly_data else {}
    final_collateral_value = final.get("collateral_value_usd", 0)
    final_debt = final.get("stablecoin_debt", 0)
    final_reserve = final.get("stablecoin_reserve", 0)
    final_net_equity = final.get("net_equity_usd", 0)
    final_ltv = final.get("ltv_pct", 0)
    final_btc = final.get("btc_collateral", 0)

    total_return_pct = (final_net_equity - capital_raised_usd) / capital_raised_usd if capital_raised_usd > 0 else 0

    # Performance fee on net gains
    performance_fee = 0.0
    net_gain = max(0, final_net_equity - capital_raised_usd)
    if performance_fees_pct > 0 and net_gain > 0:
        performance_fee = net_gain * (performance_fees_pct / 100.0)

    metrics = {
        "capital_raised_usd": round(capital_raised_usd, 2),
        "effective_capital_usd": round(effective_capital, 2),
        "btc_purchased": round(btc_purchased, 8),
        "btc_purchase_price_usd": round(buying_price_usd, 2),
        "initial_stablecoin_reserve": round(effective_capital - btc_capital, 2),
        "miner_capex_usd": round(miner_capex, 2),
        "minted_for_capex_usd": round(minted_for_capex, 2),
        # Final state
        "final_btc_collateral": round(final_btc, 8),
        "final_collateral_value_usd": round(final_collateral_value, 2),
        "final_stablecoin_debt": round(final_debt, 2),
        "final_stablecoin_reserve": round(final_reserve, 2),
        "final_net_equity_usd": round(final_net_equity, 2),
        "final_ltv_pct": round(final_ltv, 2),
        # Totals
        "total_btc_mined": round(total_btc_mined, 8),
        "total_opex_paid_usd": round(total_opex_paid, 2),
        "total_interest_paid_usd": round(total_interest_paid, 2),
        "total_debt_repaid_usd": round(total_debt_repaid, 2),
        "total_reserve_yield_usd": round(total_reserve_yield, 2),
        "reserve_yield_apr": round(reserve_yield_apr, 4),
        "total_return_pct": round(total_return_pct, 4),
        # Investor yield
        "total_yield_paid_usd": round(total_yield_paid, 2),
        "cumulative_yield_paid_usd": round(cumulative_yield_paid, 2),
        "base_yield_apr": round(base_yield_apr, 4),
        "bonus_yield_apr": round(bonus_yield_apr, 4),
        "combined_yield_apr": round(base_yield_apr + bonus_yield_apr, 4),
        "effective_yield_apr": round(
            (cumulative_yield_paid / capital_raised_usd) / (sim_months / 12.0)
            if capital_raised_usd > 0 and sim_months > 0 else 0, 4
        ),
        "early_close_triggered": early_close_month is not None,
        "early_close_month": early_close_month,
        "early_close_threshold_pct": round(early_close_threshold_pct, 4),
        "cumulative_yield_pct": round(
            cumulative_yield_paid / capital_raised_usd if capital_raised_usd > 0 else 0, 4
        ),
        # Risk
        "liquidation_risk_months": liquidation_months,
        "max_ltv_pct": round(max((m["ltv_pct"] for m in monthly_data), default=0), 2),
        "min_ltv_pct": round(min((m["ltv_pct"] for m in monthly_data), default=0), 2),
        # Strikes
        "strikes_triggered": sum(1 for s in strike_status if s["triggered"]),
        "strikes_total": len(strike_status),
        # Commercial
        "upfront_fee_usd": round(upfront_fee, 2),
        "total_mgmt_fees_usd": round(total_mgmt_fees, 2),
        "performance_fee_usd": round(performance_fee, 2),
        "total_commercial_usd": round(upfront_fee + total_mgmt_fees + performance_fee, 2),
        # Effective product duration
        "effective_months": sim_months,
    }

    return {
        "monthly_data": monthly_data,
        "metrics": metrics,
        "strike_events": strike_events,
        "mining_production": mining_production,
        "strike_ladder_status": strike_status,
    }


def simulate_bitcoin_all_scenarios(
    scenario_curves: Dict[str, Dict],
    capital_raised_usd: float,
    btc_allocation_pct: float,
    buying_price_usd: float,
    collateral_ltv_pct: float,
    borrowing_apr: float,
    liquidation_ltv_pct: float,
    miner_hashrate_th: float,
    miner_power_w: float,
    miner_count: int,
    miner_lifetime_months: int,
    miner_maintenance_pct: float,
    miner_price_usd: float,
    electricity_rate: float,
    hosting_fee_per_kw_month: float,
    uptime: float,
    curtailment_pct: float,
    tenor_months: int,
    strike_ladder: List[Dict] = None,
    reserve_yield_apr: float = 0.04,
    base_yield_apr: float = 0.08,
    bonus_yield_apr: float = 0.04,
    early_close_threshold_pct: float = 0.36,
    upfront_commercial_pct: float = 0.0,
    management_fees_pct: float = 0.0,
    performance_fees_pct: float = 0.0,
) -> Dict[str, Dict]:
    """Run the Bitcoin collateral scenario for bear/base/bull and return results."""
    results: Dict[str, Dict] = {}

    for scenario, curves in scenario_curves.items():
        results[scenario] = simulate_bitcoin_scenario(
            btc_prices=curves["btc_prices"],
            hashprice_btc_per_ph_day=curves["hashprice_btc_per_ph_day"],
            capital_raised_usd=capital_raised_usd,
            btc_allocation_pct=btc_allocation_pct,
            buying_price_usd=buying_price_usd,
            collateral_ltv_pct=collateral_ltv_pct,
            borrowing_apr=borrowing_apr,
            liquidation_ltv_pct=liquidation_ltv_pct,
            miner_hashrate_th=miner_hashrate_th,
            miner_power_w=miner_power_w,
            miner_count=miner_count,
            miner_lifetime_months=miner_lifetime_months,
            miner_maintenance_pct=miner_maintenance_pct,
            miner_price_usd=miner_price_usd,
            electricity_rate=electricity_rate,
            hosting_fee_per_kw_month=hosting_fee_per_kw_month,
            uptime=uptime,
            curtailment_pct=curtailment_pct,
            tenor_months=tenor_months,
            strike_ladder=strike_ladder,
            reserve_yield_apr=reserve_yield_apr,
            base_yield_apr=base_yield_apr,
            bonus_yield_apr=bonus_yield_apr,
            early_close_threshold_pct=early_close_threshold_pct,
            upfront_commercial_pct=upfront_commercial_pct,
            management_fees_pct=management_fees_pct,
            performance_fees_pct=performance_fees_pct,
        )

    return results
