# Access Service owns Maps credentials; Dev Key Override is non-Store only

Store Phase users must not receive our master Google API key, and “everyone pastes their own key” fights billing and quota. The extension obtains short-lived Maps access from a project-owned Access Service after membership and quota checks. A Dev Key Override may exist for local debugging when the Access Service is down, and must never be enabled in Store builds.

Riders authenticate with Google OAuth; every successful login gets role `base`, which is membership OK for mint. Paid Patreon roles come later. Quota counts successful mints per calendar day against a configurable cap. Denials return `403` with `membership_required` or `quota_exceeded`.

Mint is a gated handoff of Google’s restricted Maps browser API key (from server env) plus a grant TTL (`expires_at`)—not a homemade credential and not a key-rotation / per-request GCP provisioning API. The master or unrestricted key never appears in client responses; the extension re-mints after expiry. Ops restricts that browser key to Maps JS / Street View with an HTTP referrer allowlist covering where the extension runs (`https://www.strava.com/maps/*` and any extra origins the load path needs).

Dev Key Override is a gitignored repo-level `.env` key injected at sideload/dev build time into a non-Store Credential source adapter — not a settings paste field and not readable as `.env` inside Chrome at runtime. We rejected in-Popup paste-key (even as a “power user” path) so Store and Personal stay one architecture with Access Service as the real credential path.
