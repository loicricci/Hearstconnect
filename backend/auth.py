"""Role-based access control middleware (mock implementation)."""
from fastapi import Header, HTTPException
from typing import Optional


ROLES = {
    "admin": {"read", "write", "simulate", "delete"},
    "risk": {"read", "simulate"},
    "readonly": {"read"},
}

# Mock user database
MOCK_USERS = {
    "admin-user": {"user_id": "admin-user", "role": "admin", "name": "Admin User"},
    "risk-user": {"user_id": "risk-user", "role": "risk", "name": "Risk Analyst"},
    "reader-user": {"user_id": "reader-user", "role": "readonly", "name": "Read-Only User"},
    "system": {"user_id": "system", "role": "admin", "name": "System"},
}


def get_current_user(x_user_id: Optional[str] = Header(default="system")):
    """Extract current user from header (mock auth)."""
    user = MOCK_USERS.get(x_user_id)
    if not user:
        # Default to system for development
        return MOCK_USERS["system"]
    return user


def require_permission(user: dict, permission: str):
    """Check if user role has required permission."""
    role = user.get("role", "readonly")
    allowed = ROLES.get(role, set())
    if permission not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' does not have '{permission}' permission"
        )
