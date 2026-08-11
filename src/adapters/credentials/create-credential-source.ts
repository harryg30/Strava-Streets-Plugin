import type { BuildProfile } from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";
import { AccessCredentialSource } from "./access-credential-source.js";
import { DevKeyOverrideCredentialSource } from "./dev-key-override.js";

/**
 * Test/helper factory for profile selection only.
 * "store" returns a bare AccessCredentialSource (no Dev Key) — not the
 * production Store wiring (`active.store` → BackgroundCredentialProxy).
 * Extension entrypoints use build-aliased `active.ts` so Store artifacts
 * never bundle Dev Key Override.
 */
export function createCredentialSourceForProfile(
  profile: BuildProfile,
): CredentialSource {
  if (profile === "dev") {
    return new DevKeyOverrideCredentialSource("test-key");
  }
  return new AccessCredentialSource({
    transport: {
      async mint() {
        return { ok: false, denial: { kind: "unauthenticated" } };
      },
    },
    browserSession: {
      async openAccessLogin() {},
    },
    accessOrigin: "http://127.0.0.1:8787",
  });
}
