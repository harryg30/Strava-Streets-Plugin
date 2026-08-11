import type {
  AccountSnapshot,
  CredentialResult,
} from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";

/**
 * Static deny Adapter — transitional / misconfig only.
 * Store Phase product path is AccessCredentialSource via background proxy.
 */
export class DeniedCredentialSource implements CredentialSource {
  constructor(
    private readonly reason = "Street View access is not available in this build yet.",
  ) {}

  async getStreetViewCredentials(): Promise<CredentialResult> {
    return { status: "denied", code: "unavailable", reason: this.reason };
  }

  async getAccount(): Promise<AccountSnapshot> {
    return {
      kind: "denied",
      code: "unavailable",
      reason: this.reason,
    };
  }

  async beginLogin(): Promise<void> {}
}
