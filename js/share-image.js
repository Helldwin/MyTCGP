// Génération d'images PNG côté navigateur (Canvas) : liste illustrée des cartes manquantes
// d'une extension, et image de partage de la progression globale façon "tableau de badges".
// Les hébergeurs d'images utilisés (jsDelivr) autorisent le CORS (`Access-Control-Allow-Origin:
// *`, vérifié), donc les images chargées en crossOrigin="anonymous" peuvent être dessinées sur
// un canvas puis exportées en PNG sans le "tainter".

function loadImageCrossOrigin(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("URL manquante"));
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Échec du chargement de ${url}`));
    img.src = url;
  });
}

function loadImageOrNull(url) {
  return loadImageCrossOrigin(url).catch(() => null);
}

function drawRoundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/** Dessine une image en mode "contain" (proportions préservées, centrée) dans un rectangle. */
function drawImageContain(ctx, img, x, y, width, height) {
  const scale = Math.min(width / img.width, height / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function truncateText(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Échec de la génération du PNG."))), "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Génère un PNG listant les cartes manquantes d'une extension — image, numéro et nom de
 * chaque carte, logo de l'extension en en-tête — puis déclenche son téléchargement.
 */
async function generateMissingCardsImage(set) {
  const missing = set.cards.filter((card) => !isOwned(card.id));
  if (missing.length === 0) {
    showToast("Rien à générer : toutes les cartes de cette extension sont déjà possédées.");
    return;
  }

  const dismissLoading = showToast(`Génération de l'image (${missing.length} cartes)…`, { duration: 45000 });

  try {
    // Vignettes volontairement compactes : un PNG reste sans perte, donc une mosaïque de
    // centaines d'illustrations pèse vite des dizaines de Mo à pleine taille — peu pratique
    // à partager. On garde des cartes lisibles (numéro + nom) sans viser la haute résolution.
    const columns = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(missing.length * 1.4))));
    const cellWidth = 82;
    const cardHeight = Math.round(cellWidth * (337 / 245));
    const labelHeight = 30;
    const cellHeight = cardHeight + labelHeight;
    const gap = 10;
    const margin = 22;
    const rows = Math.ceil(missing.length / columns);
    const headerHeight = 100;

    const width = margin * 2 + columns * cellWidth + (columns - 1) * gap;
    const height = headerHeight + margin + rows * cellHeight + (rows - 1) * gap + margin;

    const [logo, cardImages] = await Promise.all([
      loadImageOrNull(set.logo).then((img) => img || loadImageOrNull(set.logoFallback)),
      Promise.all(missing.map((card) => loadImageOrNull(card.thumb || card.image))),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f5f6fa";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, width, headerHeight);
    if (logo) drawImageContain(ctx, logo, margin, 12, 170, headerHeight - 24);

    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px 'Segoe UI', sans-serif";
    ctx.fillText(`${missing.length} carte${missing.length > 1 ? "s" : ""} manquante${missing.length > 1 ? "s" : ""}`, width - margin, headerHeight / 2 - 2);
    ctx.font = "14px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#ffcb05";
    ctx.fillText(set.name, width - margin, headerHeight / 2 + 22);

    missing.forEach((card, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + col * (cellWidth + gap);
      const y = headerHeight + margin + row * (cellHeight + gap);

      const img = cardImages[index];
      if (img) {
        ctx.save();
        drawRoundedRectPath(ctx, x, y, cellWidth, cardHeight, 6);
        ctx.clip();
        drawImageContain(ctx, img, x, y, cellWidth, cardHeight);
        ctx.restore();
      } else {
        ctx.fillStyle = "#e6e8f0";
        drawRoundedRectPath(ctx, x, y, cellWidth, cardHeight, 6);
        ctx.fill();
        ctx.fillStyle = "#5b6072";
        ctx.textAlign = "center";
        ctx.font = "bold 15px 'Segoe UI', sans-serif";
        ctx.fillText(formatCardNumber(card.localId), x + cellWidth / 2, y + cardHeight / 2 + 5);
      }
      ctx.strokeStyle = "#dcdfe8";
      ctx.lineWidth = 1;
      drawRoundedRectPath(ctx, x, y, cellWidth, cardHeight, 6);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = "#1b1e2a";
      ctx.font = "bold 10px 'Segoe UI', sans-serif";
      ctx.fillText(`${formatCardNumber(card.localId)} ${truncateText(card.name, 10)}`, x + cellWidth / 2, y + cardHeight + 20);
    });

    const blob = await canvasToPngBlob(canvas);
    downloadBlob(blob, `cartes-manquantes-${set.id}.png`);
    dismissLoading();
    showToast("Image téléchargée.");
  } catch (err) {
    console.error(err);
    dismissLoading();
    showToast("Impossible de générer l'image.");
  }
}

/**
 * Génère une image de partage de la progression globale — un peu comme un tableau de badges :
 * une pastille par extension (logo, colorée si "Terminée", grisée sinon), plus les stats
 * globales et par série — puis déclenche son téléchargement.
 */
async function generateProgressShareImage(sets, stats) {
  const dismissLoading = showToast("Génération de l'image de progression…", { duration: 45000 });

  try {
    const badgeSets = sets.filter((set) => !isPromoSet(set));
    const columns = 5;
    const cellWidth = 184;
    const cellHeight = 108;
    const gap = 14;
    const margin = 28;
    const rows = Math.ceil(badgeSets.length / columns);
    const headerHeight = 150;
    const badgesHeight = rows * cellHeight + Math.max(0, rows - 1) * gap;

    const rarityEntries = Object.entries(stats.byRarityGroup);
    const footerHeight = 60 + Object.keys(stats.bySeries).length * 26 + rarityEntries.length * 22 + 40;

    const width = margin * 2 + columns * cellWidth + (columns - 1) * gap;
    const height = headerHeight + margin + badgesHeight + margin + footerHeight;

    const logos = await Promise.all(
      badgeSets.map((set) => loadImageOrNull(set.logo).then((img) => img || loadImageOrNull(set.logoFallback)))
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#12141c");
    bg.addColorStop(1, "#1b1e2a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px 'Segoe UI', sans-serif";
    ctx.fillText("Ma collection Pokémon TCG Pocket", margin, 46);

    ctx.font = "bold 44px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#ffcb05";
    ctx.fillText(`${stats.totalOwned} / ${stats.totalCards}`, margin, 100);

    ctx.font = "18px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#9aa0b4";
    ctx.fillText(
      `cartes possédées (${stats.pct}%) — ${stats.completedSets} / ${badgeSets.length} extensions terminées (tous les Diamants)`,
      margin,
      130
    );

    badgeSets.forEach((set, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + col * (cellWidth + gap);
      const y = headerHeight + margin + row * (cellHeight + gap);
      const complete = isSetComplete(set);

      ctx.fillStyle = complete ? "rgba(53, 196, 107, 0.14)" : "rgba(255, 255, 255, 0.04)";
      drawRoundedRectPath(ctx, x, y, cellWidth, cellHeight, 14);
      ctx.fill();
      ctx.strokeStyle = complete ? "#35c46b" : "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 2;
      drawRoundedRectPath(ctx, x, y, cellWidth, cellHeight, 14);
      ctx.stroke();

      const logo = logos[index];
      ctx.save();
      drawRoundedRectPath(ctx, x, y, cellWidth, cellHeight, 14);
      ctx.clip();
      if (!complete) ctx.filter = "grayscale(1) opacity(0.5)";
      if (logo) {
        drawImageContain(ctx, logo, x + 12, y + 10, cellWidth - 24, cellHeight - 36);
      } else {
        ctx.fillStyle = "#9aa0b4";
        ctx.textAlign = "center";
        ctx.font = "bold 13px 'Segoe UI', sans-serif";
        ctx.fillText(truncateText(set.name, 20), x + cellWidth / 2, y + cellHeight / 2);
      }
      ctx.restore();

      const total = set.cards.length;
      const owned = ownedCountInSet(set);
      ctx.textAlign = "center";
      ctx.font = "11px 'Segoe UI', sans-serif";
      ctx.fillStyle = complete ? "#35c46b" : "#9aa0b4";
      ctx.fillText(complete ? `✓ Terminée` : `${owned} / ${total}`, x + cellWidth / 2, y + cellHeight - 12);
    });

    let ly = headerHeight + margin + badgesHeight + margin + 26;
    ctx.textAlign = "left";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#eef0f6";
    Object.entries(stats.bySeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, s]) => {
        const pct = s.total ? Math.round((s.owned / s.total) * 100) : 0;
        ctx.fillText(`Série ${key} : ${s.owned} / ${s.total} (${pct}%)`, margin, ly);
        ly += 26;
      });

    ly += 8;
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#9aa0b4";
    rarityEntries.forEach(([label, count]) => {
      ctx.fillText(`${label} : ${count} cartes possédées`, margin, ly);
      ly += 22;
    });

    ctx.textAlign = "right";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#5b6072";
    ctx.fillText(`Généré le ${new Date().toLocaleDateString("fr-FR")}`, width - margin, height - 18);

    const blob = await canvasToPngBlob(canvas);
    downloadBlob(blob, `ma-progression-tcgp-${new Date().toISOString().slice(0, 10)}.png`);
    dismissLoading();
    showToast("Image de progression téléchargée.");
  } catch (err) {
    console.error(err);
    dismissLoading();
    showToast("Impossible de générer l'image.");
  }
}
