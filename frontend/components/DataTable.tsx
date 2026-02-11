'use client';

import React from 'react';
import { exportAsCSV, exportAsJSON } from '@/lib/utils';

interface DataTableProps {
  columns: { key: string; label: string; format?: (v: any) => string }[];
  rows: Record<string, any>[];
  title?: string;
  maxHeight?: string;
  exportName?: string;
}

export default function DataTable({
  columns,
  rows,
  title,
  maxHeight = '400px',
  exportName = 'export',
}: DataTableProps) {
  return (
    <div className="border border-hearst-border rounded-xl overflow-hidden">
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-hearst-card border-b border-hearst-border">
          <span className="text-xs font-medium text-neutral-400">{title}</span>
          <div className="flex gap-3">
            <button
              className="text-[11px] text-neutral-500 hover:text-hearst-accent transition-colors"
              onClick={() => exportAsCSV(rows, `${exportName}.csv`)}
            >
              CSV
            </button>
            <button
              className="text-[11px] text-neutral-500 hover:text-hearst-accent transition-colors"
              onClick={() => exportAsJSON(rows, `${exportName}.json`)}
            >
              JSON
            </button>
          </div>
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col.key}>
                    {col.format ? col.format(row[col.key]) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
