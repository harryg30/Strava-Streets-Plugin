import type { CredentialResult } from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";

declare const __DEV_MAPS_API_KEY__: string;

/**
 * Dev Key Override — sideload/dev builds only.
 * Key is injected at build time from gitignored `.env` (GOOGLE_MAPS_API_KEY).
 * Never included in Store/production builds (see createCredentialSource).
 */
export class DevKeyOverrideCredentialSource implements CredentialSource {
  constructor(private readonly apiKey: string = __DEV_MAPS_API_KEY__) {}

  async getStreetViewCredentials(): Promise<CredentialResult> {
    if (!this.apiKey) {
      return {
        status: "denied",
        reason:
          "Dev Key Override: set GOOGLE_MAPS_API_KEY in .env and rebuild (npm run build:dev).",
      };
    }
    return {
      status: "ok",
      credential: { apiKey: this.apiKey },
    };
  }
}
