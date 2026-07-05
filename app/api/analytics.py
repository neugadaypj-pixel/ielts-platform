"""
Analytics API — results viewing for Admin, Teacher, and SuperAdmin.
Role-scoped: users can only see results for their own center.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import RoleChecker
from app.core.database import get_database
from app.models.test import ResultResponse

logger = logging.getLogger(__name__)

router = APIRouter()

require_staff = RoleChecker(["superadmin", "admin", "teacher"])


@router.get("/results", response_model=list[ResultResponse])
async def get_center_results(current_user: dict = Depends(require_staff)):
    """
    Admin/Teacher views all test results within their center.
    SuperAdmin can see results across all centers.
    """
    db = get_database()
    role = current_user.get("role")
    center_id = current_user.get("center_id")

    query = {}
    if role != "superadmin":
        if not center_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not associated with any center.")
        query["center_id"] = ObjectId(center_id)

    results = []
    async for doc in db.results.find(query).sort("completed_at", -1).limit(500):
        results.append(
            ResultResponse(
                _id=str(doc["_id"]),
                test_id=str(doc["test_id"]),
                student_id=str(doc["student_id"]),
                score=doc["score"],
                total_points=doc["total_points"],
                answers=doc.get("answers", []),
                completed_at=doc["completed_at"],
            )
        )
    return results


@router.get("/results/student/{student_id}", response_model=list[ResultResponse])
async def get_student_results(
    student_id: str,
    current_user: dict = Depends(require_staff),
):
    """
    View a specific student's test results.
    Scoped: must be in the same center as the student (or SuperAdmin).
    """
    db = get_database()
    role = current_user.get("role")
    center_id = current_user.get("center_id")

    # Verify student exists and check center scoping
    student = await db.users.find_one({"_id": ObjectId(student_id), "role": "student"})
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    if role != "superadmin" and str(student.get("center_id")) != center_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student is not in your center.")

    results = []
    async for doc in db.results.find({"student_id": ObjectId(student_id)}).sort("completed_at", -1):
        results.append(
            ResultResponse(
                _id=str(doc["_id"]),
                test_id=str(doc["test_id"]),
                student_id=str(doc["student_id"]),
                score=doc["score"],
                total_points=doc["total_points"],
                answers=doc.get("answers", []),
                completed_at=doc["completed_at"],
            )
        )
    return results


@router.get("/results/test/{test_id}", response_model=list[ResultResponse])
async def get_test_results(
    test_id: str,
    current_user: dict = Depends(require_staff),
):
    """
    View all results for a specific test.
    Scoped to the user's center (or system-wide for SuperAdmin).
    """
    db = get_database()
    role = current_user.get("role")
    center_id = current_user.get("center_id")

    query: dict = {"test_id": ObjectId(test_id)}
    if role != "superadmin":
        if not center_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not associated with any center.")
        query["center_id"] = ObjectId(center_id)

    results = []
    async for doc in db.results.find(query).sort("score", -1):
        results.append(
            ResultResponse(
                _id=str(doc["_id"]),
                test_id=str(doc["test_id"]),
                student_id=str(doc["student_id"]),
                score=doc["score"],
                total_points=doc["total_points"],
                answers=doc.get("answers", []),
                completed_at=doc["completed_at"],
            )
        )
    return results


@router.get("/stats/center")
async def get_center_statistics(current_user: dict = Depends(require_staff)):
    """
    Get aggregate statistics for the center:
    - Total students / teachers
    - Total tests created
    - Total assignments (tests assigned to groups)
    - Total submissions
    - Average score
    """
    db = get_database()
    role = current_user.get("role")
    center_id = current_user.get("center_id")

    if role != "superadmin" and not center_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not associated with any center.")

    center_filter = {} if role == "superadmin" else {"center_id": ObjectId(center_id)}

    total_students = await db.users.count_documents({**center_filter, "role": "student"})
    total_teachers = await db.users.count_documents({**center_filter, "role": "teacher"})
    total_tests = await db.tests.count_documents(center_filter)
    total_assignments = await db.assignments.count_documents(center_filter)
    total_submissions = await db.results.count_documents(center_filter)

    # Average score across all submissions
    pipeline = [
        {"$match": center_filter},
        {"$group": {"_id": None, "avg_score": {"$avg": "$score"}, "avg_pct": {"$avg": {"$divide": ["$score", "$total_points"]}}}},
    ]
    agg_result = await db.results.aggregate(pipeline).to_list(length=1)
    avg_data = agg_result[0] if agg_result else {"avg_score": 0, "avg_pct": 0}

    return {
        "total_students": total_students,
        "total_teachers": total_teachers,
        "total_tests": total_tests,
        "total_assignments": total_assignments,
        "total_submissions": total_submissions,
        "average_score": round(avg_data["avg_score"], 2),
        "average_percentage": round(avg_data["avg_pct"] * 100, 1) if avg_data["avg_pct"] else 0,
    }
