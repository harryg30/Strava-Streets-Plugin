# Access Service owns Maps credentials; Dev Key Override is non-Store only

Store Phase users must not receive our master Google API key, and “everyone pastes their own key” fights billing and quota. The extension obtains a time-limited Grant from a project-owned Access Service after mint-entitlement and Quota checks. A Dev Key Override may exist for local debugging when the Access Service is down, and must never be enabled in Store builds.

Riders authenticate with Google OAuth; every successful login gets Role `base`. Role `base` is mint-entitled in the free tier. Paid Membership (Patreon-style, #12) is distinct from `base` and later changes tiers/caps — it is not required for Mint while free `base` remains entitled. Wire deny `membership_required` means **lacking mint entitlement**, not “lacking paid Membership.”

Quota counts successful Mints (Grants issued) per UTC calendar day against a configurable cap (default 100 for Role `base`). Denials return `403` with `membership_required` or `quota_exceeded`; unauthenticated Mint is `401`. Product Quota is rider fairness on Grants — not a count of Google Maps billable calls. Hard Maps spend control stays on Google’s side (restricted key, Cloud quotas/budgets).

Mint is a gated handoff of Google’s restricted Maps browser API key (from server env) plus a Grant TTL (`expires_at`, default 24h)—not a homemade credential and not a key-rotation / per-request GCP provisioning API. The master or unrestricted key never appears in client responses; the extension re-mints after expiry. Ops restricts that browser key to Maps JS / Street View with an HTTP referrer allowlist covering where the extension runs (`https://www.strava.com/maps/*` and any extra origins the load path needs).

Dev Key Override is a gitignored repo-level `.env` key injected at sideload/dev build time into a non-Store Credential source adapter — not a settings paste field and not readable as `.env` inside Chrome at runtime. We rejected in-Popup paste-key (even as a “power user” path) so Store and Personal stay one architecture with Access Service as the real credential path.

## Module shape (#9)

Access is an in-process Module with Interface `login` + `mint`. HTTP is a thin Adapter (cookies, status codes, Google OAuth exchange). Primary tests call Access directly; HTTP contract tests only check transport mapping.
