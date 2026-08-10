import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __BUILD_PROFILE__: JSON.stringify("dev"),
    __DEV_MAPS_API_KEY__: JSON.stringify(""),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
