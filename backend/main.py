"""Hearst Connect — FastAPI backend entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import create_db_and_tables
from .routers import btc_price_curve, network_curve, miners, hosting, product_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup."""
    create_db_and_tables()
    yield


app = FastAPI(
    title="Hearst Connect API",
    description="Institutional-grade Bitcoin mining analytics platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(btc_price_curve.router)
app.include_router(network_curve.router)
app.include_router(miners.router)
app.include_router(hosting.router)
app.include_router(product_config.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "hearst-connect-api", "version": "1.0.0"}


@app.get("/api/auth/me")
def get_current_user_info():
    """Return mock user info for the frontend."""
    return {
        "user_id": "system",
        "role": "admin",
        "name": "System Admin",
        "permissions": ["read", "write", "simulate", "delete"],
    }
