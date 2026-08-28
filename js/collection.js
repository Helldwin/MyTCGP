// Gestion de la collection possédée (localStorage), indépendante des données de cartes.

const COLLECTION_KEY = "tcgp_collection";
const LAST_MODIFIED_KEY = "tcgp_last_modified";
const LAST_EXPORTED_KEY = "tcgp_last_exported";

function loadOwnedSet() {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

let ownedCards = loadOwnedSet();

function saveOwnedSet() {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify([...ownedCards]));
    localStorage.setItem(LAST_MODIFIED_KEY, new Date().toISOString());
  } catch {
    // localStorage plein ou indisponible : le changement reste actif en mémoire pour la session.
  }
}

function isOwned(cardId) {
  return ownedCards.has(cardId);
}

function getOwnedCount() {
  return ownedCards.size;
}

function toggleOwned(cardId) {
  if (ownedCards.has(cardId)) {
    ownedCards.delete(cardId);
  } else {
    ownedCards.add(cardId);
  }
  saveOwnedSet();
  return ownedCards.has(cardId);
}

/** Force l'état possédé/manquant d'une carte donnée (utilisé pour l'annulation). */
function setOwned(cardId, owned) {
  if (owned) ownedCards.add(cardId);
  else ownedCards.delete(cardId);
  saveOwnedSet();
}

/** Marque plusieurs cartes possédées/manquantes en une fois (actions groupées par extension). */
function setManyOwned(cardIds, owned) {
  cardIds.forEach((id) => {
    if (owned) ownedCards.add(id);
    else ownedCards.delete(id);
  });
  saveOwnedSet();
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
    owned: [...ownedCards],
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
        const arr = Array.isArray(parsed) ? parsed : parsed.owned;
        if (!Array.isArray(arr)) throw new Error("Format de fichier invalide.");
        ownedCards = new Set(arr);
        saveOwnedSet();
        resolve(ownedCards.size);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
