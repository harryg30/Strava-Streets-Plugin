# Strava Streets Plugin

Chrome extension that shows a view-only Google Street View **Pano Window** on Strava’s **Route Builder**. Domain language: [`CONTEXT.md`](CONTEXT.md). Design decisions: [`docs/adr/`](docs/adr/).

## Status

- **#8** Map Click → Pano lives on `feature/issue-8-map-click-pano` (not yet on `main`).
- **#9** Access Service HTTP API: see [`access-service/`](access-service/).

## Access Service (#9)

```bash
cd access-service
npm install
npm test
```

Mint surface: `POST /v1/credentials/mint` after Google OAuth callback sets a session cookie. Details in [`access-service/README.md`](access-service/README.md).
