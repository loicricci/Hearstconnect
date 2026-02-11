'use client';

import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { opsApi, btcPriceCurveApi, networkCurveApi, minersApi } from '@/lib/api';
import { formatBTC, formatPercent, formatNumber } from '@/lib/utils';

export default function OpsPerformancePage() {
  const [history, setHistory] = useState<any[]>([]);
  const [curves, setCurves] = useState<any[]>([]);
  const [networkCurves, setNetworkCurves] = useState<any[]>([]);
  const [miners, setMiners] = useState<any[]>([]);

  // Import form
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Calibration inputs
  const [selectedBTCCurve, setSelectedBTCCurve] = useState('');
  const [selectedNetCurve, setSelectedNetCurve] = useState('');
  const [selectedMiner, setSelectedMiner] = useState('');
  const [assumedUptime, setAssumedUptime] = useState(0.95);
  const [elecRate, setElecRate] = useState(0.05);

  const [calibResult, setCalibResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const h: any = await opsApi.getHistory();
      const btc: any = await btcPriceCurveApi.list();
      const net: any = await networkCurveApi.list();
      const m: any = await minersApi.list();
      setHistory(h);
      setCurves(btc);
      setNetworkCurves(net);
      setMiners(m);
      if (btc.length > 0) setSelectedBTCCurve(btc[0].id);
      if (net.length > 0) setSelectedNetCurve(net[0].id);
      if (m.length > 0) setSelectedMiner(m[0].id);
    } catch (e) { /* API not available yet */ }
  };

  const importCSV = async () => {
    try {
      const lines = csvText.trim().split('\n');
      const entries = lines.slice(1).map(line => {
        const [month, btc_produced, uptime, energy_kwh, downtime_events] = line.split(',');
        return {
          month: month.trim(),
          btc_produced: parseFloat(btc_produced),
          uptime: parseFloat(uptime),
          energy_kwh: parseFloat(energy_kwh),
          downtime_events: parseInt(downtime_events || '0'),
        };
      });
      await opsApi.importHistory({ entries });
      setShowImport(false);
      setCsvText('');
      loadData();
    } catch (e: any) { setError(e.message); }
  };

  const runCalibration = async () => {
    if (!selectedBTCCurve || !selectedNetCurve || !selectedMiner) {
      setError('Select all required inputs.'); return;
    }
    setRunning(true);
    setError('');
    try {
      const res = await opsApi.calibrate({
        btc_price_curve_id: selectedBTCCurve,
        network_curve_id: selectedNetCurve,
        miner_id: selectedMiner,
        assumed_uptime: assumedUptime,
        electricity_rate: elecRate,
      });
      setCalibResult(res);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  return (
    <PageShell
      title="Operational Performance"
      subtitle="Calibrate model against actual historical data"
      runId={calibResult?.id}
      lastRunAt={calibResult?.created_at}
      warnings={calibResult?.flags?.filter((f: string) => f.startsWith('WARNING')) || []}
      hardBlocks={calibResult?.flags?.filter((f: string) => f.startsWith('RED FLAG')) || []}
      onRun={runCalibration}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="col-span-4 space-y-4">
          {/* Historical Data */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Historical Data</h3>
              <button className="btn-secondary text-[10px]" onClick={() => setShowImport(!showImport)}>
                {showImport ? 'Cancel' : 'Import CSV'}
              </button>
            </div>

            {showImport && (
              <div className="space-y-2">
                <textarea
                  className="w-full h-32 bg-hearst-card border border-hearst-border-light rounded p-2 text-xs font-mono text-neutral-300"
                  placeholder="month,btc_produced,uptime,energy_kwh,downtime_events&#10;2024-07,0.0045,0.93,2400,0&#10;2024-08,0.0043,0.91,2350,1"
                  value={csvText}
                  onChange={e => setCsvText(e.target.value)}
                />
                <button className="btn-primary w-full" onClick={importCSV}>Import</button>
              </div>
            )}

            <div className="text-xs text-neutral-500">
              {history.length} months loaded
            </div>
            <div className="overflow-auto max-h-[150px]">
              <table className="data-table">
                <thead>
                  <tr><th>Month</th><th>BTC</th><th>Uptime</th><th>kWh</th></tr>
                </thead>
                <tbody>
                  {history.map((h: any) => (
                    <tr key={h.id || h.month}>
                      <td>{h.month}</td>
                      <td>{h.btc_produced.toFixed(6)}</td>
                      <td>{formatPercent(h.uptime)}</td>
                      <td>{formatNumber(h.energy_kwh, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Calibration Settings */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Calibration Settings</h3>
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
            <InputField label="Assumed Uptime" value={assumedUptime} onChange={v => setAssumedUptime(Number(v))} type="number" step={0.01} />
            <InputField label="Electricity Rate ($/kWh)" value={elecRate} onChange={v => setElecRate(Number(v))} type="number" step={0.005} />
          </div>
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-8 space-y-4">
          {calibResult && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label="Uptime Factor"
                  value={calibResult.realized_uptime_factor.toFixed(4)}
                  sub="actual / assumed"
                  status={calibResult.realized_uptime_factor >= 0.95 ? 'green' : calibResult.realized_uptime_factor >= 0.85 ? 'yellow' : 'red'}
                />
                <MetricCard
                  label="Production Adj."
                  value={calibResult.production_adjustment.toFixed(4)}
                  sub="actual / predicted"
                  status={calibResult.production_adjustment >= 0.9 ? 'green' : calibResult.production_adjustment >= 0.8 ? 'yellow' : 'red'}
                />
                <MetricCard
                  label="Efficiency Factor"
                  value={calibResult.realized_efficiency_factor.toFixed(4)}
                  sub="realized vs model"
                />
              </div>

              {/* Comparison Chart */}
              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Predicted vs Actual BTC</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={calibResult.monthly_comparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="predicted_btc" fill="#4ade80" name="Predicted" />
                    <Bar dataKey="actual_btc" fill="#22c55e" name="Actual" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <DataTable
                title="Monthly Comparison"
                columns={[
                  { key: 'month', label: 'Month' },
                  { key: 'predicted_btc', label: 'Predicted BTC' },
                  { key: 'actual_btc', label: 'Actual BTC' },
                  { key: 'variance_pct', label: 'Variance %', format: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%` },
                  { key: 'actual_uptime', label: 'Actual Uptime', format: (v: number) => formatPercent(v) },
                ]}
                rows={calibResult.monthly_comparison}
                exportName={`ops-calibration-${calibResult.id}`}
              />
            </>
          )}

          {!calibResult && !running && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              Import historical data and select calibration inputs, then click "Run Simulation".
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
