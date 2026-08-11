import type { CredentialSource } from "../../ports/index.js";
import { BackgroundCredentialProxy } from "./background-credential-proxy.js";

/**
 * Store/production credential wiring — selected by build alias.
 * No Dev Key Override import in this module.
 * Mint + Grant cache live in the background AccessCredentialSource.
 */
export function createCredentialSource(): CredentialSource {
  return new BackgroundCredentialProxy();
}
