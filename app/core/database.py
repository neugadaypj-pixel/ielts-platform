"""
MongoDB database connection management using Motor (async driver).
"""

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings

logger = logging.getLogger(__name__)

client: Optional[AsyncIOMotorClient] = None
db: Optional[AsyncIOMotorDatabase] = None


async def connect_to_database() -> None:
    """Establish async connection to MongoDB."""
    global client, db

    logger.info("Connecting to MongoDB at %s...", settings.MONGO_URI)
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]

    # Verify connection
    await client.admin.command("ping")
    logger.info("Successfully connected to MongoDB. Database: %s", settings.MONGO_DB_NAME)


async def close_database_connection() -> None:
    """Close MongoDB connection gracefully."""
    global client

    if client:
        logger.info("Closing MongoDB connection...")
        client.close()
        logger.info("MongoDB connection closed.")


def get_database() -> AsyncIOMotorDatabase:
    """Return the database instance. Raises if not connected."""
    if db is None:
        raise RuntimeError("Database is not initialized. Call connect_to_database() first.")
    return db
