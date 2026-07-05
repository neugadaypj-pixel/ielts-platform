"""
Authentication API endpoints: login and token refresh.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_database
from app.core.security import create_access_token, verify_password
from app.models.user import LoginRequest, TokenResponse, UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    """
    Authenticate a user and return a JWT access token.

    The token payload contains:
        - sub: user's _id as string
        - role: user's role
        - center_id: user's center (for scoping)
        - group_id: user's group (for scoping)
    """
    db = get_database()

    # Find user by username
    user_doc = await db.users.find_one({"username": request.username})

    if not user_doc:
        logger.warning("Login failed: unknown username '%s'", request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    # Verify password
    if not verify_password(request.password, user_doc["password_hash"]):
        logger.warning("Login failed: wrong password for username '%s'", request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    # Build JWT payload with scoping fields
    token_data = {
        "sub": str(user_doc["_id"]),
        "role": user_doc["role"],
        "center_id": str(user_doc["center_id"]) if user_doc.get("center_id") else None,
        "group_id": str(user_doc["group_id"]) if user_doc.get("group_id") else None,
        "username": user_doc["username"],
    }

    access_token = create_access_token(token_data)

    logger.info(
        "User '%s' (role=%s) logged in successfully.",
        request.username,
        user_doc["role"],
    )

    return TokenResponse(
        access_token=access_token,
        role=user_doc["role"],
        username=user_doc["username"],
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Return the currently authenticated user's profile.
    Requires a valid JWT token.
    """
    db = get_database()

    from bson import ObjectId

    user_doc = await db.users.find_one({"_id": ObjectId(current_user["sub"])})

    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    return UserResponse(
        _id=str(user_doc["_id"]),
        username=user_doc["username"],
        full_name=user_doc.get("full_name", ""),
        contact=user_doc.get("contact"),
        role=user_doc["role"],
        center_id=str(user_doc["center_id"]) if user_doc.get("center_id") else None,
        group_id=str(user_doc["group_id"]) if user_doc.get("group_id") else None,
        created_at=user_doc.get("created_at", datetime.utcnow()),
    )
