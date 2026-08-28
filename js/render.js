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
  if (uiState.onlyWishlist && !isWishlisted(card.id)) return false;
  if (uiState.onlyDuplicates && getQuantity(card.id) <= 1) return false;
  if (uiState.search) {
    const raw = uiState.search.trim();
    const needle = normalizeSearchText(raw);
    const matchesName = normalizeSearchText(card.name).includes(needle);
    // Recherche aussi par numéro de carte ("25", "025" ou "#25" trouvent la carte n°25).
    const numericNeedle = raw.replace(/^#/, "").trim();
    const matchesNumber = /^\d+$/.test(numericNeedle) && Number(card.localId) === Number(numericNeedle);
    if (!matchesName && !matchesNumber) return false;
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

/** Une extension "PROMO-A"/"PROMO-B" est un lot de promos, pas une extension régulière. */
function isPromoSet(set) {
  return /^promo/i.test(set.id);
}

const DIAMOND_RARITY_CODES = ["C", "U", "R", "RR"];

/**
 * Estimation approximative du nombre de boosters à ouvrir pour compléter les Diamants
 * manquants d'une extension, à partir des taux de tirage réels (pullRates.json). Hypothèse
 * simplificatrice : répartition uniforme entre les cartes d'une même rareté, sans tenir
 * compte des doublons déjà obtenus (donc optimiste en fin de collection) — d'où le libellé
 * "estimation" plutôt qu'une promesse exacte.
 */
function estimatePacksForSet(set) {
  if (!set.pullRates) return null;

  const missingByRarity = {};
  const totalByRarity = {};
  set.cards.forEach((card) => {
    const code = card.rarityCode;
    if (!code) return;
    totalByRarity[code] = (totalByRarity[code] || 0) + 1;
    if (!isOwned(card.id)) missingByRarity[code] = (missingByRarity[code] || 0) + 1;
  });

  const totalMissingDiamonds = DIAMOND_RARITY_CODES.reduce((sum, code) => sum + (missingByRarity[code] || 0), 0);
  if (totalMissingDiamonds === 0) return { totalMissingDiamonds: 0, expectedNewPerBooster: 0, estimatedBoosters: 0 };

  // Probabilité moyenne, par booster ouvert, d'obtenir chaque rareté — toutes positions et
  // tous types de boosters confondus, pondérés par leur fréquence d'apparition respective.
  const expectedPerBoosterByRarity = {};
  Object.values(set.pullRates).forEach((packType) => {
    const weight = (packType.appearance_rate || 0) / 100;
    Object.values(packType.slots || {}).forEach((slotOdds) => {
      Object.entries(slotOdds).forEach(([code, pct]) => {
        expectedPerBoosterByRarity[code] = (expectedPerBoosterByRarity[code] || 0) + weight * (pct / 100);
      });
    });
  });

  let expectedNewPerBooster = 0;
  DIAMOND_RARITY_CODES.forEach((code) => {
    const missing = missingByRarity[code] || 0;
    const total = totalByRarity[code] || 0;
    const perBooster = expectedPerBoosterByRarity[code] || 0;
    if (missing > 0 && total > 0) expectedNewPerBooster += perBooster * (missing / total);
  });

  return {
    totalMissingDiamonds,
    expectedNewPerBooster,
    estimatedBoosters: expectedNewPerBooster > 0 ? Math.ceil(totalMissingDiamonds / expectedNewPerBooster) : null,
  };
}

/**
 * Même estimation que estimatePacksForSet, mais booster par booster (au lieu d'une moyenne
 * pondérée sur toute l'extension) — pour savoir lequel ouvrir en priorité quand une extension
 * en propose plusieurs. Contrairement à estimatePacksForSet, on ne pondère pas par la
 * fréquence de choix du booster (appearance_rate) : on suppose ici qu'on choisit délibérément
 * CE booster à chaque fois, pas un tirage au sort entre boosters.
 */
function estimatePacksPerBooster(set) {
  if (!set.pullRates) return null;

  return Object.entries(set.pullRates)
    .map(([boosterName, packType]) => {
      const missingByRarity = {};
      const totalByRarity = {};
      set.cards.forEach((card) => {
        if (!(card.packs || []).includes(boosterName)) return;
        const code = card.rarityCode;
        if (!code) return;
        totalByRarity[code] = (totalByRarity[code] || 0) + 1;
        if (!isOwned(card.id)) missingByRarity[code] = (missingByRarity[code] || 0) + 1;
      });

      const totalMissingDiamonds = DIAMOND_RARITY_CODES.reduce((sum, code) => sum + (missingByRarity[code] || 0), 0);

      const expectedPerBoosterByRarity = {};
      Object.values(packType.slots || {}).forEach((slotOdds) => {
        Object.entries(slotOdds).forEach(([code, pct]) => {
          expectedPerBoosterByRarity[code] = (expectedPerBoosterByRarity[code] || 0) + pct / 100;
        });
      });

      let expectedNewPerBooster = 0;
      DIAMOND_RARITY_CODES.forEach((code) => {
        const missing = missingByRarity[code] || 0;
        const total = totalByRarity[code] || 0;
        const perBooster = expectedPerBoosterByRarity[code] || 0;
        if (missing > 0 && total > 0) expectedNewPerBooster += perBooster * (missing / total);
      });

      return {
        boosterName,
        totalMissingDiamonds,
        expectedNewPerBooster,
        estimatedBoosters: expectedNewPerBooster > 0 ? Math.ceil(totalMissingDiamonds / expectedNewPerBooster) : null,
      };
    })
    .sort((a, b) => (a.estimatedBoosters ?? Infinity) - (b.estimatedBoosters ?? Infinity));
}

/** Nombre de cartes possédées dans un set (helper réutilisé partout pour éviter la duplication). */
/** Libellé d'une série pour le tableau de bord : "Série A"/"Série B", ou juste "Promo" pour P. */
function seriesLabel(key) {
  return key === "P" ? "Promo" : `Série ${key}`;
}

function ownedCountInSet(set) {
  let count = 0;
  for (const card of set.cards) {
    if (isOwned(card.id)) count++;
  }
  return count;
}

// Paliers de complétion d'une extension, du plus courant au plus rare. "Terminée" ne veut
// pas dire "toutes les cartes sans exception" (les Couronnes notamment sont très dures à
// obtenir) mais "toutes les cartes classiques (Diamant)" — les paliers suivants sont des
// objectifs bonus affichés séparément.
const RARITY_TIERS = [
  { group: "Diamond", label: "Diamants", icon: `${RARITY_IMAGE_BASE}/diamond.webp` },
  { group: "Star", label: "Étoiles", icon: `${RARITY_IMAGE_BASE}/star.webp` },
  { group: "Shiny", label: "Brillantes", icon: `${RARITY_IMAGE_BASE}/shiny-star.webp` },
  { group: "Crown", label: "Couronnes (Or)", icon: `${RARITY_IMAGE_BASE}/crown.webp` },
];

/** Répartition possédé/total par palier de rareté pour une extension donnée. */
function computeSetTiers(set) {
  const tiers = {};
  RARITY_TIERS.forEach((tier) => {
    tiers[tier.group] = { owned: 0, total: 0 };
  });
  set.cards.forEach((card) => {
    const group = card.rarity ? card.rarity.group : null;
    if (!group || !tiers[group]) return; // rareté inconnue : hors paliers
    tiers[group].total++;
    if (isOwned(card.id)) tiers[group].owned++;
  });
  return tiers;
}

/** Ratio de progression "officiel" d'une extension : palier Diamant, ou total si pas de Diamant. */
function setCompletionRatio(set) {
  const diamond = computeSetTiers(set).Diamond;
  if (diamond.total > 0) return diamond.owned / diamond.total;
  return set.cards.length ? ownedCountInSet(set) / set.cards.length : 0;
}

/** Une extension est "Terminée" une fois toutes ses cartes Diamant obtenues. */
function isSetComplete(set) {
  return set.cards.length > 0 && setCompletionRatio(set) >= 1;
}

// Seuil d'affichage du badge "presque fini" : à ce nombre de Diamants ou moins de la
// complétion, ça vaut le coup de le signaler (au-delà, ça n'aide pas vraiment à prioriser).
const ALMOST_DONE_THRESHOLD = 3;

/** Nombre de Diamants manquants si l'extension est "presque finie" (1 à 3), sinon null. */
function almostDoneRemaining(set) {
  const diamond = computeSetTiers(set).Diamond;
  if (diamond.total === 0) return null;
  const remaining = diamond.total - diamond.owned;
  return remaining > 0 && remaining <= ALMOST_DONE_THRESHOLD ? remaining : null;
}

function computeStats(sets) {
  let totalOwned = 0;
  let totalCards = 0;
  const bySeries = {};
  const byRarityGroup = {};
  let completedSets = 0;
  let newestSetId = null;
  let newestDate = "";
  let duplicateCardCount = 0; // nombre de cartes DISTINCTES possédées en plusieurs exemplaires
  let duplicateExtraCount = 0; // somme des exemplaires "en trop" (au-delà du premier)

  sets.forEach((set) => {
    if (set.releaseDate > newestDate) {
      newestDate = set.releaseDate;
      newestSetId = set.id;
    }
    const seriesKey = set.id.charAt(0);
    if (!bySeries[seriesKey]) bySeries[seriesKey] = { owned: 0, total: 0 };
    set.cards.forEach((card) => {
      totalCards++;
      bySeries[seriesKey].total++;
      if (isOwned(card.id)) {
        totalOwned++;
        bySeries[seriesKey].owned++;
        const label = card.rarity ? card.rarity.groupLabel : "Autre";
        byRarityGroup[label] = (byRarityGroup[label] || 0) + 1;
        const quantity = getQuantity(card.id);
        if (quantity > 1) {
          duplicateCardCount++;
          duplicateExtraCount += quantity - 1;
        }
      }
    });
    if (isSetComplete(set)) completedSets++;
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
    duplicateCardCount,
    duplicateExtraCount,
  };
}

function renderDashboard(container, stats) {
  const seriesHtml = Object.entries(stats.bySeries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, s]) => {
      const pct = s.total ? Math.round((s.owned / s.total) * 100) : 0;
      return `
        <div class="dash-series">
          <span class="dash-series-label">${seriesLabel(key)}</span>
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
        <span class="dash-sub">${stats.completedSets} / ${stats.totalSets} extensions terminées (tous les Diamants)</span>
        ${
          stats.duplicateCardCount > 0
            ? `<span class="dash-sub dash-duplicates">📦 ${stats.duplicateCardCount} carte${stats.duplicateCardCount > 1 ? "s" : ""} en double (${stats.duplicateExtraCount} exemplaire${stats.duplicateExtraCount > 1 ? "s" : ""} en trop)</span>`
            : ""
        }
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
      // "Vol. X" / "B Series Vol. X" sont des pools de tirage internes aux promos
      // (PROMO-A/B), pas de vrais boosters à thème : pas d'icône, pas de filtre pertinent.
      (card.packs || []).forEach((pack) => {
        if (!/^(b series )?vol\.\s*\d+$/i.test(pack)) packs.add(pack);
      });
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

  const packChips = options.packs
    .map(
      (pack) => `
      <button type="button" class="chip pack-chip" data-pack="${pack}" title="${pack}">
        <span class="pack-icon-wrap">
          <img class="pack-icon" src="${packImageUrl(pack)}" alt="" loading="lazy" decoding="async" />
          <span class="pack-icon-unavailable" aria-hidden="true">?</span>
        </span>
        ${pack}
      </button>`
    )
    .join("");

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
      <div class="chip-row pack-chip-row">${packChips}</div>
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

  container.querySelectorAll(".pack-chip").forEach((chip) => {
    const pack = chip.dataset.pack;
    if (uiState.pack === pack) chip.classList.add("active");
    chip.addEventListener("click", () => {
      uiState.pack = uiState.pack === pack ? "" : pack;
      saveUIState();
      renderFilterPanel(container, sets, onChange);
      onChange();
    });
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

/** Numéro façon jeu, complété avec des zéros (ex. "1" -> "001"). */
function formatCardNumber(localId) {
  return String(localId).padStart(3, "0");
}

/**
 * Contenu de la zone image d'une carte. Comme dans le jeu, une carte non possédée n'affiche
 * pas son illustration (évite de "spoiler" le visuel et surtout de télécharger l'image d'une
 * carte qu'on n'a pas) — seul son numéro est visible, sur un fond neutre.
 */
function buildCardMediaHtml(card, owned, { large = false } = {}) {
  if (!owned) {
    return `<span class="card-placeholder"><span class="card-placeholder-number">${formatCardNumber(card.localId)}</span></span>`;
  }
  // Miniature dans la grille (potentiellement des centaines à la fois), pleine résolution
  // uniquement dans la fiche détaillée (une seule carte affichée). Repli sur l'image complète
  // si la miniature n'est pas renseignée (ex. donnée en cache d'une version antérieure).
  const src = large ? card.image : card.thumb || card.image;
  return `
    <img src="${src}" alt="${card.name}" loading="lazy" decoding="async" />
    <span class="card-noimage">Image indisponible</span>
  `;
}

function buildWishlistButtonHtml(card, owned, wishlisted) {
  if (owned) return ""; // inutile de souhaiter une carte qu'on possède déjà
  return `<button type="button" class="card-wishlist-btn${wishlisted ? " active" : ""}" data-action="toggle-wishlist" aria-pressed="${wishlisted}" title="${wishlisted ? "Retirer de la liste de souhaits" : "Ajouter à la liste de souhaits"}">★</button>`;
}

function buildQtyStepperHtml(quantity) {
  return `
    <span class="qty-stepper">
      <button type="button" class="qty-btn" data-action="qty-decrement" aria-label="Retirer un exemplaire">−</button>
      <span class="qty-value">×${quantity}</span>
      <button type="button" class="qty-btn" data-action="qty-increment" aria-label="Ajouter un exemplaire">+</button>
    </span>`;
}

function renderCard(card) {
  const owned = isOwned(card.id);
  const quantity = getQuantity(card.id);
  const wishlisted = isWishlisted(card.id);
  const wrapper = document.createElement("div");
  wrapper.className = `card ${owned ? "owned" : "missing"}${wishlisted ? " wishlisted" : ""}`;
  wrapper.dataset.cardId = card.id;
  if (card.element) wrapper.classList.add(`elem-${card.element}`);

  const rarityBadge = buildRarityIcons(card.rarity);

  wrapper.innerHTML = `
    <button type="button" class="card-toggle" aria-pressed="${owned}" title="${owned ? "Retirer de la collection" : "Ajouter à la collection"}">
      <span class="card-media">${buildCardMediaHtml(card, owned)}</span>
      <span class="card-badge">${owned ? "✓" : "✕"}</span>
    </button>
    ${buildWishlistButtonHtml(card, owned, wishlisted)}
    <div class="card-footer">
      <span class="card-label-text">${card.localId} · ${card.name}</span>
      <div class="card-meta-row">
        ${rarityBadge}
        ${hasNote(card.id) ? `<span class="card-note-badge" title="${getNote(card.id)}">📝</span>` : ""}
        ${owned ? buildQtyStepperHtml(quantity) : ""}
        <button type="button" class="card-info" aria-label="Détails de ${card.name}" title="Détails">ⓘ</button>
      </div>
    </div>
  `;

  // Pas d'écouteur par carte : les clics (toggle/info/souhait/quantité) et les erreurs d'image
  // sont gérés par délégation au niveau du conteneur (voir setupDelegatedEvents dans app.js) —
  // avec plusieurs milliers de cartes possibles, attacher un écouteur à chacune coûterait cher
  // en mémoire et ralentirait la construction de chaque extension dépliée.
  cardElementCache.set(card.id, wrapper);

  return wrapper;
}

function renderSetSection(set, visibleCards, stats) {
  const total = set.cards.length;
  const owned = ownedCountInSet(set);
  const pct = total ? Math.round((owned / total) * 100) : 0;
  const complete = isSetComplete(set);
  const isNewest = set.id === stats.newestSetId;
  const almostRemaining = complete ? null : almostDoneRemaining(set);

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
  details.dataset.series = set.id.charAt(0); // accent de couleur par série (A/B/P), voir CSS

  const summary = document.createElement("summary");
  summary.className = "set-summary";
  summary.innerHTML = `
    <span class="set-summary-main">
      <span class="set-chevron" aria-hidden="true">▸</span>
      ${set.logo ? `
        <span class="set-logo-wrap">
          <img class="set-logo" src="${set.logo}" data-fallback="${set.logoFallback}" alt="" loading="lazy" decoding="async" />
          <span class="set-logo-unavailable">Logo introuvable</span>
        </span>` : ""}
      <span class="set-title">
        ${set.name}
        ${isNewest ? '<span class="badge badge-new">Nouveau</span>' : ""}
        ${complete ? '<span class="badge badge-complete">Terminée ✓</span>' : ""}
        ${almostRemaining ? `<span class="badge badge-almost">🔥 Plus que ${almostRemaining}</span>` : ""}
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
    <button type="button" class="btn btn-tiny" data-action="missing-image">🖼️ Image des manquantes</button>
    <button type="button" class="btn btn-tiny" data-action="pack-calc">🎲 Estimation boosters</button>
  `;
  body.appendChild(actions);

  const tiers = document.createElement("div");
  tiers.className = "set-tiers";
  tiers.innerHTML = buildTierPillsHtml(set);
  body.appendChild(tiers);

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
  const quantity = getQuantity(card.id);
  const wishlisted = isWishlisted(card.id);

  el.classList.toggle("owned", owned);
  el.classList.toggle("missing", !owned);
  el.classList.toggle("wishlisted", wishlisted);

  const toggleBtn = el.querySelector(".card-toggle");
  toggleBtn.setAttribute("aria-pressed", String(owned));
  toggleBtn.title = owned ? "Retirer de la collection" : "Ajouter à la collection";
  el.querySelector(".card-badge").textContent = owned ? "✓" : "✕";

  // L'image n'apparaît qu'une fois la carte possédée (voir buildCardMediaHtml) : il faut
  // reconstruire cette zone au toggle, pas seulement les classes/textes.
  const media = el.querySelector(".card-media");
  media.classList.remove("img-error");
  media.innerHTML = buildCardMediaHtml(card, owned);

  // Bouton liste de souhaits : n'existe que pour une carte manquante, à créer/retirer selon.
  let wishlistBtn = el.querySelector(".card-wishlist-btn");
  if (!owned) {
    if (!wishlistBtn) {
      wishlistBtn = document.createElement("button");
      wishlistBtn.type = "button";
      wishlistBtn.className = "card-wishlist-btn";
      wishlistBtn.dataset.action = "toggle-wishlist";
      el.insertBefore(wishlistBtn, el.querySelector(".card-footer"));
    }
    wishlistBtn.classList.toggle("active", wishlisted);
    wishlistBtn.setAttribute("aria-pressed", String(wishlisted));
    wishlistBtn.title = wishlisted ? "Retirer de la liste de souhaits" : "Ajouter à la liste de souhaits";
    wishlistBtn.textContent = "★";
  } else if (wishlistBtn) {
    wishlistBtn.remove();
  }

  // Pastille de note : n'existe que si une note personnelle a été saisie sur cette carte.
  const metaRow = el.querySelector(".card-meta-row");
  let noteBadge = metaRow.querySelector(".card-note-badge");
  if (hasNote(card.id)) {
    if (!noteBadge) {
      noteBadge = document.createElement("span");
      noteBadge.className = "card-note-badge";
      metaRow.insertBefore(noteBadge, metaRow.querySelector(".qty-stepper") || metaRow.querySelector(".card-info"));
    }
    noteBadge.title = getNote(card.id);
    noteBadge.textContent = "📝";
  } else if (noteBadge) {
    noteBadge.remove();
  }

  let qtyStepper = el.querySelector(".qty-stepper");
  if (owned) {
    if (!qtyStepper) {
      const template = document.createElement("div");
      template.innerHTML = buildQtyStepperHtml(quantity).trim();
      qtyStepper = template.firstElementChild;
      metaRow.insertBefore(qtyStepper, metaRow.querySelector(".card-info"));
    }
    qtyStepper.querySelector(".qty-value").textContent = `×${quantity}`;
  } else if (qtyStepper) {
    qtyStepper.remove();
  }
}

/**
 * Ligne des pastilles de palier (Diamant/Étoile/Brillante/Couronne) pour une extension.
 * Chaque pastille est cliquable (délégué via data-action="mark-tier", voir app.js) : un
 * clic marque tout le palier possédé, un second (une fois complet) le remet à manquant.
 */
function buildTierPillsHtml(set) {
  const tiers = computeSetTiers(set);
  return RARITY_TIERS.map((tierDef) => {
    const t = tiers[tierDef.group];
    if (t.total === 0) return "";
    const complete = t.owned === t.total;
    const action = complete ? "tout marquer manquant" : "tout marquer possédé";
    return `
      <button
        type="button"
        class="tier-pill${complete ? " tier-complete" : ""}"
        data-action="mark-tier"
        data-tier-group="${tierDef.group}"
        title="${tierDef.label} : ${t.owned}/${t.total} — clique pour ${action}"
      >
        <img class="rarity-icon" src="${tierDef.icon}" alt="" loading="lazy" decoding="async" />
        <span class="tier-count">${t.owned}/${t.total}</span>
        ${complete ? '<span class="tier-check" aria-hidden="true">✓</span>' : ""}
      </button>`;
  }).join("");
}

/** Met à jour les barres de progression des extensions déjà affichées, sans tout reconstruire. */
function updateSetProgressBars(sets) {
  document.querySelectorAll(".set-section[data-set-id]").forEach((section) => {
    const set = sets.find((s) => s.id === section.dataset.setId);
    if (!set) return;
    const total = set.cards.length;
    const owned = ownedCountInSet(set);
    const pct = total ? Math.round((owned / total) * 100) : 0;
    const complete = isSetComplete(set);

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

    const almostRemaining = complete ? null : almostDoneRemaining(set);
    let almostBadge = title.querySelector(".badge-almost");
    if (almostRemaining) {
      if (!almostBadge) {
        almostBadge = document.createElement("span");
        almostBadge.className = "badge badge-almost";
        title.appendChild(almostBadge);
      }
      almostBadge.textContent = `🔥 Plus que ${almostRemaining}`;
    } else if (almostBadge) {
      almostBadge.remove();
    }

    const tiersEl = section.querySelector(".set-tiers");
    if (tiersEl) tiersEl.innerHTML = buildTierPillsHtml(set);
  });
}

function sortSets(sets) {
  const withStats = sets.map((set) => ({
    set,
    total: set.cards.length,
    pct: setCompletionRatio(set),
  }));

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
    if (uiState.hideCompleted && isSetComplete(set)) return;
    if (uiState.hidePromos && isPromoSet(set)) return;

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

/** Version HTML (au lieu de texte brut) de la liste des manquantes, pour l'impression/PDF. */
function buildMissingListHtml(sets) {
  const sections = sets
    .map((set) => {
      const missing = set.cards.filter((card) => !isOwned(card.id));
      if (missing.length === 0) return "";
      const items = missing
        .map((card) => `<li>${formatCardNumber(card.localId)} · ${card.name}</li>`)
        .join("");
      return `<section><h2>${set.name} — ${missing.length} manquante${missing.length > 1 ? "s" : ""}</h2><ul>${items}</ul></section>`;
    })
    .join("");
  return sections || "<p>Toutes les cartes visées sont déjà possédées !</p>";
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

function openCardDetail(card, { onSearchByName } = {}) {
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
      <div class="card-detail-media">${buildCardMediaHtml(card, owned, { large: true })}</div>
      <div class="card-detail-info">
        <h3>
          <button type="button" class="card-detail-name-btn" id="card-detail-search-name" title="Voir toutes les cartes de ${card.name}">${card.name}</button>
        </h3>
        <p class="card-detail-sub">${card.id}${card.rarity ? " · " + card.rarity.label : ""} ${buildRarityIcons(card.rarity)}</p>
        <dl class="card-detail-stats">${rowsHtml}</dl>
        ${
          card.packs && card.packs.length
            ? `<div class="card-detail-packs">
                ${card.packs
                  .map(
                    (pack) => `
                    <span class="pack-icon-wrap" title="${pack}">
                      <img class="pack-icon" src="${packImageUrl(pack)}" alt="${pack}" loading="lazy" decoding="async" />
                      <span class="pack-icon-unavailable" aria-hidden="true">?</span>
                    </span>`
                  )
                  .join("")}
              </div>`
            : ""
        }
        <button type="button" class="btn" id="card-detail-toggle">
          ${owned ? "Marquer comme manquante" : "Marquer comme possédée"}
        </button>
        <label class="card-detail-note-label" for="card-detail-note">Note personnelle</label>
        <textarea
          id="card-detail-note"
          class="card-detail-note"
          maxlength="280"
          placeholder="Ex. : à échanger contre..."
        >${getNote(card.id)}</textarea>
      </div>
    </form>
  `;

  dialog.querySelector("#card-detail-toggle").addEventListener("click", () => {
    handleCardToggle(card);
    dialog.close();
  });

  dialog.querySelector("#card-detail-search-name").addEventListener("click", () => {
    onSearchByName?.(card.name);
    dialog.close();
  });

  const noteField = dialog.querySelector("#card-detail-note");
  noteField.addEventListener("blur", () => {
    setNote(card.id, noteField.value);
    patchCardDOM(card);
  });

  dialog.showModal();
}
