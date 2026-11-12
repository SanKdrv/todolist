"""ASGI middleware."""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class NoStoreMiddleware:
    """Force ``Cache-Control: no-store`` on every HTTP response.

    Implemented as raw ASGI middleware instead of ``BaseHTTPMiddleware``:
    no extra task group, no streaming/background-task side effects, and
    headers are written before the body starts streaming.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["cache-control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_no_store)
