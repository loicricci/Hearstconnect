'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/hearst-connect/btc-price-curve', label: 'BTC Price Curve', short: '1' },
  { href: '/hearst-connect/network-curve', label: 'Network Curve', short: '2' },
  { href: '/hearst-connect/miners-hosting', label: 'Miners & Hosting', short: '3' },
  { href: '/hearst-connect/product-config', label: 'Product Config', short: '4' },
  { href: '/hearst-connect/results', label: 'Results', short: '5' },
];

export default function HearstConnectLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-hearst-card border-r border-hearst-border flex flex-col">
        <div className="px-4 py-4 border-b border-hearst-border">
          <h1 className="text-sm font-bold text-hearst-accent tracking-wide">HEARST CONNECT</h1>
          <p className="text-[10px] text-neutral-600 mt-0.5">Mining Analytics Platform</p>
        </div>
        <div className="flex-1 py-2 overflow-auto">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-4 py-2 text-xs transition-colors ${
                  isActive
                    ? 'bg-hearst-accent/10 text-hearst-accent border-r-2 border-hearst-accent'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-hearst-surface'
                }`}
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold ${
                  isActive ? 'bg-hearst-accent text-black' : 'bg-hearst-surface text-neutral-500'
                }`}>
                  {item.short}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-hearst-border text-[10px] text-neutral-600">
          <div>Role: Admin</div>
          <div>v1.0.0</div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
