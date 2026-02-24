"""Add HK Hydro Cooling miners from Bitmain and USA hosting site."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal, create_db_and_tables
from backend.models import Miner, HostingSite


def add_hk_hydro_miners():
    create_db_and_tables()
    db = SessionLocal()

    new_miners = [
        Miner(
            id="seed-miner-u3s21exph",
            name="Antminer U3S21EXPH 860T (HK Hydro)",
            hashrate_th=860.0,
            power_w=11180.0,
            price_usd=10922.0,  # $12.7/T × 860
            lifetime_months=36,
            maintenance_pct=0.02,
            efficiency_j_th=11180.0 / 860.0,
        ),
        Miner(
            id="seed-miner-s21xphyd",
            name="Antminer S21 XP Hyd 473T (HK Hydro)",
            hashrate_th=473.0,
            power_w=5676.0,
            price_usd=6622.0,  # $14/T × 473
            lifetime_months=36,
            maintenance_pct=0.02,
            efficiency_j_th=5676.0 / 473.0,
        ),
        Miner(
            id="seed-miner-s21exphyd",
            name="Antminer S21e XP Hyd 430T (HK Hydro)",
            hashrate_th=430.0,
            power_w=5590.0,
            price_usd=5504.0,  # $12.8/T × 430
            lifetime_months=36,
            maintenance_pct=0.02,
            efficiency_j_th=5590.0 / 430.0,
        ),
    ]

    new_site = HostingSite(
        id="seed-site-usa-standard",
        name="USA Standard Site ($0.06/kWh)",
        electricity_price_usd_per_kwh=0.06,
        hosting_fee_usd_per_kw_month=5.0,
        uptime_expectation=0.95,
        curtailment_pct=0.02,
        capacity_mw_available=50.0,
        lockup_months=12,
        notice_period_days=30,
    )

    added = 0
    for miner in new_miners:
        existing = db.query(Miner).filter(Miner.id == miner.id).first()
        if existing:
            print(f"  [skip] {miner.name} already exists")
        else:
            db.add(miner)
            added += 1
            print(f"  [add]  {miner.name}")

    existing_site = db.query(HostingSite).filter(HostingSite.id == new_site.id).first()
    if existing_site:
        print(f"  [skip] {new_site.name} already exists")
    else:
        db.add(new_site)
        added += 1
        print(f"  [add]  {new_site.name}")

    if added:
        db.commit()
        print(f"\nDone — {added} record(s) added.")
    else:
        print("\nNothing to add — all records already exist.")

    db.close()


if __name__ == "__main__":
    add_hk_hydro_miners()
