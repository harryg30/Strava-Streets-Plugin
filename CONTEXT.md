# Strava Streets Plugin

A Chrome extension that shows Google Street View beside Strava’s Route Builder so the rider can see street-level context while drawing a route. On/off and settings live in the Extension Popup; the Pano Window is an in-page overlay on the Route Builder only (torn down when leaving that page; size/position remembered). Street View uses the official Google Maps JavaScript API. The Pano is view-only: it never edits the route.

Credentials: the Access Service is the real path (membership → quota → short-lived Maps access). A Dev Key Override may exist for local debugging only and must not ship in Store builds. Google Maps cost is billed to the project’s Google Cloud account. Price mechanics stay flexible (likely Patreon tiers around $1/month and $5/month). Sideload is fine during development; Chrome Web Store listing can lag the Access Service.

## Language

**Route Builder**:
Strava’s map page for creating or editing a route (plotting the path before saving).
_Avoid_: activity page, segment explorer, heatmap

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
The UI opened from the extension’s Chrome toolbar icon. Holds on/off, Tip Follow, and account/access status — not a permanent home for a raw Google API key in Store builds.
_Avoid_: in-page settings panel

**Coverage Gap**:
An Anchor Point with no Street View imagery. The Pano Window shows an empty state and keeps showing the last successful Pano until a covered Anchor Point is chosen.
_Avoid_: auto-snap to nearest imagery

**Access Service**:
The project-owned backend that checks membership/billing, enforces quota, and provides short-lived credentials so the extension can load Street View without exposing the master Google key.
_Avoid_: shipping the Google API key in Store builds, “each user makes a Google Cloud account” as the product

**Dev Key Override**:
A development-only way to supply a Google Maps API key locally when the Access Service is unavailable. Never enabled in Store builds.
_Avoid_: user-facing “paste your API key” as the Store Phase product

**Personal Phase**:
Author sideloading the extension while building; still speaks to the Access Service (or Dev Key Override), not a separate long-term architecture.
_Avoid_: treating sideload as a different product

**Store Phase**:
Chrome Web Store (or equivalent) distribution to other riders, with Access Service metering and membership (likely Patreon tiers).
_Avoid_: indefinitely personal-only, unpaid unlimited Maps usage for the public
