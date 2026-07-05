"""
Test & Assignment models — Pydantic schemas for tests and assignments.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class Question(BaseModel):
    """A single test question."""

    id: str = Field(..., description="Unique question identifier within the test")
    type: str = Field(..., pattern="^(multiple_choice|true_false|short_answer)$")
    text: str = Field(..., description="Question text")
    options: Optional[list[str]] = Field(None, description="Options for multiple_choice questions")
    correct_answer: str = Field(..., description="The correct answer (or array index)")
    points: float = Field(default=1.0, description="Points awarded for correct answer")


class TestContent(BaseModel):
    """The full content_json structure of a test."""

    sections: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Sections (e.g., Listening, Reading, Writing, Speaking)"
    )
    questions: list[Question] = Field(..., description="List of all questions")
    total_points: float = Field(..., description="Sum of all question points")
    time_limit_minutes: int = Field(default=60, description="Time limit for the test")
    instructions: Optional[str] = None


class TestCreate(BaseModel):
    """Schema for creating a new test."""

    title: str = Field(..., min_length=1, max_length=200)
    content_json: TestContent


class TestResponse(BaseModel):
    """Public-safe test representation (correct answers NOT included for students)."""

    id: str = Field(..., alias="_id")
    center_id: str
    author_id: str
    title: str
    content_json: dict
    created_at: datetime

    model_config = {"populate_by_name": True}


class TestResponseStudent(BaseModel):
    """Test representation for students — correct answers are stripped."""

    id: str = Field(..., alias="_id")
    assignment_id: str = Field(default="", description="The assignment document _id for submission")
    center_id: str
    author_id: str
    title: str
    content_json: dict  # questions have correct_answer removed
    created_at: datetime

    model_config = {"populate_by_name": True}


class TestAssign(BaseModel):
    """Schema for assigning a test to a group."""

    test_id: str
    group_id: str


class AssignmentResponse(BaseModel):
    """Public-safe assignment representation."""

    id: str = Field(..., alias="_id")
    test_id: str
    center_id: str
    group_id: str
    created_at: datetime

    model_config = {"populate_by_name": True}


class Answer(BaseModel):
    """A single student answer."""

    question_id: str
    answer: str


class TestSubmission(BaseModel):
    """Schema for submitting test answers."""

    test_id: str
    assignment_id: str
    answers: list[Answer]


class ResultResponse(BaseModel):
    """Result representation."""

    id: str = Field(..., alias="_id")
    test_id: str
    student_id: str
    score: float
    total_points: float
    answers: list[dict]
    completed_at: datetime

    model_config = {"populate_by_name": True}
