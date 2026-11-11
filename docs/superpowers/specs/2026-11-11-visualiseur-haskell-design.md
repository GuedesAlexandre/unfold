# Unfold — visualiseur d'exécution (étape 1 : Haskell)

Date : 2026-11-11
Statut : brouillon, en attente de validation

## Intention

Unfold est une app web qui permet de **voir un algorithme s'exécuter**. On écrit du code
à gauche, on clique sur « Exécuter », et à droite on voit l'exécution se dérouler étape par
étape : quels appels ont lieu, avec quelles données, qui attend qui, et quelles valeurs
remontent.

Le but est d'**aider les gens qui apprennent**, en particulier ceux qui bloquent sur la
récursivité, et de leur servir d'outil de **débogage visuel**. N'importe quel algorithme
écrit par l'utilisateur doit pouvoir être visualisé, pas seulement des exemples préparés.

Étape 1 (aujourd'hui) : Haskell, en local. Étape 2 (prochaine session) : ajouter C et Python.

## Objectifs

1. Éditeur de code Haskell à gauche, visualisation à droite, bouton ▶ Exécuter.
2. Compiler et exécuter du **vrai Haskell** avec le GHC installé (9.10.3). Tout programme
   Haskell valide qu'un apprenant peut écrire doit fonctionner, dans la limite des
   restrictions listées plus bas.
3. Visualisation en **deux vues synchronisées** (maquette validée : « A + C ») :
   - **Arbre des appels** qui se construit au fil des étapes. Code couleur : jaune = appel
     en cours / en attente, vert = terminé (avec sa valeur), gris = pas encore exécuté,
     rouge = a planté. Les résultats remontent vers la racine.
   - **Pile d'appels** (« qui attend qui ») : chaque cadre montre l'expression de l'appel
     avec ce qui lui manque encore, ex. `fib 4 = [fib 3 ?] + fib 2`, puis `fib 3 = 1 + [fib 1 ?]`.
   - L'appel courant est encadré dans les deux vues **et** la ligne de code correspondante
     est surlignée dans l'éditeur.
4. **Les données sont visibles dans les nœuds de l'arbre** (maquette validée : option A) :
   - listes → cases ; l'élément « pivot » ou distingué n'est pas spécifiquement détecté
     (voir « Laissé au constructeur ») ;
   - chaque nœud montre ses arguments, et son résultat une fois terminé ;
   - types de données définis par l'utilisateur (`data Arbre = ...`) → petit arbre dessiné ;
   - nombres, caractères, chaînes, booléens, tuples → affichés tels quels.
5. **Navigation pas à pas** : ⏮ ◀ ▶ ⏭ + curseur ; on peut reculer. Une **phrase en
   français** décrit chaque étape (ex. « Étape 7 : fib 3 appelle fib 1 (cas de base :
   fib 1 = 1) »).
6. **Exécution réelle, affichage dans l'ordre logique** (choix de l'utilisateur) :
   - le programme s'exécute **normalement, paresseusement**, avec GHC : son comportement
     n'est jamais modifié (`take 5 [1..]` fonctionne, une liaison inutilisée contenant
     `error` ne plante pas) ;
   - la trace est ensuite **réordonnée pour l'affichage** dans l'ordre logique : chaque
     appel apparaît sous l'appel qui le contient dans le code (son appelant lexical), et
     les enfants d'un appel sont présentés avant son retour, comme si chaque appel se
     terminait avant le suivant. L'ordre paresseux réel n'est pas montré ;
   - les valeurs (ou parties de valeurs) que Haskell n'a **jamais calculées** sont
     affichées en gris « non calculé » ; une structure infinie ou très longue est
     tronquée à l'affichage (ex. `[1,2,3,4,5,…]`) ;
   - capturer une valeur pour l'afficher ne doit **jamais** forcer son évaluation.
7. **Fonctions de la bibliothèque standard** : les fonctions de l'utilisateur sont toujours
   tracées. Les fonctions de liste courantes (`map`, `filter`, `foldr`, `foldl`, `length`,
   `sum`, `product`, `++`, `reverse`, `concat`, `zip`, `take`, `drop`, `elem`, `replicate`
   au minimum) apparaissent comme **un seul nœud replié** (entrée → sortie). Un clic le
   **déplie** et montre leur récursion interne. Un interrupteur global « tout déplier ».
8. **Fidélité absolue** : la visualisation ne doit jamais mentir (étape manquante, valeur
   fausse, ordre inventé hors de la règle « ordre logique »). L'app ne juge pas si le
   résultat est correct ; c'est l'utilisateur qui le sait. Elle doit lui permettre de
   trouver où son code dévie.
9. **Erreurs** :
   - erreur de compilation → messages GHC affichés dans l'éditeur, sur la bonne ligne ;
   - plantage à l'exécution (`head []`, motifs non exhaustifs, `error "..."`, division par
     zéro) → le nœud fautif en **rouge** dans l'arbre, avec le message, et l'exécution
     visualisable jusqu'à ce point ;
   - boucle infinie / liste infinie / récursion trop profonde → arrêt après une limite
     (nombre d'étapes et/ou temps), message clair à l'écran, et ce qui a été tracé
     jusque-là reste visualisable.
10. Lancement local en **une commande**.

## Non-objectifs (étape 1)

- Pas de mise en ligne publique, pas de comptes, pas de sauvegarde côté serveur.
- Pas de sécurité / isolation du code exécuté (local uniquement, le code est celui de
  l'utilisateur sur sa propre machine). Une limite de temps et de mémoire reste
  nécessaire pour ne pas geler la machine.
- Pas de débogueur interactif en direct (points d'arrêt, modification pendant l'exécution) :
  on exécute tout, on enregistre, puis on rejoue.
- Pas de vue « réduction comme sur papier » (option B des maquettes), ni de visualisation
  de l'ordre paresseux réel.
- Pas de support des entrées clavier interactives (`getLine`) — voir « Laissé au constructeur ».
- C et Python : pas aujourd'hui, mais l'architecture doit les accueillir (voir Contraintes).
  Pour l'étape 2, l'utilisateur prévoit **les appels de fonctions seulement** (pas de
  suivi des variables qui changent ni des tours de boucle) : le format de trace n'a pas
  besoin de ces notions aujourd'hui. Il doit seulement être étiqueté par type
  d'événement et versionné, pour pouvoir en ajouter plus tard.

## Anti-objectifs (ce qui serait un échec même si ça tourne)

- Une visualisation qui ne correspond pas à ce que le code a calculé.
- Une app qui refuse des programmes Haskell ordinaires d'apprenant (récursion simple,
  pattern matching, gardes, `where`/`let`, listes en compréhension, types `data`
  récursifs, fonctions d'ordre supérieur).
- Une app qui se fige ou fige la machine sur une boucle infinie.

## Contraintes

- Environnement : Linux, GHC 9.10.3, cabal 3.16, stack 3.11, Node 26, npm 12, Docker
  disponible (non requis).
- **Extensible à d'autres langages** : la visualisation ne doit dépendre que d'une **trace
  d'exécution** dans un format commun, indépendant du langage (événements : appel avec
  arguments, retour avec valeur, erreur, position dans le source, valeurs structurées
  liste / arbre / scalaire / enregistrement). Chaque langage fournit un « traceur »
  côté serveur qui produit ce format. Demain on ajoute un traceur C et un traceur Python
  sans toucher à la visualisation.
- Interface en français.

## Décisions prises

Par l'utilisateur :
- Disposition éditeur à gauche / visualisation à droite.
- Arbre + pile synchronisés ; ligne de code surlignée ; phrase explicative par étape.
- Données dans les nœuds de l'arbre.
- Exécution paresseuse réelle (fidélité), affichée dans l'ordre logique plutôt que
  dans l'ordre paresseux réel.
- Étape 2 (C, Python) : appels de fonctions seulement, pour l'instant.
- Fonctions de la bibliothèque standard tracées mais repliées, dépliables.
- Local uniquement pour l'étape 1. Projet dans `~/dev/sources/unfold`.
- Choix techniques délégués à Claude.

Par Claude (à vérifier à la lecture) :
- Nom du projet : **Unfold**.
- **Approche de traçage : vrai GHC + instrumentation du code source.** Le serveur reçoit
  le code, le réécrit pour envelopper chaque fonction d'un enregistreur d'événements
  (entrée avec arguments, sortie avec résultat, exceptions, identifiant de l'appelant
  lexical), compile avec GHC, exécute **sans changer l'évaluation**, capture les valeurs
  sans les forcer (inspection du tas, ex. `GHC.Exts.Heap`, en fin d'exécution ou en cas
  de plantage), puis renvoie la trace JSON que le front réordonne. Rejeté :
  écrire un interpréteur Haskell maison (ne couvrirait qu'un sous-ensemble du langage,
  contraire à l'objectif 2) ; parser la sortie du débogueur GHCi (`:step`/`:trace`),
  fragile et suit l'ordre paresseux.
- Les types de l'utilisateur reçoivent automatiquement ce qu'il faut pour être affichés
  (ex. `deriving` ajouté) ; les valeurs non affichables (fonctions) apparaissent comme
  `<fonction>`.
- Front : TypeScript + React + Vite, éditeur Monaco, dessin en SVG.
- Back : petit serveur local (langage au choix du constructeur ; Node/TypeScript ou
  Haskell) qui appelle `ghc`.
- Limites par défaut : environ 5 000 étapes et 10 secondes d'exécution (ajustables).
- **Ce qui devient un nœud** : fonctions de haut niveau et locales (`where`/`let`) avec
  au moins un argument, opérateurs définis par l'utilisateur, méthodes des `instance`
  écrites par l'utilisateur, lambdas (nœud `λ` avec la position dans le source). Les
  valeurs locales sans argument (`pivot = head xs`) ne sont pas des nœuds : elles
  apparaissent dans le détail du nœud qui les définit. Les opérations de base (`+`,
  `div`, `max`, `==`, `show`…) ne sont pas des nœuds.
- **Valeurs non affichables** (fonctions, types polymorphes sans moyen d'affichage) :
  `<fonction>` ou `<valeur>` ; on ne change jamais les signatures de type de l'utilisateur
  pour pouvoir afficher.
- **Cadres de la pile** : quand c'est faisable, l'expression du côté droit de l'équation
  choisie avec l'appel en attente en trou et les résultats déjà connus substitués
  (`fib 4 = [fib 3 ?] + fib 2`). Sinon (corps complexes : `case`, gardes imbriquées,
  appels passés à `map`…), repli acceptable : « fib 4 attend fib 3 » + l'équation/garde
  qui a été choisie, surlignée.
- **Bibliothèque standard dépliable** : versions maison des fonctions listées à
  l'objectif 7, avec des définitions de manuel, mêmes résultats que GHC sur les listes.
  Quand on déplie, l'app indique clairement « définition de référence (simplifiée) ».
  Les autres fonctions de bibliothèque (`sort`, `Data.Map`…) : un nœud fermé non
  dépliable (entrée → sortie) si elles sont appelées directement par le code de
  l'utilisateur.
- **Périmètre du code accepté** : un seul fichier ; `base` et `containers` disponibles ;
  enregistrements, classes et instances de l'utilisateur, `LANGUAGE` pragmas courants
  supportés. Les autres paquets ne sont pas supportés à l'étape 1 (message clair).
- Un petit jeu d'exemples prêts à charger (factorielle, fib, somme de liste, quicksort,
  insertion dans un arbre binaire, une version boguée d'un de ces exemples).

## Laissé au constructeur

- Outil d'analyse / réécriture du Haskell (ex. `ghc-lib-parser`, `ghc-exact-print`,
  plugin GHC, `haskell-src-exts`) — choisir ce qui supporte le mieux la syntaxe GHC 9.10
  et garde des positions de source fiables.
- Le format précis de la trace JSON (respecter les exigences de la section Contraintes).
- Mise en page de l'arbre (algorithme de placement, zoom/défilement pour les gros arbres,
  repli automatique des sous-arbres très profonds).
- Comment écrire la phrase explicative de chaque étape (gabarits simples suffisent).
- Si `main` n'existe pas : proposer une expression à évaluer (champ « Évaluer : »),
  ou exiger `main`. Le comportement de `getLine` et autres entrées : refuser proprement
  avec un message.
- Mise en évidence spécifique d'éléments de données (ex. pivot du quicksort) : pas
  d'heuristique demandée ; les cases simples suffisent.
- Tests : couvrir au minimum la réécriture/instrumentation et la fidélité de la trace
  sur les exemples fournis.
