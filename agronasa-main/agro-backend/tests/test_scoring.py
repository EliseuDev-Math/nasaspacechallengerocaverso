from datetime import date, timedelta

from app.crops import CROPS
from app.scoring import best_window, classify, rank_month, recent_conditions, score_day


def make_history(tmean=25, tmin=18, tmax=31, rain=2, soil=0.6, wind=3, years=(2022, 2023, 2024, 2025)):
    h, d = {}, date(years[0], 1, 1)
    while d <= date(years[-1], 12, 31):
        h[d] = dict(tmean=tmean, tmin=tmin, tmax=tmax, rain=rain, soil=soil, wind=wind)
        d += timedelta(days=1)
    return h


def test_ideal_day_scores_100():
    s, why = score_day(dict(tmean=25, tmin=18, tmax=31, rain=2, soil=0.6, wind=3), CROPS["corn"])
    assert s == 100 and why == []


def test_frost_and_heavy_rain_penalized():
    s, why = score_day(dict(tmean=15, tmin=0, tmax=22, rain=60, soil=0.95, wind=3), CROPS["corn"])
    assert s < 40 and "frost risk" in why and "heavy rain" in why


def test_dry_soil_flagged():
    _, why = score_day(dict(tmean=25, tmin=18, tmax=31, rain=0, soil=0.1, wind=3), CROPS["soy"])
    assert "soil too dry" in why


def test_coffee_prefers_mild_temperatures():
    obs = dict(tmean=21, tmin=16, tmax=27, rain=2, soil=0.55, wind=3)
    hot = dict(obs, tmean=30, tmax=37)
    assert score_day(obs, CROPS["coffee"])[0] > score_day(hot, CROPS["coffee"])[0]


def test_rank_month_good_conditions():
    days = rank_month(make_history(), "corn", 2026, 11, today=date(2026, 11, 15))
    assert len(days) == 16 and days[0]["date"] == "2026-11-15"
    assert all(d["rating"] == "excellent" for d in days) and days[0]["favorable_chance_pct"] == 100


def test_rank_month_bad_conditions():
    days = rank_month(make_history(tmin=-3, tmean=8), "corn", 2026, 7, today=date(2026, 7, 1))
    assert all(d["rating"] in ("poor", "fair") for d in days) and "frost risk" in days[0]["main_risks"]


def test_best_window_and_recent():
    days = [{"date": f"2026-11-{i:02d}", "score": n} for i, n in enumerate([50, 60, 90, 95, 92, 91, 90, 40], 1)]
    w = best_window(days, 5)
    assert w["start"] == "2026-11-03" and w["end"] == "2026-11-07"
    r = recent_conditions(make_history(), date(2026, 1, 1), 7)
    assert r["days_considered"] == 7 and r["rain_total_mm"] == 14.0


def test_classify():
    assert [classify(x) for x in (90, 65, 45, 10)] == ["excellent", "good", "fair", "poor"]
