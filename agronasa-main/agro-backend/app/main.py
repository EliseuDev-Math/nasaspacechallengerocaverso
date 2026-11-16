import logging
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .crops import CROPS
from .nasa import NasaUnavailable, fetch_history
from .scoring import best_window, rank_month, recent_conditions
from .security import SECURITY_HEADERS, rate_limit, require_api_key

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agro")

STATIC = Path(__file__).resolve().parent.parent / "static"
PAGE_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
            "base-uri 'none'; frame-ancestors 'none'")

app = FastAPI(
    title="AgroNASA API",
    version="1.1.0",
    docs_url=None if settings.is_prod else "/docs",  # interactive docs only in development
    redoc_url=None,
    openapi_url=None if settings.is_prod else "/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                   allow_methods=["GET"], allow_headers=["X-API-Key"], max_age=600)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    resp = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        if k == "Content-Security-Policy" and request.url.path.startswith(("/docs", "/openapi")):
            continue  # Swagger UI needs its own scripts in dev
        resp.headers.setdefault(k, v)
    return resp


@app.exception_handler(NasaUnavailable)
async def nasa_down(_: Request, __: NasaUnavailable):
    return JSONResponse({"error": "NASA data is temporarily unavailable. Please try again."}, status_code=502)


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception):
    log.exception("unexpected error")  # details only in the log, never in the response
    return JSONResponse({"error": "Internal error."}, status_code=500)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/v1/crops", dependencies=[Depends(rate_limit), Depends(require_api_key)])
async def crops():
    return [{"id": k, "name": v["name"]} for k, v in CROPS.items()]


@app.get("/v1/best-days", dependencies=[Depends(rate_limit), Depends(require_api_key)])
async def best_days(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    crop: str = Query(..., pattern=r"^[a-z]{3,20}$"),
    month: int | None = Query(None, ge=1, le=12, description="Month (1-12). Default: current month"),
    top: int = Query(5, ge=1, le=15, description="How many best days to return"),
):
    if crop not in CROPS:
        raise HTTPException(404, f"Unsupported crop. Use one of: {', '.join(CROPS)}")

    today = date.today()
    m = month or today.month
    year = today.year + (1 if m < today.month else 0)  # month already passed -> next year

    history = await fetch_history(lat, lon)
    days = rank_month(history, crop, year, m, today)
    if not days:
        raise HTTPException(404, "Not enough data for this location/month.")

    ranked = sorted(days, key=lambda d: (-d["score"], d["date"]))
    return {
        "crop": CROPS[crop]["name"],
        "location": {"lat": round(lat, 2), "lon": round(lon, 2)},
        "period": {"year": year, "month": m},
        "best_days": ranked[:top],
        "best_window_5_days": best_window(days, 5),
        "recent_conditions": recent_conditions(history, today),
        "days": days,
        "source": f"NASA POWER (satellite-derived daily data, {settings.history_years}-year average for the same period)",
        "disclaimer": "Estimate based on historical climate, not a weather forecast. "
                      "Confirm with an agronomist and your local forecast.",
    }


# ---- front end (same origin: no CORS needed, strict CSP) ----
@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC / "index.html", headers={"Content-Security-Policy": PAGE_CSP})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
