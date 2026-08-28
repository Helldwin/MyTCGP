# Ma collection Pokémon TCG Pocket

Site statique qui liste toutes les cartes du jeu mobile **Pokémon TCG Pocket** et permet de
suivre ce qu'on possède (avec doublons et liste de souhaits), de voir sa progression, de la
partager en image, et de synchroniser sa collection entre appareils. Tout est enregistré
uniquement dans le `localStorage` de ton navigateur (aucun compte, aucun serveur).

## Fonctionnalités

- **Suivi de collection** : possédé/manquant, quantité d'exemplaires (doublons pour l'échange —
  filtre dédié, export PNG, compteur dans le tableau de bord), liste de souhaits sur les cartes
  manquantes ciblées en priorité (même trio filtre/export/suivi).
- **Paliers de complétion** par rareté (Diamant/Étoile/Brillante/Couronne) — "Terminée" veut dire
  "tous les Diamants obtenus", pas nécessairement 100% (les raretés au-dessus sont très
  difficiles à obtenir). Chaque palier est cliquable pour tout marquer/démarquer d'un coup.
- **Filtres** : rareté, type d'énergie, catégorie, booster, recherche (insensible aux accents),
  masquer les extensions complètes, masquer les promos (par défaut).
- **Sélection multiple** : Maj+clic pour une plage de cartes, Ctrl/Cmd+clic pour une carte,
  actions groupées sur la sélection.
- **Images à télécharger** : liste illustrée des cartes manquantes d'une extension (logo +
  vignettes + numéros), liste de souhaits illustrée, et image de partage de la progression
  globale façon "tableau de badges" (formats standard, carré et vertical pour les stories).
- **Calculateur de boosters** : estimation du nombre de boosters à ouvrir pour compléter les
  Diamants manquants d'une extension, à partir des taux de tirage réels du jeu.
- **Synchronisation entre appareils** via un lien compact (+ QR code), sans compte ni serveur —
  la collection est compressée et encodée directement dans l'URL.
- **Mode focus**, raccourcis clavier (`/` recherche, `Échap` ferme/annule), thème clair/sombre,
  bannière "nouvelle extension disponible".
- Installable et utilisable hors-ligne après une première visite (PWA, network-first).

## Sources de données

- Cartes, raretés, taux de tirage : jeu de données communautaire
  [pokemon-tcg-pocket-database](https://github.com/flibustier/pokemon-tcg-pocket-database) (via
  jsDelivr, cache localStorage 24h). Pour les cartes pas encore traduites en français, le site
  bascule automatiquement sur le nom anglais.
- Logos d'extension : dépôt Git de `pokemon-tcg-pocket-database` accédé **directement** (pas via
  le chemin `/npm/` de jsDelivr — le dossier `dist/images/sets/` n'est pas inclus dans le paquet
  npm publié, seulement dans le dépôt). Repli français → anglais → texte "Logo introuvable".
- Images de cartes et icônes de booster : dépôt associé
  [pokemon-tcg-exchange](https://github.com/flibustier/pokemon-tcg-exchange). Miniatures pour la
  grille (plus léger), pleine résolution pour la fiche détaillée. Repli "Image indisponible" /
  "?" si une carte très récente n'est pas encore mirorée.

Ces deux dépôts communautaires évoluent au fil des sorties du jeu — il est normal qu'une
extension tout juste sortie manque temporairement d'images le temps que la communauté les ajoute.

## Architecture

Aucune dépendance ni build pour le site lui-même : HTML/CSS/JS vanilla, chargé via des balises
`<script>` classiques.

```
index.html
css/style.css
js/
  api.js          # récupération + fusion des données (cartes, raretés, boosters), cache localStorage
  collection.js   # collection (quantités, souhaits) en localStorage, import/export
  theme.js        # bascule thème clair/sombre
  toast.js        # notifications + annulation
  ui-state.js     # filtres, tri, vue, sections pliées (localStorage)
  render.js       # construction du DOM (tableau de bord, sections, cartes, fiche détail)
  share-image.js  # génération des PNG (manquantes, souhaits, progression) via Canvas
  qrcode.js       # bibliothèque QR code vendue (voir en-tête du fichier), sans dépendance runtime
  sync.js         # compression/encodage du lien de synchronisation + rendu du QR code
  app.js          # orchestration : chargement des données, wiring des événements, raccourcis
  sw-register.js  # enregistrement du service worker
service-worker.js  # tout en network-first, repli sur le cache si hors-ligne (PWA)
manifest.webmanifest
icons/              # icônes PWA (SVG)
tests/              # suite de tests Playwright (développement uniquement)
```

`package.json`, `playwright.config.js` et `tests/` ne servent qu'au développement (tests
automatisés) — ils ne sont pas nécessaires pour déployer ou utiliser le site.

## Lancer en local

Ouvrir simplement `index.html` dans un navigateur, ou lancer un petit serveur local :

```bash
python -m http.server 8123
```

puis aller sur `http://localhost:8123`.

## Tests

```bash
npm install
npx playwright install chromium   # une seule fois
npm test
```

## Déployer sur GitHub Pages

1. Pousser ce repo sur GitHub.
2. Dans le repo GitHub : **Settings → Pages**.
3. Section **Build and deployment** → Source : **Deploy from a branch**.
4. Branche : `main`, dossier : `/ (root)`.
5. Sauvegarder — le site sera disponible sous `https://<utilisateur>.github.io/<repo>/` après
   quelques minutes.

### Mise en cache du service worker

Le service worker (`service-worker.js`) sert tout en **network-first** : tant qu'il y a du
réseau, un visiteur reçoit toujours la dernière version déployée (HTML/CSS/JS + données de
cartes) ; le cache ne sert que de repli quand il est hors-ligne. Pas besoin d'incrémenter
`CACHE_NAME` à chaque déploiement — seulement si un cache existant chez des visiteurs doit être
purgé explicitement (ex. après un bug qui aurait mis en cache une réponse cassée).

## Sauvegarder / synchroniser sa collection

Le `localStorage` est propre à un navigateur/appareil. Trois façons de transférer sa collection :

- **Export/Import** : bouton **Exporter** (télécharge un `.json`), bouton **Importer** pour le
  recharger. Une bannière de rappel s'affiche si aucun export n'a été fait depuis plus de 7 jours.
- **Lien de synchronisation** (bouton **🔗 Synchroniser un appareil**) : génère un lien compact
  (+ QR code si la collection est assez petite) à ouvrir sur l'autre appareil. Rien ne transite
  par un serveur — la collection est encodée directement dans l'URL.
