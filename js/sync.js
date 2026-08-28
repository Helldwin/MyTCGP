// Synchronisation de la collection entre appareils via un lien compact (+ QR code).
//
// Format binaire positionnel (v2) : au lieu d'un JSON {"A1-23": 1, ...} qui répète l'identifiant
// complet de chaque carte (et compresse mal, chaque id étant quasi unique), on encode par
// extension un bitmap de possession + un bitmap de souhaits (1 bit par carte, dans l'ordre déjà
// connu de l'extension) plus une liste éparse des doublons (quantité > 1). Pour une collection
// réelle bien remplie (des milliers de cartes), ça passe le payload JSON (~7 Ko compressés, qui
// dépasse la capacité d'un QR code — le QR ne se générait alors plus du tout) à quelques centaines
// d'octets à ~2 Ko compressés dans le pire cas (100% possédé). Le format est auto-descriptif
// (identifiant + nombre de cartes de chaque extension inclus dans le payload) : une extension
// inconnue de l'appareil qui décode (nouvelle extension parue entretemps) est simplement ignorée,
// sans planter.
//
// Compression gzip native (CompressionStream) par-dessus, pour gratter encore un peu. Le
// paramètre atterrit dans le FRAGMENT d'URL (#sync=...), jamais envoyé au serveur (adapté à un
// hébergement statique comme GitHub Pages).

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compressBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompressBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

class ByteWriter {
  constructor() {
    this.bytes = [];
  }
  u8(value) {
    this.bytes.push(value & 0xff);
  }
  u16(value) {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
  }
  raw(arrayLike) {
    for (let i = 0; i < arrayLike.length; i++) this.bytes.push(arrayLike[i]);
  }
  toUint8Array() {
    return Uint8Array.from(this.bytes);
  }
}

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  u8() {
    return this.bytes[this.pos++];
  }
  u16() {
    const value = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
    this.pos += 2;
    return value;
  }
  raw(length) {
    const out = this.bytes.slice(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
}

/** Encode la collection actuelle (quantités + souhaits) en octets compacts, extension par extension. */
function encodeCollectionBinary(sets) {
  const writer = new ByteWriter();
  const included = sets
    .filter((set) => set.cards.some((card) => getQuantity(card.id) > 0 || isWishlisted(card.id)))
    .slice(0, 255);

  writer.u8(included.length);
  included.forEach((set) => {
    const idBytes = new TextEncoder().encode(set.id);
    writer.u8(Math.min(idBytes.length, 255));
    writer.raw(idBytes.slice(0, 255));

    const n = set.cards.length;
    writer.u16(n);

    const ownedBits = new Uint8Array(Math.ceil(n / 8));
    const wishBits = new Uint8Array(Math.ceil(n / 8));
    const dups = [];
    set.cards.forEach((card, i) => {
      const qty = getQuantity(card.id);
      if (qty > 0) {
        ownedBits[i >> 3] |= 1 << (i % 8);
        if (qty > 1) dups.push([i, Math.min(qty, 255)]);
      } else if (isWishlisted(card.id)) {
        wishBits[i >> 3] |= 1 << (i % 8);
      }
    });
    writer.raw(ownedBits);
    writer.raw(wishBits);

    writer.u16(dups.length);
    dups.forEach(([i, qty]) => {
      writer.u16(i);
      writer.u8(qty);
    });
  });

  return writer.toUint8Array();
}

/** Décode le format ci-dessus en {quantities, wishlist}, à partir des extensions connues localement. */
function decodeCollectionBinary(bytes, sets) {
  const reader = new ByteReader(bytes);
  const setsById = new Map(sets.map((set) => [set.id, set]));
  const result = { quantities: {}, wishlist: [] };

  const setCount = reader.u8();
  for (let s = 0; s < setCount; s++) {
    const idLen = reader.u8();
    const setId = new TextDecoder().decode(reader.raw(idLen));
    const n = reader.u16();
    const byteLen = Math.ceil(n / 8);
    const ownedBits = reader.raw(byteLen);
    const wishBits = reader.raw(byteLen);
    const dupCount = reader.u16();
    const dups = new Map();
    for (let d = 0; d < dupCount; d++) {
      const idx = reader.u16();
      const qty = reader.u8();
      dups.set(idx, qty);
    }

    const localSet = setsById.get(setId);
    if (!localSet) continue; // extension inconnue ici (parue après l'export sur l'autre appareil) : ignorée

    const cards = localSet.cards;
    for (let i = 0; i < n && i < cards.length; i++) {
      const owned = (ownedBits[i >> 3] >> (i % 8)) & 1;
      if (owned) {
        result.quantities[cards[i].id] = dups.get(i) || 1;
      } else if ((wishBits[i >> 3] >> (i % 8)) & 1) {
        result.wishlist.push(cards[i].id);
      }
    }
  }

  return result;
}

/** Encode la collection actuelle (quantités + souhaits) en chaîne compacte pour l'URL. */
async function encodeCollectionForSync(sets) {
  const bytes = encodeCollectionBinary(sets);
  const compressed = await compressBytes(bytes);
  return toBase64Url(compressed);
}

/** Décode une chaîne générée par encodeCollectionForSync() en {quantities, wishlist}. */
async function decodeSyncPayload(encoded, sets) {
  const compressed = fromBase64Url(encoded);
  const bytes = await decompressBytes(compressed);
  return decodeCollectionBinary(bytes, sets);
}

function buildSyncUrl(encoded) {
  return `${location.origin}${location.pathname}#sync=${encoded}`;
}

/** Lit un paramètre de synchro dans l'URL courante (fragment #sync=...), s'il y en a un. */
function readSyncFromLocation() {
  const match = location.hash.match(/sync=([^&]+)/);
  return match ? match[1] : null;
}

/** Retire le paramètre de synchro de l'URL sans recharger la page (une fois traité). */
function clearSyncFromLocation() {
  history.replaceState(null, "", location.pathname + location.search);
}

/**
 * Génère la matrice de modules d'un QR code pour le texte donné (via js/qrcode.js), ou null si
 * le texte est trop volumineux pour un QR code (au-delà d'environ 2900 octets, capacité max d'un
 * QR version 40 en correction d'erreur "L"). Avec le format binaire ci-dessus, ça ne devrait
 * arriver que pour des collections quasi complètes avec énormément de doublons.
 */
function generateQrMatrix(text) {
  if (typeof QRCodeLib === "undefined") return null;
  try {
    return QRCodeLib.create(text, { errorCorrectionLevel: "L" }).modules;
  } catch {
    return null;
  }
}

/** Dessine une matrice de QR code (voir generateQrMatrix) en SVG dans un conteneur DOM. */
function renderQrMatrixToDom(modules, container) {
  const size = modules.size;
  const cell = 6;
  const pixelSize = size * cell;
  let rects = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(x, y)) rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  container.innerHTML = `
    <svg viewBox="0 0 ${pixelSize} ${pixelSize}" width="${pixelSize}" height="${pixelSize}" role="img" aria-label="QR code de synchronisation">
      <rect x="0" y="0" width="${pixelSize}" height="${pixelSize}" fill="#ffffff"/>
      <g fill="#12141c">${rects}</g>
    </svg>
  `;
}
