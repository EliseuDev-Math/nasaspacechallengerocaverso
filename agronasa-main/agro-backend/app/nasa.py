"""Cliente da NASA POWER API (dados diarios derivados de satelite, gratis e sem chave).
Docs: https://power.larc.nasa.gov/docs/services/api/
"""
import asyncio
import logging
import time
from datetime import date, datetime, timedelta

import httpx

from .config import settings

log = logging.getLogger("agro.nasa")

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"  # host fixo: sem risco de SSRF
PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETROOT,WS2M"
FIELD = {"T2M": "tmean", "T2M_MAX": "tmax", "T2M_MIN": "tmin",
         "PRECTOTCORR": "rain", "GWETROOT": "soil", "WS2M": "wind"}
MISSING = -999.0


class NasaUnavailable(Exception):
    pass


class TTLCache:
    """Cache em memoria com limite de tamanho (evita estourar memoria)."""

    def __init__(self, maxsize: int = 256, ttl: int = 3600):
        self._d: dict = {}
        self._max, self._ttl = maxsize, ttl

    def get(self, key):
        item = self._d.get(key)
        if not item:
            return None
        if item[0] < time.monotonic():
            self._d.pop(key, None)
            return None
        return item[1]

    def set(self, key, value):
        if len(self._d) >= self._max:
            self._d.pop(min(self._d, key=lambda k: self._d[k][0]), None)
        self._d[key] = (time.monotonic() + self._ttl, value)


_cache = TTLCache(ttl=settings.cache_ttl_seconds)
_locks: dict[tuple, asyncio.Lock] = {}


def _parse(payload: dict) -> dict[date, dict]:
    try:
        params = payload["properties"]["parameter"]
        days = params["T2M"].keys()
    except (KeyError, TypeError) as e:
        raise NasaUnavailable("resposta inesperada da NASA") from e
    out: dict[date, dict] = {}
    for ds in days:
        try:
            d = datetime.strptime(ds, "%Y%m%d").date()
        except ValueError:
            continue
        row = {}
        for nasa_key, field in FIELD.items():
            v = params.get(nasa_key, {}).get(ds)
            row[field] = None if v is None or v <= MISSING else float(v)
        out[d] = row
    return out


async def fetch_history(lat: float, lon: float) -> dict[date, dict]:
    """Historico diario (N anos ate ~2 dias atras). Coordenadas arredondadas (~1 km) p/ cache e privacidade."""
    lat, lon = round(lat, 2), round(lon, 2)
    key = (lat, lon)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    lock = _locks.setdefault(key, asyncio.Lock())  # evita varias chamadas iguais a NASA ao mesmo tempo
    async with lock:
        cached = _cache.get(key)
        if cached is not None:
            return cached
        end = date.today() - timedelta(days=2)  # a NASA tem ~2 dias de atraso
        start = date(end.year - settings.history_years, 1, 1)
        q = {"parameters": PARAMS, "community": "AG", "latitude": lat, "longitude": lon,
             "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"), "format": "JSON"}

        last_err: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=5.0),
                                             follow_redirects=False) as client:
                    r = await client.get(POWER_URL, params=q)
                if r.status_code == 200:
                    data = _parse(r.json())
                    _cache.set(key, data)
                    return data
                if r.status_code < 500 and r.status_code != 429:
                    raise NasaUnavailable(f"NASA retornou {r.status_code}")
                last_err = NasaUnavailable(f"NASA retornou {r.status_code}")
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_err = e
            await asyncio.sleep(1.5 * (attempt + 1))
        log.warning("NASA POWER falhou apos tentativas: %s", last_err)
        raise NasaUnavailable("NASA indisponivel") from last_err
