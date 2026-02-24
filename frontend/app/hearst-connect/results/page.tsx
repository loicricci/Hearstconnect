'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, AreaChart, Area, BarChart, Bar, ComposedChart, ReferenceLine,
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
  bull: '#6BD85A',
};

const SCENARIO_LABELS: Record<string, string> = {
  bear: 'Bear',
  base: 'Base',
  bull: 'Bull',
};

type ViewTab = 'overview' | 'yield' | 'holding' | 'mining' | 'btc_mgmt' | 'commercial' | 'waterfall'
  | 'btc_overview' | 'btc_collateral' | 'btc_debt' | 'btc_ltv' | 'btc_strikes' | 'btc_mining';

export default function ResultsPage() {
  return (
    <Suspense fallback={<PageShell title="Results" subtitle="Loading..."><div className="flex items-center justify-center h-64 text-sm text-neutral-500">Loading...</div></PageShell>}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get('run');

  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState(runIdParam || '');
  const [runData, setRunData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewTab, setViewTab] = useState<ViewTab>('overview');
  const [waterfallScenario, setWaterfallScenario] = useState<string>('base');
  const [confirmDelete, setConfirmDelete] = useState<'single' | 'all' | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      const st = data?.input_snapshot?.scenario_type || 'buckets';
      setViewTab(st === 'bitcoin' ? 'btc_overview' : 'overview');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleDeleteRun = async () => {
    if (!selectedRunId) return;
    setDeleting(true);
    try {
      await productConfigApi.deleteRun(selectedRunId);
      setRunData(null);
      setSelectedRunId('');
      setConfirmDelete(null);
      await loadRuns();
    } catch (e: any) {
      setError(e.message);
    }
    setDeleting(false);
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await productConfigApi.deleteAllRuns();
      setRuns([]);
      setRunData(null);
      setSelectedRunId('');
      setConfirmDelete(null);
    } catch (e: any) {
      setError(e.message);
    }
    setDeleting(false);
  };

  const scenarioType: string = runData?.input_snapshot?.scenario_type || 'buckets';
  const isBitcoin = scenarioType === 'bitcoin';

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

  const BUCKET_TABS: { key: ViewTab; label: string }[] = [
    { key: 'overview', label: 'Portfolio Overview' },
    { key: 'yield', label: 'Yield Liquidity' },
    { key: 'holding', label: 'BTC Holding' },
    { key: 'mining', label: 'BTC Mining' },
    { key: 'btc_mgmt', label: 'BTC Under Management' },
    { key: 'commercial', label: 'Commercial' },
    { key: 'waterfall', label: 'Waterfall Detail' },
  ];

  const BITCOIN_TABS: { key: ViewTab; label: string }[] = [
    { key: 'btc_overview', label: 'Overview' },
    { key: 'btc_collateral', label: 'BTC Collateral' },
    { key: 'btc_debt', label: 'Stablecoin Debt' },
    { key: 'btc_ltv', label: 'LTV Monitor' },
    { key: 'btc_strikes', label: 'Strike Events' },
    { key: 'btc_mining', label: 'Mining Detail' },
  ];

  const VIEW_TABS = isBitcoin ? BITCOIN_TABS : BUCKET_TABS;

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
              label: `${r.scenario_type === 'bitcoin' ? '[BTC]' : '[Buckets]'} ${r.id.slice(0, 8)}... — ${r.capital_raised_usd ? formatUSD(r.capital_raised_usd) : ''} — ${new Date(r.created_at).toLocaleDateString()}`,
            }))}
          />
        </div>
        <div className="flex gap-2 mt-5">
          {hasData && (
            <>
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
            </>
          )}
          {selectedRunId && (
            <button
              className="px-3 py-1.5 text-[10px] font-medium rounded border border-red-700/50 bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors"
              onClick={() => setConfirmDelete('single')}
            >
              Delete Run
            </button>
          )}
          {runs.length > 0 && (
            <button
              className="px-3 py-1.5 text-[10px] font-medium rounded border border-red-700/50 bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors"
              onClick={() => setConfirmDelete('all')}
            >
              Delete All ({runs.length})
            </button>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-hearst-card border border-hearst-border rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-2">
              {confirmDelete === 'all' ? 'Delete All Simulations' : 'Delete Simulation'}
            </h3>
            <p className="text-xs text-neutral-400 mb-5">
              {confirmDelete === 'all'
                ? `This will permanently delete all ${runs.length} simulation run${runs.length !== 1 ? 's' : ''}. This action cannot be undone.`
                : `This will permanently delete run ${selectedRunId.slice(0, 8)}... This action cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary text-xs"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-xs font-medium rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                onClick={confirmDelete === 'all' ? handleDeleteAll : handleDeleteRun}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : confirmDelete === 'all' ? 'Delete All' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          {/* ═══════════ Scenario Type Badge ═══════════ */}
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold ${
            isBitcoin ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-hearst-accent/20 text-hearst-accent border border-hearst-accent/40'
          }`}>
            {isBitcoin ? 'Bitcoin Collateral Scenario' : 'Buckets (3-Bucket) Scenario'}
          </div>

          {/* ═══════════ Decision Banners (Buckets only) ═══════════ */}
          {!isBitcoin && (
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
          )}

          {/* ═══════════ Early Close Status (Buckets only) ═══════════ */}
          {!isBitcoin && (() => {
            const anyEarlyClose = scenarios.some(s => runData.scenario_results[s]?.aggregated?.early_close?.triggered);
            if (!anyEarlyClose) return null;
            return (
              <div className="border border-purple-600/40 bg-purple-900/10 rounded-xl px-5 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-wide">Early Close Detected</span>
                  <span className="text-[10px] text-neutral-500">Cumulative yield reached the target threshold before full tenor</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {scenarios.map(s => {
                    const ec = runData.scenario_results[s]?.aggregated?.early_close;
                    return (
                      <div key={s} className="text-xs">
                        <span className="font-semibold" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                          {SCENARIO_LABELS[s]}:
                        </span>{' '}
                        {ec?.triggered ? (
                          <span className="text-purple-300">
                            Closed Month {ec.close_month} (Q{ec.close_quarter}) — {formatPercent(ec.cumulative_yield_at_close_pct)} yield
                          </span>
                        ) : (
                          <span className="text-neutral-500">
                            Full term ({runData.scenario_results[s]?.aggregated?.metrics?.effective_months || '—'} mo)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ═══════════ Key Metrics Comparison (Buckets only) ═══════════ */}
          {!isBitcoin && (() => {
            // Check if commercial fees are configured
            const hasCommercial = scenarios.some(s => runData.scenario_results[s]?.commercial?.total_commercial_value_usd > 0);
            
            return (
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
                      <td className="font-medium text-neutral-400">Final Portfolio Value {hasCommercial && <span className="text-[10px] text-amber-400">(Net)</span>}</td>
                      {scenarios.map(s => (
                        <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.aggregated?.metrics?.final_portfolio_usd || 0)}</td>
                      ))}
                    </tr>
                    {hasCommercial && (
                      <tr className="bg-hearst-card/50">
                        <td className="font-medium text-neutral-500">Final Portfolio Value <span className="text-[10px]">(Gross)</span></td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono text-neutral-500">{formatUSD(runData.scenario_results[s]?.aggregated?.metrics?.gross_final_portfolio_usd || 0)}</td>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <td className="font-medium text-neutral-400">Total Return {hasCommercial && <span className="text-[10px] text-amber-400">(Net)</span>}</td>
                      {scenarios.map(s => {
                        const pct = runData.scenario_results[s]?.aggregated?.metrics?.total_return_pct || 0;
                        return <td key={s} className={`font-mono ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercent(pct)}</td>;
                      })}
                    </tr>
                    {hasCommercial && (
                      <tr className="bg-hearst-card/50">
                        <td className="font-medium text-neutral-500">Total Return <span className="text-[10px]">(Gross)</span></td>
                        {scenarios.map(s => {
                          const pct = runData.scenario_results[s]?.aggregated?.metrics?.gross_total_return_pct || 0;
                          return <td key={s} className={`font-mono text-neutral-500`}>{formatPercent(pct)}</td>;
                        })}
                      </tr>
                    )}
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
                    <tr>
                      <td className="font-medium text-neutral-400">Yield Target Progress</td>
                      {scenarios.map(s => {
                        const ec = runData.scenario_results[s]?.aggregated?.early_close;
                        const qData = runData.scenario_results[s]?.aggregated?.quarterly_yield_data || [];
                        const lastQ = qData[qData.length - 1];
                        const pct = lastQ?.cumulative_yield_pct || 0;
                        const target = ec?.target_pct || 0.36;
                        return (
                          <td key={s} className="font-mono">
                            <span className={pct >= target ? 'text-purple-400 font-semibold' : 'text-neutral-400'}>
                              {formatPercent(pct)} / {formatPercent(target)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="font-medium text-neutral-400">Effective Product Life</td>
                      {scenarios.map(s => {
                        const ec = runData.scenario_results[s]?.aggregated?.early_close;
                        const months = runData.scenario_results[s]?.aggregated?.metrics?.effective_months;
                        return (
                          <td key={s} className="font-mono">
                            {ec?.triggered ? (
                              <span className="text-purple-400">{months} mo (Q{ec.close_quarter})</span>
                            ) : (
                              <span>{months} mo</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="font-medium text-neutral-400">Quarterly Yield (Avg)</td>
                      {scenarios.map(s => {
                        const qData: any[] = runData.scenario_results[s]?.aggregated?.quarterly_yield_data || [];
                        const avg = qData.length > 0 ? qData.reduce((sum: number, q: any) => sum + q.yield_usd, 0) / qData.length : 0;
                        return (
                          <td key={s} className="font-mono">{formatUSD(avg)}</td>
                        );
                      })}
                    </tr>
                    {hasCommercial && (
                      <tr className="bg-amber-900/10">
                        <td className="font-medium text-amber-400">Commercial Fees (Total)</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono text-amber-400">{formatUSD(runData.scenario_results[s]?.commercial?.total_commercial_value_usd || 0)}</td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

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
                    {scenarios.map(s => {
                      const ecMonth = runData.scenario_results[s]?.aggregated?.early_close?.close_month;
                      return (
                        <React.Fragment key={s}>
                          <Line
                            type="monotone"
                            dataKey={`${s}_total`}
                            stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}
                            strokeWidth={s === 'base' ? 2 : 1.5}
                            strokeDasharray={s === 'base' ? undefined : '5 3'}
                            dot={false}
                            name={`${SCENARIO_LABELS[s]} Total`}
                          />
                          {ecMonth != null && (
                            <ReferenceLine
                              x={ecMonth}
                              stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}
                              strokeDasharray="3 3"
                              strokeWidth={1}
                              label={{ value: `${SCENARIO_LABELS[s]} Close`, position: 'top', fontSize: 9, fill: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
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
                    <Area type="monotone" dataKey="base_yield" stackId="1" stroke="#4FC043" fill="#4FC043" fillOpacity={0.3} name="Yield Liquidity" />
                    <Area type="monotone" dataKey="base_holding" stackId="1" stroke="#96EA7A" fill="#96EA7A" fillOpacity={0.3} name="BTC Holding" />
                    <Area type="monotone" dataKey="base_mining" stackId="1" stroke="#B8F2A3" fill="#B8F2A3" fillOpacity={0.3} name="BTC Mining" />
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
                  const ec = runData.scenario_results[s]?.aggregated?.early_close;
                  return (
                    <div key={s} className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                        {SCENARIO_LABELS[s]}
                      </h4>
                      <MetricCard label="Final Value" value={formatUSD(yb?.final_value_usd || 0)} status="green" />
                      <MetricCard label="Total Yield" value={formatUSD(yb?.total_yield_usd || 0)} />
                      <MetricCard label="Effective APR" value={formatPercent(yb?.effective_apr || 0)} />
                      {ec?.triggered && (
                        <MetricCard label="Early Close" value={`Q${ec.close_quarter} (Mo ${ec.close_month})`} status="green" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quarterly Yield Distribution (All Scenarios) */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Quarterly Yield Distribution (All Buckets)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={(() => {
                    const maxQuarters = Math.max(...scenarios.map(s =>
                      (runData.scenario_results[s]?.aggregated?.quarterly_yield_data || []).length
                    ));
                    return Array.from({ length: maxQuarters }, (_, i) => {
                      const row: any = { quarter: `Q${i + 1}` };
                      for (const s of scenarios) {
                        const qData = runData.scenario_results[s]?.aggregated?.quarterly_yield_data || [];
                        row[`${s}_yield`] = qData[i]?.yield_usd || 0;
                        row[`${s}_pct`] = (qData[i]?.cumulative_yield_pct || 0) * 100;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis yAxisId="usd" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v.toFixed(0)}%`} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                      formatter={(v: number, name: string) => [name.includes('pct') || name.includes('Progress') ? `${v.toFixed(1)}%` : formatUSD(v), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine yAxisId="pct" y={((runData.scenario_results[scenarios[0]]?.aggregated?.early_close?.target_pct || 0.36) * 100)} stroke="#a855f7" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: 'Target', position: 'right', fontSize: 9, fill: '#a855f7' }} />
                    {scenarios.map(s => (
                      <Bar key={`${s}_yield`} yAxisId="usd" dataKey={`${s}_yield`} fill={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} opacity={0.6} name={`${SCENARIO_LABELS[s]} Yield ($)`} />
                    ))}
                    {scenarios.map(s => (
                      <Line key={`${s}_pct`} yAxisId="pct" type="monotone" dataKey={`${s}_pct`} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={2} dot={{ r: 3 }} name={`${SCENARIO_LABELS[s]} Progress (%)`} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-neutral-600 mt-1">
                  Bars show quarterly yield from all buckets. Lines show cumulative progress toward the {formatPercent(runData.scenario_results[scenarios[0]]?.aggregated?.early_close?.target_pct || 0.36)} early close target.
                </p>
              </div>

              {/* Cumulative Yield (original monthly view) */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Cumulative Yield Liquidity Bucket (Monthly)</h3>
                <ResponsiveContainer width="100%" height={220}>
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
                  const holdingSellMonth = runData.scenario_results[s]?.btc_holding_bucket?.metrics?.sell_month;
                  const ec = runData.scenario_results[s]?.aggregated?.early_close;
                  const qData = runData.scenario_results[s]?.aggregated?.quarterly_yield_data || [];
                  const lastQ = qData[qData.length - 1];
                  const yieldProgress = lastQ?.cumulative_yield_pct || 0;
                  const target = ec?.target_pct || 0.36;
                  return (
                    <div key={s} className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                        {SCENARIO_LABELS[s]}
                      </h4>
                      <MetricCard label="Health Score" value={`${mb?.final_health_score || 0}/100`} status={mb?.final_health_score >= 60 ? 'green' : mb?.final_health_score >= 40 ? 'yellow' : 'red'} />
                      <MetricCard label="Effective APR" value={formatPercent(mb?.effective_apr || 0)} />
                      <MetricCard label="OPEX Coverage" value={`${formatNumber(mb?.avg_opex_coverage_ratio || 0, 2)}x`} status={(mb?.avg_opex_coverage_ratio || 0) >= 1.5 ? 'green' : (mb?.avg_opex_coverage_ratio || 0) >= 1.0 ? 'yellow' : 'red'} />
                      <MetricCard label="Capitalization" value={formatUSD(mb?.capitalization_usd_final || 0)} status={(mb?.capitalization_usd_final || 0) > 0 ? 'green' : 'neutral'} />
                      <MetricCard
                        label="Yield Cap (8% → 12%)"
                        value={holdingHit ? `Active — Mo ${holdingSellMonth}${holdingSellMonth != null ? ` (Q${Math.floor(holdingSellMonth / 3) + 1})` : ''}` : 'Base (8%)'}
                        status={holdingHit ? 'green' : 'neutral'}
                      />
                      <MetricCard
                        label="Yield Target Progress"
                        value={`${formatPercent(yieldProgress)} / ${formatPercent(target)}`}
                        status={yieldProgress >= target ? 'green' : 'neutral'}
                      />
                      <MetricCard label="Deficit Months" value={`${mb?.red_flag_months || 0}`} status={(mb?.red_flag_months || 0) === 0 ? 'green' : 'red'} />
                      {ec?.triggered && (
                        <MetricCard label="Early Close" value={`Q${ec.close_quarter} (Mo ${ec.close_month})`} status="green" />
                      )}
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

              {/* Mining Quarterly Yield */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Quarterly Mining Yield (USD)</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={(() => {
                    const maxQuarters = Math.max(...scenarios.map(s =>
                      (runData.scenario_results[s]?.mining_bucket?.quarterly_yield_summary || []).length
                    ));
                    return Array.from({ length: maxQuarters }, (_, i) => {
                      const row: any = { quarter: `Q${i + 1}` };
                      for (const s of scenarios) {
                        const qYield = runData.scenario_results[s]?.mining_bucket?.quarterly_yield_summary || [];
                        row[s] = qYield[i]?.yield_usd || 0;
                      }
                      return row;
                    });
                  })()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: '#737373' }} />
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

          {/* ═══════════ BTC UNDER MANAGEMENT TAB ═══════════ */}
          {viewTab === 'btc_mgmt' && (() => {
            // BTC Under Management: All BTC held (holding bucket + mining capitalization)
            // Shows how BTC value appreciates over time and when it gets sold
            
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const btcMgmt: any[] = runData.scenario_results[activeScenario]?.aggregated?.btc_under_management || [];
            const btcMgmtMetrics = runData.scenario_results[activeScenario]?.aggregated?.btc_under_management_metrics || {};
            const holdingMetrics = runData.scenario_results[activeScenario]?.btc_holding_bucket?.metrics || {};
            
            // Find the strike month if any
            const strikeMonth = btcMgmtMetrics.holding_strike_month;
            
            // Build chart data for BTC quantity over time
            const btcQtyChartData = btcMgmt.map((m: any) => ({
              month: m.month,
              'Holding BTC': m.holding_btc,
              'Mining Cap BTC': m.mining_cap_btc,
              'Total BTC': m.total_btc,
              'Strike Event': m.holding_strike_this_month ? m.total_btc : null,
            }));
            
            // Build chart data for USD value over time
            const btcValueChartData = btcMgmt.map((m: any) => ({
              month: m.month,
              'Holding Value': m.holding_value_usd,
              'Mining Cap Value': m.mining_cap_value_usd,
              'Total Value': m.total_value_usd,
              'BTC Price': m.btc_price_usd,
            }));
            
            // Build appreciation chart data
            const appreciationChartData = btcMgmt.map((m: any) => ({
              month: m.month,
              'Appreciation ($)': m.holding_appreciation_usd,
              'Appreciation (%)': m.holding_appreciation_pct,
            }));

            return (
              <div className="space-y-5">
                {/* Scenario Picker */}
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
                  <div className="text-xs text-neutral-500">
                    BTC held across all buckets appreciates in $ value as BTC price increases
                  </div>
                </div>

                {/* Explainer Box */}
                <div className="border border-hearst-border rounded p-4 bg-hearst-surface">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-2">How BTC Under Management Works</h3>
                  <div className="text-[11px] text-neutral-500 space-y-1 leading-relaxed">
                    <p>This view tracks all BTC held across the product, showing how its $ value appreciates over time:</p>
                    <ol className="list-decimal list-inside space-y-0.5 pl-2">
                      <li><span className="text-cyan-400 font-medium">BTC Holding Bucket</span> — BTC purchased for capital reconstitution (held until target price is struck)</li>
                      <li><span className="text-amber-400 font-medium">Mining Capitalization</span> — Surplus BTC accumulated from mining after OPEX and yield</li>
                    </ol>
                    <p className="mt-2">
                      When the target price is <span className="text-green-400 font-medium">struck</span>, BTC from the Holding bucket is sold for capital reconstitution.
                      The remaining BTC (mining capitalization) continues to appreciate.
                    </p>
                  </div>
                </div>

                {/* Key Metrics Summary */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="border border-cyan-500/30 rounded p-4 bg-cyan-950/10">
                    <div className="text-[10px] text-neutral-500 uppercase mb-1">Total BTC Under Management</div>
                    <div className="text-lg font-bold text-white">{formatBTC(btcMgmtMetrics.final_total_btc || 0)}</div>
                    <div className="text-xs text-neutral-400">{formatUSD(btcMgmtMetrics.final_total_value_usd || 0)}</div>
                  </div>
                  <div className="border border-cyan-500/30 rounded p-4 bg-cyan-950/10">
                    <div className="text-[10px] text-neutral-500 uppercase mb-1">Peak BTC Value</div>
                    <div className="text-lg font-bold text-green-400">{formatUSD(btcMgmtMetrics.peak_btc_value_usd || 0)}</div>
                    <div className="text-xs text-neutral-400">{formatBTC(btcMgmtMetrics.peak_btc_qty || 0)} BTC</div>
                  </div>
                  <div className="border border-cyan-500/30 rounded p-4 bg-cyan-950/10">
                    <div className="text-[10px] text-neutral-500 uppercase mb-1">Holding Target</div>
                    {btcMgmtMetrics.holding_target_struck ? (
                      <>
                        <div className="text-lg font-bold text-green-400">Struck</div>
                        <div className="text-xs text-neutral-400">Month {btcMgmtMetrics.holding_strike_month} @ {formatUSD(btcMgmtMetrics.holding_strike_price_usd || 0)}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-bold text-yellow-400">Pending</div>
                        <div className="text-xs text-neutral-400">Target: {formatUSD(holdingMetrics.target_sell_price_usd || 0)}</div>
                      </>
                    )}
                  </div>
                  <div className="border border-amber-500/30 rounded p-4 bg-amber-950/10">
                    <div className="text-[10px] text-neutral-500 uppercase mb-1">Mining BTC Accumulated</div>
                    <div className="text-lg font-bold text-amber-400">{formatBTC(btcMgmtMetrics.mining_total_btc_accumulated || 0)}</div>
                    <div className="text-xs text-neutral-400">From capitalization</div>
                  </div>
                </div>

                {/* BTC Quantity Over Time */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">BTC Quantity Under Management Over Time</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={btcQtyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => v.toFixed(2)} label={{ value: 'BTC', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#737373' } }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                        formatter={(v: number, name: string) => [formatBTC(v), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="Holding BTC" stackId="1" stroke="#6BD85A" fill="#6BD85A" fillOpacity={0.3} name="Holding Bucket" />
                      <Area type="monotone" dataKey="Mining Cap BTC" stackId="1" stroke="#B8F2A3" fill="#B8F2A3" fillOpacity={0.3} name="Mining Capitalization" />
                      <Line type="monotone" dataKey="Total BTC" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Total BTC" />
                      {strikeMonth !== null && strikeMonth !== undefined && (
                        <Line type="monotone" dataKey="Strike Event" stroke="#96EA7A" strokeWidth={0} dot={{ r: 8, fill: '#96EA7A', stroke: '#ffffff', strokeWidth: 2 }} name="Price Strike" />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-600 mt-1">
                    Stacked areas show BTC held in each bucket. {strikeMonth !== null && strikeMonth !== undefined && <span className="text-green-400">Green dot marks when the holding target was struck and BTC sold.</span>}
                  </p>
                </div>

                {/* USD Value Over Time (showing appreciation) */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">$ Value Appreciation Over Time</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={btcValueChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis yAxisId="usd" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                        formatter={(v: number, name: string) => [name.includes('Price') ? formatUSD(v) : formatUSD(v), name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area yAxisId="usd" type="monotone" dataKey="Holding Value" stackId="1" stroke="#6BD85A" fill="#6BD85A" fillOpacity={0.3} name="Holding Value ($)" />
                      <Area yAxisId="usd" type="monotone" dataKey="Mining Cap Value" stackId="1" stroke="#B8F2A3" fill="#B8F2A3" fillOpacity={0.3} name="Mining Cap Value ($)" />
                      <Line yAxisId="price" type="monotone" dataKey="BTC Price" stroke="#3DA834" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="BTC Price (right axis)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-600 mt-1">
                    As BTC price (purple line) increases, the $ value of BTC held appreciates. This creates yield-generating capability beyond the initial investment.
                  </p>
                </div>

                {/* Holding Bucket Appreciation */}
                {holdingMetrics.btc_quantity > 0 && (
                  <div className="border border-hearst-border rounded p-4">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Holding Bucket Appreciation (vs Purchase Price)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={appreciationChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                        <YAxis yAxisId="usd" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v.toFixed(0)}%`} />
                        <Tooltip
                          contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }}
                          formatter={(v: number, name: string) => [name.includes('%') ? `${v.toFixed(1)}%` : formatUSD(v), name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar yAxisId="usd" dataKey="Appreciation ($)" fill="#6BD85A" opacity={0.7} name="Unrealized Gain ($)" />
                        <Line yAxisId="pct" type="monotone" dataKey="Appreciation (%)" stroke="#6BD85A" strokeWidth={2} dot={false} name="Gain (%)" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <p className="text-[10px] text-neutral-600 mt-1">
                      Shows how much the holding bucket BTC has appreciated compared to the purchase price of {formatUSD(holdingMetrics.buying_price_usd || 0)}/BTC.
                    </p>
                  </div>
                )}

                {/* Monthly Detail Table */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-hearst-card border-b border-hearst-border">
                    <span className="text-xs font-medium text-neutral-400">Monthly BTC Under Management — {SCENARIO_LABELS[activeScenario] || activeScenario}</span>
                    <div className="flex gap-2">
                      <button
                        className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                        onClick={() => exportAsCSV(btcMgmt, `btc-under-management-${activeScenario}-${selectedRunId.slice(0, 8)}.csv`)}
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto" style={{ maxHeight: '400px' }}>
                    <table className="data-table text-[11px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-hearst-card">Mo</th>
                          <th>BTC Price</th>
                          <th title="BTC in holding bucket (for capital reconstitution)">Holding BTC</th>
                          <th title="USD value of holding bucket BTC">Holding $</th>
                          <th title="BTC accumulated from mining capitalization">Mining BTC</th>
                          <th title="USD value of mining capitalization">Mining $</th>
                          <th title="Total BTC under management">Total BTC</th>
                          <th title="Total USD value">Total $</th>
                          <th title="Holding bucket status">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {btcMgmt.map((m: any) => {
                          const isStrikeMonth = m.holding_strike_this_month;
                          const isSold = m.holding_sold;
                          const rowClass = isStrikeMonth ? 'bg-green-900/20' : '';
                          return (
                            <tr key={m.month} className={rowClass}>
                              <td className={`sticky left-0 z-10 font-semibold ${isStrikeMonth ? 'bg-green-900/30' : 'bg-hearst-card'}`}>{m.month}</td>
                              <td className="font-mono">{formatUSD(m.btc_price_usd)}</td>
                              <td className="font-mono text-cyan-400">{formatBTC(m.holding_btc)}</td>
                              <td className="font-mono">{formatUSD(m.holding_value_usd)}</td>
                              <td className="font-mono text-amber-400">{formatBTC(m.mining_cap_btc)}</td>
                              <td className="font-mono">{formatUSD(m.mining_cap_value_usd)}</td>
                              <td className="font-mono text-white font-semibold">{formatBTC(m.total_btc)}</td>
                              <td className="font-mono font-semibold">{formatUSD(m.total_value_usd)}</td>
                              <td>
                                {isStrikeMonth ? (
                                  <span className="text-green-400 font-semibold">STRUCK</span>
                                ) : isSold ? (
                                  <span className="text-neutral-500">Sold</span>
                                ) : (
                                  <span className="text-cyan-400">Active</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-hearst-card border-t border-hearst-border text-[10px] text-neutral-600">
                    <span className="text-cyan-400">Holding BTC</span> = BTC for capital reconstitution &nbsp;|&nbsp;
                    <span className="text-amber-400">Mining BTC</span> = Capitalization from mining surplus &nbsp;|&nbsp;
                    <span className="text-green-400">STRUCK</span> = Target price hit, BTC sold
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ═══════════ COMMERCIAL TAB ═══════════ */}
          {viewTab === 'commercial' && (() => {
            // Check if any scenario has commercial data
            const hasCommercial = scenarios.some(s => runData.scenario_results[s]?.commercial);
            
            if (!hasCommercial) {
              return (
                <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
                  No commercial fees configured for this simulation run.
                </div>
              );
            }

            // Build chart data for management fees over time
            const mgmtFeesChartData = (() => {
              const baseCommercial = runData.scenario_results[scenarios[0]]?.commercial;
              if (!baseCommercial?.management_fees_monthly?.length) return [];
              
              return baseCommercial.management_fees_monthly.map((_: number, t: number) => {
                const row: any = { month: t };
                for (const s of scenarios) {
                  const fees = runData.scenario_results[s]?.commercial?.management_fees_monthly || [];
                  row[s] = fees[t] || 0;
                }
                return row;
              });
            })();

            return (
              <div className="space-y-6">
                {/* Commercial Summary Cards */}
                <div className="grid grid-cols-3 gap-4">
                  {scenarios.map(s => {
                    const comm = runData.scenario_results[s]?.commercial;
                    const agg = runData.scenario_results[s]?.aggregated?.metrics;
                    return (
                      <div key={s} className="border border-amber-500/20 rounded p-4 bg-amber-950/10 space-y-4">
                        <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                          {SCENARIO_LABELS[s]}
                        </h4>
                        
                        {comm ? (
                          <>
                            <div className="space-y-2">
                              <MetricCard 
                                label="Upfront Fee" 
                                value={formatUSD(comm.upfront_fee_usd || 0)} 
                                status={comm.upfront_fee_usd > 0 ? 'neutral' : 'green'}
                              />
                              <MetricCard 
                                label="Management Fees (Total)" 
                                value={formatUSD(comm.management_fees_total_usd || 0)} 
                                status={comm.management_fees_total_usd > 0 ? 'neutral' : 'green'}
                              />
                              <MetricCard 
                                label="Performance Fee" 
                                value={formatUSD(comm.performance_fee_usd || 0)} 
                                status={comm.performance_fee_usd > 0 ? 'neutral' : 'green'}
                              />
                              <div className="pt-2 border-t border-amber-500/20">
                                <MetricCard 
                                  label="Total Commercial Value" 
                                  value={formatUSD(comm.total_commercial_value_usd || 0)} 
                                  status="neutral"
                                />
                              </div>
                            </div>
                            
                            {/* Impact on investor returns */}
                            {agg && (
                              <div className="pt-2 border-t border-amber-500/20 space-y-1">
                                <p className="text-[10px] text-neutral-500 uppercase font-semibold">Impact on Investor Returns</p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-neutral-500">Gross Return:</span>
                                    <span className={`ml-1 font-mono ${(agg.gross_total_return_pct || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {formatPercent(agg.gross_total_return_pct || 0)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-neutral-500">Net Return:</span>
                                    <span className={`ml-1 font-mono ${(agg.total_return_pct || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {formatPercent(agg.total_return_pct || 0)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-neutral-600">No commercial fees</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Upfront Fee Breakdown */}
                {(() => {
                  const baseComm = runData.scenario_results[scenarios[0]]?.commercial;
                  if (!baseComm || baseComm.upfront_fee_usd <= 0) return null;
                  
                  return (
                    <div className="border border-hearst-border rounded p-4">
                      <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Upfront Fee Allocation (Deducted from Buckets)</h3>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-hearst-accent">Yield Bucket</span>
                          <span className="font-mono">{formatUSD(baseComm.upfront_fee_breakdown?.yield_deduction_usd || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-cyan-400">Holding Bucket</span>
                          <span className="font-mono">{formatUSD(baseComm.upfront_fee_breakdown?.holding_deduction_usd || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-lime-400">Mining Bucket</span>
                          <span className="font-mono">{formatUSD(baseComm.upfront_fee_breakdown?.mining_deduction_usd || 0)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Management Fees Over Time Chart */}
                {mgmtFeesChartData.length > 0 && (
                  <div className="border border-hearst-border rounded p-4">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly Management Fees</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={mgmtFeesChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip 
                          contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} 
                          formatter={(v: number) => formatUSD(v)} 
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {scenarios.map(s => (
                          <Bar key={s} dataKey={s} fill={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} opacity={0.7} name={SCENARIO_LABELS[s]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Performance Fee Details */}
                {(() => {
                  const hasPerformanceFee = scenarios.some(s => (runData.scenario_results[s]?.commercial?.performance_fee_usd || 0) > 0);
                  if (!hasPerformanceFee) return null;
                  
                  return (
                    <div className="border border-hearst-border rounded p-4">
                      <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Performance Fee Calculation</h3>
                      <p className="text-[10px] text-neutral-600 mb-4">Performance fee is calculated on the capitalization overhead (value above initial mining investment)</p>
                      <div className="grid grid-cols-3 gap-4">
                        {scenarios.map(s => {
                          const comm = runData.scenario_results[s]?.commercial;
                          return (
                            <div key={s} className="space-y-1 text-xs">
                              <span className="font-semibold" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                                {SCENARIO_LABELS[s]}
                              </span>
                              <div className="text-neutral-500">
                                Overhead (Base): <span className="font-mono text-neutral-300">{formatUSD(comm?.performance_fee_base_usd || 0)}</span>
                              </div>
                              <div className="text-neutral-500">
                                Performance Fee: <span className="font-mono text-amber-400">{formatUSD(comm?.performance_fee_usd || 0)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Commercial Value Summary Table */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Fee Type</th>
                        {scenarios.map(s => (
                          <th key={s} style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>
                            {SCENARIO_LABELS[s] || s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="font-medium text-neutral-400">Upfront Commercial</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.commercial?.upfront_fee_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Management Fees</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.commercial?.management_fees_total_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Performance Fees</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.commercial?.performance_fee_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr className="bg-amber-900/10">
                        <td className="font-semibold text-amber-400">Total Commercial Value</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono font-semibold text-amber-400">{formatUSD(runData.scenario_results[s]?.commercial?.total_commercial_value_usd || 0)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════
           *  BITCOIN SCENARIO TABS
           * ═══════════════════════════════════════════════════ */}

          {/* ═══════════ BTC OVERVIEW TAB ═══════════ */}
          {viewTab === 'btc_overview' && isBitcoin && (() => {
            const btcChartData = (() => {
              const base = runData.scenario_results['base'] || runData.scenario_results[scenarios[0]];
              const months = base?.monthly_data?.length || 0;
              return Array.from({ length: months }, (_, t) => {
                const row: any = { month: t };
                for (const s of scenarios) {
                  const md = runData.scenario_results[s]?.monthly_data;
                  row[`${s}_equity`] = md?.[t]?.net_equity_usd || 0;
                  row[`${s}_collateral`] = md?.[t]?.collateral_value_usd || 0;
                  row[`${s}_debt`] = md?.[t]?.stablecoin_debt || 0;
                }
                return row;
              });
            })();

            return (
              <div className="space-y-4">
                {/* Key Metrics */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        {scenarios.map(s => (
                          <th key={s} style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>{SCENARIO_LABELS[s]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="font-medium text-neutral-400">Net Equity</td>
                        {scenarios.map(s => {
                          const m = runData.scenario_results[s]?.metrics;
                          const v = m?.final_net_equity_usd || 0;
                          return <td key={s} className={`font-mono ${v >= (m?.capital_raised_usd || 0) ? 'text-green-400' : 'text-red-400'}`}>{formatUSD(v)}</td>;
                        })}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Total Return</td>
                        {scenarios.map(s => {
                          const pct = runData.scenario_results[s]?.metrics?.total_return_pct || 0;
                          return <td key={s} className={`font-mono ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatPercent(pct)}</td>;
                        })}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Final BTC Collateral</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatBTC(runData.scenario_results[s]?.metrics?.final_btc_collateral || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Collateral Value</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatUSD(runData.scenario_results[s]?.metrics?.final_collateral_value_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Outstanding Debt</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono text-red-400">{formatUSD(runData.scenario_results[s]?.metrics?.final_stablecoin_debt || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Final LTV</td>
                        {scenarios.map(s => {
                          const ltv = runData.scenario_results[s]?.metrics?.final_ltv_pct || 0;
                          const liq = runData.input_snapshot?.bitcoin_config?.liquidation_ltv_pct || 80;
                          return <td key={s} className={`font-mono ${ltv >= liq ? 'text-red-400 font-bold' : ltv >= liq * 0.8 ? 'text-yellow-400' : 'text-green-400'}`}>{formatNumber(ltv, 1)}%</td>;
                        })}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Total BTC Mined</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono">{formatBTC(runData.scenario_results[s]?.metrics?.total_btc_mined || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Total Interest Paid</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono text-amber-400">{formatUSD(runData.scenario_results[s]?.metrics?.total_interest_paid_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Debt Repaid (Strikes)</td>
                        {scenarios.map(s => (
                          <td key={s} className="font-mono text-green-400">{formatUSD(runData.scenario_results[s]?.metrics?.total_debt_repaid_usd || 0)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Strikes Triggered</td>
                        {scenarios.map(s => {
                          const m = runData.scenario_results[s]?.metrics;
                          return <td key={s} className="font-mono">{m?.strikes_triggered || 0} / {m?.strikes_total || 0}</td>;
                        })}
                      </tr>
                      <tr>
                        <td className="font-medium text-neutral-400">Liquidation Risk Months</td>
                        {scenarios.map(s => {
                          const v = runData.scenario_results[s]?.metrics?.liquidation_risk_months || 0;
                          return <td key={s} className={`font-mono ${v > 0 ? 'text-red-400 font-bold' : 'text-green-400'}`}>{v}</td>;
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Net Equity Chart */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Net Equity Over Time (BTC Value - Debt + Reserve)</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={btcChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={runData.scenario_results[scenarios[0]]?.metrics?.capital_raised_usd || 0} stroke="#525252" strokeDasharray="6 3" label={{ value: 'Capital', position: 'right', fontSize: 9, fill: '#525252' }} />
                      {scenarios.map(s => (
                        <Line key={s} type="monotone" dataKey={`${s}_equity`} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={s === 'base' ? 2 : 1.5} strokeDasharray={s === 'base' ? undefined : '5 3'} dot={false} name={`${SCENARIO_LABELS[s]} Net Equity`} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Collateral vs Debt (Base) */}
                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Collateral Value vs Stablecoin Debt (Base Scenario)</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={btcChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="base_collateral" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} name="Collateral Value" />
                      <Area type="monotone" dataKey="base_debt" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} name="Stablecoin Debt" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* ═══════════ BTC COLLATERAL TAB ═══════════ */}
          {viewTab === 'btc_collateral' && isBitcoin && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const md: any[] = runData.scenario_results[activeScenario]?.monthly_data || [];
            const metrics = runData.scenario_results[activeScenario]?.metrics || {};

            const collateralChartData = md.map((m: any) => ({
              month: m.month,
              'BTC Collateral': m.btc_collateral,
              'BTC Mined (cumulative)': 0,
              'Collateral Value ($)': m.collateral_value_usd,
              'BTC Price': m.btc_price_usd,
            }));

            let cumMined = 0;
            for (const row of collateralChartData) {
              const m = md[row.month];
              cumMined += m?.btc_mined || 0;
              row['BTC Mined (cumulative)'] = cumMined;
            }

            return (
              <div className="space-y-5">
                <div className="flex gap-1 mb-2">
                  {scenarios.map(s => (
                    <button key={s} onClick={() => setWaterfallScenario(s)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors uppercase ${activeScenario === s ? 'bg-hearst-border text-white' : 'bg-hearst-card text-neutral-500 hover:text-neutral-300'}`}
                      style={activeScenario === s ? { borderBottom: `2px solid ${SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}` } : undefined}
                    >{SCENARIO_LABELS[s]}</button>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <MetricCard label="BTC Purchased" value={formatBTC(metrics.btc_purchased || 0)} />
                  <MetricCard label="BTC Mined (Total)" value={formatBTC(metrics.total_btc_mined || 0)} status="green" />
                  <MetricCard label="Final BTC Collateral" value={formatBTC(metrics.final_btc_collateral || 0)} />
                  <MetricCard label="Final Collateral Value" value={formatUSD(metrics.final_collateral_value_usd || 0)} status="green" />
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">BTC Collateral Over Time</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={collateralChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis yAxisId="btc" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => v.toFixed(2)} />
                      <YAxis yAxisId="usd" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area yAxisId="btc" type="monotone" dataKey="BTC Collateral" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={2} />
                      <Line yAxisId="usd" type="monotone" dataKey="BTC Price" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Collateral USD Value Over Time</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={collateralChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                      <Area type="monotone" dataKey="Collateral Value ($)" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* ═══════════ BTC DEBT TAB ═══════════ */}
          {viewTab === 'btc_debt' && isBitcoin && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const md: any[] = runData.scenario_results[activeScenario]?.monthly_data || [];
            const metrics = runData.scenario_results[activeScenario]?.metrics || {};
            const strikeEvts: any[] = runData.scenario_results[activeScenario]?.strike_events || [];

            const debtChartData = md.map((m: any) => ({
              month: m.month,
              'Stablecoin Debt': m.stablecoin_debt,
              'Stablecoin Reserve': m.stablecoin_reserve,
              'Interest Accrued': m.interest_usd,
              'OPEX Paid': m.opex_usd,
              'Strike Repayment': m.strike_debt_repaid,
            }));

            return (
              <div className="space-y-5">
                <div className="flex gap-1 mb-2">
                  {scenarios.map(s => (
                    <button key={s} onClick={() => setWaterfallScenario(s)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors uppercase ${activeScenario === s ? 'bg-hearst-border text-white' : 'bg-hearst-card text-neutral-500 hover:text-neutral-300'}`}
                      style={activeScenario === s ? { borderBottom: `2px solid ${SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}` } : undefined}
                    >{SCENARIO_LABELS[s]}</button>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <MetricCard label="Outstanding Debt" value={formatUSD(metrics.final_stablecoin_debt || 0)} status="red" />
                  <MetricCard label="Total Interest" value={formatUSD(metrics.total_interest_paid_usd || 0)} />
                  <MetricCard label="Total Debt Repaid" value={formatUSD(metrics.total_debt_repaid_usd || 0)} status="green" />
                  <MetricCard label="Stablecoin Reserve" value={formatUSD(metrics.final_stablecoin_reserve || 0)} />
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Stablecoin Debt Over Time</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={debtChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="Stablecoin Debt" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
                      <Area type="monotone" dataKey="Stablecoin Reserve" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.1} strokeWidth={1.5} />
                      {strikeEvts.map((evt: any, i: number) => (
                        <ReferenceLine key={i} x={evt.month} stroke="#22c55e" strokeDasharray="3 3" label={{ value: `Strike $${(evt.strike_price / 1000).toFixed(0)}k`, position: 'top', fontSize: 8, fill: '#22c55e' }} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly Interest & OPEX</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={debtChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number) => formatUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="OPEX Paid" fill="#f59e0b" opacity={0.7} name="OPEX" />
                      <Bar dataKey="Interest Accrued" fill="#ef4444" opacity={0.7} name="Interest" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* ═══════════ BTC LTV MONITOR TAB ═══════════ */}
          {viewTab === 'btc_ltv' && isBitcoin && (() => {
            const liqLtv = runData.input_snapshot?.bitcoin_config?.liquidation_ltv_pct || 80;
            const maxLtv = runData.input_snapshot?.bitcoin_config?.collateral_ltv_pct || 50;

            const ltvChartData = (() => {
              const base = runData.scenario_results['base'] || runData.scenario_results[scenarios[0]];
              const months = base?.monthly_data?.length || 0;
              return Array.from({ length: months }, (_, t) => {
                const row: any = { month: t };
                for (const s of scenarios) {
                  const md = runData.scenario_results[s]?.monthly_data;
                  row[`${s}_ltv`] = Math.min(md?.[t]?.ltv_pct || 0, 120);
                }
                return row;
              });
            })();

            return (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  {scenarios.map(s => {
                    const m = runData.scenario_results[s]?.metrics;
                    return (
                      <div key={s} className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase" style={{ color: SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS] }}>{SCENARIO_LABELS[s]}</h4>
                        <MetricCard label="Final LTV" value={`${formatNumber(m?.final_ltv_pct || 0, 1)}%`} status={(m?.final_ltv_pct || 0) >= liqLtv ? 'red' : (m?.final_ltv_pct || 0) >= liqLtv * 0.8 ? 'yellow' : 'green'} />
                        <MetricCard label="Max LTV Reached" value={`${formatNumber(m?.max_ltv_pct || 0, 1)}%`} status={(m?.max_ltv_pct || 0) >= liqLtv ? 'red' : 'neutral'} />
                        <MetricCard label="Min LTV" value={`${formatNumber(m?.min_ltv_pct || 0, 1)}%`} status="green" />
                        <MetricCard label="Liquidation Risk Months" value={`${m?.liquidation_risk_months || 0}`} status={(m?.liquidation_risk_months || 0) > 0 ? 'red' : 'green'} />
                      </div>
                    );
                  })}
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">LTV Ratio Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={ltvChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v}%`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={liqLtv} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={2} label={{ value: `Liquidation (${liqLtv}%)`, position: 'right', fontSize: 9, fill: '#ef4444' }} />
                      <ReferenceLine y={maxLtv} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: `Max Borrow (${maxLtv}%)`, position: 'right', fontSize: 9, fill: '#f59e0b' }} />
                      {scenarios.map(s => (
                        <Line key={s} type="monotone" dataKey={`${s}_ltv`} stroke={SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]} strokeWidth={s === 'base' ? 2 : 1.5} strokeDasharray={s === 'base' ? undefined : '5 3'} dot={false} name={`${SCENARIO_LABELS[s]} LTV`} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-600 mt-1">
                    Red line = liquidation threshold. Amber line = max borrowing LTV. Below max borrow = healthy zone.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* ═══════════ BTC STRIKE EVENTS TAB ═══════════ */}
          {viewTab === 'btc_strikes' && isBitcoin && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const strikeEvts: any[] = runData.scenario_results[activeScenario]?.strike_events || [];
            const strikeLadder: any[] = runData.scenario_results[activeScenario]?.strike_ladder_status || [];

            return (
              <div className="space-y-5">
                <div className="flex gap-1 mb-2">
                  {scenarios.map(s => (
                    <button key={s} onClick={() => setWaterfallScenario(s)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors uppercase ${activeScenario === s ? 'bg-hearst-border text-white' : 'bg-hearst-card text-neutral-500 hover:text-neutral-300'}`}
                      style={activeScenario === s ? { borderBottom: `2px solid ${SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}` } : undefined}
                    >{SCENARIO_LABELS[s]}</button>
                  ))}
                </div>

                {/* Strike Ladder Status */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <div className="px-3 py-2 bg-hearst-card border-b border-hearst-border">
                    <span className="text-xs font-medium text-neutral-400">Strike Ladder — {SCENARIO_LABELS[activeScenario]}</span>
                  </div>
                  <table className="data-table text-[11px]">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Strike Price</th>
                        <th>Sell %</th>
                        <th>Status</th>
                        <th>Trigger Month</th>
                        <th>BTC Sold</th>
                        <th>USD Received</th>
                        <th>Debt Repaid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strikeLadder.map((s: any, i: number) => (
                        <tr key={i} className={s.triggered ? 'bg-green-900/10' : ''}>
                          <td className="font-semibold">{i + 1}</td>
                          <td className="font-mono">{formatUSD(s.strike_price)}</td>
                          <td className="font-mono">{s.btc_sell_pct}%</td>
                          <td>
                            {s.triggered ? (
                              <span className="text-green-400 font-semibold">TRIGGERED</span>
                            ) : (
                              <span className="text-neutral-500">Pending</span>
                            )}
                          </td>
                          <td className="font-mono">{s.trigger_month !== null ? s.trigger_month : '—'}</td>
                          <td className="font-mono text-amber-400">{s.triggered ? formatBTC(s.btc_sold) : '—'}</td>
                          <td className="font-mono">{s.triggered ? formatUSD(s.usd_received) : '—'}</td>
                          <td className="font-mono text-green-400">{s.triggered ? formatUSD(s.debt_repaid) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Strike Event Detail Log */}
                {strikeEvts.length > 0 ? (
                  <div className="border border-hearst-border rounded overflow-hidden">
                    <div className="px-3 py-2 bg-hearst-card border-b border-hearst-border">
                      <span className="text-xs font-medium text-neutral-400">Strike Event Log</span>
                    </div>
                    <table className="data-table text-[11px]">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Strike Price</th>
                          <th>Spot Price</th>
                          <th>BTC Sold</th>
                          <th>USD Received</th>
                          <th>Debt Repaid</th>
                          <th>Surplus → Reserve</th>
                          <th>Remaining Debt</th>
                          <th>Remaining BTC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strikeEvts.map((evt: any, i: number) => (
                          <tr key={i} className="bg-green-900/10">
                            <td className="font-semibold">{evt.month}</td>
                            <td className="font-mono">{formatUSD(evt.strike_price)}</td>
                            <td className="font-mono">{formatUSD(evt.btc_price_usd)}</td>
                            <td className="font-mono text-amber-400">{formatBTC(evt.btc_sold)}</td>
                            <td className="font-mono">{formatUSD(evt.usd_received)}</td>
                            <td className="font-mono text-green-400">{formatUSD(evt.debt_repaid)}</td>
                            <td className="font-mono text-cyan-400">{formatUSD(evt.surplus_to_reserve)}</td>
                            <td className="font-mono text-red-400">{formatUSD(evt.remaining_debt)}</td>
                            <td className="font-mono">{formatBTC(evt.remaining_btc)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 text-sm text-neutral-600 border border-hearst-border rounded">
                    No strikes triggered in the {SCENARIO_LABELS[activeScenario]} scenario. BTC price did not reach any strike levels.
                  </div>
                )}
              </div>
            );
          })()}

          {/* ═══════════ BTC MINING DETAIL TAB ═══════════ */}
          {viewTab === 'btc_mining' && isBitcoin && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const md: any[] = runData.scenario_results[activeScenario]?.monthly_data || [];
            const production: any[] = runData.scenario_results[activeScenario]?.mining_production || [];
            const metrics = runData.scenario_results[activeScenario]?.metrics || {};

            return (
              <div className="space-y-5">
                <div className="flex gap-1 mb-2">
                  {scenarios.map(s => (
                    <button key={s} onClick={() => setWaterfallScenario(s)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors uppercase ${activeScenario === s ? 'bg-hearst-border text-white' : 'bg-hearst-card text-neutral-500 hover:text-neutral-300'}`}
                      style={activeScenario === s ? { borderBottom: `2px solid ${SCENARIO_COLORS[s as keyof typeof SCENARIO_COLORS]}` } : undefined}
                    >{SCENARIO_LABELS[s]}</button>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <MetricCard label="Total BTC Mined" value={formatBTC(metrics.total_btc_mined || 0)} status="green" />
                  <MetricCard label="Total OPEX" value={formatUSD(metrics.total_opex_paid_usd || 0)} />
                  <MetricCard label="Miner CapEx" value={formatUSD(metrics.miner_capex_usd || 0)} />
                  <MetricCard label="Effective Months" value={`${metrics.effective_months || 0}`} />
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Monthly BTC Production & OPEX</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={production}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis yAxisId="btc" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => v.toFixed(4)} />
                      <YAxis yAxisId="usd" orientation="right" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar yAxisId="btc" dataKey="btc_produced" fill="#f59e0b" opacity={0.7} name="BTC Produced" />
                      <Line yAxisId="usd" type="monotone" dataKey="opex_usd" stroke="#ef4444" strokeWidth={1.5} dot={false} name="OPEX ($)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Monthly Detail Table */}
                <div className="border border-hearst-border rounded overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-hearst-card border-b border-hearst-border">
                    <span className="text-xs font-medium text-neutral-400">Monthly Detail — {SCENARIO_LABELS[activeScenario]}</span>
                    <button
                      className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                      onClick={() => exportAsCSV(md, `bitcoin-monthly-${activeScenario}-${selectedRunId.slice(0, 8)}.csv`)}
                    >
                      Export CSV
                    </button>
                  </div>
                  <div className="overflow-auto" style={{ maxHeight: '500px' }}>
                    <table className="data-table text-[11px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-hearst-card">Mo</th>
                          <th>BTC Price</th>
                          <th>BTC Mined</th>
                          <th>BTC Collateral</th>
                          <th>Collateral $</th>
                          <th>OPEX</th>
                          <th>Interest</th>
                          <th>Debt</th>
                          <th>Reserve</th>
                          <th>LTV %</th>
                          <th>Net Equity</th>
                          <th>Strike</th>
                        </tr>
                      </thead>
                      <tbody>
                        {md.map((m: any) => {
                          const liqLtv = runData.input_snapshot?.bitcoin_config?.liquidation_ltv_pct || 80;
                          const isRisk = m.liquidation_risk;
                          const hasStrike = m.strike_sold_btc > 0;
                          const rowClass = hasStrike ? 'bg-green-900/15' : isRisk ? 'bg-red-900/15' : '';
                          return (
                            <tr key={m.month} className={rowClass}>
                              <td className={`sticky left-0 z-10 font-semibold ${hasStrike ? 'bg-green-900/25' : isRisk ? 'bg-red-900/25' : 'bg-hearst-card'}`}>{m.month}</td>
                              <td className="font-mono">{formatUSD(m.btc_price_usd)}</td>
                              <td className="font-mono text-amber-400">{formatBTC(m.btc_mined)}</td>
                              <td className="font-mono">{formatBTC(m.btc_collateral)}</td>
                              <td className="font-mono">{formatUSD(m.collateral_value_usd)}</td>
                              <td className="font-mono">{formatUSD(m.opex_usd)}</td>
                              <td className="font-mono text-red-400">{formatUSD(m.interest_usd)}</td>
                              <td className="font-mono text-red-400">{formatUSD(m.stablecoin_debt)}</td>
                              <td className="font-mono text-cyan-400">{formatUSD(m.stablecoin_reserve)}</td>
                              <td className={`font-mono font-semibold ${m.ltv_pct >= liqLtv ? 'text-red-400' : m.ltv_pct >= liqLtv * 0.8 ? 'text-yellow-400' : 'text-green-400'}`}>{formatNumber(m.ltv_pct, 1)}%</td>
                              <td className={`font-mono font-semibold ${m.net_equity_usd >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatUSD(m.net_equity_usd)}</td>
                              <td>
                                {hasStrike ? (
                                  <span className="text-green-400 font-semibold">STRIKE</span>
                                ) : m.opex_shortfall ? (
                                  <span className="text-red-400">SHORTFALL</span>
                                ) : (
                                  <span className="text-neutral-600">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-hearst-card border-t border-hearst-border text-[10px] text-neutral-600">
                    <span className="text-green-400 font-medium">STRIKE</span> = BTC sold at strike price &nbsp;|&nbsp;
                    <span className="text-red-400 font-medium">SHORTFALL</span> = Could not mint enough to cover OPEX &nbsp;|&nbsp;
                    LTV colors: <span className="text-green-400">Safe</span> / <span className="text-yellow-400">Warning</span> / <span className="text-red-400">Liquidation risk</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ═══════════════════════════════════════════════════
           *  BUCKETS SCENARIO TABS (existing — waterfall)
           * ═══════════════════════════════════════════════════ */}

          {/* ═══════════ WATERFALL DETAIL TAB ═══════════ */}
          {viewTab === 'waterfall' && (() => {
            const activeScenario = scenarios.includes(waterfallScenario) ? waterfallScenario : scenarios[0];
            const waterfall: any[] = runData.scenario_results[activeScenario]?.mining_bucket?.monthly_waterfall || [];
            const miningMetrics = runData.scenario_results[activeScenario]?.mining_bucket?.metrics || {};
            const decision = runData.scenario_results[activeScenario]?.aggregated?.decision || 'PENDING';
            const reasons = runData.scenario_results[activeScenario]?.aggregated?.decision_reasons || [];
            const holdingSellMonth = runData.scenario_results[activeScenario]?.btc_holding_bucket?.metrics?.sell_month;
            const earlyClose = runData.scenario_results[activeScenario]?.aggregated?.early_close;
            const qYieldData: any[] = runData.scenario_results[activeScenario]?.aggregated?.quarterly_yield_data || [];
            const totalMonths = waterfall.length;
            const redMonths = waterfall.filter((m: any) => m.flag === 'RED').length;
            const greenMonths = totalMonths - redMonths;

            // Build cumulative yield lookup for the table
            let cumulativeYield = 0;
            const cumulativeYieldByMonth: Record<number, number> = {};
            const yieldMonthlyData = runData.scenario_results[activeScenario]?.yield_bucket?.monthly_data || [];
            for (let t = 0; t < waterfall.length; t++) {
              const yYield = yieldMonthlyData[t]?.monthly_yield_usd || 0;
              const mYield = waterfall[t]?.yield_paid_usd || 0;
              cumulativeYield += yYield + mYield;
              cumulativeYieldByMonth[t] = cumulativeYield;
            }
            const capitalRaised = runData.scenario_results[activeScenario]?.aggregated?.metrics?.capital_raised_usd || 1;

            // Build chart data for BTC allocation stacked bar
            const btcAllocationData = waterfall.map((m: any) => ({
              month: m.month,
              'OPEX': m.btc_sell_opex,
              'Yield': m.btc_for_yield || 0,
              'Capitalization': m.btc_to_capitalization || 0,
              'Cap→OPEX': -(m.cap_drawn_for_opex || 0),
              'Cap→Yield': -(m.cap_drawn_for_yield || 0),
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
                      <Bar dataKey="OPEX" stackId="alloc" fill="#3DA834" opacity={0.8} name="OPEX" />
                      <Bar dataKey="Yield" stackId="alloc" fill="#96EA7A" opacity={0.8} name="Yield Distributed" />
                      <Bar dataKey="Capitalization" stackId="alloc" fill="#B8F2A3" opacity={0.8} name="Capitalization" />
                      <Bar dataKey="Cap→OPEX" stackId="draw" fill="#F59E0B" opacity={0.7} name="Cap Reserve → OPEX" />
                      <Bar dataKey="Cap→Yield" stackId="draw" fill="#FBBF24" opacity={0.7} name="Cap Reserve → Yield" />
                      <Line type="monotone" dataKey="Total Produced" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="BTC Produced" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-neutral-600 mt-1">White dashed line = total BTC produced. Stacked bars = allocation from production. <span className="text-amber-400">Amber bars below zero</span> = capitalization reserve drawn down for OPEX or yield top-up.</p>
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
                      <Area yAxisId="usd" type="monotone" dataKey="Capitalization (USD)" stroke="#6BD85A" fill="#6BD85A" fillOpacity={0.15} strokeWidth={2} />
                      <Line yAxisId="btc" type="monotone" dataKey="Capitalization (BTC)" stroke="#B8F2A3" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
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
                      <Line type="monotone" dataKey="Health Score" stroke="#96EA7A" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="OPEX Coverage" stroke="#4FC043" strokeWidth={1.5} dot={false} name="OPEX Coverage (%)" />
                      <Line type="monotone" dataKey="Yield Fulfillment" stroke="#B8F2A3" strokeWidth={1.5} dot={false} name="Yield Fulfillment (%)" />
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
                          <th title="BTC drawn from capitalization reserve for OPEX shortfall" className="text-amber-400">Cap→OPEX</th>
                          <th title="BTC drawn from capitalization reserve to top up yield" className="text-amber-400">Cap→Yield</th>
                          <th title="Total operating expenses in USD">OPEX (USD)</th>
                          <th title="Yield distributed to investors this month">Yield (USD)</th>
                          <th title="Applied yield APR for this month (8% base or 12% with bonus)">APR</th>
                          <th title="Take-profit ladder sales from capitalization bucket">TP Sold</th>
                          <th title="Cumulative capitalization bucket in BTC">Cap BTC</th>
                          <th title="Capitalization bucket mark-to-market value">Cap USD</th>
                          <th title="OPEX coverage ratio: revenue / OPEX (>1 means profitable)">OPEX Cov.</th>
                          <th title="Yield fulfillment: actual / target yield (1.0 = 100% delivered)">Yield Fill</th>
                          <th title="Portfolio health score (0-100)">Health</th>
                          <th title="Cumulative yield from all buckets as % of capital raised" className="text-purple-400">Cum. Yield %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waterfall.map((m: any, idx: number) => {
                          const isDeficit = m.flag === 'RED';
                          const isBonusApr = (m.yield_apr_applied || 0) > 0.09;
                          const isQuarterEnd = (m.month + 1) % 3 === 0;
                          const isEarlyCloseMonth = earlyClose?.triggered && m.month === earlyClose.close_month;
                          const cumYieldPct = (cumulativeYieldByMonth[m.month] || 0) / capitalRaised;
                          const targetPct = earlyClose?.target_pct || 0.36;
                          const rowClass = isEarlyCloseMonth
                            ? 'bg-purple-900/20 border-b-2 border-purple-500/50'
                            : isDeficit
                              ? 'bg-red-900/15'
                              : isQuarterEnd
                                ? 'border-b border-hearst-border/50'
                                : '';
                          return (
                            <tr key={m.month} className={rowClass}>
                              <td className={`sticky left-0 z-10 font-semibold ${isEarlyCloseMonth ? 'bg-purple-900/30' : isDeficit ? 'bg-red-900/30' : 'bg-hearst-card'}`}>{m.month}{isQuarterEnd && <span className="text-[9px] text-neutral-600 ml-0.5">Q{Math.floor(m.month / 3) + 1}</span>}</td>
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
                              <td className={`font-mono ${(m.cap_drawn_for_opex || 0) > 0 ? 'text-amber-400 font-semibold' : 'text-neutral-600'}`}>{formatBTC(m.cap_drawn_for_opex || 0)}</td>
                              <td className={`font-mono ${(m.cap_drawn_for_yield || 0) > 0 ? 'text-amber-400 font-semibold' : 'text-neutral-600'}`}>{formatBTC(m.cap_drawn_for_yield || 0)}</td>
                              <td className="font-mono">{formatUSD(m.opex_usd)}</td>
                              <td className={`font-mono ${m.yield_paid_usd > 0 ? 'text-green-400' : 'text-neutral-600'}`}>{formatUSD(m.yield_paid_usd)}</td>
                              <td className={`font-mono ${isBonusApr ? 'text-hearst-accent font-semibold' : 'text-neutral-400'}`}>{formatPercent(m.yield_apr_applied || 0)}</td>
                              <td className="font-mono">{formatUSD(m.take_profit_sold_usd)}</td>
                              <td className="font-mono text-cyan-300">{formatBTC(m.capitalization_btc || 0)}</td>
                              <td className="font-mono">{formatUSD(m.capitalization_usd || 0)}</td>
                              <td className={`font-mono ${(m.opex_coverage_ratio || 0) >= 1.5 ? 'text-green-400' : (m.opex_coverage_ratio || 0) >= 1.0 ? 'text-yellow-400' : 'text-red-400'}`}>{formatNumber(m.opex_coverage_ratio || 0, 2)}x</td>
                              <td className={`font-mono ${(m.yield_fulfillment || 0) >= 1.0 ? 'text-green-400' : (m.yield_fulfillment || 0) >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>{formatPercent(m.yield_fulfillment || 0)}</td>
                              <td className={`font-mono font-semibold ${m.health_score >= 60 ? 'text-green-400' : m.health_score >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>{formatNumber(m.health_score, 1)}</td>
                              <td className={`font-mono font-semibold ${cumYieldPct >= targetPct ? 'text-purple-400' : cumYieldPct >= targetPct * 0.75 ? 'text-purple-300' : 'text-neutral-500'}`}>
                                {formatPercent(cumYieldPct)}
                                {isEarlyCloseMonth && <span className="ml-1 text-[9px] text-purple-400">CLOSE</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2 bg-hearst-card border-t border-hearst-border text-[10px] text-neutral-600">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" /> RED = Deficit (production + reserves {'<'} OPEX) &nbsp;
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 align-middle" /> GREEN = Yield fully served &nbsp;|&nbsp;
                    <span className="text-amber-400 font-medium">Cap Draw</span> = capitalization reserve used for OPEX/yield &nbsp;|&nbsp;
                    <span className="text-hearst-accent">Blue APR</span> = bonus yield active &nbsp;|&nbsp;
                    <span className="text-purple-400">Cum. Yield %</span> = progress toward {formatPercent(earlyClose?.target_pct || 0.36)} early close target &nbsp;|&nbsp;
                    Q labels mark quarterly boundaries
                    {earlyClose?.triggered && (
                      <span className="ml-2 text-purple-400 font-semibold">CLOSE at Mo {earlyClose.close_month}</span>
                    )}
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
