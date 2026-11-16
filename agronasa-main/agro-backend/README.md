# AgroNASA

Web app + API that uses **NASA POWER** (satellite-derived daily climate data) to show farmers
the best days of the month to plant each crop. FastAPI serves both the API and the mobile-first front end.

## Run
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
export $(grep -v '^#' .env | xargs)
uvicorn app.main:app --reload --host 0.0.0.0
```
- App: http://localhost:8000
- API docs (development only): http://localhost:8000/docs
- On your phone (same Wi-Fi): `http://<your-computer-IP>:8000`
  (automatic geolocation needs HTTPS or localhost, so on a phone use the "type coordinates" option or deploy with HTTPS)

## API
| Method | Route | Description |
|---|---|---|
| GET | `/health` | Status |
| GET | `/v1/crops` | Supported crops |
| GET | `/v1/best-days?lat=-12.9&lon=-38.5&crop=coffee&month=11&top=5` | Ranked days |

Crops: soy, corn, coffee, sugarcane, cotton, rice, beans, wheat, cassava, orange, cocoa, banana, tomato.

## How the score works
For each day, the API compares the same period (+-3 days) in the previous 8 years and scores the conditions 0-100
against the crop's needs (`app/crops.py`): frost, heat, heavy rain, dry/waterlogged soil, wind.
It is a climate-based estimate, **not a weather forecast**.

## Security
Input validation, optional API key, per-IP rate limit, restricted CORS, security headers + strict CSP for the page,
docs disabled in production, generic error messages, fixed NASA host (no SSRF), timeouts/retries/bounded cache, non-root container.
The web app is public by design, so rate limiting is the real protection (an API key inside a front end can always be extracted).

## Deploy (example)
`docker build -t agronasa . && docker run -p 8000:8000 -e ENV=production -e TRUST_PROXY=true agronasa`
(put it behind HTTPS; set `TRUST_PROXY=true` only behind a trusted proxy).

## Tests
`pip install pytest && pytest -q`
