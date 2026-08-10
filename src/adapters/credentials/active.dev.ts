import type { CredentialSource } from "../../ports/index.js";
import { DevKeyOverrideCredentialSource } from "./dev-key-override.js";

/** Dev/sideload credential wiring — selected by build alias. */
export function createCredentialSource(): CredentialSource {
  return new DevKeyOverrideCredentialSource();
}
