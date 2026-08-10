# Strava Streets Plugin

Chrome Manifest V3 extension that shows a view-only Google Street View **Pano Window** on Strava’s **Route Builder**. Settings live in the **Extension Popup**. Domain language: [`CONTEXT.md`](CONTEXT.md). Design decisions: [`docs/adr/`](docs/adr/).

## Status (#8)

Map Click → Pano Window with **Dev Key Override** (sideload/dev). Access Service (#9/#11), Tip Follow behavior (#10), and real account wiring (#12) are follow-ups.

## Setup

```bash
cp .env.example .env
# Put your Google Maps JavaScript API key in .env:
# GOOGLE_MAPS_API_KEY=...

npm install
npm run build:dev    # sideload artifact with Dev Key Override
npm test
```

Store/production profile (no Dev Key Override adapter):

```bash
npm run build:store
```

## Sideload (Chrome)

1. `npm run build:dev`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**
3. Select the `dist/` folder
4. Open Strava Route Builder at `https://www.strava.com/maps/*` with the feature on in the popup
5. Click the map to set an **Anchor Point** and load Street View

Route Builder is **only** `https://www.strava.com/maps/*` — content script and Host Page matching use that pattern; elsewhere the extension does not inject / is a silent no-op.

## Layout

| Path | Role |
|------|------|
| `src/core/` | Extension application core (Anchor Point, Pano lifecycle, Coverage Gap) |
| `src/ports/` | Host Page, Credential source, Street View surface, Settings |
| `src/adapters/` | Strava Host Page, Maps JS surface (isolated-world RPC), Dev Key Override / Store deny, chrome.storage |
| `src/extension/` | MV3 background, content script, popup; **page-world** injectables (`maps-page-bridge`, `host-mre-bridge`) that cannot use `chrome.*` |
| `tests/` | Seam tests with fakes (no Strava DOM / Maps SDK internals); unit tests OK for pure helpers |
| `scripts/build.mjs` | esbuild; injects `.env` key into **dev** builds only |

## Popup

- Master **Street View / Pano** on/off
- **Tip Follow** on/off (default on, persisted; no-op until #10)
- Account row: **Dev build** (dev profile) or **Not connected** (store profile)

## Notes

- Non–Route Builder Strava pages: silent no-op (no Pano, no listeners, no toasts).
- **Coverage Gap**: keeps last successful Pano + “No Street View at this point”; never blanks or auto-snaps.
- `.env` is gitignored; only `.env.example` is committed.
