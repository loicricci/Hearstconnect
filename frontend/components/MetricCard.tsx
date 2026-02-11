'use client';

import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  status?: 'green' | 'yellow' | 'red' | 'neutral';
}

const statusColors = {
  green: 'border-hearst-accent/30 bg-hearst-accent/5',
  yellow: 'border-yellow-700/40 bg-yellow-900/10',
  red: 'border-red-700/40 bg-red-900/10',
  neutral: 'border-hearst-border bg-hearst-card',
};

const statusDot = {
  green: 'bg-hearst-accent',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  neutral: 'bg-neutral-600',
};

export default function MetricCard({ label, value, sub, status = 'neutral' }: MetricCardProps) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${statusColors[status]}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${statusDot[status]}`} />
        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-semibold text-white font-mono">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}
