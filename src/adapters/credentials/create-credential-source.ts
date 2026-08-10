import type { BuildProfile } from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";
import { DeniedCredentialSource } from "./denied.js";
import { DevKeyOverrideCredentialSource } from "./dev-key-override.js";

/**
 * Test/helper factory that can select either adapter by profile.
 * Extension entrypoints use `active.ts` (build-aliased) so Store artifacts
 * never bundle Dev Key Override.
 */
export function createCredentialSourceForProfile(
  profile: BuildProfile,
): CredentialSource {
  if (profile === "dev") {
    return new DevKeyOverrideCredentialSource("test-key");
  }
  return new DeniedCredentialSource(
    "Connect via Access Service (coming soon). Store builds do not include Dev Key Override.",
  );
}
