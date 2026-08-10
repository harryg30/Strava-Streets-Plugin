# Strava Streets Plugin

A Chrome extension that shows Google Street View beside Strava’s Route Builder so the rider can see street-level context while drawing a route. On/off and settings live in the Extension Popup; the Pano Window is an in-page overlay on the Route Builder only (torn down when leaving that page; size/position remembered). Street View uses the official Google Maps JavaScript API. The Pano is view-only: it never edits the route.

Credentials: the Access Service is the real path (Google OAuth + `base` membership → daily mint quota → time-limited restricted Maps browser key). A Dev Key Override may exist for local debugging only and must not ship in Store builds. Google Maps cost is billed to the project’s Google Cloud account. Price mechanics stay flexible (likely Patreon tiers around $1/month and $5/month). Sideload is fine during development; Chrome Web Store listing can lag the Access Service.

## Language

**Route Builder**:
Strava’s map page for creating or editing a route (plotting the path before saving), at `https://www.strava.com/maps/*`.
_Avoid_: activity page, segment explorer, heatmap, treating `/routes/new` as the product URL

**Pano Window**:
A draggable, resizable floating overlay on the Route Builder that shows a Google Street View panorama. Closed from the overlay or when leaving the Route Builder; position and size are remembered across visits.
_Avoid_: separate Chrome window, side panel, replacing Strava’s map, full-tab navigate-away, surviving on other Strava pages

**Pano**:
The street-level 360° Street View image shown in the Pano Window for the current Anchor Point. View-only — looking around does not change the route.
_Avoid_: basemap, satellite, Google Maps (as the whole product)

**Anchor Point**:
The map location that determines which Pano is shown. Updated by Map Click, or by Tip Follow while drawing.
_Avoid_: waypoint, GPS fix

**Map Click**:
A click on the Route Builder map that sets the Anchor Point.
_Avoid_: map hover-follow

**Route Tip**:
The leading end of the route currently being drawn on the Route Builder.
_Avoid_: start point, saved route endpoint (unless drawing from there)

**Tip Follow**:
A mode (toggle in the Extension Popup, default on) that sets the Anchor Point from the Route Tip while the user is actively extending the route. When Tip Follow is off, or the user is idle (not placing), the Anchor Point stays put until a Map Click.
_Avoid_: always-track-selection, hover-follow

**Extension Popup**:
The UI opened from the extension’s Chrome toolbar icon. Holds a master Street View / Pano on/off, Tip Follow on/off (default on), and an account row (placeholder until Access Service / membership is wired). Not a home for pasting a Google API key.
_Avoid_: in-page settings panel, Store-facing “paste your API key”

**Coverage Gap**:
An Anchor Point with no Street View imagery. The Pano Window keeps showing the last successful Pano and tells the rider there is no Street View at this point; the surface should still look alive and working. The notice clears when a covered Anchor Point succeeds. “Covered” means imagery within a short search of the Anchor, shown as that resolved Pano — not a long pull to the nearest street. Before any successful Pano, a gap may show an empty viewport plus the notice.
_Avoid_: blanking a prior successful Pano, auto-snap to distant nearest imagery, treating a loose nearby hit then re-applying the raw click coordinate

**Access Service**:
The project-owned backend that authenticates riders with Google OAuth (every successful login gets role `base`), treats `base` as membership OK for mint (paid Patreon roles later), enforces a per-calendar-day successful-mint quota with a configurable cap, and mints a time-limited grant of the project’s restricted Google Maps browser API key so the extension can load Street View without exposing the master key. Mint denials use `403` with `membership_required` or `quota_exceeded`.
_Avoid_: shipping the Google API key in Store builds, “each user makes a Google Cloud account” as the product, homemade credentials, per-request GCP key provisioning

**Mint**:
The Access Service handoff that returns Google’s restricted Maps browser API key plus an `expires_at` grant TTL after membership and quota checks. The extension must re-mint after expiry.
_Avoid_: key-rotation API, minting a new GCP key per request, returning the master/unrestricted key

**Dev Key Override**:
A development-only Maps credential path for sideload builds when the Access Service is unavailable. The key comes from a gitignored repo-level `.env` and is injected at build time into non-Store artifacts only — never enabled in Store builds.
_Avoid_: user-facing “paste your API key”, runtime `.env` reads in the browser, shipping override code in Store builds

**Personal Phase**:
Author sideloading the extension while building; still speaks to the Access Service (or Dev Key Override), not a separate long-term architecture.
_Avoid_: treating sideload as a different product

**Store Phase**:
Chrome Web Store (or equivalent) distribution to other riders, with Access Service metering and membership (likely Patreon tiers).
_Avoid_: indefinitely personal-only, unpaid unlimited Maps usage for the public
