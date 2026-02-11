"""Pydantic schemas for API request/response validation."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime


# ──────────────────────────────────────────────────────────
# Auth / Common
# ──────────────────────────────────────────────────────────
class UserContext(BaseModel):
    user_id: str = "system"
    role: str = "admin"  # admin | risk | readonly


class RunMeta(BaseModel):
    id: str
    created_by: str
    created_at: datetime


# ──────────────────────────────────────────────────────────
# PAGE 1 — BTC Price Curve
# ──────────────────────────────────────────────────────────
class BTCPriceCurveRequest(BaseModel):
    name: str = "Base Case"
    scenario: str = "base"
    mode: str = "deterministic"  # "deterministic" | "ml_forecast"

    # ── Common ──
    start_date: str = "2025-01"
    months: int = 120

    # ── Deterministic mode params ──
    start_price: float = 97000.0
    anchor_points: Dict[int, float] = Field(
        default={0: 97000, 1: 120000, 2: 150000, 3: 180000, 4: 200000,
                 5: 220000, 6: 250000, 7: 280000, 8: 300000, 9: 320000, 10: 350000},
        description="Year index -> target price"
    )
    interpolation_type: str = "linear"  # linear | step | custom
    custom_monthly_prices: Optional[List[float]] = None
    volatility_enabled: bool = False
    volatility_seed: Optional[int] = 42
    confidence_band_pct: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Symmetric confidence band (%) applied to the base curve to create bull/bear envelopes"
    )

    # ── ML forecast mode params ──
    model_type: str = "auto_arima"  # auto_arima | holt_winters | sarimax
    confidence_interval: float = 0.95  # 0.80 | 0.90 | 0.95

    user: UserContext = UserContext()


class BTCPriceCurveResponse(BaseModel):
    id: str
    name: str
    scenario: str
    start_date: str
    months: int
    monthly_prices: List[float]
    # ML-specific (optional, present only in ml_forecast mode)
    upper_bound: Optional[List[float]] = None
    lower_bound: Optional[List[float]] = None
    model_info: Optional[dict] = None
    mode: str = "deterministic"
    created_by: str
    created_at: datetime


# ──────────────────────────────────────────────────────────
# PAGE 2 — Network Curve
# ──────────────────────────────────────────────────────────
class NetworkCurveRequest(BaseModel):
    name: str = "Base Network"
    scenario: str = "base"
    mode: str = "deterministic"  # "deterministic" | "ml_forecast"

    # ── Common ──
    start_date: str = "2025-01"
    months: int = 120
    halving_enabled: bool = True

    # ── Deterministic mode params ──
    starting_difficulty: float = 110e12  # ~110T
    starting_network_hashrate_eh: float = 800.0  # EH/s
    monthly_difficulty_growth_rate: float = 0.02  # 2% per month
    fee_regime: str = "base"  # low | base | high
    starting_fees_per_block_btc: float = 0.5
    confidence_band_pct: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Symmetric confidence band (%) applied to deterministic curves for bull/bear envelopes"
    )

    # ── ML forecast mode params ──
    model_type: str = "auto_arima"  # auto_arima | holt_winters | sarimax
    confidence_interval: float = 0.95  # 0.80 | 0.90 | 0.95

    user: UserContext = UserContext()


class NetworkCurveResponse(BaseModel):
    id: str
    name: str
    scenario: str
    start_date: str
    months: int
    difficulty: List[float]
    hashprice_btc_per_ph_day: List[float]
    fees_per_block_btc: List[float]
    network_hashrate_eh: List[float]
    warnings: List[str]
    # ML-specific confidence bands (optional)
    confidence_bands: Optional[Dict] = None  # keys: difficulty, hashrate, fees, hashprice
    model_info: Optional[dict] = None
    mode: str = "deterministic"
    created_by: str
    created_at: datetime


# ──────────────────────────────────────────────────────────
# PAGE 3 — Miner Catalog
# ──────────────────────────────────────────────────────────
class MinerCreate(BaseModel):
    name: str
    hashrate_th: float
    power_w: float
    price_usd: float
    lifetime_months: int = 36
    maintenance_pct: float = 0.02


class MinerUpdate(BaseModel):
    name: Optional[str] = None
    hashrate_th: Optional[float] = None
    power_w: Optional[float] = None
    price_usd: Optional[float] = None
    lifetime_months: Optional[int] = None
    maintenance_pct: Optional[float] = None


class MinerResponse(BaseModel):
    id: str
    name: str
    hashrate_th: float
    power_w: float
    price_usd: float
    lifetime_months: int
    maintenance_pct: float
    efficiency_j_th: Optional[float]
    created_at: datetime


class MinerSimRequest(BaseModel):
    miner_id: str
    btc_price_curve_id: str
    network_curve_id: str
    electricity_rate: float = 0.05  # USD/kWh
    uptime: float = 0.95
    months: int = 36
    user: UserContext = UserContext()


class MinerSimResponse(BaseModel):
    id: str
    miner_id: str
    monthly_cashflows: List[dict]
    total_btc_mined: float
    total_revenue_usd: float
    total_electricity_cost_usd: float
    total_net_usd: float
    break_even_month: Optional[int]
    created_at: datetime


# ──────────────────────────────────────────────────────────
# PAGE 4 — Hosting
# ──────────────────────────────────────────────────────────
class HostingSiteCreate(BaseModel):
    name: str
    electricity_price_usd_per_kwh: float
    hosting_fee_usd_per_kw_month: float = 0.0
    uptime_expectation: float = 0.95
    curtailment_pct: float = 0.0
    capacity_mw_available: float
    lockup_months: int = 12
    notice_period_days: int = 30


class HostingSiteUpdate(BaseModel):
    name: Optional[str] = None
    electricity_price_usd_per_kwh: Optional[float] = None
    hosting_fee_usd_per_kw_month: Optional[float] = None
    uptime_expectation: Optional[float] = None
    curtailment_pct: Optional[float] = None
    capacity_mw_available: Optional[float] = None
    lockup_months: Optional[int] = None
    notice_period_days: Optional[int] = None


class HostingSiteResponse(BaseModel):
    id: str
    name: str
    electricity_price_usd_per_kwh: float
    hosting_fee_usd_per_kw_month: float
    uptime_expectation: float
    curtailment_pct: float
    capacity_mw_available: float
    lockup_months: int
    notice_period_days: int
    created_at: datetime


class AllocationEntry(BaseModel):
    site_id: str
    miner_id: str
    miner_count: int


class HostingAllocateRequest(BaseModel):
    allocations: List[AllocationEntry]
    user: UserContext = UserContext()


class HostingAllocateResponse(BaseModel):
    id: str
    blended_electricity_rate: float
    blended_uptime: float
    total_power_kw: float
    warnings: List[str]
    allocations: List[dict]
    created_at: datetime


# ──────────────────────────────────────────────────────────
# PAGE 4 — Product Configuration (3-Bucket Capital Allocation)
# ──────────────────────────────────────────────────────────
class TakeProfitEntry(BaseModel):
    price_trigger: float
    sell_pct: float


class YieldBucketConfig(BaseModel):
    allocated_usd: float
    base_apr: float = 0.08  # 8%
    apr_schedule: Optional[List[dict]] = None  # [{from_month, to_month, apr}]


class BtcHoldingBucketConfig(BaseModel):
    allocated_usd: float
    buying_price_usd: float
    target_sell_price_usd: Optional[float] = None  # Auto-computed: covers holding + mining initial investment


class MiningBucketConfig(BaseModel):
    allocated_usd: float
    miner_id: str
    hosting_site_id: str
    miner_count: int
    base_yield_apr: float = 0.08   # 8% base yield from mining
    bonus_yield_apr: float = 0.04  # +4% bonus when BTC holding target hit
    take_profit_ladder: List[TakeProfitEntry] = []


class ProductConfigRequest(BaseModel):
    capital_raised_usd: float = 10_000_000.0
    structure_type: str = "dedicated"  # dedicated | pooled
    product_tenor_months: int = 36
    exit_window_frequency: str = "quarterly"  # quarterly | semi-annual | annual

    yield_bucket: YieldBucketConfig
    btc_holding_bucket: BtcHoldingBucketConfig
    mining_bucket: MiningBucketConfig

    # 3 scenario curve IDs
    btc_price_curve_ids: Dict[str, str]  # {"bear": id, "base": id, "bull": id}
    network_curve_ids: Dict[str, str]    # {"bear": id, "base": id, "bull": id}

    user: UserContext = UserContext()


class ScenarioBucketResults(BaseModel):
    yield_bucket: dict
    btc_holding_bucket: dict
    mining_bucket: dict
    aggregated: dict


class ProductConfigResponse(BaseModel):
    id: str
    scenario_results: Dict[str, ScenarioBucketResults]  # bear / base / bull
    created_at: datetime
