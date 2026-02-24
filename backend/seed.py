"""Seed data for Hearst Connect — one miner and one hosting site."""
import sys
import os

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal, create_db_and_tables
from backend.models import Miner, HostingSite, OpsHistory


def seed():
    create_db_and_tables()
    db = SessionLocal()

    # Check if already seeded
    if db.query(Miner).first():
        print("Database already seeded. Skipping.")
        db.close()
        return

    # Seed Miner: Bitmain Antminer S21
    miner_s21 = Miner(
        id="seed-miner-s21",
        name="Antminer S21",
        hashrate_th=200.0,
        power_w=3500.0,
        price_usd=5800.0,
        lifetime_months=36,
        maintenance_pct=0.02,
        efficiency_j_th=3500.0 / 200.0,  # 17.5 J/TH
    )
    db.add(miner_s21)

    # Seed Miner: Antminer S21 XP
    miner_s21xp = Miner(
        id="seed-miner-s21xp",
        name="Antminer S21 XP",
        hashrate_th=270.0,
        power_w=3645.0,
        price_usd=7200.0,
        lifetime_months=36,
        maintenance_pct=0.02,
        efficiency_j_th=3645.0 / 270.0,  # 13.5 J/TH
    )
    db.add(miner_s21xp)

    # Seed Miner: Bitmain Antminer U3S21EXPH (HK Hydro Cooling)
    miner_u3s21exph = Miner(
        id="seed-miner-u3s21exph",
        name="Antminer U3S21EXPH 860T (HK Hydro)",
        hashrate_th=860.0,
        power_w=11180.0,
        price_usd=10922.0,  # $12.7/T × 860
        lifetime_months=36,
        maintenance_pct=0.02,
        efficiency_j_th=11180.0 / 860.0,  # ~13.0 J/TH
    )
    db.add(miner_u3s21exph)

    # Seed Miner: Bitmain Antminer S21 XP Hyd (HK Hydro Cooling)
    miner_s21xphyd = Miner(
        id="seed-miner-s21xphyd",
        name="Antminer S21 XP Hyd 473T (HK Hydro)",
        hashrate_th=473.0,
        power_w=5676.0,
        price_usd=6622.0,  # $14/T × 473
        lifetime_months=36,
        maintenance_pct=0.02,
        efficiency_j_th=5676.0 / 473.0,  # 12.0 J/TH
    )
    db.add(miner_s21xphyd)

    # Seed Miner: Bitmain Antminer S21e XP Hyd (HK Hydro Cooling, 7-day delivery)
    miner_s21exphyd = Miner(
        id="seed-miner-s21exphyd",
        name="Antminer S21e XP Hyd 430T (HK Hydro)",
        hashrate_th=430.0,
        power_w=5590.0,
        price_usd=5504.0,  # $12.8/T × 430
        lifetime_months=36,
        maintenance_pct=0.02,
        efficiency_j_th=5590.0 / 430.0,  # 13.0 J/TH
    )
    db.add(miner_s21exphyd)

    # Seed Hosting Site: Texas Data Center
    site_tx = HostingSite(
        id="seed-site-texas",
        name="Texas Data Center",
        electricity_price_usd_per_kwh=0.045,
        hosting_fee_usd_per_kw_month=5.0,
        uptime_expectation=0.95,
        curtailment_pct=0.03,
        capacity_mw_available=50.0,
        lockup_months=12,
        notice_period_days=30,
    )
    db.add(site_tx)

    # Seed Hosting Site: Wyoming Cold Facility
    site_wy = HostingSite(
        id="seed-site-wyoming",
        name="Wyoming Cold Facility",
        electricity_price_usd_per_kwh=0.038,
        hosting_fee_usd_per_kw_month=3.5,
        uptime_expectation=0.97,
        curtailment_pct=0.01,
        capacity_mw_available=25.0,
        lockup_months=24,
        notice_period_days=60,
    )
    db.add(site_wy)

    # Seed Hosting Site: USA Standard (HK Hydro miners)
    site_usa = HostingSite(
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
    db.add(site_usa)

    # Seed sample ops history (6 months)
    sample_ops = [
        {"month": "2024-07", "btc_produced": 0.0045, "uptime": 0.93, "energy_kwh": 2400},
        {"month": "2024-08", "btc_produced": 0.0043, "uptime": 0.91, "energy_kwh": 2350},
        {"month": "2024-09", "btc_produced": 0.0044, "uptime": 0.94, "energy_kwh": 2380},
        {"month": "2024-10", "btc_produced": 0.0042, "uptime": 0.90, "energy_kwh": 2320},
        {"month": "2024-11", "btc_produced": 0.0041, "uptime": 0.92, "energy_kwh": 2360},
        {"month": "2024-12", "btc_produced": 0.0040, "uptime": 0.91, "energy_kwh": 2340},
    ]
    for op in sample_ops:
        db.add(OpsHistory(**op))

    db.commit()
    db.close()
    print("Seed data created successfully:")
    print("  - 5 miners (S21, S21 XP, U3S21EXPH 860T, S21 XP Hyd 473T, S21e XP Hyd 430T)")
    print("  - 3 hosting sites (Texas, Wyoming, USA Standard $0.06/kWh)")
    print("  - 6 months ops history")


if __name__ == "__main__":
    seed()
