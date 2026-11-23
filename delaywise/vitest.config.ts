import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't load the React Router plugin.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.sqlite", NODE_ENV: "test" },
  },
});
