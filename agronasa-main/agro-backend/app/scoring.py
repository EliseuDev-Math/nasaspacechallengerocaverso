"""Pure scoring logic (no network): turns climate history into a 0-100 score per day."""
from collections import Counter
from datetime import date, timedelta
import calendar

from .crops import CROPS

WINDOW_DAYS = 3  # compare each day with +-3 days in previous years


def _range_penalty(value, lo, hi, tol, max_pen):
    if lo <= value <= hi:
        return 0.0
    dist = (lo - value) if value < lo else (value - hi)
    return min(max_pen, max_pen * dist / tol)


def score_day(obs: dict, crop: dict) -> tuple[float, list[str]]:
    """Score 0-100 (100 = perfect conditions) plus the reasons for any penalty."""
    pen, why = 0.0, []

    if obs.get("tmean") is not None:
        p = _range_penalty(obs["tmean"], *crop["t_ideal"], tol=8, max_pen=35)
        pen += p
        if p > 10:
            why.append("temperature outside ideal range")
    if obs.get("tmin") is not None and obs["tmin"] <= crop["frost"]:
        pen += 40
        why.append("frost risk")
    if obs.get("tmax") is not None and obs["tmax"] >= crop["heat"]:
        pen += 15
        why.append("excessive heat")

    rain, hr = obs.get("rain"), crop["heavy_rain"]
    if rain is not None and rain > hr:
        pen += min(35, 15 + 20 * (rain - hr) / hr)
        why.append("heavy rain")

    soil = obs.get("soil")
    if soil is not None:
        lo, hi = crop["soil_ideal"]
        p = _range_penalty(soil, lo, hi, tol=0.3, max_pen=30)
        pen += p
        if p > 10:
            why.append("soil too dry" if soil < lo else "waterlogged soil")

    if obs.get("wind") is not None and obs["wind"] > 8:
        pen += 10
        why.append("strong wind")

    return max(0.0, 100.0 - pen), why


def classify(score: float) -> str:
    return "excellent" if score >= 75 else "good" if score >= 60 else "fair" if score >= 40 else "poor"


def _mean(vals):
    return round(sum(vals) / len(vals), 2) if vals else None


def rank_month(history: dict[date, dict], crop_key: str, year: int, month: int, today: date) -> list[dict]:
    """For each remaining day of the month, estimate a score from the same period in previous years."""
    crop = CROPS[crop_key]
    years = sorted({d.year for d in history})
    out = []
    for day in range(1, calendar.monthrange(year, month)[1] + 1):
        target = date(year, month, day)
        if target < today:
            continue
        scores, reasons, rains, temps = [], Counter(), [], []
        for y in years:
            if y == year:
                continue
            try:
                center = target.replace(year=y)
            except ValueError:  # Feb 29 in a non-leap year
                continue
            for off in range(-WINDOW_DAYS, WINDOW_DAYS + 1):
                obs = history.get(center + timedelta(days=off))
                if not obs or obs.get("tmean") is None:
                    continue
                s, why = score_day(obs, crop)
                scores.append(s)
                reasons.update(why)
                temps.append(obs["tmean"])
                if obs.get("rain") is not None:
                    rains.append(obs["rain"])
        if not scores:
            continue
        n, avg = len(scores), sum(scores) / len(scores)
        out.append({
            "date": target.isoformat(),
            "score": round(avg, 1),
            "rating": classify(avg),
            "favorable_chance_pct": round(100 * sum(s >= 70 for s in scores) / n),
            "avg_temp_c": _mean(temps),
            "avg_rain_mm": _mean(rains),
            "main_risks": [r for r, c in reasons.most_common(2) if c / n >= 0.2],
            "samples": n,
        })
    return out


def best_window(days: list[dict], size: int = 5) -> dict | None:
    """Best run of consecutive days (e.g. 5 good days in a row)."""
    if len(days) < size:
        return None
    best = None
    for i in range(len(days) - size + 1):
        chunk = days[i:i + size]
        avg = sum(d["score"] for d in chunk) / size
        if best is None or avg > best["avg_score"]:
            best = {"start": chunk[0]["date"], "end": chunk[-1]["date"], "avg_score": round(avg, 1)}
    return best


def recent_conditions(history: dict[date, dict], today: date, n: int = 7) -> dict | None:
    """Summary of the last observed days (soil moisture, accumulated rain...)."""
    days = [history[d] for d in sorted(history) if d < today][-n:]
    if not days:
        return None
    def vals(k): return [x[k] for x in days if x.get(k) is not None]
    return {
        "days_considered": len(days),
        "rain_total_mm": round(sum(vals("rain")), 1) if vals("rain") else None,
        "avg_soil_moisture": _mean(vals("soil")),
        "min_temp_c": min(vals("tmin")) if vals("tmin") else None,
        "max_temp_c": max(vals("tmax")) if vals("tmax") else None,
    }
