# 🎓 Scholarship Finder — Local Setup

AI-powered tool to discover underutilized college scholarships. Powered by Claude.

## Prerequisites
- Node.js 16+ installed → https://nodejs.org

## Setup (3 steps)

### 1. Add your API key
```bash
cp .env.example .env
```
Open `.env` and replace `sk-ant-your-key-here` with your real key from:
https://console.anthropic.com/settings/keys

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
```
http://localhost:3000
```

## Security model
- ✅ API key lives only in `.env` (never in browser)
- ✅ `.env` is in `.gitignore` — safe to push to GitHub
- ✅ Rate limit: 10 requests/minute per IP
- ✅ Model and token limits enforced server-side

## Project structure
```
scholarship-finder/
├── server.js          ← Node proxy server (keeps API key secure)
├── public/
│   └── index.html     ← Full frontend app
├── .env               ← Your API key (DO NOT COMMIT)
├── .env.example       ← Template (safe to commit)
├── .gitignore
└── package.json
```

## Moving to GitHub Pages later
When you're ready to publish publicly, the architecture will shift:
- Frontend stays as static HTML on GitHub Pages
- Backend moves to a free serverless host (Vercel/Netlify Functions)
- API key stored as an environment secret on the host

We'll handle that step when you're ready.
