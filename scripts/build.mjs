#!/usr/bin/env node
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

const profileArg = process.argv.find((a) => a.startsWith("--profile="));
const profile = profileArg?.split("=")[1] === "store" ? "store" : "dev";

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  const values = {};
  if (!fs.existsSync(envPath)) return values;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  return values;
}

const env = loadEnvFile();
const mapsKey = profile === "dev" ? env.GOOGLE_MAPS_API_KEY ?? "" : "";
const accessOrigin =
  env.ACCESS_ORIGIN?.trim() || "http://127.0.0.1:8787";

if (profile === "dev" && !mapsKey) {
  console.warn(
    "[build] Warning: GOOGLE_MAPS_API_KEY missing from .env — Dev Key Override will deny credentials until set.",
  );
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const define = {
  __BUILD_PROFILE__: JSON.stringify(profile),
  __DEV_MAPS_API_KEY__: JSON.stringify(mapsKey),
  __ACCESS_ORIGIN__: JSON.stringify(accessOrigin),
};

const credentialActive =
  profile === "dev"
    ? path.join(root, "src/adapters/credentials/active.dev.ts")
    : path.join(root, "src/adapters/credentials/active.store.ts");

const credentialAliasPlugin = {
  name: "credential-profile-alias",
  setup(build) {
    build.onResolve(
      { filter: /adapters\/credentials\/active(\.ts|\.js)?$/ },
      () => ({ path: credentialActive }),
    );
  },
};

const shared = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  define,
  logLevel: "info",
  plugins: [credentialAliasPlugin],
};

await esbuild.build({
  ...shared,
  entryPoints: {
    background: path.join(root, "src/extension/background.ts"),
    content: path.join(root, "src/extension/content.ts"),
    popup: path.join(root, "src/extension/popup/popup.ts"),
  },
  outdir: dist,
  entryNames: "[name]",
});

// Page-world bridges must be classic IIFE (no chrome.*, no ESM).
await esbuild.build({
  entryPoints: [
    path.join(root, "src/extension/maps-page-bridge.ts"),
    path.join(root, "src/extension/host-mre-bridge.ts"),
  ],
  outdir: dist,
  entryNames: "[name]",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
});

fs.copyFileSync(
  path.join(root, "src/extension/popup/popup.html"),
  path.join(dist, "popup.html"),
);
fs.copyFileSync(
  path.join(root, "src/extension/popup/popup.css"),
  path.join(dist, "popup.css"),
);

const manifest = {
  manifest_version: 3,
  name: "Strava Streets",
  version: "0.1.0",
  description:
    "Street View beside Strava’s Route Builder — view-only Pano Window for route context.",
  permissions: ["storage"],
  host_permissions: [
    "https://www.strava.com/maps/*",
    // Access Service Mint + OAuth (cookies stay on this origin).
    `${accessOrigin.replace(/\/$/, "")}/*`,
  ],
  action: {
    default_popup: "popup.html",
    default_title: "Strava Streets",
  },
  background: {
    service_worker: "background.js",
    type: "module",
  },
  content_scripts: [
    {
      // Isolated world keeps chrome.* + avoids page JS collisions.
      // Maps JS + MRE lat/lng run via page-world bridges.
      matches: ["https://www.strava.com/maps/*"],
      js: ["content.js"],
      css: ["content.css"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["maps-page-bridge.js", "host-mre-bridge.js"],
      matches: ["https://www.strava.com/*"],
    },
  ],
};

fs.writeFileSync(
  path.join(dist, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
fs.copyFileSync(
  path.join(root, "src/extension/content.css"),
  path.join(dist, "content.css"),
);

console.log(`[build] profile=${profile} → ${dist}`);
