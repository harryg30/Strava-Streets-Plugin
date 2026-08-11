# Access Service (issues #9 / #14)

HTTP API + tests for Minting Grants after Google identity and Quota checks. Extension client is #11.

## Shape

- **Access Module** (`src/access/`): `login(GoogleIdentity) → Session`, `mint(Session) → Grant | denial`
- **Google Auth Module** (`src/google-auth/`): `begin(redirectUri) → { authorizeUrl, state }`, `complete({ code, state, redirectUri }) → GoogleIdentity`
- **HTTP Adapter** (`src/http/`): start redirect + callback → `login`; `POST /v1/credentials/mint` → status mapping
- **Internal stores**: in-memory Quota + Session (file/DB later without changing Access Interface)

## Commands

```bash
cd access-service
npm install
npm test
npm run typecheck
```

## HTTP (MVP)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/v1/auth/google/start` | 302 to Google (or fake bounce). Sets `oauth_state` cookie. `redirect_uri` is `{PUBLIC_ORIGIN}/v1/auth/google/callback`. |
| `GET` | `/v1/auth/google/callback` | Query `code` + `state` → Set-Cookie `access_session`. |
| `POST` | `/v1/auth/google/callback` | Body `{ code, state }` → same as GET. **Test/transport only** — not extension login UX (#11). |
| `POST` | `/v1/credentials/mint` | Cookie required → `200 { credential, expires_at }` or `401` / `403 { error }` |

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `MAPS_BROWSER_KEY` | for real Mint | Restricted Maps browser key (never master / unrestricted) |
| `PORT` | no | Default `8787` |
| `PUBLIC_ORIGIN` | for OAuth | Default `http://127.0.0.1:$PORT`. Must match a GCP authorized redirect URI base. |
| `GOOGLE_OAUTH_CLIENT_ID` | for Google | Web client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | for Google | Server-only; never ship in the extension |
| `GOOGLE_OAUTH_STATE_SECRET` | recommended | HMAC secret for CSRF `state`; defaults to client secret if unset |

When Google client env is missing, `npm start` uses the **fake** Google Auth Adapter (`code` → `googleAccountId` after state check). CI never calls live Google.

## Setup wizard (local OAuth credentials)

```bash
./scripts/setup-google-oauth.sh
```

Walks through GCP consent screen + Web client, writes `access-service/.env` (gitignored). Then `cd access-service && npm start` and open `/v1/auth/google/start`.

## Ops — GCP OAuth Web client (#14)

1. In the GCP project that owns the restricted Maps browser key (or a dedicated auth project — document which), configure an **OAuth consent screen** (External or Internal as appropriate).
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Authorized redirect URIs must include:
   - Local: `http://127.0.0.1:8787/v1/auth/google/callback` (or your `PUBLIC_ORIGIN` + `/v1/auth/google/callback`)
   - Deployed: `https://<access-host>/v1/auth/google/callback` once known
4. Scope used by the production Adapter: `openid`. Rider subject is Google **`sub`** → `googleAccountId` (not email).
5. Put `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and preferably `GOOGLE_OAUTH_STATE_SECRET` in a gitignored server env / secret store — never in extension / Store builds.

## Ops (GCP Maps key restrictions)

Configure the Maps browser key in Google Cloud as:

- APIs: Maps JavaScript API / Street View (as needed for the Pano load path)
- HTTP referrer allowlist must include `https://www.strava.com/maps/*` (Route Builder). Document any extra origins if the load path needs them.
