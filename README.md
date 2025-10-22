# Promptify Backend (Node.js + Express)

AI-powered HTML/CSS/JS generator for Promptify. Accepts form data, optional logo/background images, and returns a **single-file index.html**.

## Endpoints

- `GET /api/health` — health check
- `POST /api/generate` — multipart/form-data
  - Fields: `name`, `ticker`, `prompt`, `colors[primary]`, `colors[accent]`, `colors[bg]`, `xurl`, `tgurl`
  - Files: `logo` (image, optional), `bg` (image, optional)
  - Response: `{ html }`

## Dev

```bash
npm install
cp .env.example .env   # put your OPENAI_API_KEY=...
npm run dev
```

## Deploy (Render)

- New Web Service → Node
- Build Command: `npm install`
- Start Command: `npm start`
- Environment:
  - `OPENAI_API_KEY` (required)
  - `ALLOWED_ORIGINS` (comma-separated frontend origins)
  - `MODEL` (e.g., gpt-5)
  - `MAX_TOKENS`, `TEMPERATURE` (optional)
- Enable auto-deploy from your repo.

## Frontend usage (fetch)

```js
async function callBackend(formEl){
  const fd = new FormData(formEl);
  const res = await fetch('https://<your-render-domain>/api/generate', { method:'POST', body: fd });
  const json = await res.json();
  // json.html is the single-file site
}
```

## Notes

- Uses **OpenAI Responses API** (`openai` SDK v4). 
- Returns a **complete single-file HTML**; no external requests.
- Simple guards: CORS allowlist, rate limiting, 2MB upload limit.
