// Same origin as the backend (FastAPI serves this page), so no URL or CORS setup is needed.
// Only set API_URL if you host this file somewhere else, e.g. "https://your-api.example.com".
const API_URL = "";
const API_KEY = ""; // only if the backend sets API_KEYS; note that anything in this file is public

// ids match the backend (app/crops.py)
const CROPS = {soy:["🌱","Soy"],corn:["🌽","Corn"],coffee:["☕","Coffee"],sugarcane:["🎋","Sugarcane"],cotton:["☁️","Cotton"],rice:["🌾","Rice"],beans:["🫘","Beans"],wheat:["🌿","Wheat"],cassava:["🥔","Cassava"],orange:["🍊","Orange"],cocoa:["🍫","Cocoa"],banana:["🍌","Banana"],tomato:["🍅","Tomato"]};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const LABEL = {excellent:"Excellent",good:"Good",fair:"Fair",poor:"Avoid"};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = iso => { const [y,m,d] = iso.split("-").map(Number); return {d, wd:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(y,m-1,d).getDay()], m:MONTHS[m-1].slice(0,3)}; };
const today = new Date();
let crop = "soy", month = today.getMonth()+1, coords = null, days = [];

function pills(box, items, isActive, onPick, cls) {
  items.forEach(([id, html]) => { const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.innerHTML = html; b.setAttribute("aria-pressed", isActive(id));
    b.onclick = () => { onPick(id); box.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x===b)); };
    box.appendChild(b); });
}
pills($("chips"), Object.entries(CROPS).map(([id,[e,n]]) => [id, `<span>${e}</span>${n}`]), id => id===crop, id => crop = id, "chip");
pills($("months"), MONTHS.map((n,i) => [i+1, n]), id => id===month, id => month = id, "mp");
setTimeout(() => $("months").querySelector("[aria-pressed=true]")?.scrollIntoView({inline:"center", block:"nearest"}), 50);

function setCoords(lat, lon) {
  coords = {lat, lon}; $("loc").classList.add("ok");
  $("locTxt").innerHTML = `Location set ✓<small>${lat.toFixed(2)}, ${lon.toFixed(2)} · tap to update</small>`;
}
$("loc").onclick = () => {
  if (!navigator.geolocation) return say("Your browser can't detect your location. Type the coordinates instead.", true);
  $("locTxt").innerHTML = "Finding you…<small>Allow location access</small>";
  navigator.geolocation.getCurrentPosition(p => setCoords(p.coords.latitude, p.coords.longitude),
    () => { $("locTxt").innerHTML = "Use my location<small>That didn't work. Try again or type the coordinates.</small>"; },
    {timeout:10000});
};
["lat","lon"].forEach(id => $(id).oninput = () => {
  const la = parseFloat($("lat").value.replace(",", ".")), lo = parseFloat($("lon").value.replace(",", "."));
  if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) setCoords(la, lo);
});
function say(t, err) { $("status").innerHTML = t ? `<div class="msg ${err?"err":""}">${t}</div>` : ""; }

async function fetchDays() {
  const q = new URLSearchParams({lat:coords.lat.toFixed(4), lon:coords.lon.toFixed(4), crop, month, top:5});
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 70000); // first call per location can be slow
  try {
    const r = await fetch(`${API_URL}/v1/best-days?${q}`, {headers: API_KEY ? {"X-API-Key":API_KEY} : {}, signal:ctrl.signal});
    if (r.status === 429) throw new Error("Too many requests. Please wait a minute.");
    if (r.status === 401) throw new Error("Invalid access key.");
    if (r.status === 404) throw new Error("No data found for this location, month or crop.");
    if (r.status === 502) throw new Error("NASA data is unavailable right now. Please try again shortly.");
    if (!r.ok) throw new Error("Something went wrong. Please try again.");
    return {data: await r.json(), demo:false};
  } catch (e) {
    const offline = !e.message || /fetch|Failed|abort|Load failed|NetworkError/i.test(e.message);
    if (!offline) throw e;
    if (location.protocol === "file:") return {data: demo(), demo:true}; // opened as a plain file, no server
    throw new Error("Can't reach the server. Check your connection and try again.");
  } finally { clearTimeout(t); }
}

function demo() { // sample data, ONLY when the page is opened as a file without the backend
  const year = today.getFullYear() + (month < today.getMonth()+1 ? 1 : 0), n = new Date(year, month, 0).getDate(), out = [];
  for (let d = 1; d <= n; d++) {
    if (new Date(year, month-1, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) continue;
    const score = Math.round(Math.max(15, Math.min(98, 68 + 28*Math.sin(d*.55+month) - 12*Math.cos(d*1.3))));
    out.push({date:`${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`, score, rating:score>=75?"excellent":score>=60?"good":score>=40?"fair":"poor",
      favorable_chance_pct:Math.min(100,score+5), avg_temp_c:+(24+3*Math.sin(d)).toFixed(1), avg_rain_mm:+Math.max(0,3+4*Math.cos(d*.7)).toFixed(1),
      main_risks: score<60 ? ["soil too dry"] : []});
  }
  let bw = null; for (let i=0;i+5<=out.length;i++){const m=out.slice(i,i+5).reduce((s,x)=>s+x.score,0)/5; if(!bw||m>bw.avg_score) bw={start:out[i].date,end:out[i+4].date,avg_score:+m.toFixed(1)};}
  return {crop:CROPS[crop][1], best_days:[...out].sort((a,b)=>b.score-a.score).slice(0,5), best_window_5_days:bw, days:out,
    recent_conditions:{rain_total_mm:12.4, avg_soil_moisture:.52, min_temp_c:17.2, max_temp_c:31.5},
    disclaimer:"Estimate based on historical climate, not a weather forecast."};
}

function render(d, isDemo) {
  days = d.days; const w = d.best_window_5_days, name = esc(d.crop.toLowerCase());
  const gauge = v => `<div class="gauge"><b>${Math.round(v)}</b></div>`;
  if (w) { const a = fmt(w.start), b = fmt(w.end);
    $("best").innerHTML = `${gauge(w.avg_score)}<div><small>Best window to plant ${name}</small><div class="big">${a.m} ${a.d}–${b.d}</div><small>5 days in a row with the best conditions</small></div>`;
    $("best").firstChild.style.setProperty("--p", w.avg_score);
  } else { const t = d.best_days[0], a = fmt(t.date);
    $("best").innerHTML = `${gauge(t.score)}<div><small>Best day to plant ${name}</small><div class="big">${a.m} ${a.d}</div></div>`;
    $("best").firstChild.style.setProperty("--p", t.score); }

  $("top").innerHTML = d.best_days.map(x => { const f = fmt(x.date);
    return `<div class="day"><div class="n"><span>${f.wd}<b>${f.d}</b></span></div><div class="i"><strong>${x.favorable_chance_pct}% chance of good conditions</strong>${x.avg_temp_c}°C · rain ~${x.avg_rain_mm} mm${x.main_risks.length?` · watch out: ${esc(x.main_risks.join(", "))}`:""}</div><span class="tag">${LABEL[x.rating]}</span></div>`; }).join("");

  const year = +days[0].date.slice(0,4), first = new Date(year, month-1, 1).getDay(), n = new Date(year, month, 0).getDate();
  const map = Object.fromEntries(days.map(x => [+x.date.slice(8), x]));
  let h = ["S","M","T","W","T","F","S"].map(x => `<div class="wd">${x}</div>`).join("") + "<span></span>".repeat(first);
  for (let i = 1; i <= n; i++) { const x = map[i];
    h += x ? `<button class="c ${x.rating}" data-d="${i}" aria-pressed="false" aria-label="Day ${i}: ${LABEL[x.rating]}">${i}</button>` : `<button class="c off" disabled>${i}</button>`; }
  $("cal").innerHTML = h; $("detail").textContent = "Tap a day to see the details.";
  document.querySelectorAll(".c[data-d]").forEach(b => b.onclick = () => {
    document.querySelectorAll(".c").forEach(c => c.setAttribute("aria-pressed", c===b));
    const x = map[b.dataset.d];
    $("detail").innerHTML = `<strong>Day ${b.dataset.d}: ${LABEL[x.rating]} (${Math.round(x.score)}/100)</strong><br>🌡️ ${x.avg_temp_c}°C on average · 🌧️ rain ~${x.avg_rain_mm} mm<br>✅ ${x.favorable_chance_pct}% of past years had good conditions at this time${x.main_risks.length?`<br>⚠️ Risks: ${esc(x.main_risks.join(", "))}`:""}`; });

  const r = d.recent_conditions;
  $("recent").innerHTML = r ? `<h2>🛰️ How the field looks now</h2><div class="stats">
    <div class="stat"><b>${r.rain_total_mm ?? "–"} mm</b><span>rain in the last 7 days</span></div>
    <div class="stat"><b>${r.avg_soil_moisture!=null?Math.round(r.avg_soil_moisture*100)+"%":"–"}</b><span>soil moisture</span></div>
    <div class="stat"><b>${r.min_temp_c ?? "–"}°C</b><span>recent low</span></div>
    <div class="stat"><b>${r.max_temp_c ?? "–"}°C</b><span>recent high</span></div></div>` : "";
  $("disclaimer").textContent = d.disclaimer || "";
  $("res").hidden = false;
  say(isDemo ? "⚠️ Demo mode: no server found, so this is sample data." : "");
  $("res").scrollIntoView({behavior:"smooth", block:"start"});
}

$("go").onclick = async () => {
  if (!coords) { window.scrollTo({top:0, behavior:"smooth"}); say("First tell us where your farm is: tap “Use my location”.", true); return; }
  $("go").disabled = true; $("go").innerHTML = '<span class="spin"></span>Fetching NASA data…';
  say("The first search for a location can take up to 30 seconds.");
  try { const {data, demo:isDemo} = await fetchDays(); render(data, isDemo); }
  catch (e) { say(esc(e.message), true); }
  finally { $("go").disabled = false; $("go").textContent = "Find the best days"; }
};
