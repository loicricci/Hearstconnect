# Hearst Connect

Institutional-grade Bitcoin mining analytics platform. Deterministic simulation engine for BTC price curves, network economics, miner fleet management, hosting allocation, operational calibration, and structured financial product performance analysis.

## Architecture

```
hearst-connect/
├── backend/               # FastAPI (Python)
│   ├── main.py            # App entry, CORS, router registration
│   ├── database.py        # Postgres connection (SQLAlchemy)
│   ├── models.py          # SQLModel table definitions
│   ├── schemas.py         # Pydantic request/response schemas
│   ├── auth.py            # Role-based access control (mock)
│   ├── seed.py            # Seed data (2 miners, 2 sites, 6mo ops)
│   ├── engine/            # Deterministic computation modules
│   │   ├── btc_price.py   # BTC price curve generation
│   │   ├── network.py     # Difficulty, hashprice, fee curves
│   │   ├── miner_sim.py   # Per-miner monthly cashflow simulation
│   │   ├── hosting_alloc.py  # Hosting allocation & blending
│   │   ├── ops_calibration.py # Model vs reality calibration
│   │   └── product_waterfall.py # Capital protection waterfall
│   └── routers/           # API route handlers
│       ├── btc_price_curve.py
│       ├── network_curve.py
│       ├── miners.py
│       ├── hosting.py
│       ├── ops.py
│       └── product.py
├── frontend/              # Next.js (TypeScript, React)
│   ├── app/
│   │   ├── layout.tsx     # Root layout
│   │   └── hearst-connect/
│   │       ├── layout.tsx # Navigation sidebar
│   │       ├── btc-price-curve/page.tsx
│   │       ├── network-curve/page.tsx
│   │       ├── miner-catalog/page.tsx
│   │       ├── hosting/page.tsx
│   │       ├── ops-performance/page.tsx
│   │       └── product-performance/page.tsx
│   ├── components/        # Shared UI components
│   │   ├── PageShell.tsx
│   │   ├── DataTable.tsx
│   │   ├── InputField.tsx
│   │   ├── SelectField.tsx
│   │   └── MetricCard.tsx
│   └── lib/
│       ├── api.ts         # API client
│       └── utils.ts       # Formatting, export helpers
└── docker-compose.yml
```

## Pages

| # | Route | Purpose |
|---|-------|---------|
| 1 | `/hearst-connect/btc-price-curve` | 10-year monthly BTC price simulation with anchors |
| 2 | `/hearst-connect/network-curve` | Difficulty, hashprice, and fee regime curves |
| 3 | `/hearst-connect/miner-catalog` | CRUD miners + per-unit economics simulation |
| 4 | `/hearst-connect/hosting` | Hosting sites CRUD + miner allocation |
| 5 | `/hearst-connect/ops-performance` | Model calibration against historical data |
| 6 | `/hearst-connect/product-performance` | 36-month financial product waterfall |

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+ (or use Docker)

### 1. Start Postgres

```bash
# Option A: Docker
docker run -d --name hearst-pg -e POSTGRES_DB=hearst_connect \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16-alpine

# Option B: Use docker-compose (starts everything)
docker-compose up -d db
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
python -m backend.seed        # Seed database
uvicorn backend.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Quick Start (Docker Compose)

```bash
docker-compose up --build
```

Frontend: http://localhost:3000  
Backend API: http://localhost:8000/docs

## Auth (Mock)

Role-based access is enforced at both API and route level:

| Role | Permissions |
|------|------------|
| `admin` | read, write, simulate, delete |
| `risk` | read, simulate |
| `readonly` | read |

Pass `X-User-Id` header with one of: `admin-user`, `risk-user`, `reader-user`, `system` (default).

## Audit Trail

Every simulation run creates an immutable record with:
- **Input snapshot** (full JSON of all parameters)
- **Timestamp** (server UTC)
- **User** (who triggered the run)
- **Outputs** (computed results)
- **Warnings/flags** (any risk signals)

Run IDs and timestamps are displayed in the UI header of each page.

## Key Design Decisions

1. **Deterministic only** — no ML, no stochastic models. Pseudo-noise uses seeded deterministic generator.
2. **Conservative valuation** — `P_conservative = min(spot, MA30) * (1 - haircut)` for all risk calculations.
3. **Capital protection waterfall** — OPEX → Principal Floor → Replacement Reserve → Yield (capped) → Buffers.
4. **Never advance treasury** — no borrowing, no liquidity mismatch.
5. **Halving-aware** — subsidy schedule encoded through 2036.

## API Documentation

FastAPI auto-generates OpenAPI docs at `http://localhost:8000/docs`.

## Future Work (Stubbed)

- [ ] External price feed integration (spot oracle)
- [ ] DeFi Saver integration
- [ ] Multi-tenant deployment
- [ ] PDF report generation
- [ ] Real-time WebSocket updates
