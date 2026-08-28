# Ma collection Pokémon TCG Pocket

Site statique qui liste toutes les cartes du jeu mobile **Pokémon TCG Pocket** et permet
de cocher celles que tu possèdes, avec tableau de bord, filtres, thème clair/sombre et mode
hors-ligne. Ta collection est enregistrée uniquement dans le `localStorage` de ton navigateur
(aucun compte, aucun serveur).

- Données de cartes récupérées en direct depuis le jeu de données communautaire
  [pokemon-tcg-pocket-database](https://github.com/flibustier/pokemon-tcg-pocket-database)
  (via jsDelivr — mises en cache 24h dans le navigateur pour la rapidité, avec un bouton
  "Actualiser"). Les images viennent du dépôt associé
  [pokemon-tcg-exchange](https://github.com/flibustier/pokemon-tcg-exchange). Pour les toutes
  dernières cartes pas encore traduites en français, le site bascule automatiquement sur le nom
  anglais ; si l'image n'est pas encore disponible non plus, un repli visuel s'affiche à la place
  d'une image cassée.
- Aucune dépendance ni build : HTML/CSS/JS vanilla, chargé via des balises `<script>` classiques.
- Installable et utilisable hors-ligne après une première visite (PWA).

## Architecture

```
index.html
css/style.css
js/
  api.js          # récupération + fusion des données (cartes, raretés, stats), cache localStorage
  collection.js   # collection possédée (localStorage), import/export, horodatage
  theme.js        # bascule thème clair/sombre
  toast.js        # notifications + annulation
  ui-state.js     # filtres, tri, vue, sections pliées (localStorage)
  render.js       # construction du DOM (tableau de bord, sections, cartes, fiche détail)
  app.js          # orchestration : chargement des données, wiring des événements
  sw-register.js  # enregistrement du service worker
service-worker.js  # tout en network-first, repli sur le cache si hors-ligne (PWA)
manifest.webmanifest
icons/            # icônes PWA (SVG)
```

## Lancer en local

Ouvrir simplement `index.html` dans un navigateur, ou lancer un petit serveur local :

```bash
python -m http.server 8000
```

puis aller sur `http://localhost:8000`.

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

## Sauvegarder sa collection

Le `localStorage` est propre à un navigateur/appareil. Utilise le bouton **Exporter** pour
télécharger un fichier `.json` de sauvegarde, et **Importer** pour le recharger (sur un autre
appareil, un autre navigateur, ou après avoir vidé le cache). Une bannière de rappel s'affiche
automatiquement si aucun export n'a été fait depuis plus de 7 jours.
