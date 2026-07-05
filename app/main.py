"""
IELTS Testing Platform - FastAPI Application
A closed-access, hierarchical platform for managing IELTS course centers,
teachers, students, and testing.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import connect_to_database, close_database_connection
from app.core.middleware import AccessLogMiddleware
from app.utils.init_superadmin import initialize_superadmin

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    # Startup
    logger.info("Starting %s v%s...", settings.APP_NAME, settings.APP_VERSION)
    await connect_to_database()
    await initialize_superadmin()
    logger.info("Application startup complete.")
    yield
    # Shutdown
    await close_database_connection()
    logger.info("Application shutdown complete.")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    lifespan=lifespan,
)

# CORS middleware - restrict in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Access log middleware (every request)
app.add_middleware(AccessLogMiddleware)


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for monitoring."""
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}


# ---- Register API routers ----
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.superadmin import router as superadmin_router
from app.api.teacher import router as teacher_router
from app.api.tests import router as tests_router
from app.api.students import router as students_router

app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(superadmin_router, prefix="/superadmin", tags=["SuperAdmin"])
app.include_router(admin_router, prefix="/admin", tags=["Admin"])
app.include_router(teacher_router, prefix="/teacher", tags=["Teacher"])
app.include_router(tests_router, prefix="/staff", tags=["Tests (Admin/Teacher)"])
app.include_router(students_router, prefix="/student", tags=["Student"])

from app.api.analytics import router as analytics_router

app.include_router(analytics_router, prefix="/analytics", tags=["Analytics"])
