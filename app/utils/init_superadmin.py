"""
SuperAdmin initialization script.
Runs on application startup. If the users collection is empty,
it creates the initial SuperAdmin account as defined in the spec.
"""

import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_database
from app.core.security import hash_password

logger = logging.getLogger(__name__)


async def initialize_superadmin() -> None:
    """
    Check if the users collection is empty.
    If so, create the initial SuperAdmin account:
        username: from SUPERADMIN_USERNAME (default: "Jamal")
        password: from SUPERADMIN_PASSWORD (hashed)
        role: "superadmin"
    """
    db = get_database()
    users_collection = db.users

    existing_count = await users_collection.count_documents({})

    if existing_count > 0:
        logger.info(
            "Users collection already contains %d user(s). Skipping SuperAdmin init.",
            existing_count,
        )
        return

    logger.info(
        "Users collection is empty. Creating initial SuperAdmin: '%s'...",
        settings.SUPERADMIN_USERNAME,
    )

    superadmin_doc = {
        "username": settings.SUPERADMIN_USERNAME,
        "password_hash": hash_password(settings.SUPERADMIN_PASSWORD),
        "role": "superadmin",
        "center_id": None,
        "group_id": None,
        "full_name": "System Administrator",
        "contact": None,
        "created_at": datetime.now(timezone.utc),
    }

    result = await users_collection.insert_one(superadmin_doc)

    logger.info(
        "SuperAdmin '%s' created successfully with _id=%s",
        settings.SUPERADMIN_USERNAME,
        result.inserted_id,
    )
