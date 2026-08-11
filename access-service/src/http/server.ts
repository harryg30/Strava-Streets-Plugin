/**
 * Optional local server entry — Access + non-Google OAuth stand-in for manual smoke.
 * Does not call Google. Production must wire a real GoogleOAuthPort Adapter.
 */
import { createServer } from "node:http";
import { createAccess } from "../access/create-access.js";
import { createHttpApp } from "./create-http-app.js";
import { createDevOAuthStandIn } from "./dev-oauth-stand-in.js";

const key = process.env.MAPS_BROWSER_KEY ?? "dev-restricted-key-not-for-prod";

const { access } = createAccess({
  restrictedMapsBrowserKey: key,
  dailyMintCapByRole: { base: 100 },
});

const { handler } = createHttpApp(access, createDevOAuthStandIn());
const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  void handler(req, res);
});
server.listen(port, () => {
  console.log(`Access Service listening on http://127.0.0.1:${port}`);
  console.log(
    "OAuth callback uses a non-Google stand-in (code → googleAccountId). Not for production.",
  );
});
