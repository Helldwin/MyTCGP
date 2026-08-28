// État de l'interface (filtres, tri, vue, sections pliées) — persisté en localStorage,
// séparé de la collection possédée (tcgp_collection) et des données de cartes (cache API).

const UI_STATE_KEY = "tcgp_ui_state";

const DEFAULT_UI_STATE = {
  view: "grid", // "grid" | "list"
  sort: "release", // "release" | "completion" | "name" | "count"
  hideCompleted: false,
  hidePromos: true, // les extensions promo sont masquées par défaut (moins prioritaires)
  onlyMissing: false,
  onlyWishlist: false,
  onlyDuplicates: false,
  search: "",
  rarityGroups: [], // groupes de rareté sélectionnés ; vide = tous
  elements: [], // types d'énergie sélectionnés ; vide = tous
  categories: [], // catégories sélectionnées ; vide = toutes
  pack: "", // booster sélectionné ; "" = tous
  collapsedSets: {}, // { [setId]: true } si repliée (déplié par défaut)
};

function loadUIState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return { ...DEFAULT_UI_STATE, collapsedSets: {} };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_UI_STATE,
      ...parsed,
      collapsedSets: parsed.collapsedSets || {},
    };
  } catch {
    return { ...DEFAULT_UI_STATE, collapsedSets: {} };
  }
}

const uiState = loadUIState();

function saveUIState() {
  try {
    // La recherche et le texte ne sont pas persistés d'une session à l'autre (état transitoire).
    const { search, ...persisted } = uiState;
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(persisted));
  } catch {
    // pas bloquant
  }
}

function isSetCollapsed(setId, defaultCollapsed = false) {
  if (Object.prototype.hasOwnProperty.call(uiState.collapsedSets, setId)) {
    return uiState.collapsedSets[setId];
  }
  return defaultCollapsed;
}

// Toujours stocké explicitement (jamais de "delete" pour revenir au défaut) : le défaut
// lui-même peut varier selon l'appelant (voir isSetCollapsed), un raccourci par suppression
// serait ambigu et risquerait d'inverser silencieusement la préférence de l'utilisateur.
function setSetCollapsed(setId, collapsed) {
  uiState.collapsedSets[setId] = Boolean(collapsed);
  saveUIState();
}

function collapseAllSets(setIds, collapsed) {
  setIds.forEach((id) => {
    uiState.collapsedSets[id] = Boolean(collapsed);
  });
  saveUIState();
}

/** Vrai si un filtre qui réduit la liste de cartes visibles est actif (hors recherche). */
function hasActiveFilters() {
  return (
    uiState.rarityGroups.length > 0 ||
    uiState.elements.length > 0 ||
    uiState.categories.length > 0 ||
    Boolean(uiState.pack) ||
    uiState.onlyMissing ||
    uiState.onlyWishlist ||
    uiState.onlyDuplicates
  );
}

function toggleArrayValue(array, value) {
  const idx = array.indexOf(value);
  if (idx === -1) array.push(value);
  else array.splice(idx, 1);
}

// Plage Unicode des diacritiques combinants (accents), retirés après normalize("NFD")
// pour une recherche insensible aux accents (ex. "pepe" trouve "Pépé").
const DIACRITICS_REGEX = /[̀-ͯ]/g;

function normalizeSearchText(text) {
  return text
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase();
}
