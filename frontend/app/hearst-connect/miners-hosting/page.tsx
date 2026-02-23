'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import SelectField from '@/components/SelectField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { minersApi, hostingApi, btcPriceCurveApi, networkCurveApi } from '@/lib/api';
import { formatUSD, formatBTC, formatNumber, formatPercent } from '@/lib/utils';

type TabKey = 'miners' | 'hosting';

export default function MinersHostingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('miners');

  // ── Shared State ──
  const [miners, setMiners] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [error, setError] = useState('');

  // ── Miner Tab State ──
  const [selectedMiner, setSelectedMiner] = useState<string>('');
  const [showMinerForm, setShowMinerForm] = useState(false);
  const [editingMinerId, setEditingMinerId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formHashrate, setFormHashrate] = useState(200);
  const [formPower, setFormPower] = useState(3500);
  const [formPrice, setFormPrice] = useState(5800);
  const [formLifetime, setFormLifetime] = useState(36);
  const [formMaintenance, setFormMaintenance] = useState(0.02);

  // Miner simulation
  const [curves, setCurves] = useState<any[]>([]);
  const [networkCurves, setNetworkCurves] = useState<any[]>([]);
  const [selectedBTCCurve, setSelectedBTCCurve] = useState('');
  const [selectedNetCurve, setSelectedNetCurve] = useState('');
  const [elecRate, setElecRate] = useState(0.065);
  const [uptime, setUptime] = useState(0.95);
  const [simMonths, setSimMonths] = useState(36);
  const [simResult, setSimResult] = useState<any>(null);
  const [minerRunning, setMinerRunning] = useState(false);

  // ── Hosting Tab State ──
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [siteFormName, setSiteFormName] = useState('');
  const [siteFormElecRate, setSiteFormElecRate] = useState(0.05);
  const [siteFormHostingFee, setSiteFormHostingFee] = useState(5.0);
  const [siteFormUptime, setSiteFormUptime] = useState(0.95);
  const [siteFormCurtailment, setSiteFormCurtailment] = useState(0.0);
  const [siteFormCapacity, setSiteFormCapacity] = useState(50);
  const [siteFormLockup, setSiteFormLockup] = useState(12);
  const [siteFormNotice, setSiteFormNotice] = useState(30);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [m, s, btc, net]: any[] = await Promise.all([
        minersApi.list(),
        hostingApi.list(),
        btcPriceCurveApi.list(),
        networkCurveApi.list(),
      ]);
      setMiners(m);
      setSites(s);
      setCurves(btc);
      setNetworkCurves(net);
      if (m.length > 0 && !selectedMiner) setSelectedMiner(m[0].id);
      if (btc.length > 0 && !selectedBTCCurve) setSelectedBTCCurve(btc[0].id);
      if (net.length > 0 && !selectedNetCurve) setSelectedNetCurve(net[0].id);
    } catch (e) { /* API not available yet */ }
  };

  // ── Miner CRUD ──
  const resetMinerForm = () => {
    setFormName('');
    setFormHashrate(200);
    setFormPower(3500);
    setFormPrice(5800);
    setFormLifetime(36);
    setFormMaintenance(0.02);
    setEditingMinerId(null);
  };

  const openEditMinerForm = (miner: any) => {
    setEditingMinerId(miner.id);
    setFormName(miner.name);
    setFormHashrate(miner.hashrate_th);
    setFormPower(miner.power_w);
    setFormPrice(miner.price_usd);
    setFormLifetime(miner.lifetime_months);
    setFormMaintenance(miner.maintenance_pct);
    setShowMinerForm(true);
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
      setShowMinerForm(false);
      resetMinerForm();
      loadAll();
    } catch (e: any) { setError(e.message); }
  };

  const deleteMiner = async (id: string) => {
    try { await minersApi.delete(id); loadAll(); } catch (e: any) { setError(e.message); }
  };

  const runMinerSim = async () => {
    if (!selectedMiner || !selectedBTCCurve || !selectedNetCurve) {
      setError('Select a miner, BTC price curve, and network curve first.');
      return;
    }
    setMinerRunning(true);
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
    } catch (e: any) { setError(e.message); }
    setMinerRunning(false);
  };

  // ── Hosting CRUD ──
  const createSite = async () => {
    try {
      await hostingApi.create({
        name: siteFormName,
        electricity_price_usd_per_kwh: siteFormElecRate,
        hosting_fee_usd_per_kw_month: siteFormHostingFee,
        uptime_expectation: siteFormUptime,
        curtailment_pct: siteFormCurtailment,
        capacity_mw_available: siteFormCapacity,
        lockup_months: siteFormLockup,
        notice_period_days: siteFormNotice,
      });
      setShowSiteForm(false);
      setSiteFormName('');
      loadAll();
    } catch (e: any) { setError(e.message); }
  };

  const deleteSite = async (id: string) => {
    try { await hostingApi.delete(id); loadAll(); } catch (e: any) { setError(e.message); }
  };

  const currentMiner = miners.find(m => m.id === selectedMiner);

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'miners', label: 'Miner Catalog' },
    { key: 'hosting', label: 'Hosting Sites' },
  ];

  return (
    <PageShell
      title="Miners & Hosting"
      subtitle="Manage miner SKUs and hosting sites"
      runId={simResult?.id}
      lastRunAt={simResult?.created_at}
      onRun={activeTab === 'miners' ? runMinerSim : undefined}
      running={minerRunning}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-hearst-border">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-hearst-accent text-hearst-accent'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════ TAB 1: MINER CATALOG ═══════════ */}
      {activeTab === 'miners' && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-4 space-y-4">
            {/* Miner List */}
            <div className="border border-hearst-border rounded p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Miners</h3>
                <button className="btn-secondary text-[10px]" onClick={() => {
                  if (showMinerForm) { setShowMinerForm(false); resetMinerForm(); } else { resetMinerForm(); setShowMinerForm(true); }
                }}>
                  {showMinerForm ? 'Cancel' : '+ Add Miner'}
                </button>
              </div>

              {showMinerForm && (
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
                        onClick={e => { e.stopPropagation(); openEditMinerForm(m); }}
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

          {/* Output Panel */}
          <div className="col-span-8 space-y-4">
            {simResult && (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="Total BTC Mined" value={formatBTC(simResult.total_btc_mined)} />
                  <MetricCard label="Total Revenue" value={formatUSD(simResult.total_revenue_usd)} status="green" />
                  <MetricCard label="Total Net (OpEx)" value={formatUSD(simResult.total_net_usd)} status={simResult.total_net_usd >= 0 ? 'green' : 'red'} />
                  <MetricCard label="Total EBIT" value={formatUSD(simResult.total_ebit_usd)} status={simResult.total_ebit_usd >= 0 ? 'green' : 'red'} />
                </div>

                <div className="border border-hearst-border rounded p-4">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">Cumulative Performance</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={simResult.monthly_cashflows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#737373' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333333', borderRadius: 4, fontSize: 11 }} />
                      <Line type="monotone" dataKey="cumulative_net_usd" stroke="#96EA7A" strokeWidth={1.5} dot={false} name="Cumulative Net (OpEx)" />
                      <Line type="monotone" dataKey="cumulative_ebit_usd" stroke="#6BD85A" strokeWidth={1.5} dot={false} name="Cumulative EBIT" />
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
                    { key: 'net_usd', label: 'Net USD', format: (v: number) => formatUSD(v) },
                    { key: 'depreciation_usd', label: 'Depr.', format: (v: number) => formatUSD(v) },
                    { key: 'ebit_usd', label: 'EBIT', format: (v: number) => formatUSD(v) },
                  ]}
                  rows={simResult.monthly_cashflows}
                  exportName={`miner-sim-${simResult.id}`}
                  maxHeight="300px"
                />
              </>
            )}

            {!simResult && !minerRunning && (
              <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
                Select a miner and curves, then click &quot;Run Simulation&quot;.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ TAB 2: HOSTING SITES ═══════════ */}
      {activeTab === 'hosting' && (
        <div className="space-y-4">
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Hosting Sites</h3>
              <button className="btn-secondary text-[10px]" onClick={() => setShowSiteForm(!showSiteForm)}>
                {showSiteForm ? 'Cancel' : '+ Add Site'}
              </button>
            </div>

            {showSiteForm && (
              <div className="space-y-2 border border-hearst-border-light rounded p-3 bg-hearst-surface max-w-lg">
                <InputField label="Name" value={siteFormName} onChange={setSiteFormName} />
                <InputField label="Electricity ($/kWh)" value={siteFormElecRate} onChange={v => setSiteFormElecRate(Number(v))} type="number" step={0.005} />
                <InputField label="Hosting Fee ($/kW/mo)" value={siteFormHostingFee} onChange={v => setSiteFormHostingFee(Number(v))} type="number" step={0.5} />
                <InputField label="Uptime (0-1)" value={siteFormUptime} onChange={v => setSiteFormUptime(Number(v))} type="number" step={0.01} />
                <InputField label="Curtailment %" value={siteFormCurtailment} onChange={v => setSiteFormCurtailment(Number(v))} type="number" step={0.01} />
                <InputField label="Capacity (MW)" value={siteFormCapacity} onChange={v => setSiteFormCapacity(Number(v))} type="number" />
                <InputField label="Lockup (months)" value={siteFormLockup} onChange={v => setSiteFormLockup(Number(v))} type="number" />
                <InputField label="Notice Period (days)" value={siteFormNotice} onChange={v => setSiteFormNotice(Number(v))} type="number" />
                <button className="btn-primary w-full" onClick={createSite}>Create Site</button>
              </div>
            )}

            <div className="overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>$/kWh</th>
                    <th>Hosting Fee</th>
                    <th>Uptime</th>
                    <th>Curtailment</th>
                    <th>Capacity</th>
                    <th>Lockup</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.name}</td>
                      <td>${s.electricity_price_usd_per_kwh}</td>
                      <td>${s.hosting_fee_usd_per_kw_month}/kW/mo</td>
                      <td>{formatPercent(s.uptime_expectation)}</td>
                      <td>{formatPercent(s.curtailment_pct)}</td>
                      <td>{s.capacity_mw_available} MW</td>
                      <td>{s.lockup_months} mo</td>
                      <td>
                        <button className="text-red-400/60 hover:text-red-400 text-[10px]" onClick={() => deleteSite(s.id)}>DEL</button>
                      </td>
                    </tr>
                  ))}
                  {sites.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-neutral-600">No hosting sites. Add one above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </PageShell>
  );
}
