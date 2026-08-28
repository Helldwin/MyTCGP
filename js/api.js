// Récupération des données de cartes depuis le jeu de données communautaire
// "pokemon-tcg-pocket-database" (https://github.com/flibustier/pokemon-tcg-pocket-database),
// servi via jsDelivr. Cache local (localStorage) pour éviter de re-télécharger à chaque visite.

const DATA_BASE = "https://cdn.jsdelivr.net/npm/pokemon-tcg-pocket-database@latest/dist";
const EXCHANGE_BASE = "https://cdn.jsdelivr.net/gh/flibustier/pokemon-tcg-exchange@main/public/images";
const IMAGE_BASE = `${EXCHANGE_BASE}/cards-by-set`;
const RARITY_IMAGE_BASE = `${DATA_BASE}/images/rarities`;
const PACK_IMAGE_BASE = `${EXCHANGE_BASE}/packs`;
// Les logos vivent dans le dépôt Git de pokemon-tcg-pocket-database (accédé directement via
// jsDelivr, PAS via le chemin /npm/) : le dossier dist/images/sets/ n'est pas inclus dans le
// paquet npm publié (vérifié — 404 sur /npm/ y compris pour des sets anciens), alors qu'il
// est bien présent dans le dépôt et à jour à chaque nouvelle extension (contrairement à
// pokemon-tcg-exchange, qui accuse parfois un peu de retard sur les toutes dernières sorties).
const SET_LOGO_BASE = "https://cdn.jsdelivr.net/gh/flibustier/pokemon-tcg-pocket-database@main/dist/images/sets";
const CACHE_KEY = "tcgp_data_cache_v7";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Traductions FR + couleurs pour les métadonnées qui n'existent qu'en anglais dans les données.
const RARITY_LABELS_FR = {
  C: "Commune",
  U: "Peu commune",
  R: "Rare",
  RR: "Double rare",
  AR: "Rare artistique",
  SR: "Super rare",
  SAR: "Rare artistique spéciale",
  IM: "Rare immersive",
  UR: "Rare couronne",
  S: "Brillante",
  SSR: "Super rare brillante",
};

const RARITY_GROUP_LABELS_FR = {
  Diamond: "Diamant",
  Star: "Étoile",
  Crown: "Couronne",
  Shiny: "Brillant",
};

const ELEMENT_LABELS_FR = {
  grass: "Plante",
  fire: "Feu",
  water: "Eau",
  lightning: "Électrik",
  psychic: "Psy",
  fighting: "Combat",
  darkness: "Obscurité",
  metal: "Métal",
  dragon: "Dragon",
  colorless: "Normal",
};

const CATEGORY_LABELS_FR = {
  pokemon: "Pokémon",
  supporter: "Dresseur (Soutien)",
  item: "Objet",
  tool: "Outil Pokémon",
  fossil: "Objet (Fossile)",
};

function normalizeKey(value) {
  return typeof value === "string" ? value.toLowerCase() : value;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Erreur réseau (${res.status}) sur ${url}`);
  }
  return res.json();
}

function cardImageUrl(setCode, number) {
  return `${IMAGE_BASE}/${setCode}/${number}.webp`;
}

// Miniature ~65% plus légère que l'image complète (mêmes proportions) : utilisée dans la
// grille (potentiellement des centaines de cartes à la fois) ; l'image complète ne sert
// que dans la fiche détaillée d'une seule carte à la fois.
function cardThumbUrl(setCode, number) {
  return `${IMAGE_BASE}/thumbnails/${setCode}/${number}.webp`;
}

// Le logo n'existe pas toujours en français pour les extensions les plus récentes : l'appelant
// tente d'abord `logo`, puis `logoFallback` (anglais) en cas d'échec, avant de masquer le logo.
function setLogoUrl(setCode, locale) {
  return `${SET_LOGO_BASE}/LOGO_expansion_${setCode}_${locale}.webp`;
}

/** Image d'un booster (pack d'ouverture), à partir de son nom (ex. "Mewtwo", "Mega Blaziken"). */
function packImageUrl(packName) {
  return `${PACK_IMAGE_BASE}/${encodeURIComponent(packName)}.webp`;
}

function buildRarityMeta(rarities) {
  const meta = {};
  Object.entries(rarities).forEach(([code, info]) => {
    meta[code] = {
      code,
      label: RARITY_LABELS_FR[code] || info.label || code,
      group: info.group,
      groupLabel: RARITY_GROUP_LABELS_FR[info.group] || info.group,
      icon: info.image ? `${RARITY_IMAGE_BASE}/${info.image}` : null,
      count: info.count || 1,
    };
  });
  return meta;
}

async function fetchAllSetsWithCards() {
  const [setsBySeries, frCards, enCards, extraCards, rarities, pullRatesBySet] = await Promise.all([
    fetchJSON(`${DATA_BASE}/sets.json`),
    fetchJSON(`${DATA_BASE}/cards.fr.json`),
    fetchJSON(`${DATA_BASE}/cards.json`),
    fetchJSON(`${DATA_BASE}/cards.extra.json`),
    fetchJSON(`${DATA_BASE}/rarities.json`),
    fetchJSON(`${DATA_BASE}/pullRates.json`).catch(() => ({})), // optionnel : sert au calculateur de boosters
  ]);

  const rarityMeta = buildRarityMeta(rarities);

  // Les extensions les plus récentes n'ont pas toujours encore leur traduction
  // française dans le jeu de données : on complète avec les cartes anglaises
  // manquantes plutôt que de faire disparaître toute l'extension.
  const frKeys = new Set(frCards.map((card) => `${card.set}-${card.number}`));
  const missingFromFr = enCards.filter((card) => !frKeys.has(`${card.set}-${card.number}`));
  const allCards = frCards.concat(missingFromFr);

  const extraByKey = new Map();
  extraCards.forEach((card) => {
    extraByKey.set(`${card.set}-${card.number}`, card);
  });

  const cardsBySet = new Map();
  allCards.forEach((card) => {
    const key = `${card.set}-${card.number}`;
    const extra = extraByKey.get(key);
    const rarity = rarityMeta[card.rarity] || null;
    const category = extra ? normalizeKey(extra.type) : null;

    if (!cardsBySet.has(card.set)) cardsBySet.set(card.set, []);
    cardsBySet.get(card.set).push({
      id: key,
      localId: String(card.number),
      name: card.name,
      image: cardImageUrl(card.set, card.number),
      thumb: cardThumbUrl(card.set, card.number),
      packs: card.packs || [],
      rarityCode: card.rarity || null,
      rarity,
      element: extra ? normalizeKey(extra.element) : null,
      elementLabel: extra && extra.element ? ELEMENT_LABELS_FR[normalizeKey(extra.element)] || extra.element : null,
      category,
      categoryLabel: category ? CATEGORY_LABELS_FR[category] || extra.type : null,
      stage: extra ? extra.stage : null,
      health: extra ? extra.health : null,
      retreatCost: extra ? extra.retreatCost : null,
      weakness:
        extra && extra.weakness ? ELEMENT_LABELS_FR[normalizeKey(extra.weakness)] || extra.weakness : null,
      evolvesFrom: extra ? extra.evolvesFrom : null,
    });
  });

  const sets = [];
  Object.values(setsBySeries).forEach((seriesSets) => {
    seriesSets.forEach((s) => {
      const setCards = (cardsBySet.get(s.code) || []).sort(
        (a, b) => Number(a.localId) - Number(b.localId)
      );
      if (setCards.length === 0) return; // set annoncé mais sans carte encore répertoriée
      sets.push({
        id: s.code,
        name: (s.name && (s.name.fr || s.name.en)) || s.code,
        releaseDate: s.releaseDate || "",
        packs: s.packs || [],
        logo: setLogoUrl(s.code, "fr_FR"),
        logoFallback: setLogoUrl(s.code, "en_US"),
        pullRates: pullRatesBySet[s.code] || null,
        cards: setCards,
      });
    });
  });

  sets.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  return sets;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp || !Array.isArray(parsed.sets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(sets) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), sets }));
  } catch {
    // localStorage plein ou indisponible : pas bloquant, on continue sans cache.
  }
}

/**
 * Retourne la liste des sets (avec leurs cartes). Utilise le cache local s'il
 * est encore frais (< 24h), sinon retélécharge les données et met à jour le cache.
 */
async function getCardData({ forceRefresh = false } = {}) {
  const cache = readCache();
  const isFresh = cache && Date.now() - cache.timestamp < CACHE_TTL_MS;

  if (cache && isFresh && !forceRefresh) {
    return { sets: cache.sets, fromCache: true };
  }

  const sets = await fetchAllSetsWithCards();
  writeCache(sets);
  return { sets, fromCache: false };
}
