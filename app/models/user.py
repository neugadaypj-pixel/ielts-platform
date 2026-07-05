"""
User model — Pydantic schemas for serialization and validation.
Database documents are plain dicts stored in MongoDB; these models
provide type safety at the API boundary.
"""

from datetime import datetime
from typing import Optional

from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field


class PyObjectId(ObjectId):
    """Pydantic-compatible ObjectId field."""

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, _info=None):
        if not ObjectId.is_valid(v):
            raise ValueError(f"Invalid ObjectId: {v}")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, _schema, _field):
        return {"type": "string", "example": "507f1f77bcf86cd799439011"}


class UserBase(BaseModel):
    """Shared user fields."""

    username: str = Field(..., min_length=3, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=100)
    contact: Optional[str] = None


class UserCreate(UserBase):
    """Schema for creating a new user. Password is in plain text (will be hashed)."""

    password: str = Field(..., min_length=6, max_length=128)
    role: str = Field(..., pattern="^(admin|teacher|student)$")
    center_id: Optional[str] = None
    group_id: Optional[str] = None


class UserInDB(UserBase):
    """Schema representing a user document as stored in MongoDB."""

    id: str = Field(..., alias="_id")
    username: str
    password_hash: str
    role: str
    center_id: Optional[str] = None
    group_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class UserResponse(UserBase):
    """Public-safe user representation (no password hash)."""

    id: str = Field(..., alias="_id")
    role: str
    center_id: Optional[str] = None
    group_id: Optional[str] = None
    created_at: datetime

    model_config = {"populate_by_name": True}


class LoginRequest(BaseModel):
    """Login credentials."""

    username: str
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""

    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
