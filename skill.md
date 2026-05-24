## Hard architectural rules (do not violate)

These are non-negotiable. They reflect lessons paid for during the hardening roadmap. Violating them creates the exact failure modes the prompts were designed to prevent.

## 2. Never store passwords. Only bcrypt hashes.

- All password handling goes through `api/auth/passwords.py`. Do not import bcrypt directly elsewhere.
- The `users.password_hash` column stores bcrypt output (starts with `$2b$`). If you see plaintext anywhere — logs, error messages, response bodies — it's a security bug, file an issue.
- Login error messages are **deliberately generic**. "Invalid username or password" — never "user not found" or "wrong password." Username enumeration is a real attack vector.

### 3. Session tokens, not headers, identify the human actor

- `X-Actor-Id` header is **no longer trusted**. If you see code reading it directly, that's legacy and should be replaced with `current_user` from the session.
- The server derives the actor from the session cookie or `Authorization: Bearer` token. The frontend never sends an actor identity — it sends a session, and the server looks up who that session belongs to.
- The exception: machine clients using API keys (`X-API-Key` header) have a synthetic actor identity like `machine:ops` or `machine:admin`. These should never appear in four-eyes approval contexts (a machine cannot "approve" a rule a human submitted).

### 4. Four-eyes approval is enforced server-side, every time

- `engine/approval.py` is the authoritative state machine. Do not bypass it.
- DRAFT → ACTIVE is **forbidden**. Must transit through PENDING_APPROVAL.
- Approver ≠ Submitter. Bulk approve respects this per-rule.
- Admins do NOT bypass the approval gate. Only ARCHIVED accepts admin shortcut.
- Validation runs on PENDING_APPROVAL → ACTIVE (and on DRAFT → PENDING_APPROVAL). Adding new conflict-detection logic? Put it in `agent/validation_agent.py` as a deterministic Python check, not a Claude call.
