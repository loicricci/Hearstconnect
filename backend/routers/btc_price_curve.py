"""API routes for BTC Price Curve (Page 1)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import BTCPriceCurve
from ..schemas import BTCPriceCurveRequest, BTCPriceCurveResponse
from ..engine.btc_price import generate_btc_price_curve, generate_btc_price_curve_ml
from ..auth import get_current_user, require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/btc-price-curve", tags=["BTC Price Curve"])


@router.post("/generate", response_model=BTCPriceCurveResponse)
def generate_curve(req: BTCPriceCurveRequest, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    upper_bound = None
    lower_bound = None
    model_info = None

    if req.mode == "ml_forecast":
        # ── ML Forecast Mode ──
        try:
            monthly_prices, lower_bound, upper_bound, model_info = (
                generate_btc_price_curve_ml(
                    model_type=req.model_type,
                    forecast_months=req.months,
                    confidence=req.confidence_interval,
                )
            )
        except (RuntimeError, ValueError) as e:
            raise HTTPException(status_code=422, detail=str(e))
    else:
        # ── Deterministic Mode (existing) ──
        monthly_prices = generate_btc_price_curve(
            start_price=req.start_price,
            months=req.months,
            anchor_points=req.anchor_points,
            interpolation_type=req.interpolation_type,
            custom_monthly_prices=req.custom_monthly_prices,
            volatility_enabled=req.volatility_enabled,
            volatility_seed=req.volatility_seed or 42,
        )

        # Deterministic confidence band (bull / bear envelope)
        if req.confidence_band_pct > 0:
            band = req.confidence_band_pct / 100.0
            upper_bound = [round(p * (1 + band), 2) for p in monthly_prices]
            lower_bound = [round(p * (1 - band), 2) for p in monthly_prices]

    # Build input snapshot; for ML mode, persist computed bounds for later retrieval
    snapshot = req.model_dump()
    if req.mode == "ml_forecast":
        if upper_bound is not None:
            snapshot["_computed_upper_bound"] = upper_bound
        if lower_bound is not None:
            snapshot["_computed_lower_bound"] = lower_bound
        if model_info is not None:
            snapshot["_computed_model_info"] = model_info

    curve = BTCPriceCurve(
        name=req.name,
        scenario=req.scenario,
        start_date=req.start_date,
        months=req.months,
        monthly_prices=monthly_prices,
        anchor_points={str(k): v for k, v in req.anchor_points.items()},
        interpolation_type=req.interpolation_type if req.mode == "deterministic" else "ml",
        volatility_enabled=req.volatility_enabled if req.mode == "deterministic" else False,
        volatility_seed=req.volatility_seed if req.mode == "deterministic" else None,
        input_snapshot=snapshot,
        created_by=user["user_id"],
    )

    db.add(curve)
    db.commit()
    db.refresh(curve)

    return BTCPriceCurveResponse(
        id=curve.id,
        name=curve.name,
        scenario=curve.scenario,
        start_date=curve.start_date,
        months=curve.months,
        monthly_prices=curve.monthly_prices,
        upper_bound=upper_bound,
        lower_bound=lower_bound,
        model_info=model_info,
        mode=req.mode,
        created_by=curve.created_by,
        created_at=curve.created_at,
    )


@router.get("/list", response_model=List[BTCPriceCurveResponse])
def list_curves(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    curves = db.query(BTCPriceCurve).order_by(BTCPriceCurve.created_at.desc()).limit(50).all()
    return [
        BTCPriceCurveResponse(
            id=c.id, name=c.name, scenario=c.scenario, start_date=c.start_date,
            months=c.months, monthly_prices=c.monthly_prices,
            mode=c.input_snapshot.get("mode", "deterministic") if c.input_snapshot else "deterministic",
            created_by=c.created_by, created_at=c.created_at,
        ) for c in curves
    ]


@router.delete("/{curve_id}")
def delete_curve(curve_id: str, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    require_permission(user, "delete")
    curve = db.query(BTCPriceCurve).filter(BTCPriceCurve.id == curve_id).first()
    if not curve:
        raise HTTPException(status_code=404, detail="Curve not found")
    db.delete(curve)
    db.commit()
    return {"ok": True, "deleted_id": curve_id}


@router.get("/{curve_id}", response_model=BTCPriceCurveResponse)
def get_curve(curve_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    curve = db.query(BTCPriceCurve).filter(BTCPriceCurve.id == curve_id).first()
    if not curve:
        raise HTTPException(status_code=404, detail="Curve not found")

    snap = curve.input_snapshot or {}
    mode = snap.get("mode", "deterministic")
    upper_bound = None
    lower_bound = None
    model_info = None

    if mode == "deterministic":
        # Recalculate deterministic bear/bull envelope from stored params
        band_pct = snap.get("confidence_band_pct", 0)
        if band_pct and band_pct > 0:
            band = band_pct / 100.0
            upper_bound = [round(p * (1 + band), 2) for p in curve.monthly_prices]
            lower_bound = [round(p * (1 - band), 2) for p in curve.monthly_prices]
    elif mode == "ml_forecast":
        # Retrieve ML-computed bounds persisted in input_snapshot
        upper_bound = snap.get("_computed_upper_bound")
        lower_bound = snap.get("_computed_lower_bound")
        model_info = snap.get("_computed_model_info")

    return BTCPriceCurveResponse(
        id=curve.id, name=curve.name, scenario=curve.scenario, start_date=curve.start_date,
        months=curve.months, monthly_prices=curve.monthly_prices,
        upper_bound=upper_bound,
        lower_bound=lower_bound,
        model_info=model_info,
        mode=mode,
        created_by=curve.created_by, created_at=curve.created_at,
    )
