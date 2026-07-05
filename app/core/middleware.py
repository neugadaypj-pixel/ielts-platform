"""
API request/error logging middleware.
Logs every request with user, method, path, status, and duration.
"""

import logging
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("api.access")


class AccessLogMiddleware(BaseHTTPMiddleware):
    """Middleware that logs every API request with timing and status."""

    async def dispatch(self, request: Request, call_next):
        start_time = time.monotonic()

        # Extract user info if available (JWT may not be decoded yet, but we log what we can)
        response = await call_next(request)

        duration_ms = (time.monotonic() - start_time) * 1000
        client_ip = request.client.host if request.client else "unknown"

        logger.info(
            "%s | %s | %s %s | %d | %.2fms",
            client_ip,
            request.headers.get("x-forwarded-for", "-"),
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )

        return response
