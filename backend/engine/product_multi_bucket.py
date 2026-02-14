"""
Multi-bucket product simulation engine.

Splits capital across three buckets:
  (a) Yield Liquidity Product — deterministic returns from APR schedule
  (b) BTC Holding — buy BTC at entry price, sell at target price (principal reconstitution)
  (c) BTC Mining — waterfall engine: OPEX -> Yield (8% base, +4% bonus) -> Capitalization

Capital reconstitution is handled by Bucket B (BTC Holding) when the target
price is hit.  Mining (Bucket C) only delivers yield and builds capitalization.
The mining yield cap bumps from 8% to 12% once the BTC holding target is hit.

Commercial fees:
  - Upfront commercial: Deducted from total investment, proportionally from all buckets
  - Management fees: Annual % of investment, captured monthly from capitalization
  - Performance fees: % of overhead value (capitalization above initial investment), only if positive

Then runs all three buckets across bear/base/bull scenarios.
"""
from typing import List, Dict, Optional
from .product_waterfall import simulate_product_3y


# ──────────────────────────────────────────────────────────
# Commercial Fees Calculator
# ──────────────────────────────────────────────────────────
def calculate_commercial_fees(
    capital_raised_usd: float,
    tenor_months: int,
    upfront_commercial_pct: float,
    management_fees_pct: float,
    performance_fees_pct: float,
    capitalization_monthly_usd: List[float],
    yield_allocated: float,
    holding_allocated: float,
    mining_allocated: float,
) -> Dict:
    """
    Calculate commercial fees for the product.
    
    Args:
        capital_raised_usd: Total capital raised
        tenor_months: Product duration in months
        upfront_commercial_pct: Upfront fee as % (e.g., 2.0 = 2%)
        management_fees_pct: Annual management fee as % of investment
        performance_fees_pct: Performance fee as % of overhead (capitalization above threshold)
        capitalization_monthly_usd: Monthly capitalization values from mining bucket
        yield_allocated, holding_allocated, mining_allocated: Original bucket allocations
    
    Returns:
        Dict with commercial fee breakdown
    """
    result = {
        "upfront_fee_usd": 0.0,
        "upfront_fee_breakdown": {},
        "management_fees_monthly": [],
        "management_fees_total_usd": 0.0,
        "performance_fee_usd": 0.0,
        "performance_fee_base_usd": 0.0,
        "total_commercial_value_usd": 0.0,
    }
    
    # 1. Upfront commercial fee — proportionally removed from investment
    if upfront_commercial_pct > 0:
        total_allocation = yield_allocated + holding_allocated + mining_allocated
        if total_allocation > 0:
            upfront_total = capital_raised_usd * (upfront_commercial_pct / 100.0)
            result["upfront_fee_usd"] = round(upfront_total, 2)
            
            # Proportional breakdown
            result["upfront_fee_breakdown"] = {
                "yield_deduction_usd": round(upfront_total * (yield_allocated / total_allocation), 2),
                "holding_deduction_usd": round(upfront_total * (holding_allocated / total_allocation), 2),
                "mining_deduction_usd": round(upfront_total * (mining_allocated / total_allocation), 2),
            }
    
    # 2. Management fees — annual % of investment, captured monthly from capitalization
    if management_fees_pct > 0 and len(capitalization_monthly_usd) > 0:
        monthly_mgmt_rate = management_fees_pct / 100.0 / 12.0
        mgmt_fees_monthly = []
        
        for cap_usd in capitalization_monthly_usd:
            # Management fee is based on the investment amount (not capitalization)
            # But it's captured FROM capitalization (i.e., reduces what investors get)
            monthly_fee = capital_raised_usd * monthly_mgmt_rate
            # Cap the fee at available capitalization (can't take more than exists)
            actual_fee = min(monthly_fee, max(0, cap_usd))
            mgmt_fees_monthly.append(round(actual_fee, 2))
        
        result["management_fees_monthly"] = mgmt_fees_monthly
        result["management_fees_total_usd"] = round(sum(mgmt_fees_monthly), 2)
    
    # 3. Performance fees — captured from capitalization if overhead value delivered
    if performance_fees_pct > 0 and len(capitalization_monthly_usd) > 0:
        final_capitalization = capitalization_monthly_usd[-1] if capitalization_monthly_usd else 0
        
        # Overhead = capitalization above the initial mining investment
        # Performance fee is only on the "overhead" / excess value
        overhead = max(0, final_capitalization - mining_allocated)
        
        if overhead > 0:
            perf_fee = overhead * (performance_fees_pct / 100.0)
            result["performance_fee_usd"] = round(perf_fee, 2)
            result["performance_fee_base_usd"] = round(overhead, 2)
    
    # Total commercial value
    result["total_commercial_value_usd"] = round(
        result["upfront_fee_usd"] + 
        result["management_fees_total_usd"] + 
        result["performance_fee_usd"],
        2
    )
    
    return result


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
# Bucket B: BTC Holding (Principal Reconstitution + Extra Yield)
# ──────────────────────────────────────────────────────────
def simulate_btc_holding_bucket(
    allocated_usd: float,
    buying_price_usd: float,
    target_sell_price_usd: float,
    btc_prices: List[float],
    tenor_months: int,
    capital_recon_pct: float = 100.0,
    extra_yield_strikes: List[Dict] = None,
) -> Dict:
    """
    BTC holding bucket — split between capital reconstitution and extra yield.
    
    Capital Reconstitution portion:
    - Buy BTC at buying_price, sell when target_sell_price hit
    - Proceeds reconstitute the capital (holding + mining investment)
    
    Extra Yield portion:
    - Split across strike price ladder
    - Sell at each strike price when hit, generating yield
    """
    if buying_price_usd <= 0:
        buying_price_usd = 1.0  # safety
    if extra_yield_strikes is None:
        extra_yield_strikes = []

    total_btc = allocated_usd / buying_price_usd
    
    # Split BTC between capital recon and extra yield
    capital_recon_btc = total_btc * (capital_recon_pct / 100.0)
    extra_yield_btc = total_btc * ((100.0 - capital_recon_pct) / 100.0)
    
    monthly_data: List[Dict] = []
    
    # Capital reconstitution tracking
    recon_sold = False
    recon_sell_month: Optional[int] = None
    recon_sell_price: Optional[float] = None
    recon_realized = 0.0
    
    # Extra yield strike tracking
    strike_status = []
    for strike in extra_yield_strikes:
        strike_btc = extra_yield_btc * (strike.get("btc_share_pct", 0) / 100.0)
        strike_status.append({
            "strike_price": strike.get("strike_price", 0),
            "btc_amount": strike_btc,
            "sold": False,
            "sell_month": None,
            "realized_usd": 0.0,
        })
    
    total_extra_yield_realized = 0.0
    sim_months = min(tenor_months, len(btc_prices))

    for t in range(sim_months):
        spot = btc_prices[t]
        
        # Track remaining BTC
        remaining_recon_btc = capital_recon_btc if not recon_sold else 0.0
        remaining_extra_btc = sum(s["btc_amount"] for s in strike_status if not s["sold"])
        
        # Check capital reconstitution target
        if not recon_sold and capital_recon_btc > 0 and spot >= target_sell_price_usd:
            recon_sold = True
            recon_sell_month = t
            recon_sell_price = spot
            recon_realized = capital_recon_btc * spot
            remaining_recon_btc = 0.0
        
        # Check extra yield strike prices
        extra_yield_this_month = 0.0
        for strike in strike_status:
            if not strike["sold"] and strike["btc_amount"] > 0 and spot >= strike["strike_price"]:
                strike["sold"] = True
                strike["sell_month"] = t
                strike["realized_usd"] = strike["btc_amount"] * spot
                total_extra_yield_realized += strike["realized_usd"]
                extra_yield_this_month += strike["realized_usd"]
        
        # Current value = unsold BTC at spot + realized proceeds
        unsold_btc = remaining_recon_btc + remaining_extra_btc
        current_value = unsold_btc * spot + recon_realized + total_extra_yield_realized
        unrealized_pnl = (unsold_btc * spot) - (unsold_btc * buying_price_usd) if unsold_btc > 0 else 0.0

        monthly_data.append({
            "month": t,
            "btc_price_usd": round(spot, 2),
            "btc_quantity": round(unsold_btc, 8),
            "capital_recon_btc": round(remaining_recon_btc, 8),
            "extra_yield_btc": round(remaining_extra_btc, 8),
            "bucket_value_usd": round(current_value, 2),
            "unrealized_pnl_usd": round(unrealized_pnl, 2),
            "recon_realized_usd": round(recon_realized, 2),
            "extra_yield_realized_usd": round(total_extra_yield_realized, 2),
            "extra_yield_this_month_usd": round(extra_yield_this_month, 2),
            "recon_sold": recon_sold,
        })

    # Final valuation
    final_unsold_btc = (capital_recon_btc if not recon_sold else 0.0) + sum(s["btc_amount"] for s in strike_status if not s["sold"])
    final_spot = btc_prices[sim_months - 1] if sim_months > 0 else buying_price_usd
    final_value = final_unsold_btc * final_spot + recon_realized + total_extra_yield_realized

    total_return_pct = (final_value - allocated_usd) / allocated_usd if allocated_usd > 0 else 0

    return {
        "monthly_data": monthly_data,
        "metrics": {
            "allocated_usd": round(allocated_usd, 2),
            "buying_price_usd": round(buying_price_usd, 2),
            "target_sell_price_usd": round(target_sell_price_usd, 2),
            "btc_quantity": round(total_btc, 8),
            # Capital reconstitution metrics
            "capital_recon_pct": round(capital_recon_pct, 2),
            "capital_recon_btc": round(capital_recon_btc, 8),
            "target_hit": recon_sold,
            "sell_month": recon_sell_month,
            "sell_price_usd": round(recon_sell_price, 2) if recon_sell_price else None,
            "recon_realized_usd": round(recon_realized, 2),
            # Extra yield metrics
            "extra_yield_btc": round(extra_yield_btc, 8),
            "extra_yield_strikes": strike_status,
            "extra_yield_total_usd": round(total_extra_yield_realized, 2),
            # Final metrics
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
    # Optional parameters (with defaults) must come last
    holding_capital_recon_pct: float = 100.0,
    holding_extra_yield_strikes: List[Dict] = None,
    mining_take_profit_ladder: List[Dict] = None,
    # Commercial fees
    upfront_commercial_pct: float = 0.0,
    management_fees_pct: float = 0.0,
    performance_fees_pct: float = 0.0,
) -> Dict:
    """Run all three buckets for a single price scenario and aggregate.

    IMPORTANT: BTC Holding runs FIRST so we can extract sell_month
    and pass it to the mining waterfall for dynamic yield cap.
    
    Commercial fees:
    - Upfront: Deducted proportionally from bucket allocations before simulation
    - Management: Calculated after simulation based on investment amount
    - Performance: Calculated from capitalization overhead
    """
    
    # Store original allocations for commercial fee calculation
    original_yield_alloc = yield_allocated_usd
    original_holding_alloc = holding_allocated_usd
    original_mining_alloc = mining_allocated_usd
    
    # Apply upfront commercial fee deduction to all buckets proportionally
    if upfront_commercial_pct > 0:
        total_alloc = yield_allocated_usd + holding_allocated_usd + mining_allocated_usd
        if total_alloc > 0:
            upfront_deduction = capital_raised_usd * (upfront_commercial_pct / 100.0)
            yield_allocated_usd -= upfront_deduction * (yield_allocated_usd / total_alloc)
            holding_allocated_usd -= upfront_deduction * (holding_allocated_usd / total_alloc)
            mining_allocated_usd -= upfront_deduction * (mining_allocated_usd / total_alloc)

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
        capital_recon_pct=holding_capital_recon_pct,
        extra_yield_strikes=holding_extra_yield_strikes,
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

    # Extract capitalization monthly for commercial fee calculation
    capitalization_monthly_usd = []
    
    # BTC Under Management tracking
    # This tracks all BTC held across buckets that appreciates in value over time
    # BTC is "removed" from management when:
    #   - BTC Holding target price is struck (sold for capital reconstitution)
    #   - Take-profit ladder triggers on mining capitalization
    btc_under_management: List[Dict] = []

    for t in range(sim_months):
        spot_price = btc_prices[t]
        
        y_val = yield_result["monthly_data"][t]["bucket_value_usd"] if t < len(yield_result["monthly_data"]) else 0
        h_val = holding_result["monthly_data"][t]["bucket_value_usd"] if t < len(holding_result["monthly_data"]) else 0

        # Mining bucket value: capitalization (USD mark-to-market)
        m_row = mining_result["monthly_waterfall"][t] if t < len(mining_result["monthly_waterfall"]) else {}
        m_val = m_row.get("capitalization_usd", 0)
        capitalization_monthly_usd.append(m_val)

        total = y_val + h_val + m_val
        
        # ────────────────────────────────────────────────────────
        # BTC Under Management Calculation
        # ────────────────────────────────────────────────────────
        # BTC from Holding bucket (until target is struck)
        h_row = holding_result["monthly_data"][t] if t < len(holding_result["monthly_data"]) else {}
        holding_btc = h_row.get("btc_quantity", 0)
        holding_sold = h_row.get("sold", False)
        
        # BTC from Mining capitalization
        mining_cap_btc = m_row.get("capitalization_btc", 0)
        
        # Total BTC under management
        total_btc_under_mgmt = holding_btc + mining_cap_btc
        total_btc_value_usd = total_btc_under_mgmt * spot_price
        
        # Track sell events
        holding_strike_this_month = False
        if t > 0:
            prev_h_row = holding_result["monthly_data"][t-1] if t-1 < len(holding_result["monthly_data"]) else {}
            if not prev_h_row.get("sold", False) and holding_sold:
                holding_strike_this_month = True
        elif holding_sold:
            holding_strike_this_month = True  # Sold in month 0
        
        # Calculate appreciation vs acquisition cost
        # Holding bucket cost basis
        holding_cost_basis = holding_btc * holding_buying_price if holding_btc > 0 else 0
        holding_current_value = holding_btc * spot_price
        holding_appreciation_usd = holding_current_value - holding_cost_basis if holding_btc > 0 else 0
        
        # Mining capitalization - BTC acquired at various prices (use average entry)
        # For simplicity, track mark-to-market value
        mining_cap_value_usd = m_row.get("capitalization_usd", 0)
        
        btc_under_management.append({
            "month": t,
            "btc_price_usd": round(spot_price, 2),
            # BTC Holding bucket
            "holding_btc": round(holding_btc, 8),
            "holding_value_usd": round(holding_current_value, 2),
            "holding_sold": holding_sold,
            "holding_strike_this_month": holding_strike_this_month,
            # Mining capitalization
            "mining_cap_btc": round(mining_cap_btc, 8),
            "mining_cap_value_usd": round(mining_cap_value_usd, 2),
            # Totals
            "total_btc": round(total_btc_under_mgmt, 8),
            "total_value_usd": round(total_btc_value_usd, 2),
            # Appreciation tracking
            "holding_appreciation_usd": round(holding_appreciation_usd, 2),
            "holding_appreciation_pct": round(holding_appreciation_usd / holding_cost_basis * 100, 2) if holding_cost_basis > 0 else 0,
        })

        monthly_portfolio.append({
            "month": t,
            "yield_value_usd": round(y_val, 2),
            "holding_value_usd": round(h_val, 2),
            "mining_value_usd": round(m_val, 2),
            "total_portfolio_usd": round(total, 2),
        })

    # Calculate commercial fees
    commercial_result = None
    has_commercial = upfront_commercial_pct > 0 or management_fees_pct > 0 or performance_fees_pct > 0
    
    if has_commercial:
        commercial_result = calculate_commercial_fees(
            capital_raised_usd=capital_raised_usd,
            tenor_months=tenor_months,
            upfront_commercial_pct=upfront_commercial_pct,
            management_fees_pct=management_fees_pct,
            performance_fees_pct=performance_fees_pct,
            capitalization_monthly_usd=capitalization_monthly_usd,
            yield_allocated=original_yield_alloc,
            holding_allocated=original_holding_alloc,
            mining_allocated=original_mining_alloc,
        )

    # Aggregated metrics
    final_yield = yield_result["metrics"]["final_value_usd"]
    final_holding = holding_result["metrics"]["final_value_usd"]

    # Mining final value = capitalization
    mining_metrics = mining_result["metrics"]
    final_mining = mining_metrics.get("capitalization_usd_final", 0)

    # Gross portfolio value (before commercial fees)
    gross_final = final_yield + final_holding + final_mining
    
    # Net portfolio value for investors (after commercial fees deducted)
    # Management fees reduce capitalization, performance fees reduce final value
    commercial_deductions = 0.0
    if commercial_result:
        # Management fees are already conceptually captured from capitalization
        # Performance fees reduce final investor returns
        commercial_deductions = (
            commercial_result.get("management_fees_total_usd", 0) +
            commercial_result.get("performance_fee_usd", 0)
        )
    
    # Net portfolio = gross - ongoing fees (upfront already deducted from allocations)
    total_final_net = gross_final - commercial_deductions
    total_return_pct_net = (total_final_net - capital_raised_usd) / capital_raised_usd if capital_raised_usd > 0 else 0
    
    # Gross return (excluding commercial impact) for display
    total_return_pct_gross = (gross_final - capital_raised_usd) / capital_raised_usd if capital_raised_usd > 0 else 0

    # Compute total yield across all buckets
    total_yield_paid = (
        yield_result["metrics"]["total_yield_usd"] +
        mining_metrics.get("cumulative_yield_paid_usd", 0)
    )

    effective_apr_net = (total_yield_paid / capital_raised_usd) / (sim_months / 12.0) if capital_raised_usd > 0 and sim_months > 0 else 0

    # Decision based on mining bucket health (the riskiest component)
    decision = mining_result.get("decision", "APPROVED")
    decision_reasons = mining_result.get("decision_reasons", [])

    # BTC Under Management summary metrics
    final_btc_mgmt = btc_under_management[-1] if btc_under_management else {}
    holding_target_hit = holding_result["metrics"].get("target_hit", False)
    holding_sell_price = holding_result["metrics"].get("sell_price_usd")
    
    # Calculate total BTC appreciation over the product lifetime
    # Peak BTC value (highest point before any sales)
    peak_btc_value = max((m["total_value_usd"] for m in btc_under_management), default=0)
    peak_btc_qty = max((m["total_btc"] for m in btc_under_management), default=0)
    
    # BTC appreciation yield (value generated from BTC price increase)
    initial_holding_btc = btc_under_management[0]["holding_btc"] if btc_under_management else 0
    initial_holding_value = initial_holding_btc * holding_buying_price
    
    btc_under_management_metrics = {
        # Final state
        "final_total_btc": round(final_btc_mgmt.get("total_btc", 0), 8),
        "final_total_value_usd": round(final_btc_mgmt.get("total_value_usd", 0), 2),
        "final_holding_btc": round(final_btc_mgmt.get("holding_btc", 0), 8),
        "final_mining_cap_btc": round(final_btc_mgmt.get("mining_cap_btc", 0), 8),
        # Peak values
        "peak_btc_qty": round(peak_btc_qty, 8),
        "peak_btc_value_usd": round(peak_btc_value, 2),
        # BTC Holding target strike info
        "holding_target_struck": holding_target_hit,
        "holding_strike_month": holding_sell_month,
        "holding_strike_price_usd": round(holding_sell_price, 2) if holding_sell_price else None,
        # BTC acquired from mining
        "mining_total_btc_accumulated": round(mining_metrics.get("capitalization_btc_final", 0), 8),
    }

    aggregated = {
        "monthly_portfolio": monthly_portfolio,
        "btc_under_management": btc_under_management,
        "btc_under_management_metrics": btc_under_management_metrics,
        "metrics": {
            "capital_raised_usd": round(capital_raised_usd, 2),
            # Net figures (what investors actually receive after commercial)
            "final_portfolio_usd": round(total_final_net, 2),
            "total_return_pct": round(total_return_pct_net, 4),
            "total_yield_paid_usd": round(total_yield_paid, 2),
            "effective_apr": round(effective_apr_net, 4),
            "capital_preservation_ratio": round(total_final_net / capital_raised_usd, 4) if capital_raised_usd > 0 else 0,
            # Gross figures (product performance before commercial)
            "gross_final_portfolio_usd": round(gross_final, 2),
            "gross_total_return_pct": round(total_return_pct_gross, 4),
        },
        "decision": decision,
        "decision_reasons": decision_reasons,
    }

    return {
        "yield_bucket": yield_result,
        "btc_holding_bucket": holding_result,
        "mining_bucket": mining_result,
        "commercial": commercial_result,
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
    # Optional parameters (with defaults) must come last
    holding_capital_recon_pct: float = 100.0,
    holding_extra_yield_strikes: List[Dict] = None,
    mining_take_profit_ladder: List[Dict] = None,
    # Commercial fees
    upfront_commercial_pct: float = 0.0,
    management_fees_pct: float = 0.0,
    performance_fees_pct: float = 0.0,
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
            holding_capital_recon_pct=holding_capital_recon_pct,
            holding_extra_yield_strikes=holding_extra_yield_strikes,
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
            upfront_commercial_pct=upfront_commercial_pct,
            management_fees_pct=management_fees_pct,
            performance_fees_pct=performance_fees_pct,
        )

    return results
