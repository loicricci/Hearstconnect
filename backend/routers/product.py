"""API routes for Product Performance (Page 6)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import (
    ProductRun, BTCPriceCurve, NetworkCurve, Miner,
    HostingSite, OpsCalibrationRun,
)
from ..schemas import ProductSimRequest, ProductSimResponse
from ..engine.product_waterfall import simulate_product_3y
from ..auth import get_current_user, require_permission

router = APIRouter(prefix="/api/product", tags=["Product Performance"])


@router.post("/simulate-3y", response_model=ProductSimResponse)
def simulate_product(req: ProductSimRequest, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    # Load all dependencies
    btc_curve = db.query(BTCPriceCurve).filter(BTCPriceCurve.id == req.btc_price_curve_id).first()
    if not btc_curve:
        raise HTTPException(status_code=404, detail="BTC price curve not found")

    net_curve = db.query(NetworkCurve).filter(NetworkCurve.id == req.network_curve_id).first()
    if not net_curve:
        raise HTTPException(status_code=404, detail="Network curve not found")

    miner = db.query(Miner).filter(Miner.id == req.miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")

    hosting = db.query(HostingSite).filter(HostingSite.id == req.hosting_site_id).first()
    if not hosting:
        raise HTTPException(status_code=404, detail="Hosting site not found")

    # Calibration factors (optional)
    cal_uptime = 1.0
    cal_prod = 1.0
    if req.calibration_run_id:
        cal_run = db.query(OpsCalibrationRun).filter(
            OpsCalibrationRun.id == req.calibration_run_id
        ).first()
        if cal_run and cal_run.factors:
            cal_uptime = cal_run.factors.get("realized_uptime_factor", 1.0)
            cal_prod = cal_run.factors.get("production_adjustment", 1.0)

    # Take-profit ladder
    tp_ladder = [{"price_trigger": tp.price_trigger, "sell_pct": tp.sell_pct}
                 for tp in req.take_profit_ladder]

    result = simulate_product_3y(
        btc_prices=btc_curve.monthly_prices[:req.product_tenor_months],
        hashprice_btc_per_ph_day=net_curve.hashprice_btc_per_ph_day[:req.product_tenor_months],
        miner_hashrate_th=miner.hashrate_th,
        miner_power_w=miner.power_w,
        miner_count=req.miner_count,
        miner_lifetime_months=req.miner_lifetime_months,
        miner_maintenance_pct=miner.maintenance_pct,
        electricity_rate=hosting.electricity_price_usd_per_kwh,
        hosting_fee_per_kw_month=hosting.hosting_fee_usd_per_kw_month,
        uptime=hosting.uptime_expectation,
        curtailment_pct=hosting.curtailment_pct,
        capital_raised_usd=req.capital_raised_usd,
        product_tenor_months=req.product_tenor_months,
        base_yield_apr=getattr(req, 'base_yield_apr', 0.08),
        bonus_yield_apr=getattr(req, 'bonus_yield_apr', 0.04),
        holding_sell_month=None,  # Legacy endpoint has no holding bucket
        calibration_uptime_factor=cal_uptime,
        calibration_production_adj=cal_prod,
        take_profit_ladder=tp_ladder,
    )

    run = ProductRun(
        input_snapshot=req.model_dump(),
        outputs=result.get("metrics", {}),
        monthly_waterfall=result.get("monthly_waterfall", []),
        metrics=result.get("metrics", {}),
        flags=result.get("flags", []),
        decision=result.get("decision", "PENDING"),
        decision_reasons=result.get("decision_reasons", []),
        created_by=user["user_id"],
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    return ProductSimResponse(
        id=run.id,
        monthly_waterfall=result["monthly_waterfall"],
        metrics=result["metrics"],
        flags=result["flags"],
        decision=result["decision"],
        decision_reasons=result["decision_reasons"],
        created_at=run.created_at,
    )


@router.get("/runs")
def list_runs(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    runs = db.query(ProductRun).order_by(ProductRun.created_at.desc()).limit(20).all()
    return [
        {
            "id": r.id, "decision": r.decision,
            "decision_reasons": r.decision_reasons,
            "flags_count": len(r.flags),
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat(),
        }
        for r in runs
    ]


@router.get("/runs/{run_id}", response_model=ProductSimResponse)
def get_run(run_id: str, db: Session = Depends(get_db),
            user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    run = db.query(ProductRun).filter(ProductRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Product run not found")
    return ProductSimResponse(
        id=run.id,
        monthly_waterfall=run.monthly_waterfall,
        metrics=run.metrics,
        flags=run.flags,
        decision=run.decision,
        decision_reasons=run.decision_reasons,
        created_at=run.created_at,
    )
