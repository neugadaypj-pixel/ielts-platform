"""
Teacher API — student management and group assignment.
Only the Teacher role may access these endpoints.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import RoleChecker
from app.core.database import get_database
from app.core.security import hash_password
from app.models.center import StudentCreate
from app.models.user import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()

require_teacher = RoleChecker(["teacher"])


@router.post("/students", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_student(
    data: StudentCreate,
    current_user: dict = Depends(require_teacher),
):
    """Teacher creates a Student assigned to a group."""
    db = get_database()
    teacher_center_id = current_user.get("center_id")

    if not teacher_center_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Teacher is not associated with any center.")

    group = await db.groups.find_one({
        "_id": ObjectId(data.group_id),
        "center_id": ObjectId(teacher_center_id),
    })
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found or does not belong to your center.")

    existing = await db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Username '{data.username}' is already taken.")

    student_doc = {
        "username": data.username,
        "password_hash": hash_password(data.password),
        "role": "student",
        "center_id": ObjectId(teacher_center_id),
        "group_id": ObjectId(data.group_id),
        "full_name": data.full_name,
        "contact": data.contact,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(student_doc)

    logger.info("Student '%s' created by Teacher '%s'.", data.username, current_user.get("username"))

    return UserResponse(
        _id=str(result.inserted_id),
        username=data.username,
        full_name=data.full_name,
        contact=data.contact,
        role="student",
        center_id=teacher_center_id,
        group_id=data.group_id,
        created_at=student_doc["created_at"],
    )


@router.get("/students", response_model=list[UserResponse])
async def list_students(current_user: dict = Depends(require_teacher)):
    """List all students in the Teacher's center."""
    db = get_database()
    teacher_center_id = current_user.get("center_id")

    students = []
    async for doc in db.users.find({"role": "student", "center_id": ObjectId(teacher_center_id)}):
        students.append(
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
    return students


@router.put("/groups/{group_id}/assign")
async def assign_teacher_to_group(
    group_id: str,
    teacher_id: str | None = None,
    current_user: dict = Depends(require_teacher),
):
    """Teacher assigns themselves (or another teacher) to a group."""
    db = get_database()
    teacher_center_id = current_user.get("center_id")

    target_teacher_id = teacher_id or current_user.get("sub")

    group = await db.groups.find_one({
        "_id": ObjectId(group_id),
        "center_id": ObjectId(teacher_center_id),
    })
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found or not in your center.")

    await db.groups.update_one(
        {"_id": ObjectId(group_id)},
        {"$set": {"teacher_id": ObjectId(target_teacher_id)}},
    )
    await db.users.update_one(
        {"_id": ObjectId(target_teacher_id)},
        {"$set": {"group_id": ObjectId(group_id)}},
    )

    return {"message": f"Teacher assigned to group '{group['name']}' successfully."}
