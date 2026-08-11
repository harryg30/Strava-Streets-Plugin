import { describe, expect, it, vi } from "vitest";
import { createFakeGoogleAuth } from "../src/google-auth/create-fake-google-auth.js";
import { createGoogleOAuth } from "../src/google-auth/create-google-oauth.js";

describe("Google Auth Module", () => {
  const redirectUri = "http://127.0.0.1:8787/v1/auth/google/callback";

  describe("fake Adapter", () => {
    it("begin then complete yields googleAccountId from code", async () => {
      const auth = createFakeGoogleAuth({ bounceCode: "google-user-1" });
      const { authorizeUrl, state } = auth.begin(redirectUri);

      const bounce = new URL(authorizeUrl);
      expect(bounce.origin + bounce.pathname).toBe(
        "http://127.0.0.1:8787/v1/auth/google/callback",
      );
      expect(bounce.searchParams.get("code")).toBe("google-user-1");
      expect(bounce.searchParams.get("state")).toBe(state);

      const identity = await auth.complete({
        code: bounce.searchParams.get("code")!,
        state: bounce.searchParams.get("state")!,
        redirectUri,
      });
      expect(identity).toEqual({ googleAccountId: "google-user-1" });
    });

    it("complete rejects tampered state", async () => {
      const auth = createFakeGoogleAuth();
      const { state } = auth.begin(redirectUri);
      await expect(
        auth.complete({
          code: "x",
          state: `${state}tampered`,
          redirectUri,
        }),
      ).rejects.toMatchObject({ kind: "invalid_state" });
    });
  });

  describe("production Adapter", () => {
    it("begin builds Google authorize URL with openid + state", () => {
      const auth = createGoogleOAuth({
        clientId: "client-123",
        clientSecret: "secret",
        stateSecret: "state-secret",
      });
      const { authorizeUrl, state } = auth.begin(redirectUri);
      const url = new URL(authorizeUrl);
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("openid");
      expect(url.searchParams.get("state")).toBe(state);
    });

    it("complete exchanges code and maps verified sub to googleAccountId", async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ id_token: "jwt-token" }),
      );
      const auth = createGoogleOAuth({
        clientId: "client-123",
        clientSecret: "secret",
        stateSecret: "state-secret",
        fetch: fetchMock as unknown as typeof fetch,
        verifyIdToken: async (idToken, audience) => {
          expect(idToken).toBe("jwt-token");
          expect(audience).toBe("client-123");
          return { sub: "google-sub-99" };
        },
      });
      const { state } = auth.begin(redirectUri);
      const identity = await auth.complete({
        code: "auth-code",
        state,
        redirectUri,
      });
      expect(identity).toEqual({ googleAccountId: "google-sub-99" });
      expect(fetchMock).toHaveBeenCalledOnce();
      const call = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(call[1]?.method).toBe("POST");
      const body = new URLSearchParams(String(call[1]?.body));
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("client_id")).toBe("client-123");
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("redirect_uri")).toBe(redirectUri);
      expect(body.get("grant_type")).toBe("authorization_code");
    });

    it("complete maps token endpoint failure to exchange_failed", async () => {
      const auth = createGoogleOAuth({
        clientId: "client-123",
        clientSecret: "secret",
        stateSecret: "state-secret",
        fetch: (async () =>
          Response.json(
            { error: "invalid_grant" },
            { status: 400 },
          )) as unknown as typeof fetch,
      });
      const { state } = auth.begin(redirectUri);
      await expect(
        auth.complete({ code: "bad", state, redirectUri }),
      ).rejects.toMatchObject({ kind: "exchange_failed" });
    });
  });
});
