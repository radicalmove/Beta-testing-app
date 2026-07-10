import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium", headless: true, launchOptions: { executablePath } },
});
