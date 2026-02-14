'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { networkCurveApi } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

export default function NetworkCurvePage() {
  // ── Common state ──
  const [name, setName] = useState('');
  const nextNumber = useRef(1);

  // ── Saved simulations state ──
  const [savedCurves, setSavedCurves] = useState<any[]>([]);
  const [selectedCurveId, setSelectedCurveId] = useState('');
  const [loadingCurve, setLoadingCurve] = useState(false);

  // Fetch existing curves list
  const fetchSavedCurves = useCallback(async () => {
    try {
      const curves = await networkCurveApi.list() as any[];
      setSavedCurves(curves);
      return curves;
    } catch {
      return [];
    }
  }, []);

  // Fetch existing curves to determine next increment number
  useEffect(() => {
    fetchSavedCurves().then((curves) => {
      let maxNum = 0;
      curves.forEach((c: any) => {
        const match = c.name?.match(/^Network Curve #(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
      const next = Math.max(maxNum + 1, curves.length + 1);
      nextNumber.current = next;
      setName(`Network Curve #${next}`);
    }).catch(() => {
      setName('Network Curve #1');
    });
  }, [fetchSavedCurves]);

  // Load a saved simulation by ID
  const loadSavedCurve = useCallback(async (id: string) => {
    if (!id) {
      setSelectedCurveId('');
      setResult(null);
      return;
    }
    setSelectedCurveId(id);
    setLoadingCurve(true);
    setError('');
    try {
      const curve = await networkCurveApi.get(id);
      setResult(curve);
    } catch (e: any) {
      setError(`Failed to load curve: ${e.message}`);
    }
    setLoadingCurve(false);
  }, []);
  const [deleting, setDeleting] = useState(false);

  // Delete a saved curve by ID
  const deleteCurve = useCallback(async (id: string) => {
    if (!id) return;
    const curveName = savedCurves.find(c => c.id === id)?.name || id;
    if (!window.confirm(`Delete "${curveName}"? This action cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await networkCurveApi.delete(id);
      // Clear selection if the deleted curve was selected
      if (selectedCurveId === id) {
        setSelectedCurveId('');
        setResult(null);
      }
      // Refresh the list
      await fetchSavedCurves();
    } catch (e: any) {
      setError(`Failed to delete curve: ${e.message}`);
    }
    setDeleting(false);
  }, [savedCurves, selectedCurveId, fetchSavedCurves]);

  const [scenario, setScenario] = useState('base');
  const [halvingEnabled, setHalvingEnabled] = useState(true);
  const [monthsToNextHalving, setMonthsToNextHalving] = useState(26);
  const [mode, setMode] = useState<'deterministic' | 'ml_forecast'>('deterministic');

  // ── Deterministic mode state ──
  const [startHashrateEH, setStartHashrateEH] = useState(800);
  const [monthlyGrowth, setMonthlyGrowth] = useState(0.02);
  const [feeRegime, setFeeRegime] = useState('base');
  const [startingFees, setStartingFees] = useState(0.5);
  const [confidenceBandPct, setConfidenceBandPct] = useState(20);

  // ── ML mode state ──
  const [modelType, setModelType] = useState('auto_arima');
  const [confidenceInterval, setConfidenceInterval] = useState(0.95);

  // ── Result state ──
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const runSimulation = async () => {
    if (!name.trim()) {
      setError('Please enter a curve name before running the simulation.');
      return;
    }
    setRunning(true);
    setError('');
    try {
      const payload: any = {
        name: name.trim(),
        scenario,
        months: 120,
        halving_enabled: halvingEnabled,
        months_to_next_halving: monthsToNextHalving,
        mode,
      };

      if (mode === 'ml_forecast') {
        payload.model_type = modelType;
        payload.confidence_interval = confidenceInterval;
      } else {
        payload.starting_network_hashrate_eh = startHashrateEH;
        payload.monthly_difficulty_growth_rate = monthlyGrowth;
        payload.fee_regime = feeRegime;
        payload.starting_fees_per_block_btc = startingFees;
        payload.confidence_band_pct = confidenceBandPct;
      }

      const res = await networkCurveApi.generate(payload);
      setResult(res);
      setSelectedCurveId(res.id || '');

      // Auto-increment name for the next run
      nextNumber.current += 1;
      setName(`Network Curve #${nextNumber.current}`);

      // Refresh saved curves list
      fetchSavedCurves();
    } catch (e: any) {
      setError(e.message);
    }
    setRunning(false);
  };

  const isML = result?.mode === 'ml_forecast';
  const bands = result?.confidence_bands;

  // ── Hashprice chart data ──
  const hashpriceChartData = result ? result.hashprice_btc_per_ph_day.map((hp: number, i: number) => {
    const point: any = { month: i, hashprice: hp };
    if (bands?.hashprice) {
      point.hp_band = [bands.hashprice.lower[i], bands.hashprice.upper[i]];
    }
    return point;
  }) : [];

  // ── Hashrate chart data ──
  const hashrateChartData = result ? result.network_hashrate_eh.map((hr: number, i: number) => {
    const point: any = { month: i, hashrate_eh: hr };
    if (bands?.hashrate) {
      point.hr_band = [bands.hashrate.lower[i], bands.hashrate.upper[i]];
    }
    return point;
  }) : [];

  // ── Fees chart data ──
  const feesChartData = result ? result.fees_per_block_btc.map((fee: number, i: number) => {
    const point: any = { month: i, fees: fee };
    if (bands?.fees) {
      point.fee_band = [bands.fees.lower[i], bands.fees.upper[i]];
    }
    return point;
  }) : [];

  // ── Table data ──
  const tableRows = result ? result.hashprice_btc_per_ph_day.map((hp: number, i: number) => ({
    month: i,
    year: Math.floor(i / 12),
    hashprice_btc_ph_day: hp.toFixed(8),
    hashrate_eh: formatNumber(result.network_hashrate_eh[i], 1),
    fees_btc: result.fees_per_block_btc[i].toFixed(6),
    difficulty: result.difficulty[i].toExponential(2),
  })) : [];

  const bandLabel = isML
    ? ` (${(confidenceInterval * 100).toFixed(0)}% CI)`
    : bands ? ` (±${confidenceBandPct}%)` : '';

  return (
    <PageShell
      title="Network Curve"
      subtitle="10-year difficulty, hashprice, and fee regime simulation"
      runId={result?.id}
      lastRunAt={result?.created_at}
      warnings={result?.warnings || []}
      onRun={runSimulation}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="col-span-4 space-y-4">
          {/* Saved Simulations */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Saved Simulations</h3>
            {savedCurves.length === 0 ? (
              <p className="text-[10px] text-neutral-600">No saved simulations yet. Run one to see it here.</p>
            ) : (
              <>
                <SelectField
                  label="Load Curve"
                  value={selectedCurveId}
                  onChange={loadSavedCurve}
                  options={savedCurves.map((c: any) => ({
                    value: c.id,
                    label: `${c.name || c.id}  —  ${c.scenario || ''}`,
                  }))}
                  placeholder="— Select a saved simulation —"
                />
                {selectedCurveId && result && (
                  <div className="mt-2 p-2.5 rounded bg-hearst-card border border-hearst-border/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-neutral-300">{result.name || result.id}</span>
                      <span className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded ${
                        result.scenario === 'bull' ? 'bg-green-900/40 text-green-400' :
                        result.scenario === 'bear' ? 'bg-red-900/40 text-red-400' :
                        'bg-hearst-accent/15 text-hearst-accent'
                      }`}>
                        {result.scenario}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                      <div className="text-neutral-500">Mode</div>
                      <div className="text-neutral-300 capitalize">{result.mode?.replace('_', ' ') || 'deterministic'}</div>
                      <div className="text-neutral-500">Start HP</div>
                      <div className="text-neutral-300">{result.hashprice_btc_per_ph_day?.[0]?.toFixed(6) ?? '—'} BTC/PH/d</div>
                      <div className="text-neutral-500">End HP</div>
                      <div className="text-neutral-300">{result.hashprice_btc_per_ph_day?.[result.hashprice_btc_per_ph_day.length - 1]?.toFixed(6) ?? '—'} BTC/PH/d</div>
                      <div className="text-neutral-500">Created</div>
                      <div className="text-neutral-300">{result.created_at ? new Date(result.created_at).toLocaleDateString() : '—'}</div>
                    </div>
                    <button
                      onClick={() => deleteCurve(selectedCurveId)}
                      disabled={deleting}
                      className="mt-2 w-full py-1.5 text-[10px] font-medium rounded-xl border border-red-700/50 bg-red-900/20 text-red-400 hover:bg-red-900/40 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleting ? 'Deleting…' : 'Delete This Curve'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mode Toggle */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Mode</h3>
            <div className="flex rounded-lg overflow-hidden border border-hearst-border-light">
              <button
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  mode === 'deterministic'
                    ? 'bg-hearst-accent text-white'
                    : 'bg-hearst-card text-neutral-400 hover:text-neutral-300'
                }`}
                onClick={() => { setMode('deterministic'); setResult(null); }}
              >
                Deterministic
              </button>
              <button
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  mode === 'ml_forecast'
                    ? 'bg-hearst-accent text-white'
                    : 'bg-hearst-card text-neutral-400 hover:text-neutral-300'
                }`}
                onClick={() => { setMode('ml_forecast'); setResult(null); }}
              >
                ML Forecast
              </button>
            </div>
            {mode === 'ml_forecast' && (
              <p className="text-[10px] text-hearst-accent/70 leading-snug">
                Trains separate time-series models on historical hashrate &amp; fees, then derives difficulty and hashprice.
              </p>
            )}
          </div>

          {/* Common Settings */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Network Settings</h3>
            <InputField label="Curve Name" value={name} onChange={setName} />
            <SelectField
              label="Scenario"
              value={scenario}
              onChange={setScenario}
              options={[
                { value: 'bear', label: 'Bear' },
                { value: 'base', label: 'Base' },
                { value: 'bull', label: 'Bull' },
              ]}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={halvingEnabled}
                onChange={e => setHalvingEnabled(e.target.checked)}
                className="rounded bg-hearst-border border-hearst-border-light"
              />
              <label className="text-xs text-neutral-400">Halving Schedule Awareness</label>
            </div>
            {halvingEnabled && (
              <InputField
                label="Months to Next Halving"
                value={monthsToNextHalving}
                onChange={v => setMonthsToNextHalving(Number(v))}
                type="number"
                min={0}
                max={120}
                hint="Month offset when next BTC halving occurs (subsequent halvings every 48 months)"
              />
            )}
          </div>

          {/* Deterministic Inputs */}
          {mode === 'deterministic' && (
            <div className="border border-hearst-border rounded p-4 space-y-3">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Deterministic Settings</h3>
              <InputField
                label="Starting Network Hashrate (EH/s)"
                value={startHashrateEH}
                onChange={v => setStartHashrateEH(Number(v))}
                type="number"
                min={1}
                step={50}
              />
              <InputField
                label="Monthly Difficulty Growth Rate"
                value={monthlyGrowth}
                onChange={v => setMonthlyGrowth(Number(v))}
                type="number"
                min={0}
                max={0.2}
                step={0.005}
                hint="e.g. 0.02 = 2% per month"
              />
              <SelectField
                label="Fee Regime"
                value={feeRegime}
                onChange={setFeeRegime}
                options={[
                  { value: 'low', label: 'Low (0.5x)' },
                  { value: 'base', label: 'Base (1.0x)' },
                  { value: 'high', label: 'High (2.0x)' },
                ]}
              />
              <InputField
                label="Starting Fees per Block (BTC)"
                value={startingFees}
                onChange={v => setStartingFees(Number(v))}
                type="number"
                min={0}
                step={0.1}
              />
              <InputField
                label="Confidence Band (±%)"
                value={confidenceBandPct}
                onChange={v => setConfidenceBandPct(Number(v))}
                type="number"
                min={0}
                max={100}
                step={5}
                hint="Bear/Bull envelope around the base curves (0 = off)"
              />
            </div>
          )}

          {/* ML Forecast Inputs */}
          {mode === 'ml_forecast' && (
            <div className="border border-hearst-accent/20 rounded p-4 space-y-3 bg-hearst-accent/5">
              <h3 className="text-xs font-semibold text-hearst-accent uppercase tracking-wider">ML Model Settings</h3>
              <SelectField
                label="Model Type"
                value={modelType}
                onChange={setModelType}
                options={[
                  { value: 'auto_arima', label: 'Auto ARIMA' },
                  { value: 'holt_winters', label: 'Holt-Winters (Exp. Smoothing)' },
                  { value: 'sarimax', label: 'SARIMAX' },
                ]}
              />
              <SelectField
                label="Confidence Interval"
                value={String(confidenceInterval)}
                onChange={v => setConfidenceInterval(Number(v))}
                options={[
                  { value: '0.80', label: '80%' },
                  { value: '0.90', label: '90%' },
                  { value: '0.95', label: '95%' },
                ]}
              />
              <div className="mt-2 p-2 rounded bg-hearst-card text-[10px] text-neutral-500 space-y-1">
                <p><strong>Hashrate &amp; fees</strong> are forecasted independently by the model.</p>
                <p><strong>Difficulty</strong> is derived from forecasted hashrate.</p>
                <p><strong>Hashprice</strong> is derived from hashrate + fees + halving schedule.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-8 space-y-4">
          {result && (
            <>
              {/* Top Metrics */}
              <div className="grid grid-cols-4 gap-3">
                <MetricCard
                  label="Start Hashprice"
                  value={`${result.hashprice_btc_per_ph_day[0].toFixed(6)}`}
                  sub="BTC/PH/day"
                />
                <MetricCard
                  label="End Hashprice"
                  value={`${result.hashprice_btc_per_ph_day[result.hashprice_btc_per_ph_day.length - 1].toFixed(6)}`}
                  sub="BTC/PH/day"
                />
                <MetricCard
                  label="Start Hashrate"
                  value={`${formatNumber(result.network_hashrate_eh[0], 0)} EH/s`}
                />
                <MetricCard
                  label="End Hashrate"
                  value={`${formatNumber(result.network_hashrate_eh[result.network_hashrate_eh.length - 1], 0)} EH/s`}
                />
              </div>

              {/* Model Info (ML only) */}
              {isML && result.model_info && (
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard
                    label="Model"
                    value={modelType.replace(/_/g, ' ').toUpperCase()}
                  />
                  <MetricCard
                    label="Training Data"
                    value={`${result.model_info.training_months} months`}
                    sub={`${result.model_info.training_start} → ${result.model_info.training_end}`}
                  />
                  <MetricCard
                    label="Confidence"
                    value={`${(result.model_info.confidence_interval * 100).toFixed(0)}%`}
                    sub="prediction interval"
                  />
                </div>
              )}

              {/* Hashprice Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">
                  Hashprice (BTC/PH/day){bandLabel}
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={hashpriceChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `Y${Math.floor(v / 12)}`} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: any, name: string) => {
                        if (Array.isArray(v)) return [`${v[0].toFixed(8)} — ${v[1].toFixed(8)}`, isML ? 'CI' : 'Bear / Bull'];
                        return [typeof v === 'number' ? v.toFixed(8) : v, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {bands?.hashprice && (
                      <Area type="monotone" dataKey="hp_band" fill="#f59e0b" fillOpacity={0.12} stroke="#f59e0b40" name={isML ? 'CI Band' : 'Bear / Bull'} />
                    )}
                    <Line type="monotone" dataKey="hashprice" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Hashprice" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Network Hashrate Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">
                  Network Hashrate (EH/s){bandLabel}
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={hashrateChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `Y${Math.floor(v / 12)}`} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: any, name: string) => {
                        if (Array.isArray(v)) return [`${v[0].toFixed(1)} — ${v[1].toFixed(1)}`, isML ? 'CI' : 'Bear / Bull'];
                        return [typeof v === 'number' ? formatNumber(v, 1) : v, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {bands?.hashrate && (
                      <Area type="monotone" dataKey="hr_band" fill="#22c55e" fillOpacity={0.12} stroke="#22c55e40" name={isML ? 'CI Band' : 'Bear / Bull'} />
                    )}
                    <Line type="monotone" dataKey="hashrate_eh" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Hashrate" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Fees Chart — shows when bands exist (ML or deterministic with confidence %) */}
              {bands?.fees && (
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">
                    Fees per Block (BTC){bandLabel}
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={feesChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `Y${Math.floor(v / 12)}`} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                        formatter={(v: any, name: string) => {
                          if (Array.isArray(v)) return [`${v[0].toFixed(6)} — ${v[1].toFixed(6)}`, isML ? 'CI' : 'Bear / Bull'];
                          return [typeof v === 'number' ? v.toFixed(6) : v, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="fee_band" fill="#8b5cf6" fillOpacity={0.12} stroke="#8b5cf640" name={isML ? 'CI Band' : 'Bear / Bull'} />
                      <Line type="monotone" dataKey="fees" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="Fees/Block" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Data Table */}
              <DataTable
                title="Monthly Network Data"
                columns={[
                  { key: 'month', label: 'Month' },
                  { key: 'year', label: 'Year' },
                  { key: 'hashprice_btc_ph_day', label: 'HP (BTC/PH/d)' },
                  { key: 'hashrate_eh', label: 'Hashrate (EH/s)' },
                  { key: 'fees_btc', label: 'Fees/Block (BTC)' },
                  { key: 'difficulty', label: 'Difficulty' },
                ]}
                rows={tableRows}
                exportName={`network-curve-${result.id}`}
                maxHeight="300px"
              />
            </>
          )}

          {!result && !running && !loadingCurve && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              <div className="text-center space-y-1">
                <p>{mode === 'ml_forecast'
                  ? 'Select a model and click "Run Simulation" to generate ML-powered network forecasts.'
                  : 'Configure inputs and click "Run Simulation" to generate network curves.'}</p>
                {savedCurves.length > 0 && (
                  <p className="text-xs text-neutral-700">Or select a saved simulation from the left panel.</p>
                )}
              </div>
            </div>
          )}
          {loadingCurve && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-500">
              Loading simulation data...
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
