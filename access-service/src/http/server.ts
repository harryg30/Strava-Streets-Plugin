/**
 * Optional local server entry — Access + fake OAuth for manual smoke.
 * Production wires a real GoogleOAuthPort Adapter.
 */
import { createServer } from "node:http";
import { createAccess } from "../access/create-access.js";
import { createHttpApp, type GoogleOAuthPort } from "./create-http-app.js";

const key = process.env.MAPS_BROWSER_KEY ?? "dev-restricted-key-not-for-prod";

const oauth: GoogleOAuthPort = {
  async exchangeCode(code) {
    // Dev stand-in: treat code as googleAccountId. Replace with Google token exchange.
    return { googleAccountId: code };
  },
};

const { access } = createAccess({
  restrictedMapsBrowserKey: key,
  dailyMintCapByRole: { base: 100 },
});

const { handler } = createHttpApp(access, oauth);
const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  void handler(req, res);
});
server.listen(port, () => {
  console.log(`Access Service listening on http://127.0.0.1:${port}`);
});
