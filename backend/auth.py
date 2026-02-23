"""Supabase JWT authentication and role-based access control."""
import logging
import os
import httpx
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError
from typing import Optional

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
ALLOWED_EMAIL_DOMAIN = os.getenv("ALLOWED_EMAIL_DOMAIN", "hearst.com")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

ROLES = {
    "admin": {"read", "write", "simulate", "delete"},
    "risk": {"read", "simulate"},
    "readonly": {"read"},
}

_jwks_cache: Optional[dict] = None
security = HTTPBearer(auto_error=False)


async def _get_jwks() -> dict:
    """Fetch and cache the Supabase JWKS for JWT verification."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_url)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


def _decode_token_with_secret(token: str) -> dict:
    """Decode JWT using the Supabase JWT secret (HS256)."""
    return jwt.decode(
        token,
        SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience="authenticated",
    )


async def _decode_token_with_jwks(token: str) -> dict:
    """Decode JWT using Supabase JWKS (supports RS256 and ES256)."""
    jwks = await _get_jwks()
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    alg = unverified_header.get("alg", "RS256")
    key = None
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            key = k
            break
    if key is None:
        raise JWTError(f"No matching key found in JWKS for kid={kid}")
    return jwt.decode(
        token,
        key,
        algorithms=[alg],
        audience="authenticated",
    )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Verify Supabase JWT and return user dict compatible with existing routers."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    token = credentials.credentials
    token_alg = jwt.get_unverified_header(token).get("alg", "")
    try:
        if SUPABASE_JWT_SECRET and token_alg == "HS256":
            payload = _decode_token_with_secret(token)
        else:
            payload = await _decode_token_with_jwks(token)
    except JWTError as e:
        logger.warning("JWT verification failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
        )
    except Exception as e:
        logger.error("Unexpected auth error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )

    email = payload.get("email", "")
    domain = email.split("@")[1] if "@" in email else ""
    if domain != ALLOWED_EMAIL_DOMAIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access restricted to @{ALLOWED_EMAIL_DOMAIN} accounts",
        )

    user_metadata = payload.get("user_metadata", {})
    app_metadata = payload.get("app_metadata", {})
    role = app_metadata.get("role", "admin")

    return {
        "user_id": payload.get("sub", ""),
        "email": email,
        "role": role,
        "name": user_metadata.get("full_name") or user_metadata.get("name") or email,
        "permissions": list(ROLES.get(role, ROLES["admin"])),
    }


def require_permission(user: dict, permission: str):
    """Check if user role has required permission."""
    role = user.get("role", "readonly")
    allowed = ROLES.get(role, set())
    if permission not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{role}' does not have '{permission}' permission",
        )
