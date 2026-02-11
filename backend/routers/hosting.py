"""API routes for Hosting Opportunities (Page 4)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from ..database import get_db
from ..models import HostingSite, HostingAllocation, HostingAllocationRun, Miner
from ..schemas import (
    HostingSiteCreate, HostingSiteUpdate, HostingSiteResponse,
    HostingAllocateRequest, HostingAllocateResponse,
)
from ..engine.hosting_alloc import compute_allocation
from ..auth import get_current_user, require_permission

router = APIRouter(prefix="/api/hosting", tags=["Hosting"])


@router.post("/", response_model=HostingSiteResponse)
def create_site(req: HostingSiteCreate, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    require_permission(user, "write")
    site = HostingSite(**req.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    return _to_response(site)


@router.get("/", response_model=List[HostingSiteResponse])
def list_sites(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    sites = db.query(HostingSite).order_by(HostingSite.created_at.desc()).all()
    return [_to_response(s) for s in sites]


@router.get("/{site_id}", response_model=HostingSiteResponse)
def get_site(site_id: str, db: Session = Depends(get_db),
             user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    site = db.query(HostingSite).filter(HostingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return _to_response(site)


@router.put("/{site_id}", response_model=HostingSiteResponse)
def update_site(site_id: str, req: HostingSiteUpdate, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    require_permission(user, "write")
    site = db.query(HostingSite).filter(HostingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    update_data = req.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(site, field, value)
    site.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(site)
    return _to_response(site)


@router.delete("/{site_id}")
def delete_site(site_id: str, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    require_permission(user, "delete")
    site = db.query(HostingSite).filter(HostingSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    db.delete(site)
    db.commit()
    return {"status": "deleted", "id": site_id}


@router.post("/allocate", response_model=HostingAllocateResponse)
def allocate(req: HostingAllocateRequest, db: Session = Depends(get_db),
             user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    # Load sites and miners
    sites_dict = {}
    miners_dict = {}

    site_ids = set(a.site_id for a in req.allocations)
    miner_ids = set(a.miner_id for a in req.allocations)

    for sid in site_ids:
        site = db.query(HostingSite).filter(HostingSite.id == sid).first()
        if not site:
            raise HTTPException(status_code=404, detail=f"Site {sid} not found")
        sites_dict[sid] = {
            "name": site.name,
            "electricity_price_usd_per_kwh": site.electricity_price_usd_per_kwh,
            "uptime_expectation": site.uptime_expectation,
            "capacity_mw_available": site.capacity_mw_available,
        }

    for mid in miner_ids:
        miner = db.query(Miner).filter(Miner.id == mid).first()
        if not miner:
            raise HTTPException(status_code=404, detail=f"Miner {mid} not found")
        miners_dict[mid] = {
            "name": miner.name,
            "power_w": miner.power_w,
            "hashrate_th": miner.hashrate_th,
        }

    alloc_dicts = [a.model_dump() for a in req.allocations]
    result = compute_allocation(alloc_dicts, sites_dict, miners_dict)

    # Save run
    run = HostingAllocationRun(
        input_snapshot=req.model_dump(),
        outputs=result,
        warnings=result["warnings"],
        created_by=user["user_id"],
    )
    db.add(run)

    # Save individual allocations
    for alloc in req.allocations:
        ha = HostingAllocation(
            run_id=run.id,
            site_id=alloc.site_id,
            miner_id=alloc.miner_id,
            miner_count=alloc.miner_count,
        )
        db.add(ha)

    db.commit()
    db.refresh(run)

    return HostingAllocateResponse(
        id=run.id,
        blended_electricity_rate=result["blended_electricity_rate"],
        blended_uptime=result["blended_uptime"],
        total_power_kw=result["total_power_kw"],
        warnings=result["warnings"],
        allocations=alloc_dicts,
        created_at=run.created_at,
    )


def _to_response(s: HostingSite) -> HostingSiteResponse:
    return HostingSiteResponse(
        id=s.id, name=s.name,
        electricity_price_usd_per_kwh=s.electricity_price_usd_per_kwh,
        hosting_fee_usd_per_kw_month=s.hosting_fee_usd_per_kw_month,
        uptime_expectation=s.uptime_expectation,
        curtailment_pct=s.curtailment_pct,
        capacity_mw_available=s.capacity_mw_available,
        lockup_months=s.lockup_months,
        notice_period_days=s.notice_period_days,
        created_at=s.created_at,
    )
