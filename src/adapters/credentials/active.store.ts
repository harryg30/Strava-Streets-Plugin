import type { CredentialSource } from "../../ports/index.js";
import { DeniedCredentialSource } from "./denied.js";

/**
 * Store/production credential wiring — selected by build alias.
 * No Dev Key Override import in this module.
 */
export function createCredentialSource(): CredentialSource {
  return new DeniedCredentialSource(
    "Connect via Access Service (coming soon). Store builds do not include Dev Key Override.",
  );
}
