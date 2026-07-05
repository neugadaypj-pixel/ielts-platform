"""
Test API — creation, assignment, and retrieval.
Accessible by Admin, Teacher, and Student (with role-appropriate scoping).
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import RoleChecker, get_current_user
from app.core.database import get_database
from app.models.test import (
    AssignmentResponse,
    TestAssign,
    TestCreate,
    TestResponse,
    TestResponseStudent,
)

logger = logging.getLogger(__name__)

router = APIRouter()

require_admin_or_teacher = RoleChecker(["admin", "teacher"])


@router.post("/tests", response_model=TestResponse, status_code=status.HTTP_201_CREATED)
async def create_test(
    data: TestCreate,
    current_user: dict = Depends(require_admin_or_teacher),
):
    """
    Admin or Teacher creates a new test within their center.
    The test's content_json stores questions with correct answers.
    """
    db = get_database()
    user_center_id = current_user.get("center_id")

    if not user_center_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not associated with any center.")

    # Validate total_points matches sum of question points
    computed_total = sum(q.points for q in data.content_json.questions)
    if abs(computed_total - data.content_json.total_points) > 0.001:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"total_points ({data.content_json.total_points}) does not match sum of question points ({computed_total}).",
        )

    test_doc = {
        "center_id": ObjectId(user_center_id),
        "author_id": ObjectId(current_user.get("sub")),
        "title": data.title,
        "content_json": data.content_json.model_dump(),
        "created_at": datetime.now(timezone.utc),
    }

    result = await db.tests.insert_one(test_doc)

    logger.info(
        "Test '%s' created by '%s' in center %s.",
        data.title,
        current_user.get("username"),
        user_center_id,
    )

    return TestResponse(
        _id=str(result.inserted_id),
        center_id=user_center_id,
        author_id=current_user.get("sub"),
        title=data.title,
        content_json=test_doc["content_json"],
        created_at=test_doc["created_at"],
    )


@router.get("/tests", response_model=list[TestResponse])
async def list_tests_for_staff(current_user: dict = Depends(require_admin_or_teacher)):
    """
    List all tests in the user's center (Admin/Teacher).
    Includes correct answers.
    """
    db = get_database()
    user_center_id = current_user.get("center_id")

    tests = []
    async for doc in db.tests.find({"center_id": ObjectId(user_center_id)}):
        tests.append(
            TestResponse(
                _id=str(doc["_id"]),
                center_id=str(doc["center_id"]),
                author_id=str(doc["author_id"]),
                title=doc["title"],
                content_json=doc["content_json"],
                created_at=doc.get("created_at", datetime.now(timezone.utc)),
            )
        )
    return tests


@router.post("/tests/assign", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
async def assign_test_to_group(
    data: TestAssign,
    current_user: dict = Depends(require_admin_or_teacher),
):
    """
    Teacher or Admin assigns a test to a group.
    This creates an Assignment that students in that group can see.
    """
    db = get_database()
    user_center_id = current_user.get("center_id")

    # Verify test belongs to the user's center
    test = await db.tests.find_one({
        "_id": ObjectId(data.test_id),
        "center_id": ObjectId(user_center_id),
    })
    if not test:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test not found in your center.")

    # Verify group belongs to the user's center
    group = await db.groups.find_one({
        "_id": ObjectId(data.group_id),
        "center_id": ObjectId(user_center_id),
    })
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found in your center.")

    # Check for duplicate assignment
    existing = await db.assignments.find_one({
        "test_id": ObjectId(data.test_id),
        "group_id": ObjectId(data.group_id),
    })
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "This test is already assigned to this group.")

    assignment_doc = {
        "test_id": ObjectId(data.test_id),
        "center_id": ObjectId(user_center_id),
        "group_id": ObjectId(data.group_id),
        "assigned_by": ObjectId(current_user.get("sub")),
        "created_at": datetime.now(timezone.utc),
    }

    result = await db.assignments.insert_one(assignment_doc)

    logger.info(
        "Test '%s' assigned to group '%s' by '%s'.",
        data.test_id,
        data.group_id,
        current_user.get("username"),
    )

    return AssignmentResponse(
        _id=str(result.inserted_id),
        test_id=data.test_id,
        center_id=user_center_id,
        group_id=data.group_id,
        created_at=assignment_doc["created_at"],
    )
