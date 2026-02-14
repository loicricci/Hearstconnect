"""SQLModel / SQLAlchemy models for Hearst Connect."""
from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Column
from sqlalchemy import JSON
import uuid


def generate_uuid() -> str:
    return str(uuid.uuid4())


def _current_month() -> str:
    """Return current month as YYYY-MM string."""
    return datetime.utcnow().strftime("%Y-%m")


# ──────────────────────────────────────────────────────────
# PAGE 1 — BTC Price Curve
# ──────────────────────────────────────────────────────────
class BTCPriceCurve(SQLModel, table=True):
    __tablename__ = "btc_price_curves"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    name: str = Field(index=True)
    scenario: str = Field(default="base")  # bear / base / bull
    start_date: str = Field(default_factory=_current_month)  # YYYY-MM
    months: int = Field(default=120)
    monthly_prices: List[float] = Field(default=[], sa_column=Column(JSON))
    anchor_points: dict = Field(default={}, sa_column=Column(JSON))
    interpolation_type: str = Field(default="linear")
    volatility_enabled: bool = Field(default=False)
    volatility_seed: Optional[int] = Field(default=None)
    input_snapshot: dict = Field(default={}, sa_column=Column(JSON))
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ──────────────────────────────────────────────────────────
# PAGE 2 — Network Curve
# ──────────────────────────────────────────────────────────
class NetworkCurve(SQLModel, table=True):
    __tablename__ = "network_curves"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    name: str = Field(index=True)
    scenario: str = Field(default="base")
    start_date: str = Field(default_factory=_current_month)  # YYYY-MM
    months: int = Field(default=120)
    difficulty: List[float] = Field(default=[], sa_column=Column(JSON))
    hashprice_btc_per_ph_day: List[float] = Field(default=[], sa_column=Column(JSON))
    fees_per_block_btc: List[float] = Field(default=[], sa_column=Column(JSON))
    network_hashrate_eh: List[float] = Field(default=[], sa_column=Column(JSON))
    input_snapshot: dict = Field(default={}, sa_column=Column(JSON))
    warnings: List[str] = Field(default=[], sa_column=Column(JSON))
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ──────────────────────────────────────────────────────────
# PAGE 3 — Miners (merged with Hosting on frontend)
# ──────────────────────────────────────────────────────────
class Miner(SQLModel, table=True):
    __tablename__ = "miners"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    name: str = Field(index=True)
    hashrate_th: float
    power_w: float
    price_usd: float
    lifetime_months: int = Field(default=36)
    maintenance_pct: float = Field(default=0.02)  # 2% of revenue
    efficiency_j_th: Optional[float] = Field(default=None)  # derived: power_w / hashrate_th
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MinerSimRun(SQLModel, table=True):
    __tablename__ = "miner_sim_runs"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    miner_id: str = Field(index=True)
    btc_price_curve_id: str
    network_curve_id: str
    electricity_rate: float
    uptime: float = Field(default=0.95)
    input_snapshot: dict = Field(default={}, sa_column=Column(JSON))
    outputs: dict = Field(default={}, sa_column=Column(JSON))
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ──────────────────────────────────────────────────────────
# PAGE 3 — Hosting Sites (merged with Miners on frontend)
# ──────────────────────────────────────────────────────────
class HostingSite(SQLModel, table=True):
    __tablename__ = "hosting_sites"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    name: str = Field(index=True)
    electricity_price_usd_per_kwh: float
    hosting_fee_usd_per_kw_month: float = Field(default=0.0)
    uptime_expectation: float = Field(default=0.95)
    curtailment_pct: float = Field(default=0.0)
    capacity_mw_available: float
    lockup_months: int = Field(default=12)
    notice_period_days: int = Field(default=30)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class HostingAllocation(SQLModel, table=True):
    __tablename__ = "hosting_allocations"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    run_id: str = Field(index=True)
    site_id: str
    miner_id: str
    miner_count: int
    created_at: datetime = Field(default_factory=datetime.utcnow)


class HostingAllocationRun(SQLModel, table=True):
    __tablename__ = "hosting_allocation_runs"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    input_snapshot: dict = Field(default={}, sa_column=Column(JSON))
    outputs: dict = Field(default={}, sa_column=Column(JSON))
    warnings: List[str] = Field(default=[], sa_column=Column(JSON))
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ──────────────────────────────────────────────────────────
# PAGE 4 — Product Configuration (3-Bucket)
# ──────────────────────────────────────────────────────────
class ProductConfigRun(SQLModel, table=True):
    __tablename__ = "product_config_runs"

    id: str = Field(default_factory=generate_uuid, primary_key=True)
    input_snapshot: dict = Field(default={}, sa_column=Column(JSON))
    scenario_results: dict = Field(default={}, sa_column=Column(JSON))  # {bear: {}, base: {}, bull: {}}
    created_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)
