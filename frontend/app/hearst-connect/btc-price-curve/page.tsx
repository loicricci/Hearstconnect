'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { btcPriceCurveApi } from '@/lib/api';
import { formatUSD, exportAsJSON } from '@/lib/utils';

const DEFAULT_ANCHORS: Record<number, number> = {
  0: 97000, 1: 120000, 2: 150000, 3: 180000, 4: 200000,
  5: 220000, 6: 250000, 7: 280000, 8: 300000, 9: 320000, 10: 350000,
};

export default function BTCPriceCurvePage() {
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
      const curves = await btcPriceCurveApi.list() as any[];
      setSavedCurves(curves);
      return curves;
    } catch {
      return [];
    }
  }, []);

  // Fetch existing curves to determine next increment number
  useEffect(() => {
    fetchSavedCurves().then((curves) => {
      // Find the highest existing number from names like "BTC Curve #N"
      let maxNum = 0;
      curves.forEach((c: any) => {
        const match = c.name?.match(/^BTC Curve #(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });
      // Also account for total count in case names were manually changed
      const next = Math.max(maxNum + 1, curves.length + 1);
      nextNumber.current = next;
      setName(`BTC Curve #${next}`);
    }).catch(() => {
      setName('BTC Curve #1');
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
      const curve = await btcPriceCurveApi.get(id);
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
      await btcPriceCurveApi.delete(id);
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
  const [mode, setMode] = useState<'deterministic' | 'ml_forecast'>('deterministic');

  // ── Live BTC price state ──
  const [liveBtcPrice, setLiveBtcPrice] = useState<number | null>(null);
  const [btcPriceLoading, setBtcPriceLoading] = useState(false);
  const [btcPriceUpdatedAt, setBtcPriceUpdatedAt] = useState<Date | null>(null);

  const fetchLiveBtcPrice = useCallback(async (setAsDefault = false) => {
    setBtcPriceLoading(true);
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!res.ok) throw new Error('Failed to fetch BTC price');
      const data = await res.json();
      const price = Math.round(data.bitcoin.usd);
      setLiveBtcPrice(price);
      setBtcPriceUpdatedAt(new Date());
      if (setAsDefault) setStartPrice(price);
    } catch {
      // Silently fail — keep the manual default
    }
    setBtcPriceLoading(false);
  }, []);

  // Fetch live BTC price on mount and set as default start price
  useEffect(() => { fetchLiveBtcPrice(true); }, [fetchLiveBtcPrice]);

  // ── Deterministic mode state ──
  const [startPrice, setStartPrice] = useState(97000);
  const [interpolation, setInterpolation] = useState('linear');
  const [volatilityEnabled, setVolatilityEnabled] = useState(false);
  const [volatilitySeed, setVolatilitySeed] = useState(42);
  const [confidenceBandPct, setConfidenceBandPct] = useState(20);
  const [anchors, setAnchors] = useState<Record<number, number>>({ ...DEFAULT_ANCHORS });
  const [linkYear0ToStart, setLinkYear0ToStart] = useState(true);

  // ── ML mode state ──
  const [modelType, setModelType] = useState('auto_arima');
  const [confidenceInterval, setConfidenceInterval] = useState(0.95);

  // ── Result state ──
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (linkYear0ToStart) {
      setAnchors(prev => ({ ...prev, 0: startPrice }));
    }
  }, [startPrice, linkYear0ToStart]);

  const updateAnchor = useCallback((year: number, value: number) => {
    setAnchors(prev => ({ ...prev, [year]: value }));
  }, []);

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
        mode,
      };

      if (mode === 'ml_forecast') {
        payload.model_type = modelType;
        payload.confidence_interval = confidenceInterval;
      } else {
        payload.start_price = startPrice;
        payload.anchor_points = anchors;
        payload.interpolation_type = interpolation;
        payload.volatility_enabled = volatilityEnabled;
        payload.volatility_seed = volatilitySeed;
        payload.confidence_band_pct = confidenceBandPct;
      }

      const res = await btcPriceCurveApi.generate(payload);
      setResult(res);
      setSelectedCurveId(res.id || '');

      // Auto-increment name for the next run
      nextNumber.current += 1;
      setName(`BTC Curve #${nextNumber.current}`);

      // Refresh saved curves list
      fetchSavedCurves();
    } catch (e: any) {
      setError(e.message);
    }
    setRunning(false);
  };

  // ── Chart data ──
  const isML = result?.mode === 'ml_forecast';
  const hasBands = result?.upper_bound && result?.lower_bound;
  const chartData = result?.monthly_prices?.map((price: number, i: number) => {
    const point: any = {
      month: i,
      year: Math.floor(i / 12),
      label: `Y${Math.floor(i / 12)}M${i % 12}`,
      price,
    };
    if (hasBands) {
      point.confidence = [result.lower_bound[i], result.upper_bound[i]];
      point.upper = result.upper_bound[i];
      point.lower = result.lower_bound[i];
    }
    return point;
  }) || [];

  // ── Table data ──
  const tableRows = [];
  if (result?.monthly_prices) {
    for (let y = 0; y < 10; y++) {
      const row: Record<string, any> = { year: y };
      for (let m = 0; m < 12; m++) {
        const idx = y * 12 + m;
        row[`m${m}`] = idx < result.monthly_prices.length ? formatUSD(result.monthly_prices[idx]) : '-';
      }
      tableRows.push(row);
    }
  }

  const monthCols = Array.from({ length: 12 }, (_, i) => ({
    key: `m${i}`,
    label: `M${i + 1}`,
  }));

  return (
    <PageShell
      title="BTC Price Curve"
      subtitle="10-year monthly price path simulation (120 months)"
      runId={result?.id}
      lastRunAt={result?.created_at}
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
                      <div className="text-neutral-500">Start</div>
                      <div className="text-neutral-300">{formatUSD(result.monthly_prices?.[0] ?? 0)}</div>
                      <div className="text-neutral-500">End</div>
                      <div className="text-neutral-300">{formatUSD(result.monthly_prices?.[result.monthly_prices.length - 1] ?? 0)}</div>
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
                Trains a time-series model on historical BTC prices and forecasts forward with confidence intervals.
              </p>
            )}
          </div>

          {/* Common Settings */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Curve Settings</h3>
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
          </div>

          {/* Deterministic Inputs */}
          {mode === 'deterministic' && (
            <>
              <div className="border border-hearst-border rounded p-4 space-y-3">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Deterministic Settings</h3>
                {/* Start Price with live BTC price fetch */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-neutral-400">Start Price (USD)</label>
                    <div className="flex items-center gap-2">
                      {liveBtcPrice !== null && (
                        <button
                          onClick={() => setStartPrice(liveBtcPrice)}
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
                    value={startPrice}
                    onChange={e => setStartPrice(Number(e.target.value))}
                    min={0}
                    step={1000}
                    className="w-full"
                  />
                  {btcPriceUpdatedAt && (
                    <p className="text-[10px] text-neutral-600 flex items-center gap-1 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-hearst-accent animate-pulse" />
                      Live {btcPriceUpdatedAt.toLocaleTimeString()}
                    </p>
                  )}
                </div>
                <SelectField
                  label="Interpolation"
                  value={interpolation}
                  onChange={setInterpolation}
                  options={[
                    { value: 'linear', label: 'Linear' },
                    { value: 'step', label: 'Step' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={volatilityEnabled}
                    onChange={e => setVolatilityEnabled(e.target.checked)}
                    className="rounded bg-hearst-border border-hearst-border-light"
                  />
                  <label className="text-xs text-neutral-400">Volatility Overlay</label>
                </div>
                {volatilityEnabled && (
                  <InputField label="Volatility Seed" value={volatilitySeed} onChange={v => setVolatilitySeed(Number(v))} type="number" />
                )}
                <InputField
                  label="Confidence Band (±%)"
                  value={confidenceBandPct}
                  onChange={v => setConfidenceBandPct(Number(v))}
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  hint="Bear/Bull envelope around the base curve (0 = off)"
                />
              </div>

              <div className="border border-hearst-border rounded p-4 space-y-3">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Yearly Anchors</h3>
                <div className="space-y-2 max-h-[300px] overflow-auto">
                  {Array.from({ length: 11 }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500 w-12">Year {i}</span>
                      {i === 0 ? (
                        <>
                          <input
                            type="number"
                            value={anchors[0] || 0}
                            onChange={e => updateAnchor(0, Number(e.target.value))}
                            className={`flex-1 ${linkYear0ToStart ? 'opacity-50 cursor-not-allowed' : ''}`}
                            step={1000}
                            disabled={linkYear0ToStart}
                          />
                          <label className="flex items-center gap-1.5 cursor-pointer shrink-0" title="Sync Year 0 with Start Price">
                            <input
                              type="checkbox"
                              checked={linkYear0ToStart}
                              onChange={e => setLinkYear0ToStart(e.target.checked)}
                              className="rounded bg-hearst-border border-hearst-border-light"
                            />
                            <span className="text-[10px] text-neutral-500">= Start</span>
                          </label>
                        </>
                      ) : (
                        <input
                          type="number"
                          value={anchors[i] || 0}
                          onChange={e => updateAnchor(i, Number(e.target.value))}
                          className="flex-1"
                          step={1000}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
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
                <p><strong>Auto ARIMA:</strong> Automatically finds optimal ARIMA order with seasonality.</p>
                <p><strong>Holt-Winters:</strong> Exponential smoothing with additive trend + seasonal.</p>
                <p><strong>SARIMAX:</strong> Seasonal ARIMA(1,1,1)(1,1,1,12) — tuned for monthly data.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-8 space-y-4">
          {result && (
            <>
              {/* Metrics */}
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Start Price" value={formatUSD(result.monthly_prices[0])} />
                <MetricCard label="End Price" value={formatUSD(result.monthly_prices[result.monthly_prices.length - 1])} />
                <MetricCard
                  label="Max Price"
                  value={formatUSD(Math.max(...result.monthly_prices))}
                />
                <MetricCard
                  label="Min Price"
                  value={formatUSD(Math.min(...result.monthly_prices))}
                />
              </div>

              {/* Model Info (ML only) */}
              {isML && result.model_info && (
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard
                    label="Model"
                    value={result.model_info.model?.replace(/_/g, ' ').toUpperCase() || modelType}
                  />
                  <MetricCard
                    label="Training Data"
                    value={`${result.model_info.training_months} months`}
                    sub={`${result.model_info.training_start} → ${result.model_info.training_end}`}
                  />
                  <MetricCard
                    label="AIC"
                    value={result.model_info.aic?.toFixed(1) || 'N/A'}
                    sub={result.model_info.order ? `Order: (${result.model_info.order.join(',')})` : ''}
                  />
                </div>
              )}

              {/* Chart */}
              <div className="border border-hearst-border rounded p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase">
                    Monthly Price {isML ? 'Forecast' : 'Chart'}
                    {hasBands && (
                      <span className="ml-2 text-hearst-accent font-normal">
                        ({isML ? `${(confidenceInterval * 100).toFixed(0)}% CI` : `±${confidenceBandPct}%`})
                      </span>
                    )}
                  </h3>
                  <button
                    className="btn-secondary text-[10px]"
                    onClick={() => exportAsJSON(result.monthly_prices, `btc-price-curve-${result.id}.json`)}
                  >
                    Export JSON
                  </button>
                </div>
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: '#737373' }}
                      tickFormatter={v => `Y${Math.floor(v / 12)}`}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#737373' }}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: any, name: string) => {
                        if ((name === 'Confidence Band' || name === 'Bear / Bull Band') && Array.isArray(v)) {
                          return [`${formatUSD(v[0])} — ${formatUSD(v[1])}`, isML ? 'CI Range' : 'Bear / Bull'];
                        }
                        if (name === 'BTC Price' || name === 'Forecast') {
                          return [formatUSD(v as number), name];
                        }
                        return [v, name];
                      }}
                      labelFormatter={v => `Month ${v} (Y${Math.floor(Number(v) / 12)} M${Number(v) % 12})`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {/* Confidence / bear-bull band */}
                    {hasBands && (
                      <Area
                        type="monotone"
                        dataKey="confidence"
                        fill={isML ? '#4FC043' : '#96EA7A'}
                        fillOpacity={0.12}
                        stroke={isML ? '#4FC04340' : '#96EA7A40'}
                        strokeWidth={0.5}
                        name={isML ? 'Confidence Band' : 'Bear / Bull Band'}
                      />
                    )}
                    {/* Forecast / price line */}
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke={isML ? '#4FC043' : '#96EA7A'}
                      strokeWidth={2}
                      dot={false}
                      name={isML ? 'Forecast' : 'BTC Price'}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <DataTable
                title="Monthly Prices (Year x Month)"
                columns={[{ key: 'year', label: 'Year' }, ...monthCols]}
                rows={tableRows}
                exportName={`btc-price-table-${result.id}`}
                maxHeight="300px"
              />
            </>
          )}

          {!result && !running && !loadingCurve && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              <div className="text-center space-y-1">
                <p>{mode === 'ml_forecast'
                  ? 'Select a model and click "Run Simulation" to generate an ML-powered BTC price forecast.'
                  : 'Configure inputs and click "Run Simulation" to generate a BTC price curve.'}</p>
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
