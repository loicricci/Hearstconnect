"""Deterministic hosting allocation engine."""
from typing import List, Dict, Tuple


def compute_allocation(
    allocations: List[Dict],  # [{site_id, miner_id, miner_count}]
    sites: Dict[str, Dict],   # site_id -> site details
    miners: Dict[str, Dict],  # miner_id -> miner details
) -> Dict:
    """
    Validate and compute blended hosting metrics from allocations.

    Returns:
        {
            blended_electricity_rate, blended_uptime, total_power_kw,
            warnings, per_site_breakdown
        }
    """
    warnings: List[str] = []
    per_site: Dict[str, Dict] = {}

    total_power_kw = 0.0
    weighted_elec = 0.0
    weighted_uptime = 0.0

    for alloc in allocations:
        site_id = alloc["site_id"]
        miner_id = alloc["miner_id"]
        miner_count = alloc["miner_count"]

        site = sites.get(site_id)
        miner = miners.get(miner_id)

        if not site or not miner:
            warnings.append(f"Missing site {site_id} or miner {miner_id}")
            continue

        alloc_power_kw = (miner["power_w"] * miner_count) / 1000.0

        if site_id not in per_site:
            per_site[site_id] = {
                "site_name": site["name"],
                "total_power_kw": 0.0,
                "capacity_kw": site["capacity_mw_available"] * 1000.0,
                "miners": [],
            }

        per_site[site_id]["total_power_kw"] += alloc_power_kw
        per_site[site_id]["miners"].append({
            "miner_id": miner_id,
            "miner_name": miner["name"],
            "count": miner_count,
            "power_kw": alloc_power_kw,
        })

        total_power_kw += alloc_power_kw
        weighted_elec += alloc_power_kw * site["electricity_price_usd_per_kwh"]
        weighted_uptime += alloc_power_kw * site["uptime_expectation"]

    # Validate capacity constraints
    for site_id, info in per_site.items():
        if info["total_power_kw"] > info["capacity_kw"]:
            warnings.append(
                f"CAPACITY EXCEEDED at {info['site_name']}: "
                f"{info['total_power_kw']:.1f} kW allocated vs "
                f"{info['capacity_kw']:.1f} kW available"
            )

    # Concentration risk
    if len(per_site) == 1 and total_power_kw > 0:
        warnings.append("Single-site concentration risk: all miners at one location")

    # Low uptime warnings
    for site_id, info in per_site.items():
        site = sites[site_id]
        if site["uptime_expectation"] < 0.90:
            warnings.append(f"Low uptime at {info['site_name']}: {site['uptime_expectation']*100:.0f}%")

    blended_elec = weighted_elec / total_power_kw if total_power_kw > 0 else 0.0
    blended_uptime = weighted_uptime / total_power_kw if total_power_kw > 0 else 0.0

    return {
        "blended_electricity_rate": round(blended_elec, 4),
        "blended_uptime": round(blended_uptime, 4),
        "total_power_kw": round(total_power_kw, 2),
        "warnings": warnings,
        "per_site_breakdown": per_site,
    }
