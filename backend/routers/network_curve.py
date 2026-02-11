"""API routes for Network Curve (Page 2)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import NetworkCurve
from ..schemas import NetworkCurveRequest, NetworkCurveResponse
from ..engine.network import generate_network_curve, generate_network_curve_ml
from ..auth import get_current_user, require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/network-curve", tags=["Network Curve"])


@router.post("/generate", response_model=NetworkCurveResponse)
def generate_curve(req: NetworkCurveRequest, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    require_permission(user, "simulate")

    confidence_bands = None
    model_info = None

    if req.mode == "ml_forecast":
        # ── ML Forecast Mode ──
        try:
            ml_result = generate_network_curve_ml(
                model_type=req.model_type,
                forecast_months=req.months,
                confidence=req.confidence_interval,
                halving_enabled=req.halving_enabled,
                start_date=req.start_date,
            )
        except (RuntimeError, ValueError) as e:
            raise HTTPException(status_code=422, detail=str(e))

        difficulty = ml_result["difficulty"]
        hashprice = ml_result["hashprice_btc_per_ph_day"]
        fees = ml_result["fees_per_block_btc"]
        hashrate = ml_result["network_hashrate_eh"]
        warnings = ml_result["warnings"]
        model_info = ml_result["model_info"]

        confidence_bands = {
            "difficulty": {
                "lower": ml_result["difficulty_lower"],
                "upper": ml_result["difficulty_upper"],
            },
            "hashrate": {
                "lower": ml_result["hashrate_lower"],
                "upper": ml_result["hashrate_upper"],
            },
            "fees": {
                "lower": ml_result["fees_lower"],
                "upper": ml_result["fees_upper"],
            },
            "hashprice": {
                "lower": ml_result["hashprice_lower"],
                "upper": ml_result["hashprice_upper"],
            },
        }
    else:
        # ── Deterministic Mode (existing) ──
        difficulty, hashprice, fees, hashrate, warnings = generate_network_curve(
            start_date=req.start_date,
            months=req.months,
            starting_network_hashrate_eh=req.starting_network_hashrate_eh,
            monthly_difficulty_growth_rate=req.monthly_difficulty_growth_rate,
            halving_enabled=req.halving_enabled,
            fee_regime=req.fee_regime,
            starting_fees_per_block_btc=req.starting_fees_per_block_btc,
        )

        # Deterministic confidence band (bull / bear envelope)
        if req.confidence_band_pct > 0:
            band = req.confidence_band_pct / 100.0
            confidence_bands = {
                "difficulty": {
                    "lower": [round(v * (1 - band), 0) for v in difficulty],
                    "upper": [round(v * (1 + band), 0) for v in difficulty],
                },
                "hashrate": {
                    "lower": [round(v * (1 - band), 2) for v in hashrate],
                    "upper": [round(v * (1 + band), 2) for v in hashrate],
                },
                "fees": {
                    "lower": [round(v * (1 - band), 6) for v in fees],
                    "upper": [round(v * (1 + band), 6) for v in fees],
                },
                "hashprice": {
                    "lower": [round(v * (1 - band), 8) for v in hashprice],
                    "upper": [round(v * (1 + band), 8) for v in hashprice],
                },
            }

    # Build input snapshot; for ML mode, persist computed bands for later retrieval
    snapshot = req.model_dump()
    if req.mode == "ml_forecast" and confidence_bands is not None:
        snapshot["_computed_confidence_bands"] = confidence_bands
        if model_info is not None:
            snapshot["_computed_model_info"] = model_info

    curve = NetworkCurve(
        name=req.name,
        scenario=req.scenario,
        start_date=req.start_date,
        months=req.months,
        difficulty=difficulty,
        hashprice_btc_per_ph_day=hashprice,
        fees_per_block_btc=fees,
        network_hashrate_eh=hashrate,
        warnings=warnings,
        input_snapshot=snapshot,
        created_by=user["user_id"],
    )

    db.add(curve)
    db.commit()
    db.refresh(curve)

    return NetworkCurveResponse(
        id=curve.id, name=curve.name, scenario=curve.scenario,
        start_date=curve.start_date, months=curve.months,
        difficulty=curve.difficulty, hashprice_btc_per_ph_day=curve.hashprice_btc_per_ph_day,
        fees_per_block_btc=curve.fees_per_block_btc, network_hashrate_eh=curve.network_hashrate_eh,
        warnings=curve.warnings,
        confidence_bands=confidence_bands,
        model_info=model_info,
        mode=req.mode,
        created_by=curve.created_by, created_at=curve.created_at,
    )


@router.get("/list", response_model=List[NetworkCurveResponse])
def list_curves(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    curves = db.query(NetworkCurve).order_by(NetworkCurve.created_at.desc()).limit(50).all()
    return [
        NetworkCurveResponse(
            id=c.id, name=c.name, scenario=c.scenario,
            start_date=c.start_date, months=c.months,
            difficulty=c.difficulty, hashprice_btc_per_ph_day=c.hashprice_btc_per_ph_day,
            fees_per_block_btc=c.fees_per_block_btc, network_hashrate_eh=c.network_hashrate_eh,
            warnings=c.warnings,
            mode=c.input_snapshot.get("mode", "deterministic") if c.input_snapshot else "deterministic",
            created_by=c.created_by, created_at=c.created_at,
        ) for c in curves
    ]


@router.delete("/{curve_id}")
def delete_curve(curve_id: str, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    require_permission(user, "delete")
    curve = db.query(NetworkCurve).filter(NetworkCurve.id == curve_id).first()
    if not curve:
        raise HTTPException(status_code=404, detail="Curve not found")
    db.delete(curve)
    db.commit()
    return {"ok": True, "deleted_id": curve_id}


@router.get("/{curve_id}", response_model=NetworkCurveResponse)
def get_curve(curve_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    require_permission(user, "read")
    curve = db.query(NetworkCurve).filter(NetworkCurve.id == curve_id).first()
    if not curve:
        raise HTTPException(status_code=404, detail="Curve not found")

    snap = curve.input_snapshot or {}
    mode = snap.get("mode", "deterministic")
    confidence_bands = None
    model_info = None

    if mode == "deterministic":
        # Recalculate deterministic bear/bull envelope from stored params
        band_pct = snap.get("confidence_band_pct", 0)
        if band_pct and band_pct > 0:
            band = band_pct / 100.0
            confidence_bands = {
                "difficulty": {
                    "lower": [round(v * (1 - band), 0) for v in curve.difficulty],
                    "upper": [round(v * (1 + band), 0) for v in curve.difficulty],
                },
                "hashrate": {
                    "lower": [round(v * (1 - band), 2) for v in curve.network_hashrate_eh],
                    "upper": [round(v * (1 + band), 2) for v in curve.network_hashrate_eh],
                },
                "fees": {
                    "lower": [round(v * (1 - band), 6) for v in curve.fees_per_block_btc],
                    "upper": [round(v * (1 + band), 6) for v in curve.fees_per_block_btc],
                },
                "hashprice": {
                    "lower": [round(v * (1 - band), 8) for v in curve.hashprice_btc_per_ph_day],
                    "upper": [round(v * (1 + band), 8) for v in curve.hashprice_btc_per_ph_day],
                },
            }
    elif mode == "ml_forecast":
        # Retrieve ML-computed bands persisted in input_snapshot
        confidence_bands = snap.get("_computed_confidence_bands")
        model_info = snap.get("_computed_model_info")

    return NetworkCurveResponse(
        id=curve.id, name=curve.name, scenario=curve.scenario,
        start_date=curve.start_date, months=curve.months,
        difficulty=curve.difficulty, hashprice_btc_per_ph_day=curve.hashprice_btc_per_ph_day,
        fees_per_block_btc=curve.fees_per_block_btc, network_hashrate_eh=curve.network_hashrate_eh,
        warnings=curve.warnings,
        confidence_bands=confidence_bands,
        model_info=model_info,
        mode=mode,
        created_by=curve.created_by, created_at=curve.created_at,
    )
