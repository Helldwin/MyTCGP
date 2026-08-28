// Orchestration : chargement des données, wiring des événements, appels à render.js.

const state = {
  sets: [],
  cardsById: new Map(),
  selectedCardIds: new Set(),
  lastClickedCardId: null,
};

const els = {
  main: document.getElementById("sets-container"),
  dashboard: document.getElementById("dashboard"),
  filterPanel: document.getElementById("filter-panel"),
  filterToggle: document.getElementById("filter-toggle"),
  toolbarMoreToggle: document.getElementById("toolbar-more-toggle"),
  toolbarMoreInner: document.getElementById("toolbar-more-inner"),
  search: document.getElementById("search-input"),
  onlyMissing: document.getElementById("only-missing"),
  onlyWishlist: document.getElementById("only-wishlist"),
  onlyDuplicates: document.getElementById("only-duplicates"),
  hideCompleted: document.getElementById("hide-completed"),
  hidePromos: document.getElementById("hide-promos"),
  sortSelect: document.getElementById("sort-select"),
  viewGridBtn: document.getElementById("view-grid"),
  viewListBtn: document.getElementById("view-list"),
  expandAllBtn: document.getElementById("expand-all"),
  collapseAllBtn: document.getElementById("collapse-all"),
  focusModeBtn: document.getElementById("focus-mode-btn"),
  shortcutsHelpBtn: document.getElementById("shortcuts-help-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  copyMissingBtn: document.getElementById("copy-missing-btn"),
  exportWishlistBtn: document.getElementById("export-wishlist-btn"),
  exportDuplicatesBtn: document.getElementById("export-duplicates-btn"),
  shareFormatSelect: document.getElementById("share-format-select"),
  shareProgressBtn: document.getElementById("share-progress-btn"),
  syncBtn: document.getElementById("sync-btn"),
  status: document.getElementById("status"),
  backToTop: document.getElementById("back-to-top"),
  exportReminder: document.getElementById("export-reminder"),
  exportReminderBtn: document.getElementById("export-reminder-btn"),
  newExtensionBanner: document.getElementById("new-extension-banner"),
  newExtensionText: document.getElementById("new-extension-text"),
  newExtensionDismiss: document.getElementById("new-extension-dismiss"),
  lastModified: document.getElementById("last-modified"),
  detailDialog: document.getElementById("card-detail-dialog"),
  confirmDialog: document.getElementById("confirm-dialog"),
  syncDialog: document.getElementById("sync-dialog"),
  selectionBar: document.getElementById("selection-bar"),
  selectionCount: document.getElementById("selection-count"),
  selectionMarkOwned: document.getElementById("selection-mark-owned"),
  selectionMarkMissing: document.getElementById("selection-mark-missing"),
  selectionClear: document.getElementById("selection-clear"),
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.className = isError ? "status status-error" : "status";
}

function updateLastModifiedFooter() {
  const last = getLastModified();
  els.lastModified.textContent = last
    ? `Dernière modification de ta collection : ${new Date(last).toLocaleString("fr-FR")}`
    : "Aucune modification enregistrée pour l'instant.";
}

function updateExportReminder() {
  const lastExported = getLastExported();
  const daysSinceExport = lastExported ? (Date.now() - new Date(lastExported).getTime()) / 86400000 : Infinity;
  const shouldRemind = getOwnedCount() > 0 && daysSinceExport > 7;
  els.exportReminder.hidden = !shouldRemind;
}

function render() {
  const stats = computeStats(state.sets);
  renderDashboard(els.dashboard, stats);
  renderSetsList(els.main, state.sets, stats);
  updateLastModifiedFooter();
}

/**
 * Mise à jour légère après un changement de possession (toggle / action groupée / annulation) :
 * ne reconstruit PAS la liste des extensions (coûteux avec ~3900 cartes), seulement le
 * tableau de bord et les barres de progression déjà affichées. Repli sur un rendu complet
 * si un filtre actif dépend de l'état possédé/manquant (sinon des cartes qui devraient
 * disparaître resteraient affichées).
 */
function refreshAfterOwnershipChange() {
  if (uiState.onlyMissing || uiState.hideCompleted || uiState.onlyWishlist || uiState.onlyDuplicates) {
    render();
    return;
  }
  const stats = computeStats(state.sets);
  renderDashboard(els.dashboard, stats);
  updateSetProgressBars(state.sets);
  updateLastModifiedFooter();
}

function handleCardToggle(card) {
  const previousQuantity = getQuantity(card.id);
  toggleOwned(card.id);
  patchCardDOM(card);
  refreshAfterOwnershipChange();
  updateExportReminder();
  const nowOwned = isOwned(card.id);
  showToast(nowOwned ? `${card.name} ajoutée à la collection.` : `${card.name} retirée de la collection.`, {
    actionLabel: "Annuler",
    onAction: () => {
      setOwned(card.id, previousQuantity);
      patchCardDOM(card);
      refreshAfterOwnershipChange();
      updateExportReminder();
    },
  });
}

/** +1/-1 exemplaire sur une carte déjà possédée (pastille de quantité). */
function handleQuantityChange(card, delta) {
  const wasOwned = isOwned(card.id);
  const wasDuplicate = getQuantity(card.id) > 1;
  delta > 0 ? incrementQuantity(card.id) : decrementQuantity(card.id);
  const nowOwned = isOwned(card.id);
  const nowDuplicate = getQuantity(card.id) > 1;
  patchCardDOM(card);

  if (wasOwned !== nowOwned || (uiState.onlyDuplicates && wasDuplicate !== nowDuplicate)) {
    // Franchissement d'un seuil qui affecte un filtre actif (possession, ou doublon si le
    // filtre "Doublons seulement" est activé) : il faut reconstruire la liste affichée.
    refreshAfterOwnershipChange();
    updateExportReminder();
  } else if (wasDuplicate !== nowDuplicate) {
    // Le compteur de doublons du tableau de bord doit rester à jour même sans impact sur les
    // filtres actifs — pas besoin de reconstruire toute la liste pour autant.
    renderDashboard(els.dashboard, computeStats(state.sets));
  }
}

function handleWishlistToggle(card) {
  const wishlisted = toggleWishlist(card.id);
  patchCardDOM(card);
  if (uiState.onlyWishlist) render();
  showToast(wishlisted ? `${card.name} ajoutée à ta liste de souhaits.` : `${card.name} retirée de ta liste de souhaits.`);
}

/**
 * Boîte de dialogue de confirmation stylée (remplace window.confirm, natif mais peu soigné).
 * Retourne une Promise<boolean> : true si confirmé, false si annulé (Échap, clic hors zone,
 * ou bouton "Annuler").
 */
function confirmDialog(message, { confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = els.confirmDialog;
    dialog.innerHTML = `
      <div class="confirm-body">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" data-result="cancel">${cancelLabel}</button>
          <button type="button" class="btn${danger ? " btn-danger" : ""}" data-result="confirm">${confirmLabel}</button>
        </div>
      </div>
    `;
    dialog.querySelector(".confirm-message").textContent = message;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(result);
    };

    dialog.querySelector('[data-result="confirm"]').addEventListener("click", () => finish(true));
    dialog.querySelector('[data-result="cancel"]').addEventListener("click", () => finish(false));
    dialog.addEventListener("close", () => finish(false), { once: true });

    dialog.showModal();
  });
}

/**
 * Marque un lot de cartes possédées/manquantes après confirmation, avec toast + annulation.
 * Partagé par les actions groupées par extension, par palier de rareté et par sélection.
 */
async function markCardsWithConfirm(cards, owned, { confirmMessage, toastMessage }) {
  if (cards.length === 0) return;
  const confirmed = await confirmDialog(confirmMessage);
  if (!confirmed) return;

  const ids = cards.map((card) => card.id);
  const previousStates = cards.map((card) => isOwned(card.id));

  setManyOwned(ids, owned);
  cards.forEach((card) => patchCardDOM(card));
  refreshAfterOwnershipChange();
  updateExportReminder();
  showToast(toastMessage, {
    actionLabel: "Annuler",
    onAction: () => {
      cards.forEach((card, index) => setOwned(card.id, previousStates[index]));
      cards.forEach((card) => patchCardDOM(card));
      refreshAfterOwnershipChange();
      updateExportReminder();
    },
  });
}

function handleBulkMark(set, owned) {
  const verb = owned ? "possédées" : "manquantes";
  markCardsWithConfirm(set.cards, owned, {
    confirmMessage: `Marquer les ${set.cards.length} cartes de « ${set.name} » comme ${verb} ?`,
    toastMessage: `Extension « ${set.name} » marquée ${verb}.`,
  });
}

/** Un clic sur une pastille de palier marque tout le palier possédé, ou le vide s'il l'était déjà. */
function handleTierMark(set, group) {
  const tierDef = RARITY_TIERS.find((tier) => tier.group === group);
  if (!tierDef) return;
  const cards = set.cards.filter((card) => card.rarity && card.rarity.group === group);
  if (cards.length === 0) return;

  const owned = !cards.every((card) => isOwned(card.id));
  const verb = owned ? "possédées" : "manquantes";
  markCardsWithConfirm(cards, owned, {
    confirmMessage: `Marquer les ${cards.length} cartes ${tierDef.label} de « ${set.name} » comme ${verb} ?`,
    toastMessage: `Palier ${tierDef.label} de « ${set.name} » marqué ${verb}.`,
  });
}

function handlePackCalc(set) {
  const result = estimatePacksForSet(set);
  if (!result) {
    showToast("Aucune donnée de taux de tirage disponible pour cette extension.", { duration: 6000 });
    return;
  }
  if (result.totalMissingDiamonds === 0) {
    showToast(`Tous les Diamants de « ${set.name} » sont déjà obtenus !`);
    return;
  }
  const perBoosterText = result.expectedNewPerBooster.toFixed(2);
  const boostersText = result.estimatedBoosters != null ? `~${result.estimatedBoosters} boosters` : "indéterminée (taux trop faibles)";
  showToast(
    `« ${set.name} » : ${result.totalMissingDiamonds} Diamants manquants, ~${perBoosterText} nouvelle carte Diamant/booster en moyenne → estimation ${boostersText} pour compléter. (Approximatif : suppose une répartition uniforme et ignore les doublons déjà obtenus.)`,
    { duration: 10000 }
  );
}

// ---------- Sélection multiple (Maj+clic pour une plage, Ctrl/Cmd+clic pour une carte) ----------

function updateSelectionVisuals() {
  cardElementCache.forEach((el, id) => {
    el.classList.toggle("selected", state.selectedCardIds.has(id));
  });
  const count = state.selectedCardIds.size;
  els.selectionBar.hidden = count === 0;
  els.selectionCount.textContent = `${count} carte${count > 1 ? "s" : ""} sélectionnée${count > 1 ? "s" : ""}`;
}

function clearSelection() {
  if (state.selectedCardIds.size === 0) return;
  state.selectedCardIds.clear();
  state.lastClickedCardId = null;
  updateSelectionVisuals();
}

function toggleCardSelection(cardId) {
  if (state.selectedCardIds.has(cardId)) state.selectedCardIds.delete(cardId);
  else state.selectedCardIds.add(cardId);
  updateSelectionVisuals();
}

/** Sélectionne toutes les cartes actuellement affichées entre deux id (inclus), ordre du DOM. */
function selectCardRange(fromId, toId) {
  const ids = [...els.main.querySelectorAll(".card[data-card-id]")].map((el) => el.dataset.cardId);
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1) {
    toggleCardSelection(toId);
    return;
  }
  const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
  for (let i = start; i <= end; i++) state.selectedCardIds.add(ids[i]);
  updateSelectionVisuals();
}

els.selectionMarkOwned.addEventListener("click", async () => {
  const cards = [...state.selectedCardIds].map((id) => state.cardsById.get(id)).filter(Boolean);
  await markCardsWithConfirm(cards, true, {
    confirmMessage: `Marquer les ${cards.length} cartes sélectionnées comme possédées ?`,
    toastMessage: `${cards.length} cartes sélectionnées marquées possédées.`,
  });
  clearSelection();
});

els.selectionMarkMissing.addEventListener("click", async () => {
  const cards = [...state.selectedCardIds].map((id) => state.cardsById.get(id)).filter(Boolean);
  await markCardsWithConfirm(cards, false, {
    confirmMessage: `Marquer les ${cards.length} cartes sélectionnées comme manquantes ?`,
    toastMessage: `${cards.length} cartes sélectionnées marquées manquantes.`,
  });
  clearSelection();
});

els.selectionClear.addEventListener("click", () => clearSelection());

// ---------- Contrôles / filtres / tri / vue ----------

function initControlsFromState() {
  els.onlyMissing.checked = uiState.onlyMissing;
  els.onlyWishlist.checked = uiState.onlyWishlist;
  els.onlyDuplicates.checked = uiState.onlyDuplicates;
  els.hideCompleted.checked = uiState.hideCompleted;
  els.hidePromos.checked = uiState.hidePromos;
  els.sortSelect.value = uiState.sort;
  els.viewGridBtn.classList.toggle("active", uiState.view === "grid");
  els.viewListBtn.classList.toggle("active", uiState.view === "list");
  els.viewGridBtn.setAttribute("aria-pressed", String(uiState.view === "grid"));
  els.viewListBtn.setAttribute("aria-pressed", String(uiState.view === "list"));
}

function updateFilterToggleLabel() {
  const count = uiState.rarityGroups.length + uiState.elements.length + uiState.categories.length + (uiState.pack ? 1 : 0);
  els.filterToggle.textContent = count > 0 ? `🔎 Filtres (${count})` : "🔎 Filtres";
  els.filterToggle.classList.toggle("has-active-filters", count > 0);
}

function handleFilterChange() {
  updateFilterToggleLabel();
  render();
}

function setView(view) {
  uiState.view = view;
  saveUIState();
  initControlsFromState();
  render();
}

// ---------- Nouvelle extension détectée depuis la dernière visite ----------

const KNOWN_SETS_KEY = "tcgp_known_sets";

function checkForNewExtensions(sets) {
  const currentIds = sets.filter((set) => !isPromoSet(set)).map((set) => set.id);
  let known = [];
  try {
    known = JSON.parse(localStorage.getItem(KNOWN_SETS_KEY) || "[]");
  } catch {
    known = [];
  }
  const isFirstVisit = known.length === 0;
  const newOnes = currentIds.filter((id) => !known.includes(id));

  try {
    localStorage.setItem(KNOWN_SETS_KEY, JSON.stringify(currentIds));
  } catch {
    // pas bloquant
  }

  if (!isFirstVisit && newOnes.length > 0) {
    const names = newOnes.map((id) => sets.find((set) => set.id === id)?.name || id);
    els.newExtensionText.textContent =
      newOnes.length === 1
        ? `Nouvelle extension disponible : ${names[0]} !`
        : `${newOnes.length} nouvelles extensions disponibles : ${names.join(", ")} !`;
    els.newExtensionBanner.hidden = false;
  }
}

els.newExtensionDismiss.addEventListener("click", () => {
  els.newExtensionBanner.hidden = true;
});

// ---------- Chargement des données ----------

async function loadData(forceRefresh = false) {
  setStatus("Chargement des cartes…");
  renderSkeletons(els.main);
  try {
    const { sets, fromCache } = await getCardData({ forceRefresh });
    state.sets = sets;
    state.cardsById = new Map();
    sets.forEach((set) => set.cards.forEach((card) => state.cardsById.set(card.id, card)));
    setStatus(fromCache ? "Données chargées (cache local, moins de 24h)." : "Données à jour.");
    renderFilterPanel(els.filterPanel, state.sets, handleFilterChange);
    updateFilterToggleLabel();
    render();
    updateExportReminder();
    checkForNewExtensions(sets);
  } catch (err) {
    console.error(err);
    setStatus("Impossible de charger les cartes. Vérifie ta connexion puis réessaie.", true);
    els.main.innerHTML = `<button type="button" id="retry-btn" class="btn">Réessayer</button>`;
    document.getElementById("retry-btn").addEventListener("click", () => loadData(forceRefresh));
  }
}

let searchDebounceTimer = null;
els.search.addEventListener("input", (event) => {
  const value = event.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    uiState.search = value;
    render();
  }, 200);
});

els.onlyMissing.addEventListener("change", (event) => {
  uiState.onlyMissing = event.target.checked;
  saveUIState();
  render();
});

els.onlyWishlist.addEventListener("change", (event) => {
  uiState.onlyWishlist = event.target.checked;
  saveUIState();
  render();
});

els.onlyDuplicates.addEventListener("change", (event) => {
  uiState.onlyDuplicates = event.target.checked;
  saveUIState();
  render();
});

els.hideCompleted.addEventListener("change", (event) => {
  uiState.hideCompleted = event.target.checked;
  saveUIState();
  render();
});

els.hidePromos.addEventListener("change", (event) => {
  uiState.hidePromos = event.target.checked;
  saveUIState();
  render();
});

els.sortSelect.addEventListener("change", (event) => {
  uiState.sort = event.target.value;
  saveUIState();
  render();
});

els.viewGridBtn.addEventListener("click", () => setView("grid"));
els.viewListBtn.addEventListener("click", () => setView("list"));

els.expandAllBtn.addEventListener("click", () => {
  collapseAllSets(state.sets.map((set) => set.id), false);
  render();
});

els.collapseAllBtn.addEventListener("click", () => {
  collapseAllSets(state.sets.map((set) => set.id), true);
  render();
});

els.filterToggle.addEventListener("click", () => {
  const expanded = els.filterToggle.getAttribute("aria-expanded") === "true";
  els.filterToggle.setAttribute("aria-expanded", String(!expanded));
  els.filterPanel.hidden = expanded;
});

// Sur mobile, regroupe les actions secondaires (export, partage, synchro…) derrière un bouton
// "Plus d'actions" repliable — sur desktop, ce bouton est masqué et le contenu toujours visible
// (voir la règle @media (min-width: 641px) dans style.css).
els.toolbarMoreToggle.addEventListener("click", () => {
  const expanded = els.toolbarMoreToggle.getAttribute("aria-expanded") === "true";
  els.toolbarMoreToggle.setAttribute("aria-expanded", String(!expanded));
  els.toolbarMoreInner.hidden = expanded;
});

els.focusModeBtn.addEventListener("click", () => {
  const active = document.body.classList.toggle("focus-mode");
  els.focusModeBtn.setAttribute("aria-pressed", String(active));
  els.focusModeBtn.textContent = active ? "🎯 Quitter le mode focus" : "🎯 Mode focus";
});

els.shortcutsHelpBtn.addEventListener("click", () => {
  showToast(
    "Raccourcis : / recherche · Échap ferme une fiche/annule la sélection · Maj+clic sélectionne une plage de cartes · Ctrl/Cmd+clic sélectionne une carte",
    { duration: 9000 }
  );
});

els.refreshBtn.addEventListener("click", () => loadData(true));

els.exportBtn.addEventListener("click", () => {
  exportCollection();
  updateExportReminder();
  showToast("Collection exportée.");
});

els.exportReminderBtn.addEventListener("click", () => {
  exportCollection();
  updateExportReminder();
  showToast("Collection exportée.");
});

els.importInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const count = await importCollectionFromFile(file);
    showToast(`Collection importée : ${count} cartes possédées.`);
    render();
    updateExportReminder();
  } catch (err) {
    console.error(err);
    showToast("Le fichier importé n'est pas valide.");
  } finally {
    event.target.value = "";
  }
});

els.copyMissingBtn.addEventListener("click", () => copyMissingToClipboard(state.sets));

els.exportWishlistBtn.addEventListener("click", () => generateWishlistImage(state.sets));

els.exportDuplicatesBtn.addEventListener("click", () => generateDuplicatesImage(state.sets));

els.shareProgressBtn.addEventListener("click", () => {
  const format = els.shareFormatSelect.value;
  generateProgressShareImage(state.sets, computeStats(state.sets), { format });
});

// ---------- Synchronisation entre appareils (lien + QR code) ----------

async function openSyncDialog() {
  const dialog = els.syncDialog;
  dialog.innerHTML = `<div class="sync-body"><p>Génération du lien…</p></div>`;
  dialog.showModal();

  try {
    const encoded = await encodeCollectionForSync(state.sets);
    const url = buildSyncUrl(encoded);
    const qrModules = generateQrMatrix(url);

    dialog.innerHTML = `
      <div class="sync-body">
        <button type="button" class="card-detail-close" id="sync-close" aria-label="Fermer">×</button>
        <h3>Synchroniser un autre appareil</h3>
        <p class="sync-hint">
          Ouvre ce lien (ou scanne le QR code) sur ton autre appareil pour y copier cette
          collection. Cela remplacera la collection déjà présente sur cet appareil.
        </p>
        <div class="sync-link-row">
          <input type="text" readonly class="sync-link-input" id="sync-link-input" value="${url}" />
          <button type="button" class="btn btn-tiny" id="sync-copy-btn">Copier</button>
        </div>
        ${
          qrModules
            ? `<div class="sync-qr" id="sync-qr"></div>`
            : `<p class="sync-hint">Collection trop volumineuse pour tenir dans un QR code — utilise le lien ci-dessus.</p>`
        }
      </div>
    `;
    if (qrModules) renderQrMatrixToDom(qrModules, document.getElementById("sync-qr"));

    document.getElementById("sync-close").addEventListener("click", () => dialog.close());
    document.getElementById("sync-link-input").addEventListener("click", (event) => event.target.select());
    document.getElementById("sync-copy-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast("Lien de synchronisation copié.");
      } catch {
        showToast("Impossible de copier automatiquement — sélectionne le lien manuellement.");
      }
    });
  } catch (err) {
    console.error(err);
    dialog.innerHTML = `<div class="sync-body"><p>Impossible de générer le lien de synchronisation.</p></div>`;
  }
}

els.syncBtn.addEventListener("click", () => openSyncDialog());

async function checkIncomingSync() {
  const encoded = readSyncFromLocation();
  if (!encoded) return;
  try {
    const payload = await decodeSyncPayload(encoded, state.sets);
    const count = Object.keys(payload.quantities || {}).length;
    const confirmed = await confirmDialog(
      `Importer cette collection partagée (${count} cartes) ? Elle remplacera ta collection actuelle sur cet appareil.`,
      { confirmLabel: "Importer", danger: true }
    );
    if (confirmed) {
      applyImportedCollection({ quantities: payload.quantities, wishlist: payload.wishlist });
      render();
      updateExportReminder();
      showToast("Collection synchronisée depuis le lien.");
    }
  } catch (err) {
    console.error(err);
    showToast("Lien de synchronisation invalide ou corrompu.");
  } finally {
    clearSyncFromLocation();
  }
}

/**
 * Délégation d'événements pour tout le contenu des extensions (clic toggle/info/souhait/
 * quantité, actions groupées, erreur d'image). Avec potentiellement des milliers de cartes,
 * attacher un écouteur par carte serait coûteux en mémoire et ralentirait chaque construction
 * de grille ; quelques écouteurs ici suffisent pour toute la page.
 */
function handleDelegatedImageError(event) {
  const img = event.target;
  if (img.tagName !== "IMG") return;

  if (img.dataset.fallback) {
    const fallback = img.dataset.fallback;
    delete img.dataset.fallback;
    img.src = fallback;
    return;
  }

  const wrap = img.closest(".card-media, .set-logo-wrap, .pack-icon-wrap");
  if (wrap) wrap.classList.add("img-error");
}

function setupDelegatedEvents() {
  els.main.addEventListener("click", (event) => {
    const toggleBtn = event.target.closest(".card-toggle");
    if (toggleBtn) {
      const cardId = toggleBtn.closest(".card")?.dataset.cardId;
      const card = state.cardsById.get(cardId);
      if (!card) return;

      if (event.shiftKey && state.lastClickedCardId) {
        selectCardRange(state.lastClickedCardId, cardId);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        toggleCardSelection(cardId);
        state.lastClickedCardId = cardId;
        return;
      }
      state.lastClickedCardId = cardId;
      handleCardToggle(card);
      return;
    }

    const infoBtn = event.target.closest(".card-info");
    if (infoBtn) {
      const cardId = infoBtn.closest(".card")?.dataset.cardId;
      const card = state.cardsById.get(cardId);
      if (card) openCardDetail(card);
      return;
    }

    const wishlistBtn = event.target.closest(".card-wishlist-btn");
    if (wishlistBtn) {
      const cardId = wishlistBtn.closest(".card")?.dataset.cardId;
      const card = state.cardsById.get(cardId);
      if (card) handleWishlistToggle(card);
      return;
    }

    const qtyBtn = event.target.closest(".qty-btn");
    if (qtyBtn) {
      const cardId = qtyBtn.closest(".card")?.dataset.cardId;
      const card = state.cardsById.get(cardId);
      if (card) handleQuantityChange(card, qtyBtn.dataset.action === "qty-increment" ? 1 : -1);
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
      const setId = actionBtn.closest(".set-section")?.dataset.setId;
      const set = state.sets.find((s) => s.id === setId);
      if (!set) return;
      if (actionBtn.dataset.action === "mark-all-owned") handleBulkMark(set, true);
      else if (actionBtn.dataset.action === "mark-all-missing") handleBulkMark(set, false);
      else if (actionBtn.dataset.action === "mark-tier") handleTierMark(set, actionBtn.dataset.tierGroup);
      else if (actionBtn.dataset.action === "missing-image") generateMissingCardsImage(set);
      else if (actionBtn.dataset.action === "pack-calc") handlePackCalc(set);
    }
  });

  // Les événements "error" ne remontent pas (bubble) : on les capte donc en phase de
  // capture sur un ancêtre commun pour garder un seul écouteur au lieu d'un par image.
  // Certaines images (logo d'extension) ont un repli (data-fallback, ex. anglais si le
  // français manque) tenté une fois avant d'afficher l'état d'erreur définitif.
  els.main.addEventListener("error", handleDelegatedImageError, true);
  els.detailDialog?.addEventListener("error", handleDelegatedImageError, true);
  els.filterPanel?.addEventListener("error", handleDelegatedImageError, true);
}
setupDelegatedEvents();

// ---------- Raccourcis clavier ----------

document.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  if (event.key === "/" && !isTyping) {
    event.preventDefault();
    els.search.focus();
    return;
  }

  if (event.key === "Escape") {
    if (state.selectedCardIds.size > 0) {
      clearSelection();
      return;
    }
    if (!els.filterPanel.hidden) {
      els.filterPanel.hidden = true;
      els.filterToggle.setAttribute("aria-expanded", "false");
    }
  }
});

let scrollTicking = false;
window.addEventListener(
  "scroll",
  () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      els.backToTop.classList.toggle("visible", window.scrollY > 600);
      scrollTicking = false;
    });
  },
  { passive: true }
);
els.backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

if (els.detailDialog) {
  els.detailDialog.addEventListener("click", (event) => {
    if (event.target === els.detailDialog) els.detailDialog.close();
  });
}

if (els.syncDialog) {
  els.syncDialog.addEventListener("click", (event) => {
    if (event.target === els.syncDialog) els.syncDialog.close();
  });
}

initThemeToggleButton();
initControlsFromState();
loadData().then(() => checkIncomingSync());
registerServiceWorker();
