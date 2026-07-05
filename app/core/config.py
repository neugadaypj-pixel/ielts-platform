"""
Application configuration via environment variables.
"""

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    APP_NAME: str = "IELTS Testing Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Database
    MONGO_URI: str = "mongodb://mongodb:27017"
    MONGO_DB_NAME: str = "ielts_platform"

    # JWT Authentication
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 30

    # Initial SuperAdmin Credentials
    SUPERADMIN_USERNAME: str = "Jamal"
    SUPERADMIN_PASSWORD: str

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:8000"]

    # Cloudflare R2 (S3-compatible)
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_ENDPOINT_URL: str = ""
    R2_BUCKET_NAME: str = ""

    # Security
    BCRYPT_ROUNDS: int = 12


settings = Settings()
