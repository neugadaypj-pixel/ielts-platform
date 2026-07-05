"""
SuperAdmin API — center management and system-wide operations.
Only the SuperAdmin role may access these endpoints.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import RoleChecker
from app.core.database import get_database
from app.core.security import hash_password
from app.models.center import CenterCreate, CenterResponse

logger = logging.getLogger(__name__)

router = APIRouter()

require_superadmin = RoleChecker(["superadmin"])


@router.post("/centers", response_model=CenterResponse, status_code=status.HTTP_201_CREATED)
async def create_center(
    data: CenterCreate,
    current_user: dict = Depends(require_superadmin),
):
    """
    SuperAdmin creates a new course center along with its Admin user.

    This is the top of the hierarchy: SuperAdmin -> Center + Admin.
    """
    db = get_database()

    existing_center = await db.centers.find_one({"name": data.name})
    if existing_center:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Center '{data.name}' already exists.",
        )

    existing_user = await db.users.find_one({"username": data.admin_username})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{data.admin_username}' is already taken.",
        )

    admin_doc = {
        "username": data.admin_username,
        "password_hash": hash_password(data.admin_password),
        "role": "admin",
        "center_id": None,
        "group_id": None,
        "full_name": data.admin_full_name,
        "contact": data.admin_contact,
        "created_at": datetime.now(timezone.utc),
    }
    admin_result = await db.users.insert_one(admin_doc)
    admin_id = admin_result.inserted_id
    logger.info("Admin user '%s' created (_id=%s).", data.admin_username, admin_id)

    center_doc = {
        "name": data.name,
        "admin_id": admin_id,
        "created_at": datetime.now(timezone.utc),
    }
    center_result = await db.centers.insert_one(center_doc)
    center_id = center_result.inserted_id

    await db.users.update_one(
        {"_id": admin_id},
        {"$set": {"center_id": center_id}},
    )

    logger.info("Center '%s' created (_id=%s) with Admin '%s'.", data.name, center_id, data.admin_username)

    return CenterResponse(
        id=str(center_id),
        name=data.name,
        admin_id=str(admin_id),
        created_at=center_doc["created_at"],
    )


@router.get("/centers", response_model=list[CenterResponse])
async def list_centers(current_user: dict = Depends(require_superadmin)):
    """List all course centers. SuperAdmin only."""
    db = get_database()
    centers = []
    async for doc in db.centers.find():
        centers.append(
            CenterResponse(
                _id=str(doc["_id"]),
                name=doc["name"],
                admin_id=str(doc["admin_id"]),
                created_at=doc.get("created_at", datetime.now(timezone.utc)),
            )
        )
    return centers
