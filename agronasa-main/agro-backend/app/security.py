"""Autenticacao por API key, rate limit por IP e headers de seguranca."""
import hmac
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request

from .config import settings

_hits: dict[str, deque] = defaultdict(deque)
_MAX_TRACKED_IPS = 10_000


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:  # o ultimo item e o que o SEU proxy adicionou (nao forjavel pelo cliente)
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


async def rate_limit(request: Request):
    ip, now = client_ip(request), time.monotonic()
    if len(_hits) > _MAX_TRACKED_IPS:
        for k in [k for k, q in _hits.items() if not q or now - q[-1] > 60]:
            _hits.pop(k, None)
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_min:
        retry = int(60 - (now - q[0])) + 1
        raise HTTPException(429, "Too many requests. Please try again shortly.",
                            headers={"Retry-After": str(retry)})
    q.append(now)


async def require_api_key(x_api_key: str | None = Header(default=None)):
    if not settings.api_keys:  # modo dev sem chave
        return
    if not x_api_key or not any(hmac.compare_digest(x_api_key, k) for k in settings.api_keys):
        raise HTTPException(401, "Invalid or missing API key.")


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}
