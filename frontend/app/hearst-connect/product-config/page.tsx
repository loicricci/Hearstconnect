'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import { btcPriceCurveApi, networkCurveApi, minersApi, hostingApi, productConfigApi } from '@/lib/api';
import { formatUSD } from '@/lib/utils';

interface AprScheduleEntry {
  from_month: number;
  to_month: number;
  apr: number;
}

interface TakeProfitEntry {
  price_trigger: number;
  sell_pct: number;
}

/* ────────────────────────────────────────────────
 * Tooltip component for inline help
 * ──────────────────────────────────────────────── */
function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 cursor-help inline-flex items-center">
      <svg className="w-3.5 h-3.5 text-neutral-500 hover:text-neutral-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded bg-hearst-card border border-hearst-border-light px-3 py-2 text-[10px] text-neutral-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {text}
      </span>
    </span>
  );
}

/* ────────────────────────────────────────────────
 * Allocation Slider component with lock toggle
 * ──────────────────────────────────────────────── */
function AllocationSlider({
  label,
  pct,
  onPctChange,
  amountUsd,
  color,
  trackColor,
  locked,
  onToggleLock,
}: {
  label: string;
  pct: number;
  onPctChange: (newPct: number) => void;
  amountUsd: number;
  color: string;
  trackColor: string;
  locked: boolean;
  onToggleLock: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${color}`}>{label}</span>
          <button
            onClick={onToggleLock}
            className={`flex items-center justify-center w-5 h-5 rounded transition-all ${
              locked
                ? 'bg-neutral-600 text-white shadow-inner'
                : 'bg-hearst-card text-neutral-500 hover:text-neutral-300 hover:bg-hearst-border'
            }`}
            title={locked ? 'Unlock — allow this value to change' : 'Lock — freeze this value'}
          >
            {locked ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 tabular-nums">{formatUSD(amountUsd)}</span>
          <span className={`text-sm font-bold tabular-nums ${color}`}>{pct.toFixed(1)}%</span>
        </div>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pct}
          onChange={e => onPctChange(Number(e.target.value))}
          disabled={locked}
          className={`w-full h-2 rounded-full appearance-none ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${trackColor}`}
          style={{
            background: `linear-gradient(to right, var(--slider-fill) ${pct}%, rgb(30 41 59) ${pct}%)`,
          }}
        />
      </div>
    </div>
  );
}

export default function ProductConfigPage() {
  const router = useRouter();

  // ── Dependencies ──
  const [btcCurves, setBtcCurves] = useState<any[]>([]);
  const [netCurves, setNetCurves] = useState<any[]>([]);
  const [miners, setMiners] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);

  // ── Product Structure ──
  const [capitalRaised, setCapitalRaised] = useState(10_000_000);
  const [exitFreq, setExitFreq] = useState('quarterly');

  // ── Allocation percentages (source of truth) ──
  const [yieldPct, setYieldPct] = useState(30);
  const [holdingPct, setHoldingPct] = useState(30);
  const [miningPct, setMiningPct] = useState(40);

  // ── Lock state: freeze a bucket so only the unlocked one absorbs changes ──
  const [yieldLocked, setYieldLocked] = useState(false);
  const [holdingLocked, setHoldingLocked] = useState(false);
  const [miningLocked, setMiningLocked] = useState(false);

  // ── Derived USD amounts from percentages ──
  const yieldAllocated = Math.round(capitalRaised * yieldPct / 100);
  const holdingAllocated = Math.round(capitalRaised * holdingPct / 100);
  const miningAllocated = Math.round(capitalRaised * miningPct / 100);

  // ── Bucket A: Yield Liquidity ──
  const [yieldBaseApr, setYieldBaseApr] = useState(0.08);
  const [useAprSchedule, setUseAprSchedule] = useState(false);
  const [aprSchedule, setAprSchedule] = useState<AprScheduleEntry[]>([
    { from_month: 0, to_month: 11, apr: 0.10 },
    { from_month: 12, to_month: 23, apr: 0.08 },
    { from_month: 24, to_month: 35, apr: 0.06 },
  ]);

  // ── Bucket B: BTC Holding ──
  const [buyingPrice, setBuyingPrice] = useState(97000);
  const [liveBtcPrice, setLiveBtcPrice] = useState<number | null>(null);
  const [btcPriceLoading, setBtcPriceLoading] = useState(false);
  const [btcPriceUpdatedAt, setBtcPriceUpdatedAt] = useState<Date | null>(null);

  // ── Derived target sell price: covers both holding + mining initial investment ──
  // Formula: (holdingAllocated + miningAllocated) / (holdingAllocated / buyingPrice)
  const btcQuantity = buyingPrice > 0 ? holdingAllocated / buyingPrice : 0;
  const targetSellPrice = btcQuantity > 0
    ? Math.round((holdingAllocated + miningAllocated) / btcQuantity)
    : 0;

  // ── Bucket C: BTC Mining ──
  const [selectedMiner, setSelectedMiner] = useState('');
  const [selectedSite, setSelectedSite] = useState('');
  const [minerCount, setMinerCount] = useState(500);
  const [miningBaseYield, setMiningBaseYield] = useState(0.08);
  const [miningBonusYield, setMiningBonusYield] = useState(0.04);
  const [takeProfitLadder, setTakeProfitLadder] = useState<TakeProfitEntry[]>([]);

  // ── Tenor: auto-derived from selected miner's depreciation lifespan ──
  const selectedMinerObj = miners.find(m => m.id === selectedMiner);
  const tenor = selectedMinerObj?.lifetime_months ?? 36;
  const tenorYears = (tenor / 12).toFixed(tenor % 12 === 0 ? 0 : 1);

  // ── Scenario Curve Selectors (simplified: auto bear/base/bull) ──
  const [selectedBtcFamily, setSelectedBtcFamily] = useState('');
  const [selectedNetFamily, setSelectedNetFamily] = useState('');

  // ── State ──
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState('');

  /* ────────────────────────────────────────────────
   * Group curves by "family" — strips bear/base/bull from name
   * to enable single-selector scenario picking
   * ──────────────────────────────────────────────── */
  const groupCurvesByFamily = useCallback((curves: any[]) => {
    const families: Record<string, { bear?: any; base?: any; bull?: any; name: string }> = {};
    for (const c of curves) {
      // Create family key by removing scenario keywords from name
      const familyName = c.name
        .replace(/\s*\(?(bear|base|bull)\)?/gi, '')
        .replace(/\s*-\s*$/, '')
        .trim() || c.name;
      const key = familyName.toLowerCase();
      if (!families[key]) families[key] = { name: familyName };
      families[key][c.scenario as 'bear' | 'base' | 'bull'] = c;
    }
    return families;
  }, []);

  const btcFamilies = useMemo(() => groupCurvesByFamily(btcCurves), [btcCurves, groupCurvesByFamily]);
  const netFamilies = useMemo(() => groupCurvesByFamily(netCurves), [netCurves, groupCurvesByFamily]);

  // Resolve individual curve IDs from the selected family
  const resolveCurveIds = useCallback((families: Record<string, any>, familyKey: string) => {
    const family = families[familyKey];
    if (!family) return { bear: '', base: '', bull: '' };
    return {
      bear: family.bear?.id || family.base?.id || '',
      base: family.base?.id || family.bear?.id || '',
      bull: family.bull?.id || family.base?.id || '',
    };
  }, []);

  const btcCurveIds = useMemo(() => resolveCurveIds(btcFamilies, selectedBtcFamily), [btcFamilies, selectedBtcFamily, resolveCurveIds]);
  const netCurveIds = useMemo(() => resolveCurveIds(netFamilies, selectedNetFamily), [netFamilies, selectedNetFamily, resolveCurveIds]);

  const fetchLiveBtcPrice = useCallback(async (setAsDefault = false) => {
    setBtcPriceLoading(true);
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!res.ok) throw new Error('Failed to fetch BTC price');
      const data = await res.json();
      const price = Math.round(data.bitcoin.usd);
      setLiveBtcPrice(price);
      setBtcPriceUpdatedAt(new Date());
      if (setAsDefault) setBuyingPrice(price);
    } catch {
      // Silently fail — keep the manual default
    }
    setBtcPriceLoading(false);
  }, []);

  useEffect(() => { fetchLiveBtcPrice(true); loadDependencies(); }, []);

  const loadDependencies = async () => {
    try {
      const [btc, net, m, s]: any[] = await Promise.all([
        btcPriceCurveApi.list(),
        networkCurveApi.list(),
        minersApi.list(),
        hostingApi.list(),
      ]);
      setBtcCurves(btc);
      setNetCurves(net);
      setMiners(m);
      setSites(s);

      // Auto-select first available curve family
      if (btc.length > 0) {
        const familyName = btc[0].name
          .replace(/\s*\(?(bear|base|bull)\)?/gi, '')
          .replace(/\s*-\s*$/, '')
          .trim() || btc[0].name;
        setSelectedBtcFamily(familyName.toLowerCase());
      }
      if (net.length > 0) {
        const familyName = net[0].name
          .replace(/\s*\(?(bear|base|bull)\)?/gi, '')
          .replace(/\s*-\s*$/, '')
          .trim() || net[0].name;
        setSelectedNetFamily(familyName.toLowerCase());
      }

      if (m.length > 0) setSelectedMiner(m[0].id);
      if (s.length > 0) setSelectedSite(s[0].id);
    } catch (e) { /* API not available yet */ }
  };

  // Auto-calculate miner count from allocation and miner price
  useEffect(() => {
    const miner = miners.find(m => m.id === selectedMiner);
    if (miner && miner.price_usd > 0) {
      setMinerCount(Math.floor(miningAllocated / miner.price_usd));
    }
  }, [miningAllocated, selectedMiner, miners]);

  /* ────────────────────────────────────────────────
   * Linked slider logic with lock support:
   * - If one other bucket is locked, only the unlocked one absorbs the change
   * - If neither is locked, redistribute proportionally
   * - If both others are locked, the slider won't move (can't satisfy constraints)
   * ──────────────────────────────────────────────── */
  const handleSliderChange = useCallback((bucket: 'yield' | 'holding' | 'mining', newPct: number) => {
    newPct = Math.max(0, Math.min(100, newPct));

    type BucketInfo = { get: () => number; set: (v: number) => void; locked: boolean };
    let others: BucketInfo[];

    if (bucket === 'yield') {
      others = [
        { get: () => holdingPct, set: setHoldingPct, locked: holdingLocked },
        { get: () => miningPct, set: setMiningPct, locked: miningLocked },
      ];
    } else if (bucket === 'holding') {
      others = [
        { get: () => yieldPct, set: setYieldPct, locked: yieldLocked },
        { get: () => miningPct, set: setMiningPct, locked: miningLocked },
      ];
    } else {
      others = [
        { get: () => yieldPct, set: setYieldPct, locked: yieldLocked },
        { get: () => holdingPct, set: setHoldingPct, locked: holdingLocked },
      ];
    }

    const lockedOthers = others.filter(o => o.locked);
    const unlockedOthers = others.filter(o => !o.locked);

    // Both others are locked — can't adjust, clamp the change
    if (lockedOthers.length === 2) {
      const maxAllowed = 100 - lockedOthers[0].get() - lockedOthers[1].get();
      newPct = Math.min(newPct, Math.max(0, maxAllowed));
    }

    const remaining = 100 - newPct;

    if (lockedOthers.length === 1) {
      // One locked: the single unlocked bucket absorbs the entire difference
      const lockedVal = lockedOthers[0].get();
      const unlockedVal = Math.max(0, Math.round((remaining - lockedVal) * 10) / 10);
      // Clamp: if the slider pushes too far, cap it
      if (remaining < lockedVal) {
        // Can't fit — cap newPct so locked value is preserved
        const cappedNew = Math.round((100 - lockedVal) * 10) / 10;
        newPct = cappedNew;
        unlockedOthers[0].set(0);
      } else {
        unlockedOthers[0].set(unlockedVal);
      }
    } else if (lockedOthers.length === 0) {
      // No locks: redistribute proportionally
      const otherTotal = others[0].get() + others[1].get();
      if (otherTotal > 0) {
        const ratio0 = others[0].get() / otherTotal;
        const val0 = Math.round(remaining * ratio0 * 10) / 10;
        others[0].set(val0);
        others[1].set(Math.round((remaining - val0) * 10) / 10);
      } else {
        const half = Math.round(remaining / 2 * 10) / 10;
        others[0].set(half);
        others[1].set(Math.round((remaining - half) * 10) / 10);
      }
    }
    // else both locked: newPct already clamped above

    // Set the moved bucket
    if (bucket === 'yield') setYieldPct(newPct);
    else if (bucket === 'holding') setHoldingPct(newPct);
    else setMiningPct(newPct);

  }, [yieldPct, holdingPct, miningPct, yieldLocked, holdingLocked, miningLocked]);

  const totalPct = yieldPct + holdingPct + miningPct;
  const allocationValid = Math.abs(totalPct - 100) < 0.5;

  const runSimulation = async () => {
    if (!allocationValid) {
      setError(`Bucket allocations must equal 100%. Currently: ${totalPct.toFixed(1)}%`);
      return;
    }
    if (!btcCurveIds.bear || !btcCurveIds.base || !btcCurveIds.bull ||
        !netCurveIds.bear || !netCurveIds.base || !netCurveIds.bull) {
      setError('Select BTC Price and Network curve sets. Each needs bear/base/bull variants.');
      return;
    }
    if (!selectedMiner || !selectedSite) {
      setError('Select a miner and hosting site for the mining bucket.');
      return;
    }

    setRunning(true);
    setError('');
    try {
      const payload = {
        capital_raised_usd: capitalRaised,
        product_tenor_months: tenor,
        exit_window_frequency: exitFreq,
        yield_bucket: {
          allocated_usd: yieldAllocated,
          base_apr: yieldBaseApr,
          apr_schedule: useAprSchedule ? aprSchedule : null,
        },
        btc_holding_bucket: {
          allocated_usd: holdingAllocated,
          buying_price_usd: buyingPrice,
          // target_sell_price_usd is auto-computed server-side:
          // (holding_allocated + mining_allocated) / (holding_allocated / buying_price)
        },
        mining_bucket: {
          allocated_usd: miningAllocated,
          miner_id: selectedMiner,
          hosting_site_id: selectedSite,
          miner_count: minerCount,
          base_yield_apr: miningBaseYield,
          bonus_yield_apr: miningBonusYield,
          take_profit_ladder: takeProfitLadder,
        },
        btc_price_curve_ids: btcCurveIds,
        network_curve_ids: netCurveIds,
      };

      // Debug: log which curve IDs are being sent per scenario
      console.log('[ProductConfig] Submitting simulation with curve IDs:', {
        btc: btcCurveIds,
        net: netCurveIds,
        btcAllSame: btcCurveIds.bear === btcCurveIds.base && btcCurveIds.base === btcCurveIds.bull,
        netAllSame: netCurveIds.bear === netCurveIds.base && netCurveIds.base === netCurveIds.bull,
      });

      const res: any = await productConfigApi.simulate(payload);
      setRunId(res.id);
      router.push(`/hearst-connect/results?run=${res.id}`);
    } catch (e: any) {
      setError(e.message);
    }
    setRunning(false);
  };

  // APR schedule helpers
  const updateAprEntry = (idx: number, field: keyof AprScheduleEntry, value: number) => {
    const updated = [...aprSchedule];
    updated[idx] = { ...updated[idx], [field]: value };
    setAprSchedule(updated);
  };
  const addAprEntry = () => {
    const lastEnd = aprSchedule.length > 0 ? aprSchedule[aprSchedule.length - 1].to_month + 1 : 0;
    setAprSchedule([...aprSchedule, { from_month: lastEnd, to_month: lastEnd + 11, apr: 0.08 }]);
  };
  const removeAprEntry = (idx: number) => setAprSchedule(aprSchedule.filter((_, i) => i !== idx));

  // Take-profit ladder helpers
  const addTakeProfitEntry = () => setTakeProfitLadder([...takeProfitLadder, { price_trigger: 150000, sell_pct: 0.25 }]);
  const updateTakeProfitEntry = (idx: number, field: keyof TakeProfitEntry, value: number) => {
    const updated = [...takeProfitLadder];
    updated[idx] = { ...updated[idx], [field]: value };
    setTakeProfitLadder(updated);
  };
  const removeTakeProfitEntry = (idx: number) => setTakeProfitLadder(takeProfitLadder.filter((_, i) => i !== idx));

  // Resolved scenario labels for display
  const btcFamily = btcFamilies[selectedBtcFamily];
  const netFamily = netFamilies[selectedNetFamily];

  // Detect fallback: bear/bull missing from selected family
  const btcFallback = btcFamily && (!btcFamily.bear || !btcFamily.bull);
  const netFallback = netFamily && (!netFamily.bear || !netFamily.bull);
  const hasFallback = btcFallback || netFallback;

  return (
    <PageShell
      title="Product Configuration"
      subtitle="Configure 3-bucket capital allocation and run multi-scenario simulation"
      runId={runId}
      onRun={runSimulation}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      {hasFallback && (
        <div className="mb-4 p-3 rounded text-xs border bg-emerald-900/20 border-emerald-700/40 text-emerald-300">
          <span className="font-semibold">Scenario Fallback Active:</span>
          {' '}
          {btcFallback && (
            <>
              BTC curve set is missing {!btcFamily.bear && !btcFamily.bull ? 'bear & bull' : !btcFamily.bear ? 'bear' : 'bull'} variants.
            </>
          )}
          {btcFallback && netFallback && ' '}
          {netFallback && (
            <>
              Network curve set is missing {!netFamily.bear && !netFamily.bull ? 'bear & bull' : !netFamily.bear ? 'bear' : 'bull'} variants.
            </>
          )}
          {' '}If the curve was created with a confidence band, bear/bull will be derived automatically.
          Otherwise, all three scenarios will produce identical results.
          For best results, create dedicated bear/base/bull curve sets.
        </div>
      )}

      {/* CSS custom properties for slider colors */}
      <style jsx>{`
        input[type='range'] {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          border-radius: 9999px;
          outline: none;
        }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          border: 3px solid currentColor;
          cursor: grab;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.1s;
        }
        input[type='range']::-webkit-slider-thumb:active {
          cursor: grabbing;
          transform: scale(1.15);
        }
        input[type='range']::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: white;
          border: 3px solid currentColor;
          cursor: grab;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .slider-yield { color: #16a34a; --slider-fill: #16a34a; }
        .slider-holding { color: #0891b2; --slider-fill: #0891b2; }
        .slider-mining { color: #65a30d; --slider-fill: #65a30d; }
      `}</style>

      <div className="space-y-6">
        {/* ═══════════ SECTION A: Product Structure ═══════════ */}
        <div className="border border-hearst-border rounded p-4">
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Product Structure</h3>
          <div className="grid grid-cols-3 gap-4">
            <InputField label="Capital Raised (USD)" value={capitalRaised} onChange={v => setCapitalRaised(Number(v))} type="number" />
            <div className="space-y-1">
              <div className="flex items-center min-h-[20px]">
                <label className="text-xs font-medium text-neutral-400">Tenor</label>
                <Tooltip text="Auto-set from the selected miner's depreciation lifespan. Change the miner in the Mining bucket to adjust." />
              </div>
              <div className="w-full px-2 py-1.5 rounded bg-hearst-card border border-hearst-border-light text-sm text-neutral-300 tabular-nums">
                {tenor} months <span className="text-neutral-500">({tenorYears} yr{Number(tenorYears) !== 1 ? 's' : ''})</span>
              </div>
              <p className="text-[10px] text-neutral-600">Linked to {selectedMinerObj?.name ?? 'miner'} lifespan</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center min-h-[20px]">
                <label className="text-xs font-medium text-neutral-400">Exit Windows</label>
                <Tooltip text="How often investors can redeem their position. Quarterly = every 3 months, Semi-Annual = every 6 months, Annual = once per year. Used for liquidity coverage ratio (LCR) calculations in the mining waterfall." />
              </div>
              <select
                value={exitFreq}
                onChange={e => setExitFreq(e.target.value)}
                className="w-full"
              >
                <option value="quarterly">Quarterly</option>
                <option value="semi-annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
        </div>

        {/* ═══════════ SECTION B: Capital Allocation with Sliders ═══════════ */}
        <div className="border border-hearst-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Capital Allocation</h3>
            <div className="text-xs">
              {allocationValid ? (
                <span className="text-green-400">Allocations balanced</span>
              ) : (
                <span className="text-lime-400">
                  Total: {totalPct.toFixed(1)}% — adjusting...
                </span>
              )}
            </div>
          </div>

          {/* Visual Allocation Bar */}
          <div className="h-6 rounded-full overflow-hidden flex mb-2 bg-hearst-card">
            <div className="bg-green-400 transition-all duration-150" style={{ width: `${yieldPct}%` }} />
            <div className="bg-cyan-400 transition-all duration-150" style={{ width: `${holdingPct}%` }} />
            <div className="bg-lime-400 transition-all duration-150" style={{ width: `${miningPct}%` }} />
          </div>
          <div className="flex gap-4 text-[10px] text-neutral-500 mb-6">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-green-400" />
              Yield Liquidity ({yieldPct.toFixed(1)}%)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-cyan-400" />
              BTC Holding ({holdingPct.toFixed(1)}%)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded bg-lime-400" />
              BTC Mining ({miningPct.toFixed(1)}%)
            </div>
          </div>

          {/* ── Allocation Sliders ── */}
          <div className="grid grid-cols-3 gap-6 mb-6">
            <div className="slider-yield">
              <AllocationSlider
                label="Yield Liquidity"
                pct={yieldPct}
                onPctChange={v => handleSliderChange('yield', v)}
                amountUsd={yieldAllocated}
                color="text-hearst-accent"
                trackColor="slider-yield"
                locked={yieldLocked}
                onToggleLock={() => setYieldLocked(v => !v)}
              />
            </div>
            <div className="slider-holding">
              <AllocationSlider
                label="BTC Holding"
                pct={holdingPct}
                onPctChange={v => handleSliderChange('holding', v)}
                amountUsd={holdingAllocated}
                color="text-cyan-400"
                trackColor="slider-holding"
                locked={holdingLocked}
                onToggleLock={() => setHoldingLocked(v => !v)}
              />
            </div>
            <div className="slider-mining">
              <AllocationSlider
                label="BTC Mining"
                pct={miningPct}
                onPctChange={v => handleSliderChange('mining', v)}
                amountUsd={miningAllocated}
                color="text-lime-400"
                trackColor="slider-mining"
                locked={miningLocked}
                onToggleLock={() => setMiningLocked(v => !v)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* ── Bucket A: Yield Liquidity ── */}
            <div className="border border-hearst-accent/20 rounded p-4 space-y-3 bg-hearst-accent/5">
              <h4 className="text-xs font-semibold text-hearst-accent uppercase">a. Yield Liquidity Product</h4>
              <div className="px-3 py-2 rounded bg-hearst-card text-sm text-neutral-300 tabular-nums">{formatUSD(yieldAllocated)}</div>
              <InputField label="Base Annual APR" value={yieldBaseApr} onChange={v => setYieldBaseApr(Number(v))} type="number" step={0.01} hint="e.g. 0.08 = 8%" />

              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useAprSchedule}
                  onChange={e => setUseAprSchedule(e.target.checked)}
                  className="rounded"
                />
                <span className="text-neutral-400">Custom APR schedule</span>
              </div>

              {useAprSchedule && (
                <div className="space-y-2">
                  {aprSchedule.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="text-neutral-500 w-8">Mo</span>
                      <input type="number" value={entry.from_month} onChange={e => updateAprEntry(idx, 'from_month', Number(e.target.value))} className="w-14" min={0} />
                      <span className="text-neutral-600">-</span>
                      <input type="number" value={entry.to_month} onChange={e => updateAprEntry(idx, 'to_month', Number(e.target.value))} className="w-14" min={0} />
                      <span className="text-neutral-500 w-8">APR</span>
                      <input type="number" value={entry.apr} onChange={e => updateAprEntry(idx, 'apr', Number(e.target.value))} className="w-16" step={0.01} />
                      <button className="text-red-400/60 hover:text-red-400" onClick={() => removeAprEntry(idx)}>x</button>
                    </div>
                  ))}
                  <button className="btn-secondary text-[10px]" onClick={addAprEntry}>+ Add Period</button>
                </div>
              )}
            </div>

            {/* ── Bucket B: BTC Holding ── */}
            <div className="border border-cyan-500/20 rounded p-4 space-y-3 bg-cyan-950/10">
              <h4 className="text-xs font-semibold text-cyan-400 uppercase">b. BTC Holding</h4>
              <div className="px-3 py-2 rounded bg-hearst-card text-sm text-neutral-300 tabular-nums">{formatUSD(holdingAllocated)}</div>

              {/* Buying Price with live BTC price fetch */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-neutral-400">Buying Price (USD)</label>
                  <div className="flex items-center gap-2">
                    {liveBtcPrice !== null && (
                      <button
                        onClick={() => setBuyingPrice(liveBtcPrice)}
                        className="text-[10px] text-hearst-accent hover:text-hearst-accent transition-colors"
                        title="Set to current BTC price"
                      >
                        Use live: {formatUSD(liveBtcPrice)}
                      </button>
                    )}
                    <button
                      onClick={() => fetchLiveBtcPrice(false)}
                      disabled={btcPriceLoading}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all ${
                        btcPriceLoading
                          ? 'text-neutral-500 cursor-wait'
                          : 'text-hearst-accent hover:bg-hearst-accent/10 hover:text-hearst-accent'
                      }`}
                      title="Refresh live BTC price"
                    >
                      <svg className={`w-3 h-3 ${btcPriceLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  value={buyingPrice}
                  onChange={e => setBuyingPrice(Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-neutral-600">BTC qty: {btcQuantity > 0 ? btcQuantity.toFixed(4) : '—'}</p>
                  {btcPriceUpdatedAt && (
                    <p className="text-[10px] text-neutral-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-hearst-accent animate-pulse" />
                      Live {btcPriceUpdatedAt.toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Target Sell Price — auto-derived to cover holding + mining investment */}
              <div className="space-y-1">
                <div className="flex items-center">
                  <label className="text-xs font-medium text-neutral-400">Target Sell Price (USD)</label>
                  <Tooltip text="Auto-computed: the BTC price at which selling the held BTC covers both the Holding and Mining initial investments. Formula: (Holding $ + Mining $) / BTC qty" />
                </div>
                <div className="w-full px-3 py-[7px] rounded bg-hearst-card border border-cyan-500/20 text-sm text-cyan-400 tabular-nums font-semibold">
                  {formatUSD(targetSellPrice)}
                </div>
                <p className="text-[10px] text-neutral-600">
                  Covers: {formatUSD(holdingAllocated)} (holding) + {formatUSD(miningAllocated)} (mining) = {formatUSD(holdingAllocated + miningAllocated)}
                </p>
              </div>
              {buyingPrice > 0 && targetSellPrice > buyingPrice && (
                <div className="text-[10px] text-neutral-500">
                  Required BTC appreciation: {(((targetSellPrice - buyingPrice) / buyingPrice) * 100).toFixed(1)}% from buying price
                </div>
              )}
            </div>

            {/* ── Bucket C: BTC Mining ── */}
            <div className="border border-lime-500/20 rounded p-4 space-y-3 bg-lime-900/5">
              <h4 className="text-xs font-semibold text-lime-400 uppercase">c. BTC Mining</h4>
              <div className="px-3 py-2 rounded bg-hearst-card text-sm text-neutral-300 tabular-nums">{formatUSD(miningAllocated)}</div>
              <SelectField
                label="Miner"
                value={selectedMiner}
                onChange={setSelectedMiner}
                options={miners.map((m: any) => ({ value: m.id, label: `${m.name} (${m.hashrate_th} TH/s, ${formatUSD(m.price_usd)})` }))}
              />
              <SelectField
                label="Hosting Site"
                value={selectedSite}
                onChange={setSelectedSite}
                options={sites.map((s: any) => ({ value: s.id, label: `${s.name} ($${s.electricity_price_usd_per_kwh}/kWh)` }))}
              />
              <InputField label="Miner Count" value={minerCount} onChange={v => setMinerCount(Number(v))} type="number" min={1} hint="Auto-calculated from allocation / miner price" />

              <div className="grid grid-cols-2 gap-2">
                <InputField label="Base Yield APR" value={miningBaseYield} onChange={v => setMiningBaseYield(Number(v))} type="number" step={0.01} hint="8% base yield" />
                <InputField label="Bonus Yield APR" value={miningBonusYield} onChange={v => setMiningBonusYield(Number(v))} type="number" step={0.01} hint="+4% when BTC target hit" />
              </div>
              <p className="text-[10px] text-neutral-600">
                Combined: {((miningBaseYield + miningBonusYield) * 100).toFixed(0)}% APR when BTC holding target is hit
              </p>

              {/* Take-Profit Ladder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-neutral-500 uppercase">Take-Profit Ladder</span>
                  <button className="btn-secondary text-[10px]" onClick={addTakeProfitEntry}>+ Add</button>
                </div>
                {takeProfitLadder.map((tp, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="text-neutral-500 w-16">Trigger $</span>
                    <input type="number" value={tp.price_trigger} onChange={e => updateTakeProfitEntry(idx, 'price_trigger', Number(e.target.value))} className="w-24" />
                    <span className="text-neutral-500 w-12">Sell %</span>
                    <input type="number" value={tp.sell_pct} onChange={e => updateTakeProfitEntry(idx, 'sell_pct', Number(e.target.value))} className="w-16" step={0.05} />
                    <button className="text-red-400/60 hover:text-red-400" onClick={() => removeTakeProfitEntry(idx)}>x</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ SECTION C: Simplified Scenario Selectors ═══════════ */}
        <div className="border border-hearst-border rounded p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Scenario Curves</h3>
              <p className="text-[10px] text-neutral-600 mt-1">Select a curve set — bear, base, and bull scenarios are automatically mapped</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* BTC Price Selector */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-400">BTC Price Curve</label>
                <select
                  value={selectedBtcFamily}
                  onChange={e => setSelectedBtcFamily(e.target.value)}
                  className="w-full"
                >
                  <option value="" disabled>— Select BTC Curve Set —</option>
                  {Object.entries(btcFamilies).map(([key, family]) => (
                    <option key={key} value={key}>{family.name}</option>
                  ))}
                </select>
              </div>
              {/* Scenario mapping badges */}
              {btcFamily && (
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${btcFamily.bear ? 'bg-red-900/30 text-red-400 border border-red-800/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Bear {btcFamily.bear ? `— ${btcFamily.bear.name}` : '(fallback)'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${btcFamily.base ? 'bg-hearst-border/50 text-neutral-300 border border-hearst-border-light/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Base {btcFamily.base ? `— ${btcFamily.base.name}` : '(fallback)'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${btcFamily.bull ? 'bg-green-900/30 text-green-400 border border-green-800/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Bull {btcFamily.bull ? `— ${btcFamily.bull.name}` : '(fallback)'}
                  </span>
                </div>
              )}
            </div>

            {/* Network Selector */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-400">Network Curve</label>
                <select
                  value={selectedNetFamily}
                  onChange={e => setSelectedNetFamily(e.target.value)}
                  className="w-full"
                >
                  <option value="" disabled>— Select Network Curve Set —</option>
                  {Object.entries(netFamilies).map(([key, family]) => (
                    <option key={key} value={key}>{family.name}</option>
                  ))}
                </select>
              </div>
              {/* Scenario mapping badges */}
              {netFamily && (
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${netFamily.bear ? 'bg-red-900/30 text-red-400 border border-red-800/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Bear {netFamily.bear ? `— ${netFamily.bear.name}` : '(fallback)'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${netFamily.base ? 'bg-hearst-border/50 text-neutral-300 border border-hearst-border-light/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Base {netFamily.base ? `— ${netFamily.base.name}` : '(fallback)'}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${netFamily.bull ? 'bg-green-900/30 text-green-400 border border-green-800/40' : 'bg-hearst-card text-neutral-600 border border-hearst-border'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Bull {netFamily.bull ? `— ${netFamily.bull.name}` : '(fallback)'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
