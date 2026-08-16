import { describe, expect, it } from "vitest";
import { isOauthCallbackSuccess } from "../src/adapters/credentials/chrome-tabs-browser-session.js";

describe("isOauthCallbackSuccess", () => {
  const origin = "http://127.0.0.1:8787";

  it("accepts Access callback with authorization code", () => {
    expect(
      isOauthCallbackSuccess(
        `${origin}/v1/auth/google/callback?state=x&code=4/abc&scope=openid`,
        origin,
      ),
    ).toBe(true);
  });

  it("rejects missing code, errors, and other hosts", () => {
    expect(
      isOauthCallbackSuccess(`${origin}/v1/auth/google/callback?state=x`, origin),
    ).toBe(false);
    expect(
      isOauthCallbackSuccess(
        `${origin}/v1/auth/google/callback?error=access_denied`,
        origin,
      ),
    ).toBe(false);
    expect(
      isOauthCallbackSuccess(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
        origin,
      ),
    ).toBe(false);
  });
});
