# unfold

Visualiseur d'appels de fonctions : on écrit un programme Haskell, on l'exécute, et on voit l'arbre des appels se déplier étape par étape.

## Prérequis

- GHC 9.10 (testé avec 9.10.3) et cabal
- Accès réseau au premier `cabal build` (index Hackage)
- Node.js 22.12 ou plus récent, en version paire (22, 24, 26 ; vitest exclut 23 et 25)

## Démarrage

```
npm install
npm run dev
```

Puis ouvrir l'URL affichée par Vite (en général http://localhost:5173). Le serveur écoute sur 127.0.0.1:5174 et Vite lui transmet les requêtes `/api`. Au premier lancement, la compilation de l'instrumenteur prend un moment.

Tests : `npm test`.

## Déploiement

- Front : Vercel (`vercel.json` à la racine), qui redirige `/api/*` vers le backend.
- Backend : service web Docker gratuit sur Render (`render.yaml`, `Dockerfile`), redéployé à chaque push sur `main`.

## Limites connues

- Environ 5 000 étapes et 10 s par exécution au maximum.
- Sortie tronquée à 100 Ko.
- Un seul fichier, qui contient `main`. Seuls les paquets `base` et `containers` sont disponibles.
- Pas d'entrée clavier (`getLine` et équivalents).
- Fonctions de bibliothèque tracées : `map`, `filter`, `foldr`, `foldl`, `length`, `sum`, `product`, `++`, `reverse`, `concat`, `zip`, `take`, `drop`, `elem`, `replicate`, uniquement sur des listes. Sinon elles ne sont pas tracées, et un message le signale.
- Les méthodes d'instance sans argument ne sont pas tracées.
- Certains parents sont approximatifs : le lien est alors dessiné en pointillés.

## Ajouter un langage

Implémenter l'interface `Tracer` de `server/src/languages/types.ts` : elle prend le code source et renvoie une `Trace` commune.
