// Config de test (développement uniquement — ne fait pas partie du site déployé).
// Lance automatiquement un serveur statique local avant les tests.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: false, // les tests partagent le même serveur/port ; éviter les interférences
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8123",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python -m http.server 8123",
    url: "http://127.0.0.1:8123/index.html",
    reuseExistingServer: true,
    timeout: 15000,
  },
});
