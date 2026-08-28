// Gestion de la collection (localStorage), indépendante des données de cartes.
// Chaque carte a une quantité (0 = manquante, N = possédée avec N exemplaires) — le suivi des
// doublons permet de repérer ce qu'on peut échanger. Une liste de souhaits séparée marque les
// cartes manquantes qu'on cible en priorité.

const COLLECTION_KEY = "tcgp_collection";
const WISHLIST_KEY = "tcgp_wishlist";
const NOTES_KEY = "tcgp_notes";
const LAST_MODIFIED_KEY = "tcgp_last_modified";
const LAST_EXPORTED_KEY = "tcgp_last_exported";
const MAX_QUANTITY = 99;
const MAX_NOTE_LENGTH = 280;

function loadQuantities() {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    // Ancien format (avant le suivi des doublons) : tableau d'ids possédés, 1 exemplaire chacun.
    if (Array.isArray(parsed)) return new Map(parsed.map((id) => [id, 1]));
    if (parsed && typeof parsed === "object") {
      return new Map(Object.entries(parsed).filter(([, qty]) => Number(qty) > 0).map(([id, qty]) => [id, Number(qty)]));
    }
    return new Map();
  } catch {
    return new Map();
  }
}

function loadWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? new Map(Object.entries(parsed)) : new Map();
  } catch {
    return new Map();
  }
}

let cardQuantities = loadQuantities();
let wishlistIds = loadWishlist();
let cardNotes = loadNotes();

function saveQuantities() {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(Object.fromEntries(cardQuantities)));
    localStorage.setItem(LAST_MODIFIED_KEY, new Date().toISOString());
  } catch {
    // localStorage plein ou indisponible : le changement reste actif en mémoire pour la session.
  }
}

function saveWishlist() {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify([...wishlistIds]));
  } catch {
    // pas bloquant
  }
}

function getQuantity(cardId) {
  return cardQuantities.get(cardId) || 0;
}

function isOwned(cardId) {
  return getQuantity(cardId) > 0;
}

/** Nombre de cartes DISTINCTES possédées (pas la somme des doublons). */
function getOwnedCount() {
  return cardQuantities.size;
}

/** Copie {cardId: quantité} de toute la collection (utilisé pour l'export et la synchro). */
function getAllQuantities() {
  return Object.fromEntries(cardQuantities);
}

/** Fixe la quantité d'une carte (0 = la retire de la collection). Bornée à [0, 99]. */
function setQuantity(cardId, quantity) {
  const clamped = Math.max(0, Math.min(MAX_QUANTITY, Math.round(quantity) || 0));
  if (clamped <= 0) cardQuantities.delete(cardId);
  else cardQuantities.set(cardId, clamped);
  saveQuantities();
  if (clamped > 0) removeFromWishlist(cardId); // possédée : plus besoin de la souhaiter
  return clamped;
}

function incrementQuantity(cardId) {
  return setQuantity(cardId, getQuantity(cardId) + 1);
}

function decrementQuantity(cardId) {
  return setQuantity(cardId, getQuantity(cardId) - 1);
}

/** Bascule possédée/manquante (1 exemplaire) — l'interaction rapide principale sur une carte. */
function toggleOwned(cardId) {
  return setQuantity(cardId, isOwned(cardId) ? 0 : 1) > 0;
}

/** Force l'état possédé/manquant d'une carte à une quantité précise (utilisé pour l'annulation). */
function setOwned(cardId, quantity) {
  setQuantity(cardId, quantity);
}

/** Marque plusieurs cartes possédées (1 exemplaire)/manquantes en une fois (actions groupées). */
function setManyOwned(cardIds, owned) {
  cardIds.forEach((id) => {
    if (owned) {
      if (!isOwned(id)) cardQuantities.set(id, 1);
    } else {
      cardQuantities.delete(id);
    }
  });
  saveQuantities();
  if (owned) cardIds.forEach((id) => removeFromWishlist(id));
}

function isWishlisted(cardId) {
  return wishlistIds.has(cardId);
}

function getWishlistIds() {
  return [...wishlistIds];
}

function toggleWishlist(cardId) {
  if (wishlistIds.has(cardId)) wishlistIds.delete(cardId);
  else wishlistIds.add(cardId);
  saveWishlist();
  return wishlistIds.has(cardId);
}

function removeFromWishlist(cardId) {
  if (wishlistIds.delete(cardId)) saveWishlist();
}

/** Note personnelle libre sur une carte (ex. "à échanger contre X") — vide si aucune. */
function getNote(cardId) {
  return cardNotes.get(cardId) || "";
}

function hasNote(cardId) {
  return cardNotes.has(cardId);
}

function setNote(cardId, text) {
  const trimmed = (text || "").trim().slice(0, MAX_NOTE_LENGTH);
  if (trimmed) cardNotes.set(cardId, trimmed);
  else cardNotes.delete(cardId);
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(Object.fromEntries(cardNotes)));
  } catch {
    // pas bloquant
  }
}

function getLastModified() {
  try {
    return localStorage.getItem(LAST_MODIFIED_KEY);
  } catch {
    return null;
  }
}

function getLastExported() {
  try {
    return localStorage.getItem(LAST_EXPORTED_KEY);
  } catch {
    return null;
  }
}

function touchLastExported() {
  try {
    localStorage.setItem(LAST_EXPORTED_KEY, new Date().toISOString());
  } catch {
    // pas bloquant
  }
}

function exportCollection() {
  const payload = {
    exportedAt: new Date().toISOString(),
    quantities: Object.fromEntries(cardQuantities),
    wishlist: [...wishlistIds],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ma-collection-tcgp-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  touchLastExported();
}

function importCollectionFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        applyImportedCollection(parsed);
        resolve(cardQuantities.size);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Accepte l'ancien format ({owned:[...]})  et le nouveau ({quantities:{...}, wishlist:[...]}). */
function applyImportedCollection(parsed) {
  if (Array.isArray(parsed)) {
    cardQuantities = new Map(parsed.map((id) => [id, 1]));
  } else if (parsed && Array.isArray(parsed.owned)) {
    cardQuantities = new Map(parsed.owned.map((id) => [id, 1]));
  } else if (parsed && parsed.quantities && typeof parsed.quantities === "object") {
    cardQuantities = new Map(
      Object.entries(parsed.quantities)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([id, qty]) => [id, Number(qty)])
    );
  } else {
    throw new Error("Format de fichier invalide.");
  }
  wishlistIds = new Set(Array.isArray(parsed?.wishlist) ? parsed.wishlist : []);
  saveQuantities();
  saveWishlist();
}
