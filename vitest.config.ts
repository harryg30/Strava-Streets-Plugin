import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __BUILD_PROFILE__: JSON.stringify("dev"),
    __DEV_MAPS_API_KEY__: JSON.stringify(""),
    __ACCESS_ORIGIN__: JSON.stringify("http://127.0.0.1:8787"),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
