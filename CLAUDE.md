# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server (only command needed)
node server.js

# The server restarts are required to pick up any server.js changes
# Kill and restart:
#   Windows:  Get-Process node | Stop-Process -Force; node server.js
#   Unix:     pkill node && node server.js
```

No build step, no install step, no test suite. Zero npm dependencies — pure Node.js stdlib only.

## Architecture

The entire app is two files:

**`server.js`** — Node.js HTTP server (no Express). Routes are dispatched via a chain of `if (req.method === "..." && req.url === "...")` blocks. Key endpoints:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/status` | None | Budget usage + session state |
| `POST /auth/login` | None | Password → HttpOnly session cookie |
| `POST /auth/logout` | Session | Clear cookie |
| `POST /api/search-scholarships` | Session | Main discovery flow (see below) |
| `POST /api/assess-colleges` | Session | College admissions assessment + AI-suggested matches |
| `POST /api/claude` | Session | Generic Claude proxy for essays/strategy/insights |
| `GET /*` | None | Static files from `public/` |

**`public/index.html`** — Single-file SPA. All CSS (~700 lines), HTML, and JS (~800 lines) are inline. Five tabs: Discover, Apply, Insights, Strategy, Essays. Tab switching uses `switchTab(name)` which toggles `.active` on `.tab`, `.panel`, and `.nav-item` elements in parallel. All state is in the module-level `currentScholarships` array.

## Main scholarship discovery flow

`POST /api/search-scholarships` does three things in sequence:

1. **Tavily web search** — runs 3 parallel queries built from the student profile (state + major + year + identity). Results are deduped by URL and injection-sanitized before use.
2. **Claude prompt** — builds a system prompt + enriched user prompt. When Tavily returns results, Claude is instructed to return **up to 12** scholarships grounded in those results. In AI-only fallback mode, it returns **4–8** conservative results. Claude must respond with a bare JSON array.
3. **Response** — the raw Claude API response is forwarded to the client with two extra fields injected: `searchEnhanced` (bool) and `queriesSucceeded` (int).

The frontend parses Claude's JSON out of `data.content[0].text` using a regex (`/\[[\s\S]*\]/`), sorts by `estimatedApplicants/estimatedWinners` ratio, then calls `renderScholarships()`.

## Security model

**Authentication:** Session tokens identify human actors — not the `X-Actor-Id` header (removed; treat any code reading it as legacy). Machine clients use `X-API-Key` and get a synthetic `machine:ops` / `machine:admin` identity. Machines cannot approve rules in four-eyes contexts.

All of the following are enforced server-side and cannot be bypassed by the client:
- Model is hardcoded to `claude-sonnet-4-6`; `max_tokens` is capped at 6,000
- Rate limits: 10 req/min on `/api/claude`, 3 req/min on `/api/search-scholarships`
- Daily token budget and daily Tavily call budget tracked in-memory (reset at midnight)
- Session tokens are 64-char hex, stored in-memory with 24h TTL
- Server binds to `127.0.0.1` only — not exposed on the network

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Server exits on startup if missing |
| `ACCESS_PASSWORD` | Before sharing | — | Empty = open access (local dev only) |
| `PORT` | No | 3000 | |
| `DAILY_TOKEN_BUDGET` | No | 100,000 | Tokens across all users per day |
| `TAVILY_API_KEY` | No | — | Without it, search runs AI-only |
| `DAILY_SEARCH_CALLS` | No | 150 | ≈50 scholarship searches × 3 Tavily queries each |
| `DAILY_COLLEGE_CALLS` | No | 60 | Separate Tavily budget for college assessment (≈10 assessments × 6 colleges each) |

## Key implementation details

- **`apiFetch()` in the frontend** — wraps `fetch()` and shows a login overlay on any 401. All AI calls in the frontend go through this wrapper.
- **`simpleMarkdown()`** — lightweight markdown-to-HTML used for strategy/essay AI responses. Does not use a library.
- **Budget and session state are in-memory** — they reset on server restart. No database, no persistence layer.
- **Tavily search queries** are privacy-safe by design: they never include the student's name, school name, or GPA.
- **Top 50 school pool** — if the student lists fewer than 3 out-of-state schools, `/api/assess-colleges` automatically injects the US News 2026 top-ranked list for their major (Business/CS/Engineering/Pre-Med) into the Claude prompt so suggestions are drawn from a verified pool rather than free-form generation.
- **`escHtml()` / `escUrl()`** — all AI-returned string values are HTML-entity-encoded before insertion into `innerHTML`; application URLs are validated and forced to `https://` before use in `href` attributes.

## AI output behavior rules

**Do not** apply tone-modifier slash commands (`/honest`, `/brutal`, or similar) to scholarship or college assessment results. These commands change Claude Code's response *style* — they must not influence the *data* presented to the student.

College tier assignments (`safety` / `target` / `reach` / `longshot`) and scholarship descriptions must be grounded solely in:
- Verified acceptance-rate statistics (from Tavily live data or Claude's Common Data Set knowledge)
- The student's actual GPA, test scores, and profile
- The US News 2026 verified rankings injected into the system prompt

Applying `/honest` or `/brutal` framing to admissions data would distort the tier thresholds and mislead the student. Keep AI output factual and neutral.

## Slash commands for this project

### `/security-review`

Run before every `git commit`. Checks:

| Area | What to verify |
|---|---|
| **XSS** | All AI-returned fields use `escHtml()` before `innerHTML`; URLs use `escUrl()` |
| **Auth** | Every non-public endpoint calls `isAuthenticated(req)` before processing |
| **Rate limits** | `/auth/login` → `isLoginRateLimited`; `/api/search-scholarships` → `isSearchRateLimited`; `/api/assess-colleges` → `isCollegeRateLimited`; `/api/claude` → `isRateLimited` |
| **Body size** | All `req.on("data")` handlers check against `MAX_BODY_BYTES` (32 KB) |
| **Model lock** | Claude calls use `FORCED_MODEL` (`claude-sonnet-4-6`); `max_tokens` never exceeds `MAX_TOKENS_CAP` (6,000) |
| **Secrets** | `.env` is in `.gitignore`; `server.log` / `server.err` are in `.gitignore`; API key is never logged |
| **Prompt injection** | Tavily results are sanitized with `INJECTION_RE` before reaching Claude; college names are sanitized in `parseCollegeList()` |
| **Path traversal** | Static file handler uses `path.resolve` + `startsWith(PUBLIC_DIR)` guard |
| **CSP / headers** | `setSecurityHeaders()` is called on every response (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Content-Security-Policy) |
| **CORS** | Origin locked to `http://localhost:PORT`; no wildcard |
