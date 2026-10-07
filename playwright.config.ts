import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5101",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: ["--no-sandbox"],
    },
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "MONGODB_URI= PORT=5101 DATA_DIR=./data/e2e npm start",
    url: "http://127.0.0.1:5101",
    reuseExistingServer: false,
  },
  reporter: "list",
});
