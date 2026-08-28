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

    await page.click("#filter-toggle");
    await page.check("#only-duplicates");
    await expect(page.locator(".card")).toHaveCount(1);
    await page.uncheck("#only-duplicates");

    await page.click("#toolbar-more-toggle");
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

    await page.click("#filter-toggle");
    await page.check("#only-wishlist");
    await expect(page.locator(".card")).toHaveCount(1);
    await page.uncheck("#only-wishlist");

    await page.click("#toolbar-more-toggle");
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
    await page.click("#filter-toggle");
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

    await page.click("#toolbar-more-toggle");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-btn");
    const download = await downloadPromise;
    const filePath = await download.path();

    await page.evaluate(() => localStorage.removeItem("tcgp_collection"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".dash-main-text")).toContainText("0 / 3879");

    await page.click("#toolbar-more-toggle");
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

    await page.click("#toolbar-more-toggle");
    await page.click("#sync-btn");
    await expect(page.locator("#sync-link-input")).toBeVisible({ timeout: 10000 });
    const url = await page.inputValue("#sync-link-input");
    expect(url).toContain("#sync=");

    const encoded = url.split("#sync=")[1];
    const decoded = await page.evaluate((enc) => decodeSyncPayload(enc, state.sets), encoded);
    expect(Object.keys(decoded.quantities)).toHaveLength(5);
  });

  test("le lien de synchronisation reste dans la capacité d'un QR code même pour une collection presque complète", async ({ page }) => {
    await freshVisit(page);
    // Le bug d'origine : l'ancien format JSON {id: quantité} d'une grosse collection dépassait
    // la capacité d'un QR code (le QR ne se générait plus du tout). On vérifie ici qu'une
    // collection quasi complète, avec doublons, reste bien encodable dans un QR.
    await page.evaluate(() => {
      state.sets.forEach((set) => {
        set.cards.forEach((card, i) => setQuantity(card.id, i % 7 === 0 ? 3 : 1));
      });
    });

    await page.click("#toolbar-more-toggle");
    await page.click("#sync-btn");
    await expect(page.locator("#sync-link-input")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".sync-qr")).toBeVisible();

    const url = await page.inputValue("#sync-link-input");
    const encoded = url.split("#sync=")[1];
    const decoded = await page.evaluate((enc) => decodeSyncPayload(enc, state.sets), encoded);
    const totalOwned = await page.evaluate(() => state.sets.reduce((n, s) => n + s.cards.length, 0));
    expect(Object.keys(decoded.quantities)).toHaveLength(totalOwned);
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

test.describe("Recherche et navigation", () => {
  test("la recherche trouve aussi une carte par son numéro", async ({ page }) => {
    await freshVisit(page);
    await page.fill("#search-input", "001");
    await page.waitForTimeout(300);
    const count = await page.locator(".card").count();
    expect(count).toBeGreaterThan(0);
    const labels = await page.locator(".card-label-text").allTextContents();
    expect(labels.every((label) => label.startsWith("1 ·"))).toBe(true);
  });

  test("cliquer le nom d'une carte dans sa fiche relance la recherche sur ce nom", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").first().locator(".card-info").click();
    const name = await page.locator("#card-detail-search-name").innerText();
    await page.click("#card-detail-search-name");
    await expect(page.locator("#search-input")).toHaveValue(name);
  });

  test("la liste de saut rapide ouvre directement l'extension choisie", async ({ page }) => {
    await freshVisit(page);
    await page.click("#toolbar-more-toggle");
    await page.selectOption("#jump-to-set", "A2");
    await expect(page.locator('.set-section[data-set-id="A2"]')).toHaveAttribute("open", "");
  });
});

test.describe("Notes et badges", () => {
  test("une note personnelle sur une carte affiche une pastille dans la grille", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").first().locator(".card-info").click();
    await page.fill("#card-detail-note", "à échanger contre Dracaufeu");
    await page.locator("#card-detail-note").blur();
    await page.keyboard.press("Escape");
    await expect(page.locator(".card-note-badge").first()).toBeVisible();
  });

  test("une extension à 1-3 Diamants de la complétion affiche le badge \"presque fini\"", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.evaluate(() => {
      const set = state.sets.find((s) => s.id === "A1");
      const diamonds = set.cards.filter((c) => c.rarity && c.rarity.group === "Diamond");
      diamonds.slice(1).forEach((c) => setQuantity(c.id, 1));
      render();
    });
    await expect(page.locator('.set-section[data-set-id="A1"] .badge-almost')).toBeVisible();
  });
});

test.describe("Affichage", () => {
  test("la vue compacte masque le texte des cartes et réduit la taille des vignettes", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.click("#view-compact");
    await expect(page.locator(".card-grid").first()).toHaveClass(/view-compact/);
    await expect(page.locator(".card-footer").first()).toBeHidden();
  });

  test("la mini barre de progression apparaît en scrollant puis disparaît en remontant", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.mouse.wheel(0, 1200);
    await expect(page.locator("#mini-progress-bar")).toHaveClass(/visible/);
    await page.click("#mini-progress-top");
    await expect(page.locator("#mini-progress-bar")).not.toHaveClass(/visible/);
  });
});

test.describe("Échange entre joueurs", () => {
  test("le calculateur boosters compare les différents boosters d'une extension", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator('.set-section[data-set-id="A1"] [data-action="pack-calc"]').click();
    await expect(page.locator("#info-dialog")).toBeVisible();
    const items = page.locator("#info-dialog .info-list li");
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("l'export de la liste d'échange combine doublons et souhaits en une image", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    const cards = page.locator(".card");
    await cards.nth(0).locator(".card-toggle").click();
    await cards.nth(0).locator('[data-action="qty-increment"]').click(); // doublon
    await cards.nth(1).locator(".card-wishlist-btn").click(); // souhait

    await page.click("#toolbar-more-toggle");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-trade-btn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/echange/);
  });

  test("le lien de partage de liste de souhaits est en lecture seule sur un autre appareil", async ({ page, context, browser }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").nth(2).locator(".card-wishlist-btn").click();

    await page.click("#toolbar-more-toggle");
    await page.click("#share-wishlist-link-btn");
    await expect(page.locator("#wishlist-share-link-input")).toBeVisible({ timeout: 10000 });
    const url = await page.inputValue("#wishlist-share-link-input");
    expect(url).toContain("#wishlist=");

    // "Autre appareil" = nouveau contexte de navigateur, sans le localStorage de la page ci-dessus.
    const friendContext = await browser.newContext();
    const friendPage = await friendContext.newPage();
    await friendPage.goto(url, { waitUntil: "networkidle" });
    await friendPage.waitForSelector(".set-section", { timeout: 20000 });
    await expect(friendPage.locator("#info-dialog")).toBeVisible({ timeout: 10000 });
    await expect(friendPage.locator("#info-dialog")).toContainText("carte recherchée");
    // Rien n'a été importé dans la collection de "l'ami" : lecture seule.
    await expect(friendPage.locator(".dash-main-text")).toContainText("0 / 3879");
    await friendContext.close();
  });

  test("comparer avec un ami calcule le delta entre les deux collections", async ({ page }) => {
    await freshVisit(page);
    await page.locator(".set-section summary").first().click();
    await page.locator(".card").first().locator(".card-toggle").click(); // A1-1, je l'ai

    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(require("os").tmpdir(), `friend-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ quantities: { "A1-2": 1 } })); // l'ami a A1-2

    await page.click("#toolbar-more-toggle");
    await page.setInputFiles("#compare-input", filePath);
    await expect(page.locator("#info-dialog")).toBeVisible();
    await expect(page.locator("#info-dialog")).toContainText("A1-1");
    await expect(page.locator("#info-dialog")).toContainText("A1-2");
    fs.unlinkSync(filePath);
  });
});
