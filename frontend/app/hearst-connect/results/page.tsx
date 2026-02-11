'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area, BarChart, Bar, ComposedChart,
} from 'recharts';
import PageShell from '@/components/PageShell';
import SelectField from '@/components/SelectField';
import MetricCard from '@/components/MetricCard';
import DataTable from '@/components/DataTable';
import { productConfigApi } from '@/lib/api';
import { formatUSD, formatPercent, formatNumber, formatBTC, exportAsJSON, exportAsCSV } from '@/lib/utils';

const SCENARIO_COLORS = {
  bear: '#ef4444',
  base: '#94a3b8',
  bull: '#22c55e',
};

const SCENARIO_LABELS: Record<string, string> = {
  bear: 'Bear',
  base: 'Base',
  bull: 'Bull',
};

type ViewTab = 'overview' | 'yield' | 'holding' | 'mining' | 'waterfall';

export default function ResultsPage() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get('run');

  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(runIdParam || '');
  const [runData, setRunData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('overview');
  const [waterfallScenario, setWaterfallScenario] = useState<string>('base');

  useEffect(() => { loadRuns(); }, []);

  useEffect(() => {
    if (selectedRunId) loadRunData(selectedRunId);
  }, [selectedRunId]);

  const loadRuns = async () => {
    try {
      const data: any = await productConfigApi.listRuns();
      setRuns(data);
      if (!selectedRunId && data.length > 0) {
        setSelectedRunId(data[0].id);
      }
    } catch (e) { /* API not available */ }
  };

  const loadRunData = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const data: any = await productConfigApi.getRun(id);
      setRunData(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const scenarios = runData?.scenario_results ? Object.keys(runData.scenario_results) : [];
  const hasData = runData && scenarios.length > 0;

  // Build scenario comparison chart data
  const portfolioChartData = React.useMemo(() => {
    if (!hasData) return [];
    const baseScenario = runData.scenario_results['base'] || runData.scenario_results[scenarios[0]];
    const months = baseScenario?.aggregated?.monthly_portfolio?.length || 0;

    return Array.from({ length: months }, (_, t) => {
      const row: any = { month: t };
      for (const s of scenarios) {
        const portfolio = runData.scenario_results[s]?.aggregated?.monthly_portfolio;
        row[`${s}_total`] = portfolio?.[t]?.total_portfolio_usd || 0;
        row[`${s}_yield`] = portfolio?.[t]?.yield_value_usd || 0;
        row[`${s}_holding`] = portfolio?.[t]?.holding_value_usd || 0;
        row[`${s}_mining`] = portfolio?.[t]?.mining_value_usd || 0;
      }
      return row;
    });
  }, [runData, hasData, scenarios]);

  const decisionColor = (d: string) => {
    if (d === 'APPROVED') return 'green';
    if (d === 'ADJUST') return 'yellow';
    return 'red';
  };

  const VIEW_TABS: { key: ViewTab; label: string }[] = [
    { key: 'overview', label: 'Portfolio Overview' },
    { key: 'yield', label: 'Yield Liquidity' },
    { key: 'holding', label: 'BTC Holding' },
    { key: 'mining', label: 'BTC Mining' },
    { key: 'waterfall', label: 'Waterfall Detail' },
  ];

  return (
    <PageShell
      title="Results"
      subtitle="Multi-scenario product performance comparison"
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      {/* Run Selector */}
      <div className="mb-6 flex items-center gap-4">
        <div className="w-80">
          <SelectField
            label="Select Run"
            value={selectedRunId}
            onChange={setSelectedRunId}
            options={runs.map((r: any) => ({
              value: r.id,
              label: `${r.id.slice(0, 8)}... — ${r.capital_raised_usd ? formatUSD(r.capital_raised_usd) : ''} — ${new Date(r.created_at).toLocaleDateString()}`,
            }))}
          />
        </div>
        {hasData && (
          <div className="flex gap-2 mt-5">
            <button
              className="btn-secondary text-[10px]"
              onClick={() => exportAsJSON(runData, `product-results-${selectedRunId.slice(0, 8)}.json`)}
            >
              Export JSON
            </button>
            <button
              className="btn-secondary text-[10px]"
              onClick={() => {
                const rows = portfolioChartData.map((r: any) => ({
                  month: r.month,
                  bear_total: r.bear_total,
                  base_total: r.base_total,
                  bull_total: r.bull_total,
                }));
                exportAsCSV(rows, `portfolio-comparison-${selectedRunId.slice(0, 8)}.csv`);
              }}
            >
              Export CSV
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64 text-sm text-neutral-500">Loading results...</div>
      )}

      {!loading && !hasData && (
        <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
          No results yet. Run a simulation from the Product Config page.
        </div>
      )}

      {hasData && (
        <div className="space-y-6">
          {/* ═══════════ Decision Banners ═══════════ */}
          <div className="grid grid-cols-3 gap-4">
            {scenarios.map(s => {
              const agg = runData.scenario_results[s]?.aggregated;
              const decision = agg?.decision || 'PENDING';
              const reasons = agg?.decision_reasons || [];
              const color = decisionColor(decision);
              return (
                <div key={s} className={`rounded-xl border px-4 py-3 ${
                  color === 'green' ? 'border-green-600/50 bg-green-900/10' :
                  color === 'yellow' ? 'border-yellow-600/50 bg-yellow-900/10' :
                  'border-red-600/50 bg-red-900/10'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                      {SCENARIO_LABELS[s] || s}
                    </span>
                    <span className={`text-xs font-bold ${
                      decision === 'APPROVED' ? 'text-green-400' :
                      decision === 'ADJUST' ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {decision}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {reasons.map((r: string, i: number) => <div key={i}>{r}</div>)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ═══════════ Key Metrics Comparison ═══════════ */}
          <div className="border border-hearst-border rounded overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {scenarios.map(s => (
                    <th key={s} style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                      {SCENARIO_LABELS[s] || s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-neutral-400">Final Portfolio Value</td>
                  {scenarios.map(s => (
                    <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.aggregated?.metrics?.final_portfolio_usd || 0)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="font-medium text-neutral-400">Total Return</td>
                  {scenarios.map(s => {
                    const pct = runData.scenario_results[s]?.aggregated?.metrics?.total_return_pct || 0;
                    return <td key={s} className={`font-mono ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercent(pct)}</td>;
                  })}
                </tr>
                <tr>
                  <td className="font-medium text-neutral-400">Capital Preservation</td>
                  {scenarios.map(s => {
                    const ratio = runData.scenario_results[s]?.aggregated?.metrics?.capital_preservation_ratio || 0;
                    return <td key={s} className={`font-mono ${ratio >= 1 ? 'text-green-400' : 'text-red-400'}`}>{formatNumber(ratio, 2)}x</td>;
                  })}
                </tr>
                <tr>
                  <td className="font-medium text-neutral-400">Effective APR</td>
                  {scenarios.map(s => (
                    <td key={s} className="font-mono">{formatPercent(runData.scenario_results[s]?.aggregated?.metrics?.effective_apr || 0)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="font-medium text-neutral-400">Total Yield Paid</td>
                  {scenarios.map(s => (
                    <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.aggregated?.metrics?.total_yield_paid_usd || 0)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* ═══════════ View Tabs ═══════════ */}
          <div className="flex gap-1 border-b border-hearst-border">
            {VIEW_TABS.map(tab => (
              <button
                key={tab.key}
                className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  viewTab === tab.key
                    ? 'border-hearst-accent text-hearst-accent'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
                onClick={() => setViewTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ═══════════ OVERVIEW TAB ═══════════ */}
          {viewTab === 'overview' && (
            <div className="space-y-4">
              {/* Scenario Comparison Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Portfolio Value Comparison</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={portfolioChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: number) => formatUSD(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {scenarios.map(s => (
                      <Line
                        key={s}
                        type="monotone"
                        dataKey={`${s}_total`}
                        stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}
                        strokeWidth={s === 'base' ? 2 : 1.5}
                        strokeDasharray={s === 'base' ? undefined : '5 3'}
                        dot={false}
                        name={`${SCENARIO_LABELS[s]} Total`}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Stacked Bucket Breakdown (base scenario) */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Bucket Breakdown (Base Scenario)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={portfolioChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: number) => formatUSD(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="base_yield" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Yield Liquidity" />
                    <Area type="monotone" dataKey="base_holding" stackId="1" stroke="#4ade80" fill="#4ade80" fillOpacity={0.3} name="BTC Holding" />
                    <Area type="monotone" dataKey="base_mining" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="BTC Mining" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ═══════════ YIELD BUCKET TAB ═══════════ */}
          {viewTab === 'yield' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {scenarios.map(s => {
                  const yb = runData.scenario_results[s]?.yield_bucket?.metrics;
                  return (
                    <div key={s} className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                        {SCENARIO_LABELS[s]}
                      </h4>
                      <MetricCard label="Final Value" value={formatUSD(yb?.final_value_usd || 0)} status="green" />
                      <MetricCard label="Total Yield" value={formatUSD(yb?.total_yield_usd || 0)} />
                      <MetricCard label="Effective APR" value={formatPercent(yb?.effective_apr || 0)} />
                    </div>
                  );
                })}
              </div>

              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Cumulative Yield (All Scenarios)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={(() => {
                    const baseYield = runData.scenario_results[scenarios[0]]?.yield_bucket?.monthly_data || [];
                    return baseYield.map((_: any, t: number) => {
                      const row: any = { month: t };
                      for (const s of scenarios) {
                        row[s] = runData.scenario_results[s]?.yield_bucket?.monthly_data?.[t]?.cumulative_yield_usd || 0;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {scenarios.map(s => (
                      <Line key={s} type="monotone" dataKey={s} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={1.5} dot={false} name={SCENARIO_LABELS[s]} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ═══════════ BTC HOLDING TAB ═══════════ */}
          {viewTab === 'holding' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {scenarios.map(s => {
                  const hb = runData.scenario_results[s]?.btc_holding_bucket?.metrics;
                  return (
                    <div key={s} className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                        {SCENARIO_LABELS[s]}
                      </h4>
                      <MetricCard label="Final Value" value={formatUSD(hb?.final_value_usd || 0)} status={hb?.total_return_pct >= 0 ? 'green' : 'red'} />
                      <MetricCard label="Total Return" value={formatPercent(hb?.total_return_pct || 0)} status={hb?.total_return_pct >= 0 ? 'green' : 'red'} />
                      <MetricCard
                        label="Target Hit"
                        value={hb?.target_hit ? `Yes (Month ${hb.sell_month})` : 'No'}
                        status={hb?.target_hit ? 'green' : 'neutral'}
                      />
                      <MetricCard label="BTC Qty" value={formatNumber(hb?.btc_quantity || 0, 4)} />
                    </div>
                  );
                })}
              </div>

              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">BTC Holding Value Over Time</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={(() => {
                    const baseHolding = runData.scenario_results[scenarios[0]]?.btc_holding_bucket?.monthly_data || [];
                    return baseHolding.map((_: any, t: number) => {
                      const row: any = { month: t };
                      for (const s of scenarios) {
                        row[s] = runData.scenario_results[s]?.btc_holding_bucket?.monthly_data?.[t]?.bucket_value_usd || 0;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {scenarios.map(s => (
                      <Line key={s} type="monotone" dataKey={s} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={1.5} dot={false} name={SCENARIO_LABELS[s]} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ═══════════ BTC MINING TAB ═══════════ */}
          {viewTab === 'mining' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {scenarios.map(s => {
                  const mb = runData.scenario_results[s]?.mining_bucket?.metrics;
                  const holdingHit = runData.scenario_results[s]?.btc_holding_bucket?.metrics?.target_hit;
                  return (
                    <div key={s} className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                        {SCENARIO_LABELS[s]}
                      </h4>
                      <MetricCard label="Health Score" value={`${mb?.final_health_score || 0}/100`} status={mb?.final_health_score >= 60 ? 'green' : mb?.final_health_score >= 40 ? 'yellow' : 'red'} />
                      <MetricCard label="Effective APR" value={formatPercent(mb?.effective_apr || 0)} />
                      <MetricCard label="OPEX Coverage" value={`${formatNumber(mb?.avg_opex_coverage_ratio || 0, 2)}x`} status={(mb?.avg_opex_coverage_ratio || 0) >= 1.5 ? 'green' : (mb?.avg_opex_coverage_ratio || 0) >= 1.0 ? 'yellow' : 'red'} />
                      <MetricCard label="Capitalization" value={formatUSD(mb?.capitalization_usd_final || 0)} status={(mb?.capitalization_usd_final || 0) > 0 ? 'green' : 'neutral'} />
                      <MetricCard label="Yield Cap Bump" value={holdingHit ? 'Active (12%)' : 'Base (8%)'} status={holdingHit ? 'green' : 'neutral'} />
                      <MetricCard label="Deficit Months" value={`${mb?.red_flag_months || 0}`} status={(mb?.red_flag_months || 0) === 0 ? 'green' : 'red'} />
                    </div>
                  );
                })}
              </div>

              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Mining Health Score Over Time</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={(() => {
                    const baseWaterfall = runData.scenario_results[scenarios[0]]?.mining_bucket?.monthly_waterfall || [];
                    return baseWaterfall.map((_: any, t: number) => {
                      const row: any = { month: t };
                      for (const s of scenarios) {
                        row[s] = runData.scenario_results[s]?.mining_bucket?.monthly_waterfall?.[t]?.health_score || 0;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#737373' }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {scenarios.map(s => (
                      <Line key={s} type="monotone" dataKey={s} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={1.5} dot={false} name={SCENARIO_LABELS[s]} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly Yield Comparison */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly Mining Yield (USD)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={(() => {
                    const baseWaterfall = runData.scenario_results[scenarios[0]]?.mining_bucket?.monthly_waterfall || [];
                    return baseWaterfall.map((_: any, t: number) => {
                      const row: any = { month: t };
                      for (const s of scenarios) {
                        row[s] = runData.scenario_results[s]?.mining_bucket?.monthly_waterfall?.[t]?.yield_paid_usd || 0;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {scenarios.map(s => (
                      <Bar key={s} dataKey={s} fill={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} opacity={0.7} name={SCENARIO_LABELS[s]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ═══════════ WATERFALL DETAIL TAB ═══════════ */}
          {viewTab === 'waterfall' && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const waterfall: any[] = runData.scenario_results[activeScenario]?.mining_bucket?.monthly_waterfall || [];
            const miningMetrics = runData.scenario_results[activeScenario]?.mining_bucket?.metrics || {};
            const decision = runData.scenario_results[activeScenario]?.aggregated?.decision || 'PENDING';
            const reasons = runData.scenario_results[activeScenario]?.aggregated?.decision_reasons || [];
            const holdingSellMonth = runData.scenario_results[activeScenario]?.btc_holding_bucket?.metrics?.sell_month;
            const totalMonths = waterfall.length;
            const redMonths = waterfall.filter((m: any) => m.flag === 'RED').length;
            const greenMonths = totalMonths - redMonths;

            // Build chart data for BTC allocation stacked bar
            const btcAllocationData = waterfall.map((m: any) => ({
              month: m.month,
              'OPEX': m.btc_sell_opex,
              'Yield': m.btc_for_yield || 0,
              'Capitalization': m.btc_to_capitalization || 0,
              'Total Produced': m.btc_produced,
            }));

            // Build chart data for capitalization over time
            const capitalizationData = waterfall.map((m: any) => ({
              month: m.month,
              'Capitalization (USD)': m.capitalization_usd || 0,
              'Capitalization (BTC)': m.capitalization_btc || 0,
            }));

            // Build chart data for health & coverage
            const healthData = waterfall.map((m: any) => ({
              month: m.month,
              'Health Score': m.health_score,
              'OPEX Coverage': Math.min((m.opex_coverage_ratio || 0) * 100, 300),
              'Yield Fulfillment': Math.min((m.yield_fulfillment || 0) * 100, 200),
            }));

            return (
              <div className="space-y-5">
                {/* Scenario Picker + Summary */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex gap-1">
                    {scenarios.map(s => (
                      <button
                        key={s}
                        onClick={() => setWaterfallScenario(s)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors uppercase ${
                          activeScenario === s
                            ? 'bg-hearst-border text-white'
                            : 'bg-hearst-card text-neutral-500 hover:text-neutral-300'
                        }`}
                        style={activeScenario === s ? { borderBottom: `2px solid ${SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}` } : undefined}
                      >
                        {SCENARIO_LABELS[s] || s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`font-bold ${decision === 'APPROVED' ? 'text-green-400' : decision === 'ADJUST' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {decision}
                    </span>
                    <span className="text-neutral-500">|</span>
                    <span className="text-neutral-400">
                      <span className="text-red-400 font-semibold">{redMonths}</span> deficit / <span className="text-green-400 font-semibold">{greenMonths}</span> healthy out of {totalMonths} months
                    </span>
                    <span className="text-neutral-500">|</span>
                    <span className="text-neutral-500">{reasons.join('; ')}</span>
                    {holdingSellMonth != null && (
                      <>
                        <span className="text-neutral-500">|</span>
                        <span className="text-hearst-accent">Yield cap bumped to 12% at month {holdingSellMonth}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Waterfall Logic Explainer ── */}
                <div className="border border-hearst-border rounded p-4 bg-hearst-surface">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-2">How the Monthly Waterfall Works</h3>
                  <div className="text-[11px] text-neutral-500 space-y-1 leading-relaxed">
                    <p>Each month, BTC is produced by the mining fleet and allocated in strict priority order:</p>
                    <ol className="list-decimal list-inside space-y-0.5 pl-2">
                      <li><span className="text-orange-400 font-medium">OPEX</span> — Sell BTC to cover electricity, hosting, and maintenance costs</li>
                      <li><span className="text-green-400 font-medium">Yield</span> — Distribute surplus as yield, capped at <span className="text-white">8% APR</span> (base) or <span className="text-white">12% APR</span> (once BTC holding target is hit)</li>
                      <li><span className="text-cyan-400 font-medium">Capitalization</span> — Remaining BTC builds the capitalization / upside bucket</li>
                    </ol>
                    <p className="mt-2">
                      A month is <span className="text-red-400 font-medium">DEFICIT (RED)</span> if BTC produced {'<'} 95% of OPEX requirements.
                      If {'>'} 20% of months are deficit, the product is <span className="text-red-400 font-medium">BLOCKED</span>.
                    </p>
                    <p>
                      <span className="text-hearst-accent font-medium">Capital reconstitution</span> is handled by the BTC Holding bucket when the target price is hit, not by mining.
                    </p>
                  </div>
                </div>

                {/* ── BTC Allocation Stacked Bar ── */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly BTC Allocation Breakdown</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={btcAllocationData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => v.toFixed(4)} label={{ value: 'BTC', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#737373' } }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                        formatter={(v: number, name: string) => [formatBTC(v), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="OPEX" stackId="alloc" fill="#f97316" opacity={0.8} name="OPEX" />
                      <Bar dataKey="Yield" stackId="alloc" fill="#22c55e" opacity={0.8} name="Yield Distributed" />
                      <Bar dataKey="Capitalization" stackId="alloc" fill="#06b6d4" opacity={0.8} name="Capitalization" />
                      <Line type="monotone" dataKey="Total Produced" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="BTC Produced" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-600 mt-1">White dashed line = total BTC produced. Stacked bars = how it was allocated. When bars fall short of the line, the month is in deficit.</p>
                </div>

                {/* ── Capitalization Over Time ── */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Capitalization Bucket Value</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={capitalizationData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis yAxisId="usd" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <YAxis yAxisId="btc" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v.toFixed(2)} BTC`} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                        formatter={(v: number, name: string) => [name.includes('USD') ? formatUSD(v) : formatBTC(v), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area yAxisId="usd" type="monotone" dataKey="Capitalization (USD)" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={2} />
                      <Line yAxisId="btc" type="monotone" dataKey="Capitalization (BTC)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* ── Health Score & OPEX Coverage ── */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Health Score, OPEX Coverage & Yield Fulfillment</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={healthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v}`} label={{ value: '% / Score', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#737373' } }} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number, name: string) => [`${v.toFixed(1)}${name === 'Health Score' ? '/100' : '%'}`, name]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="Health Score" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="OPEX Coverage" stroke="#f97316" strokeWidth={1.5} dot={false} name="OPEX Coverage (%)" />
                      <Line type="monotone" dataKey="Yield Fulfillment" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Yield Fulfillment (%)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* ── Full Monthly Table ── */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-hearst-card border-b border-hearst-border">
                    <span className="text-xs font-medium text-neutral-400">Month-by-Month Waterfall — {SCENARIO_LABELS[activeScenario] || activeScenario}</span>
                    <div className="flex gap-2">
                      <button
                        className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                        onClick={() => exportAsCSV(waterfall, `waterfall-${activeScenario}-${selectedRunId.slice(0, 8)}.csv`)}
                      >
                        Export CSV
                      </button>
                      <button
                        className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                        onClick={() => exportAsJSON(waterfall, `waterfall-${activeScenario}-${selectedRunId.slice(0, 8)}.json`)}
                      >
                        Export JSON
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto" style={{ maxHeight: '600px' }}>
                    <table className="data-table text-[11px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-hearst-card">Mo</th>
                          <th>Flag</th>
                          <th>BTC Price</th>
                          <th title="Total BTC produced by mining fleet">BTC Produced</th>
                          <th title="BTC sold to cover OPEX (electricity + hosting + maintenance)">BTC→OPEX</th>
                          <th title="BTC sold/distributed as yield">BTC→Yield</th>
                          <th title="BTC sent to capitalization bucket">BTC→Cap</th>
                          <th title="Total operating expenses in USD">OPEX (USD)</th>
                          <th title="Yield distributed to investors this month">Yield (USD)</th>
                          <th title="Applied yield APR for this month (8% base or 12% with bonus)">APR</th>
                          <th title="Take-profit ladder sales from capitalization bucket">TP Sold</th>
                          <th title="Cumulative capitalization bucket in BTC">Cap BTC</th>
                          <th title="Capitalization bucket mark-to-market value">Cap USD</th>
                          <th title="OPEX coverage ratio: revenue / OPEX (>1 means profitable)">OPEX Cov.</th>
                          <th title="Yield fulfillment: actual / target yield (1.0 = 100% delivered)">Yield Fill</th>
                          <th title="Portfolio health score (0-100)">Health</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waterfall.map((m: any) => {
                          const isDeficit = m.flag === 'RED';
                          const isBonusApr = (m.yield_apr_applied || 0) > 0.09;
                          const rowClass = isDeficit ? 'bg-red-900/15' : '';
                          return (
                            <tr key={m.month} className={rowClass}>
                              <td className={`sticky left-0 z-10 font-semibold ${isDeficit ? 'bg-red-900/30' : 'bg-hearst-card'}`}>{m.month}</td>
                              <td>
                                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${isDeficit ? 'bg-red-500' : 'bg-green-500'}`} />
                                <span className={`font-semibold ${isDeficit ? 'text-red-400' : 'text-green-400'}`}>
                                  {m.flag}
                                </span>
                              </td>
                              <td className="font-mono">{formatUSD(m.btc_price_usd)}</td>
                              <td className="font-mono text-white">{formatBTC(m.btc_produced)}</td>
                              <td className="font-mono text-orange-400">{formatBTC(m.btc_sell_opex)}</td>
                              <td className="font-mono text-green-400">{formatBTC(m.btc_for_yield || 0)}</td>
                              <td className="font-mono text-cyan-400">{formatBTC(m.btc_to_capitalization || 0)}</td>
                              <td className="font-mono">{formatUSD(m.opex_usd)}</td>
                              <td className={`font-mono ${m.yield_paid_usd > 0 ? 'text-green-400' : 'text-neutral-600'}`}>{formatUSD(m.yield_paid_usd)}</td>
                              <td className={`font-mono ${isBonusApr ? 'text-hearst-accent font-semibold' : 'text-neutral-400'}`}>{formatPercent(m.yield_apr_applied || 0)}</td>
                              <td className="font-mono">{formatUSD(m.take_profit_sold_usd)}</td>
                              <td className="font-mono text-cyan-300">{formatBTC(m.capitalization_btc || 0)}</td>
                              <td className="font-mono">{formatUSD(m.capitalization_usd || 0)}</td>
                              <td className={`font-mono ${(m.opex_coverage_ratio || 0) >= 1.5 ? 'text-green-400' : (m.opex_coverage_ratio || 0) >= 1.0 ? 'text-yellow-400' : 'text-red-400'}`}>{formatNumber(m.opex_coverage_ratio || 0, 2)}x</td>
                              <td className={`font-mono ${(m.yield_fulfillment || 0) >= 1.0 ? 'text-green-400' : (m.yield_fulfillment || 0) >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>{formatPercent(m.yield_fulfillment || 0)}</td>
                              <td className={`font-mono font-semibold ${m.health_score >= 60 ? 'text-green-400' : m.health_score >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>{formatNumber(m.health_score, 1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-hearst-card border-t border-hearst-border text-[10px] text-neutral-600">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" /> RED = Deficit month (BTC produced {'<'} 95% of OPEX) &nbsp;
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 align-middle" /> GREEN = OPEX covered, yield + capitalization distributed &nbsp;|&nbsp;
                    Threshold: {'>'} 20% RED months → BLOCKED &nbsp;|&nbsp;
                    <span className="text-hearst-accent">Blue APR</span> = bonus yield active (BTC holding target hit)
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </PageShell>
  );
}
