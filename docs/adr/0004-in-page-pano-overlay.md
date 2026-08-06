# Pano Window is an in-page overlay on the Route Builder

We considered a separate Chrome window or Side Panel to keep Strava’s DOM untouched. The chosen UX is a draggable, resizable floating overlay on the Route Builder so Street View stays visually tied to the map. Settings and on/off still live in the Extension Popup — we minimize Strava chrome injection, not the Pano itself. The overlay is torn down when leaving the Route Builder; position and size are remembered.
