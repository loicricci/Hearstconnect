'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { minersApi, btcPriceCurveApi, networkCurveApi } from '@/lib/api';
import { formatUSD, formatBTC, formatNumber } from '@/lib/utils';

export default function MinerCatalogPage() {
  // Miners list
  const [miners, setMiners] = useState<any[]>([]);
  const [selectedMiner, setSelectedMiner] = useState<string>('');

  // Miner form (create & edit)
  const [showForm, setShowForm] = useState(false);
  const [editingMinerId, setEditingMinerId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formHashrate, setFormHashrate] = useState(200);
  const [formPower, setFormPower] = useState(3500);
  const [formPrice, setFormPrice] = useState(5800);
  const [formLifetime, setFormLifetime] = useState(36);
  const [formMaintenance, setFormMaintenance] = useState(0.02);

  // Simulation inputs
  const [curves, setCurves] = useState<any[]>([]);
  const [networkCurves, setNetworkCurves] = useState<any[]>([]);
  const [selectedBTCCurve, setSelectedBTCCurve] = useState('');
  const [selectedNetCurve, setSelectedNetCurve] = useState('');
  const [elecRate, setElecRate] = useState(0.065);
  const [uptime, setUptime] = useState(0.95);
  const [simMonths, setSimMonths] = useState(36);

  const [simResult, setSimResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMiners();
    loadCurves();
  }, []);

  const loadMiners = async () => {
    try {
      const data: any = await minersApi.list();
      setMiners(data);
      if (data.length > 0 && !selectedMiner) setSelectedMiner(data[0].id);
    } catch (e) { /* API not available yet */ }
  };

  const loadCurves = async () => {
    try {
      const btc: any = await btcPriceCurveApi.list();
      const net: any = await networkCurveApi.list();
      setCurves(btc);
      setNetworkCurves(net);
      if (btc.length > 0) setSelectedBTCCurve(btc[0].id);
      if (net.length > 0) setSelectedNetCurve(net[0].id);
    } catch (e) { /* API not available yet */ }
  };

  const resetForm = () => {
    setFormName('');
    setFormHashrate(200);
    setFormPower(3500);
    setFormPrice(5800);
    setFormLifetime(36);
    setFormMaintenance(0.02);
    setEditingMinerId(null);
  };

  const openEditForm = (miner: any) => {
    setEditingMinerId(miner.id);
    setFormName(miner.name);
    setFormHashrate(miner.hashrate_th);
    setFormPower(miner.power_w);
    setFormPrice(miner.price_usd);
    setFormLifetime(miner.lifetime_months);
    setFormMaintenance(miner.maintenance_pct);
    setShowForm(true);
  };

  const saveMiner = async () => {
    try {
      const payload = {
        name: formName, hashrate_th: formHashrate, power_w: formPower,
        price_usd: formPrice, lifetime_months: formLifetime, maintenance_pct: formMaintenance,
      };
      if (editingMinerId) {
        await minersApi.update(editingMinerId, payload);
      } else {
        await minersApi.create(payload);
      }
      setShowForm(false);
      resetForm();
      loadMiners();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteMiner = async (id: string) => {
    try {
      await minersApi.delete(id);
      loadMiners();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const runSimulation = async () => {
    if (!selectedMiner || !selectedBTCCurve || !selectedNetCurve) {
      setError('Select a miner, BTC price curve, and network curve first.');
      return;
    }
    setRunning(true);
    setError('');
    try {
      const res = await minersApi.simulate({
        miner_id: selectedMiner,
        btc_price_curve_id: selectedBTCCurve,
        network_curve_id: selectedNetCurve,
        electricity_rate: elecRate,
        uptime,
        months: simMonths,
      });
      setSimResult(res);
    } catch (e: any) {
      setError(e.message);
    }
    setRunning(false);
  };

  const currentMiner = miners.find(m => m.id === selectedMiner);

  return (
    <PageShell
      title="Miner Catalog"
      subtitle="Manage miner SKUs and simulate per-unit economics"
      runId={simResult?.id}
      lastRunAt={simResult?.created_at}
      onRun={runSimulation}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="col-span-4 space-y-4">
          {/* Miner List */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Miners</h3>
              <button className="btn-secondary text-[10px]" onClick={() => {
                if (showForm) { setShowForm(false); resetForm(); } else { resetForm(); setShowForm(true); }
              }}>
                {showForm ? 'Cancel' : '+ Add Miner'}
              </button>
            </div>

            {showForm && (
              <div className="space-y-2 border border-hearst-border-light rounded p-3 bg-hearst-surface">
                <p className="text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">
                  {editingMinerId ? 'Edit Miner' : 'New Miner'}
                </p>
                <InputField label="Name" value={formName} onChange={setFormName} />
                <InputField label="Hashrate (TH/s)" value={formHashrate} onChange={v => setFormHashrate(Number(v))} type="number" />
                <InputField label="Power (W)" value={formPower} onChange={v => setFormPower(Number(v))} type="number" />
                <InputField label="Price (USD)" value={formPrice} onChange={v => setFormPrice(Number(v))} type="number" />
                <InputField label="Lifetime (months)" value={formLifetime} onChange={v => setFormLifetime(Number(v))} type="number" />
                <InputField label="Maintenance %" value={formMaintenance} onChange={v => setFormMaintenance(Number(v))} type="number" step={0.01} />
                <button className="btn-primary w-full" onClick={saveMiner}>
                  {editingMinerId ? 'Save Changes' : 'Create Miner'}
                </button>
              </div>
            )}

            <div className="space-y-1 max-h-[200px] overflow-auto">
              {miners.map(m => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs ${
                    selectedMiner === m.id ? 'bg-hearst-accent/20 text-hearst-accent' : 'text-neutral-400 hover:bg-hearst-card'
                  }`}
                  onClick={() => setSelectedMiner(m.id)}
                >
                  <div>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-neutral-600 ml-2">{m.hashrate_th} TH/s · {m.power_w}W</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-hearst-accent/60 hover:text-hearst-accent text-[10px]"
                      onClick={e => { e.stopPropagation(); openEditForm(m); }}
                    >
                      EDIT
                    </button>
                    <button
                      className="text-red-400/60 hover:text-red-400 text-[10px]"
                      onClick={e => { e.stopPropagation(); deleteMiner(m.id); }}
                    >
                      DEL
                    </button>
                  </div>
                </div>
              ))}
              {miners.length === 0 && <p className="text-[10px] text-neutral-600">No miners. Add one or start the backend with seed data.</p>}
            </div>
          </div>

          {/* Miner Details */}
          {currentMiner && (
            <div className="border border-hearst-border rounded p-4 space-y-2">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Selected: {currentMiner.name}</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-neutral-500">Hashrate</div><div className="font-mono">{currentMiner.hashrate_th} TH/s</div>
                <div className="text-neutral-500">Power</div><div className="font-mono">{currentMiner.power_w} W</div>
                <div className="text-neutral-500">Price</div><div className="font-mono">{formatUSD(currentMiner.price_usd)}</div>
                <div className="text-neutral-500">Efficiency</div><div className="font-mono">{currentMiner.efficiency_j_th?.toFixed(1)} J/TH</div>
                <div className="text-neutral-500">Lifetime</div><div className="font-mono">{currentMiner.lifetime_months} mo</div>
              </div>
            </div>
          )}

          {/* Simulation Settings */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Simulation Settings</h3>
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
            <InputField label="Electricity Rate ($/kWh)" value={elecRate} onChange={v => setElecRate(Number(v))} type="number" step={0.005} />
            <InputField label="Uptime (0-1)" value={uptime} onChange={v => setUptime(Number(v))} type="number" step={0.01} min={0} max={1} />
            <InputField label="Simulation Months" value={simMonths} onChange={v => setSimMonths(Number(v))} type="number" min={1} max={120} />
          </div>
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-8 space-y-4">
          {simResult && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Total BTC Mined" value={formatBTC(simResult.total_btc_mined)} />
                <MetricCard label="Total Revenue" value={formatUSD(simResult.total_revenue_usd)} status="green" />
                <MetricCard label="Total Elec Cost" value={formatUSD(simResult.total_electricity_cost_usd)} status="yellow" />
                <MetricCard
                  label="Break-Even"
                  value={simResult.break_even_month !== null ? `Month ${simResult.break_even_month}` : 'N/A'}
                  status={simResult.break_even_month !== null ? 'green' : 'red'}
                />
              </div>

              <div className="border border-hearst-border rounded p-4">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Cumulative Net USD</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={simResult.monthly_cashflows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                    <Line type="monotone" dataKey="cumulative_net_usd" stroke="#4ade80" strokeWidth={1.5} dot={false} name="Cumulative Net USD" />
                    <Line type="monotone" dataKey="net_usd" stroke="#22c55e" strokeWidth={1} dot={false} name="Monthly Net USD" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <DataTable
                title="Monthly Cashflows"
                columns={[
                  { key: 'month', label: 'Month' },
                  { key: 'btc_mined', label: 'BTC Mined' },
                  { key: 'btc_price_usd', label: 'BTC Price', format: (v: number) => formatUSD(v) },
                  { key: 'gross_revenue_usd', label: 'Revenue', format: (v: number) => formatUSD(v) },
                  { key: 'elec_cost_usd', label: 'Elec Cost', format: (v: number) => formatUSD(v) },
                  { key: 'maintenance_usd', label: 'Maint.', format: (v: number) => formatUSD(v) },
                  { key: 'depreciation_usd', label: 'Depr.', format: (v: number) => formatUSD(v) },
                  { key: 'net_usd', label: 'Net USD', format: (v: number) => formatUSD(v) },
                ]}
                rows={simResult.monthly_cashflows}
                exportName={`miner-sim-${simResult.id}`}
                maxHeight="300px"
              />
            </>
          )}

          {!simResult && !running && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              Select a miner and curves, then click "Run Simulation".
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
