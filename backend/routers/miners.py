"""API routes for Miner Catalog (Page 3)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from ..database import get_db
from ..models import Miner, MinerSimRun, BTCPriceCurve, NetworkCurve
from ..schemas import (
    MinerCreate, MinerUpdate, MinerResponse,
    MinerSimRequest, MinerSimResponse,
)
from ..engine.miner_sim import simulate_miner
from ..auth import get_current_user, require_permission

router = APIRouter(prefix="/api/miners", tags=["Miner Catalog"])


@router.post("/", response_model=MinerResponse)
def create_miner(req: MinerCreate, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    require_permission(user, "write")

    efficiency = req.power_w / req.hashrate_th if req.hashrate_th > 0 else None

    miner = Miner(
        name=req.name,
        hashrate_th=req.hashrate_th,
        power_w=req.power_w,
        price_usd=req.price_usd,
        lifetime_months=req.lifetime_months,
        maintenance_pct=req.maintenance_pct,
        efficiency_j_th=efficiency,
    )
    db.add(miner)
    db.commit()
    db.refresh(miner)
    return _to_response(miner)


@router.get("/", response_model=List[MinerResponse])
def list_miners(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    miners = db.query(Miner).order_by(Miner.created_at.desc()).all()
    return [_to_response(m) for m in miners]


@router.get("/{miner_id}", response_model=MinerResponse)
def get_miner(miner_id: str, db: Session = Depends(get_db),
              user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    miner = db.query(Miner).filter(Miner.id == miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")
    return _to_response(miner)


@router.put("/{miner_id}", response_model=MinerResponse)
def update_miner(miner_id: str, req: MinerUpdate, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    require_permission(user, "write")
    miner = db.query(Miner).filter(Miner.id == miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")

    update_data = req.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(miner, field, value)

    if miner.hashrate_th > 0:
        miner.efficiency_j_th = miner.power_w / miner.hashrate_th
    miner.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(miner)
    return _to_response(miner)


@router.delete("/{miner_id}")
def delete_miner(miner_id: str, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    require_permission(user, "delete")
    miner = db.query(Miner).filter(Miner.id == miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")
    db.delete(miner)
    db.commit()
    return {"status": "deleted", "id": miner_id}


@router.post("/simulate", response_model=MinerSimResponse)
def simulate(req: MinerSimRequest, db: Session = Depends(get_db),
             user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    miner = db.query(Miner).filter(Miner.id == req.miner_id).first()
    if not miner:
        raise HTTPException(status_code=404, detail="Miner not found")

    btc_curve = db.query(BTCPriceCurve).filter(BTCPriceCurve.id == req.btc_price_curve_id).first()
    if not btc_curve:
        raise HTTPException(status_code=404, detail="BTC price curve not found")

    net_curve = db.query(NetworkCurve).filter(NetworkCurve.id == req.network_curve_id).first()
    if not net_curve:
        raise HTTPException(status_code=404, detail="Network curve not found")

    results = simulate_miner(
        hashrate_th=miner.hashrate_th,
        power_w=miner.power_w,
        price_usd=miner.price_usd,
        lifetime_months=miner.lifetime_months,
        maintenance_pct=miner.maintenance_pct,
        btc_prices=btc_curve.monthly_prices[:req.months],
        hashprice_btc_per_ph_day=net_curve.hashprice_btc_per_ph_day[:req.months],
        electricity_rate=req.electricity_rate,
        uptime=req.uptime,
        months=req.months,
    )

    run = MinerSimRun(
        miner_id=req.miner_id,
        btc_price_curve_id=req.btc_price_curve_id,
        network_curve_id=req.network_curve_id,
        electricity_rate=req.electricity_rate,
        uptime=req.uptime,
        input_snapshot=req.model_dump(),
        outputs=results,
        created_by=user["user_id"],
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    return MinerSimResponse(
        id=run.id,
        miner_id=req.miner_id,
        monthly_cashflows=results["monthly_cashflows"],
        total_btc_mined=results["total_btc_mined"],
        total_revenue_usd=results["total_revenue_usd"],
        total_electricity_cost_usd=results["total_electricity_cost_usd"],
        total_net_usd=results["total_net_usd"],
        break_even_month=results["break_even_month"],
        created_at=run.created_at,
    )


def _to_response(m: Miner) -> MinerResponse:
    return MinerResponse(
        id=m.id, name=m.name, hashrate_th=m.hashrate_th,
        power_w=m.power_w, price_usd=m.price_usd,
        lifetime_months=m.lifetime_months,
        maintenance_pct=m.maintenance_pct,
        efficiency_j_th=m.efficiency_j_th,
        created_at=m.created_at,
    )
