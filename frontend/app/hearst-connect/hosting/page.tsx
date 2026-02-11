'use client';

import React, { useState, useEffect } from 'react';
import PageShell from '@/components/PageShell';
import InputField from '@/components/InputField';
import DataTable from '@/components/DataTable';
import MetricCard from '@/components/MetricCard';
import { hostingApi, minersApi } from '@/lib/api';
import { formatUSD, formatNumber, formatPercent } from '@/lib/utils';

export default function HostingPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [miners, setMiners] = useState<any[]>([]);

  // New site form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formElecRate, setFormElecRate] = useState(0.05);
  const [formHostingFee, setFormHostingFee] = useState(5.0);
  const [formUptime, setFormUptime] = useState(0.95);
  const [formCurtailment, setFormCurtailment] = useState(0.0);
  const [formCapacity, setFormCapacity] = useState(50);
  const [formLockup, setFormLockup] = useState(12);
  const [formNotice, setFormNotice] = useState(30);

  // Allocation builder
  const [allocations, setAllocations] = useState<{ site_id: string; miner_id: string; miner_count: number }[]>([]);
  const [allocResult, setAllocResult] = useState<any>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const s: any = await hostingApi.list();
      const m: any = await minersApi.list();
      setSites(s);
      setMiners(m);
    } catch (e) { /* API not available yet */ }
  };

  const createSite = async () => {
    try {
      await hostingApi.create({
        name: formName,
        electricity_price_usd_per_kwh: formElecRate,
        hosting_fee_usd_per_kw_month: formHostingFee,
        uptime_expectation: formUptime,
        curtailment_pct: formCurtailment,
        capacity_mw_available: formCapacity,
        lockup_months: formLockup,
        notice_period_days: formNotice,
      });
      setShowForm(false);
      loadData();
    } catch (e: any) { setError(e.message); }
  };

  const deleteSite = async (id: string) => {
    try { await hostingApi.delete(id); loadData(); } catch (e: any) { setError(e.message); }
  };

  const addAllocation = () => {
    if (sites.length === 0 || miners.length === 0) return;
    setAllocations([...allocations, { site_id: sites[0].id, miner_id: miners[0].id, miner_count: 100 }]);
  };

  const updateAllocation = (idx: number, field: string, value: any) => {
    const updated = [...allocations];
    (updated[idx] as any)[field] = value;
    setAllocations(updated);
  };

  const removeAllocation = (idx: number) => {
    setAllocations(allocations.filter((_, i) => i !== idx));
  };

  const runSimulation = async () => {
    if (allocations.length === 0) { setError('Add at least one allocation.'); return; }
    setRunning(true);
    setError('');
    try {
      const res = await hostingApi.allocate({ allocations });
      setAllocResult(res);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  return (
    <PageShell
      title="Hosting Opportunities"
      subtitle="Manage sites and allocate miners across facilities"
      runId={allocResult?.id}
      lastRunAt={allocResult?.created_at}
      warnings={allocResult?.warnings || []}
      onRun={runSimulation}
      running={running}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="col-span-5 space-y-4">
          {/* Sites List */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Hosting Sites</h3>
              <button className="btn-secondary text-[10px]" onClick={() => setShowForm(!showForm)}>
                {showForm ? 'Cancel' : '+ Add Site'}
              </button>
            </div>

            {showForm && (
              <div className="space-y-2 border border-hearst-border-light rounded p-3 bg-hearst-surface">
                <InputField label="Name" value={formName} onChange={setFormName} />
                <InputField label="Electricity ($/kWh)" value={formElecRate} onChange={v => setFormElecRate(Number(v))} type="number" step={0.005} />
                <InputField label="Hosting Fee ($/kW/mo)" value={formHostingFee} onChange={v => setFormHostingFee(Number(v))} type="number" step={0.5} />
                <InputField label="Uptime (0-1)" value={formUptime} onChange={v => setFormUptime(Number(v))} type="number" step={0.01} />
                <InputField label="Curtailment %" value={formCurtailment} onChange={v => setFormCurtailment(Number(v))} type="number" step={0.01} />
                <InputField label="Capacity (MW)" value={formCapacity} onChange={v => setFormCapacity(Number(v))} type="number" />
                <InputField label="Lockup (months)" value={formLockup} onChange={v => setFormLockup(Number(v))} type="number" />
                <InputField label="Notice Period (days)" value={formNotice} onChange={v => setFormNotice(Number(v))} type="number" />
                <button className="btn-primary w-full" onClick={createSite}>Create Site</button>
              </div>
            )}

            <div className="overflow-auto max-h-[200px]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>$/kWh</th><th>Uptime</th><th>MW</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.name}</td>
                      <td>${s.electricity_price_usd_per_kwh}</td>
                      <td>{formatPercent(s.uptime_expectation)}</td>
                      <td>{s.capacity_mw_available}</td>
                      <td>
                        <button className="text-red-400/60 hover:text-red-400 text-[10px]" onClick={() => deleteSite(s.id)}>DEL</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Allocation Builder */}
          <div className="border border-hearst-border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Allocation Builder</h3>
              <button className="btn-secondary text-[10px]" onClick={addAllocation}>+ Add Row</button>
            </div>
            <div className="space-y-2 max-h-[250px] overflow-auto">
              {allocations.map((alloc, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <select
                    value={alloc.site_id}
                    onChange={e => updateAllocation(idx, 'site_id', e.target.value)}
                    className="flex-1"
                  >
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select
                    value={alloc.miner_id}
                    onChange={e => updateAllocation(idx, 'miner_id', e.target.value)}
                    className="flex-1"
                  >
                    {miners.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input
                    type="number"
                    value={alloc.miner_count}
                    onChange={e => updateAllocation(idx, 'miner_count', Number(e.target.value))}
                    className="w-20"
                    min={1}
                  />
                  <button className="text-red-400/60 hover:text-red-400" onClick={() => removeAllocation(idx)}>×</button>
                </div>
              ))}
              {allocations.length === 0 && <p className="text-[10px] text-neutral-600">Add allocations to distribute miners across sites.</p>}
            </div>
          </div>
        </div>

        {/* ── OUTPUT PANEL ── */}
        <div className="col-span-7 space-y-4">
          {allocResult && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label="Blended Elec Rate"
                  value={`$${allocResult.blended_electricity_rate}/kWh`}
                />
                <MetricCard
                  label="Blended Uptime"
                  value={formatPercent(allocResult.blended_uptime)}
                  status={allocResult.blended_uptime >= 0.93 ? 'green' : 'yellow'}
                />
                <MetricCard
                  label="Total Power"
                  value={`${formatNumber(allocResult.total_power_kw, 0)} kW`}
                  sub={`${formatNumber(allocResult.total_power_kw / 1000, 2)} MW`}
                />
              </div>

              <DataTable
                title="Allocation Details"
                columns={[
                  { key: 'site_id', label: 'Site', format: (v: string) => sites.find(s => s.id === v)?.name || v.slice(0, 8) },
                  { key: 'miner_id', label: 'Miner', format: (v: string) => miners.find(m => m.id === v)?.name || v.slice(0, 8) },
                  { key: 'miner_count', label: 'Count' },
                ]}
                rows={allocResult.allocations}
                exportName={`hosting-alloc-${allocResult.id}`}
              />
            </>
          )}

          {!allocResult && !running && (
            <div className="flex items-center justify-center h-64 text-sm text-neutral-600">
              Add hosting sites and allocations, then click "Run Simulation".
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
