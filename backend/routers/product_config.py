"""Product Configuration router — 3-bucket capital allocation with multi-scenario simulation."""
import logging
from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select
from typing import Dict, List

from ..database import engine as db_engine
from ..models import (
    BTCPriceCurve, NetworkCurve, Miner, HostingSite, ProductConfigRun,
)
from ..schemas import ProductConfigRequest, ProductConfigResponse
from ..engine.product_multi_bucket import simulate_all_scenarios

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/product-config", tags=["product-config"])


def _apply_btc_band(prices: List[float], curve: BTCPriceCurve, scenario: str) -> List[float]:
    """Apply confidence band to BTC prices for bear/bull when same curve is reused.

    If the stored curve has a confidence_band_pct > 0 in its input snapshot,
    bear gets the lower bound and bull gets the upper bound.
    """
    if scenario == "base":
        return prices
    snap = curve.input_snapshot or {}
    band_pct = snap.get("confidence_band_pct", 0)
    if not band_pct or band_pct <= 0:
        logger.warning(
            "BTC curve '%s' (%s) reused for %s scenario but has no confidence band — "
            "results will be identical to base.",
            curve.name, curve.id, scenario,
        )
        return prices
    band = band_pct / 100.0
    if scenario == "bear":
        return [round(p * (1 - band), 2) for p in prices]
    elif scenario == "bull":
        return [round(p * (1 + band), 2) for p in prices]
    return prices


def _apply_net_band(hashprices: List[float], curve: NetworkCurve, scenario: str) -> List[float]:
    """Apply confidence band to network hashprices for bear/bull when same curve is reused.

    Bear scenario gets *lower* hashprice (harder to mine profitably),
    Bull scenario gets *higher* hashprice (more profitable mining).
    """
    if scenario == "base":
        return hashprices
    snap = curve.input_snapshot or {}
    band_pct = snap.get("confidence_band_pct", 0)
    if not band_pct or band_pct <= 0:
        logger.warning(
            "Network curve '%s' (%s) reused for %s scenario but has no confidence band — "
            "results will be identical to base.",
            curve.name, curve.id, scenario,
        )
        return hashprices
    band = band_pct / 100.0
    if scenario == "bear":
        return [round(h * (1 - band), 10) for h in hashprices]
    elif scenario == "bull":
        return [round(h * (1 + band), 10) for h in hashprices]
    return hashprices


@router.post("/simulate", response_model=ProductConfigResponse)
def simulate_product(req: ProductConfigRequest):
    """Run the 3-bucket product simulation across bear/base/bull scenarios."""

    # Validate bucket allocation sums to capital
    bucket_total = (
        req.yield_bucket.allocated_usd +
        req.btc_holding_bucket.allocated_usd +
        req.mining_bucket.allocated_usd
    )
    if abs(bucket_total - req.capital_raised_usd) > 0.01:
        raise HTTPException(
            status_code=422,
            detail=f"Bucket allocations ({bucket_total:,.2f}) must equal capital raised ({req.capital_raised_usd:,.2f})"
        )

    with Session(db_engine) as session:
        # Load curves and resources for each scenario
        scenario_curves: Dict[str, Dict] = {}

        # Detect if same curve ID is reused across scenarios (fallback case)
        btc_ids = {s: req.btc_price_curve_ids.get(s) for s in ["bear", "base", "bull"]}
        net_ids = {s: req.network_curve_ids.get(s) for s in ["bear", "base", "bull"]}
        btc_same = btc_ids["bear"] == btc_ids["base"] == btc_ids["bull"]
        net_same = net_ids["bear"] == net_ids["base"] == net_ids["bull"]

        if btc_same:
            logger.info("Same BTC curve ID used for all scenarios — applying confidence bands")
        if net_same:
            logger.info("Same Network curve ID used for all scenarios — applying confidence bands")

        for scenario in ["bear", "base", "bull"]:
            btc_id = req.btc_price_curve_ids.get(scenario)
            net_id = req.network_curve_ids.get(scenario)

            if not btc_id or not net_id:
                raise HTTPException(
                    status_code=422,
                    detail=f"Missing {scenario} BTC or network curve ID"
                )

            btc_curve = session.get(BTCPriceCurve, btc_id)
            if not btc_curve:
                raise HTTPException(status_code=404, detail=f"BTC curve {btc_id} not found")

            net_curve = session.get(NetworkCurve, net_id)
            if not net_curve:
                raise HTTPException(status_code=404, detail=f"Network curve {net_id} not found")

            # When the same curve is reused for bear/bull, apply the stored
            # confidence band to differentiate the scenarios.
            btc_prices = btc_curve.monthly_prices
            hashprices = net_curve.hashprice_btc_per_ph_day

            if btc_same:
                btc_prices = _apply_btc_band(btc_prices, btc_curve, scenario)
            if net_same:
                hashprices = _apply_net_band(hashprices, net_curve, scenario)

            scenario_curves[scenario] = {
                "btc_prices": btc_prices,
                "hashprice_btc_per_ph_day": hashprices,
            }

        # Load miner and hosting site for mining bucket
        miner = session.get(Miner, req.mining_bucket.miner_id)
        if not miner:
            raise HTTPException(status_code=404, detail=f"Miner {req.mining_bucket.miner_id} not found")

        site = session.get(HostingSite, req.mining_bucket.hosting_site_id)
        if not site:
            raise HTTPException(status_code=404, detail=f"Hosting site {req.mining_bucket.hosting_site_id} not found")

        # Compute target sell price: the price at which selling the BTC held
        # covers both the holding AND mining initial investments.
        # Formula: (holding_allocated + mining_allocated) / (holding_allocated / buying_price)
        holding_alloc = req.btc_holding_bucket.allocated_usd
        mining_alloc = req.mining_bucket.allocated_usd
        buying_price = req.btc_holding_bucket.buying_price_usd

        if req.btc_holding_bucket.target_sell_price_usd is not None:
            target_sell_price = req.btc_holding_bucket.target_sell_price_usd
        elif holding_alloc > 0 and buying_price > 0:
            btc_quantity = holding_alloc / buying_price
            target_sell_price = (holding_alloc + mining_alloc) / btc_quantity
        else:
            target_sell_price = buying_price  # fallback

        # Extract commercial fee configuration
        upfront_commercial_pct = 0.0
        management_fees_pct = 0.0
        performance_fees_pct = 0.0
        if req.commercial:
            upfront_commercial_pct = req.commercial.upfront_commercial_pct
            management_fees_pct = req.commercial.management_fees_pct
            performance_fees_pct = req.commercial.performance_fees_pct

        # Run simulation across all scenarios
        scenario_results = simulate_all_scenarios(
            scenario_curves=scenario_curves,
            capital_raised_usd=req.capital_raised_usd,
            tenor_months=req.product_tenor_months,
            # Yield bucket
            yield_allocated_usd=req.yield_bucket.allocated_usd,
            yield_base_apr=req.yield_bucket.base_apr,
            yield_apr_schedule=req.yield_bucket.apr_schedule,
            # BTC holding bucket (principal reconstitution + extra yield)
            holding_allocated_usd=req.btc_holding_bucket.allocated_usd,
            holding_buying_price=req.btc_holding_bucket.buying_price_usd,
            holding_target_sell_price=target_sell_price,
            holding_capital_recon_pct=req.btc_holding_bucket.capital_recon_pct,
            holding_extra_yield_strikes=[s.model_dump() for s in req.btc_holding_bucket.extra_yield_strikes],
            # Mining bucket (yield + capitalization)
            mining_allocated_usd=req.mining_bucket.allocated_usd,
            miner_hashrate_th=miner.hashrate_th,
            miner_power_w=miner.power_w,
            miner_count=req.mining_bucket.miner_count,
            miner_lifetime_months=miner.lifetime_months,
            miner_maintenance_pct=miner.maintenance_pct,
            electricity_rate=site.electricity_price_usd_per_kwh,
            hosting_fee_per_kw_month=site.hosting_fee_usd_per_kw_month,
            uptime=site.uptime_expectation,
            curtailment_pct=site.curtailment_pct,
            mining_base_yield_apr=req.mining_bucket.base_yield_apr,
            mining_bonus_yield_apr=req.mining_bucket.bonus_yield_apr,
            mining_take_profit_ladder=[tp.model_dump() for tp in req.mining_bucket.take_profit_ladder],
            # Commercial fees
            upfront_commercial_pct=upfront_commercial_pct,
            management_fees_pct=management_fees_pct,
            performance_fees_pct=performance_fees_pct,
        )

        # Save run
        run = ProductConfigRun(
            input_snapshot=req.model_dump(),
            scenario_results=scenario_results,
            created_by=req.user.user_id,
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        return ProductConfigResponse(
            id=run.id,
            scenario_results=scenario_results,
            created_at=run.created_at,
        )


@router.get("/runs")
def list_runs():
    """List all product configuration runs."""
    with Session(db_engine) as session:
        runs = session.exec(
            select(ProductConfigRun).order_by(ProductConfigRun.created_at.desc())
        ).all()
        return [
            {
                "id": r.id,
                "created_by": r.created_by,
                "created_at": r.created_at.isoformat(),
                "capital_raised_usd": r.input_snapshot.get("capital_raised_usd"),
            }
            for r in runs
        ]


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    """Get a specific product configuration run with full results."""
    with Session(db_engine) as session:
        run = session.get(ProductConfigRun, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return {
            "id": run.id,
            "input_snapshot": run.input_snapshot,
            "scenario_results": run.scenario_results,
            "created_by": run.created_by,
            "created_at": run.created_at.isoformat(),
        }
