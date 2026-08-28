// Orchestration : chargement des données, wiring des événements, appels à render.js.

const state = { sets: [], cardsById: new Map() };

const els = {
  main: document.getElementById("sets-container"),
  dashboard: document.getElementById("dashboard"),
  filterPanel: document.getElementById("filter-panel"),
  filterToggle: document.getElementById("filter-toggle"),
  search: document.getElementById("search-input"),
  onlyMissing: document.getElementById("only-missing"),
  hideCompleted: document.getElementById("hide-completed"),
  hidePromos: document.getElementById("hide-promos"),
  sortSelect: document.getElementById("sort-select"),
  viewGridBtn: document.getElementById("view-grid"),
  viewListBtn: document.getElementById("view-list"),
  expandAllBtn: document.getElementById("expand-all"),
  collapseAllBtn: document.getElementById("collapse-all"),
  refreshBtn: document.getElementById("refresh-btn"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  copyMissingBtn: document.getElementById("copy-missing-btn"),
  shareProgressBtn: document.getElementById("share-progress-btn"),
  status: document.getElementById("status"),
  backToTop: document.getElementById("back-to-top"),
  exportReminder: document.getElementById("export-reminder"),
  exportReminderBtn: document.getElementById("export-reminder-btn"),
  lastModified: document.getElementById("last-modified"),
  detailDialog: document.getElementById("card-detail-dialog"),
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
  if (uiState.onlyMissing || uiState.hideCompleted) {
    render();
    return;
  }
  const stats = computeStats(state.sets);
  renderDashboard(els.dashboard, stats);
  updateSetProgressBars(state.sets);
  updateLastModifiedFooter();
}

function handleCardToggle(card) {
  const wasOwned = isOwned(card.id);
  toggleOwned(card.id);
  patchCardDOM(card);
  refreshAfterOwnershipChange();
  updateExportReminder();
  showToast(wasOwned ? `${card.name} retirée de la collection.` : `${card.name} ajoutée à la collection.`, {
    actionLabel: "Annuler",
    onAction: () => {
      setOwned(card.id, wasOwned);
      patchCardDOM(card);
      refreshAfterOwnershipChange();
      updateExportReminder();
    },
  });
}

/**
 * Marque un lot de cartes possédées/manquantes après confirmation, avec toast + annulation.
 * Partagé par les actions groupées par extension et par palier de rareté.
 */
function markCardsWithConfirm(cards, owned, { confirmMessage, toastMessage }) {
  if (cards.length === 0) return;
  if (!window.confirm(confirmMessage)) return;

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

function initControlsFromState() {
  els.onlyMissing.checked = uiState.onlyMissing;
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

els.shareProgressBtn.addEventListener("click", () => generateProgressShareImage(state.sets, computeStats(state.sets)));

/**
 * Délégation d'événements pour tout le contenu des extensions (clic toggle/info, actions
 * groupées, erreur d'image). Avec potentiellement des milliers de cartes, attacher un
 * écouteur par carte serait coûteux en mémoire et ralentirait chaque construction de
 * grille ; deux écouteurs ici suffisent pour toute la page.
 */
/**
 * Gère l'échec de chargement d'une image, avec repli en cascade optionnel : si l'élément
 * porte un attribut data-fallback (ex. logo anglais quand le français manque), on l'essaie
 * une fois ; sinon on marque son conteneur en erreur pour afficher le repli visuel (CSS).
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
      if (card) handleCardToggle(card);
      return;
    }

    const infoBtn = event.target.closest(".card-info");
    if (infoBtn) {
      const cardId = infoBtn.closest(".card")?.dataset.cardId;
      const card = state.cardsById.get(cardId);
      if (card) openCardDetail(card);
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
    }
  });

  // Les événements "error" ne remontent pas (bubble) : on les capte donc en phase de
  // capture sur un ancêtre commun pour garder un seul écouteur au lieu d'un par image.
  // Certaines images (logo d'extension) ont un repli (data-fallback, ex. anglais si le
  // français manque) tenté une fois avant d'afficher l'état d'erreur définitif.
  els.main.addEventListener("error", handleDelegatedImageError, true);
  els.detailDialog?.addEventListener("error", handleDelegatedImageError, true);
}
setupDelegatedEvents();

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

initThemeToggleButton();
initControlsFromState();
loadData();
registerServiceWorker();
