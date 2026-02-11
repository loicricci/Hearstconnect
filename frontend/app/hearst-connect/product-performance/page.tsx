'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, Bar,
} from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import {
  productApi, btcPriceCurveApi, networkCurveApi,
  minersApi, hostingApi, opsApi,
} from '@/lib/api';
import { formatUSD, formatBTC, formatPercent, formatNumber } from '@/lib/utils';

export default function ProductPerformancePage() {
  // Dependencies
  const [curves, setCurves] = useState<any[]>([]);
  const [networkCurves, setNetworkCurves] = useState<any[]>([]);
  const [miners, setMiners] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [calibRuns, setCalibRuns] = useState<any[]>([]);

  // Product inputs
  const [capitalRaised, setCapitalRaised] = useState(10000000);
  const [structureType, setStructureType] = useState('dedicated');
  const [tenor, setTenor] = useState(36);
  const [exitFreq, setExitFreq] = useState('quarterly');
  const [baseYieldApr, setBaseYieldApr] = useState(0.08);
  const [bonusYieldApr, setBonusYieldApr] = useState(0.04);
  const [hardwareCapex, setHardwareCapex] = useState(5000000);
  const [minerLifetime, setMinerLifetime] = useState(36);
  const [minerCount, setMinerCount] = useState(500);

  // Selections
  const [selectedBTCCurve, setSelectedBTCCurve] = useState('');
  const [selectedNetCurve, setSelectedNetCurve] = useState('');
  const [selectedMiner, setSelectedMiner] = useState('');
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedCalib, setSelectedCalib] = useState('');

  // Take-profit ladder
  const [takeProfits, setTakeProfits] = useState<{ price_trigger: number; sell_pct: number }[]>([
    { price_trigger: 120000, sell_pct: 0.20 },
    { price_trigger: 140000, sell_pct: 0.30 },
    { price_trigger: 160000, sell_pct: 0.30 },
  ]);

  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [btc, net, m, s, cal]: any = await Promise.all([
        btcPriceCurveApi.list(),
        networkCurveApi.list(),
        minersApi.list(),
        hostingApi.list(),
        opsApi.listCalibrationRuns(),
      ]);
      setCurves(btc);
      setNetworkCurves(net);
      setMiners(m);
      setSites(s);
      setCalibRuns(cal);
      if (btc.length > 0) setSelectedBTCCurve(btc[0].id);
      if (net.length > 0) setSelectedNetCurve(net[0].id);
      if (m.length > 0) setSelectedMiner(m[0].id);
      if (s.length > 0) setSelectedSite(s[0].id);
    } catch (e) { /* API not available yet */ }
  };

  const addTakeProfit = () => {
    setTakeProfits([...takeProfits, { price_trigger: 180000, sell_pct: 0.20 }]);
  };

  const updateTakeProfit = (idx: number, field: string, value: number) => {
    const updated = [...takeProfits];
    (updated[idx] as any)[field] = value;
    setTakeProfits(updated);
  };

  const runSimulation = async () => {
    if (!selectedBTCCurve || !selectedNetCurve || !selectedMiner || !selectedSite) {
      setError('All curve/miner/hosting selections are required.');
      return;
    }
    setRunning(true);
    setError('');
    try {
      const res = await productApi.simulate3y({
        capital_raised_usd: capitalRaised,
        structure_type: structureType,
        product_tenor_months: tenor,
        exit_window_frequency: exitFreq,
        base_yield_apr: baseYieldApr,
        bonus_yield_apr: bonusYieldApr,
        hardware_capex_usd: hardwareCapex,
        miner_lifetime_months: minerLifetime,
        miner_count: minerCount,
        btc_price_curve_id: selectedBTCCurve,
        network_curve_id: selectedNetCurve,
        miner_id: selectedMiner,
        hosting_site_id: selectedSite,
        calibration_run_id: selectedCalib || null,
        take_profit_ladder: takeProfits,
      });
      setResult(res);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  const decisionColor = (d: string) => {
    if (d === 'APPROVED') return 'green';
    if (d === 'ADJUST') return 'yellow';
    return 'red';
  };

  return (
    <PageShell
      title="Product Performance"
      subtitle="36-month financial product waterfall simulation"
      runId={result?.id}
      lastRunAt={result?.created_at}
      warnings={result?.flags?.filter((f: string) => !f.includes('DEFICIT')) || []}
      hardBlocks={result?.flags?.filter((f: string) => f.includes('DEFICIT')) || []}
      onRun={runSimulation}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="col-span-4 space-y-4 max-h-[calc(100vh-200px)] overflow-auto pr-2">
          {/* Product Structure */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Product Structure</h3>
            <InputField label="Capital Raised (USD)" value={capitalRaised} onChange={v => setCapitalRaised(Number(v))} type="number" step={1000000} />
            <SelectField
              label="Structure Type"
              value={structureType}
              onChange={setStructureType}
              options={[
                { value: 'dedicated', label: 'Dedicated' },
                { value: 'pooled', label: 'Pooled' },
              ]}
            />
            <InputField label="Tenor (months)" value={tenor} onChange={v => setTenor(Number(v))} type="number" />
            <SelectField
              label="Exit Windows"
              value={exitFreq}
              onChange={setExitFreq}
              options={[
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'semi-annual', label: 'Semi-Annual' },
                { value: 'annual', label: 'Annual' },
              ]}
            />
            <InputField label="Base Yield APR" value={baseYieldApr} onChange={v => setBaseYieldApr(Number(v))} type="number" step={0.01} hint="e.g. 0.08 = 8%" />
          </div>

          {/* Reserve Policy */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Yield Policy</h3>
            <InputField label="Bonus Yield APR" value={bonusYieldApr} onChange={v => setBonusYieldApr(Number(v))} type="number" step={0.01} hint="+4% when BTC target hit" />
            <InputField label="Hardware CAPEX (USD)" value={hardwareCapex} onChange={v => setHardwareCapex(Number(v))} type="number" step={500000} />
            <InputField label="Miner Lifetime (mo)" value={minerLifetime} onChange={v => setMinerLifetime(Number(v))} type="number" />
            <InputField label="Miner Count" value={minerCount} onChange={v => setMinerCount(Number(v))} type="number" />
          </div>

          {/* Dependencies */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Dependencies</h3>
            <SelectField
              label="BTC Price Curve"
              value={selectedBTCCurve}
              onChange={setSelectedBTCCurve}
              options={curves.map((c: any) => ({ value: c.id, label: `${c.name} (${c.scenario})` }))}
            />
            <SelectField
              label="Network Curve"
              value={selectedNetCurve}
              onChange={setSelectedNetCurve}
              options={networkCurves.map((c: any) => ({ value: c.id, label: `${c.name} (${c.scenario})` }))}
            />
            <SelectField
              label="Miner"
              value={selectedMiner}
              onChange={setSelectedMiner}
              options={miners.map((m: any) => ({ value: m.id, label: m.name }))}
            />
            <SelectField
              label="Hosting Site"
              value={selectedSite}
              onChange={setSelectedSite}
              options={sites.map((s: any) => ({ value: s.id, label: s.name }))}
            />
            <SelectField
              label="Calibration Run (optional)"
              value={selectedCalib}
              onChange={setSelectedCalib}
              options={[
                { value: '', label: 'None' },
                ...calibRuns.map((r: any) => ({
                  value: r.id,
                  label: `${r.id.slice(0, 8)} (${r.created_at.slice(0, 10)})`,
                })),
              ]}
            />
          </div>

          {/* Take-Profit Ladder */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Take-Profit Ladder</h3>
              <button className="btn-secondary text-[10px]" onClick={addTakeProfit}>+ Add</button>
            </div>
            {takeProfits.map((tp, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="text-neutral-500 w-6">{idx + 1}</span>
                <input
                  type="number"
                  value={tp.price_trigger}
                  onChange={e => updateTakeProfit(idx, 'price_trigger', Number(e.target.value))}
                  className="flex-1"
                  placeholder="Price trigger"
                  step={10000}
                />
                <input
                  type="number"
                  value={tp.sell_pct}
                  onChange={e => updateTakeProfit(idx, 'sell_pct', Number(e.target.value))}
                  className="w-20"
                  placeholder="Sell %"
                  step={0.05}
                />
                <button
                  className="text-red-400/60 hover:text-red-400"
                  onClick={() => setTakeProfits(takeProfits.filter((_, i) => i !== idx))}
                >×</button>
              </div>
            ))}
          </div>
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-8 space-y-4 max-h-[calc(100vh-200px)] overflow-auto pr-2">
          {result && (
            <>
              {/* Decision Banner */}
              <div className={`p-4 rounded-xl border ${
                result.decision === 'APPROVED' ? 'bg-green-900/20 border-green-700/50' :
                result.decision === 'ADJUST' ? 'bg-yellow-900/20 border-yellow-700/50' :
                'bg-red-900/20 border-red-700/50'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-lg font-bold ${
                      result.decision === 'APPROVED' ? 'text-green-400' :
                      result.decision === 'ADJUST' ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {result.decision}
                    </span>
                    <span className="text-xs text-neutral-500 ml-3">
                      Decision for new subscriptions
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {result.metrics?.final_health_score?.toFixed(0)}/100
                    </div>
                    <div className="text-[10px] text-neutral-500">Health Score</div>
                  </div>
                </div>
                {result.decision_reasons?.length > 0 && (
                  <ul className="mt-2 text-xs text-neutral-400 list-disc ml-4">
                    {result.decision_reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-4 gap-3">
                <MetricCard
                  label="Effective APR"
                  value={formatPercent(result.metrics.effective_apr)}
                  sub="Realized yield"
                  status={result.metrics.effective_apr >= 0.08 ? 'green' : 'yellow'}
                />
                <MetricCard
                  label="OPEX Coverage"
                  value={`${formatNumber(result.metrics.avg_opex_coverage_ratio || 0, 2)}x`}
                  sub="Avg OPEX coverage"
                  status={(result.metrics.avg_opex_coverage_ratio || 0) >= 1.5 ? 'green' : (result.metrics.avg_opex_coverage_ratio || 0) >= 1.0 ? 'yellow' : 'red'}
                />
                <MetricCard
                  label="Capitalization"
                  value={formatUSD(result.metrics.capitalization_usd_final || 0)}
                  sub="Final cap value"
                  status={(result.metrics.capitalization_usd_final || 0) > 0 ? 'green' : 'neutral'}
                />
                <MetricCard
                  label="Deficit Months"
                  value={`${result.metrics.red_flag_months}`}
                  sub={`of ${tenor} months`}
                  status={result.metrics.red_flag_months === 0 ? 'green' : result.metrics.red_flag_months <= 3 ? 'yellow' : 'red'}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Total BTC Produced" value={formatBTC(result.metrics.total_btc_produced)} />
                <MetricCard label="Cumulative Yield" value={formatUSD(result.metrics.cumulative_yield_paid_usd)} status="green" />
                <MetricCard label="Capitalization BTC" value={formatBTC(result.metrics.capitalization_btc_final || 0)} />
              </div>

              {/* Health Score & Capitalization Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Health Score & Capitalization Over Time</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={result.monthly_waterfall}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#737373' }} domain={[0, 100]} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1e6).toFixed(1)}M`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="left" type="monotone" dataKey="health_score" stroke="#4ade80" strokeWidth={2} dot={false} name="Health Score" />
                    <Area yAxisId="right" type="monotone" dataKey="capitalization_usd" fill="#06b6d420" stroke="#06b6d4" strokeWidth={1} name="Capitalization (USD)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Waterfall BTC Breakdown */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly BTC Waterfall</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={result.monthly_waterfall}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="btc_sell_opex" stackId="a" fill="#ef4444" name="OPEX" />
                    <Bar dataKey="btc_for_yield" stackId="a" fill="#22c55e" name="Yield" />
                    <Bar dataKey="btc_to_capitalization" stackId="a" fill="#06b6d4" name="Capitalization" />
                    <Line type="monotone" dataKey="btc_produced" stroke="#ffffff" strokeWidth={1.5} dot={false} name="BTC Produced" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Yield Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly Yield Paid (USD)</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={result.monthly_waterfall}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Area type="monotone" dataKey="yield_paid_usd" fill="#22c55e30" stroke="#22c55e" strokeWidth={1.5} name="Yield Paid USD" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Full Waterfall Table */}
              <DataTable
                title="Monthly Waterfall Table"
                columns={[
                  { key: 'month', label: 'Mo' },
                  { key: 'btc_price_usd', label: 'BTC Price', format: (v: number) => formatUSD(v) },
                  { key: 'btc_produced', label: 'BTC Prod', format: (v: number) => v.toFixed(6) },
                  { key: 'btc_sell_opex', label: 'OPEX BTC', format: (v: number) => v.toFixed(6) },
                  { key: 'btc_for_yield', label: 'Yield BTC', format: (v: number) => (v || 0).toFixed(6) },
                  { key: 'btc_to_capitalization', label: 'Cap BTC', format: (v: number) => (v || 0).toFixed(6) },
                  { key: 'opex_usd', label: 'OPEX USD', format: (v: number) => formatUSD(v) },
                  { key: 'yield_paid_usd', label: 'Yield USD', format: (v: number) => formatUSD(v) },
                  { key: 'yield_apr_applied', label: 'APR', format: (v: number) => formatPercent(v || 0) },
                  { key: 'capitalization_usd', label: 'Cap USD', format: (v: number) => formatUSD(v || 0) },
                  { key: 'opex_coverage_ratio', label: 'OPEX Cov', format: (v: number) => `${(v || 0).toFixed(2)}x` },
                  { key: 'health_score', label: 'Health' },
                  { key: 'flag', label: 'Flag' },
                ]}
                rows={result.monthly_waterfall}
                exportName={`product-waterfall-${result.id}`}
                maxHeight="400px"
              />
            </>
          )}

          {!result && !running && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              Configure product parameters, select all dependencies, then click "Run Simulation".
              <br />
              <span className="text-[10px] text-neutral-700 mt-1">
                Requires: BTC price curve, network curve, miner, and hosting site generated from pages 1-4.
              </span>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
