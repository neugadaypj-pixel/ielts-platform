"""
Admin API — teacher and group management within the Admin's own center.
Only the Admin role may access these endpoints.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import RoleChecker
from app.core.database import get_database
from app.core.security import hash_password
from app.models.center import GroupCreate, GroupResponse, TeacherCreate
from app.models.user import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()

require_admin = RoleChecker(["admin"])
require_admin_or_superadmin = RoleChecker(["superadmin", "admin"])


@router.post("/teachers", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_teacher(
    data: TeacherCreate,
    current_user: dict = Depends(require_admin),
):
    """Admin creates a Teacher within their own center."""
    db = get_database()
    admin_center_id = current_user.get("center_id")

    if not admin_center_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin is not associated with any center.")

    existing = await db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Username '{data.username}' is already taken.")

    teacher_doc = {
        "username": data.username,
        "password_hash": hash_password(data.password),
        "role": "teacher",
        "center_id": ObjectId(admin_center_id),
        "group_id": None,
        "full_name": data.full_name,
        "contact": data.contact,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(teacher_doc)

    logger.info("Teacher '%s' created by Admin '%s'.", data.username, current_user.get("username"))

    return UserResponse(
        _id=str(result.inserted_id),
        username=data.username,
        full_name=data.full_name,
        contact=data.contact,
        role="teacher",
        center_id=admin_center_id,
        group_id=None,
        created_at=teacher_doc["created_at"],
    )


@router.get("/teachers", response_model=list[UserResponse])
async def list_teachers(current_user: dict = Depends(require_admin)):
    """List all teachers in the Admin's center."""
    db = get_database()
    admin_center_id = current_user.get("center_id")

    teachers = []
    async for doc in db.users.find({"role": "teacher", "center_id": ObjectId(admin_center_id)}):
        teachers.append(
            UserResponse(
                _id=str(doc["_id"]),
                username=doc["username"],
                full_name=doc.get("full_name", ""),
                contact=doc.get("contact"),
                role=doc["role"],
                center_id=str(doc["center_id"]) if doc.get("center_id") else None,
                group_id=str(doc["group_id"]) if doc.get("group_id") else None,
                created_at=doc.get("created_at", datetime.now(timezone.utc)),
            )
        )
    return teachers


@router.post("/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    data: GroupCreate,
    current_user: dict = Depends(require_admin),
):
    """Admin creates a new group within their center."""
    db = get_database()
    admin_center_id = current_user.get("center_id")

    if data.center_id != admin_center_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only create groups within your own center.")

    group_doc = {
        "name": data.name,
        "center_id": ObjectId(data.center_id),
        "teacher_id": None,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.groups.insert_one(group_doc)

    logger.info("Group '%s' created by Admin '%s'.", data.name, current_user.get("username"))

    return GroupResponse(
        id=str(result.inserted_id),
        name=data.name,
        center_id=data.center_id,
        teacher_id=None,
        created_at=group_doc["created_at"],
    )


@router.get("/groups", response_model=list[GroupResponse])
async def list_groups(
    current_user: dict = Depends(require_admin_or_superadmin),
    center_id: str = Query(None, description="Filter by center (used by SuperAdmin or cross-center queries)"),
):
    """
    List groups. Admin sees their own center's groups.
    SuperAdmin can list all groups or filter by center_id.
    """
    db = get_database()
    role = current_user.get("role")

    if role == "superadmin":
        query: dict = {}
        if center_id:
            query["center_id"] = ObjectId(center_id)
    else:
        admin_center_id = current_user.get("center_id")
        if not admin_center_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin is not associated with any center.")
        query = {"center_id": ObjectId(admin_center_id)}

    groups = []
    async for doc in db.groups.find(query):
        groups.append(
            GroupResponse(
                _id=str(doc["_id"]),
                name=doc["name"],
                center_id=str(doc["center_id"]),
                teacher_id=str(doc["teacher_id"]) if doc.get("teacher_id") else None,
                created_at=doc.get("created_at", datetime.now(timezone.utc)),
            )
        )
    return groups
