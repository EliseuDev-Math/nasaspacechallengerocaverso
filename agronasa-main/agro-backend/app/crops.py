"""Simplified requirements per crop (approximate values; validate with an agronomist).

t_ideal    : ideal daily mean temperature range for planting (C)
frost      : tmin <= this value = frost risk (C)
heat       : tmax >= this value = heat stress (C)
heavy_rain : daily rain (mm) that harms planting/emergence
soil_ideal : root-zone soil moisture range (0 = dry, 1 = saturated)
"""
def _c(name, t, frost, heat, rain, soil):
    return {"name": name, "t_ideal": t, "frost": frost, "heat": heat, "heavy_rain": rain, "soil_ideal": soil}

CROPS: dict[str, dict] = {
    "soy":       _c("Soy",       (22, 30), 3,  36, 30, (0.50, 0.85)),
    "corn":      _c("Corn",      (21, 30), 2,  36, 30, (0.45, 0.80)),
    "coffee":    _c("Coffee",    (18, 24), 2,  32, 40, (0.40, 0.75)),
    "sugarcane": _c("Sugarcane", (22, 32), 3,  38, 40, (0.40, 0.80)),
    "cotton":    _c("Cotton",    (22, 32), 5,  38, 30, (0.40, 0.75)),
    "rice":      _c("Rice",      (22, 32), 8,  37, 50, (0.60, 0.95)),
    "beans":     _c("Beans",     (18, 28), 4,  35, 25, (0.40, 0.75)),
    "wheat":     _c("Wheat",     (12, 22), -2, 32, 25, (0.40, 0.75)),
    "cassava":   _c("Cassava",   (20, 30), 8,  38, 40, (0.35, 0.75)),
    "orange":    _c("Orange",    (20, 30), 0,  38, 40, (0.40, 0.75)),
    "cocoa":     _c("Cocoa",     (22, 30), 12, 34, 50, (0.55, 0.90)),
    "banana":    _c("Banana",    (22, 30), 8,  36, 50, (0.50, 0.85)),
    "tomato":    _c("Tomato",    (18, 27), 5,  34, 20, (0.45, 0.75)),
}
