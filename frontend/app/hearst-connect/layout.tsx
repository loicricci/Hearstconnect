'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

const NAV_ITEMS = [
  { href: '/hearst-connect/btc-price-curve', label: 'BTC Price Curve', short: '1' },
  { href: '/hearst-connect/network-curve', label: 'Network Curve', short: '2' },
  { href: '/hearst-connect/miners-hosting', label: 'Miners & Hosting', short: '3' },
  { href: '/hearst-connect/product-config', label: 'Product Config', short: '4' },
  { href: '/hearst-connect/results', label: 'Results', short: '5' },
];

export default function HearstConnectLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-hearst-card border-r border-hearst-border flex flex-col">
        <div className="px-4 py-4 border-b border-hearst-border flex flex-col items-start gap-2">
          <Image
            src="/hearst-logo.png"
            alt="Hearst"
            width={120}
            height={32}
            className="object-contain mix-blend-lighten"
            priority
          />
          <p className="text-[10px] text-neutral-600">Mining Analytics Platform</p>
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
        <div className="px-4 py-3 border-t border-hearst-border space-y-2">
          {user && (
            <div className="truncate text-[10px] text-neutral-400" title={user.email ?? ''}>
              {user.email}
            </div>
          )}
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[11px] font-medium text-neutral-400 bg-hearst-surface border border-hearst-border hover:text-hearst-danger hover:border-hearst-danger/40 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
          <div className="text-[10px] text-neutral-600 text-center">v1.0.0</div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
