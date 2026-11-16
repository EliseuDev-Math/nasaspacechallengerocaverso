"""Configuracao via variaveis de ambiente (nenhum segredo fica no codigo)."""
import os
from dataclasses import dataclass


def _csv(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


def _int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(os.getenv(name, default))
    except ValueError:
        v = default
    return max(lo, min(hi, v))


@dataclass(frozen=True)
class Settings:
    env: str
    api_keys: tuple[str, ...]
    allowed_origins: list[str]
    rate_limit_per_min: int
    trust_proxy: bool
    history_years: int
    cache_ttl_seconds: int

    @property
    def is_prod(self) -> bool:
        return self.env == "production"


def load_settings() -> Settings:
    s = Settings(
        env=os.getenv("ENV", "development").lower(),
        api_keys=tuple(_csv("API_KEYS")),
        allowed_origins=_csv("ALLOWED_ORIGINS"),
        rate_limit_per_min=_int("RATE_LIMIT_PER_MIN", 30, 1, 10_000),
        trust_proxy=os.getenv("TRUST_PROXY", "false").lower() == "true",
        history_years=_int("HISTORY_YEARS", 8, 3, 20),
        cache_ttl_seconds=_int("CACHE_TTL_SECONDS", 43200, 60, 604800),
    )
    return s


settings = load_settings()
