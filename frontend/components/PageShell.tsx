'use client';

import React from 'react';

interface PageShellProps {
  title: string;
  subtitle?: string;
  runId?: string;
  lastRunAt?: string;
  warnings?: string[];
  hardBlocks?: string[];
  onRun?: () => void;
  running?: boolean;
  children: React.ReactNode;
}

export default function PageShell({
  title,
  subtitle,
  runId,
  lastRunAt,
  warnings = [],
  hardBlocks = [],
  onRun,
  running = false,
  children,
}: PageShellProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hearst-border bg-hearst-card/50">
        <div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          {runId && (
            <span className="text-[10px] font-mono text-neutral-600">
              Run: {runId.slice(0, 8)}...
            </span>
          )}
          {lastRunAt && (
            <span className="text-[10px] text-neutral-600">
              {new Date(lastRunAt).toLocaleString()}
            </span>
          )}
          {onRun && (
            <button
              onClick={onRun}
              disabled={running}
              className="btn-primary flex items-center gap-2"
            >
              {running ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Running...
                </>
              ) : (
                'Run Simulation'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Warnings & Blocks */}
      {hardBlocks.length > 0 && (
        <div className="mx-6 mt-3 p-3 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-300">
          <strong className="text-red-400">HARD BLOCK:</strong>
          <ul className="mt-1 ml-4 list-disc">
            {hardBlocks.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mx-6 mt-3 p-3 bg-yellow-900/15 border border-yellow-800/30 rounded-lg text-xs text-yellow-300">
          <strong className="text-yellow-400">WARNINGS:</strong>
          <ul className="mt-1 ml-4 list-disc">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  );
}
