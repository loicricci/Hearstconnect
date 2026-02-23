/**
 * API client for Hearst Connect backend.
 * All requests go through Next.js rewrite proxy -> FastAPI.
 */

const API_BASE = '/api';

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': 'system',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API Error: ${res.status}`);
  }

  return res.json();
}

// ── BTC Price Curve ─────────────────────────────────────
export const btcPriceCurveApi = {
  generate: (data: any) => request('/btc-price-curve/generate', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request('/btc-price-curve/list'),
  get: (id: string) => request(`/btc-price-curve/${id}`),
  delete: (id: string) => request(`/btc-price-curve/${id}`, { method: 'DELETE' }),
};

// ── Network Curve ───────────────────────────────────────
export const networkCurveApi = {
  generate: (data: any) => request('/network-curve/generate', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request('/network-curve/list'),
  get: (id: string) => request(`/network-curve/${id}`),
  delete: (id: string) => request(`/network-curve/${id}`, { method: 'DELETE' }),
};

// ── Miners ──────────────────────────────────────────────
export const minersApi = {
  create: (data: any) => request('/miners/', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request('/miners/'),
  get: (id: string) => request(`/miners/${id}`),
  update: (id: string, data: any) => request(`/miners/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/miners/${id}`, { method: 'DELETE' }),
  simulate: (data: any) => request('/miners/simulate', { method: 'POST', body: JSON.stringify(data) }),
};

// ── Hosting ─────────────────────────────────────────────
export const hostingApi = {
  create: (data: any) => request('/hosting/', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request('/hosting/'),
  get: (id: string) => request(`/hosting/${id}`),
  update: (id: string, data: any) => request(`/hosting/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request(`/hosting/${id}`, { method: 'DELETE' }),
  allocate: (data: any) => request('/hosting/allocate', { method: 'POST', body: JSON.stringify(data) }),
};

// ── Product Performance ─────────────────────────────────
export const productApi = {
  simulate3y: (data: any) => request('/product/simulate-3y', { method: 'POST', body: JSON.stringify(data) }),
  listRuns: () => request('/product/runs'),
  getRun: (id: string) => request(`/product/runs/${id}`),
};

// ── Ops Performance ─────────────────────────────────────
export const opsApi = {
  importHistory: (data: any) => request('/ops/import-history', { method: 'POST', body: JSON.stringify(data) }),
  history: () => request('/ops/history'),
  calibrate: (data: any) => request('/ops/calibrate', { method: 'POST', body: JSON.stringify(data) }),
  calibrationRuns: () => request('/ops/calibration-runs'),
};

// ── Product Configuration ────────────────────────────────
export const productConfigApi = {
  simulate: (data: any) => request('/product-config/simulate', { method: 'POST', body: JSON.stringify(data) }),
  listRuns: () => request('/product-config/runs'),
  getRun: (id: string) => request(`/product-config/runs/${id}`),
};
