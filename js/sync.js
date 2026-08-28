// Synchronisation de la collection entre appareils via un lien compact (+ QR code). Compression
// native (CompressionStream, disponible sans dépendance dans les navigateurs modernes) pour
// garder l'URL la plus courte possible ; le QR code utilise la bibliothèque vendue dans
// js/qrcode.js. Le paramètre atterrit dans le FRAGMENT d'URL (#sync=...), jamais envoyé au
// serveur (adapté à un hébergement statique comme GitHub Pages).

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

async function compressText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompressToText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

/** Encode la collection actuelle (quantités + souhaits) en chaîne compacte pour l'URL. */
async function encodeCollectionForSync() {
  const payload = JSON.stringify({ q: getAllQuantities(), w: getWishlistIds() });
  const compressed = await compressText(payload);
  return toBase64Url(compressed);
}

/** Décode une chaîne générée par encodeCollectionForSync() en {quantities, wishlist}. */
async function decodeSyncPayload(encoded) {
  const bytes = fromBase64Url(encoded);
  const json = await decompressToText(bytes);
  const parsed = JSON.parse(json);
  return { quantities: parsed.q || {}, wishlist: parsed.w || [] };
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
 * le texte est trop volumineux pour un QR code (au-delà d'environ 2900 octets compressés).
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
