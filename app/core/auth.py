"""
Authentication dependencies and role-based access control (RBAC) middleware.
"""

from typing import List

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import decode_access_token

# HTTP Bearer token scheme
bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Validate JWT token and return the current user's payload.

    This is the base dependency used by all protected endpoints.
    The returned dict contains: sub (user_id), role, center_id, group_id.
    """
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


class RoleChecker:
    """
    FastAPI dependency that checks whether the authenticated user
    has one of the allowed roles.

    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(user=Depends(RoleChecker(["superadmin", "admin"]))):
            ...
    """

    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    async def __call__(
        self,
        current_user: dict = Depends(get_current_user),
    ) -> dict:
        role = current_user.get("role")
        if role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' is not permitted. Allowed: {self.allowed_roles}",
            )
        return current_user
