# Hard architectural rules (do not violate)

These are non-negotiable for the **Scholarship Finder** app. They reflect the
choices the codebase is built on; violating them reintroduces the exact failure
modes the guardrails were added to prevent.

## 1. Zero dependencies. Node.js stdlib only.

- `package.json` has **no** `dependencies`. Do not add npm packages, a database,
  or a framework. Use built-ins: `http`, `https`, `fs`, `path`, `crypto`, `net`,
  `dns`, and global `fetch`.
- Persistence is in-memory `Map`s + local `logs/*.jsonl`. There is **no Supabase /
  Postgres / ORM** here — if a spec asks for DB tables, implement them as
  in-memory caches + JSONL logs instead.

## 2. The server, not the LLM, is the source of truth for safety-critical data.

The model proposes; deterministic server code disposes. Never rely on the prompt
alone for anything the user acts on:

- **Eligibility** — enforced by `eligibilityDropReason` against structured
  `eligibility_tags`, not by trusting prose. Drops are logged.
- **Deadlines** — `deadlineIsPast` deterministically drops stale dates;
  `deadline_precision` is downgraded to `inferred` when not Tavily-grounded.
- **College deadlines/rankings** — verified by a web-grounded enrichment pass and
  flagged `deadlinesVerified` / `rankingVerified`; the UI badge is driven by the
  server's `deadlineSearchedSchools`, not a model claim.

If you add a new "the AI says X is safe/eligible/current" behavior, back it with a
deterministic server check.

## 3. All outbound fetches of LLM/Tavily-supplied URLs go through the SSRF guard.

- Never call `fetch(url, { redirect: "follow" })` on a model/search-supplied URL.
  Use the `fetchStatus` path, which validates the host (`isHostPublic`) before
  every hop and follows redirects manually.
- Private / loopback / link-local / metadata IPs must be blocked. Do not weaken
  `isPrivateIp`.

## 4. Lock the model and the budget.

- Claude calls use `FORCED_MODEL`; never accept a client model/temperature.
  Respect the `max_tokens` caps. New AI calls must record usage (`recordUsage`).
- Respect the in-memory daily token + Tavily budgets and fail closed (429) when
  exhausted. New Tavily usage must `recordSearchCalls` / `recordCollegeCalls`.

## 5. Escape everything the AI returns before it hits the DOM.

- `escHtml()` for any AI string in `innerHTML`; `escUrl()` (forces `https://`) for
  any AI URL in `href`. No exceptions.

## 6. Auth + limits on every non-public endpoint.

- Call `isAuthenticated(req)` first, then the right rate limiter, then enforce
  `MAX_BODY_BYTES` on the body stream — before doing any real work.

## 7. Keep AI output factual; tone-modifier commands never touch student data.

- Do not let `/honest`, `/brutal`, etc. change the *data* (tiers, deadlines,
  amounts, eligibility) shown to a student. They only affect dev-facing prose.
