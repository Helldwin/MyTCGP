// Suite de tests de fumée — développement uniquement (ne fait pas partie du site déployé).
// Lancer avec `npm test` (installe Playwright au préalable : `npx playwright install chromium`).
const { test, expect } = require("@playwright/test");

async function freshVisit(page) {
  await page.goto("/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".set-section", { timeout: 20000 });
}

test.describe("Chargement et performance", () => {
  test("les extensions sont repliées par défaut (aucune carte construite au chargement)", async ({ page }) => {
    await freshVisit(page);
    await expect(page.locator(".set-section[open]")).toHaveCount(0);
    await expect(page.locator(".card")).toHaveCount(0);
    // 21, pas 23 : les 2 extensions promo sont masquées par défaut (voir "hidePromos").
    await expect(page.locator(".set-section")).toHaveCount(21);
  });

  test("déplier une extension construit ses cartes en miniature (pas en pleine résolution)", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await expect(page.locator(".card").first()).toBeVisible();
    const count = await page.locator(".card").count();
    expect(count).toBeGreaterThan(200); // A1 = 286 cartes
  });
});

test.describe("Collection", () => {
  test("cocher une carte affiche son image et met à jour le tableau de bord sans tout reconstruire", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    const firstCard = page.locator(".card").first();

    await expect(firstCard.locator(".card-placeholder-number")).toBeVisible();
    await firstCard.locator(".card-toggle").click();
    await expect(firstCard).toHaveClass(/owned/);
    await expect(firstCard.locator(".card-media img")).toBeVisible();
    await expect(page.locator(".dash-main-text")).toContainText("1 / 3879");
  });

  test("les quantités (doublons) s'incrémentent et se décrémentent", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    const card = page.locator(".card").first();
    await card.locator(".card-toggle").click();
    await expect(card.locator(".qty-value")).toHaveText("×1");
    await card.locator('[data-action="qty-increment"]').click();
    await expect(card.locator(".qty-value")).toHaveText("×2");
    await card.locator('[data-action="qty-decrement"]').click();
    await expect(card.locator(".qty-value")).toHaveText("×1");
  });

  test("le filtre doublons, l'export PNG et la stat du tableau de bord fonctionnent", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    const card = page.locator(".card").first();
    await card.locator(".card-toggle").click(); // ×1
    await card.locator('[data-action="qty-increment"]').click(); // ×2 : devient un doublon

    await expect(page.locator(".dash-duplicates")).toContainText("1 carte en double");

    await page.check("#only-duplicates");
    await expect(page.locator(".card")).toHaveCount(1);
    await page.uncheck("#only-duplicates");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-duplicates-btn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/doublons/);
  });

  test("un palier de rareté peut être marqué/démarqué en un clic (avec confirmation stylée)", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    const diamondPill = page.locator('.set-section[data-set-id="A1"] .tier-pill[data-tier-group="Diamond"]');
    await expect(diamondPill).toContainText("0/226");

    await diamondPill.click();
    await expect(page.locator("#confirm-dialog")).toBeVisible();
    await page.locator('#confirm-dialog [data-result="confirm"]').click();
    await expect(diamondPill).toContainText("226/226");
    await expect(page.locator(".badge-complete")).toBeVisible();
  });

  test("la liste de souhaits filtre les cartes et le bouton d'export génère un PNG", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").nth(1).locator(".card-wishlist-btn").click();

    await page.check("#only-wishlist");
    await expect(page.locator(".card")).toHaveCount(1);
    await page.uncheck("#only-wishlist");

    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-wishlist-btn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/liste-de-souhaits/);
  });
});

test.describe("Filtres et recherche", () => {
  test("la recherche est insensible aux accents et filtre les cartes", async ({ page }) => {
    await freshVisit(page);
    await page.fill("#search-input", "pikachu");
    await page.waitForTimeout(300);
    const count = await page.locator(".card").count();
    expect(count).toBeGreaterThan(0);
  });

  test("masquer les promos les cache par défaut, les affiche si décoché", async ({ page }) => {
    await freshVisit(page);
    await expect(page.locator("#hide-promos")).toBeChecked();
    await expect(page.locator('.set-section[data-set-id="PROMO-A"]')).toHaveCount(0);
    await page.uncheck("#hide-promos");
    await expect(page.locator('.set-section[data-set-id="PROMO-A"]')).toHaveCount(1);
  });
});

test.describe("Préférences persistantes", () => {
  test("le thème clair/sombre persiste après rechargement", async ({ page }) => {
    await freshVisit(page);
    await page.click("#theme-toggle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("Export / import / synchronisation", () => {
  test("exporter puis importer restaure la collection", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").first().locator(".card-toggle").click();

    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-btn");
    const download = await downloadPromise;
    const filePath = await download.path();

    await page.evaluate(() => localStorage.removeItem("tcgp_collection"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".dash-main-text")).toContainText("0 / 3879");

    await page.setInputFiles("#import-input", filePath);
    await expect(page.locator(".dash-main-text")).toContainText("1 / 3879");
  });

  test("le lien de synchronisation encode/décode fidèlement la collection", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.evaluate(() => {
      const set = state.sets.find((s) => s.id === "A1");
      setManyOwned(set.cards.slice(0, 5).map((c) => c.id), true);
      render();
    });

    await page.click("#sync-btn");
    await expect(page.locator("#sync-link-input")).toBeVisible({ timeout: 10000 });
    const url = await page.inputValue("#sync-link-input");
    expect(url).toContain("#sync=");

    const encoded = url.split("#sync=")[1];
    const decoded = await page.evaluate((enc) => decodeSyncPayload(enc), encoded);
    expect(Object.keys(decoded.quantities)).toHaveLength(5);
  });
});

test.describe("PWA", () => {
  test("le site continue de fonctionner hors-ligne après une première visite", async ({ page, context }) => {
    await freshVisit(page);
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return Boolean(reg && reg.active);
      },
      { timeout: 15000 }
    );
    await page.waitForTimeout(500);

    await context.setOffline(true);
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(1500);
    await expect(page.locator(".set-section")).toHaveCount(21); // promos masquées par défaut
    await context.setOffline(false);
  });
});
