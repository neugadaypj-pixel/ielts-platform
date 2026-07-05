"""
Student-facing test API — view assigned tests and submit answers.
Only the Student role may access these endpoints.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import RoleChecker
from app.core.database import get_database
from app.models.test import (
    ResultResponse,
    TestResponseStudent,
    TestSubmission,
)

logger = logging.getLogger(__name__)

router = APIRouter()

require_student = RoleChecker(["student"])


def _strip_correct_answers(content_json: dict) -> dict:
    """Remove correct_answer fields from questions for student-facing responses."""
    sanitized = {**content_json}
    if "questions" in sanitized:
        sanitized["questions"] = [
            {k: v for k, v in q.items() if k != "correct_answer"}
            for q in sanitized["questions"]
        ]
    return sanitized


@router.get("/tests/assigned", response_model=list[TestResponseStudent])
async def get_assigned_tests(current_user: dict = Depends(require_student)):
    """
    Student retrieves all tests assigned to their group.
    Correct answers are stripped from the response.
    """
    db = get_database()
    student_group_id = current_user.get("group_id")

    if not student_group_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Student is not assigned to any group.")

    # Find all assignments for the student's group
    assignments = []
    async for assignment in db.assignments.find({"group_id": ObjectId(student_group_id)}):
        assignments.append(assignment)

    if not assignments:
        return []

    # Fetch the actual tests
    test_ids = [a["test_id"] for a in assignments]
    tests = []
    async for doc in db.tests.find({"_id": {"$in": test_ids}}):
        tests.append(
            TestResponseStudent(
                _id=str(doc["_id"]),
                center_id=str(doc["center_id"]),
                author_id=str(doc["author_id"]),
                title=doc["title"],
                content_json=_strip_correct_answers(doc["content_json"]),
                created_at=doc.get("created_at", datetime.now(timezone.utc)),
            )
        )
    return tests


@router.post("/tests/submit", response_model=ResultResponse, status_code=status.HTTP_201_CREATED)
async def submit_test(
    submission: TestSubmission,
    current_user: dict = Depends(require_student),
):
    """
    Student submits answers for an assigned test.

    The system auto-scores by comparing answers against correct_answer fields
    in the test's content_json.questions.
    """
    db = get_database()
    student_id = current_user.get("sub")

    # Verify the assignment exists and belongs to the student's group
    assignment = await db.assignments.find_one({
        "_id": ObjectId(submission.assignment_id),
        "group_id": ObjectId(current_user.get("group_id")),
    })
    if not assignment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found for your group.")

    # Fetch the test with correct answers
    test = await db.tests.find_one({"_id": ObjectId(submission.test_id)})
    if not test:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test not found.")

    # Check for duplicate submission
    existing_result = await db.results.find_one({
        "test_id": ObjectId(submission.test_id),
        "student_id": ObjectId(student_id),
    })
    if existing_result:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "You have already submitted this test.",
        )

    # Build lookup for correct answers
    questions = test["content_json"].get("questions", [])
    correct_map = {q["id"]: q["correct_answer"] for q in questions}
    points_map = {q["id"]: q.get("points", 1.0) for q in questions}

    # Score the submission
    score = 0.0
    total_points = sum(points_map.values())
    scored_answers = []

    for answer in submission.answers:
        correct = correct_map.get(answer.question_id)
        is_correct = (correct is not None and answer.answer == correct)
        points = points_map.get(answer.question_id, 1.0) if is_correct else 0.0
        score += points
        scored_answers.append({
            "question_id": answer.question_id,
            "given_answer": answer.answer,
            "correct_answer": correct,
            "is_correct": is_correct,
            "points_awarded": points,
        })

    # Save result
    result_doc = {
        "test_id": ObjectId(submission.test_id),
        "assignment_id": ObjectId(submission.assignment_id),
        "student_id": ObjectId(student_id),
        "center_id": ObjectId(current_user.get("center_id")),
        "score": score,
        "total_points": total_points,
        "answers": scored_answers,
        "completed_at": datetime.now(timezone.utc),
    }

    result = await db.results.insert_one(result_doc)

    logger.info(
        "Student '%s' submitted test '%s'. Score: %.1f/%.1f",
        current_user.get("username"),
        test["title"],
        score,
        total_points,
    )

    return ResultResponse(
        _id=str(result.inserted_id),
        test_id=submission.test_id,
        student_id=student_id,
        score=score,
        total_points=total_points,
        answers=scored_answers,
        completed_at=result_doc["completed_at"],
    )


@router.get("/results", response_model=list[ResultResponse])
async def get_my_results(current_user: dict = Depends(require_student)):
    """Student views their own test results."""
    db = get_database()
    student_id = current_user.get("sub")

    results = []
    async for doc in db.results.find({"student_id": ObjectId(student_id)}):
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
