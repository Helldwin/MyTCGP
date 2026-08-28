// Construction du DOM : tableau de bord, panneau de filtres, sections d'extension,
// cartes, fiche détaillée. Ne modifie jamais l'état lui-même (collection, ui-state) —
// se contente de lire et de déclencher les callbacks fournis par app.js.

// Carte -> élément DOM déjà rendu, pour patcher une carte (patchCardDOM) sans balayer tout
// le document. Vidé à chaque reconstruction complète de la liste (renderSetsList) ; les
// entrées ajoutées entre deux reconstructions (dépliage paresseux d'une extension) restent.
const cardElementCache = new Map();

function renderSkeletons(container, count = 15) {
  container.innerHTML = `
    <div class="skeleton-dashboard"></div>
    <div class="card-grid">
      ${Array.from({ length: count }).map(() => '<div class="card-skeleton"></div>').join("")}
    </div>
  `;
}

function cardMatchesFilters(card) {
  if (uiState.onlyMissing && isOwned(card.id)) return false;
  if (uiState.search) {
    const needle = normalizeSearchText(uiState.search);
    if (!normalizeSearchText(card.name).includes(needle)) return false;
  }
  if (uiState.rarityGroups.length) {
    if (!card.rarity || !uiState.rarityGroups.includes(card.rarity.group)) return false;
  }
  if (uiState.elements.length) {
    const key = card.element || "unknown";
    if (!uiState.elements.includes(key)) return false;
  }
  if (uiState.categories.length) {
    if (!card.category || !uiState.categories.includes(card.category)) return false;
  }
  if (uiState.pack && !(card.packs || []).includes(uiState.pack)) return false;
  return true;
}

/** Nombre de cartes possédées dans un set (helper réutilisé partout pour éviter la duplication). */
function ownedCountInSet(set) {
  let count = 0;
  for (const card of set.cards) {
    if (isOwned(card.id)) count++;
  }
  return count;
}

function computeStats(sets) {
  let totalOwned = 0;
  let totalCards = 0;
  const bySeries = {};
  const byRarityGroup = {};
  let completedSets = 0;
  let newestSetId = null;
  let newestDate = "";

  sets.forEach((set) => {
    if (set.releaseDate > newestDate) {
      newestDate = set.releaseDate;
      newestSetId = set.id;
    }
    const seriesKey = set.id.charAt(0);
    if (!bySeries[seriesKey]) bySeries[seriesKey] = { owned: 0, total: 0 };
    let setOwned = 0;
    set.cards.forEach((card) => {
      totalCards++;
      bySeries[seriesKey].total++;
      if (isOwned(card.id)) {
        totalOwned++;
        setOwned++;
        bySeries[seriesKey].owned++;
        const label = card.rarity ? card.rarity.groupLabel : "Autre";
        byRarityGroup[label] = (byRarityGroup[label] || 0) + 1;
      }
    });
    if (setOwned === set.cards.length) completedSets++;
  });

  return {
    totalOwned,
    totalCards,
    pct: totalCards ? Math.round((totalOwned / totalCards) * 100) : 0,
    bySeries,
    byRarityGroup,
    completedSets,
    totalSets: sets.length,
    newestSetId,
  };
}

function renderDashboard(container, stats) {
  const seriesHtml = Object.entries(stats.bySeries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, s]) => {
      const pct = s.total ? Math.round((s.owned / s.total) * 100) : 0;
      return `
        <div class="dash-series">
          <span class="dash-series-label">Série ${key}</span>
          <span class="set-progress-bar"><span class="set-progress-fill" style="width:${pct}%"></span></span>
          <span class="dash-series-value">${s.owned}/${s.total}</span>
        </div>`;
    })
    .join("");

  const rarityEntries = Object.entries(stats.byRarityGroup).sort((a, b) => b[1] - a[1]);
  const maxRarity = Math.max(1, ...rarityEntries.map(([, v]) => v));
  const rarityHtml = rarityEntries
    .map(
      ([label, count]) => `
        <div class="dash-rarity-row">
          <span class="dash-rarity-label">${label}</span>
          <span class="dash-rarity-bar"><span class="dash-rarity-fill" style="width:${Math.round((count / maxRarity) * 100)}%"></span></span>
          <span class="dash-rarity-value">${count}</span>
        </div>`
    )
    .join("");

  container.innerHTML = `
    <div class="dash-main">
      <div class="dash-ring" style="--pct:${stats.pct}">
        <span class="dash-ring-value">${stats.pct}%</span>
      </div>
      <div class="dash-main-text">
        <strong>${stats.totalOwned} / ${stats.totalCards}</strong> cartes possédées
        <span class="dash-sub">${stats.completedSets} / ${stats.totalSets} extensions complétées</span>
      </div>
    </div>
    <div class="dash-series-group">${seriesHtml}</div>
    ${rarityEntries.length ? `<div class="dash-rarity-group">${rarityHtml}</div>` : ""}
  `;
}

function collectFilterOptions(sets) {
  const rarityGroups = new Map();
  const elements = new Map();
  const categories = new Map();
  const packs = new Set();
  let hasUnknownElement = false;

  sets.forEach((set) => {
    set.cards.forEach((card) => {
      if (card.rarity) rarityGroups.set(card.rarity.group, card.rarity.groupLabel);
      if (card.category === "pokemon") {
        if (card.element) elements.set(card.element, card.elementLabel);
        else hasUnknownElement = true;
      }
      if (card.category) categories.set(card.category, card.categoryLabel);
      (card.packs || []).forEach((pack) => packs.add(pack));
    });
  });

  return {
    rarityGroups: [...rarityGroups.entries()],
    elements: [...elements.entries()],
    hasUnknownElement,
    categories: [...categories.entries()],
    packs: [...packs].sort((a, b) => a.localeCompare(b, "fr")),
  };
}

function renderFilterPanel(container, sets, onChange) {
  const options = collectFilterOptions(sets);

  const rarityChips = options.rarityGroups
    .map(([group, label]) => `<button type="button" class="chip" data-filter="rarityGroups" data-value="${group}">${label}</button>`)
    .join("");

  const elementChips =
    options.elements
      .map(([key, label]) => `<button type="button" class="chip elem-${key}" data-filter="elements" data-value="${key}">${label}</button>`)
      .join("") +
    (options.hasUnknownElement
      ? `<button type="button" class="chip" data-filter="elements" data-value="unknown">Non renseigné</button>`
      : "");

  const categoryChips = options.categories
    .map(([key, label]) => `<button type="button" class="chip" data-filter="categories" data-value="${key}">${label}</button>`)
    .join("");

  const packOptions = options.packs.map((pack) => `<option value="${pack}">${pack}</option>`).join("");

  container.innerHTML = `
    <div class="filter-group">
      <span class="filter-legend">Rareté</span>
      <div class="chip-row">${rarityChips}</div>
    </div>
    <div class="filter-group">
      <span class="filter-legend">Type d'énergie</span>
      <div class="chip-row">${elementChips}</div>
    </div>
    <div class="filter-group">
      <span class="filter-legend">Catégorie</span>
      <div class="chip-row">${categoryChips}</div>
    </div>
    <div class="filter-group">
      <span class="filter-legend">Booster</span>
      <select id="pack-filter">
        <option value="">Tous les boosters</option>
        ${packOptions}
      </select>
    </div>
    <button type="button" class="btn btn-tiny" id="clear-filters">Réinitialiser les filtres</button>
  `;

  container.querySelectorAll(".chip[data-filter]").forEach((chip) => {
    const filterKey = chip.dataset.filter;
    const value = chip.dataset.value;
    if (uiState[filterKey].includes(value)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      toggleArrayValue(uiState[filterKey], value);
      chip.classList.toggle("active");
      saveUIState();
      onChange();
    });
  });

  const packSelect = container.querySelector("#pack-filter");
  packSelect.value = uiState.pack;
  packSelect.addEventListener("change", () => {
    uiState.pack = packSelect.value;
    saveUIState();
    onChange();
  });

  container.querySelector("#clear-filters").addEventListener("click", () => {
    uiState.rarityGroups = [];
    uiState.elements = [];
    uiState.categories = [];
    uiState.pack = "";
    saveUIState();
    renderFilterPanel(container, sets, onChange);
    onChange();
  });
}

/**
 * Icônes de rareté façon jeu : une Commune affiche 1 diamant, une Rare 3 diamants, une
 * Rare Étoile 2 étoiles, etc. — le nombre vient de rarities.json (champ "count").
 */
function buildRarityIcons(rarity) {
  if (!rarity || !rarity.icon) return "";
  const count = Math.max(1, rarity.count || 1);
  const icons = Array.from({ length: count })
    .map(() => `<img class="rarity-icon" src="${rarity.icon}" alt="" loading="lazy" decoding="async" />`)
    .join("");
  return `<span class="rarity-icons" role="img" aria-label="${rarity.label}" title="${rarity.label}">${icons}</span>`;
}

function renderCard(card) {
  const owned = isOwned(card.id);
  const wrapper = document.createElement("div");
  wrapper.className = `card ${owned ? "owned" : "missing"}`;
  wrapper.dataset.cardId = card.id;
  if (card.element) wrapper.classList.add(`elem-${card.element}`);

  const rarityBadge = buildRarityIcons(card.rarity);

  wrapper.innerHTML = `
    <button type="button" class="card-toggle" aria-pressed="${owned}" title="${owned ? "Retirer de la collection" : "Ajouter à la collection"}">
      <span class="card-media">
        <img src="${card.image}" alt="${card.name}" loading="lazy" decoding="async" />
        <span class="card-noimage">Image indisponible</span>
      </span>
      <span class="card-badge">${owned ? "✓" : "✕"}</span>
    </button>
    <div class="card-footer">
      <span class="card-label-text">${card.localId} · ${card.name}</span>
      <div class="card-meta-row">
        ${rarityBadge}
        <button type="button" class="card-info" aria-label="Détails de ${card.name}">ⓘ Détails</button>
      </div>
    </div>
  `;

  // Pas d'écouteur par carte : les clics (toggle/info) et les erreurs d'image sont gérés
  // par délégation au niveau du conteneur (voir setupDelegatedEvents dans app.js) — avec
  // plusieurs milliers de cartes possibles, attacher 3 écouteurs à chacune coûterait cher
  // en mémoire et ralentirait la construction de chaque extension dépliée.
  cardElementCache.set(card.id, wrapper);

  return wrapper;
}

function renderSetSection(set, visibleCards, stats) {
  const total = set.cards.length;
  const owned = ownedCountInSet(set);
  const pct = total ? Math.round((owned / total) * 100) : 0;
  const complete = owned === total;
  const isNewest = set.id === stats.newestSetId;

  // Perf : toutes les extensions sont repliées par défaut (une recherche ou un filtre actif
  // force temporairement l'ouverture pour montrer les résultats). Le contenu de la grille
  // n'est construit dans le DOM que lorsque l'extension est effectivement dépliée — sinon
  // des milliers de cartes/images seraient créées inutilement au chargement.
  const forceOpen = Boolean(uiState.search) || hasActiveFilters();
  const shouldBeOpen = forceOpen || !isSetCollapsed(set.id, true);

  const details = document.createElement("details");
  details.className = `set-section${complete ? " complete" : ""}`;
  details.open = shouldBeOpen;
  details.dataset.setId = set.id;

  const summary = document.createElement("summary");
  summary.className = "set-summary";
  summary.innerHTML = `
    <span class="set-summary-main">
      <span class="set-chevron" aria-hidden="true">▸</span>
      <span class="set-title">
        ${set.name}
        ${isNewest ? '<span class="badge badge-new">Nouveau</span>' : ""}
        ${complete ? '<span class="badge badge-complete">Terminée ✓</span>' : ""}
      </span>
    </span>
    <span class="set-summary-progress">
      <span class="set-progress-bar"><span class="set-progress-fill" style="width:${pct}%"></span></span>
      <span class="set-progress-text">${owned} / ${total} (${pct}%)</span>
    </span>
  `;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "set-body";

  const actions = document.createElement("div");
  actions.className = "set-actions";
  actions.innerHTML = `
    <button type="button" class="btn btn-tiny" data-action="mark-all-owned">Tout marquer possédé</button>
    <button type="button" class="btn btn-tiny" data-action="mark-all-missing">Tout marquer manquant</button>
    <button type="button" class="btn btn-tiny" data-action="copy-missing">Copier les manquantes</button>
  `;
  body.appendChild(actions);

  const grid = document.createElement("div");
  grid.className = `card-grid view-${uiState.view}`;

  function buildGrid() {
    if (grid.dataset.built === "true") return;
    visibleCards.forEach((card) => grid.appendChild(renderCard(card)));
    grid.dataset.built = "true";
  }

  if (shouldBeOpen) buildGrid();

  body.appendChild(grid);
  details.appendChild(body);

  details.addEventListener("toggle", () => {
    if (details.open) {
      buildGrid();
      details.parentElement?.querySelector(".list-hint")?.remove();
    }
    // Ne pas persister un dépliage déclenché automatiquement par une recherche/filtre :
    // seul un clic explicite sur le résumé (hors recherche/filtre actif) change la préférence.
    if (!forceOpen) setSetCollapsed(set.id, !details.open);
  });
  // Les boutons d'action (mark-all-*, copy-missing) sont gérés par délégation (data-action +
  // data-set-id lus au niveau du conteneur) — voir setupDelegatedEvents dans app.js.

  return details;
}

/**
 * Met à jour une carte déjà affichée sans reconstruire le reste du DOM (utilisé après un
 * simple toggle possédé/manquant, pour rester fluide même avec des milliers de cartes).
 * Ne fait rien si la carte n'est pas actuellement rendue (extension repliée ou filtrée).
 */
function patchCardDOM(card) {
  const el = cardElementCache.get(card.id);
  if (!el || !el.isConnected) return;
  const owned = isOwned(card.id);
  el.classList.toggle("owned", owned);
  el.classList.toggle("missing", !owned);
  const toggleBtn = el.querySelector(".card-toggle");
  toggleBtn.setAttribute("aria-pressed", String(owned));
  toggleBtn.title = owned ? "Retirer de la collection" : "Ajouter à la collection";
  el.querySelector(".card-badge").textContent = owned ? "✓" : "✕";
}

/** Met à jour les barres de progression des extensions déjà affichées, sans tout reconstruire. */
function updateSetProgressBars(sets) {
  document.querySelectorAll(".set-section[data-set-id]").forEach((section) => {
    const set = sets.find((s) => s.id === section.dataset.setId);
    if (!set) return;
    const total = set.cards.length;
    const owned = ownedCountInSet(set);
    const pct = total ? Math.round((owned / total) * 100) : 0;
    const complete = owned === total;

    section.classList.toggle("complete", complete);
    const fill = section.querySelector(".set-progress-fill");
    if (fill) fill.style.width = `${pct}%`;
    const text = section.querySelector(".set-progress-text");
    if (text) text.textContent = `${owned} / ${total} (${pct}%)`;

    const title = section.querySelector(".set-title");
    let completeBadge = title.querySelector(".badge-complete");
    if (complete && !completeBadge) {
      completeBadge = document.createElement("span");
      completeBadge.className = "badge badge-complete";
      completeBadge.textContent = "Terminée ✓";
      title.appendChild(completeBadge);
    } else if (!complete && completeBadge) {
      completeBadge.remove();
    }
  });
}

function sortSets(sets) {
  const withStats = sets.map((set) => {
    const total = set.cards.length;
    const owned = ownedCountInSet(set);
    return { set, total, pct: total ? owned / total : 0 };
  });

  switch (uiState.sort) {
    case "completion":
      withStats.sort((a, b) => b.pct - a.pct);
      break;
    case "name":
      withStats.sort((a, b) => a.set.name.localeCompare(b.set.name, "fr"));
      break;
    case "count":
      withStats.sort((a, b) => b.total - a.total);
      break;
    case "release":
    default:
      withStats.sort((a, b) => a.set.releaseDate.localeCompare(b.set.releaseDate));
  }

  return withStats.map((entry) => entry.set);
}

function renderSetsList(container, sets, stats) {
  cardElementCache.clear();
  container.innerHTML = "";
  const sorted = sortSets(sets);
  let rendered = 0;

  sorted.forEach((set) => {
    const total = set.cards.length;
    const owned = ownedCountInSet(set);
    if (uiState.hideCompleted && total > 0 && owned === total) return;

    const visibleCards = set.cards.filter(cardMatchesFilters);
    if (visibleCards.length === 0) return;

    container.appendChild(renderSetSection(set, visibleCards, stats));
    rendered++;
  });

  if (rendered > 0 && !container.querySelector(".set-section[open]")) {
    const hint = document.createElement("p");
    hint.className = "list-hint";
    hint.innerHTML = "👆 Clique sur une extension pour la déplier et cocher tes cartes.";
    container.prepend(hint);
  }

  if (rendered === 0) {
    container.innerHTML = `<p class="empty-state">Aucune carte ne correspond à tes filtres actuels.</p>`;
  }
}

function buildMissingText(sets) {
  const lines = [];
  sets.forEach((set) => {
    const missing = set.cards.filter((card) => !isOwned(card.id));
    if (missing.length === 0) return;
    lines.push(`${set.name} (${missing.length} manquante${missing.length > 1 ? "s" : ""}) :`);
    missing.forEach((card) => lines.push(`  - ${card.localId} ${card.name}`));
    lines.push("");
  });
  return lines.join("\n").trim();
}

async function copyMissingToClipboard(sets) {
  const text = buildMissingText(sets);
  if (!text) {
    showToast("Rien à copier : toutes les cartes visées sont déjà possédées.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Liste des cartes manquantes copiée dans le presse-papiers.");
  } catch (err) {
    console.error(err);
    showToast("Impossible de copier automatiquement dans le presse-papiers.");
  }
}

function openCardDetail(card) {
  const dialog = document.getElementById("card-detail-dialog");
  if (!dialog) return;
  const owned = isOwned(card.id);

  const rows = [];
  if (card.categoryLabel) rows.push(["Catégorie", card.categoryLabel]);
  if (card.elementLabel) rows.push(["Type", card.elementLabel]);
  if (card.health != null) rows.push(["PV", card.health]);
  if (card.weakness) rows.push(["Faiblesse", card.weakness]);
  if (card.retreatCost != null) rows.push(["Coût de retraite", card.retreatCost]);
  if (card.evolvesFrom) rows.push(["Évolution de", card.evolvesFrom]);
  if (rows.length === 0) rows.push(["Détails", "Non renseigné pour cette carte"]);

  const rowsHtml = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");

  dialog.innerHTML = `
    <form method="dialog" class="card-detail">
      <button type="submit" class="card-detail-close" aria-label="Fermer">×</button>
      <div class="card-detail-media">
        <img src="${card.image}" alt="${card.name}" />
      </div>
      <div class="card-detail-info">
        <h3>${card.name}</h3>
        <p class="card-detail-sub">${card.id}${card.rarity ? " · " + card.rarity.label : ""} ${buildRarityIcons(card.rarity)}</p>
        <dl class="card-detail-stats">${rowsHtml}</dl>
        ${card.packs && card.packs.length ? `<p class="card-detail-packs">Boosters : ${card.packs.join(", ")}</p>` : ""}
        <button type="button" class="btn" id="card-detail-toggle">
          ${owned ? "Marquer comme manquante" : "Marquer comme possédée"}
        </button>
      </div>
    </form>
  `;

  dialog.querySelector("#card-detail-toggle").addEventListener("click", () => {
    handleCardToggle(card);
    dialog.close();
  });

  dialog.showModal();
}
