/**
 * Local server entry — wires Access + Google Auth Adapters.
 * Uses production Google OAuth when client env is set; otherwise the fake Adapter.
 */
import { createServer } from "node:http";
import { createAccess } from "../access/create-access.js";
import { createFakeGoogleAuth } from "../google-auth/create-fake-google-auth.js";
import { createGoogleOAuth } from "../google-auth/create-google-oauth.js";
import type { GoogleAuth } from "../google-auth/types.js";
import { createHttpApp } from "./create-http-app.js";
import { loadAccessServiceEnv } from "./load-env.js";

loadAccessServiceEnv();

const key = process.env.MAPS_BROWSER_KEY ?? "dev-restricted-key-not-for-prod";
const port = Number(process.env.PORT ?? 8787);
const publicOrigin =
  process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;

const { access } = createAccess({
  restrictedMapsBrowserKey: key,
  dailyMintCapByRole: { base: 100 },
});

function createGoogleAuthFromEnv(): { auth: GoogleAuth; mode: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const stateSecret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ?? clientSecret ?? "";

  if (clientId && clientSecret && stateSecret) {
    return {
      auth: createGoogleOAuth({ clientId, clientSecret, stateSecret }),
      mode: "production Google OAuth",
    };
  }

  return {
    auth: createFakeGoogleAuth(),
    mode: "fake Adapter (set GOOGLE_OAUTH_CLIENT_ID/SECRET for Google)",
  };
}

const { auth, mode } = createGoogleAuthFromEnv();
const { handler } = createHttpApp(access, auth, { publicOrigin });

const server = createServer((req, res) => {
  void handler(req, res);
});
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Access Service listening on ${publicOrigin}`);
  console.log(`OAuth Adapter: ${mode}`);
  console.log(`Start login: ${publicOrigin}/v1/auth/google/start`);
});
