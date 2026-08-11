import type { CredentialResult } from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";

/**
 * Store/production credential stub until Access Service lands (#9/#11).
 * No Dev Key Override path — master key never ships in Store builds.
 */
export class DeniedCredentialSource implements CredentialSource {
  constructor(
    private readonly reason = "Street View access is not available in this build yet.",
  ) {}

  async getStreetViewCredentials(): Promise<CredentialResult> {
    return { status: "denied", reason: this.reason };
  }
}
