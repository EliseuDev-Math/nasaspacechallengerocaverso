// AgroNASA – motor 100% no navegador (porta fiel de agro-backend/app/{crops,scoring,nasa}.py).
// Em vez de passar pelo servidor FastAPI, a página consulta a NASA POWER diretamente,
// o que permite hospedar tudo como site estático (GitHub Pages).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgroEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- configuração (equivale a config.py) ----------
  const HISTORY_YEARS = 8;
  const CACHE_TTL_MS = 12 * 3600 * 1000;
  const WINDOW_DAYS = 3;
  const POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
  const PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETROOT,WS2M";
  const FIELD = { T2M: "tmean", T2M_MAX: "tmax", T2M_MIN: "tmin", PRECTOTCORR: "rain", GWETROOT: "soil", WS2M: "wind" };
  const MISSING = -999.0;

  // ---------- culturas (equivale a crops.py) ----------
  const c = (name, t_ideal, frost, heat, heavy_rain, soil_ideal) => ({ name, t_ideal, frost, heat, heavy_rain, soil_ideal });
  const CROPS = {
    soy: c("Soy", [22, 30], 3, 36, 30, [0.50, 0.85]),
    corn: c("Corn", [21, 30], 2, 36, 30, [0.45, 0.80]),
    coffee: c("Coffee", [18, 24], 2, 32, 40, [0.40, 0.75]),
    sugarcane: c("Sugarcane", [22, 32], 3, 38, 40, [0.40, 0.80]),
    cotton: c("Cotton", [22, 32], 5, 38, 30, [0.40, 0.75]),
    rice: c("Rice", [22, 32], 8, 37, 50, [0.60, 0.95]),
    beans: c("Beans", [18, 28], 4, 35, 25, [0.40, 0.75]),
    wheat: c("Wheat", [12, 22], -2, 32, 25, [0.40, 0.75]),
    cassava: c("Cassava", [20, 30], 8, 38, 40, [0.35, 0.75]),
    orange: c("Orange", [20, 30], 0, 38, 40, [0.40, 0.75]),
    cocoa: c("Cocoa", [22, 30], 12, 34, 50, [0.55, 0.90]),
    banana: c("Banana", [22, 30], 8, 36, 50, [0.50, 0.85]),
    tomato: c("Tomato", [18, 27], 5, 34, 20, [0.45, 0.75]),
  };

  // ---------- utilidades de data (UTC, sem problemas de fuso/horário de verão) ----------
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const iso = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  const toUTC = (isoStr) => { const [y, m, d] = isoStr.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const fromUTC = (ms) => { const dt = new Date(ms); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };
  const addDays = (isoStr, n) => fromUTC(toUTC(isoStr) + n * 86400000);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const localToday = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); };

  // arredondamento "à la Python" (valor binário exato; empate exato -> par), p/ resultados idênticos ao backend
  function pyRound(x, nd = 0) {
    if (!isFinite(x)) return x;
    const neg = x < 0, ax = Math.abs(x);
    const [ip, fp = ""] = ax.toFixed(60).split(".");
    const kept = fp.slice(0, nd), rest = fp.slice(nd);
    let digits = ip + kept;                       // dígitos mantidos, sem o ponto
    const up = rest[0] > "5" || (rest[0] === "5" && (/[1-9]/.test(rest.slice(1)) || (digits.slice(-1) - 0) % 2 === 1));
    if (up) digits = (BigInt(digits) + 1n).toString().padStart(digits.length, "0");
    const out = Number(nd ? digits.slice(0, digits.length - nd) + "." + digits.slice(digits.length - nd) : digits);
    return neg ? -out : out;
  }

  // ---------- pontuação (equivale a scoring.py) ----------
  function rangePenalty(value, lo, hi, tol, maxPen) {
    if (value >= lo && value <= hi) return 0.0;
    const dist = value < lo ? lo - value : value - hi;
    return Math.min(maxPen, (maxPen * dist) / tol);
  }
  const has = (v) => v !== null && v !== undefined;

  function scoreDay(obs, crop) {
    let pen = 0.0; const why = [];
    if (has(obs.tmean)) {
      const p = rangePenalty(obs.tmean, crop.t_ideal[0], crop.t_ideal[1], 8, 35);
      pen += p; if (p > 10) why.push("temperature outside ideal range");
    }
    if (has(obs.tmin) && obs.tmin <= crop.frost) { pen += 40; why.push("frost risk"); }
    if (has(obs.tmax) && obs.tmax >= crop.heat) { pen += 15; why.push("excessive heat"); }
    const hr = crop.heavy_rain;
    if (has(obs.rain) && obs.rain > hr) { pen += Math.min(35, 15 + (20 * (obs.rain - hr)) / hr); why.push("heavy rain"); }
    if (has(obs.soil)) {
      const [lo, hi] = crop.soil_ideal;
      const p = rangePenalty(obs.soil, lo, hi, 0.3, 30);
      pen += p; if (p > 10) why.push(obs.soil < lo ? "soil too dry" : "waterlogged soil");
    }
    if (has(obs.wind) && obs.wind > 8) { pen += 10; why.push("strong wind"); }
    return [Math.max(0.0, 100.0 - pen), why];
  }

  const classify = (s) => (s >= 75 ? "excellent" : s >= 60 ? "good" : s >= 40 ? "fair" : "poor");
  const mean = (v) => (v.length ? pyRound(v.reduce((a, b) => a + b, 0) / v.length, 2) : null);

  // history: Map<"YYYY-MM-DD", {tmean,tmax,tmin,rain,soil,wind}>
  function rankMonth(history, cropKey, year, month, todayIso) {
    const crop = CROPS[cropKey];
    const years = [...new Set([...history.keys()].map((k) => +k.slice(0, 4)))].sort((a, b) => a - b);
    const out = [];
    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const target = iso(year, month, day);
      if (target < todayIso) continue;
      const scores = [], reasons = new Map(), rains = [], temps = [];
      for (const y of years) {
        if (y === year) continue;
        if (month === 2 && day === 29 && daysInMonth(y, 2) !== 29) continue; // 29/fev em ano não bissexto
        const center = iso(y, month, day);
        for (let off = -WINDOW_DAYS; off <= WINDOW_DAYS; off++) {
          const obs = history.get(addDays(center, off));
          if (!obs || !has(obs.tmean)) continue;
          const [s, why] = scoreDay(obs, crop);
          scores.push(s); temps.push(obs.tmean);
          for (const w of why) reasons.set(w, (reasons.get(w) || 0) + 1);
          if (has(obs.rain)) rains.push(obs.rain);
        }
      }
      if (!scores.length) continue;
      const n = scores.length, avg = scores.reduce((a, b) => a + b, 0) / n;
      const risks = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
        .filter(([, cnt]) => cnt / n >= 0.2).map(([r]) => r);
      out.push({
        date: target, score: pyRound(avg, 1), rating: classify(avg),
        favorable_chance_pct: pyRound((100 * scores.filter((s) => s >= 70).length) / n),
        avg_temp_c: mean(temps), avg_rain_mm: mean(rains), main_risks: risks, samples: n,
      });
    }
    return out;
  }

  function bestWindow(days, size = 5) {
    if (days.length < size) return null;
    let best = null;
    for (let i = 0; i <= days.length - size; i++) {
      const chunk = days.slice(i, i + size);
      const avg = chunk.reduce((a, d) => a + d.score, 0) / size;
      if (best === null || avg > best.avg_score) best = { start: chunk[0].date, end: chunk[size - 1].date, avg_score: pyRound(avg, 1) };
    }
    return best;
  }

  function recentConditions(history, todayIso, n = 7) {
    const days = [...history.keys()].filter((k) => k < todayIso).sort().slice(-n).map((k) => history.get(k));
    if (!days.length) return null;
    const vals = (k) => days.map((x) => x[k]).filter(has);
    const rain = vals("rain"), tmin = vals("tmin"), tmax = vals("tmax");
    return {
      days_considered: days.length,
      rain_total_mm: rain.length ? pyRound(rain.reduce((a, b) => a + b, 0), 1) : null,
      avg_soil_moisture: mean(vals("soil")),
      min_temp_c: tmin.length ? Math.min(...tmin) : null,
      max_temp_c: tmax.length ? Math.max(...tmax) : null,
    };
  }

  // ---------- NASA POWER (equivale a nasa.py) ----------
  class EngineError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }

  function parsePower(payload) {
    let params, keys;
    try { params = payload.properties.parameter; keys = Object.keys(params.T2M); }
    catch (e) { throw new EngineError("nasa", "unexpected NASA response"); }
    const out = new Map();
    for (const ds of keys) {
      if (!/^\d{8}$/.test(ds)) continue;
      const row = {};
      for (const [nk, field] of Object.entries(FIELD)) {
        const v = params[nk] ? params[nk][ds] : undefined;
        row[field] = v === null || v === undefined || v <= MISSING ? null : Number(v);
      }
      out.set(`${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`, row);
    }
    return out;
  }

  const memCache = new Map(), inflight = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // cache em localStorage (opcional; ignora silenciosamente se indisponível)
  function storeGet(key) {
    try {
      const raw = localStorage.getItem("agronasa:" + key); if (!raw) return null;
      const o = JSON.parse(raw);
      if (Date.now() > o.exp) { localStorage.removeItem("agronasa:" + key); return null; }
      return new Map(Object.entries(o.data));
    } catch (e) { return null; }
  }
  function storeSet(key, map) {
    try { localStorage.setItem("agronasa:" + key, JSON.stringify({ exp: Date.now() + CACHE_TTL_MS, day: localToday(), data: Object.fromEntries(map) })); }
    catch (e) { /* quota cheia ou storage bloqueado: segue sem cache */ }
  }

  async function fetchHistory(lat, lon, todayIso) {
    lat = pyRound(lat, 2); lon = pyRound(lon, 2); // ~1 km: cache + privacidade
    const key = `${lat}_${lon}_${todayIso}`;
    if (memCache.has(key)) return memCache.get(key);
    const stored = storeGet(key); if (stored) { memCache.set(key, stored); return stored; }
    if (inflight.has(key)) return inflight.get(key);

    const job = (async () => {
      const end = addDays(todayIso, -2); // a NASA tem ~2 dias de atraso
      const start = iso(+end.slice(0, 4) - HISTORY_YEARS, 1, 1);
      const q = new URLSearchParams({ parameters: PARAMS, community: "AG", latitude: lat, longitude: lon,
        start: start.replace(/-/g, ""), end: end.replace(/-/g, ""), format: "JSON" });
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 45000);
        try {
          const r = await fetch(`${POWER_URL}?${q}`, { signal: ctrl.signal, redirect: "error" });
          if (r.ok) { const data = parsePower(await r.json()); memCache.set(key, data); storeSet(key, data); return data; }
          if (r.status < 500 && r.status !== 429) throw new EngineError("nasa", `NASA returned ${r.status}`);
          lastErr = new EngineError("nasa", `NASA returned ${r.status}`);
        } catch (e) {
          if (e instanceof EngineError) throw e;
          lastErr = e;
        } finally { clearTimeout(timer); }
        await sleep(1500 * (attempt + 1));
      }
      throw new EngineError("nasa", String(lastErr && lastErr.message || lastErr));
    })();
    inflight.set(key, job);
    try { return await job; } finally { inflight.delete(key); }
  }

  // ---------- equivalente ao endpoint GET /v1/best-days ----------
  async function bestDays(lat, lon, cropKey, month, top = 5, opts = {}) {
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new EngineError("input", "invalid coordinates");
    if (!Object.prototype.hasOwnProperty.call(CROPS, cropKey)) throw new EngineError("input", "unsupported crop");
    const today = opts.today || localToday();
    const [ty, tm] = today.split("-").map(Number);
    const m = month || tm;
    if (!(m >= 1 && m <= 12)) throw new EngineError("input", "invalid month");
    const year = ty + (m < tm ? 1 : 0); // mês que já passou -> ano seguinte

    const history = opts.history || (await fetchHistory(lat, lon, today));
    const days = rankMonth(history, cropKey, year, m, today);
    if (!days.length) throw new EngineError("nodata", "not enough data");

    const ranked = [...days].sort((a, b) => b.score - a.score || (a.date < b.date ? -1 : 1));
    return {
      crop: CROPS[cropKey].name,
      location: { lat: pyRound(lat, 2), lon: pyRound(lon, 2) },
      period: { year, month: m },
      best_days: ranked.slice(0, top),
      best_window_5_days: bestWindow(days, 5),
      recent_conditions: recentConditions(history, today),
      days,
      source: `NASA POWER (satellite-derived daily data, ${HISTORY_YEARS}-year average for the same period)`,
      disclaimer: "Estimate based on historical climate, not a weather forecast. Confirm with an agronomist and your local forecast.",
    };
  }

  return { CROPS, scoreDay, classify, rankMonth, bestWindow, recentConditions, parsePower, fetchHistory, bestDays, EngineError, localToday };
});
