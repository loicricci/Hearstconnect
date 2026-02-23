"""Hearst Connect — FastAPI backend entry point."""
import os
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import create_db_and_tables
from .auth import get_current_user
from .routers import btc_price_curve, network_curve, miners, hosting, product_config

SUPABASE_URL = os.getenv("SUPABASE_URL", "")


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
    allow_origins=[
        "http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000",
        "https://hearstconnect.vercel.app",
        "https://hearstconnect-git-main-loic-riccis-projects.vercel.app",
        "https://hearstconnect-dye7bfcfx-loic-riccis-projects.vercel.app",
        SUPABASE_URL,
    ],
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
async def get_current_user_info(user: dict = Depends(get_current_user)):
    """Return authenticated user info from Supabase JWT."""
    return user
