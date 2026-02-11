"""API routes for Operational Performance (Page 5)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import OpsHistory, OpsCalibrationRun, BTCPriceCurve, NetworkCurve, Miner
from ..schemas import (
    OpsImportRequest, OpsCalibrateRequest, OpsCalibrateResponse,
)
from ..engine.ops_calibration import calibrate_ops
from ..auth import get_current_user, require_permission

router = APIRouter(prefix="/api/ops", tags=["Ops Performance"])


@router.post("/import-history")
def import_history(req: OpsImportRequest, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    require_permission(user, "write")

    imported = []
    for entry in req.entries:
        record = OpsHistory(
            month=entry.month,
            btc_produced=entry.btc_produced,
            uptime=entry.uptime,
            energy_kwh=entry.energy_kwh,
            downtime_events=entry.downtime_events,
            notes=entry.notes,
        )
        db.add(record)
        imported.append(entry.month)

    db.commit()
    return {"status": "imported", "months": imported, "count": len(imported)}


@router.get("/history")
def get_history(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    records = db.query(OpsHistory).order_by(OpsHistory.month).all()
    return [
        {
            "id": r.id, "month": r.month,
            "btc_produced": r.btc_produced, "uptime": r.uptime,
            "energy_kwh": r.energy_kwh, "downtime_events": r.downtime_events,
            "notes": r.notes,
        }
        for r in records
    ]


@router.post("/calibrate", response_model=OpsCalibrateResponse)
def calibrate(req: OpsCalibrateRequest, db: Session = Depends(get_db),
              user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    # Load dependencies
    btc_curve = db.query(BTCPriceCurve).filter(BTCPriceCurve.id == req.btc_price_curve_id).first()
    if not btc_curve:
        raise HTTPException(status_code=404, detail="BTC price curve not found")

    net_curve = db.query(NetworkCurve).filter(NetworkCurve.id == req.network_curve_id).first()
    if not net_curve:
        raise HTTPException(status_code=404, detail="Network curve not found")

    miner = db.query(Miner).filter(Miner.id == req.miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")

    history = db.query(OpsHistory).order_by(OpsHistory.month).all()
    if not history:
        raise HTTPException(status_code=400, detail="No operational history data found")

    history_dicts = [
        {"month": h.month, "btc_produced": h.btc_produced,
         "uptime": h.uptime, "energy_kwh": h.energy_kwh}
        for h in history
    ]

    result = calibrate_ops(
        history=history_dicts,
        btc_prices=btc_curve.monthly_prices,
        hashprice_btc_per_ph_day=net_curve.hashprice_btc_per_ph_day,
        hashrate_th=miner.hashrate_th,
        power_w=miner.power_w,
        assumed_uptime=req.assumed_uptime,
        electricity_rate=req.electricity_rate,
    )

    run = OpsCalibrationRun(
        input_snapshot=req.model_dump(),
        factors={
            "realized_uptime_factor": result["realized_uptime_factor"],
            "realized_efficiency_factor": result["realized_efficiency_factor"],
            "production_adjustment": result["production_adjustment"],
        },
        outputs=result,
        flags=result["flags"],
        created_by=user["user_id"],
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    return OpsCalibrateResponse(
        id=run.id,
        realized_uptime_factor=result["realized_uptime_factor"],
        realized_efficiency_factor=result["realized_efficiency_factor"],
        production_adjustment=result["production_adjustment"],
        flags=result["flags"],
        monthly_comparison=result["monthly_comparison"],
        created_at=run.created_at,
    )


@router.get("/calibration-runs")
def list_calibration_runs(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    runs = db.query(OpsCalibrationRun).order_by(OpsCalibrationRun.created_at.desc()).limit(20).all()
    return [
        {
            "id": r.id, "factors": r.factors, "flags": r.flags,
            "created_by": r.created_by, "created_at": r.created_at.isoformat(),
        }
        for r in runs
    ]
