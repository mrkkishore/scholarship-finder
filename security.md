# Security

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities. Email the
maintainer directly or use GitHub's private vulnerability reporting feature
(**Security → Report a vulnerability**).

---

## Authentication system

### Session tokens

- Generated with `secrets.token_urlsafe(32)` — 256 bits of entropy.
- The plaintext token is sent to the browser as an **HttpOnly, SameSite=Lax,
  Secure** cookie named `pre_session`. JavaScript cannot read it.
- Only the **SHA-256 hex digest** of the token is stored in the database. If the
  `user_sessions` table is leaked, an attacker cannot recover valid tokens without
  brute-forcing 256-bit entropy.
- Sessions expire after 8 hours (configurable via `URE_SESSION_HOURS`).

### Password storage

- All passwords are hashed with **bcrypt** at cost factor 12 (industry baseline 2026).
  Adjust via `URE_BCRYPT_ROUNDS`.
- `verify_password()` uses `bcrypt.checkpw()` — constant-time comparison.
- On every successful login the hash is transparently re-bcrypted if the stored
  cost factor is lower than the current setting — no migration step required.
- Plaintext passwords are **never** logged, stored in exceptions, or echoed.

### Login hardening

- Failed and successful login responses both go through `verify_password()` on a
  real or dummy hash. This prevents timing-based username enumeration.
- All failure responses return the same generic message: *"Invalid username or
  password."* — there is no "user not found" vs. "wrong password" distinction.
- After **5 consecutive failures** the account is locked for **15 minutes**
  (`locked_until` column). The lock expires automatically.
- `POST /auth/login` is rate-limited to **20 requests/minute per IP** via
  slowapi. Configurable via `URE_LOGIN_RATE_LIMIT`.
- Changing a password revokes **all other active sessions** for that user
  (other devices are forced to re-authenticate).

### Actor identity

The `X-Actor-Id` request header is **not trusted**. If received, it is logged
at DEBUG level and discarded. The actor identity on every request is derived
entirely server-side:

| Auth method | Actor ID |
|---|---|
| `pre_session` cookie | Human user looked up from `user_sessions` table |
| `Authorization: Bearer <token>` | Human user looked up from `user_sessions` table |
| `X-API-Key` header | Synthetic machine identity (`machine:ops` or `machine:admin`) |

Machine identities (`machine:*`) are excluded from four-eyes approval contexts —
a machine client cannot act as approver for a rule submitted by a human.
