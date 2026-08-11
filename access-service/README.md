# Access Service (issue #9)

HTTP API + tests for Minting Grants after Google identity and Quota checks. Extension client is #11.

## Shape

- **Access Module** (`src/access/`): `login(GoogleIdentity) → Session`, `mint(Session) → Grant | denial`
- **HTTP Adapter** (`src/http/`): OAuth callback → `login`; `POST /v1/credentials/mint` → status mapping
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
| `POST` | `/v1/auth/google/callback` | Body `{ code, redirect_uri }` → Set-Cookie `access_session`. Inject a real `GoogleOAuthPort` in production. |
| `POST` | `/v1/credentials/mint` | Cookie required → `200 { credential, expires_at }` or `401` / `403 { error }` |

## OAuth note

`npm start` and `createDevOAuthStandIn()` are a **non-Google smoke stand-in**: the authorization `code` is treated as `googleAccountId`. They do not call Google. Ship a real Google token/ID exchange Adapter before any non-local deploy.

## Env

- `MAPS_BROWSER_KEY` — restricted Maps browser key (never master / unrestricted)
- `PORT` — default `8787` for `npm start`

## Ops (GCP key restrictions)

Configure the Maps browser key in Google Cloud as:

- APIs: Maps JavaScript API / Street View (as needed for the Pano load path)
- HTTP referrer allowlist must include `https://www.strava.com/maps/*` (Route Builder). Document any extra origins if the load path needs them (none required for #9 HTTP-only).
