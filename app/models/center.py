"""
Center & Group models — Pydantic schemas for center management.
These models are used by SuperAdmin, Admin, and Teacher APIs.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Center
# --------------------------------------------------------------------------- #

class CenterCreate(BaseModel):
    """Schema for SuperAdmin to create a new course center with its Admin."""

    name: str = Field(..., min_length=2, max_length=100)
    admin_username: str = Field(..., min_length=3, max_length=50)
    admin_password: str = Field(..., min_length=6, max_length=128)
    admin_full_name: str = Field(..., min_length=1, max_length=100)
    admin_contact: Optional[str] = None


class CenterResponse(BaseModel):
    """Public representation of a course center."""

    id: str = Field(alias="_id")
    name: str
    admin_id: str
    created_at: datetime

    model_config = {"populate_by_name": True}


# --------------------------------------------------------------------------- #
# Group
# --------------------------------------------------------------------------- #

class GroupCreate(BaseModel):
    """Schema for Admin to create a new group within their center."""

    name: str = Field(..., min_length=1, max_length=100)
    center_id: str


class GroupResponse(BaseModel):
    """Public representation of a group."""

    id: str = Field(alias="_id")
    name: str
    center_id: str
    teacher_id: Optional[str] = None
    created_at: datetime

    model_config = {"populate_by_name": True}


# --------------------------------------------------------------------------- #
# Admin → Teacher
# --------------------------------------------------------------------------- #

class TeacherCreate(BaseModel):
    """Schema for Admin to create a Teacher within their center."""

    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)
    contact: Optional[str] = None


# --------------------------------------------------------------------------- #
# Teacher → Student
# --------------------------------------------------------------------------- #

class StudentCreate(BaseModel):
    """Schema for Teacher to create a Student assigned to a group."""

    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=100)
    contact: Optional[str] = None
    group_id: str
