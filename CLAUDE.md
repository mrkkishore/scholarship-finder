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

The app is three files:

**`server.js`** — Node.js HTTP server (no Express). Routes are dispatched via a chain of `if (req.method === "..." && req.url === "...")` blocks. Key endpoints:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/status` | None | Budget usage + session state |
| `POST /auth/login` | None | Password → HttpOnly session cookie |
| `POST /auth/logout` | Session | Clear cookie |
| `POST /api/search-scholarships` | Session | Main discovery flow (see below) |
| `POST /api/assess-colleges` | Session | College admissions assessment + AI-suggested matches |
| `POST /api/college-scholarships` | Session | Institutional scholarships per listed college (grouped by school) |
| `POST /api/claude` | Session | Generic Claude proxy for essays/strategy/insights |
| `GET /*` | None | Static files from `public/` |

**`public/index.html`** — Single-page SPA. All CSS, HTML, and the main JS are inline. Six tabs: Discover, Apply, Insights, Strategy, Essays, Colleges. Navigation is the **left sidebar** (`.nav-item`) plus a mobile bottom nav (`.mbn-item`); the old horizontal top tab-bar was removed. `switchTab(name)` toggles `.active` on `.panel`, `.nav-item`, and `.mbn-item` in parallel. All state is in module-level `currentScholarships` and `currentColleges` arrays. The primary action is the combined **"Find Scholarships & Assess My Colleges"** button (`findAll()`) which fires all three backend calls in parallel and populates the Discover tab (national scholarships + college-specific scholarships) and the Colleges tab (admission assessment) simultaneously.

**`public/js/redesign.js`** — Deferred helper bundle (loaded with `<script defer>`). Renders the category-flow pills, the college map (pins from `public/data/college-coords.json`), and the per-college deadline/ranking **verification badges** (🌐 Web-verified vs ⚠ Confirm on official site) + past-deadline flags. References top-level identifiers from the inline script, so it must load after it.

## Main scholarship discovery flow

`POST /api/search-scholarships` does three things in sequence:

1. **Tavily web search** — runs 3 parallel queries built from the student profile (state + major + year + identity). Results are deduped by URL and injection-sanitized before use.
2. **Claude prompt** — builds a system prompt + enriched user prompt. When Tavily returns results, Claude is instructed to return **up to 12** scholarships grounded in those results, each with structured `eligibility_tags` and a `deadline_precision` flag. In AI-only fallback mode, it returns **4–8** conservative results. Claude must respond with a bare JSON array.
3. **Server-side guardrail pipeline** (after Claude responds, before the client sees anything) — parse the array, then in order:
   - **Eligibility filter** (`eligibilityDropReason`) — deterministically drop scholarships whose `eligibility_tags` don't match the student (state / major / gpa_min / sat_min / financial_need), or that lack tags. Each drop is logged to `logs/eligibility_drops.jsonl`.
   - **Past-deadline filter** (`deadlineIsPast`) — drop scholarships whose deadline is already in the past (cycle-aware). This *enforces* the prompt's "future only" rule rather than just asking for it.
   - **Calibrated precision** — downgrade `deadline_precision` to `inferred` when not Tavily-grounded; ensure empty amounts read "Amount varies".
   - **URL liveness** (`checkUrlHealth`, concurrency 8) — HEAD→GET, 5s timeout, 24h in-memory cache, **SSRF-guarded** (see Security). Annotates each result with `url_status` (`live`/`redirected`/`dead`/`unchecked`) and `final_url`. Redirects logged to `logs/redirects.jsonl`.
4. **Response** — forwarded with injected fields: `searchEnhanced`, `queriesSucceeded`, `grounding` (`tavily`/`ai_only`/`failed`), `droppedIneligible`, `droppedPastDeadline`.

The frontend parses Claude's JSON out of `data.content[0].text` using a regex (`/\[[\s\S]*\]/`), sorts by `estimatedApplicants/estimatedWinners` ratio, then calls `renderScholarships()`. Dead links show a "link broken — search" fallback; `grounding !== 'tavily'` shows a yellow fail-closed banner.

## College deadline/ranking verification

`POST /api/assess-colleges` runs **two** web-grounding passes so deadlines/rankings are verified for **all** colleges, not just listed ones:
1. **First pass** — for each *listed* school, a stats query + a dedicated deadline/ranking query (`buildCollegeDeadlineQuery`).
2. **Enrichment pass** (after Claude returns the full list incl. AI-suggested matches) — web-search every still-unverified school (cap 12, budget-guarded), then a **small second Claude call** (`anthropicMessagesAsync`) extracts the official deadlines + ranking from those snippets and merges them in. Each school carries `deadlinesVerified` / `rankingVerified`; the response adds `deadlineSearchedSchools` so the UI can show 🌐 Web-verified deterministically. Falls back to ⚠ unverified (never errors) if Tavily/extraction fails.

## Security model

**Authentication:** Session tokens identify human actors — not the `X-Actor-Id` header (removed; treat any code reading it as legacy). Machine clients use `X-API-Key` and get a synthetic `machine:ops` / `machine:admin` identity. Machines cannot approve rules in four-eyes contexts.

All of the following are enforced server-side and cannot be bypassed by the client:
- Model is hardcoded to `claude-sonnet-4-6`; `max_tokens` is capped at 6,000 (8,000 for college pool mode — the suggested-school pool needs more headroom). See `collegeMaxTokens` in `server.js`.
- Rate limits: 10 req/min on `/api/claude`, 3 req/min on `/api/search-scholarships`
- Daily token budget and daily Tavily call budget tracked in-memory (reset at midnight)
- Session tokens are 64-char hex, stored in-memory with 24h TTL
- Server binds to `127.0.0.1` only — not exposed on the network
- **SSRF protection** — the URL-liveness guardrail (`checkUrlHealth`) fetches URLs that originate from untrusted LLM/Tavily output. Every target host is DNS-resolved and rejected if it maps to a private / loopback / link-local / cloud-metadata (`169.254.169.254`) / unique-local address. Redirects are followed **manually** with the host re-validated on every hop (defends against redirect-to-internal and DNS rebinding). A blocked target is reported as `dead`. See `isPrivateIp` / `isHostPublic` / `fetchStatus`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Server exits on startup if missing |
| `ACCESS_PASSWORD` | Before sharing | — | Empty = open access (local dev only) |
| `PORT` | No | 3000 | |
| `DAILY_TOKEN_BUDGET` | No | 100,000 | Tokens across all users per day |
| `TAVILY_API_KEY` | No | — | Without it, search runs AI-only |
| `DAILY_SEARCH_CALLS` | No | 150 | ≈50 scholarship searches × 3 Tavily queries each |
| `DAILY_COLLEGE_CALLS` | No | 60 | Tavily budget for college assessment. Now covers **two** passes (listed-school deadline search + suggested-school enrichment), so ≈4–5 full assessments/day — raise it if you hit the cap |
| `NODE_ENV` | No | — | `development` mocks the URL-liveness checks (assume `live`, no outbound network) so guardrails work offline |

## Key implementation details

- **`apiFetch()` in the frontend** — wraps `fetch()` and shows a login overlay on any 401. All AI calls in the frontend go through this wrapper.
- **`simpleMarkdown()`** — lightweight markdown-to-HTML used for strategy/essay AI responses. Does not use a library.
- **Budget and session state are in-memory** — they reset on server restart. No database, no persistence layer.
- **Guardrail persistence is file-based, not a DB** — the URL-health cache is an in-memory `Map` (24h TTL); eligibility drops and redirect events are appended to `logs/*.jsonl`. `logs/` is gitignored. This is the deliberate substitute for the Supabase tables some specs assume — keep it zero-dependency.
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
| **Rate limits** | `/auth/login` → `isLoginRateLimited`; `/api/search-scholarships` → `isSearchRateLimited`; `/api/assess-colleges` + `/api/college-scholarships` → `isCollegeRateLimited`; `/api/claude` → `isRateLimited` |
| **Body size** | All `req.on("data")` handlers check against `MAX_BODY_BYTES` (32 KB) |
| **Model lock** | Claude calls use `FORCED_MODEL` (`claude-sonnet-4-6`); `/api/claude` capped at `MAX_TOKENS_CAP` (6,000); `/api/assess-colleges` uses `collegeMaxTokens` (6,000 normal / 8,000 pool mode); deadline-extraction call capped at 2,000 |
| **Secrets** | `.env` is in `.gitignore`; `server.log` / `server.err` are in `.gitignore`; API key is never logged |
| **Prompt injection** | Tavily results are sanitized with `INJECTION_RE` before reaching Claude; `<SEARCH_RESULTS>` / `<COLLEGE_SEARCH_DATA>` / `<COLLEGE_DEADLINE_DATA>` blocks are labeled untrusted; college names sanitized in `parseCollegeList()` |
| **SSRF (URL liveness)** | `checkUrlHealth` fetches LLM/Tavily-supplied URLs. Confirm `isHostPublic()` runs before **every** redirect hop and rejects private/loopback/link-local/metadata IPs; redirects are `manual` (never `redirect: "follow"`); blocked targets → `dead` |
| **Guardrail logging** | Eligibility drops + redirects go to `logs/*.jsonl`; `logs/` is in `.gitignore`; logs store a `student_profile_hash`, never raw PII |
| **Path traversal** | Static file handler uses `path.resolve` + `startsWith(PUBLIC_DIR)` guard |
| **CSP / headers** | `setSecurityHeaders()` is called on every response (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Content-Security-Policy) |
| **CORS** | Origin locked to `http://localhost:PORT`; no wildcard |
